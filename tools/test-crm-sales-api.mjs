import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {sqliteDB} from './harness/sqlite-db.js';
import {upsertSalesCard,salesTick} from '../src/sales-workspace.js';
import {changeClient} from '../src/crm-sales.js';
const db=sqliteDB({crmClients:[{id:'c',name:'Клиент',stage:'new',avitoKey:'avito:1',tgKey:'tg:2'}],aiChats:{'avito:1':{source:'avito',messages:[{role:'user',text:'Баня 6 метров',ts:1}]},'tg:2':{source:'telegram',messages:[{role:'user',text:'Бюджет 900000 рублей',ts:2}]},'tg:private':{source:'telegram',messages:[{role:'user',text:'PRIVATE',ts:3}]}}});
const env={DB:db.db,ADMIN_TOKEN:'synthetic',CLAUDE_API_KEY:'fake',TG_SALES_BOT_TOKEN:'fake',TG_SALES_CHAT_ID:'-100123'};
let seq=10,aiBody;
const original=globalThis.fetch;globalThis.fetch=async(url,opt)=>{
 const body=JSON.parse(opt.body);if(String(url).includes('anthropic')){aiBody=body;return Response.json({content:[{type:'text',text:JSON.stringify({summary:'Баня',nextAction:'Уточнить участок',brief:{budget:'900000',size:'6 м'}})}]});}
 return Response.json({ok:true,result:{message_id:++seq,message_thread_id:seq}});
};
const req=token=>new Request('https://test.invalid/api/ai/brief',{method:'POST',headers:{'X-Admin-Token':token,'Content-Type':'application/json'},body:JSON.stringify({clientId:'c'})});
try{
 assert.equal((await worker.fetch(req('bad'),env,{waitUntil(){}})).status,401);
 const before=db.get('crmClients');const r=await worker.fetch(req('synthetic'),env,{waitUntil(){}});assert.equal(r.status,200);const j=await r.json();assert.equal(j.suggestion.brief.budget,'900000');
 assert.ok(JSON.stringify(aiBody).includes('Бюджет'));assert.ok(!JSON.stringify(aiBody).includes('PRIVATE'));assert.deepEqual(db.get('crmClients'),before,'AI proposal never mutates card');
 await upsertSalesCard(env,{id:'avito:1',crmId:'c',source:'avito',name:'Клиент',topicId:4,summary:'Баня'});
 let client=db.get('crmClients').data[0];client=changeClient(client,{remindAt:Date.now()+86400000,remindNote:'Встреча'},'Менеджер');db.set('crmClients',[client],Date.now());await salesTick(env);
 let card=JSON.parse((await env.DB.prepare('SELECT data FROM sales_cards WHERE id=?').bind('avito:1').first()).data);assert.equal(card.due,client.remindAt);
 client=changeClient(db.get('crmClients').data[0],{remindAt:0},'Менеджер',Date.now()+10);db.set('crmClients',[client],Date.now()+11);await salesTick(env);
 card=JSON.parse((await env.DB.prepare('SELECT data FROM sales_cards WHERE id=?').bind('avito:1').first()).data);assert.equal(card.due,0,'completed action is not resurrected by Telegram');
 console.log('✓ CRM API: authentication, combined Avito/Telegram AI context, privacy, no AI writes, Telegram task synchronization');
}finally{globalThis.fetch=original;db.close();}
