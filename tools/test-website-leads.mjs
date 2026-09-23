import assert from 'node:assert/strict';
import {sqliteDB} from './harness/sqlite-db.js';
import {normalizeLead,saveWebsiteLead,deliverWebsiteLeads,websiteLeadFetch} from '../src/website-leads.js';
const db=sqliteDB({crmClients:{data:[{id:'existing',name:'Existing',stage:'contract'}],at:1000}});
const env={DB:db.db,WEBSITE_LEAD_TOKEN:'test-secret',TG_SALES_BOT_TOKEN:'test-bot',TG_SALES_CHAT_ID:'test-chat'};
const body={requestId:crypto.randomUUID(),name:'Test Customer',phone:'+7 (999) 000-00-00',summary:'House estimate',delivery:'Test town',channel:'telegram',consent:true};
const lead=normalizeLead(body);assert.ok(lead);
assert.equal(normalizeLead({...body,consent:false}),null);assert.equal(normalizeLead({...body,phone:'123'}),null);
let result=await saveWebsiteLead(env,lead);assert.equal(result.duplicate,false);
assert.equal(db.get('crmClients').data.length,2);assert.equal(db.get('crmClients').data[0].stage,'contract');
const version=db.get('crmClients').at;
result=await saveWebsiteLead(env,lead);assert.equal(result.duplicate,true);assert.equal(db.get('crmClients').at,version);
assert.equal((await saveWebsiteLead(env,{...lead,name:'Changed'})).conflict,true);
assert.equal((await env.DB.prepare('SELECT id FROM website_lead_outbox').all()).results.length,1);
// A concurrent panel save triggers the version guard and retries without losing it.
const originalBatch=env.DB.batch.bind(env.DB);let race=true;
env.DB.batch=async statements=>{
 if(race && statements.some(s=>s.sql.startsWith('INSERT INTO state_write_guard'))){race=false;db.set('crmClients',[...db.get('crmClients').data,{id:'concurrent',stage:'new'}],Date.now()+1000);}
 return originalBatch(statements);
};
await saveWebsiteLead(env,normalizeLead({...body,requestId:crypto.randomUUID()}));
assert.equal(db.get('crmClients').data.length,4);assert.ok(db.get('crmClients').data.some(x=>x.id==='concurrent'));
// Outbox failure rolls the CRM append back, not just the notification.
env.DB.batch=async statements=>{
 if(statements.some(s=>s.sql.startsWith('INSERT INTO website_lead_outbox'))){statements.splice(-1,0,env.DB.prepare('INSERT INTO missing_table VALUES (1)'));}
 return originalBatch(statements);
};
await assert.rejects(saveWebsiteLead(env,normalizeLead({...body,requestId:crypto.randomUUID()})));
assert.equal(db.get('crmClients').data.length,4);
env.DB.batch=originalBatch;
const originalFetch=globalThis.fetch;let sends=0;
globalThis.fetch=async()=>{sends++;return Response.json({ok:false},{status:503});};
await deliverWebsiteLeads(env);assert.equal(sends,2);
assert.equal((await env.DB.prepare('SELECT state FROM website_lead_outbox LIMIT 1').first()).state,'pending');
await env.DB.prepare('UPDATE website_lead_outbox SET next_at=0').run();
globalThis.fetch=async()=>{sends++;return Response.json({ok:true});};
await deliverWebsiteLeads(env);assert.equal(sends,4);await deliverWebsiteLeads(env);assert.equal(sends,4);
globalThis.fetch=originalFetch;
const request=(data,token='test-secret')=>new Request('https://test.invalid/api/website-lead',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});
assert.equal((await websiteLeadFetch(request(body,'bad'),env,{waitUntil(){}})).status,401);
assert.equal((await websiteLeadFetch(request({...body,consent:false}),env,{waitUntil(){}})).status,400);
assert.equal((await websiteLeadFetch(request(body),{DB:db.db},{waitUntil(){}})).status,404);
assert.equal((await websiteLeadFetch(request({...body,summary:'x'.repeat(20000)}),env,{waitUntil(){}})).status,400);
db.close();console.log('✓ Website leads: validation, atomic CRM/outbox, idempotency, race retries, Telegram retry, authentication');
