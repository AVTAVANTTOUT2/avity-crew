import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
const [database,root,runId]=process.argv.slice(2);
assert.ok(database&&root&&runId);
const db=new DatabaseSync(database,{readOnly:true});
const records=kind=>db.prepare('SELECT data FROM records WHERE run_id=? AND kind=?').all(runId,kind).map(row=>JSON.parse(row.data));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
try {
  const run=JSON.parse(db.prepare('SELECT data FROM runs WHERE id=?').get(runId).data);
  assert.equal(run.status,'completed');
  const tasks=db.prepare('SELECT data FROM tasks WHERE run_id=?').all(runId).map(row=>JSON.parse(row.data));
  assert.ok(tasks.length>=3);
  assert.ok(tasks.every(task=>task.status==='accepted'));
  const acceptances=records('acceptance');
  assert.ok(acceptances.length>=2);
  const revisions=[...new Set(acceptances.map(a=>a.accepted_revision))];
  assert.equal(revisions.length,1,'Accepted authors must identify one combined candidate');
  const revision=revisions[0];
  assert.ok(revision.startsWith('git:'));
  const operations=records('operation');
  const candidates=operations.filter(o=>o.kind==='integration.prepare'&&o.status==='completed').map(o=>o.result);
  const candidate=candidates.find(c=>c.candidateRevision===revision&&c.status==='validated');
  assert.ok(candidate);
  assert.ok(candidate.proofs.every(p=>p.exitCode===0&&!p.signal));
  assert.equal(git('rev-parse',candidate.targetRef),revision.slice(4));
  assert.equal(git('rev-parse','HEAD'),candidate.expectedBase.slice(4));
  assert.equal(git('status','--porcelain'),'');
  const sessions=new Map(records('session').map(s=>[s.id,s]));
  const events=db.prepare("SELECT data FROM events WHERE run_id=? AND json_extract(data,'$.type') IN ('provider.session','provider.result') ORDER BY seq").all(runId).map(row=>JSON.parse(row.data));
  const intervals=new Map();
  for(const event of events) {
    const id=event.payload.turn_id;
    if(event.type==='provider.session'&&!intervals.has(id)) {
      assert.equal(event.payload.provenance,'live');
      const session=sessions.get(event.session_id);
      assert.ok(['claude','codex'].includes(session.provider));
      intervals.set(id,{turn_id:id,session_id:event.session_id,task_id:event.task_id,provider:session.provider,native_session_id:event.payload.native_session_id,start:event.occurred_at});
    } else if(event.type==='provider.result'&&intervals.has(id)) {
      Object.assign(intervals.get(id),{end:event.occurred_at,success:event.payload.success,error_kind:event.payload.error?.kind??null});
    }
  }
  const completed=[...intervals.values()].filter(t=>t.end);
  assert.ok(completed.length>0);
  const providers=[...new Set(completed.map(t=>t.provider))].sort();
  assert.deepEqual(providers,['claude','codex']);
  const edges=completed.flatMap(t=>[{at:t.start,delta:1},{at:t.end,delta:-1}]).sort((a,b)=>a.at.localeCompare(b.at)||a.delta-b.delta);
  let active=0,peak=0;
  for(const edge of edges){active+=edge.delta;peak=Math.max(peak,active)}
  assert.ok(peak<=run.max_active_agents);
  const developers=new Set(tasks.filter(t=>t.spec.role==='developer').map(t=>t.id));
  const writers=completed.filter(t=>developers.has(t.task_id));
  const mixed=writers.flatMap((a,i)=>writers.slice(i+1).filter(b=>a.task_id!==b.task_id&&a.provider!==b.provider&&a.start<b.end&&b.start<a.end).map(b=>({tasks:[a.task_id,b.task_id],providers:[a.provider,b.provider],from:[a.start,b.start].sort().at(-1),to:[a.end,b.end].sort()[0]})));
  assert.ok(mixed.length>0,'Actual mixed native writers must overlap');
  const reviewIds=new Set(acceptances.flatMap(a=>a.review_ids));
  const finalReviews=records('review').filter(r=>reviewIds.has(r.id));
  assert.ok(finalReviews.length>=2&&finalReviews.every(r=>r.outcome==='approved'&&r.tested_revision===revision));
  assert.equal(records('final').length,1);
  const final=records('final')[0];
  assert.deepEqual(final.criterion_evidence.map(c=>c.criterion_id).sort(),run.acceptance_criteria.filter(c=>c.required).map(c=>c.id).sort());
  const summary={run_id:runId,status:run.status,version:run.version,chief:run.chief_provider,generation:run.generation,task_count:tasks.length,all_tasks_accepted:true,acceptances:acceptances.length,accepted_revision:revision,target_ref:candidate.targetRef,initial_head_preserved:true,root_clean:true,checks:candidate.proofs.map(p=>({id:p.id,exit_code:p.exitCode})),final_reviews:finalReviews.map(r=>({id:r.id,task:r.review_task_id,handoff:r.handoff_id,outcome:r.outcome})),native:{providers,completed_turns:completed.length,incomplete_turn_ids:[...intervals.values()].filter(t=>!t.end).map(t=>t.turn_id),observed_interval_peak:peak,interval_definition:'First reported native session through terminal normalized result; only complete intervals counted',mixed_writer_overlap:mixed[0],unique_native_ids:[...new Set(completed.map(t=>t.native_session_id))]},final_record_id:final.id,final_at:final.created_at};
  console.log(JSON.stringify(summary));
  console.log('NATIVE_RECIPE_OK');
} finally {db.close()}
