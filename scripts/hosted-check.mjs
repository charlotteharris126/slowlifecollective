import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const endpoint='https://admin.slowlifecollective.com/.netlify/functions/worker-session';
async function request(body){const r=await fetch(endpoint,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+process.env.STUDIO_WORKER_SECRET,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Studio session endpoint returned HTTP ${r.status}.`);return r.json();}
const file=path.join(os.homedir(),'.config/higgsfield/credentials.json');
try{
 const acquired=await request({action:'acquire'});
 const session=acquired.session||JSON.parse(process.env.HF_SESSION||'null');
 if(!session?.access_token||!session?.refresh_token)throw Error('Higgsfield reconnection required.');
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(session),{mode:0o600});
 let failed=false;
 try{const output=execFileSync('node',['scripts/check.mjs'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000});for(const line of output.split('\n'))if(line.startsWith('SCHEMA '))console.log(line);}catch{failed=true;}
 // The CLI may rotate tokens. Persist the resulting session before this runner disappears.
 if(!fs.existsSync(file))throw Error('Higgsfield login expired; reconnect before another run.');
 const renewed=JSON.parse(fs.readFileSync(file,'utf8'));
 await request({action:'save',lease:acquired.lease,session:renewed});
 if(failed)throw Error('Higgsfield read-only check failed. Session saved if still available.');
 console.log(acquired.session?'PASS: restored studio session, verified Higgsfield, saved session. No credits spent.':'PASS: initialized encrypted studio session, verified Higgsfield, saved session. No credits spent.');
}catch(e){console.error(e.message.startsWith('Studio session endpoint')?e.message:'Hosted session check failed; inspect studio connection setup. No generation submitted.');process.exitCode=1;}finally{fs.rmSync(file,{force:true});}
