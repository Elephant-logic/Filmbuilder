// Sequential GPT-image character replacement of sampled source-video frames.
// No paid API call occurs during preparation. The first paid preview and the
// remaining paid frames require separate explicit user requests.
import path from 'node:path';
import {mkdir,readFile,writeFile,readdir,stat,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
export const MAX_VIDEO_FRAMES=240;
export const MAX_VIDEO_SECONDS=10;
export const ALLOWED_FPS=[8,12,24];
export const VIDEO_MODELS=['gpt-image-1.5','gpt-image-2.5-flare','gpt-image-2.5-sunburst'];
export const VIDEO_QUALITIES=['low','medium','high'];
const PNG_MAGIC=Buffer.from([137,80,78,71,13,10,26,10]);
const IMAGE_LIMIT=25*1024*1024;
const STARTING_OUTPUT_LOW={square:0.009,landscape:0.013,portrait:0.013};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function videoSwapSettings(input){
 const fps=Number(input.fps||8),quality=String(input.quality||'low'),model=String(input.model||'gpt-image-1.5');
 if(!ALLOWED_FPS.includes(fps))throw Error('Choose 8, 12 or 24 output frames per second');
 if(!VIDEO_MODELS.includes(model))throw Error('Unsupported GPT Image video-swap model');
 if(!VIDEO_QUALITIES.includes(quality))throw Error('Choose low, medium or high image quality');
 return {fps,quality,model,prompt:String(input.prompt||'').slice(0,1600),
   preserveAudio:input.preserveAudio!==false,continuity:input.continuity!==false};
}
export function videoFramePrompt(index,custom='',continuity=true){
 const base='Edit Image 1, the ORIGINAL video frame. Replace the ENTIRE main person (face, hair, body, clothes and accessories) with the person from Image 2, the fixed CHARACTER REFERENCE. Keep the original frame camera angle, background, objects, pose, motion moment, lighting and framing. Do not generate a new scene. ';
 const guide=index>1&&continuity?'Image 3 is the PREVIOUS EDITED VIDEO FRAME, used ONLY to keep the replacement character face, hair, clothing, glasses, colours and proportions consistent. Use the movement and pose from Image 1, NOT Image 3. ':'';
 return (base+guide+custom).slice(0,2400);
}
export function frameOutputSize(width,height){
 return width>height?'1536x1024':width<height?'1024x1536':'1024x1024';
}
export function minimumOutputEstimate(frames,width,height,quality,model){
 // Only GPT Image 1.5 low-quality output has a stable published floor
 // that we display; input images/tokens and editing tokens are EXTRA.
 if(model!=='gpt-image-1.5'||quality!=='low')return null;
 return +(frames*(width===height?STARTING_OUTPUT_LOW.square:width>height?STARTING_OUTPUT_LOW.landscape:STARTING_OUTPUT_LOW.portrait)).toFixed(3);
}
function ffmpegBinary(){
 if(process.env.FFMPEG_PATH)return process.env.FFMPEG_PATH;
 try{const f=require('@ffmpeg-installer/ffmpeg');if(f.path)return f.path;}catch{}
 return 'ffmpeg';
}
function runFFmpeg(args,timeoutMs=120000){
 return new Promise((resolve,reject)=>{
  const child=spawn(ffmpegBinary(),['-hide_banner','-nostdin','-y',...args],{stdio:['ignore','ignore','pipe']});
  let errors='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Video operation exceeded time limit'));},timeoutMs);
  child.stderr.on('data',data=>{errors=(errors+data.toString()).slice(-16000);});
  child.on('error',err=>{clearTimeout(timer);reject(Error('FFmpeg unavailable: '+err.message+'. Check server binary installation.'));});
  child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(errors);else reject(Error('FFmpeg failed: '+errors.slice(-800)));});
 });
}
function frameName(n){return String(n).padStart(6,'0')+'.png';}
const uuid=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
const imageRef=async id=>{
 const a=await readFile(id);
 if(a.length>IMAGE_LIMIT)throw Error('Input image is over 25MB');
 return a;
};
function receipt(job){
 return {id:job.id,status:job.status,error:job.error||'',fps:job.fps,frames:job.frames,
  duration:job.duration,outputSize:job.size,quality:job.quality,model:job.model,
  completedFrames:job.completedFrames||0,paidSubmissions:job.paidSubmissions||0,
  minOutputOnly:job.minOutputOnly,stage:job.stage||'',sourceHadAudio:job.preserveAudio,
  preview:job.completedFrames>=1?'/api/video-swap/'+job.id+'/preview':null,
  video:job.status==='completed'?'/api/video-swap/'+job.id+'/download':null};
}
export function createVideoSwapController({storage,asset,piapiKey,provider,pollIntervalMs=5000}){
 const jobs=new Map();
 let active=null;
 const folder=id=>path.join(storage,'video-swap-'+id);
 const safeJob=async id=>{
  if(!uuid(id))throw Error('Invalid video-swap ID');
  if(jobs.has(id))return jobs.get(id);
  let data;
  try{data=JSON.parse(await readFile(path.join(folder(id),'job.json'),'utf8'));}catch{throw Error('Video-swap job not found or expired after server restart');}
  if(['preparing','previewing','running','rendering'].includes(data.status)){
   data.status='interrupted';data.error='Server restarted or job was interrupted. Completed frames are retained if this server still has the temporary files; use Resume after checking the job.';
  }
  jobs.set(id,data);return data;
 };
 async function save(job){
  await writeFile(path.join(folder(job.id),'job.json'),JSON.stringify({...job,stop:false}),{mode:0o600});
 }
 const setStatus=async(job,status,stage='')=>{job.status=status;job.stage=stage;await save(job);};
 function getImageResult(output){
  const encoded=output?.data?.[0]?.b64_json;
  if(typeof encoded==='string'){
   if(encoded.length>IMAGE_LIMIT*1.5||!/^[A-Za-z0-9+/=\s]+$/.test(encoded))throw Error('GPT Image result too large or malformed');
   const bytes=Buffer.from(encoded,'base64');
   if(bytes.length>IMAGE_LIMIT||!bytes.subarray(0,8).equals(PNG_MAGIC))throw Error('GPT Image output was not a valid PNG');
   return bytes;
  }
  throw Error('PiAPI task completed without a base64 PNG image; no automatic paid retry will occur');
 }
 async function submitOne(job,index){
  if(job.stop)throw Error('Cancelled by user');
  const dir=folder(job.id);
  const base=await imageRef(path.join(dir,'frames',frameName(index)));
  const character=await asset(job.characterId);
  if(!['image/png','image/jpeg','image/webp'].includes(character.mime)||character.bytes.length>IMAGE_LIMIT)throw Error('Character reference expired or invalid');
  const form=new FormData();
  form.append('model',job.model);form.append('prompt',videoFramePrompt(index,job.prompt,job.continuity));
  form.append('quality',job.quality);form.append('size',job.size);form.append('n','1');form.append('output_format','png');
  form.append('image[]',new Blob([base],{type:'image/png'}),'original-frame-'+index+'.png');
  form.append('image[]',new Blob([character.bytes],{type:character.mime}),character.name||'character.png');
  if(index>1&&job.continuity){
   const previous=await imageRef(path.join(dir,'edited',frameName(index-1)));
   form.append('image[]',new Blob([previous],{type:'image/png'}),'previous-edited-frame.png');
  }
  // Count a possible billable request BEFORE the provider call. A gateway
  // timeout does not prove PiAPI failed to charge; we never automatically retry.
  job.paidSubmissions=(job.paidSubmissions||0)+1;await save(job);
  const submitted=await provider('https://api.piapi.ai/api/v1/images/edits/async',
   {method:'POST',headers:{'X-API-Key':piapiKey},body:form},45000);
  const created=submitted.data?.task_id?submitted.data:submitted;
  const taskId=created.task_id||created.id;
  if(typeof taskId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(taskId))throw Error('PiAPI did not return a task ID. Check PiAPI history before resuming: a charge might have occurred.');
  job.currentTask=taskId;await save(job);
  let response;
  for(let n=0;n<100;n++){
   if(job.stop)throw Error('Cancelled by user. An already-submitted PiAPI task may still be billed');
   await sleep(pollIntervalMs);
   response=await provider('https://api.piapi.ai/api/v1/task/'+encodeURIComponent(taskId),
    {headers:{'X-API-Key':piapiKey}},30000);
   const data=response.data&&typeof response.data==='object'?response.data:response;
   const status=String(data.status||'').toLowerCase();
   if(status==='completed'){
    const image=getImageResult(data.output||{});
    await writeFile(path.join(dir,'edited',frameName(index)),image,{mode:0o600});
    job.currentTask=null;job.completedFrames=index;await save(job);
    return;
   }
   if(['failed','cancelled','canceled'].includes(status)){
    job.currentTask=null;await save(job);
    throw Error('PiAPI failed on frame +index+': '+String(data.output?.error_body?.error?.message||data.error?.message||data.message||'Task rejected').slice(0,300));
   }
  }
  throw Error('PiAPI task timed out on frame '+index+'. Task ID '+taskId+'. No automatic paid retry.');
 }
 async function prepare(input){
  if(active)throw Error('Another video swap is already processing; finish or cancel it first');
  const opts=videoSwapSettings(input);
  const video=await asset(input.videoId,false),character=await asset(input.characterId,false);
  if(!video.mime.startsWith('video/')||!['video/mp4','video/quicktime'].includes(video.mime))throw Error('Upload a source MP4 or MOV');
  if(video.size>100*1024*1024)throw Error('Video too large');
  if(!['image/png','image/jpeg','image/webp'].includes(character.mime)||character.size>IMAGE_LIMIT)throw Error('Upload a JPG, PNG or WebP character reference under 25MB');
  const id=randomUUID(),dir=folder(id);
  const job={id,...opts,videoId:input.videoId,characterId:input.characterId,status:'preparing',stage:'Extracting frames — no PiAPI credits used',completedFrames:0,paidSubmissions:0,stop:false};
  jobs.set(id,job);await mkdir(path.join(dir,'frames'),{recursive:true});await mkdir(path.join(dir,'edited'),{recursive:true});
  await save(job);active=id;
  void (async()=>{
   try{
    // Source duration is checked again against extracted-frame count before ANY paid edit.
    const src=path.join(storage,video.id+'.bin');
    const times=await runFFmpeg(['-i',src,'-vf','fps='+opts.fps+',scale=640:-2','-frames:v',String(MAX_VIDEO_FRAMES+1),path.join(dir,'frames','%06d.png')],90000);
    const files=(await readdir(path.join(dir,'frames'))).filter(n=>/^\d{6}\.png$/.test(n)).sort();
    if(!files.length)throw Error('Video had no readable frames');
    if(files.length>MAX_VIDEO_FRAMES)throw Error('Clip has more than 240 sampled frames. Trim it or choose a lower FPS; no paid requests were made.');
    let duration=video.duration;
    if(!Number.isFinite(duration)||duration<=0)duration=files.length/opts.fps;
    if(duration>MAX_VIDEO_SECONDS+0.25)throw Error('Trim the video to 10 seconds or less before paying. Source duration: '+duration.toFixed(1)+' seconds.');
    // Detect orientation from source metadata if browser was unable to fill it.
    let width=Number(video.width),height=Number(video.height);
    if(!width||!height){const m=/(\d{2,5})x(\d{2,5})/.exec(times);if(m){width=+m[1];height=+m[2];}}
    if(!width||!height){width=16;height=9;}
    job.frames=files.length;job.duration=+duration.toFixed(2);job.size=frameOutputSize(width,height);
    const scale=Math.min(1,1280/Math.max(width,height));
    job.outputWidth=Math.max(2,Math.round(width*scale/2)*2);
    job.outputHeight=Math.max(2,Math.round(height*scale/2)*2);
    job.minOutputOnly=minimumOutputEstimate(files.length,width,height,opts.quality,opts.model);
    await setStatus(job,'ready','Prepared '+job.frames+' frames · no PiAPI charge');
   }catch(e){job.error=e.message;await setStatus(job,'failed','Video preparation failed · no credits spent');}
   finally{if(active===id)active=null;}
  })();
  return receipt(job);
 }
 async function preview(id){
  const job=await safeJob(id);
  if(active)throw Error('Another video-swap operation is in progress');
  if(job.status!=='ready')throw Error('Finish preparation first. Preview requires a prepared job.');
  active=id;await setStatus(job,'previewing','Editing frame 1 · paid PiAPI request');
  void (async()=>{try{
   await submitOne(job,1);await setStatus(job,'preview_ready','Review frame 1, then explicitly approve the remaining '+(job.frames-1)+' edits');
  }catch(e){job.error=e.message;await setStatus(job,'failed','Preview stopped. No automatic paid retry.');}
  finally{if(active===id)active=null;}})();
  return receipt(job);
 }
 async function continueJob(id){
  const job=await safeJob(id);
  if(active)throw Error('Another video-swap operation is in progress');
  if(!['preview_ready','interrupted','failed'].includes(job.status)||!job.completedFrames)throw Error('Approve the first-frame preview before processing more frames');
  if(job.currentTask)throw Error('A previous PiAPI task may still be running or billed ('+job.currentTask+'). Check its status in PiAPI before resuming.');
  if(job.completedFrames>=job.frames)throw Error('All frames already processed');
  job.stop=false;job.error='';active=id;await setStatus(job,'running','Processing frame '+(job.completedFrames+1)+' of '+job.frames);
  void (async()=>{try{
   for(let i=job.completedFrames+1;i<=job.frames;i++){
    if(job.stop)throw Error('Cancelled by user');
    job.stage='Processing frame '+i+' of '+job.frames;await save(job);
    await submitOne(job,i);
   }
   await setStatus(job,'rendering','Rebuilding MP4 and restoring the original audio');
   const dir=folder(job.id),source=path.join(storage,job.videoId+'.bin');
   const args=['-framerate',String(job.fps),'-start_number','1','-i',path.join(dir,'edited','%06d.png'),
    '-i',source,'-map','0:v:0',...(job.preserveAudio?['-map','1:a?']:[]),
    '-vf','scale='+job.outputWidth+':'+job.outputHeight+':force_original_aspect_ratio=increase,crop='+job.outputWidth+':'+job.outputHeight,
    '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
    ...(job.preserveAudio?['-c:a','aac','-b:a','128k']:[]),
    '-t',String(job.frames/job.fps),'-movflags','+faststart',path.join(dir,'result.mp4')];
   await runFFmpeg(args,120000);
   await setStatus(job,'completed','MP4 ready with original audio if present');
  }catch(e){job.error=e.message;await setStatus(job,job.stop?'cancelled':'failed','Stopped after '+job.completedFrames+' frames. Completed frames are retained while storage persists.');}
  finally{if(active===id)active=null;}})();
  return receipt(job);
 }
 async function cancel(id){
  const job=await safeJob(id);
  job.stop=true;job.stage='Cancellation requested · current PiAPI task may still cost credits';
  await save(job);return receipt(job);
 }
 async function status(id){return receipt(await safeJob(id));}
 async function stream(id,kind,res){
  const job=await safeJob(id);
  if(kind==='preview'&&job.completedFrames<1)throw Error('Preview image is not ready');
  if(kind==='download'&&job.status!=='completed')throw Error('Final MP4 not ready');
  const file=kind==='preview'?path.join(folder(id),'edited','000001.png'):path.join(folder(id),'result.mp4');
  const info=await stat(file);
  res.writeHead(200,{'Content-Type':kind==='preview'?'image/png':'video/mp4','Content-Length':info.size,
   'Content-Disposition':kind==='download'?'attachment; filename="filmbuilder-character-swap.mp4"':'inline','Cache-Control':'private,no-store','Accept-Ranges':'none'});
  createReadStream(file).pipe(res);
 }
 return {prepare,preview,continueJob,cancel,status,stream};
}
