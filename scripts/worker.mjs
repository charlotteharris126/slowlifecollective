import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const base='https://admin.slowlifecollective.com/.netlify/functions/';
const dir=path.join(os.homedir(),'.config/higgsfield'),file=path.join(dir,'credentials.json'),configFile=path.join(dir,'config.json');
async function request(endpoint,body){const r=await fetch(base+endpoint,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+process.env.STUDIO_WORKER_SECRET,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});if(!r.ok){let detail='';try{detail=(await r.json()).error||''}catch{}throw Error('Studio '+endpoint+' request failed ('+r.status+')'+(detail?': '+detail:'.'));}return r.json();}
function cli(args){try{return JSON.parse(execFileSync('higgsfield',[...args,'--json'],{encoding:'utf8',timeout:65000,stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024}));}catch{throw Error('Higgsfield command could not be confirmed.');}}
function recent(kind){const value=cli(['generate','list',kind==='video'?'--video':'--image','--size','20']);return Array.isArray(value)?value:value?.jobs||value?.data||value?.results||[];}
function createdAt(job){const raw=job?.created_at??job?.createdAt;if(typeof raw==='number')return raw<1e12?raw*1000:raw;const parsed=Date.parse(raw);return Number.isFinite(parsed)?parsed:NaN;}
function recover(job){const start=Date.parse(job.dispatchedAt),matches=recent(job.kind).filter(x=>{const id=x?.id||x?.job_id,t=createdAt(x);return typeof id==='string'&&/^[a-zA-Z0-9-]{8,100}$/.test(id)&&Number.isFinite(t)&&t>=start-10000&&t<=start+180000;});if(matches.length>1)throw Error('Uncertain submission could not be matched uniquely.');return matches.length===1?(matches[0].id||matches[0].job_id):null;}
function argsFor(task){const a=[task.model,'--prompt',task.prompt];for(const [key,value] of Object.entries(task.params))a.push('--'+key,String(value));if(task.reference)a.push(task.model==='seedance_2_0'?'--start-image':'--image',task.reference);return a;}
// A malformed or multi-job submission stops. Never infer an ID from free text.
export function submissionId(value){const roots=[value,value?.job,value?.data,...(Array.isArray(value)?value:[]),...(Array.isArray(value?.jobs)?value.jobs:[]),...(Array.isArray(value?.data)?value.data:[])],direct=[...(Array.isArray(value?.job_ids)?value.job_ids:[]),...(Array.isArray(value?.jobIds)?value.jobIds:[])],ids=[...new Set([...roots.map(v=>typeof v==='string'?v:v?.id||v?.job_id),...direct].filter(id=>typeof id==='string'&&/^[a-zA-Z0-9-]{8,100}$/.test(id)))];if(ids.length!==1)throw Error('Unrecognised submission response; review required.');return ids[0];}
let lease;
try{
 const acquired=await request('worker-session',{action:'acquire'});lease=acquired.lease;
 const session=acquired.session||JSON.parse(process.env.HF_SESSION||'null');if(!session?.access_token||!session?.refresh_token)throw Error('Higgsfield reconnection required.');
 const {workspace_id,...credentials}=session;fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(credentials),{mode:0o600});if(workspace_id)fs.writeFileSync(configFile,JSON.stringify({workspace_id}),{mode:0o600});
 const deadline=Date.now()+240000;let steps=0;
 while(Date.now()<deadline&&steps++<20){
  const work=await request('generation',{action:'work',lease});
  if(!work.job){console.log(work.paused?'Worker paused or before its first generation window. No credits spent.':'No eligible generation work.');break;}
  const job=work.job;
  if(process.env.DRY_RUN==='true'){console.log('Dry run: an eligible job exists. No generation submitted.');break;}
  if(job.status==='uncertain'){
   const providerId=recover(job);
   if(providerId){await request('generation',{action:'adopt',lease,id:job.id,dispatchId:job.dispatchId,providerId});console.log('Recovered one uniquely matching generation; no duplicate was submitted.');}
   else {await request('generation',{action:'release',lease,id:job.id,dispatchId:job.dispatchId});console.log('No provider job existed; released the stale reservation for one safe attempt.');}
   continue;
  }
  if(['submitted','attention'].includes(job.status)){
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
  const args=argsFor(job),quote=cli(['generate','cost',...args]),credits=quote.credits_exact??quote.credits;
  if(typeof credits!=='number'||!Number.isFinite(credits)||credits<=0)throw Error('Exact credit quote unavailable.');
  const reserved=await request('generation',{action:'reserve',lease,id:job.id,credits});
  if(reserved.blocked){console.log('Monthly cap reached; generation paused for review.');break;}
  // No retry surrounds create. A timeout/crash retains the reservation and blocks this job.
  try{
   const created=cli(['generate','create',...argsFor(reserved)]);let providerId;try{providerId=submissionId(created)}catch{providerId=recover({...reserved,kind:job.kind})}if(!providerId)throw Error('Created job could not be matched safely.');
   await request('generation',{action:'submitted',lease,id:job.id,dispatchId:reserved.dispatchId,providerId});
   console.log('One generation submitted within reserved credits.');
  }catch{await request('generation',{action:'failed',lease,id:job.id});throw Error('Submission needs review; no retry was made.');}
 }
}catch(e){console.error('Hosted content worker needs attention. No unapproved publication was requested.');console.error(e instanceof Error?e.message:'Unknown worker error.');process.exitCode=1;
}finally{
 if(lease&&fs.existsSync(file)){
  try{const renewed=JSON.parse(fs.readFileSync(file,'utf8')),config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{};await request('worker-session',{action:'save',lease,session:{...renewed,workspace_id:config.workspace_id}});}catch{console.error('Higgsfield session could not be saved. Reconnection may be required.');process.exitCode=1;}
 }
 try{await request('generation',{action:'report',ok:!process.exitCode});}catch{process.exitCode=1;}
 fs.rmSync(file,{force:true});fs.rmSync(configFile,{force:true});
}
