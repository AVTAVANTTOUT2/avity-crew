import { spawnSync } from 'node:child_process';
const [prefix,dataHome,project,run,after='0']=process.argv.slice(2);
const result=spawnSync(prefix+'/bin/avity-crew',['status','--project',project,'--run',run,'--after-seq',after,'--limit','200','--json'],{encoding:'utf8',env:{...process.env,XDG_DATA_HOME:dataHome},timeout:10000,maxBuffer:4e6});
if(result.status!==0) {console.error(JSON.stringify({exit:result.status,output:(result.stderr||result.stdout).slice(-500)}));process.exit(1)}
const envelope=JSON.parse(result.stdout);
if(!envelope.ok) {console.error(JSON.stringify(envelope.error));process.exit(1)}
const x=envelope.data;
const events=x.events??[];
console.log(JSON.stringify({run_id:x.run?.id,status:x.run?.status,version:x.run?.version,generation:x.run?.generation,chief:x.run?.chief_provider,next_seq:x.next_seq,activity:x.activity,tasks:x.tasks?.map(t=>({id:t.id,status:t.status,attempt:t.active_attempt_id,wait:t.wait_reason})),events:events.filter(e=>!/^provider\.(unknown|tool|usage)$/.test(e.type)).slice(-10).map(e=>({seq:e.seq,type:e.type,text:e.payload?.text?.slice(0,180),message:e.payload?.message?.slice(0,220),code:e.payload?.code,error:e.payload?.error})),tools:events.filter(e=>e.type==='provider.tool').flatMap(e=>{try{const v=JSON.parse(e.payload?.text??'{}');return v.type==='tool_use'?[v.name]:[]}catch{return[]}}).slice(-8),questions:x.questions?.filter(q=>q.status==='open').map(q=>({id:q.id,text:q.question,blocking:q.blocking}))}));
