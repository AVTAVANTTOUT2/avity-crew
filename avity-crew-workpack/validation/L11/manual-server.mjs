import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'crew-ui-qa-'));
const {createApp}=await import(pathToFileURL(join(process.argv[2],'src/server.mjs')));
const app=createApp({dataFile:join(directory,'notes.json')});
app.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,url:`http://127.0.0.1:${app.address().port}`})));
process.once('SIGTERM',()=>app.close(async()=>{await rm(directory,{recursive:true,force:true});process.exit(0)}));
