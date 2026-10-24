import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validate } from '../packages/contracts/src/index.ts';
import type { Handoff } from '../packages/contracts/src/index.ts';

const legacy = JSON.parse(
  readFileSync(
    new URL(
      '../../tests/fixtures/contracts/handoff.example.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Handoff;
const pendingCapture: Handoff = {
  ...legacy,
  status: 'delivered',
  summary:
    'The document is ready for service capture; no evidence is invented.',
  source_revision: null,
  artifacts: [],
  verifications: [],
  limitations: [],
  next_information: [],
};
const call = (args: unknown) => ({
  schema_version: 1,
  request_id: 'request:submit',
  idempotency_key: 'submit:document',
  run_id: pendingCapture.run_id,
  expected_version: 0,
  method: 'submit_handoff',
  arguments: args,
});

test('submit_handoff accepts paths for service capture without invented evidence and preserves legacy clients', () => {
  const args = { handoff: pendingCapture, document_paths: ['docs/recette.md'] };
  validate('ToolCall', call(args));
  assert.deepEqual(args.handoff.artifacts, []);
  assert.deepEqual(args.handoff.verifications, []);
  assert.equal(args.handoff.source_revision, null);
  validate('ToolCall', call({ handoff: legacy }));
  validate('Handoff', legacy);
});

test('submit_handoff paths use RelativePath and unknown input properties remain forbidden', () => {
  for (const document_paths of [
    null,
    'docs/recette.md',
    [],
    [null],
    [42],
    [''],
    ['/tmp/recette.md'],
    ['../recette.md'],
    ['docs/../recette.md'],
    ['C:/recette.md'],
    ['docs\\recette.md'],
    ['docs/a\nb.md'],
    ['docs/a\rb.md'],
    ['docs/a\0b.md'],
    ['a'.repeat(2049)],
  ])
    assert.throws(
      () =>
        validate('ToolCall', call({ handoff: pendingCapture, document_paths })),
      { code: 'INVALID_INPUT' },
    );
  assert.throws(
    () => validate('ToolCall', call({ document_paths: ['docs/recette.md'] })),
    { code: 'INVALID_INPUT' },
  );
  assert.throws(
    () =>
      validate(
        'ToolCall',
        call({
          handoff: pendingCapture,
          document_paths: ['docs/recette.md'],
          invented_hash: 'none',
        }),
      ),
    { code: 'INVALID_INPUT' },
  );
});

test('stored Handoff, ArtifactRef and Verification remain strict and require real revision shapes when supplied', () => {
  assert.throws(
    () =>
      validate('Handoff', {
        ...pendingCapture,
        document_paths: ['docs/recette.md'],
      }),
    { code: 'INVALID_INPUT' },
  );
  for (const revision of [null, '', 'unknown']) {
    assert.throws(
      () =>
        validate('Handoff', {
          ...legacy,
          artifacts: [{ ...legacy.artifacts[0], revision }],
        }),
      { code: 'INVALID_INPUT' },
    );
    assert.throws(
      () =>
        validate('Handoff', {
          ...legacy,
          verifications: [
            { ...legacy.verifications[0], tested_revision: revision },
          ],
        }),
      { code: 'INVALID_INPUT' },
    );
  }
  const { revision: _revision, ...unhashed } = legacy.artifacts[0]!;
  const { tested_revision: _tested, ...untested } = legacy.verifications[0]!;
  assert.throws(
    () => validate('Handoff', { ...legacy, artifacts: [unhashed] }),
    { code: 'INVALID_INPUT' },
  );
  assert.throws(
    () => validate('Handoff', { ...legacy, verifications: [untested] }),
    { code: 'INVALID_INPUT' },
  );
});
