// Local review fixture: the actual built panel and Worker, backed by disposable
// SQLite and synthetic accounts. No production credentials or data are loaded.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import worker from '../src/worker.js';import {sqliteDB} from './harness/sqlite-db.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const db=sqliteDB({users:[{id:'admin',name:'Тестовый администратор',roles:['admin'],objs:[],phone:'+79990000001',pin:'582741',av:'👨‍💼',c:'#46606e'},{id:'field',name:'Тестовый бригадир',roles:['brigadier'],objs:['test-house'],phone:'+79990000002',pin:'582742',av:'👷',c:'#e67e22'}],objects:[{id:'test-house',name:'Тестовый дом',icon:'🏠',stages:[{id:'s1',n:'Работы',c:'#46606e',works:[{id:'w1',n:'Тестовая работа',cost:0,mats:[],timeLogs:[],photos:[]}]}]},{id:'hidden-house',name:'Чужой объект',icon:'🏠',stages:[]}],contractDocs:[],rolePermissions:{brigadier:['assign','finance']}});
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:8790');
 if(url.pathname.startsWith('/api/')){
   const parts=[];for await(const chunk of req)parts.push(chunk);const body=Buffer.concat(parts);
   const headers=new Headers(req.headers);headers.set('CF-Connecting-IP','127.0.0.1');
   const response=await worker.fetch(new Request(url,{method:req.method,headers,...(body.length?{body}: {})}),{DB:db.db,ADMIN_TOKEN:'local-synthetic-secret'},{waitUntil(p){p.catch(console.error);}});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
 }
 const file=url.pathname==='/checks'?path.join(root,'tools/browser-safety.html'):url.pathname.startsWith('/src/')?path.join(root,url.pathname):path.join(root,'dist',url.pathname==='/admin'?'admin.html':url.pathname);
 if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(e){res.writeHead(500);res.end(String(e.message));}});
server.listen(8790,'127.0.0.1',()=>console.log('Synthetic review: http://127.0.0.1:8790/admin and /checks'));
