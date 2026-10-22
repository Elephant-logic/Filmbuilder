import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const page=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const pieces=page.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);
if(!pieces)throw Error('Missing app JavaScript');
new vm.Script(pieces[1],{filename:'public/index.html <script>'});
console.log('Browser script syntax passed');

const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const start=server.indexOf('function task(b,refs){');
const end=server.indexOf('async function generate(b)',start);
if(start<0||end<0)throw Error('Task construction function not found');
const source=server.slice(start,end);
const sandbox={
 PRESETS:[{id:'seedance25',name:'Seedance 2.5',model:'seedance',task:'seedance-2.5',support:['image','video','audio']},{id:'seedance2fast',name:'Seedance 2 Fast',model:'seedance',task:'seedance-2-fast',support:['image','video','audio']},{id:'klingmotion',name:'Kling Motion Control',model:'kling',task:'motion_control',support:['image','video']},{id:'klingo1edit',name:'Kling O1',model:'kling',task:'omni_video_generation',support:['image','video']},
 {id:'nanoframe',name:'Nano Banana Frame',model:'gemini',task:'nano-banana-2.1',support:['image']},{id:'nanoframemask',name:'Nano Banana Mask Frame',model:'gemini',task:'nano-banana-2.1',support:['image']},{id:'kling3omni',name:'Kling 3.0 Omni',model:'kling',task:'omni_video_generation',support:['image','video']},{id:'videoswap',name:'Video FaceSwap',model:'Qubico/video-toolkit',task:'face-swap',support:['image','video']}],
 bad:(message)=>new Error(message)
};
const task=vm.runInNewContext(source+'; task',sandbox);
const edit=task(
 {preset:'seedance25',prompt:'Replace the character while keeping the camera movement.',action:'edit',resolution:'720p',duration:8,ratio:'16:9'},
 [{type:'video',url:'https://example.com/clip.mp4'},{type:'image',url:'https://example.com/face.webp'}]
);
assert.equal(edit.model,'seedance');
assert.equal(edit.task_type,'seedance-2.5');
assert.equal(edit.input.mode,'omni_reference');
assert.equal(edit.input.omni_reference_task_type,'edit');
assert.equal(edit.input.duration,-1);
assert.equal(edit.input.aspect_ratio,'adaptive');
assert.ok(edit.input.prompt.includes('@video1'));
assert.ok(edit.input.prompt.includes('@image1'));
assert.equal(edit.input.video_urls.length,1);
assert.equal(edit.input.image_urls.length,1);
const simple=task(
 {preset:'seedance25',prompt:'A castle at sunrise',action:'create',resolution:'720p',duration:5,ratio:'16:9'},[]
);
assert.equal(simple.input.mode,'text_to_video');
assert.equal(simple.input.duration,5);
assert.throws(()=>task(
 {preset:'seedance25',prompt:'Edit',action:'edit',duration:5,resolution:'720p'},[]
),/upload an MP4/);
assert.throws(()=>task(
 {preset:'invalid',prompt:'Edit',action:'edit'},[]
),/valid PiAPI model/);
console.log('PiAPI task preflight tests passed');
const sameRefs=[
 {type:'video',url:'https://example.com/motion.mp4'},
 {type:'image',url:'https://example.com/character.png'}
];
const motion=task({preset:'klingmotion',prompt:'Animate the illustrated hero using the movements in the reference clip',action:'create',duration:8},sameRefs);
assert.equal(motion.model,'kling');
assert.equal(motion.task_type,'motion_control');
assert.equal(motion.input.image_url,'https://example.com/character.png');
assert.equal(motion.input.video_url,'https://example.com/motion.mp4');
assert.equal(motion.input.version,'2.6');
assert.equal(motion.input.motion_direction,'video');
const swap=task({preset:'videoswap',action:'create'},sameRefs);
assert.equal(swap.model,'Qubico/video-toolkit');
assert.equal(swap.task_type,'face-swap');
assert.equal(swap.input.swap_image,'https://example.com/character.png');
assert.equal(swap.input.target_video,'https://example.com/motion.mp4');
assert.equal(swap.input.target_faces_index,'0');
assert.throws(()=>task({preset:'videoswap',action:'create'},sameRefs.slice(0,1)),/face image/);
assert.throws(()=>task({preset:'klingmotion',prompt:'Animate',action:'create'},sameRefs.slice(1)),/motion-reference video/);
console.log('Dedicated face-swap and character-motion payload tests passed');
const o1=task({
 preset:'klingo1edit',action:'edit',
 prompt:'Replace the main person with the character in the image, keep the same kitchen.',
 resolution:'720p',duration:10,audio:true
},sameRefs);
assert.equal(o1.model,'kling');
assert.equal(o1.task_type,'omni_video_generation');
assert.equal(o1.input.version,'o1');
assert.equal(o1.input.video,'https://example.com/motion.mp4');
assert.equal(o1.input.images.length,1);
assert.equal(o1.input.images[0],'https://example.com/character.png');
assert.match(o1.input.prompt,/@video/);
assert.match(o1.input.prompt,/@image_1/);
assert.equal(o1.input.keep_original_audio,true);
assert.equal(o1.input.resolution,'720p');
assert.equal(o1.input.aspect_ratio,undefined,'Base-video edit must not set aspect ratio');
assert.equal(o1.config.service_mode,'public');
assert.match(server,/\['GET','HEAD'\]\.includes\(req\.method\).*public-media/, 'Signed media must support HEAD for providers');
assert.match(server,/if\(req\.method==='HEAD'\)return res\.end\(\)/, 'HEAD sends headers only');
assert.equal(o1.input.duration,undefined,'Video edits must not force a duration');
const nativeLength=task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:8},sameRefs);
assert.equal(nativeLength.input.duration,undefined,'A valid 8s source video must not force 5/10s output');
const adaptiveEdit=task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:10,ratio:'adaptive'},sameRefs);
assert.equal(adaptiveEdit.input.aspect_ratio,undefined,'Even a stale adaptive ratio must be omitted');
const portrait=task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:5,ratio:'9:16'},sameRefs);
assert.equal(portrait.input.aspect_ratio,undefined,'Portrait edit should use source framing');
assert.throws(()=>task({preset:'klingo1edit',action:'create',prompt:'replace',duration:5},sameRefs),/Edit existing video/);
assert.throws(()=>task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:5},sameRefs.slice(0,1)),/1–4/);
assert.throws(()=>task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:5},sameRefs.concat([{type:'video',url:'https://example.com/second.mp4'}])),/exactly one/);
console.log('Kling O1 same-scene character-replacement payload tests passed');
const omni=task({
 preset:'kling3omni',action:'create',prompt:'Generate a new video inspired by the scene.',
 ratio:'9:16',duration:8,resolution:'720p',audio:true
},sameRefs);
assert.equal(omni.model,'kling');
assert.equal(omni.task_type,'omni_video_generation');
assert.equal(omni.input.version,'3.0');
assert.equal(omni.input.video,'https://example.com/motion.mp4');
assert.equal(omni.input.images.length,1);
assert.equal(omni.input.images[0],'https://example.com/character.png');
assert.match(omni.input.prompt,/@video/);
assert.match(omni.input.prompt,/@image_1/);
assert.equal(omni.input.duration,8);
assert.equal(omni.input.aspect_ratio,'9:16');
assert.equal(omni.input.resolution,'720p');
assert.equal(omni.input.keep_original_audio,true);
assert.equal(omni.config.service_mode,'public');
assert.equal(omni.input.multi_shots,undefined);
assert.throws(()=>task({preset:'kling3omni',action:'edit',prompt:'test',duration:8},sameRefs),/NEW/);
assert.throws(()=>task({preset:'kling3omni',action:'create',prompt:'test',duration:8},sameRefs.slice(0,1)),/1–4/);
assert.throws(()=>task({preset:'kling3omni',action:'create',prompt:'test',duration:8},sameRefs.concat([{type:'video',url:'https://example.com/other.mp4'}])),/exactly one/);
assert.throws(()=>task({preset:'kling3omni',action:'create',prompt:'test',duration:16},sameRefs),/3 and 15/);
assert.throws(()=>task({preset:'kling3omni',action:'create',prompt:'test',duration:8,ratio:'adaptive'},sameRefs),/aspect ratio/);
const cleanTags=task({preset:'kling3omni',action:'create',prompt:'Use @video1 and @image1, keep movement',duration:8,ratio:'9:16'},sameRefs);
assert.match(cleanTags.input.prompt,/@video\b/);
assert.match(cleanTags.input.prompt,/@image_1\b/);
assert.doesNotMatch(cleanTags.input.prompt,/@video1|@image1/);
console.log('Kling 3.0 Omni multimodal video reference payload tests passed');


