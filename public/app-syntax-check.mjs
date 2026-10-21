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
 PRESETS:[{id:'seedance25',name:'Seedance 2.5',model:'seedance',task:'seedance-2.5',support:['image','video','audio']},{id:'seedance2fast',name:'Seedance 2 Fast',model:'seedance',task:'seedance-2-fast',support:['image','video','audio']},{id:'klingmotion',name:'Kling Motion Control',model:'kling',task:'motion_control',support:['image','video']},{id:'klingo1edit',name:'Kling O1',model:'kling',task:'omni_video_generation',support:['image','video']},{id:'videoswap',name:'Video FaceSwap',model:'Qubico/video-toolkit',task:'face-swap',support:['image','video']}],
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
assert.equal(o1.input.aspect_ratio,'16:9');
assert.match(server,/\['GET','HEAD'\]\.includes\(req\.method\).*public-media/, 'Signed media must support HEAD for providers');
assert.match(server,/if\(req\.method==='HEAD'\)return res\.end\(\)/, 'HEAD sends headers only');
assert.equal(o1.input.duration,undefined,'Video edits must not force a duration');
const nativeLength=task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:8},sameRefs);
assert.equal(nativeLength.input.duration,undefined,'A valid 8s source video must not force 5/10s output');
assert.throws(()=>task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:10,ratio:'adaptive'},sameRefs),/aspect ratio/);
const portrait=task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:5,ratio:'9:16'},sameRefs);
assert.equal(portrait.input.aspect_ratio,'9:16');
assert.throws(()=>task({preset:'klingo1edit',action:'create',prompt:'replace',duration:5},sameRefs),/Edit existing video/);
assert.throws(()=>task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:5},sameRefs.slice(0,1)),/1–4/);
assert.throws(()=>task({preset:'klingo1edit',action:'edit',prompt:'replace',duration:5},sameRefs.concat([{type:'video',url:'https://example.com/second.mp4'}])),/exactly one/);
console.log('Kling O1 same-scene character-replacement payload tests passed');


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

