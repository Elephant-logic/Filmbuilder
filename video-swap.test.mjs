import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile,writeFile,mkdir,stat,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {MAX_VIDEO_FRAMES,videoSwapSettings,videoFramePrompt,frameOutputSize,minimumOutputEstimate,createVideoSwapController} from './video-swap.mjs';

const require=createRequire(import.meta.url);
assert.equal(MAX_VIDEO_FRAMES,300);
assert.equal(videoSwapSettings({}).fps,24,'24 fps is the smooth default');
assert.equal(videoSwapSettings({fps:30}).fps,30,'30 fps phone video setting');
assert.deepEqual(videoSwapSettings({fps:12,model:'gpt-image-1.5',quality:'low'}).fps,12);
assert.throws(()=>videoSwapSettings({fps:60}),/8, 12, 24 or 30/);
assert.throws(()=>videoSwapSettings({quality:'ultra'}),/quality/);
assert.throws(()=>videoSwapSettings({model:'unknown'}),/model/);
assert.match(videoFramePrompt(1),/CURRENT ORIGINAL VIDEO FRAME/);
assert.doesNotMatch(videoFramePrompt(1),/Image 3/);
assert.match(videoFramePrompt(2),/Image 3 is the LOCKED APPROVED FIRST EDITED FRAME/);
assert.match(videoFramePrompt(2),/PRIMARY visual authority/);
assert.doesNotMatch(videoFramePrompt(2),/Image 4/,'frame 2 must not reference duplicate previous=anchor');
assert.match(videoFramePrompt(3),/Image 4 is the PREVIOUS EDITED FRAME/);
assert.match(videoFramePrompt(3),/ALWAYS follow Image 3/);
assert.match(videoFramePrompt(3),/NEVER copy its pose/);
assert.match(videoFramePrompt(3,'',false),/Image 3 is the LOCKED/);
assert.doesNotMatch(videoFramePrompt(3,'',false),/Image 4/);
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
 const rotatedId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const source=path.join(root,vid+'.bin'),rotatedSource=path.join(root,rotatedId+'.bin');
 await processFFmpeg(ffmpeg,['-f','lavfi','-i','testsrc2=size=320x180:rate=30',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1',
  '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-f','mp4',source]);
 // Smartphone-style footage: coded 320x180 landscape pixels with a 90-degree
 // display rotation flag. Upload metadata wrongly reports landscape.
 await processFFmpeg(ffmpeg,['-i',source,'-map','0','-c','copy','-metadata:s:v:0','rotate=90','-f','mp4',rotatedSource]);
 let exampleFrame=null;
 const observed=[];
 let seq=0;
 let variedVideoFrames=[];
 const provider=async(url,opts)=>{
  if(opts.method==='POST'){
   const files=opts.body.getAll('image[]');
   observed.push({files:files.length,prompt:opts.body.get('prompt'),model:opts.body.get('model'),quality:opts.body.get('quality'),
     filenames:files.map(f=>f.name),images:await Promise.all(files.map(async f=>Buffer.from(await f.arrayBuffer()))) });
   const id='mock-task-'+(++seq);
   return {task_id:id,status:'pending'};
  }
  if(!exampleFrame)throw Error('No frame for mocked PiAPI image result');
  // Each mocked result is a different REAL video PNG so we can prove the
  // golden anchor never changes even as the previous frame does.
  const output=seq<=variedVideoFrames.length?variedVideoFrames[seq-1]:exampleFrame;
  return {data:{status:'completed',output:{data:[{b64_json:output.toString('base64')}]}}};
 };
 const controller=createVideoSwapController({storage:root,piapiKey:'fake-key',pollIntervalMs:10,provider,
   asset:async id=>{
    if(id===vid)return {id:vid,mime:'video/mp4',size:(await stat(source)).size,duration:1,width:320,height:180};
    if(id===rotatedId)return {id:rotatedId,mime:'video/mp4',size:(await stat(rotatedSource)).size,duration:1,width:320,height:180};
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
 variedVideoFrames=await Promise.all(Array.from({length:8},(_,i)=>readFile(path.join(root,'video-swap-'+started.id,'frames',String(i+1).padStart(6,'0')+'.png')));
 exampleFrame=variedVideoFrames[0];
 const previewStarted=await controller.preview(started.id);
 assert.equal(previewStarted.status,'previewing');
 const preview=await waitFor(controller,started.id,['preview_ready','failed']);
 assert.equal(preview.status,'preview_ready',preview.error);
 assert.equal(preview.completedFrames,1);
 assert.equal(preview.paidSubmissions,1);
 assert.equal(preview.anchorLocked,true,'First approved image is saved permanently as locked anchor');
 assert.deepEqual(await readFile(path.join(root,'video-swap-'+started.id,'anchor.png')),variedVideoFrames[0]);
 assert.equal(observed[0].files,2,'Preview uses source frame plus character ref only');
 assert.match(observed[0].prompt,/CURRENT ORIGINAL VIDEO FRAME/);
 assert.ok(!observed[0].prompt.includes('Image 3'));
 const fakeRes={headers:null,body:null,writeHead(code,headers){this.headers={code,...headers};},end(data){this.body=data;}};
 const approval=await controller.continueJob(started.id);
 assert.equal(approval.status,'running');
 const completed=await waitFor(controller,started.id,['completed','failed'],30000);
 assert.equal(completed.status,'completed',completed.error);
 assert.equal(completed.completedFrames,8);
 assert.equal(completed.paidSubmissions,8);
 assert.equal(observed.length,8);
 assert.equal(observed[1].files,3,'Frame 2 uses original, character, and locked anchor (without duplicate)');
 assert.deepEqual(observed[1].filenames,['original-frame-2.png','character.png','locked-first-approved-frame.png']);
 assert.deepEqual(observed[1].images[2],variedVideoFrames[0],'Frame 2 locked anchor must equal approved first result');
 assert.match(observed[1].prompt,/Image 3 is the LOCKED APPROVED FIRST EDITED FRAME/);
 assert.equal(observed[2].files,4,'Frame 3 onwards must use original + character + locked first + previous');
 assert.deepEqual(observed[2].filenames,['original-frame-3.png','character.png','locked-first-approved-frame.png','previous-edited-frame.png']);
 assert.deepEqual(observed[2].images[2],variedVideoFrames[0],'Anchor remains the FIRST edited frame');
 assert.deepEqual(observed[2].images[3],variedVideoFrames[1],'Previous frame is independently updated');
 assert.notDeepEqual(observed[2].images[2],observed[2].images[3],'Anchor should not drift with the last frame');
 assert.match(observed[2].prompt,/Image 4 is the PREVIOUS EDITED FRAME/);
 assert.deepEqual(observed.at(-1).images[2],variedVideoFrames[0],'Even the final edit references the first result');
 assert.deepEqual(await readFile(path.join(root,'video-swap-'+started.id,'anchor.png')),variedVideoFrames[0],'Locked anchor file remains unchanged');
 const output=path.join(root,'video-swap-'+started.id,'result.mp4');
 assert.ok((await stat(output)).size>1000);
 assert.ok(completed.video?.endsWith('/download'));
 console.log('Video character swap: real FFmpeg extraction, preview approval, continuity and audio remux passed');
 // Test 30 FPS, a phone-display rotation tag, correct portrait PiAPI output
 // selection, and final frame dimensions. Metadata still says 320x180!
 const rotatedStarted=await controller.prepare({videoId:rotatedId,characterId:img,fps:30,model:'gpt-image-1.5',quality:'low',preserveAudio:true,continuity:true});
 const portrait=await waitFor(controller,rotatedStarted.id,['ready','failed'],20000);
 assert.equal(portrait.status,'ready',portrait.error);
 assert.equal(portrait.frames,30);
 assert.equal(portrait.outputSize,'1024x1536','PiAPI must get portrait settings based on rotated extracted frame');
 const rotatedHeader=await readFile(path.join(root,'video-swap-'+rotatedStarted.id,'frames','000001.png'));
 assert.ok(rotatedHeader.readUInt32BE(16)<rotatedHeader.readUInt32BE(20),'FFmpeg extracted upright portrait frame');
 exampleFrame=rotatedHeader;
 await controller.preview(rotatedStarted.id);
 const portraitPreview=await waitFor(controller,rotatedStarted.id,['preview_ready','failed']);
 assert.equal(portraitPreview.status,'preview_ready',portraitPreview.error);
 await controller.continueJob(rotatedStarted.id);
 const portraitComplete=await waitFor(controller,rotatedStarted.id,['completed','failed'],45000);
 assert.equal(portraitComplete.status,'completed',portraitComplete.error);
 assert.equal(portraitComplete.completedFrames,30);
 const finalFirst=path.join(root,'portrait-final-first.png');
 await processFFmpeg(ffmpeg,['-i',path.join(root,'video-swap-'+rotatedStarted.id,'result.mp4'),'-frames:v','1',finalFirst]);
 const finalHeader=await readFile(finalFirst);
 assert.ok(finalHeader.readUInt32BE(16)<finalHeader.readUInt32BE(20),'Rendered MP4 must remain portrait, not become landscape');
 console.log('Video character swap: 30 FPS and rotated phone-footage portrait extraction/MP4 export tests passed');
}finally{await rm(root,{recursive:true,force:true});}
