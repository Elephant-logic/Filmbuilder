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
 PRESETS:[{id:'seedance25',name:'Seedance 2.5',model:'seedance',task:'seedance-2.5',support:['image','video','audio']},{id:'seedance2fast',name:'Seedance 2 Fast',model:'seedance',task:'seedance-2-fast',support:['image','video','audio']}],
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
