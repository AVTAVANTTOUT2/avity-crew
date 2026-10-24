import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const [database, root, runId] = process.argv.slice(2);
assert.ok(database && root && runId, 'Expected database, project root and run ID');
const db = new DatabaseSync(database, { readOnly: true });
try {
  const records = (kind) => db.prepare('SELECT data FROM records WHERE run_id=? AND kind=?').all(runId, kind).map((r) => JSON.parse(r.data));
  const operations = records('operation').filter((o) => o.kind === 'integration.prepare').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const isolated = (id) => operations.find((o) => o.result?.status === 'validated' && o.result.proofs.some((p) => {
    try { const v = JSON.parse(p.output); return p.exitCode === 0 && v.check === 'isolated' && JSON.stringify(v.enabled) === JSON.stringify([id]); } catch { return false; }
  }));
  const isolatedA = isolated('a'), isolatedB = isolated('b');
  const failed = operations.find((o) => o.result?.status === 'validation_failed' && o.result.proofs.some((p) => p.id === 'combined' && p.exitCode === 1 && p.output.includes('2>1')));
  for (const op of [isolatedA, isolatedB]) assert.equal(op?.result.status, 'validated');
  assert.equal(failed?.result.status, 'validation_failed');
  assert.ok(isolatedA.created_at < failed.created_at && isolatedB.created_at < failed.created_at);
  const events = db.prepare('SELECT seq,data FROM events WHERE run_id=? ORDER BY seq').all(runId).map((r) => ({ ...JSON.parse(r.data), seq: r.seq }));
  const tasks = db.prepare('SELECT data FROM tasks WHERE run_id=?').all(runId).map((r) => JSON.parse(r.data));
  const task = tasks.find((t) => t.spec.role !== 'reviewer' && JSON.stringify(t.spec.scope.write_paths) === '["policy.json"]');
  assert.ok(task);
  const failedEnd = failed.result.proofs.find((p) => p.id === 'combined').endedAt;
  const decision = events.find((e) => e.type === 'decision.recorded' && e.occurred_at > failedEnd);
  const correction = events.find((e) => e.type === 'task.created' && e.task_id === task.id);
  assert.ok(decision && correction);
  assert.ok(failedEnd < decision.occurred_at && decision.seq < correction.seq);
  assert.ok(events.filter((e) => e.type === 'task.accepted').every((e) => e.seq > correction.seq));
  assert.equal(task.spec.base_revision, failed.result.candidateRevision);
  assert.deepEqual(task.spec.scope.write_paths, ['policy.json']);
  const final = records('final').at(-1);
  assert.ok(final, 'The native run has not completed its final record');
  const accepted = records('acceptance');
  assert.equal(accepted.length, 3);
  assert.equal(new Set(accepted.map((a) => a.accepted_revision)).size, 1);
  const finalRevision = accepted[0].accepted_revision;
  const finalOperation = operations.find((o) => o.result?.candidateRevision === finalRevision);
  assert.equal(finalOperation?.result.status, 'validated');
  assert.ok(finalOperation.created_at > correction.occurred_at);
  const check = (operation, mode, exit) => {
    const p = spawnSync(process.execPath, ['.acceptance/check.mjs', mode], { cwd: operation.result.path, encoding: 'utf8' });
    assert.equal(p.status, exit, p.stderr || p.stdout);
    return { revision: operation.result.candidateRevision, mode, exit_code: p.status, observation: (p.stdout + p.stderr).trim().slice(0, 700) };
  };
  const checks = [check(isolatedA, 'isolated', 0), check(isolatedB, 'isolated', 0), check(failed, 'combined', 1), check(finalOperation, 'combined', 0)];
  const show = (file) => {
    const p = spawnSync('git', ['show', `${finalRevision.slice(4)}:${file}`], { cwd: root, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    return JSON.parse(p.stdout);
  };
  assert.equal(show('features/a.json').enabled, true);
  assert.equal(show('features/b.json').enabled, true);
  assert.deepEqual(show('policy.json'), { mode: 'serial', capacity: 1 });
  const run = JSON.parse(db.prepare('SELECT data FROM runs WHERE id=?').get(runId).data);
  assert.equal(run.status, 'completed');
  assert.ok(tasks.length >= 6 && tasks.every((t) => t.status === 'accepted'));
  const git = (...args) => { const p = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(p.status, 0, p.stderr); return p.stdout.trim(); };
  assert.equal(git('rev-parse', 'HEAD'), 'fe2197e1d3cbc13247ab6a8c56c0a10a65d573bf');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal('git:' + git('rev-parse', finalOperation.result.targetRef), finalRevision);
  assert.deepEqual(git('diff', '--name-only', `HEAD..${finalRevision.slice(4)}`).split('\n').sort(), ['features/a.json', 'features/b.json', 'policy.json']);
  const handoffs = records('handoff'), reviews = records('review');
  for (const a of accepted) {
    const h = handoffs.find((h) => h.id === a.handoff_id);
    assert.ok(h && h.status === 'delivered' && h.limitations.length === 0 && a.review_ids.length);
    for (const id of a.review_ids) { const r = reviews.find((r) => r.id === id); assert.ok(r && r.outcome === 'approved' && r.handoff_id === h.id && r.source_revision === h.source_revision && r.tested_revision === finalRevision); }
  }
  const intervals = new Map();
  for (const e of events) { const id = e.payload?.turn_id; if (e.type === 'provider.session' && id && !intervals.has(id)) intervals.set(id, {start:e.occurred_at}); if (e.type === 'provider.result' && intervals.has(id)) intervals.get(id).end=e.occurred_at; }
  assert.ok(intervals.size > 0 && [...intervals.values()].every((i) => i.end));
  const edges=[...intervals.values()].flatMap((i)=>[[i.start,1],[i.end,-1]]).sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);
  let active=0,peak=0;for(const[,delta]of edges){active+=delta;peak=Math.max(peak,active);}assert.ok(peak<=run.max_active_agents);
  console.log(JSON.stringify({run_id:runId,status:run.status,version:run.version,tasks:tasks.length,all_tasks_accepted:true,acceptances:accepted.length,final_record:final.id,completed_at:run.updated_at,final_reviews:accepted.flatMap((a)=>a.review_ids),staged_order:{isolated_a:isolatedA.created_at,isolated_b:isolatedB.created_at,combined_failure:failedEnd,correction_decision:decision.occurred_at,correction_task:correction.occurred_at},checks,final_revision:finalRevision,initial_head_preserved:true,root_clean:true,features_preserved:true,capacity:1,native:{providers:[...new Set(records('session').filter((s)=>s.native_session_id).map((s)=>s.provider))],completed_turns:intervals.size,incomplete_turns:0,configured_limit:run.max_active_agents,observed_interval_peak:peak},event_count:events.at(-1).seq,ordering_clock:'Supervisor observations; not author-supplied TaskSpec timestamps'}));
  console.log('NATIVE_CORRECTION_OK');
} finally { db.close(); }
