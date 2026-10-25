import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CrewError, ident, now, validate } from '../../contracts/src/index.ts';
import type {
  Actor,
  AgentSession,
  ArtifactRef,
  ContextBundle,
  CoordinationQuestion,
  Decision,
  Delegation,
  Handoff,
  Message,
  Operation,
  ProviderAdapter,
  ProviderProcess,
  ProviderRequest,
  Review,
  Run,
  SourceRef,
  Verification,
} from '../../contracts/src/index.ts';
import {
  compileContext,
  inspectProject,
  selectTaskSources,
} from '../../context/src/index.ts';
import { ClaudeProvider, CodexProvider } from '../../providers/src/index.ts';
import { Store } from '../../storage/src/index.ts';
import { WorkspaceManager } from '../../workspace/src/index.ts';
import type { WorkspaceHandle } from '../../workspace/src/index.ts';
import { runCommand } from '../../workspace/src/git.ts';
import { CapabilityRegistry } from './capabilities.ts';
import {
  Coordinator,
  eventPage,
  nonempty,
  requestId,
  serviceActor,
} from './coordinator.ts';
import { MAX_JSON_BYTES } from './protocol.ts';
import type { AdminRequest } from './protocol.ts';
import { TurnScheduler } from './scheduler.ts';
import { toolsFor } from './tools.ts';
import { observeProcess, stopOwnedProcess } from './reconciliation.ts';
import type { ProcessIdentity } from './reconciliation.ts';

type ActiveTurn = {
  run_id: string;
  role: 'chief' | 'worker';
  actor: Actor;
  session: AgentSession;
  process: ProviderProcess;
  operation: Operation;
};
const terminal = (run: Run) =>
  ['completed', 'failed', 'cancelled'].includes(run.status);
// Full events stay well under the transport limit, even for multibyte text, next to the other records.
const EVENT_CHARS = MAX_JSON_BYTES / 4;
const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim())
    throw new CrewError('INVALID_INPUT', `${name} is required`);
  return value;
};
const strings = (value: unknown, name: string): string[] => {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !item.trim())
  )
    throw new CrewError('INVALID_INPUT', `${name} must contain strings`);
  return value as string[];
};

export class SupervisorRuntime {
  readonly registry: CapabilityRegistry;
  readonly coordinator: Coordinator;
  readonly scheduler: TurnScheduler;
  private readonly providers: Map<string, ProviderAdapter>;
  private readonly active = new Map<string, ActiveTurn>();
  private readonly chiefNeeded = new Set<string>();
  private readonly pumping = new Set<string>();
  private readonly workerQueued = new Set<string>();
  private readonly chiefQueued = new Set<string>();
  private readonly cancellation = new Map<string, number>();
  private readonly suspending = new Set<string>();
  private closing = false;

  initialize(): void {
    this.registry.revokeAllAgentCapabilities();
    for (const run of this.store.listRuns()) {
      if (terminal(run)) continue;
      const uncertain = this.store
        .uncertainOperations(run.id)
        .filter((operation) => operation.kind === 'provider.turn');
      if (!uncertain.length) continue;
      const user = serviceActor(this.store, run.id);
      this.store.observation(user, 'recovery.required', {
        operation_ids: uncertain.map((operation) => operation.id),
        reason: 'Prior process ownership must be reconciled before resume',
      });
      if (run.status === 'running')
        this.store.updateRunStatus(
          user,
          'waiting_provider',
          ident('recovery-wait'),
          this.version(run.id),
        );
    }
  }

  private async reconcile(runId: string, chiefOnly = false): Promise<void> {
    const user = serviceActor(this.store, runId);
    for (const operation of this.store
      .uncertainOperations(runId)
      .filter((item) => item.kind === 'provider.turn')) {
      if (
        [...this.active.values()].some(
          (turn) => turn.operation.id === operation.id,
        )
      )
        continue;
      const recorded = operation.result as {
        actor?: Actor;
        identity?: ProcessIdentity | null;
        pid?: number | null;
      } | null;
      const actor = recorded?.actor;
      if (chiefOnly && actor?.role !== 'chief') continue;
      if (
        !actor ||
        actor.run_id !== runId ||
        actor.project_id !== this.store.project.id ||
        !recorded?.identity
      )
        throw new CrewError(
          'RECONCILIATION_REQUIRED',
          `Turn ${operation.id} has no verified recorded process identity; inspect it before retrying`,
        );
      const outcome = await stopOwnedProcess(recorded.identity);
      if (actor.attempt_id) {
        const attempt = this.store.getAttempt(actor.attempt_id);
        if (!['exited', 'interrupted'].includes(attempt.status))
          this.store.observeAttempt(
            user,
            attempt.id,
            {
              status: 'interrupted',
              pid: recorded.pid ?? null,
              exit_code: null,
            },
            requestId(operation.id, 'recovered-attempt'),
            this.version(runId),
          );
        const task = this.store.getTask(attempt.task_id);
        if (task.status === 'running')
          this.store.setTaskWait(
            user,
            task.id,
            'waiting_provider',
            'Previous process stopped during explicit recovery',
            requestId(operation.id, 'recovered-task'),
            this.version(runId),
          );
      }
      this.store.observeOperation(
        user,
        operation.id,
        'completed',
        { ...recorded, recovery: outcome, business_success: false },
        requestId(operation.id, 'recovered'),
        this.version(runId),
      );
      this.store.observation(user, 'recovery.observed', {
        operation_id: operation.id,
        process_outcome: outcome,
        business_success: false,
      });
    }
  }

  constructor(
    readonly store: Store,
    private readonly endpointFile: string,
    providers: ProviderAdapter[] = [new ClaudeProvider(), new CodexProvider()],
    private readonly shutdown: () => Promise<void> = async () => {},
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
    this.registry = new CapabilityRegistry(store);
    this.coordinator = new Coordinator(store, this);
    this.scheduler = new TurnScheduler(
      store.project.config.max_active_agents,
      (job, error) => {
        this.store.observation(
          serviceActor(store, job.run_id),
          'turn.launch_failed',
          {
            turn_id: job.id,
            role: job.role,
            message:
              error instanceof CrewError
                ? error.message
                : 'Turn failed before completion',
          },
        );
      },
    );
  }

