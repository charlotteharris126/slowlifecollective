import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const base='https://admin.slowlifecollective.com/.netlify/functions/';
const file=path.join(os.homedir(),'.config/higgsfield/credentials.json');
async function request(endpoint,body){const r=await fetch(base+endpoint,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+process.env.STUDIO_WORKER_SECRET,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});if(!r.ok)throw Error('Studio request failed ('+r.status+').');return r.json();}
function cli(args){try{return JSON.parse(execFileSync('higgsfield',[...args,'--json'],{encoding:'utf8',timeout:65000,stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024}));}catch{throw Error('Higgsfield command could not be confirmed.');}}
function argsFor(task){const a=[task.model,'--prompt',task.prompt];for(const [key,value] of Object.entries(task.params))a.push('--'+key,String(value));if(task.reference)a.push(task.model==='seedance_2_0'?'--start-image':'--image',task.reference);return a;}
// A malformed or multi-job submission stops. Never infer an ID from free text.
export function submissionId(value){const v=Array.isArray(value)&&value.length===1?value[0]:value;const id=v?.id||v?.job_id;if(typeof id!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(id))throw Error('Unrecognised submission response; review required.');return id;}
let lease;
try{
 const acquired=await request('worker-session',{action:'acquire'});lease=acquired.lease;
 const session=acquired.session||JSON.parse(process.env.HF_SESSION||'null');if(!session?.access_token||!session?.refresh_token)throw Error('Higgsfield reconnection required.');
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(session),{mode:0o600});
 const deadline=Date.now()+240000;let steps=0;
 while(Date.now()<deadline&&steps++<20){
  const work=await request('generation',{action:'work',lease});
  if(!work.job){console.log(work.paused?'Worker paused or before its first generation window. No credits spent.':'No eligible generation work.');break;}
  const job=work.job;
  if(process.env.DRY_RUN==='true'){console.log('Dry run: an eligible job exists. No generation submitted.');break;}
  if(job.status==='submitted'){
   const result=cli(['generate','get',job.providerId]);
   if(result.id!==job.providerId)throw Error('Unexpected provider job.');
   if(result.status==='completed'){
    if(typeof result.result_url!=='string')throw Error('Completed media URL missing.');
    await request('generation',{action:'complete',lease,id:job.id,providerId:job.providerId,url:result.result_url});console.log('Completed media saved to studio. Final approval required.');continue;
   }
   if(['failed','error','cancelled'].includes(result.status)){await request('generation',{action:'failed',lease,id:job.id});console.log('Generation failed; no automatic retry.');break;}
   // Leave the acknowledged job for the next hosted run; do not submit twice.
   console.log('Generation is still processing. The next hosted run will collect it.');break;
  }
  const args=argsFor(job),quote=cli(['generate','cost',...args]);
  if(typeof quote.credits_exact!=='number'||!Number.isFinite(quote.credits_exact)||quote.credits_exact<=0)throw Error('Exact credit quote unavailable.');
  const reserved=await request('generation',{action:'reserve',lease,id:job.id,credits:quote.credits_exact});
  if(reserved.blocked){console.log('Monthly cap reached; generation paused for review.');break;}
  // No retry surrounds create. A timeout/crash retains the reservation and blocks this job.
  try{
   const created=cli(['generate','create',...argsFor(reserved)]),providerId=submissionId(created);
   await request('generation',{action:'submitted',lease,id:job.id,dispatchId:reserved.dispatchId,providerId});
   console.log('One generation submitted within reserved credits.');
  }catch{await request('generation',{action:'failed',lease,id:job.id});throw Error('Submission needs review; no retry was made.');}
 }
}catch(e){console.error('Hosted content worker needs attention. No unapproved publication was requested.');process.exitCode=1;
}finally{
 if(lease&&fs.existsSync(file)){
  try{const renewed=JSON.parse(fs.readFileSync(file,'utf8'));await request('worker-session',{action:'save',lease,session:renewed});}catch{console.error('Higgsfield session could not be saved. Reconnection may be required.');process.exitCode=1;}
 }
 try{await request('generation',{action:'report',ok:!process.exitCode});}catch{process.exitCode=1;}
 fs.rmSync(file,{force:true});
}
