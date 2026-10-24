import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { CrewError, now, validate } from '../../contracts/src/index.ts';
import type {
  Actor,
  ArtifactRef,
  ContextBundle,
  Decision,
  Handoff,
  Message,
  Operation,
  SourceRef,
  TaskSpec,
  ToolCall,
  UserResponse,
  Verification,
} from '../../contracts/src/index.ts';
import {
  inspectProject,
  pathInScope,
  redactContext,
} from '../../context/src/index.ts';
import { Store } from '../../storage/src/index.ts';
import { WorkspaceManager } from '../../workspace/src/index.ts';
import type {
  Delivery,
  IntegrationCandidate,
  WorkspaceHandle,
} from '../../workspace/src/index.ts';
import type { Principal } from './capabilities.ts';
import type {
  AdminRequest,
  SupervisorApi,
  ToolDescriptor,
} from './protocol.ts';
import { assertToolAuthority, toolsFor } from './tools.ts';

export const requestId = (key: string, prefix: string): string =>
  `${prefix}:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
export function nonempty<T>(values: readonly T[]): [T, ...T[]] {
  if (!values.length)
    throw new CrewError('INVALID_EVIDENCE', 'Required evidence list is empty');
  return [values[0]!, ...values.slice(1)];
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
};
export function serviceActor(store: Store, runId: string): Actor {
  const run = store.getRun(runId);
  return {
    id: 'user:local',
    project_id: store.project.id,
    run_id: runId,
    role: 'user',
    task_id: null,
    attempt_id: null,
    generation: run.generation,
  };
}
export interface RuntimeControl {
  wake(runId: string, notifyChief?: boolean): void;
  admin(request: AdminRequest): Promise<unknown>;
}

/** Domain actions are shared by HTTP, MCP and the internal CLI. */
export class Coordinator implements SupervisorApi {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly store: Store,
    private readonly runtime: RuntimeControl,
  ) {}

  tools(principal: Principal, runId: string): ToolDescriptor[] {
    this.identity(principal, runId);
    return toolsFor(principal);
  }

  private identity(principal: Principal, runId: string): Actor {
    if (principal.kind === 'user') {
      if (principal.project_id !== this.store.project.id)
        throw new CrewError('FORBIDDEN', 'Another project');
      return serviceActor(this.store, runId);
    }
    if (
      principal.actor.project_id !== this.store.project.id ||
      principal.actor.run_id !== runId
    )
      throw new CrewError('FORBIDDEN', 'Another project or run');
    return principal.actor;
  }

  async execute(principal: Principal, call: ToolCall): Promise<unknown> {
    validate('ToolCall', call);
    assertToolAuthority(principal, call);
    const actor = this.identity(principal, call.run_id);
    const read = async () => {
      const result = await this.dispatch(actor, call);
      return { result, run_version: this.store.getRun(call.run_id).version };
    };
    if (
      [
        'get_status',
        'read_context',
        'inspect_project',
        'collect_delivery',
      ].includes(call.method)
    )
      return read();
    const pending = this.tail.then(async () => {
      const user = serviceActor(this.store, call.run_id),
        key = requestId(call.idempotency_key, 'tool');
      const previous = this.store
        .records<Operation>(call.run_id, 'operation')
        .find((operation) => operation.idempotency_key === key);
      if (
        !previous &&
        this.store.getRun(call.run_id).version !== call.expected_version
      )
        throw new CrewError(
          'VERSION_CONFLICT',
          `Current run version is ${this.store.getRun(call.run_id).version}`,
        );
      const receipt = this.store.beginOperation(
        user,
        'tool.' + call.method,
        canonical({ actor, method: call.method, arguments: call.arguments }),
        key,
        this.store.getRun(call.run_id).version,
      );
      const current = this.store.getRecord<Operation>(
        call.run_id,
        'operation',
        receipt.id,
      );
      if (current.status === 'completed')
        return {
          result: current.result,
          run_version: this.store.getRun(call.run_id).version,
        };
      try {
        const result = await this.dispatch(actor, {
          ...call,
          expected_version: this.store.getRun(call.run_id).version,
        });
        this.store.observeOperation(
          user,
          receipt.id,
          'completed',
          result,
          requestId(key, 'done'),
          this.store.getRun(call.run_id).version,
        );
        return { result, run_version: this.store.getRun(call.run_id).version };
      } catch (error) {
        this.store.observation(user, 'tool.failed', {
          operation_id: receipt.id,
          method: call.method,
          code: error instanceof CrewError ? error.code : 'INTERNAL_ERROR',
        });
        throw error;
      }
    });
    this.tail = pending.catch(() => {});
    return pending;
  }

  async admin(principal: Principal, request: AdminRequest): Promise<unknown> {
    if (
      principal.kind !== 'user' ||
      principal.project_id !== this.store.project.id
    )
      throw new CrewError(
        'FORBIDDEN',
        'User control requires the owner capability',
      );
    return this.runtime.admin(request);
  }

  private currentTask(
    actor: Actor,
    taskId: string,
    allowReviewer = false,
  ): void {
    const task = this.store.getTask(taskId);
    if (
      task.run_id !== actor.run_id ||
      (!['user', 'chief'].includes(actor.role) &&
        actor.task_id !== taskId &&
        !(allowReviewer && actor.role === 'reviewer'))
    )
      throw new CrewError('FORBIDDEN', 'Task is outside the assigned mission');
  }

  private sources(actor: Actor, ids: readonly string[]): void {
    for (const id of ids)
      this.store.getRecord<SourceRef>(actor.run_id, 'source', id);
  }

  private status(
    actor: Actor,
    args: Extract<ToolCall, { method: 'get_status' }>['arguments'],
  ): unknown {
    const all = ['user', 'chief'].includes(actor.role);
    if (args.task_id) this.currentTask(actor, args.task_id, true);
    const tasks = this.store
      .tasks(actor.run_id)
      .filter((task) =>
        args.task_id
          ? task.id === args.task_id
          : all || task.id === actor.task_id,
      );
    const page = this.store.events(actor.run_id, args.after_seq, args.limit);
    const events = all
      ? page
      : page.filter(
          (event) =>
            event.task_id === actor.task_id || event.actor_id === actor.id,
        );
    const messages = this.store
      .records<Message>(actor.run_id, 'message')
      .filter(
        (message) =>
          all ||
          message.sender_id === actor.id ||
          (message.recipient_kind === 'task' &&
            message.recipient_id === actor.task_id),
      );
    return {
      run: this.store.getRun(actor.run_id),
      tasks: tasks.slice(0, args.limit),
      task_count: tasks.length,
      events,
      next_seq: page.at(-1)?.seq ?? args.after_seq,
      messages: messages.slice(-args.limit),
      questions: all
        ? this.store.records(actor.run_id, 'question').slice(-args.limit)
        : [],
      user_responses: all
        ? this.store.records(actor.run_id, 'user_response').slice(-args.limit)
        : [],
      delegations: all
        ? this.store.records(actor.run_id, 'delegation').slice(-args.limit)
        : [],
      verifications: all
        ? this.store.records(actor.run_id, 'verification').slice(-args.limit)
        : [],
    };
  }

  private async dispatch(actor: Actor, call: ToolCall): Promise<unknown> {
    const key = call.idempotency_key,
      version = call.expected_version;
    const run = this.store.getRun(call.run_id);
    switch (call.method) {
      case 'get_status':
        return this.status(actor, call.arguments);
      case 'inspect_project': {
        const project = await inspectProject(this.store.project.root);
        const scope = actor.task_id
          ? this.store.getTask(actor.task_id).spec.scope
          : {
              read_paths: ['**'],
              excluded_paths: this.store.project.config.context.exclude_paths,
            };
        const files = project.files.filter(
          (path) =>
            pathInScope(path, scope.read_paths) &&
            !pathInScope(path, scope.excluded_paths) &&
            pathInScope(path, call.arguments.focus),
        );
        return {
          root: project.root,
          git: project.git,
          files: files.slice(0, 200),
          file_count: files.length,
          sources: project.sources
            .filter((item) => files.includes(item.source.reference))
            .map((item) => item.source),
          warnings: project.warnings,
          exclusions: project.exclusions.slice(0, 100),
        };
      }
      case 'create_task': {
        const input = call.arguments.task;
        for (const path of [
          ...input.scope.read_paths,
          ...input.scope.write_paths,
          ...input.scope.excluded_paths,
        ])
          if (
            isAbsolute(path) ||
            path.includes('\\') ||
            path.split('/').includes('..') ||
            /^[A-Za-z]:/.test(path)
          )
            throw new CrewError(
              'INVALID_SCOPE',
              'Mission paths must stay relative to the project',
            );
        const task: TaskSpec = {
          ...input,
          scope: {
            ...input.scope,
            excluded_paths: [
              ...new Set([
                ...input.scope.excluded_paths,
                ...this.store.project.config.context.exclude_paths,
              ]),
            ],
          },
        };
        return this.store.createTask(actor, task, key, version);
      }
      case 'delegate_task': {
        const delegated = this.store.delegateTask(
          actor,
          call.arguments,
          key,
          version,
        );
        this.runtime.wake(run.id, false);
        return delegated;
      }
      case 'send_message': {
        this.sources(actor, call.arguments.source_ids);
        if (call.arguments.recipient_kind === 'task')
          this.currentTask(actor, call.arguments.recipient_id, true);
        if (
          !['user', 'chief'].includes(actor.role) &&
          call.arguments.recipient_kind === 'user'
        )
          throw new CrewError(
            'FORBIDDEN',
            'Workers address questions to their chief',
          );
        const message: Message = {
          id: requestId(key, 'message'),
          run_id: run.id,
          sender_id: actor.id,
          recipient_kind: call.arguments.recipient_kind,
          recipient_id: call.arguments.recipient_id,
          kind: call.arguments.kind,
          content: redactContext(call.arguments.content),
          source_ids: call.arguments.source_ids,
          status: 'queued',
          created_at: now(),
        };
        // The persisted request fingerprint must be identical on a transport retry.
        const existing = this.store
          .records<Message>(run.id, 'message')
          .find((item) => item.id === message.id);
        if (existing) message.created_at = existing.created_at;
        const result = this.store.sendMessage(actor, message, key, version);
        this.runtime.wake(run.id);
        return result;
      }
      case 'publish_note':
        this.sources(actor, call.arguments.source_ids);
        return this.store.publishNote(actor, call.arguments, key, version);
      case 'report_blocker': {
        this.sources(actor, call.arguments.source_ids);
        const blocker = this.store.reportBlocker(
          actor,
          call.arguments,
          key,
          version,
        );
        this.runtime.wake(run.id);
        return blocker;
      }
      case 'request_user_input':
        return this.store.requestQuestion(actor, call.arguments, key, version);
      case 'record_decision': {
        this.sources(actor, call.arguments.source_ids);
        const args = call.arguments;
        const existing = this.store
          .records<Decision>(run.id, 'decision')
          .find((item) => item.id === args.decision_id);
        const decision: Decision = {
          schema_version: 1,
          id: args.decision_id,
          run_id: run.id,
          question: args.question,
          answer: args.answer,
          status: args.requested_status,
          approved_by:
            args.requested_status !== 'approved'
              ? null
              : args.basis === 'user_response' && args.user_response_id
                ? this.store.getRecord<UserResponse>(
                    run.id,
                    'user_response',
                    args.user_response_id,
                  ).user_actor_id
                : actor.id,
          source_ids: args.source_ids,
          affects_task_ids: args.affects_task_ids,
          supersedes: args.supersedes,
          created_at: existing?.created_at ?? now(),
        };
        return this.store.recordDecision(actor, decision, key, version, {
          basis: args.basis,
          user_response_id: args.user_response_id,
        });
      }
      case 'read_context': {
        if (
          !['user', 'chief'].includes(actor.role) &&
          call.arguments.subject_id !== actor.task_id
        )
          throw new CrewError(
            'FORBIDDEN',
            'Context belongs to another mission',
          );
        const contexts = this.store
          .records<ContextBundle>(run.id, 'context')
          .filter(
            (bundle) =>
              bundle.subject_id === call.arguments.subject_id &&
              bundle.version > call.arguments.after_version,
          );
        const latest = contexts.at(-1);
        const sources = latest?.sources.map((source) => source.id) ?? [];
        for (const id of call.arguments.source_ids)
          if (!sources.includes(id))
            throw new CrewError(
              'FORBIDDEN',
              'Source was not assigned to this context',
            );
        return {
          context: latest ?? null,
          sources: call.arguments.source_ids.map((id) =>
            this.store.getRecord<SourceRef>(run.id, 'source', id),
          ),
        };
      }
      case 'collect_delivery': {
        this.currentTask(actor, call.arguments.task_id, true);
        const handoffs = this.store
          .records<Handoff>(run.id, 'handoff')
          .filter((item) => item.task_id === call.arguments.task_id);
        const handoff = call.arguments.handoff_id
          ? handoffs.find((item) => item.id === call.arguments.handoff_id)
          : handoffs.at(-1);
        if (!handoff)
          throw new CrewError('NOT_FOUND', 'Delivery has not been submitted');
        return {
          handoff,
          verifications: this.store
            .records<Verification>(run.id, 'verification')
            .filter((proof) =>
              proof.evidence_artifact_ids.some((id) => {
                try {
                  return (
                    this.store.getRecord<ArtifactRef>(run.id, 'artifact', id)
                      .producer_attempt_id === handoff.attempt_id
                  );
                } catch {
                  return false;
                }
              }),
            ),
          reviews: this.store
            .records(run.id, 'review')
            .filter(
              (item) =>
                (item as { handoff_id: string }).handoff_id === handoff.id,
            ),
          evidence: handoff.artifacts
            .filter((artifact) => artifact.revision.startsWith('sha256:'))
            .slice(0, 20)
            .map((artifact) => {
              const bytes = this.store.readArtifact(artifact);
              return {
                ...artifact,
                content_excerpt: bytes.subarray(0, 8192).toString('utf8'),
                truncated: bytes.length > 8192,
              };
            }),
        };
      }
      case 'submit_handoff':
        return this.captureHandoff(
          actor,
          call.arguments.handoff,
          key,
          version,
          call.arguments.document_paths,
        );
      case 'submit_review': {
        const review = this.store.submitReview(
          actor,
          call.arguments.review,
          key,
          version,
        );
        this.runtime.wake(run.id);
        return review;
      }
      case 'propose_integration':
        return this.integrate(actor, call);
      case 'accept_delivery': {
        const handoff = this.store.getRecord<Handoff>(
          run.id,
          'handoff',
          call.arguments.handoff_id,
        );
        if (this.store.getTask(handoff.task_id).status !== 'accepted') {
          this.store.validateDelivery(actor, call.arguments);
          if (run.delivery_mode === 'code') {
            const candidate = this.store
              .records<Operation>(run.id, 'operation')
              .find(
                (operation) =>
                  operation.kind === 'integration.prepare' &&
                  operation.status === 'completed' &&
                  (operation.result as IntegrationCandidate)
                    .candidateRevision === call.arguments.accepted_revision,
              );
            if (!candidate)
              throw new CrewError(
                'INVALID_EVIDENCE',
                'Exact validated candidate is missing',
              );
            await new WorkspaceManager(
              this.store,
              serviceActor(this.store, run.id),
            ).promoteIntegration(
              candidate.id,
              requestId(candidate.id, 'promote'),
            );
          }
        }
        const result = this.store.acceptDelivery(
          actor,
          call.arguments,
          key,
          this.store.getRun(run.id).version,
        );
        this.runtime.wake(run.id, false);
        return result;
      }
      case 'finish_run':
        return this.store.finishRun(actor, call.arguments, key, version);
    }
  }

  private async captureHandoff(
    actor: Actor,
    input: Handoff,
    key: string,
    version: number,
    documentPaths?: readonly string[],
  ): Promise<Handoff> {
    if (
      !actor.task_id ||
      !actor.attempt_id ||
      input.task_id !== actor.task_id ||
      input.attempt_id !== actor.attempt_id ||
      input.run_id !== actor.run_id
    )
      throw new CrewError(
        'FORBIDDEN',
        'Handoff must belong to the authenticated attempt',
      );
    const previous = this.store
      .records<Handoff>(actor.run_id, 'handoff')
      .find((item) => item.id === input.id);
    if (previous)
      return this.store.submitHandoff(actor, previous, key, version);
    if (this.store.getRun(actor.run_id).version !== version)
      throw new CrewError(
        'VERSION_CONFLICT',
        'Refresh run status before capturing a delivery',
      );
    const operation = this.store
      .records<Operation>(actor.run_id, 'operation')
      .find(
        (item) =>
          item.kind === 'workspace.create' &&
          item.status === 'completed' &&
          (item.result as WorkspaceHandle).attemptId === actor.attempt_id,
      );
    if (!operation)
      throw new CrewError(
        'WORKSPACE_REQUIRED',
        'No observed workspace belongs to this attempt',
      );
    const task = this.store.getTask(actor.task_id);
    const manager = new WorkspaceManager(
      this.store,
      serviceActor(this.store, actor.run_id),
    );
    const delivery = await manager.collectDelivery(
      operation.id,
      {
        writePaths: task.spec.scope.write_paths,
        excludedPaths: task.spec.scope.excluded_paths,
        documentPaths:
          documentPaths ??
          input.artifacts
            .filter((item) => item.kind === 'file')
            .map((item) => item.reference),
      },
      requestId(key, 'capture'),
    );
    const created_at = input.created_at;
    const artifact = (
      id: string,
      kind: ArtifactRef['kind'],
      reference: string,
      revision: string,
    ): ArtifactRef => ({
      id: requestId(key + id, 'artifact'),
      kind,
      reference,
      revision,
      producer_attempt_id: actor.attempt_id!,
      created_at,
    });
    const artifacts =
      delivery.mode === 'code'
        ? [
            artifact(
              'git',
              'git_commit',
              delivery.preservationRef!,
              delivery.sourceRevision,
            ),
          ]
        : delivery.documents.map((document) =>
            artifact(
              document.path,
              'file',
              document.reference,
              document.revision,
            ),
          );
    const report = this.store.writeArtifact(
      delivery.mode === 'documentation'
        ? JSON.stringify(delivery.documents)
        : JSON.stringify({ declared_handoff: input, delivery }),
    );
    artifacts.push(
      artifact('report', 'report', report.reference, report.revision),
    );
    const handoff: Handoff = {
      ...input,
      generation: actor.generation,
      source_revision: delivery.sourceRevision,
      artifacts,
      verifications: [],
    };
    return this.store.submitHandoff(
      actor,
      handoff,
      key,
      this.store.getRun(actor.run_id).version,
    );
  }

  private async integrate(
    actor: Actor,
    call: Extract<ToolCall, { method: 'propose_integration' }>,
  ): Promise<IntegrationCandidate> {
    const { arguments: args, idempotency_key: key } = call;
    const manager = new WorkspaceManager(
      this.store,
      serviceActor(this.store, actor.run_id),
    );
    const handoffs = args.handoff_ids.map((id) =>
      this.store.getRecord<Handoff>(actor.run_id, 'handoff', id),
    );
    const operations = this.store.records<Operation>(actor.run_id, 'operation');
    const deliveries = handoffs.map((handoff) => {
      const result = operations.find(
        (operation) =>
          operation.kind === 'workspace.collect' &&
          operation.status === 'completed' &&
          (operation.result as Delivery).sourceRevision ===
            handoff.source_revision &&
          (
            operations.find(
              (workspace) =>
                workspace.id ===
                (operation.result as Delivery).workspaceOperationId,
            )?.result as WorkspaceHandle
          )?.attemptId === handoff.attempt_id,
      );
      if (!result)
        throw new CrewError(
          'INVALID_EVIDENCE',
          'Delivery has no observed immutable snapshot',
        );
      return result.id;
    });
    const configured = this.store.project.config.verification_commands;
    const checks = args.required_check_ids.map((id) => {
      const check = configured.find((item) => item.id === id);
      if (id === 'check:git-diff')
        return {
          id,
          command: [
            'git',
            'diff',
            '--check',
            `${args.expected_target_revision.slice(4)}..HEAD`,
          ],
        };
      if (!check || check.cwd !== '.')
        throw new CrewError(
          'UNKNOWN_CHECK',
          'Checks must be configured with cwd . for the candidate',
        );
      return {
        id,
        command: check.argv,
        timeoutMs: check.timeout_seconds * 1000,
      };
    });
    const candidate = await manager.prepareIntegration(
      {
        targetRef: args.target_ref,
        expectedBase: args.expected_target_revision,
        deliveryOperationIds: deliveries,
        checks,
      },
      key,
    );
    if (candidate.status === 'validated') {
      for (const handoff of handoffs)
        for (const proof of candidate.proofs) {
          const id = requestId(key + handoff.id + proof.id, 'verification');
          if (
            this.store
              .records<Verification>(actor.run_id, 'verification')
              .some((item) => item.id === id)
          )
            continue;
          const verification: Verification = {
            id,
            criterion_ids: nonempty(
              this.store
                .getTask(handoff.task_id)
                .spec.acceptance_criteria.map((item) => item.id),
            ),
            mode: 'static',
            execution: 'automated',
            command: nonempty(proof.command),
            cwd: proof.cwd,
            result: proof.exitCode === 0 ? 'passed' : 'failed',
            exit_code: proof.exitCode,
            tested_revision: candidate.candidateRevision,
            evidence_artifact_ids: handoff.artifacts.map((item) => item.id),
            started_at: proof.startedAt,
            ended_at: proof.endedAt,
            provider: null,
          };
          const log = this.store.writeArtifact(proof.output, true);
          const artifact: ArtifactRef = {
            id: requestId(id, 'artifact'),
            kind: 'test_log',
            ...log,
            producer_attempt_id: handoff.attempt_id,
            created_at: proof.endedAt,
          };
          verification.evidence_artifact_ids = [artifact.id];
          this.store.saveVerification(
            serviceActor(this.store, actor.run_id),
            handoff.task_id,
            verification,
            requestId(id, 'save'),
            this.store.getRun(actor.run_id).version,
            [artifact],
          );
        }
    }
    return candidate;
  }
}
