import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const [phase, prefix, dataHome, ...roots] = process.argv.slice(2);
assert.ok(['seed','check'].includes(phase));
assert.equal(roots.length,2);
const { Store, identifyProject } = await import(pathToFileURL(join(prefix,'lib/node_modules/avity-crew/dist/packages/storage/src/index.js')));
const ids=[];
for(const root of roots) {
  const project=identifyProject(root,dataHome); ids.push(project.id);
  const store=new Store(project);
  const runId='run:package-upgrade', taskId='task:package-upgrade', criterion={id:'criterion:package-upgrade',description:'Préserver la mission pendant mise à jour',required:true,verification:'assertions SQLite du paquet installé'};
  const actor={id:'user:local',project_id:project.id,run_id:runId,role:'user',task_id:null,attempt_id:null,generation:1};
  const version=()=>store.getRun(runId).version;
  try {
    if(phase==='seed' && !store.listRuns().some(run=>run.id===runId)) {
      const at=new Date().toISOString();
      store.createRun({id:runId,project_id:project.id,objective:'Objectif de mise à jour — '+root,constraints:['Conserver décisions et tâches'],acceptance_criteria:[criterion],delivery_mode:'documentation',status:'planning',chief_provider:'codex',chief_model:null,generation:1,version:0,max_active_agents:1,created_at:at,updated_at:at},'package-seed-run');
      store.createTask(actor,{schema_version:1,id:taskId,run_id:runId,title:'Mission conservée',objective:'Ne perdre aucune donnée lors de la mise à jour',role:'documenter',acceptance_criteria:[criterion],depends_on:[],scope:{read_paths:['.'],write_paths:['docs/'],excluded_paths:[]},base_revision:null,context_source_ids:[],expected_deliverables:['Note conservée'],created_at:at},'package-seed-task',version());
      store.recordDecision(actor,{schema_version:1,id:'decision:package-upgrade',run_id:runId,question:'Faut-il conserver les données ?',answer:'Oui, intégralement',status:'approved',approved_by:actor.id,source_ids:[],affects_task_ids:[taskId],supersedes:null,created_at:at},'package-seed-decision',version());
    }
    if(phase==='seed') {
      if(store.getRun(runId).status==='planning') store.updateRunStatus(actor,'running','package-seed-running',version());
      if(store.getRun(runId).status==='running') store.updateRunStatus(actor,'paused','package-seed-pause',version());
    }
    assert.equal(store.getRun(runId).status,'paused');
    assert.equal(store.getRun(runId).objective,'Objectif de mise à jour — '+root);
    assert.equal(store.getTask(taskId).spec.title,'Mission conservée');
    assert.equal(store.getRecord(runId,'decision','decision:package-upgrade').answer,'Oui, intégralement');
    assert.deepEqual(store.getRun(runId).acceptance_criteria,[criterion]);
    console.log(JSON.stringify({phase,project_id:project.id,run_id:runId,status:'paused',task:true,decision:true,criteria:true}));
  } finally {store.close();}
}
assert.notEqual(ids[0],ids[1]);
console.log('PACKAGE_STATE_OK: two independent projects, missions and decisions preserved');
