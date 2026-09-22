#!/usr/bin/env node
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { sqliteDB } from './harness/sqlite-db.js';
import { commitState } from '../src/state-store.js';
const secret='test-master';
const s=sqliteDB({objects:{data:[{id:'o1',name:'Initial',stages:[]}],at:1000},finTxns:{data:[],at:5000},users:{data:[{id:'admin',roles:['admin'],pin:'864219'}],at:1000}});
const jobs=[];
async function call(path,body){const r=await worker.fetch(new Request('https://test.invalid/api/'+path,{method:body?'POST':'GET',headers:{'X-Admin-Token':secret,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),{DB:s.db,ADMIN_TOKEN:secret},{waitUntil(p){jobs.push(p);}});return {status:r.status,...await r.json()};}
let r=await call('state/admin_panel/version');assert.equal(r.version,5000);assert.equal(r.items,undefined);
r=await call('state/admin_panel');assert.ok(r.items.find(x=>x.work_id==='objects').data.length===1);
assert.ok(!r.items.find(x=>x.work_id==='users').data[0].pin,'PIN never leaves server, including admin');
r=await call('state/admin_panel',{items:[{work_id:'objects',data:[{id:'o1',name:'Changed',stages:[]}]}],baseVersions:{objects:1000}});assert.equal(r.success,true);assert.deepEqual(r.accepted,['objects']);
assert.equal(s.get('finTxns').at,5000,'unrelated newer section does not conflict');
const version=r.versions.objects;
r=await call('state/admin_panel',{items:[{work_id:'objects',data:[]}],baseVersions:{objects:1000}});assert.equal(r.status,409);assert.equal(s.get('objects').data.length,1);
r=await call('state/admin_panel',{items:[{work_id:'objects',data:[]}]});assert.equal(r.status,428,'old clients cannot blindly overwrite');
r=await call('state/admin_panel',{items:[{work_id:'objects',data:null}],baseVersions:{objects:version}});assert.equal(r.status,400);
r=await call('state/admin_panel',{items:[{work_id:'made-up',data:[]}],baseVersions:{'made-up':0}});assert.equal(r.status,400);
r=await call('state/admin_panel',{items:[{work_id:'objects',data:[{id:'x'},{id:'x'}]}],baseVersions:{objects:version}});assert.equal(r.status,400);
const before=s.get('objects');
const rejected=await commitState({DB:s.db},'admin_panel',[{work_id:'objects',data:[]},{work_id:'finTxns',data:[]}],{objects:version,finTxns:4999});
assert.equal(rejected.ok,false);assert.deepEqual(s.get('objects'),before,'real SQLite rolls back entire batch');
const oldNow=Date.now;Date.now=()=>version;
try{
 const a=await commitState({DB:s.db},'admin_panel',[{work_id:'objects',data:[{id:'o1',name:'A'}]}],{objects:version});
 assert.equal(a.versions.objects,version+1,'same millisecond produces new revision');
 const b=await commitState({DB:s.db},'admin_panel',[{work_id:'objects',data:[]}],{objects:version});assert.equal(b.ok,false);
}finally{Date.now=oldNow;}
await Promise.all(jobs);s.close();console.log('✓ Real SQL: section revisions, atomic conflicts, schema validation, clock collision');