  wake(runId: string, notifyChief = true): void {
    if (this.closing || this.suspending.has(runId)) return;
    if (notifyChief) this.chiefNeeded.add(runId);
    setImmediate(() => {
      void this.pump(runId).catch((error: unknown) => {
        this.store.observation(
          serviceActor(this.store, runId),
          'scheduler.blocked',
          { code: error instanceof CrewError ? error.code : 'INTERNAL_ERROR' },
        );
      });
    });
  }

  private async pump(runId: string): Promise<void> {
    if (this.closing || this.suspending.has(runId) || this.pumping.has(runId))
      return;
    const run = this.store.getRun(runId);
    if (
      terminal(run) ||
      ['paused', 'waiting_user', 'waiting_provider', 'blocked'].includes(
        run.status,
      )
    )
      return;
    this.pumping.add(runId);
    try {
      const delegations = this.store
        .records<Delegation>(runId, 'delegation')
        .filter((item) => item.status === 'queued');
      const questions = this.store
        .records<CoordinationQuestion>(runId, 'question')
        .filter((question) => question.blocking && question.status === 'open');
      for (const delegation of delegations) {
        if (
          questions.some(
            (question) =>
              !question.affects_task_ids.length ||
              question.affects_task_ids.includes(delegation.task_id),
          )
        )
          continue;
        if (
          run.delivery_mode === 'documentation' &&
          [...this.workerQueued].some(
            (id) =>
              this.store.getRun(this.store.getTask(id).run_id).delivery_mode ===
              'documentation',
          )
        )
          break;
        const task = this.store.getTask(delegation.task_id);
        if (
          this.workerQueued.has(task.id) ||
          [
            'accepted',
            'cancelled',
            'waiting_dependency',
            'waiting_user',
          ].includes(task.status)
        )
          continue;
        if (
          task.active_attempt_id &&
          !['exited', 'interrupted'].includes(
            this.store.getAttempt(task.active_attempt_id).status,
          )
        )
          continue;
        this.workerQueued.add(task.id);
        this.scheduler.enqueue({
          id: requestId(delegation.id, 'turn'),
          run_id: runId,
          role: 'worker',
          run_limit: run.max_active_agents,
          execute: async () => {
            try {
              await this.worker(runId, delegation);
            } finally {
              this.workerQueued.delete(task.id);
              this.wake(runId);
            }
          },
        });
      }
      const hasWorkers =
        [...this.workerQueued].some(
          (id) => this.store.getTask(id).run_id === runId,
        ) ||
        [...this.active.values()].some(
          (turn) => turn.run_id === runId && turn.role === 'worker',
        );
      if (
        this.chiefNeeded.has(runId) &&
        !this.chiefQueued.has(runId) &&
        !(run.max_active_agents === 1 && hasWorkers)
      ) {
        this.chiefNeeded.delete(runId);
        this.chiefQueued.add(runId);
        this.scheduler.enqueue({
          id: ident('chief-turn'),
          run_id: runId,
          role: 'chief',
          run_limit: run.max_active_agents,
          execute: async () => {
            try {
              await this.chief(runId);
            } finally {
              this.chiefQueued.delete(runId);
              if (this.chiefNeeded.has(runId)) this.wake(runId, false);
            }
          },
        });
      }
    } finally {
      this.pumping.delete(runId);
    }
  }

  private async chief(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (terminal(run) || run.status !== 'running') return;
    const actor: Actor = {
      id: requestId(runId + ':' + run.generation, 'chief'),
      project_id: run.project_id,
      run_id: runId,
      role: 'chief',
      task_id: null,
      attempt_id: null,
      generation: run.generation,
    };
    let session = this.store
      .records<AgentSession>(runId, 'session')
      .find((item) => item.id === actor.id);
    if (!session) {
      session = {
        id: actor.id,
        run_id: runId,
        task_id: null,
        provider: run.chief_provider,
        model: run.chief_model,
        native_session_id: null,
        cli_version: null,
        cwd: this.store.project.root,
        capabilities: null,
      };
      this.store.registerChiefSession(
        serviceActor(this.store, runId),
        session,
        requestId(actor.id, 'register'),
        this.version(runId),
      );
    }
    await this.turn(run, actor, session, null);
  }