// The model has no native mask parameter. Masked mode uses local compositing.
const frameRefs=[{type:'image',url:'https://example.com/original-frame.png'},{type:'image',url:'https://example.com/replacement-character.png'}];
for(const mode of ['nanoframe','nanoframemask']){
 const req=task({preset:mode,action:'create',prompt:'Replace main actor, retain set',resolution:'1K',ratio:'9:16'},frameRefs);
 assert.equal(req.model,'gemini');
 assert.equal(req.task_type,'nano-banana-2.1');
 assert.equal(req.input.resolution,'1K');
 assert.equal(req.input.aspect_ratio,'9:16');
 assert.equal(req.input.output_format,'png');
 assert.equal(req.input.image_urls[0],'https://example.com/original-frame.png');
 assert.equal(req.input.image_urls[1],'https://example.com/replacement-character.png');
 assert.match(req.input.prompt,/IMAGE 1/);
 assert.match(req.input.prompt,/IMAGE 2/);
 assert.ok(!('mask' in req.input),'Mask must be applied client-side, not sent as unsupported API parameter');
 assert.throws(()=>task({preset:mode,action:'edit',prompt:'replace',resolution:'1K'},frameRefs),/image frame|Edit existing video/);
 assert.throws(()=>task({preset:mode,action:'create',prompt:'replace',resolution:'1K'},frameRefs.slice(0,1)),/exactly two images/);
 assert.throws(()=>task({preset:mode,action:'create',prompt:'replace',resolution:'1K'},frameRefs.concat([{type:'video',url:'https://example.com/clip.mp4'}])),/source video/);
 assert.throws(()=>task({preset:mode,action:'create',prompt:'replace',resolution:'1080p'},frameRefs),/resolution/);
}
assert.match(server,/proxyGeneratedImage/);
assert.ok(server.includes("'image/png'"),'Only documented image MIME types can be proxied');
assert.match(page,/id="frameMaskCanvas"/);
assert.match(page,/compositeMaskedFrame/);
assert.match(page,/uploadFrameMask/);
console.log('Nano Banana one-frame and local-mask compositing integration tests passed');

