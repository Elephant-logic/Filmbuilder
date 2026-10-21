import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const pieces=page.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);
if(!pieces)throw Error('Missing app JavaScript');
new vm.Script(pieces[1],{filename:'public/index.html <script>'});
console.log('Client JavaScript syntax passed');