  private async worker(runId: string, delegation: Delegation): Promise<void> {
    const run = this.store.getRun(runId),
      user = serviceActor(this.store, runId);
    let task = this.store.getTask(delegation.task_id);
    if (terminal(run) || run.status !== 'running') return;
    if (
      this.store
        .records<CoordinationQuestion>(runId, 'question')
        .some(
          (question) =>
            question.blocking &&
            question.status === 'open' &&
            (!question.affects_task_ids.length ||
              question.affects_task_ids.includes(task.id)),
        )
    )
      return;
    const manager = new WorkspaceManager(this.store, user);
    let recoveryBase: string | null = null;
    let nativeSession: AgentSession | undefined;
    // The task's latest code workspace holds its newest work, submitted or not,
    // even when an explicit reassignment already cleared the active attempt.
    const oldWorkspace = this.store
      .records<Operation>(runId, 'operation')
      .filter(
        (operation) =>
          operation.kind === 'workspace.create' &&
          operation.status === 'completed' &&
          (operation.result as WorkspaceHandle).taskId === task.id &&
          (operation.result as WorkspaceHandle).mode === 'code',
      )
      .at(-1);
    const reassigned = !task.active_attempt_id;
    if (task.active_attempt_id) {
      const previous = this.store.getAttempt(task.active_attempt_id);
      nativeSession = this.store.getRecord<AgentSession>(
        runId,
        'session',
        previous.session_id,
      );
    }
    if (task.active_attempt_id)
      task = this.store.reassignTask(
        user,
        task.id,
        requestId(delegation.id, 'reassign'),
        this.version(runId),
      );
    if (task.status !== 'ready') return;
    const session: AgentSession = {
      id: requestId(delegation.id, 'session'),
      run_id: runId,
      task_id: task.id,
      provider: delegation.provider,
      model: delegation.model,
      native_session_id:
        nativeSession?.provider === delegation.provider
          ? nativeSession.native_session_id
          : null,
      cli_version: null,
      cwd: this.store.project.root,
      capabilities: null,
    };
    const attempt = this.store.claimTask(
      user,
      task.id,
      session,
      requestId(delegation.id, 'claim'),
      this.version(runId),
    );
    const actor: Actor = {
      id: session.id,
      project_id: run.project_id,
      run_id: runId,
      role: task.spec.role,
      task_id: task.id,
      attempt_id: attempt.id,
      generation: attempt.generation,
    };
    try {
      if (run.delivery_mode === 'code' && oldWorkspace) {
        try {
          const snapshot = await manager.collectDelivery(
            oldWorkspace.id,
            {
              writePaths: task.spec.scope.write_paths,
              excludedPaths: task.spec.scope.excluded_paths,
            },
            requestId(delegation.id, 'recovery-snapshot'),
          );
          recoveryBase = snapshot.sourceRevision;
          this.store.observation(user, 'recovery.snapshot', {
            task_id: task.id,
            revision: recoveryBase,
            business_success: false,
          });
        } catch (error) {
          // An explicit reassignment is how an amended baseline is adopted; the old worktree stays on disk.
          if (
            !reassigned ||
            !(error instanceof CrewError && error.code === 'BASE_CHANGED')
          )
            throw error;
          this.store.observation(user, 'recovery.skipped', {
            task_id: task.id,
            reason: 'BASE_CHANGED',
            preserved_path: (oldWorkspace.result as WorkspaceHandle).path,
            business_success: false,
          });
        }
      }
      const previous = this.store
        .records<Handoff>(runId, 'handoff')
        .filter((handoff) => handoff.task_id === task.id)
        .at(-1);
      const resources = await manager.reserveResources(1);
      let workspace: WorkspaceHandle;
      try {
        workspace = await manager.createWorkspace(
          {
            taskId: task.id,
            attemptId: attempt.id,
            mode:
              run.delivery_mode === 'code'
                ? 'code'
                : task.spec.role === 'reviewer'
                  ? 'read-only'
                  : 'documentation',
            baseRevision:
              run.delivery_mode === 'code'
                ? (recoveryBase ??
                  previous?.source_revision ??
                  task.spec.base_revision)
                : null,
            resources,
          },
          requestId(attempt.id, 'workspace'),
        );
      } finally {
        await resources.release();
      }
      session.cwd = workspace.path;
      await this.turn(run, actor, session, workspace);
    } catch (error) {
      const current = this.store.getAttempt(attempt.id);
      if (!['exited', 'interrupted'].includes(current.status))
        this.store.observeAttempt(
          user,
          attempt.id,
          { status: 'exited', pid: null, exit_code: null },
          requestId(attempt.id, 'launch-failed'),
          this.version(runId),
        );
      const currentTask = this.store.getTask(task.id);
      if (currentTask.status === 'running')
        this.store.setTaskWait(
          user,
          task.id,
          'blocked',
          error instanceof CrewError
            ? error.message
            : 'Workspace or provider launch failed',
          requestId(attempt.id, 'wait-launch'),
          this.version(runId),
        );
      throw error;
    }
  }

  private version(runId: string): number {
    return this.store.getRun(runId).version;
  }