// PiAPI GPT Image 2.5 uses a DIFFERENT async edit endpoint, FormData image[],
// a true alpha mask (for Sunburst masked mode), and task polling returning base64.
const testGptOptions=vm.runInNewContext(source+'; gptFrameOptions',{...sandbox});
const flareOpts=testGptOptions({preset:'gptframeflare',action:'create',prompt:'Swap character',gptQuality:'low',ratio:'9:16'},[{},{}]);
assert.equal(flareOpts.model,'gpt-image-2.5-flare');
assert.equal(flareOpts.size,'1024x1536');
assert.equal(flareOpts.quality,'low');
assert.equal(flareOpts.n,1);
assert.match(flareOpts.prompt,/FIRST image/);
assert.match(flareOpts.prompt,/SECOND image/);
for(const mode of ['gpt15frame','gpt15framemask']){
 const o=testGptOptions({preset:mode,action:'create',prompt:'Replace performer',gptQuality:'low',ratio:'1:1'},[{},{}]);
 assert.equal(o.model,'gpt-image-1.5',mode+' should use the correct PiAPI model');
 assert.equal(o.quality,'low');
 assert.equal(o.size,'1024x1024');
 assert.equal(o.n,1);
 assert.match(o.prompt,/FIRST image/);
 assert.match(o.prompt,/SECOND image/);
 const portrait=testGptOptions({preset:mode,action:'create',prompt:'Replace performer',gptQuality:'medium',ratio:'9:16'},[{},{}]);
 assert.equal(portrait.size,'1024x1536');
 assert.equal(portrait.quality,'medium');
 assert.throws(()=>testGptOptions({preset:mode,action:'edit',prompt:'Swap',ratio:'1:1'},[{},{}]),/Create/);
 assert.throws(()=>testGptOptions({preset:mode,action:'create',prompt:'Swap',ratio:'1:1'},[{}]),/two local images/);
}
const sunOpts=testGptOptions({preset:'gptframesunburst',action:'create',prompt:'Swap character',gptQuality:'high',ratio:'16:9'},[{},{}]);
assert.equal(sunOpts.model,'gpt-image-2.5-sunburst');
assert.equal(sunOpts.size,'1536x1024');
assert.equal(sunOpts.quality,'high');
assert.throws(()=>testGptOptions({preset:'gptframemask',action:'create',prompt:'Swap',gptQuality:'xhigh'},[{},{}]),/quality/);
assert.throws(()=>testGptOptions({preset:'gptframemask',action:'edit',prompt:'Swap'},[{},{}]),/Create/);
assert.throws(()=>testGptOptions({preset:'gptframemask',action:'create',prompt:'Swap'},[{}]),/two local images/);

