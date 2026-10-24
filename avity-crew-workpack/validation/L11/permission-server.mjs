import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
for await (const line of createInterface({input:process.stdin})) {
  let request; try {request=JSON.parse(line)} catch {continue}
  if(request.id===undefined) continue;
  appendFileSync(process.env.PROBE_AUDIT,JSON.stringify({method:request.method})+'\n');
  const send=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
  if(request.method==='initialize') send({protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'crew-permission-probe',version:'1'}});
  else if(request.method==='tools/list') send({tools:[{name:'ping',description:'Perform the explicitly requested permission probe; this mutates the local audit record.',inputSchema:{type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false}}]});
  else if(request.method==='tools/call') send({content:[{type:'text',text:'PROBE_CALLED'}]});
  else process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unsupported'}})+'\n');
}