  private async turn(
    run: Run,
    actor: Actor,
    session: AgentSession,
    workspace: WorkspaceHandle | null,
  ): Promise<void> {
    const fence = run.id + ':' + (actor.task_id ?? 'chief');
    const cancellation = this.cancellation.get(fence) ?? 0;
    const adapter = this.providers.get(session.provider);
    if (!adapter)
      throw new CrewError(
        'PROVIDER_UNAVAILABLE',
        `Provider unavailable: ${session.provider}`,
      );
    const user = serviceActor(this.store, run.id),
      invocation = ident('turn');
    const operation = this.store.beginOperation(
      user,
      'provider.turn',
      JSON.stringify({ actor, session_id: session.id, invocation }),
      invocation,
      this.version(run.id),
    );
    let token: string | null = null;
    let readingStarted = false;
    try {
      const mayStart = () => {
        const current = this.store.getRun(run.id);
        return (
          !this.closing &&
          !this.suspending.has(run.id) &&
          current.status === 'running' &&
          (actor.role !== 'chief' || current.generation === run.generation) &&
          (this.cancellation.get(fence) ?? 0) === cancellation &&
          (!actor.task_id ||
            this.store.getTask(actor.task_id).status === 'running')
        );
      };
      const cancelPreparation = () => {
        this.store.observeOperation(
          user,
          operation.id,
          'failed',
          { cancelled_before_start: true, business_success: false },
          requestId(invocation, 'cancelled'),
          this.version(run.id),
        );
        if (
          actor.attempt_id &&
          !['exited', 'interrupted'].includes(
            this.store.getAttempt(actor.attempt_id).status,
          )
        ) {
          this.store.observeAttempt(
            user,
            actor.attempt_id,
            { status: 'interrupted', pid: null, exit_code: null },
            requestId(invocation, 'cancelled-attempt'),
            this.version(run.id),
          );
          if (this.store.getTask(actor.task_id!).status === 'running')
            this.store.setTaskWait(
              user,
              actor.task_id!,
              'waiting_provider',
              'Turn preparation was cancelled before launch',
              requestId(invocation, 'cancelled-task'),
              this.version(run.id),
            );
        }
      };
      if (!mayStart()) {
        cancelPreparation();
        return;
      }
      const capability = await adapter.probe();
      if (!mayStart()) {
        cancelPreparation();
        return;
      }
      if (capability.structured_events.status !== 'supported')
        throw new CrewError(
          'UNSUPPORTED',
          'Structured provider events have not been verified',
        );
      this.store.updateSession(
        user,
        session.id,
        {
          native_session_id: session.native_session_id,
          cli_version: capability.version,
          capabilities: capability,
          cwd: session.cwd,
        },
        requestId(invocation, 'probe'),
        this.version(run.id),
      );
      const task = actor.task_id
        ? this.store.getTask(actor.task_id).spec
        : undefined;
      const project = await inspectProject(session.cwd);
      const selection = task
        ? await selectTaskSources(
            project,
            task,
            this.store.records<SourceRef>(run.id, 'source'),
          )
        : await selectTaskSources(project, {
            schema_version: 1,
            id: 'context:chief-selection',
            run_id: run.id,
            title: 'Exploration du chef',
            objective: run.objective,
            role: 'investigator',
            acceptance_criteria: nonempty(run.acceptance_criteria),
            depends_on: [],
            scope: {
              read_paths: ['**'],
              write_paths: [],
              excluded_paths: this.store.project.config.context.exclude_paths,
            },
            base_revision: project.git.revision,
            context_source_ids: [],
            expected_deliverables: [
              'Graphe des missions et critères préservés',
            ],
            created_at: now(),
          });
      const methods = toolsFor({ kind: 'agent', actor });
      const handoffs = this.store
        .records<Handoff>(run.id, 'handoff')
        .filter((handoff) => {
          const current = this.store.getTask(handoff.task_id);
          return (
            current.active_attempt_id === handoff.attempt_id &&
            current.generation === handoff.generation
          );
        });
      const resuming =
        session.native_session_id !== null &&
        capability.native_resume.status === 'supported';
      if (session.native_session_id && !resuming)
        throw new CrewError(
          'NATIVE_RESUME_UNAVAILABLE',
          'This conversation cannot be resumed with the observed capabilities; replace its chief or reassign explicitly',
        );
      const messages = this.store
        .records<Message>(run.id, 'message')
        .filter(
          (message) =>
            !['failed', 'applied'].includes(message.status) &&
            (!resuming || message.status === 'queued'),
        );
      const context = compileContext({
        id: requestId(invocation, 'context'),
        version:
          this.store
            .records<ContextBundle>(run.id, 'context')
            .filter(
              (bundle) =>
                bundle.subject_id === (task?.id ?? `control:${run.id}`),
            ).length + 1,
        created_at: now(),
        actor:
          actor.role === 'chief' ? { ...actor, attempt_id: invocation } : actor,
        orchestrator_id: requestId(run.id + ':' + run.generation, 'chief'),
        workspace_path: session.cwd,
        ...(task ? { task } : {}),
        selection,
        provider: capability,
        run,
        decisions: this.store.records<Decision>(run.id, 'decision'),
        messages,
        execution_policy: {
          native_permissions:
            actor.role === 'chief' ||
            task?.role === 'reviewer' ||
            this.store.project.config.permissions.profile === 'read_only'
              ? 'read-only'
              : 'workspace-write',
          resources: workspace
            ? {
                ports: workspace.ports,
                temporary_directory: workspace.temporaryDirectory,
                database_path: workspace.databasePath,
              }
            : null,
          concurrency: {
            max_active_agents: run.max_active_agents,
            includes_active_chief: true,
          },
          instructions:
            'Les outils crew sont la seule autorité de coordination. Le chef lit get_status pour la version courante avant mutation ; pour un worker ou un reviewer, expected_version est indicatif et sa tentative fait autorité. get_status est paginé et borné : continuer avec after_seq = next_seq tant que has_more. Créer des request_id et idempotency_key uniques par action ; réutiliser exactement la clé après perte de réponse. Les missions reprennent les IDs des critères du run qu’elles couvrent. delegate_task retourne queued sans attendre. Après délégation, terminer le tour pour libérer sa place. Une sortie native réussie ne vaut jamais acceptation. Pour soumettre un document neuf : document_paths contient les chemins relatifs à capturer ; handoff.artifacts et handoff.verifications restent vides et handoff.source_revision vaut null. Le serveur calcule les empreintes et les preuves observées ; ne pas inventer de hash ni de résultat. Le reviewer lit collect_delivery puis submit_review, sans submit_handoff ni dépendance d’acceptation sur la tâche relue. La revue documentaire porte sur le hash exact du snapshot ; une revue de code approuve le candidat combiné et son SHA exact après propose_integration : review.source_revision reste handoff.source_revision, le SHA du candidat va dans tested_revision. Relancer propose_integration avec une nouvelle idempotency_key reconstruit le même SHA pour les mêmes livraisons sur la même base et réexécute workspace_setup puis les contrôles. Les IDs des vérifications observées sont fournis par collect_delivery et get_status.',
          planning_rules: [
            'Attribuer les critères d’écriture à leur exécutant et les critères de revue à une mission reviewer distincte. Les critères globaux du run restent obligatoires ; ne pas demander à un writer de revendiquer une revue ou une clôture qu’il ne réalise pas.',
            'Pour corriger une mission arrêtée ou une passation à resoumettre : record_decision approved technical_judgment avec affects_task_ids, puis amend_task avec la TaskSpec complète et une raison, puis delegate_task. Le run garde ses critères. Toute nouvelle livraison exige sa revue indépendante.',
            'limitations contient les conditions qui empêchent de satisfaire les critères propres à la mission. Les méthodes déjà prises en charge par le service et les informations destinées à la suite vont dans next_information. Ne pas effacer une limite réelle ni inventer une preuve.',
            'Une revue acceptée produit sa propre preuve de contrôle, liée à la livraison acceptée. finish_run peut référencer ses evidence_artifact_ids pour les critères de revue, avec les preuves du writer pour les critères d’écriture.',
          ],
        },
        available_tools: methods,
        dependencies: this.store
          .tasks(run.id)
          .filter((item) => task?.depends_on.includes(item.id))
          .map((item) => ({
            task_id: item.id,
            status: item.status,
            references: handoffs
              .filter((handoff) => handoff.task_id === item.id)
              .flatMap((handoff) =>
                handoff.artifacts.map((artifact) => artifact.reference),
              ),
          })),
        budget: {
          context_window_tokens:
            this.store.project.config.context.input_budget_tokens,
          reserve_tokens: Math.min(
            4000,
            Math.floor(
              this.store.project.config.context.input_budget_tokens / 4,
            ),
          ),
        },
        artifacts: handoffs.flatMap((handoff) =>
          handoff.artifacts.map(({ reference, revision }) => ({
            reference,
            revision,
          })),
        ),
        verification_plan: [
          'check:git-diff',
          ...this.store.project.config.verification_commands.map(
            (check) => check.id,
          ),
        ],
        run_state: {
          run_version: this.version(run.id),
          details:
            'get_status(task_id) restitue la TaskSpec complète ; collect_delivery restitue passation, limites, revues et preuves exactes.',
          delivered_updates: resuming
            ? this.store
                .records<Message>(run.id, 'message')
                .filter(
                  (message) =>
                    ['delivered', 'acknowledged'].includes(message.status) &&
                    (actor.role === 'chief'
                      ? message.recipient_kind === 'chief'
                      : message.recipient_kind === 'task' &&
                        message.recipient_id === actor.task_id),
                )
                .map(({ id, sender_id, source_ids, status }) => ({
                  id,
                  sender_id,
                  source_ids,
                  status,
                  detail:
                    'get_status restitue le message conservé ; delivered ne signifie pas appliqué',
                }))
            : [],
          tasks: this.store.tasks(run.id).map((item) => ({
            id: item.id,
            title: item.spec.title,
            role: item.spec.role,
            depends_on: item.spec.depends_on,
            criterion_ids: item.spec.acceptance_criteria.map(
              (criterion) => criterion.id,
            ),
            status: item.status,
            generation: item.generation,
            active_attempt_id: item.active_attempt_id,
            accepted_revision: item.accepted_revision,
            wait_reason: item.wait_reason,
          })),
          handoffs: handoffs.map((handoff) => ({
            id: handoff.id,
            task_id: handoff.task_id,
            attempt_id: handoff.attempt_id,
            generation: handoff.generation,
            status: handoff.status,
            source_revision: handoff.source_revision,
            criteria_claimed: handoff.criteria_claimed,
            limitation_count: handoff.limitations.length,
            summary: handoff.summary.slice(0, 800),
            summary_truncated: handoff.summary.length > 800,
            artifacts: handoff.artifacts,
          })),
          reviews: this.store
            .records<Review>(run.id, 'review')
            .filter((review) =>
              handoffs.some((handoff) => handoff.id === review.handoff_id),
            )
            .map((review) => ({
              id: review.id,
              review_task_id: review.review_task_id,
              review_of_task_id: review.review_of_task_id,
              handoff_id: review.handoff_id,
              outcome: review.outcome,
              verification_scope: review.verification_scope,
              source_revision: review.source_revision,
              tested_revision: review.tested_revision,
              blocking_findings: review.findings.filter(
                (finding) => finding.severity === 'blocking',
              ).length,
              verification_ids: review.verification_ids,
            })),
          user_responses: this.store.records(run.id, 'user_response'),
          verifications: this.store
            .records<Verification>(run.id, 'verification')
            .map(
              ({
                id,
                criterion_ids,
                mode,
                execution,
                result,
                tested_revision,
                evidence_artifact_ids,
                provider,
              }) => ({
                id,
                criterion_ids,
                mode,
                execution,
                result,
                tested_revision,
                evidence_artifact_ids,
                provider,
              }),
            ),
          questions: this.store.records(run.id, 'question'),
          delivery_target:
            this.store.project.config.delivery.target_ref ??
            `refs/heads/avity-crew/delivery-${run.id.replace(/[^A-Za-z0-9-]/g, '-')}`,
          expected_target_revision: project.git.revision,
          activity: this.scheduler.snapshot(),
        },
      });
      for (const snapshot of selection.sources) {
        if (
          !this.store
            .records<SourceRef>(run.id, 'source')
            .some((source) => source.id === snapshot.source.id)
        )
          this.store.saveSource(
            user,
            snapshot.source,
            requestId(snapshot.source.id, 'source'),
            this.version(run.id),
          );
      }
      this.store.saveContext(
        user,
        context.bundle,
        requestId(invocation, 'save-context'),
        this.version(run.id),
      );
      const prompt = this.store.writeArtifact(context.prompt),
        inspection = this.store.writeArtifact(
          JSON.stringify(context.inspection),
        );
      this.store.observation(
        user,
        'context.compiled',
        { context_id: context.bundle.id, prompt, inspection },
        {
          session_id: session.id,
          task_id: actor.task_id,
          attempt_id: actor.attempt_id,
          generation: actor.generation,
        },
      );
      token = this.registry.issue(actor);
      const request: ProviderRequest = {
        cwd: session.cwd,
        prompt: context.prompt,
        model: session.model,
        role: actor.role,
        permissions: {
          sandbox:
            actor.role === 'chief' ||
            task?.role === 'reviewer' ||
            this.store.project.config.permissions.profile === 'read_only'
              ? 'read-only'
              : 'workspace-write',
          approval: 'never',
        },
        bridge: {
          command: process.execPath,
          args: [fileURLToPath(new URL('./bridge.js', import.meta.url))],
          approved_tools: methods.map((tool) => tool.name),
          env: {
            AVITY_CREW_ENDPOINT_FILE: this.endpointFile,
            AVITY_CREW_CAPABILITY: token,
            AVITY_CREW_RUN_ID: run.id,
            ...(workspace
              ? {
                  PORT: String(workspace.ports[0] ?? 0),
                  TMPDIR: workspace.temporaryDirectory,
                  AVITY_CREW_DATABASE_PATH: workspace.databasePath,
                }
              : {}),
          },
        },
      };
      if (!mayStart()) {
        cancelPreparation();
        return;
      }
      const native =
        session.native_session_id &&
        capability.native_resume.status === 'supported'
          ? adapter.resume({
              ...request,
              native_session_id: session.native_session_id,
            })
          : adapter.start(request);
      this.active.set(invocation, {
        run_id: run.id,
        role: actor.role === 'chief' ? 'chief' : 'worker',
        actor,
        session,
        process: native,
        operation,
      });
      let identity: ProcessIdentity | null = null;
      if (native.pid) {
        try {
          identity = await observeProcess(native.pid);
        } catch {
          this.store.observation(user, 'recovery.unverified', {
            turn_id: invocation,
            reason:
              'Process identity could not be observed; crash recovery requires inspection',
          });
        }
      }
      this.active.set(invocation, {
        run_id: run.id,
        role: actor.role === 'chief' ? 'chief' : 'worker',
        actor,
        session,
        process: native,
        operation,
      });
      this.store.observeOperation(
        user,
        operation.id,
        'running',
        {
          pid: native.pid,
          session_id: session.id,
          actor,
          identity,
          native_session_id: session.native_session_id,
        },
        requestId(invocation, 'running'),
        this.version(run.id),
      );
      if (actor.attempt_id)
        this.store.observeAttempt(
          user,
          actor.attempt_id,
          { status: 'running', pid: native.pid, exit_code: null },
          requestId(invocation, 'started'),
          this.version(run.id),
        );
      for (const message of messages.filter(
        (item) =>
          item.status === 'queued' &&
          (actor.role === 'chief'
            ? item.recipient_kind === 'chief'
            : item.recipient_kind === 'task' &&
              item.recipient_id === actor.task_id),
      ))
        this.store.updateMessage(
          user,
          message.id,
          'delivered',
          requestId(invocation + message.id, 'delivered'),
          this.version(run.id),
        );
      try {
        readingStarted = true;
        const publishedSessions = new Set<string>();
        const reading = (async () => {
          try {
            for await (const event of native.events) {
              if (
                event.type === 'session' &&
                event.native_session_id &&
                !publishedSessions.has(event.native_session_id)
              ) {
                publishedSessions.add(event.native_session_id);
                session.native_session_id = event.native_session_id;
                this.store.updateSession(
                  user,
                  session.id,
                  {
                    native_session_id: event.native_session_id,
                    cli_version: capability.version,
                    capabilities: capability,
                  },
                  requestId(invocation + event.native_session_id, 'session'),
                  this.version(run.id),
                );
                if (native.pid) {
                  try {
                    identity = await observeProcess(native.pid);
                  } catch {
                    /* Preserve the previous observation. */
                  }
                }
                this.store.observeOperation(
                  user,
                  operation.id,
                  'running',
                  {
                    pid: native.pid,
                    identity,
                    actor,
                    session_id: session.id,
                    native_session_id: event.native_session_id,
                  },
                  requestId(invocation + event.native_session_id, 'identity'),
                  this.version(run.id),
                );
              }
              this.store.observation(
                user,
                'provider.' + event.type,
                { ...event, turn_id: invocation },
                {
                  session_id: session.id,
                  task_id: actor.task_id,
                  attempt_id: actor.attempt_id,
                  generation: actor.generation,
                },
              );
            }
          } catch (error) {
            await native.stop();
            throw error;
          }
        })();
        const [result] = await Promise.all([native.result, reading]);
        if (actor.attempt_id)
          this.store.observeAttempt(
            user,
            actor.attempt_id,
            {
              status: result.signal ? 'interrupted' : 'exited',
              pid: native.pid,
              exit_code: result.exit_code,
            },
            requestId(invocation, 'exited'),
            this.version(run.id),
          );
        this.store.observeOperation(
          user,
          operation.id,
          'completed',
          { ...result, pid: native.pid, actor, session_id: session.id },
          requestId(invocation, 'completed'),
          this.version(run.id),
        );
        if (actor.task_id) {
          const current = this.store.getTask(actor.task_id);
          if (current.status === 'running')
            this.store.setTaskWait(
              user,
              current.id,
              result.error ? 'waiting_provider' : 'blocked',
              result.error?.message ??
                'Provider exited without a structured handoff or review',
              requestId(invocation, 'waiting'),
              this.version(run.id),
            );
          if (
            run.delivery_mode === 'documentation' &&
            current.status === 'in_review'
          )
            await this.verifyDocuments(run.id, actor.task_id);
        } else if (
          result.error &&
          !terminal(this.store.getRun(run.id)) &&
          this.store.getRun(run.id).status === 'running'
        ) {
          this.store.updateRunStatus(
            user,
            'waiting_provider',
            requestId(invocation, 'chief-wait'),
            this.version(run.id),
          );
        }
      } finally {
        this.active.delete(invocation);
      }
    } catch (error) {
      if (token) this.registry.revoke(token);
      const active = this.active.get(invocation);
      if (active) {
        const drain = readingStarted
          ? Promise.resolve()
          : (async () => {
              for await (const _event of active.process.events) {
                /* Drain while stopping a launch that failed before observation. */
              }
            })();
        await active.process.stop();
        await Promise.all([active.process.result, drain]);
        this.active.delete(invocation);
      }
      const current = this.store.getRecord<Operation>(
        run.id,
        'operation',
        operation.id,
      );
      if (!['completed', 'failed'].includes(current.status))
        this.store.observeOperation(
          user,
          operation.id,
          current.status === 'intent' ? 'failed' : 'completed',
          {
            business_success: false,
            error:
              error instanceof CrewError
                ? { code: error.code, message: error.message }
                : { code: 'INTERNAL_ERROR' },
          },
          requestId(invocation, 'failed'),
          this.version(run.id),
        );
      if (
        actor.role === 'chief' &&
        this.store.getRun(run.id).status === 'running'
      )
        this.store.updateRunStatus(
          user,
          'waiting_provider',
          requestId(invocation, 'launch-wait'),
          this.version(run.id),
        );
      throw error;
    } finally {
      if (token) this.registry.revoke(token);
    }
  }

