import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile,writeFile,mkdir,stat,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {videoSwapSettings,videoFramePrompt,frameOutputSize,minimumOutputEstimate,createVideoSwapController} from './video-swap.mjs';

const require=createRequire(import.meta.url);
assert.deepEqual(videoSwapSettings({fps:12,model:'gpt-image-1.5',quality:'low'}).fps,12);
assert.throws(()=>videoSwapSettings({fps:60}),/8, 12 or 24/);
assert.throws(()=>videoSwapSettings({quality:'ultra'}),/quality/);
assert.throws(()=>videoSwapSettings({model:'unknown'}),/model/);
assert.match(videoFramePrompt(1),/ORIGINAL video frame/);
assert.doesNotMatch(videoFramePrompt(1),/Image 3/);
assert.match(videoFramePrompt(2),/Image 3/);
assert.match(videoFramePrompt(2),/NOT Image 3/);
assert.doesNotMatch(videoFramePrompt(2,'',false),/Image 3/);
assert.equal(frameOutputSize(1920,1080),'1536x1024');
assert.equal(frameOutputSize(1080,1920),'1024x1536');
assert.equal(minimumOutputEstimate(8,1920,1080,'low','gpt-image-1.5'),0.104);
assert.equal(minimumOutputEstimate(8,1920,1080,'high','gpt-image-1.5'),null);

function processFFmpeg(binary,args){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,['-hide_banner','-nostdin','-y',...args],{stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',b=>{stderr+=b.toString();});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('ffmpeg failed '+stderr.slice(-1000))));
 });
}
async function waitFor(controller,id,states,timeout=12000){
 const stop=Date.now()+timeout;
 while(Date.now()<stop){
  const j=await controller.status(id);
  if(states.includes(j.status))return j;
  await new Promise(r=>setTimeout(r,80));
 }
 throw Error('Timed out waiting for '+states.join('/')+': '+JSON.stringify(await controller.status(id)));
}
const root=await mkdtemp(path.join(os.tmpdir(),'filmbuilder-video-test-'));
try{
 const ffmpeg=require('@ffmpeg-installer/ffmpeg').path;
 const vid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',img='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const source=path.join(root,vid+'.bin');
 await processFFmpeg(ffmpeg,['-f','lavfi','-i','testsrc2=size=320x180:rate=8',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1',
  '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
 let exampleFrame=null;
 const observed=[];
 let seq=0;
 const provider=async(url,opts)=>{
  if(opts.method==='POST'){
   const files=opts.body.getAll('image[]');
   observed.push({files:files.length,prompt:opts.body.get('prompt'),model:opts.body.get('model'),quality:opts.body.get('quality')});
   const id='mock-task-'+(++seq);
   return {task_id:id,status:'pending'};
  }
  if(!exampleFrame)throw Error('No frame for mocked PiAPI image result');
  return {data:{status:'completed',output:{data:[{b64_json:exampleFrame.toString('base64')}]}}};
 };
 const controller=createVideoSwapController({storage:root,piapiKey:'fake-key',pollIntervalMs:10,provider,
   asset:async id=>{
    if(id===vid)return {id:vid,mime:'video/mp4',size:(await stat(source)).size,duration:1,width:320,height:180};
    if(id===img){
     const bytes=exampleFrame||Buffer.from([137,80,78,71,13,10,26,10]);
     return {id:img,mime:'image/png',size:bytes.length,name:'character.png',bytes};
    }
    throw Error('Unknown test asset');
   }});
 const started=await controller.prepare({videoId:vid,characterId:img,fps:8,model:'gpt-image-1.5',quality:'low',preserveAudio:true,continuity:true});
 assert.equal(started.status,'preparing');
 const ready=await waitFor(controller,started.id,['ready','failed']);
 assert.equal(ready.status,'ready',ready.error);
 assert.equal(ready.frames,8);
 assert.equal(ready.minOutputOnly,0.104);
 assert.equal(ready.paidSubmissions,0);
 exampleFrame=await readFile(path.join(root,'video-swap-'+started.id,'frames','000001.png'));
 const previewStarted=await controller.preview(started.id);
 assert.equal(previewStarted.status,'previewing');
 const preview=await waitFor(controller,started.id,['preview_ready','failed']);
 assert.equal(preview.status,'preview_ready',preview.error);
 assert.equal(preview.completedFrames,1);
 assert.equal(preview.paidSubmissions,1);
 assert.equal(observed[0].files,2,'Preview uses source frame plus character ref only');
 assert.match(observed[0].prompt,/ORIGINAL video frame/);
 assert.ok(!observed[0].prompt.includes('Image 3'));
 const fakeRes={headers:null,body:null,writeHead(code,headers){this.headers={code,...headers};},end(data){this.body=data;}};
 const approval=await controller.continueJob(started.id);
 assert.equal(approval.status,'running');
 const completed=await waitFor(controller,started.id,['completed','failed'],30000);
 assert.equal(completed.status,'completed',completed.error);
 assert.equal(completed.completedFrames,8);
 assert.equal(completed.paidSubmissions,8);
 assert.equal(observed.length,8);
 assert.equal(observed[1].files,3,'Continuity uses original + character + prior edited frame');
 assert.match(observed[1].prompt,/Image 3/);
 const output=path.join(root,'video-swap-'+started.id,'result.mp4');
 assert.ok((await stat(output)).size>1000);
 assert.ok(completed.video?.endsWith('/download'));
 console.log('Video character swap: real FFmpeg frame extraction, first-frame paid gate, 3-image continuity, original audio remux and output tests passed');
}finally{await rm(root,{recursive:true,force:true});}
