// Keep /admin.js for the live-update HEAD probe, but load an immutable filename
// in HTML so a browser/proxy cannot reuse an older cached interface after deploy.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const dist=new URL('../dist/',import.meta.url);
const bundle=fs.readFileSync(new URL('admin.js',dist));
const name='admin.'+createHash('sha256').update(bundle).digest('hex').slice(0,16)+'.js';
const source=fs.readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
if(!source.includes('src="admin.js"'))throw new Error('Admin script reference is missing');
fs.writeFileSync(new URL(name,dist),bundle);
fs.writeFileSync(new URL('admin.html',dist),source.replace('src="admin.js"','src="'+name+'"'));
console.log('Admin entry: '+name);