  private async verifyDocuments(runId: string, taskId: string): Promise<void> {
    const handoff = this.store
      .records<Handoff>(runId, 'handoff')
      .filter((item) => item.task_id === taskId)
      .at(-1);
    if (!handoff?.source_revision) return;
    const id = requestId(handoff.id, 'verification');
    if (
      this.store
        .records<Verification>(runId, 'verification')
        .some((proof) => proof.id === id)
    )
      return;
    const files = handoff.artifacts.filter((artifact) =>
      artifact.revision.startsWith('sha256:'),
    );
    for (const artifact of files) this.store.readArtifact(artifact);
    const script =
      "const fs=require('node:fs'),c=require('node:crypto');for(const [p,h]of JSON.parse(process.argv[1])){if(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)process.exit(1)}console.log('Immutable document snapshots verified')";
    const command = [
      process.execPath,
      '-e',
      script,
      JSON.stringify(
        files.map((artifact) => [
          join(this.store.project.data_dir, artifact.reference),
          artifact.revision.slice(7),
        ]),
      ),
    ];
    const started = now(),
      result = await runCommand(this.store.project.root, command, 10000),
      ended = now();
    const log = this.store.writeArtifact(
      result.stdout + '\n' + result.stderr,
      true,
    );
    const artifact: ArtifactRef = {
      id: requestId(id, 'artifact'),
      kind: 'test_log',
      ...log,
      producer_attempt_id: handoff.attempt_id,
      created_at: ended,
    };
    this.store.saveVerification(
      serviceActor(this.store, runId),
      taskId,
      {
        id,
        criterion_ids: nonempty(
          this.store
            .getTask(taskId)
            .spec.acceptance_criteria.map((criterion) => criterion.id),
        ),
        mode: 'static',
        execution: 'automated',
        command: nonempty(command),
        cwd: this.store.project.root,
        result:
          result.exitCode === 0 && !result.error && !result.truncated
            ? 'passed'
            : 'failed',
        exit_code: result.exitCode,
        tested_revision: handoff.source_revision,
        evidence_artifact_ids: [artifact.id],
        started_at: started,
        ended_at: ended,
        provider: null,
      },
      requestId(id, 'save'),
      this.version(runId),
      [artifact],
    );
  }

