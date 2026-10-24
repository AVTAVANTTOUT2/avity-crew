import type { ToolCall } from '../../contracts/src/index.ts';
import type { CapabilityRegistry, Principal } from './capabilities.ts';

export const LOCAL_PROTOCOL = 1;
export const MAX_JSON_BYTES = 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;

export interface ToolDescriptor {
  name: ToolCall['method'];
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
export interface AdminRequest {
  method: string;
  arguments: Record<string, unknown>;
}
export interface SupervisorApi {
  tools(principal: Principal, runId: string): ToolDescriptor[];
  execute(principal: Principal, call: ToolCall): Promise<unknown>;
  admin(principal: Principal, request: AdminRequest): Promise<unknown>;
}
export interface Endpoint {
  protocol: 1;
  project_id: string;
  pid: number;
  nonce: string;
  url: string;
}
export interface TransportOptions {
  directory: string;
  project_id: string;
  registry: CapabilityRegistry;
  api: SupervisorApi;
}
export interface TransportHandle {
  endpointFile: string;
  endpoint: Endpoint;
  close(): Promise<void>;
}
export interface ClientOptions {
  endpointFile: string;
  capability: string;
  timeout_ms?: number;
}
export type LocalResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
