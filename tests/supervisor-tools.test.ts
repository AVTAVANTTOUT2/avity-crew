import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  assertToolAuthority,
  toolsFor,
} from '../packages/supervisor/src/tools.ts';
import type { Actor, ToolCall } from '../packages/contracts/src/index.ts';

const actor: Actor = {
  id: 'session:a',
  project_id: 'project:a',
  run_id: 'run:a',
  role: 'developer',
  task_id: 'task:a',
  attempt_id: 'attempt:a',
  generation: 1,
};
test('each role gets independently valid bounded tool schemas and cannot forge chief authority', () => {
  const ajv = new Ajv2020({ strict: true });
  addFormats.default(ajv);
  for (const role of ['chief', 'developer', 'reviewer'] as const) {
    const principal = { kind: 'agent' as const, actor: { ...actor, role } };
    const tools = toolsFor(principal);
    for (const tool of tools) {
      ajv.compile(tool.inputSchema);
      assert.ok(!JSON.stringify(tool.inputSchema).includes('$ref'));
      assert.ok(JSON.stringify(tool.inputSchema).length < 20000);
    }
    assert.equal(
      tools.some((tool) => tool.name === 'create_task'),
      role === 'chief',
    );
    assert.equal(
      tools.some((tool) => tool.name === 'submit_review'),
      role === 'reviewer',
    );
  }
  const call: ToolCall = {
    schema_version: 1,
    request_id: 'request:a',
    idempotency_key: 'key:a',
    run_id: 'run:b',
    expected_version: 0,
    method: 'get_status',
    arguments: { after_seq: 0, limit: 1, task_id: null },
  };
  assert.throws(() => assertToolAuthority({ kind: 'agent', actor }, call), {
    code: 'FORBIDDEN',
  });
});