const mockUploads=new Map([
 ['base',{id:'base',mime:'image/png',size:8,name:'original-frame.png',bytes:Buffer.from([137,80,78,71,13,10,26,10])}],
 ['character',{id:'character',mime:'image/jpeg',size:4,name:'character.jpg',bytes:Buffer.from([255,216,255,217])}],
 ['native-mask',{id:'native-mask',mime:'image/png',size:8,name:'native-mask.png',bytes:Buffer.from([137,80,78,71,13,10,26,10])}]
]);
let observed=null;
const mocks={...sandbox,FormData,Blob,Buffer,PIAPI:'test-key',
 asset:async id=>{if(!mockUploads.has(id))throw Error('Unknown test upload');return mockUploads.get(id);},
 provider:async (url,opts)=>{observed={url,opts};return {task_id:'synthetic-task',status:'pending'};}
};
const submitGpt=vm.runInNewContext(source+'; submitGPTFrame',mocks);
const flat=await submitGpt({
 preset:'gptframeflare',action:'create',prompt:'Change character',gptQuality:'low',ratio:'1:1',attachments:['base','character']
});
assert.equal(flat.id,'synthetic-task');
assert.equal(flat.gptImage,true);
assert.match(observed.url,/\/api\/v1\/images\/edits\/async$/);
assert.equal(observed.opts.method,'POST');
assert.equal(observed.opts.headers['X-API-Key'],'test-key');
assert.equal(observed.opts.body.get('quality'),'low');
assert.equal(observed.opts.body.get('size'),'1024x1024');
assert.equal(observed.opts.body.getAll('image[]').length,2);
assert.equal(observed.opts.body.getAll('image[]')[0].name,'original-frame.png');
assert.equal(observed.opts.body.getAll('image[]')[1].name,'character.jpg');
assert.equal(observed.opts.body.has('mask'),false);
const masked=await submitGpt({
 preset:'gptframemask',action:'create',prompt:'Change character',gptQuality:'medium',ratio:'9:16',
 attachments:['base','character'],nativeMaskId:'native-mask'
});
assert.equal(masked.gptImage,true);
assert.equal(observed.opts.body.get('model'),'gpt-image-2.5-sunburst');
assert.equal(observed.opts.body.get('quality'),'medium');
assert.equal(observed.opts.body.get('mask').name,'transparent-edit-mask.png');
assert.equal(observed.opts.body.getAll('image[]').length,2);
const newBasic=await submitGpt({
 preset:'gpt15frame',action:'create',prompt:'Change whole person',gptQuality:'low',ratio:'1:1',attachments:['base','character']
});
assert.equal(newBasic.gptImage,true);
assert.equal(observed.opts.body.get('model'),'gpt-image-1.5');
assert.equal(observed.opts.body.get('quality'),'low');
assert.equal(observed.opts.body.getAll('image[]').length,2);
assert.equal(observed.opts.body.has('mask'),false);
const newMasked=await submitGpt({
 preset:'gpt15framemask',action:'create',prompt:'Change whole person',gptQuality:'medium',ratio:'9:16',
 attachments:['base','character'],nativeMaskId:'native-mask'
});
assert.equal(newMasked.gptImage,true);
assert.equal(observed.opts.body.get('model'),'gpt-image-1.5');
assert.equal(observed.opts.body.get('quality'),'medium');
assert.equal(observed.opts.body.getAll('image[]').length,2);
assert.equal(observed.opts.body.get('mask').name,'transparent-edit-mask.png');
await assert.rejects(()=>submitGpt({preset:'gpt15framemask',action:'create',prompt:'Swap',attachments:['base','character']}),/Paint/);
assert.match(page,/gpt15framemask/);
assert.match(page,/0\.009/);
await assert.rejects(()=>submitGpt({preset:'gptframemask',action:'create',prompt:'Swap',attachments:['base','character']}),/Paint/);
await assert.rejects(()=>submitGpt({preset:'gptframeflare',action:'create',prompt:'Swap',attachments:['base','character'],urls:[{url:'https://example.com/x.png',type:'image'}]}),/no hosted links/);
assert.match(server,/gptFrameStatus/);
assert.match(server,/streamGPTImage/);
assert.match(server,/b64_json/);
assert.match(page,/uploadNativeGPTMask/);
assert.match(page,/id="gptQuality"/);
assert.match(page,/gptQuality:/);
assert.match(page,/\?\x27\/api\/gpt-task\/\x27/);
const fakePng=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
let cacheWritten=null;
const gptStatus=vm.runInNewContext(source+'; gptFrameStatus',{
 ...sandbox,Buffer,STORAGE:'/synthetic-storage',PIAPI:'test-key',path:await import('node:path'),
 stat:async()=>{throw Error('not cached');},
 writeFile:async (file,bytes)=>{cacheWritten={file,bytes};},
 provider:async()=>({task_id:'fake-task',status:'completed',output:{data:[{b64_json:fakePng.toString('base64')}],usage:{total_tokens:3000}}})
});
const taskReceipt=await gptStatus('fake-task');
assert.equal(taskReceipt.status,'completed');
assert.equal(taskReceipt.gptImage,true);
assert.equal(taskReceipt.media[0].url,'/api/gpt-image/fake-task');
assert.ok(cacheWritten.bytes.equals(fakePng));
assert.equal(taskReceipt.raw,undefined,'No raw base64 provider task is stored by the browser');
assert.ok(!JSON.stringify(taskReceipt).includes(fakePng.toString('base64')));
console.log('GPT Image private base64 image caching and response tests passed');

