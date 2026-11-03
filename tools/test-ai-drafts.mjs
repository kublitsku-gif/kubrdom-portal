import assert from 'node:assert/strict';
import { missingDraftTarget, prepareMissingDraft } from '../src/ai-drafts.js';
import { sqliteDB } from './harness/sqlite-db.js';
import worker from '../src/worker.js';

const seed = () => ({ source: 'avito', name: 'Тест', avitoChatId: 'a', messages: [{ role: 'user', text: 'Можно каталог?', avitoMsgId: 'in1', ts: Date.now() }] });
const envOf = chat => { const db = sqliteDB({ aiChats: { 'avito:a': chat, other: { name: 'Keep' } }, crmClients: [], settings: { aiEnabled: true, aiAutoSend: false } }); return { db, env: { DB: db.db } }; };
const answer = { reply: 'Здравствуйте! Помогу выбрать планировку.', needsApproval: false, plans: [] };
assert.ok(missingDraftTarget(seed()));
for (const tail of [{ role: 'assistant', status: 'sent', text: 'Ответ' }, { role: 'assistant', status: 'draft', text: 'Черновик' }]) assert.equal(missingDraftTarget({ ...seed(), messages: [...seed().messages, tail] }), null);
assert.equal(missingDraftTarget({ ...seed(), spam: true }), null);
assert.equal(missingDraftTarget({ ...seed(), messages: [{ role: 'user', text: 'Фото', image: 'https://img/x' }] }), null);

{
 const {db,env}=envOf(seed());let resolve,started, calls=0;
 const ready=new Promise(r=>started=r), gate=new Promise(r=>resolve=r);
 const deps={enabled:async()=>true,reply:async()=>{calls++;started();await gate;return answer;}};
 const first=prepareMissingDraft(env,'avito:a',deps);await ready;
 assert.equal((await prepareMissingDraft(env,'avito:a',deps)).pending,true);
 const latest=db.get('aiChats');latest.data.other.note='Concurrent edit';db.set('aiChats',latest.data,latest.at+1);
 resolve();assert.equal((await first).created,true);
 assert.equal(db.get('aiChats').data.other.note,'Concurrent edit');
 assert.equal(db.get('aiChats').data['avito:a'].messages.filter(m=>m.status==='draft').length,1);
 assert.equal((await prepareMissingDraft(env,'avito:a',deps)).existing,true);assert.equal(calls,1);db.close();
}
for (const newMessage of [{role:'user',text:'Уже другой вопрос',avitoMsgId:'in2',ts:Date.now()}, {role:'assistant',text:'Менеджер уже ответил',status:'sent',ts:Date.now()}]) {
 const {db,env}=envOf(seed());let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 const pending=prepareMissingDraft(env,'avito:a',{enabled:async()=>true,reply:async()=>{started();await gate;return answer;}});await ready;
 const latest=db.get('aiChats');latest.data['avito:a'].messages.push(newMessage);db.set('aiChats',latest.data,latest.at+1);release();
 assert.equal((await pending).stale,true);assert.equal(db.get('aiChats').data['avito:a'].messages.length,2);db.close();
}
{
 const {db,env}=envOf(seed());
 assert.equal((await prepareMissingDraft(env,'avito:a',{enabled:async()=>false})).paused,true);
 const failed=await prepareMissingDraft(env,'avito:a',{enabled:async()=>true,reply:async()=>{throw new Error('Provider 429');}});
 assert.equal(failed.success,false);assert.equal(failed.providerStatus,'429');assert.equal(db.get('aiChats').data['avito:a'].draftState.status,'error');
 const retried=await prepareMissingDraft(env,'avito:a',{reply:async()=>answer},{manual:true});assert.equal(retried.created,true);db.close();
}
{
 const {db,env}=envOf({...seed(),name:'Янина',item:{title:'Дом'},topicId:42,chatId:'-100'});Object.assign(env,{ADMIN_TOKEN:'master',CLAUDE_API_KEY:'test',TG_SALES_BOT_TOKEN:'test',TG_SALES_CHAT_ID:'-100'});
 const realFetch=globalThis.fetch;let generated=0;
 globalThis.fetch=async(url,init)=>{
  if(String(url).includes('api.anthropic.com')){generated++;return Response.json({content:[{type:'text',text:JSON.stringify({...answer,reply:generated===1?answer.reply:'Здравствуйте! С радостью помогу выбрать дом.'})}],stop_reason:'end_turn'});}
  if(String(url).includes('api.telegram.org'))return Response.json({ok:true,result:{message_id:100+generated,message_thread_id:42}});
  throw new Error('Unexpected external send: '+url);
 };
 const post=(path,body)=>worker.fetch(new Request('https://portal.kubrdom.ru'+path,{method:'POST',headers:{'X-Admin-Token':'master','Content-Type':'application/json'},body:JSON.stringify(body||{})}),env,{waitUntil(){}});
 try{
  assert.equal((await(await post('/api/ai/prepare',{clientKey:'avito:a',manual:true})).json()).created,true);
  assert.match(db.get('aiChats').data['avito:a'].messages[1].text,/^Здравствуйте, Янина!/u);
  assert.equal((await(await post('/api/ai/redraft',{clientKey:'avito:a',idx:1,hint:'Теплее и проще'})).json()).success,true);
  assert.match(db.get('aiChats').data['avito:a'].messages[1].text,/^Здравствуйте, Янина!/u);
  assert.equal(db.get('aiChats').data['avito:a'].messages[1].rewritten,1);
  assert.equal(db.get('aiChats').data['avito:a'].messages[1].status,'draft');
  const mode=await(await post('/api/ai/draft-mode',{})).json();assert.equal(mode.enabled,true);assert.equal(mode.autoSend,false);
  assert.equal((await post('/api/ai/send',{clientKey:'avito:a',text:'Каталог',catalog:true})).status,409);
  const incoming=await(await post('/api/ai/incoming',{clientKey:'avito:a',source:'avito',clientName:'Тест',text:'А есть семейная планировка?'})).json();
  assert.equal(incoming.success,true);assert.equal(incoming.created,true);
  assert.equal(db.get('aiChats').data['avito:a'].messages.at(-1).status,'draft');
 }finally{globalThis.fetch=realFetch;db.close();}
}
console.log('AI drafts: shared lease, no duplicates/customer sends, concurrent edits preserved, stale answers discarded, retry and warm rewrite work');
