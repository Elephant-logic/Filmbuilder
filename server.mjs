import http from 'node:http';
import { readFile,writeFile,mkdir,open,unlink,stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID,randomBytes,createHmac,timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const STORAGE=path.join(ROOT,'data');
const MAX_LOCAL_UPLOAD=100*1024*1024;
const MEDIA_HOST=(process.env.PUBLIC_BASE_URL||'https://filmbuilder-framecraft.onrender.com').replace(/\/$/,'');
await mkdir(STORAGE,{recursive:true});
try { const s=await readFile(path.join(ROOT,'.env'),'utf8');for(const line of s.split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2];} } catch{}
const HOST=process.env.HOST||'0.0.0.0',PORT=Number(process.env.PORT)||3000;
const OPENAI=process.env.OPENAI_API_KEY||'',PIAPI=process.env.PIAPI_API_KEY||'';
const PASSWORD=process.env.APP_PASSWORD||'', DEMO=process.env.DEMO_MODE==='true';
const RATE=new Map();
const PRESETS=[
{id:'seedance25',name:'Seedance 2.5',type:'video',model:'seedance',task:'seedance-2.5',support:['image','video','audio']},
{id:'seedance2fast',name:'Seedance 2 Fast',type:'video',model:'seedance',task:'seedance-2-fast',support:['image','video','audio']},
{id:'seedream5',name:'Seedream 5 Lite',type:'image',model:'seedream',task:'seedream-5-lite',support:['image']},
{id:'seedream5pro',name:'Seedream 5 Pro',type:'image',model:'seedream',task:'seedream-5-pro',support:['image']},
{id:'nanobanana21',name:'Nano Banana 2.1',type:'image',model:'gemini',task:'nano-banana-2.1',support:['image']},
{id:'nanobananapro',name:'Nano Banana Pro',type:'image',model:'gemini',task:'nano-banana-pro',support:['image']},
{id:'kling3',name:'Kling 3.0',type:'video',model:'kling',task:'video_generation',support:['image']},
{id:'veo31',name:'Veo 3.1 Fast',type:'video',model:'veo3.1',task:'veo3.1-video-fast',support:['image']},
{id:'wan26',name:'Wan 2.6',type:'video',model:'Wan',task:'wan26-txt2video',support:[]},
{id:'luma2',name:'Luma Ray 2',type:'video',model:'luma',task:'video_generation',support:['image']},
{id:'custom',name:'Custom Unified API',type:'custom',support:['image','video','audio']}
];
const MIME={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','video/mp4':'.mp4','video/quicktime':'.mov','audio/mpeg':'.mp3','audio/wav':'.wav'};
const bad=(msg,status=400)=>Object.assign(new Error(msg),{status});
function send(res,code,value){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function go(res,location,cookie){res.writeHead(303,{'Location':location,'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})});res.end();}
function checkPassword(value){const a=Buffer.from(value||''),b=Buffer.from(PASSWORD);return !!PASSWORD&&a.length===b.length&&timingSafeEqual(a,b);}
function session(){const exp=String(Date.now()+7*86400000);const sig=createHmac('sha256',PASSWORD).update(exp).digest('hex');return exp+'.'+sig;}
function authenticated(req){if(!PASSWORD)return false;const c=(req.headers.cookie||'').match(/(?:^|;\s*)studio=([0-9]+\.[0-9a-f]{64})/);if(!c)return false;const [exp,sig]=c[1].split('.');if(Number(exp)<Date.now())return false;const expected=createHmac('sha256',PASSWORD).update(exp).digest('hex');return timingSafeEqual(Buffer.from(sig),Buffer.from(expected));}
function sameOrigin(req){
 const site=String(req.headers['sec-fetch-site']||'').toLowerCase();
 if(site==='cross-site')return false;
 if(site==='same-origin')return true;
 if(!req.headers.origin)return true;
 try{
  const origin=new URL(req.headers.origin),actualHost=String(req.headers.host||'').toLowerCase();
  const forwarded=String(req.headers['x-forwarded-host']||'').toLowerCase();
  const official='filmbuilder-framecraft.onrender.com';
  return (origin.host.toLowerCase()===actualHost)||(origin.protocol==='https:'&&(origin.host.toLowerCase()===official||origin.host.toLowerCase()===forwarded&&forwarded===official));
 }catch{return false;}
}
// The login CSRF token is self-contained: mobile in-app browsers sometimes drop
// the temporary cookie between displaying the form and submitting it.
const LOGIN_CSRF_KEY=randomBytes(32);
function newLoginToken(){
 const issued=Math.floor(Date.now()/1000).toString(36);
 const nonce=randomBytes(20).toString('hex');
 const payload=issued+'.'+nonce;
 return payload+'.'+createHmac('sha256',LOGIN_CSRF_KEY).update(payload).digest('hex');
}
function validLoginToken(submitted){
 if(typeof submitted!=='string')return false;
 const m=/^([0-9a-z]{1,10})\.([0-9a-f]{40})\.([0-9a-f]{64})$/.exec(submitted);
 if(!m)return false;
 const issued=parseInt(m[1],36),now=Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(issued)||issued>now+60||issued<now-900)return false;
 const expected=createHmac('sha256',LOGIN_CSRF_KEY).update(m[1]+'.'+m[2]).digest('hex');
 return timingSafeEqual(Buffer.from(m[3]),Buffer.from(expected));
}
async function body(req,max=15*1024*1024){const arr=[];let n=0;for await(const b of req){n+=b.length;if(n>max)throw bad('Request too large',413);arr.push(b);}return Buffer.concat(arr).toString();}
async function json(req){try{return JSON.parse(await body(req));}catch(e){if(e.status)throw e;throw bad('Invalid JSON');}}
async function provider(url,opts,ms=90000){const ct=new AbortController(),timer=setTimeout(()=>ct.abort(),ms);try{const r=await fetch(url,{...opts,signal:ct.signal});const t=await r.text();let j;try{j=JSON.parse(t)}catch{throw bad('Provider returned a non-JSON response',502)}if(!r.ok||(j.code&&!['200','201'].includes(String(j.code))))throw bad('Provider rejected request: '+String(j.message||j.error?.message||r.status),r.status===401||r.status===403?403:502);return j;}finally{clearTimeout(timer)}}
async function asset(id,loadBytes=true){
 if(!/^[0-9a-f-]{36}$/.test(id))throw bad('Invalid attachment ID');
 let m;try{m=JSON.parse(await readFile(path.join(STORAGE,id+'.json'),'utf8'))}catch{throw bad('Attachment missing or expired',404)}
 if(!loadBytes)return m;
 return {...m,bytes:await readFile(path.join(STORAGE,id+'.bin'))};
}
function mediaSignature(id,exp){return createHmac('sha256',PASSWORD).update('media:'+id+':'+exp).digest('hex')}
function signedMediaUrl(id){
 if(!PASSWORD)throw bad('Studio login password missing',503);
 const exp=Math.floor(Date.now()/1000)+6*3600;
 return MEDIA_HOST+'/public-media/'+id+'?expires='+exp+'&signature='+mediaSignature(id,exp);
}
function mediaAllowed(req,id){
 if(!PASSWORD)return false;
 const q=new URL(req.url||'/', 'http://localhost').searchParams;
 const exp=Number(q.get('expires')),sig=q.get('signature')||'';
 if(!Number.isSafeInteger(exp)||exp<Math.floor(Date.now()/1000)||exp>Math.floor(Date.now()/1000)+6*3600+60)return false;
 if(!/^[0-9a-f]{64}$/.test(sig))return false;
 return timingSafeEqual(Buffer.from(sig),Buffer.from(mediaSignature(id,exp)));
}
async function streamMedia(req,res,id){
 const meta=await asset(id,false),file=path.join(STORAGE,id+'.bin'),size=(await stat(file)).size;
 const range=String(req.headers.range||'');
 let start=0,end=size-1,code=200;
 if(range){
  const m=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!m){res.writeHead(416,{'Content-Range':'bytes */'+size});return res.end()}
  start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]||0));
  end=m[2]&&m[1]?Number(m[2]):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'Content-Range':'bytes */'+size});return res.end()}
  end=Math.min(end,size-1);code=206;
 }
 const headers={'Content-Type':meta.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private,no-store'};
 if(code===206)headers['Content-Range']='bytes '+start+'-'+end+'/'+size;
 res.writeHead(code,headers);
 const stream=createReadStream(file,{start,end});
 stream.on('error',()=>res.destroy());
 stream.pipe(res);
}
async function uploadBinary(req){
 let name;try{name=decodeURIComponent(String(req.headers['x-file-name']||''))}catch{throw bad('Invalid filename')}
 name=path.basename(name).replace(/[\x00-\x1f]/g,'').slice(0,128);
 const ext=path.extname(name).toLowerCase();
 const byExt={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.mp4':'video/mp4','.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav'};
 const mime=byExt[ext];
 if(!mime)throw bad('Supported formats: JPG, PNG, WEBP, MP4, MOV, MP3, WAV');
 const claimed=Number(req.headers['content-length']);
 if(Number.isFinite(claimed)&&claimed>MAX_LOCAL_UPLOAD)throw bad('Video or image is over 100 MB. Use a shorter clip or a hosted HTTPS URL.',413);
 const id=randomUUID(),file=path.join(STORAGE,id+'.bin');
 let size=0,handle=await open(file,'wx',0o600);
 try{
  for await(const chunk of req){
   if(size+chunk.length>MAX_LOCAL_UPLOAD)throw bad('Maximum file size is 100 MB. Trim/compress your video.',413);
   let position=0;
   while(position<chunk.length){
    const result=await handle.write(chunk,position,chunk.length-position,size+position);
    if(result.bytesWritten<=0)throw bad('Upload could not be written',500);
    position+=result.bytesWritten;
   }
   size+=chunk.length;
  }
  if(!size)throw bad('The selected file is empty');
  await handle.close();handle=null;
  const meta={id,name,mime,size,created:Date.now()};
  await writeFile(path.join(STORAGE,id+'.json'),JSON.stringify(meta),{mode:0o600});
  return {id,name,mime,size,url:'/api/media/'+id};
 }catch(e){
  if(handle)await handle.close().catch(()=>{});
  await unlink(file).catch(()=>{});
  throw e;
 }
}
async function upload(input){const {name,mime,base64}=input||{};if(!MIME[mime]||typeof name!=='string'||!name.toLowerCase().endsWith(MIME[mime]))throw bad('Allowed files: JPEG, PNG, WEBP, MP4, MP3, WAV');if(typeof base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw bad('Invalid file data');const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>10*1024*1024)throw bad('Maximum 10 MB per upload',413);const id=randomUUID(),m={id,name:name.slice(0,100),mime,size:bytes.length,created:Date.now()};await Promise.all([writeFile(path.join(STORAGE,id+'.bin'),bytes),writeFile(path.join(STORAGE,id+'.json'),JSON.stringify(m))]);return {id,name:m.name,mime,size:m.size,url:'/api/media/'+id};}
async function publish(id){if(!PIAPI)throw bad('PiAPI key not configured');const a=await asset(id);const j=await provider('https://upload.theapi.app/api/ephemeral_resource',{method:'POST',headers:{'X-API-Key':PIAPI,'Content-Type':'application/json'},body:JSON.stringify({file_name:a.name,file_data:a.bytes.toString('base64')})});const url=j?.data?.url;if(!url||!String(url).startsWith('https://'))throw bad('Upload URL missing from PiAPI response',502);return url;}
function outputMedia(data){const out=[],seen=new Set();function walk(v,k=''){if(!v||out.length>20)return;if(typeof v==='string'){if(v.startsWith('https://')&&(/image|video|url|audio|output/i.test(k)||/\.(mp4|webm|png|webp|jpe?g)(\?|$)/i.test(v))&&!seen.has(v)){seen.add(v);out.push({url:v,type:/video|\.mp4|\.webm/i.test(k+' '+v)?'video':/audio|\.mp3|\.wav/i.test(k+' '+v)?'audio':'image'});}}else if(Array.isArray(v))v.forEach(x=>walk(x,k));else if(typeof v==='object')Object.entries(v).forEach(([k2,x])=>walk(x,k2));}walk(data);return out;}
async function chat(b){if(!OPENAI){if(DEMO)return {reply:'Demo mode: add OPENAI_API_KEY for real GPT creative planning.',prompt:String(b.text||''),preset:'seedance25',shots:[]};throw bad('OpenAI API key missing');}const history=(Array.isArray(b.history)?b.history:[]).slice(-12).filter(x=>['assistant','user'].includes(x.role)&&typeof x.content==='string').map(x=>({role:x.role,content:x.content.slice(0,5000)}));const parts=[{type:'text',text:String(b.text||'').slice(0,7000)}];for(const id of (Array.isArray(b.attachments)?b.attachments:[]).slice(0,4)){const a=await asset(id,false);if(a.mime.startsWith('image/')&&a.size<6*1024*1024){const bytes=await readFile(path.join(STORAGE,a.id+'.bin'));parts.push({type:'image_url',image_url:{url:'data:'+a.mime+';base64,'+bytes.toString('base64'),detail:'low'}});}else parts[0].text+='\nReference uploaded: '+a.name+' ('+a.mime+'). Video/audio content was not visually reviewed.';}const system='You are a creative director helping plan images, commercials, shorts and cinematic videos. Choose one preset ID from: '+PRESETS.map(p=>p.id+':'+p.type).join(', ')+'. Consider reference material, consistency, visual quality, realism, constraints. Never claim you generated media. Video/audio uploads are metadata only and must not be described as fully reviewed. Reply ONLY with JSON containing keys reply (conversational answer), prompt (refined production prompt), preset (recommended preset ID), shots (array of {title,description,seconds}), ratio, duration, resolution. For image tasks pick an image preset. Use the user language.';const r=await provider('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+OPENAI,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',messages:[{role:'system',content:system},...history,{role:'user',content:parts}],response_format:{type:'json_object'},temperature:0.7})});const s=r?.choices?.[0]?.message?.content;if(!s)throw bad('Empty OpenAI response',502);try{return JSON.parse(s)}catch{throw bad('Could not parse GPT response',502)}}
function task(b,refs){const p=PRESETS.find(x=>x.id===b.preset);if(!p)throw bad('Choose a model');if(p.id==='custom'){const x=b.custom;if(!x||typeof x.model!=='string'||typeof x.task_type!=='string'||!x.input||typeof x.input!=='object')throw bad('Custom JSON needs model, task_type and input');return {model:x.model,task_type:x.task_type,input:x.input};}const prompt=String(b.prompt||'').trim();if(!prompt)throw bad('Enter a production prompt');const ratio=String(b.ratio||'16:9'),duration=Math.max(3,Math.min(30,Number(b.duration)||5)),resolution=String(b.resolution||'720p'),images=refs.filter(x=>x.type==='image').map(x=>x.url),videos=refs.filter(x=>x.type==='video').map(x=>x.url),audio=refs.filter(x=>x.type==='audio').map(x=>x.url),i={prompt};if(p.id.startsWith('seedance')){Object.assign(i,{mode:refs.length?'omni_reference':'text_to_video',aspect_ratio:ratio,duration,resolution});if(images.length)i.image_urls=images;if(videos.length)i.video_urls=videos;if(audio.length)i.audio_urls=audio;if(refs.length)i.auto_upload_assets=true;if(videos.length&&['edit','extend'].includes(b.action)){i.omni_reference_task_type=b.action;i.aspect_ratio='adaptive';if(b.action==='edit')i.duration=-1;}}else if(p.id.startsWith('seedream'))Object.assign(i,{aspect_ratio:ratio,size:b.resolution||'2K',output_format:'png',...(images.length?{image_urls:images}:{})});else if(p.id.startsWith('nano'))Object.assign(i,{aspect_ratio:ratio,resolution:b.resolution||'2K',output_format:'png',...(images.length?{image_urls:images}:{})});else if(p.id==='kling3')Object.assign(i,{aspect_ratio:ratio,version:'3.0',mode:'std',duration,enable_audio:!!b.audio,...(images.length?{image_url:images[0]}:{})});else if(p.id==='veo31')Object.assign(i,{aspect_ratio:ratio,resolution,duration:String(duration)+'s',generate_audio:!!b.audio,...(images.length?{image_url:images[0]}:{})});else if(p.id==='wan26')Object.assign(i,{aspect_ratio:ratio,resolution,duration,prompt_extend:true});else if(p.id==='luma2')Object.assign(i,{model:'ray-v2',aspect_ratio:ratio,duration,loop:false,...(images.length?{start_image:images[0]}:{})});return {model:p.model,task_type:p.task,input:i};}
async function generate(b){if(!PIAPI)throw bad('PiAPI key missing');const p=PRESETS.find(x=>x.id===b.preset);if(!p)throw bad('Invalid model');const refs=[];if(p.id!=='custom'){for(const id of (b.attachments||[]).slice(0,8)){const a=await asset(id,false),t=a.mime.split('/')[0];if(p.support.includes(t))refs.push({type:t,url:signedMediaUrl(id)});}for(const r of (Array.isArray(b.urls)?b.urls:[]).slice(0,12)){if(!r||typeof r.url!=='string'||!r.url.startsWith('https://'))continue;if(p.support.includes(r.type))refs.push({type:r.type,url:r.url});}}const payload=task(b,refs);const r=await provider('https://api.piapi.ai/api/v1/task',{method:'POST',headers:{'X-API-Key':PIAPI,'Content-Type':'application/json'},body:JSON.stringify(payload)});return {id:r.data?.task_id,status:r.data?.status||'submitted',model:p.name,media:outputMedia(r.data?.output),raw:r.data||{}};}
async function status(id){if(!PIAPI)throw bad('PiAPI key missing');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw bad('Invalid task id');const r=await provider('https://api.piapi.ai/api/v1/task/'+encodeURIComponent(id),{headers:{'X-API-Key':PIAPI}});return {id,status:r.data?.status,media:outputMedia(r.data?.output),error:r.data?.error?.message||'',raw:r.data||{}};}
const LOGIN='<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Framecraft • Sign in</title><style>body{font:16px system-ui;background:#0c101b;color:#fff;min-height:100vh;display:grid;place-items:center;margin:0}main{background:#1a2234;border:1px solid #384057;padding:32px;border-radius:18px;width:min(380px,85vw)}input,button{display:block;width:100%;box-sizing:border-box;padding:14px;margin-top:12px;border-radius:10px;font-size:16px}input{background:#0d1322;color:#fff;border:1px solid #58647d}button{background:#7a9aff;border:0;color:#0a172c;font-weight:bold}p{color:#aebbd1}</style><main><h1>Framecraft Studio</h1><p>Private GPT + PiAPI filmmaking workspace</p><form method="POST" action="/auth/login"><input type="password" name="password" placeholder="Studio password" required><button>Sign in</button></form></main></html>';
const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');const route=new URL(req.url||'/', 'http://localhost').pathname;try{
if(req.method==='GET'&&route==='/api/health')return send(res,200,{ok:true,configured:!!PASSWORD});
if(req.method==='GET'&&route.startsWith('/public-media/')){
 const id=route.slice('/public-media/'.length);
 if(!/^[0-9a-f-]{36}$/.test(id)||!mediaAllowed(req,id))throw bad('Reference link invalid or expired',403);
 return streamMedia(req,res,id);
}
if(req.method==='GET'&&route==='/login'){
 const token=newLoginToken();
 const reason=new URL(req.url||'/', 'http://localhost').searchParams;
 const msg=reason.has('expired')?'The sign-in page expired. Please try again.':reason.has('invalid')?'Incorrect password. Please try again.':'';
 const page=LOGIN.replace('</form>','<input type="hidden" name="csrf" value="'+token+'"></form>')
   .replace('<p>Private GPT + PiAPI filmmaking workspace</p>','<p>Private GPT + PiAPI filmmaking workspace</p>'+(msg?'<p role="alert">'+msg+'</p>':''));
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
 return res.end(page);
}
if(req.method==='POST'&&route==='/auth/login'){
 const ip=String(req.socket.remoteAddress||'local');
 const entry=RATE.get(ip)||{n:0,until:Date.now()+900000};
 if(entry.until<Date.now()){entry.n=0;entry.until=Date.now()+900000;}
 entry.n++;RATE.set(ip,entry);
 if(entry.n>12)throw bad('Too many login attempts',429);
 const form=new URLSearchParams(await body(req,4096));
 if(String(req.headers['sec-fetch-site']||'').toLowerCase()==='cross-site')throw bad('Cross-site sign-in blocked',403);
 if(!validLoginToken(form.get('csrf')))return go(res,'/login?expired=1');
 const pass=form.get('password')||'';
 if(!checkPassword(pass))return go(res,'/login?invalid=1');
 RATE.delete(ip);
 return go(res,'/','studio='+session()+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800');
}
if(!authenticated(req)){if(req.method==='GET'&&!route.startsWith('/api/'))return go(res,'/login');return send(res,401,{error:'Sign in first. Set APP_PASSWORD in Render environment.'});}
if(req.method==='GET'&&route==='/'){const html=await readFile(path.join(ROOT,'public/index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});return res.end(html);}
if(req.method==='GET'&&route==='/api/config')return send(res,200,{gpt:!!OPENAI,piapi:!!PIAPI,demo:DEMO,models:PRESETS});
if(req.method==='GET'&&route.startsWith('/api/media/'))return streamMedia(req,res,route.split('/').pop());
if(req.method==='GET'&&route.startsWith('/api/reference/')){const id=route.split('/').pop();await asset(id,false);return send(res,200,{url:signedMediaUrl(id),expiresInSeconds:21600});}
if(req.method==='GET'&&route.startsWith('/api/task/'))return send(res,200,await status(route.split('/').pop()));
if(req.method!=='POST'||!sameOrigin(req))throw bad('Unsupported or cross-origin request',403);
if(route==='/api/upload')return send(res,200,await upload(await json(req)));
if(route==='/api/upload-file')return send(res,200,await uploadBinary(req));
if(route==='/api/chat')return send(res,200,await chat(await json(req)));
if(route==='/api/generate')return send(res,200,await generate(await json(req)));
return send(res,404,{error:'Not found'});
}catch(e){if((e.status||500)>=500)console.error(e);return send(res,e.status||500,{error:String(e.message||'Unexpected error').slice(0,500)});}
});
server.listen(PORT,HOST,()=>console.log('Framecraft on '+HOST+':'+PORT+' | OpenAI '+!!OPENAI+' | PiAPI '+!!PIAPI+' | password '+!!PASSWORD));