console.log('GPT Image 2.5 async edit payload, masks, quality, and safe output tests passed');

const videoCode=server.slice(server.indexOf('async function mp4Duration(file){'),server.indexOf('async function uploadBinary(req){'));
if(!videoCode.startsWith('async function mp4Duration'))throw Error('Video duration parser missing');
const {open,writeFile,mkdtemp,rm}=await import('node:fs/promises');
const {tmpdir}=await import('node:os');
const {join}=await import('node:path');
const readDuration=vm.runInNewContext(videoCode+'; mp4Duration',{open,Buffer,Number,Math,BigInt});
function mp4box(type,data){
 const header=Buffer.alloc(8);
 header.writeUInt32BE(data.length+8,0);
 header.write(type,4,'ascii');
 return Buffer.concat([header,data]);
}
const temp=await mkdtemp(join(tmpdir(),'framecraft-video-duration-'));
try{
 const mvhd=Buffer.alloc(20);
 mvhd.writeUInt32BE(1000,12);
 mvhd.writeUInt32BE(8500,16);
 const movie=mp4box('moov',mp4box('mvhd',mvhd));
 const file=join(temp,'valid.mp4');
 await writeFile(file,Buffer.concat([mp4box('ftyp',Buffer.alloc(4)),mp4box('mdat',Buffer.alloc(128)),movie]));
 assert.equal(await readDuration(file),8.5,'MP4 duration should be parsed even when moov is at the end');
 const mvhd64=Buffer.alloc(32);
 mvhd64[0]=1;
 mvhd64.writeUInt32BE(1000,20);
 mvhd64.writeBigUInt64BE(42000n,24);
 await writeFile(file,mp4box('moov',mp4box('mvhd',mvhd64)));
 assert.equal(await readDuration(file),42,'QuickTime version 1 movie-header duration');
}finally{
 await rm(temp,{recursive:true,force:true});
}
const helperStart=page.indexOf('function timeLabel(');
const helperEnd=page.indexOf('function renderAssets()',helperStart);
if(helperStart<0||helperEnd<0)throw Error('Video-length UI helpers missing');
const formatters=vm.runInNewContext(page.slice(helperStart,helperEnd)+';({timeLabel,durationWarning})',{Number,Math});
assert.equal(formatters.timeLabel(65.2),'1:05.2');
assert.match(formatters.durationWarning({mime:'video/mp4',duration:31}),/Too long/);
assert.match(formatters.durationWarning({mime:'video/mp4',duration:3}),/Too short/);
assert.equal(formatters.durationWarning({mime:'video/mp4',duration:8}), '');
console.log('MP4 duration and mobile UI preflight tests passed');