  async admin(request: AdminRequest): Promise<unknown> {
    const args = request.arguments;
    if (request.method === 'list_runs') return this.store.listRuns();
    if (request.method === 'doctor')
      return {
        node: process.version,
        project: this.store.project.root,
        providers: await Promise.all(
          [...this.providers.values()].map(async (provider) => {
            try {
              return {
                provider: provider.id,
                status: 'available',
                capabilities: await provider.probe(),
              };
            } catch (error) {
              return {
                provider: provider.id,
                status: 'unavailable',
                message:
                  error instanceof CrewError ? error.message : 'Probe failed',
              };
            }
          }),
        ),
      };
    if (request.method === 'create_run') {
      const criteria = strings(args['criteria'], 'criteria');
      if (!criteria.length)
        throw new CrewError(
          'INVALID_INPUT',
          'At least one acceptance criterion is required',
        );
      const provider =
        args['chief_provider'] ??
        this.store.project.config.orchestrator.provider;
      validate('ProviderId', provider);
      if (!this.providers.has(provider))
        throw new CrewError(
          'PROVIDER_UNAVAILABLE',
          'Chief provider is unavailable',
        );
      const maximum =
        args['max_active_agents'] ??
        this.store.project.config.max_active_agents;
      if (
        !Number.isSafeInteger(maximum) ||
        Number(maximum) < 1 ||
        Number(maximum) > this.scheduler.limit
      )
        throw new CrewError(
          'INVALID_LIMIT',
          `Run limit must be between 1 and ${this.scheduler.limit}`,
        );
      const mode = args['delivery_mode'] ?? 'code';
      if (mode !== 'code' && mode !== 'documentation')
        throw new CrewError('INVALID_INPUT', 'Unknown delivery mode');
      if (
        args['chief_model'] !== undefined &&
        args['chief_model'] !== null &&
        typeof args['chief_model'] !== 'string'
      )
        throw new CrewError('INVALID_INPUT', 'Invalid chief model');
      const timestamp = now(),
        run: Run = {
          id: ident('run'),
          project_id: this.store.project.id,
          objective: text(args['objective'], 'objective'),
          constraints: strings(args['constraints'] ?? [], 'constraints'),
          acceptance_criteria: criteria.map((description, index) => ({
            id: `criterion:${index + 1}`,
            description,
            required: true,
            verification: 'independent review and observed checks',
          })),
          delivery_mode: mode,
          status: 'planning',
          chief_provider: provider,
          chief_model: (args['chief_model'] ??
            this.store.project.config.orchestrator.model) as string | null,
          generation: 1,
          version: 0,
          max_active_agents: Number(maximum),
          created_at: timestamp,
          updated_at: timestamp,
        };
      const project = await inspectProject(this.store.project.root);
      if (
        mode === 'code' &&
        !project.git.revision &&
        args['initialize_git'] !== true
      )
        throw new CrewError(
          'GIT_INITIALIZATION_REQUIRED',
          'Code mode requires a Git baseline; authorize --init-git or use documentation mode',
        );
      this.store.createRun(run, ident('create-run'));
      const user = serviceActor(this.store, run.id);
      if (mode === 'code' && !project.git.revision)
        await new WorkspaceManager(this.store, user).initializeRepository(
          { authorized: true, createEmptyBaseline: true },
          requestId(run.id, 'initialize'),
        );
      this.store.updateRunStatus(
        user,
        'running',
        requestId(run.id, 'start'),
        this.version(run.id),
      );
      this.wake(run.id);
      return this.store.getRun(run.id);
    }
    if (request.method === 'shutdown') {
      setImmediate(() => {
        void this.shutdown();
      });
      return { status: 'stopping' };
    }
    const runId =
      typeof args['run_id'] === 'string'
        ? args['run_id']
        : this.store.listRuns(1)[0]?.id;
    if (!runId)
      return {
        project: this.store.project,
        run: null,
        tasks: [],
        events: [],
        next_seq: 0,
        sessions: [],
        questions: [],
        activity: this.scheduler.snapshot(),
        verifications: [],
        contexts: [],
        decisions: [],
        blockers: [],
      };
    const run = this.store.getRun(runId),
      user = serviceActor(this.store, runId);
    if (
      this.suspending.has(runId) &&
      ['pause', 'stop', 'resume', 'replace_chief', 'reassign'].includes(
        request.method,
      )
    )
      throw new CrewError(
        'CONTROL_IN_PROGRESS',
        'A control operation is still observing stopped turns; retry when it settles',
      );
    switch (request.method) {
      case 'status': {
        const after = Number(args['after_seq'] ?? 0),
          limit = Number(args['limit'] ?? 100);
        const page = eventPage(this.store, runId, after, limit, EVENT_CHARS);
        const contexts = this.store.records<ContextBundle>(runId, 'context');
        return {
          project: this.store.project,
          run,
          tasks: this.store.tasks(runId).slice(0, limit),
          ...page,
          sessions: this.store.records(runId, 'session').slice(-limit),
          questions: this.store.records(runId, 'question').slice(-limit),
          activity: this.scheduler.snapshot(),
          verifications: this.store
            .records(runId, 'verification')
            .slice(-limit),
          contexts: contexts
            .slice(-20)
            .map(
              ({
                id,
                subject_id,
                subject_kind,
                version,
                budget,
                content_sha256,
                created_at,
              }) => ({
                id,
                subject_id,
                subject_kind,
                version,
                budget,
                content_sha256,
                created_at,
              }),
            ),
          context_count: contexts.length,
          decisions: this.store.records(runId, 'decision').slice(-limit),
          blockers: this.store.records(runId, 'blocker').slice(-limit),
        };
      }
      case 'answer': {
        const response = this.store.respondQuestion(
          user,
          text(args['question_id'], 'question_id'),
          text(args['answer'], 'answer'),
          ident('answer'),
          this.version(runId),
        );
        if (
          run.status === 'waiting_user' &&
          !this.store
            .records<CoordinationQuestion>(runId, 'question')
            .some((question) => question.blocking && question.status === 'open')
        )
          this.store.updateRunStatus(
            user,
            'running',
            ident('answer-resume'),
            this.version(runId),
          );
        this.wake(runId);
        return response;
      }
      case 'pause':
      case 'stop': {
        this.suspending.add(runId);
        try {
          this.scheduler.cancelQueued(runId);
          for (const task of this.store.tasks(runId))
            this.workerQueued.delete(task.id);
          this.chiefQueued.delete(runId);
          this.chiefNeeded.delete(runId);
          await this.interrupt(runId);
          return this.store.updateRunStatus(
            user,
            request.method === 'pause' ? 'paused' : 'cancelled',
            ident(request.method),
            this.version(runId),
          );
        } finally {
          this.suspending.delete(runId);
        }
      }
      case 'resume': {
        if (terminal(run))
          throw new CrewError('TERMINAL_RUN', 'A terminal run cannot resume');
        await this.reconcile(runId);
        if (run.status !== 'running')
          this.store.updateRunStatus(
            user,
            'running',
            ident('resume'),
            this.version(runId),
          );
        for (const task of this.store.tasks(runId)) {
          if (
            !task.active_attempt_id ||
            !['waiting_provider', 'blocked', 'ready'].includes(task.status)
          )
            continue;
          const attempt = this.store.getAttempt(task.active_attempt_id);
          if (!['exited', 'interrupted'].includes(attempt.status)) continue;
          const session = this.store.getRecord<AgentSession>(
            runId,
            'session',
            attempt.session_id,
          );
          this.store.delegateTask(
            user,
            {
              task_id: task.id,
              provider: session.provider,
              model: session.model,
            },
            ident('resume-task'),
            this.version(runId),
          );
        }
        this.wake(runId);
        return this.store.getRun(runId);
      }
      case 'replace_chief': {
        const provider = args['provider'];
        validate('ProviderId', provider);
        if (!this.providers.has(provider))
          throw new CrewError('PROVIDER_UNAVAILABLE', 'Provider unavailable');
        await this.interrupt(runId, 'chief');
        await this.reconcile(runId, true);
        const changed = this.store.replaceChief(
          user,
          provider,
          typeof args['model'] === 'string' ? args['model'] : null,
          ident('replace-chief'),
          this.version(runId),
        );
        this.wake(runId);
        return changed;
      }
      case 'reassign': {
        const taskId = text(args['task_id'], 'task_id');
        await this.interrupt(runId, undefined, taskId);
        return this.store.reassignTask(
          user,
          taskId,
          ident('reassign'),
          this.version(runId),
        );
      }
      case 'inspect_context': {
        const subject =
          typeof args['subject_id'] === 'string'
            ? args['subject_id']
            : `control:${runId}`;
        const context = this.store
          .records<ContextBundle>(runId, 'context')
          .filter((item) => item.subject_id === subject)
          .at(-1);
        if (!context)
          throw new CrewError(
            'NOT_FOUND',
            'No compiled context for this subject',
          );
        let after = 0;
        let event;
        while (!event) {
          const page = this.store.events(runId, after, 200);
          event = page.find(
            (item) =>
              item.type === 'context.compiled' &&
              (item.payload as Record<string, unknown>)['context_id'] ===
                context.id,
          );
          if (page.length < 200) break;
          after = page.at(-1)!.seq;
        }
        const references = event?.payload as
          | {
              prompt?: { reference: string; revision: string };
              inspection?: { reference: string; revision: string };
            }
          | undefined;
        let prompt: string | null = null,
          inspection: unknown = null;
        if (references?.prompt && references.inspection) {
          if (references.prompt.revision !== `sha256:${context.content_sha256}`)
            throw new CrewError(
              'CONTEXT_CHANGED',
              'Stored prompt does not match its compiled context',
            );
          prompt = this.store.readArtifact(references.prompt).toString('utf8');
          inspection = JSON.parse(
            this.store.readArtifact(references.inspection).toString('utf8'),
          ) as unknown;
        }
        return {
          context,
          references: event?.payload ?? null,
          prompt,
          inspection,
        };
      }
      case 'export':
        return args['format'] === 'markdown'
          ? this.store.exportMarkdown(runId)
          : {
              schema_version: 1,
              project: this.store.project,
              run,
              tasks: this.store.tasks(runId),
              attempts: this.store.attempts(runId),
              decisions: this.store.records(runId, 'decision'),
              handoffs: this.store.records(runId, 'handoff'),
              reviews: this.store.records(runId, 'review'),
              verifications: this.store.records(runId, 'verification'),
              acceptances: this.store.records(runId, 'acceptance'),
              questions: this.store.records(runId, 'question'),
              // Continue with after_seq = next_seq while has_more; `export` in the CLI does it.
              ...eventPage(
                this.store,
                runId,
                Number(args['after_seq'] ?? 0),
                200,
                EVENT_CHARS,
              ),
              event_page_size: 200,
            };
      default:
        throw new CrewError('UNKNOWN_METHOD', 'Unknown administrative action');
    }
  }

