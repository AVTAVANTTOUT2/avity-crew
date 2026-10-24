import { readFileSync } from 'node:fs';

export function scheduleFeatures() {
  const names = ['a', 'b'];
  const enabled = names.filter(
    (name) => JSON.parse(readFileSync(`features/${name}.json`, 'utf8')).enabled,
  );
  const policy = JSON.parse(readFileSync('policy.json', 'utf8'));
  const batches =
    policy.mode === 'serial' ? enabled.map((name) => [name]) : [enabled];
  return {
    enabled,
    batches,
    peak: Math.max(0, ...batches.map((batch) => batch.length)),
  };
}
