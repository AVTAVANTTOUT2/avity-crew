import assert from 'node:assert/strict';
import { scheduleFeatures } from './app.mjs';

const plan = scheduleFeatures();
const feature = process.argv
  .find((argument) => argument.startsWith('--feature='))
  ?.slice('--feature='.length);
assert.deepEqual(
  plan.enabled,
  feature ? [feature] : ['a', 'b'],
  'Every requested feature must stay enabled',
);
assert.deepEqual(
  plan.batches.flat().sort(),
  plan.enabled,
  'Each enabled feature must execute exactly once',
);
assert.ok(plan.peak <= 1, `Combined capacity exceeded: ${plan.peak} > 1`);
console.log(JSON.stringify(plan));
