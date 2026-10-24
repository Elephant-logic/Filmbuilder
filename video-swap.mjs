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
export const MAX_VIDEO_FRAMES=300;
export const MAX_VIDEO_SECONDS=10;
export const ALLOWED_FPS=[8,12,24,30];
export const VIDEO_MODELS=['gpt-image-1.5','gpt-image-2.5-flare','gpt-image-2.5-sunburst'];
export const VIDEO_QUALITIES=['low','medium','high'];
export const IMAGE_PROVIDERS=['piapi','openai'];
const PNG_MAGIC=Buffer.from([137,80,78,71,13,10,26,10]);
const IMAGE_LIMIT=25*1024*1024;
const STARTING_OUTPUT_LOW={square:0.009,landscape:0.013,portrait:0.013};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function videoSwapSettings(input){
 const fps=Number(input.fps||24),quality=String(input.quality||'low'),model=String(input.model||'gpt-image-1.5');
 const imageProvider=String(input.imageProvider||'piapi');
 if(!IMAGE_PROVIDERS.includes(imageProvider))throw Error('Choose PiAPI or OpenAI Direct');
 if(!ALLOWED_FPS.includes(fps))throw Error('Choose 8, 12, 24 or 30 output frames per second');
 if(!VIDEO_MODELS.includes(model))throw Error('Unsupported GPT Image video-swap model');
 if(!VIDEO_QUALITIES.includes(quality))throw Error('Choose low, medium or high image quality');
 return {fps,quality,model,imageProvider,prompt:String(input.prompt||'').slice(0,1600),
   preserveAudio:input.preserveAudio!==false,continuity:input.continuity!==false};
}
export function videoFramePrompt(index,custom='',continuity=true){
 const base='Edit Image 1 (the CURRENT ORIGINAL VIDEO FRAME). Completely remove the original visible person and replace their ENTIRE appearance using Image 2 (the CHARACTER REFERENCE): face, skin details, head, hair, hat, clothing, jacket, body, hands and accessories. Do not leave any traces of the original actor\'s face, clothes, colours or accessories. Match ONLY the original actor\'s pose, expression, head angle, mouth shape, body position, scale and motion instant from Image 1. Preserve the source video\'s background, camera position, perspective, scene, lighting and objects. Do not create a new scene. ';
 const anchor=index>1?'Image 3 is the LOCKED APPROVED FIRST EDITED FRAME: it shows the correct finished replacement person. It is the PRIMARY visual authority for the new character\'s identity and appearance, including face, hair, clothing and accessories. Match Image 3\'s replacement character exactly, but NEVER copy its pose, motion moment or background: those come ONLY from Image 1. ':'';
 const previous=index>2&&continuity?'Image 4 is the PREVIOUS EDITED FRAME, a SECONDARY guide for smooth changes from the previous moment. If it disagrees with Image 3 about the correct clothing, face or appearance, ALWAYS follow Image 3. Do not borrow motion or pose from Image 4. ':'';
 return (base+anchor+previous+custom).slice(0,3200);
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
  duration:job.duration,outputSize:job.size,quality:job.quality,model:job.model,imageProvider:job.imageProvider||'piapi',
  completedFrames:job.completedFrames||0,paidSubmissions:job.paidSubmissions||0,
  anchorLocked:!!job.anchorLocked,continuity:job.continuity!==false,
  minOutputOnly:job.minOutputOnly,stage:job.stage||'',sourceHadAudio:job.preserveAudio,
  preview:job.completedFrames>=1?'/api/video-swap/'+job.id+'/preview':null,
  video:job.status==='completed'?'/api/video-swap/'+job.id+'/download':null};
}
export function createVideoSwapController({storage,asset,piapiKey,openaiKey='',provider,pollIntervalMs=5000}){
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
  throw Error('Image edit returned no valid base64 PNG; no automatic paid retry');
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
  if(index>1){
   // The first approved result stays immutable as our master character guide.
   // We DO NOT use just the preceding frame: that can compound old-subject leakage.
   const anchor=await imageRef(path.join(dir,'anchor.png'));
   form.append('image[]',new Blob([anchor],{type:'image/png'}),'locked-first-approved-frame.png');
   if(index>2&&job.continuity){
    // Frame 2's previous frame IS the anchor. Don't bill for a duplicate
    // input. From frame 3 on, include the independently changing last result.
    const previous=await imageRef(path.join(dir,'edited',frameName(index-1)));
    form.append('image[]',new Blob([previous],{type:'image/png'}),'previous-edited-frame.png');
   }
  }
  // Record a potential charge BEFORE calling either API. A timeout can still
  // be charged, and neither account should receive automatic paid retries.
  job.paidSubmissions=(job.paidSubmissions||0)+1;await save(job);
  let image;
  if((job.imageProvider||'piapi')==='openai'){
   // Direct OpenAI edits return the PNG synchronously. 2/3/4 input images
   // are sent in the same order as PiAPI. Do not use PiAPI task polling.
   // Persist an uncertain in-flight marker to prevent accidental resubmission
   // if the server restarts or the request fails after charging.
   job.currentTask='openai-direct-outcome-unknown';await save(job);
   let response;
   try{
    response=await provider('https://api.openai.com/v1/images/edits',
     {method:'POST',headers:{Authorization:'Bearer '+openaiKey},body:form},240000);
   }catch(e){
    throw Error('OpenAI Direct frame '+index+' could not be confirmed: '+String(e.message||e).slice(0,220)+'. Check OpenAI usage before retrying. No automatic paid retry.');
   }
   image=getImageResult(response);
  }else{
   const submitted=await provider('https://api.piapi.ai/api/v1/images/edits/async',
    {method:'POST',headers:{'X-API-Key':piapiKey},body:form},45000);
   const created=submitted.data?.task_id?submitted.data:submitted;
   const taskId=created.task_id||created.id;
   if(typeof taskId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(taskId))throw Error('PiAPI task ID missing. Check PiAPI charges before restarting.');
   job.currentTask=taskId;await save(job);
   for(let n=0;n<100;n++){
    if(job.stop)throw Error('Cancelled by user. Already-submitted PiAPI tasks may still be billed');
    await sleep(pollIntervalMs);
    const response=await provider('https://api.piapi.ai/api/v1/task/'+encodeURIComponent(taskId),
     {headers:{'X-API-Key':piapiKey}},30000);
    const data=response.data&&typeof response.data==='object'?response.data:response;
    const status=String(data.status||'').toLowerCase();
    if(status==='completed'){image=getImageResult(data.output||{});break;}
    if(['failed','cancelled','canceled'].includes(status)){
     job.currentTask=null;await save(job);
     throw Error('PiAPI frame '+index+' failed: '+String(data.output?.error_body?.error?.message||data.error?.message||data.message||'Task rejected').slice(0,300));
    }
   }
   if(!image)throw Error('PiAPI task '+taskId+' timed out on frame '+index+'. No automatic paid retry.');
  }
  await writeFile(path.join(dir,'edited',frameName(index)),image,{mode:0o600});
  if(index===1){
   await writeFile(path.join(dir,'anchor.png'),image,{flag:'wx',mode:0o600});
   job.anchorLocked=true;
  }
  job.currentTask=null;job.completedFrames=index;await save(job);
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
    await runFFmpeg(['-i',src,'-vf','fps='+opts.fps+',scale=640:640:force_original_aspect_ratio=decrease','-frames:v',String(MAX_VIDEO_FRAMES+1),path.join(dir,'frames','%06d.png')],90000);
    const files=(await readdir(path.join(dir,'frames'))).filter(n=>/^\d{6}\.png$/.test(n)).sort();
    if(!files.length)throw Error('Video had no readable frames');
    if(files.length>MAX_VIDEO_FRAMES)throw Error('Clip has more than '+MAX_VIDEO_FRAMES+' sampled frames. Trim it or choose a lower FPS; no paid requests were made.');
    let duration=video.duration;
    if(!Number.isFinite(duration)||duration<=0)duration=files.length/opts.fps;
    if(duration>MAX_VIDEO_SECONDS+0.25)throw Error('Trim the video to 10 seconds or less before paying. Source duration: '+duration.toFixed(1)+' seconds.');
    // Video width/height metadata can describe the unrotated sensor pixels.
    // FFmpeg autorotates display-matrix tags as it extracts frames. Read the
    // ACTUAL first extracted PNG dimensions, not upload/MP4 metadata, to
    // preserve portrait phone recordings and their true output orientation.
    const header=await readFile(path.join(dir,'frames',files[0]));
    if(header.length<24||!header.subarray(0,8).equals(PNG_MAGIC))throw Error('Extracted first frame was not a valid PNG');
    const width=header.readUInt32BE(16),height=header.readUInt32BE(20);
    if(width<16||height<16||width>8192||height>8192)throw Error('Invalid extracted video dimensions');
    job.frames=files.length;job.duration=+duration.toFixed(2);job.size=frameOutputSize(width,height);
    const scale=Math.min(2,1280/Math.max(width,height));
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
  if((job.imageProvider||'piapi')==='openai'?!openaiKey:!piapiKey)throw Error('Selected image provider API key is not configured in Render');
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
  if((job.imageProvider||'piapi')==='openai'?!openaiKey:!piapiKey)throw Error('Selected image provider API key is not configured in Render');
  if(!['preview_ready','interrupted','failed'].includes(job.status)||!job.completedFrames)throw Error('Approve the first-frame preview before processing more frames');
  if(job.currentTask)throw Error('A previous PiAPI task may still be running or billed ('+job.currentTask+'). Check its status in PiAPI before resuming.');
  if(job.completedFrames>=job.frames)throw Error('All frames already processed');
  // Migrate in-progress jobs from before the fixed anchor was introduced.
  // This is local filesystem work only and cannot spend PiAPI credits.
  const lockedFile=path.join(folder(job.id),'anchor.png');
  try{await imageRef(lockedFile);}
  catch{
   const approved=await imageRef(path.join(folder(job.id),'edited',frameName(1)));
   try{await writeFile(lockedFile,approved,{flag:'wx',mode:0o600});}
   catch(e){if(e.code!=='EEXIST')throw e;}
  }
  job.anchorLocked=true;await save(job);
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
