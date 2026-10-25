import { randomUUID } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { runtimeSchema } from './generated/runtime-schema.ts';
import { projectSchema } from './generated/project-schema.ts';
import type { ProjectConfig } from './generated/project-config.ts';
import { contractDefinitions } from './generated/contract-map.ts';
import type { ContractMap } from './generated/contract-map.ts';
import type {
  TaskSpec,
  Handoff,
  ProviderCapabilities,
  ProviderId,
  RunStatus,
  TaskStatus,
  Criterion,
  CrewEvent,
  DelegateTaskArgs,
  PublishNoteArgs,
  ReportBlockerArgs,
  RequestUserInputArgs,
} from './generated/runtime.ts';

export * from './generated/runtime.ts';
export * from './generated/project-config.ts';
export { runtimeSchema, projectSchema };
export const PROTOCOL_VERSION = 1;
export const now = (): string => new Date().toISOString();
export const ident = (prefix: string): string => `${prefix}:${randomUUID()}`;

export class CrewError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'CrewError';
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: true,
});
addFormats.default(ajv);
ajv.addSchema(runtimeSchema);
ajv.addSchema(projectSchema);

export function validate<K extends keyof ContractMap>(
  definition: K,
  value: unknown,
): asserts value is ContractMap[K] {
  if (!contractDefinitions.includes(definition))
    throw new CrewError('UNKNOWN_SCHEMA', `Unknown contract: ${definition}`);
  const validator = ajv.getSchema(
    definition === 'ProjectConfig'
      ? projectSchema.$id
      : `${runtimeSchema.$id}#/$defs/${definition}`,
  );
  if (!validator)
    throw new CrewError('UNKNOWN_SCHEMA', `Unknown contract: ${definition}`);
  if (!validator(value))
    throw new CrewError(
      'INVALID_INPUT',
      `Invalid ${definition}`,
      validator.errors,
    );
}

export interface Project {
  id: string;
  root: string;
  git_common_dir: string | null;
  data_dir: string;
  config: ProjectConfig;
  map_version: number;
  created_at: string;
}

export interface Run {
  id: string;
  project_id: string;
  objective: string;
  constraints: string[];
  acceptance_criteria: Criterion[];
  delivery_mode: 'code' | 'documentation';
  status: RunStatus;
  chief_provider: ProviderId;
  chief_model: string | null;
  generation: number;
  version: number;
  max_active_agents: number;
  created_at: string;
  updated_at: string;
}

export interface TaskState {
  id: string;
  run_id: string;
  spec: TaskSpec;
  status: TaskStatus;
  version: number;
  generation: number;
  active_attempt_id: string | null;
  wait_reason: string | null;
  accepted_revision: string | null;
}

export interface Attempt {
  id: string;
  run_id: string;
  task_id: string;
  session_id: string;
  generation: number;
  status: 'queued' | 'running' | 'exited' | 'interrupted' | 'unknown';
  started_at: string;
  heartbeat_at: string;
  ended_at: string | null;
  exit_code: number | null;
  pid: number | null;
}

export interface AgentSession {
  id: string;
  run_id: string;
  task_id: string | null;
  provider: ProviderId;
  model: string | null;
  native_session_id: string | null;
  cli_version: string | null;
  cwd: string;
  capabilities: ProviderCapabilities | null;
}

export interface Message {
  id: string;
  run_id: string;
  sender_id: string;
  recipient_kind: 'task' | 'chief' | 'user';
  recipient_id: string;
  kind:
    'information' | 'decision_update' | 'question' | 'blocker' | 'correction';
  content: string;
  source_ids: string[];
  status: 'queued' | 'delivered' | 'acknowledged' | 'applied' | 'failed';
  created_at: string;
}

export interface Workspace {
  id: string;
  run_id: string;
  task_id: string;
  path: string;
  branch: string;
  base_revision: string;
  ports: number[];
  temporary_dir: string;
}

export interface Operation {
  id: string;
  run_id: string;
  idempotency_key: string;
  kind: string;
  target: string;
  status: 'intent' | 'running' | 'unknown' | 'completed' | 'failed';
  result: unknown;
  created_at: string;
}

export interface Actor {
  id: string;
  project_id: string;
  run_id: string;
  role: 'user' | 'chief' | TaskSpec['role'];
  task_id: string | null;
  attempt_id: string | null;
  generation: number;
}

export type Delegation = DelegateTaskArgs & {
  id: string;
  run_id: string;
  status: 'queued' | 'claimed';
  attempt_id: string | null;
  created_at: string;
};

export type TaskNote = PublishNoteArgs & {
  id: string;
  run_id: string;
  actor_id: string;
  created_at: string;
};

export type TaskBlocker = ReportBlockerArgs & {
  id: string;
  run_id: string;
  actor_id: string;
  created_at: string;
};

export interface CoordinationQuestion {
  id: string;
  run_id: string;
  question: string;
  options: RequestUserInputArgs['options'];
  affects_task_ids: string[];
  blocking: boolean;
  status: 'open' | 'answered';
  requested_by: string;
  response_id: string | null;
  created_at: string;
}

export interface UserResponse {
  id: string;
  run_id: string;
  question_id: string;
  answer: string;
  user_actor_id: string;
  source_id: string;
  created_at: string;
}

export interface DecisionProvenance {
  basis: 'technical_judgment' | 'user_response';
  user_response_id: string | null;
}

export interface DeliveryAcceptance {
  id: string;
  run_id: string;
  task_id: string;
  handoff_id: string;
  accepted_revision: string;
  review_ids: string[];
  verification_ids: string[];
  artifact_ids: string[];
  accepted_by: string;
  created_at: string;
}

export interface ProviderRequest {
  cwd: string;
  prompt: string;
  model: string | null;
  role: Actor['role'];
  permissions: {
    sandbox: 'read-only' | 'workspace-write';
    approval: 'never' | 'on-request';
  };
  bridge?: {
    command: string;
    args: string[];
    env: Record<string, string>;
    approved_tools?: string[];
  };
}

export interface ProviderEvent {
  type:
    | 'session'
    | 'text'
    | 'tool'
    | 'usage'
    | 'permission'
    | 'error'
    | 'unknown'
    | 'result';
  provenance: 'live' | 'simulated';
  native_session_id?: string;
  text?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
  error?: {
    kind:
      | 'quota'
      | 'permission'
      | 'authentication'
      | 'network'
      | 'process'
      | 'protocol';
    message: string;
  };
  success?: boolean;
}

export interface ProviderResult {
  provider: ProviderId;
  provenance: 'live' | 'simulated';
  native_session_id: string | null;
  exit_code: number | null;
  signal: string | null;
  success: boolean;
  text: string;
  error: ProviderEvent['error'] | null;
}

export interface ProviderProcess {
  pid: number | null;
  events: AsyncIterable<ProviderEvent>;
  result: Promise<ProviderResult>;
  send(update: string): Promise<'queued' | 'sent'>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  probe(): Promise<ProviderCapabilities>;
  start(request: ProviderRequest): ProviderProcess;
  resume(
    request: ProviderRequest & { native_session_id: string },
  ): ProviderProcess;
}

export interface StoragePort {
  getRun(id: string): Run;
  getTask(runId: string, id: string): TaskState;
  events(runId: string, afterSeq: number, limit: number): CrewEvent[];
  submitHandoff(actor: Actor, handoff: Handoff, key: string): Handoff;
}