  private async interrupt(
    runId: string,
    role?: ActiveTurn['role'],
    taskId?: string,
  ): Promise<void> {
    const fences = taskId
      ? [runId + ':' + taskId]
      : role === 'chief'
        ? [runId + ':chief']
        : [
            runId + ':chief',
            ...this.store.tasks(runId).map((task) => runId + ':' + task.id),
          ];
    for (const fence of fences)
      this.cancellation.set(fence, (this.cancellation.get(fence) ?? 0) + 1);
    const turns = [...this.active.values()].filter(
      (turn) =>
        turn.run_id === runId &&
        (!role || turn.role === role) &&
        (!taskId || turn.actor.task_id === taskId),
    );
    await Promise.all(
      turns.map(async (turn) => {
        await turn.process.interrupt();
        await turn.process.result;
      }),
    );
    for (
      let index = 0;
      index < 100 &&
      [...this.active.values()].some((turn) => turns.includes(turn));
      index++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    if ([...this.active.values()].some((turn) => turns.includes(turn)))
      throw new CrewError(
        'RECONCILIATION_REQUIRED',
        'Turn exit is not yet observed',
      );
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const run of this.store.listRuns())
      this.scheduler.cancelQueued(run.id);
    await Promise.all(
      this.store.listRuns().map((run) => this.interrupt(run.id)),
    );
    await this.scheduler.close();
  }
}
