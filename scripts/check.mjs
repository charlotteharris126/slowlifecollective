import {execFileSync} from 'node:child_process';
function cli(args){try{return JSON.parse(execFileSync('higgsfield',[...args,'--json'],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}));}catch{throw Error('Higgsfield check failed. Login may need renewal. No generation was submitted.');}}
const account=cli(['account','status']);
if(!Number.isFinite(Number(account.credits)))throw Error('Missing account balance');
const image=cli(['generate','cost','gpt_image_2','--prompt','A quiet country kitchen in natural light.','--aspect_ratio','4:5','--quality','high','--resolution','2k','--batch_size','1']);
const reel=cli(['generate','cost','seedance_2_0','--prompt','A quiet garden, locked camera, gently moving leaves, natural birdsong.','--aspect_ratio','9:16','--duration','5','--resolution','1080p','--generate_audio','true','--mode','std']);
for(const quote of [image,reel])if(!Number.isFinite(Number(quote.credits_exact)))throw Error('Exact quote unavailable');
// Deliberately omit account identity and balance from public repository logs.
console.log('Hosted login and both cost estimates succeeded. No generation submitted.');
console.log(`Image: ${image.credits_exact} credits. Reel: ${reel.credits_exact} credits.`);
console.log(`Four posts/week, including 2 Reel source images and 25% retry allowance: ${Math.ceil((14*Number(image.credits_exact)+2*Number(reel.credits_exact))*52/12*1.25)} credits/month.`);
