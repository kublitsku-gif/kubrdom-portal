// Narrow server-to-server endpoint: append a website lead, never read or edit CRM.
// The CRM append and Telegram outbox are committed in one guarded D1 transaction.
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply = (body,status=200) => Response.json(body,{status,headers});
const clean = (s,max) => typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').trim().slice(0,max) : '';
function equal(a,b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
export async function boundedJSON(request, limit=16000) {
  if (!request.body || Number(request.headers.get('Content-Length'))>limit) throw new Error('body');
  const reader=request.body.getReader(); let bytes=0, text=''; const decoder=new TextDecoder();
  while(true) { const {value,done}=await reader.read(); if(done) break; bytes+=value.length;
    if(bytes>limit) {await reader.cancel();throw new Error('body');} text+=decoder.decode(value,{stream:true}); }
  return JSON.parse(text+decoder.decode());
}
export function normalizeLead(body) {
  if(!body || body.consent!==true || !/^[a-f0-9-]{36}$/.test(body.requestId||'')) return null;
  const name=clean(body.name,60), phone=clean(body.phone,24), summary=clean(body.summary,3500);
  if(name.length<2 || !/^\+?[\d ()-]+$/.test(phone) || !/^\d{11,12}$/.test(phone.replace(/\D/g,'')) || !summary) return null;
  const delivery=clean(body.delivery,180), channel=['telegram','whatsapp','phone'].includes(body.channel)?body.channel:'phone';
  return {id:'site-'+body.requestId,requestId:body.requestId,name,phone,summary,delivery,channel};
}
async function ensureTables(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS website_lead_outbox (id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT \'pending\', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS state_write_guard (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1))')
  ]);
}
export async function saveWebsiteLead(env, lead) {
  await ensureTables(env);
  const fingerprint=JSON.stringify([lead.name,lead.phone,lead.summary,lead.delivery,lead.channel]);
  for(let attempt=0;attempt<4;attempt++) {
    const row=await env.DB.prepare("SELECT data, updated_at FROM work_states WHERE storage_key='admin_panel' AND work_id='crmClients'").first();
    if(!row) throw new Error('crm_unavailable');
    const clients=JSON.parse(row.data); if(!Array.isArray(clients)) throw new Error('crm_unavailable');
    const found=clients.find(client=>client.id===lead.id);
    if(found) return found.websiteFingerprint===fingerprint ? {id:lead.id,duplicate:true} : {conflict:true};
    const now=Date.now();
    clients.push({id:lead.id,name:lead.name,phone:lead.phone,source:'Сайт КубрДом',stage:'new',
      msg:lead.summary+(lead.delivery?'\nДоставка: '+lead.delivery:'')+'\nСвязь: '+lead.channel,
      date:new Date(now).toISOString().slice(0,10),notes:'Заявка с www.kubrdom.ru. Согласие на обработку заявки получено.',
      websiteFingerprint:fingerprint,websiteRequestId:lead.requestId,createdAt:now});
    const data=JSON.stringify(clients);
    if(new TextEncoder().encode(data).length>1500000) throw new Error('crm_capacity');
    const guard=crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO state_write_guard(id,ok) VALUES (?, CASE WHEN (SELECT updated_at FROM work_states WHERE storage_key='admin_panel' AND work_id='crmClients')=? THEN 1 ELSE 0 END)").bind(guard,row.updated_at),
        env.DB.prepare("UPDATE work_states SET data=?,updated_at=? WHERE storage_key='admin_panel' AND work_id='crmClients'").bind(data,Math.max(now,Number(row.updated_at)+1)),
        env.DB.prepare('INSERT INTO website_lead_outbox(id,created_at) VALUES (?,?)').bind(lead.id,now),
        env.DB.prepare('DELETE FROM state_write_guard WHERE id=?').bind(guard)
      ]);
      return {id:lead.id,duplicate:false};
    } catch(error) { if(!/CHECK constraint failed.*ok\s*=\s*1/i.test(String(error))) throw error; }
  }
  throw new Error('crm_busy');
}
export async function deliverWebsiteLeads(env) {
  if(!env.TG_SALES_BOT_TOKEN || !env.TG_SALES_CHAT_ID) return;
  await ensureTables(env);
  const now=Date.now();
  const rows=await env.DB.prepare("SELECT id,attempts FROM website_lead_outbox WHERE state IN ('pending','sending') AND next_at<=? LIMIT 10").bind(now).all();
  if(!rows.results?.length) return;
  const snapshot=await env.DB.prepare("SELECT data FROM work_states WHERE storage_key='admin_panel' AND work_id='crmClients'").first();
  const clients=JSON.parse(snapshot?.data||'[]');
  for(const row of rows.results) {
    const claim=await env.DB.prepare("UPDATE website_lead_outbox SET state='sending',next_at=? WHERE id=? AND state IN ('pending','sending') AND next_at<=?").bind(now+120000,row.id,now).run();
    if(!claim.meta?.changes) continue;
    const lead=clients.find(c=>c.id===row.id);
    if(!lead) {await env.DB.prepare("UPDATE website_lead_outbox SET state='removed' WHERE id=?").bind(row.id).run();continue;}
    try {
      const response=await fetch(`https://api.telegram.org/bot${env.TG_SALES_BOT_TOKEN}/sendMessage`,{
        method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
        body:JSON.stringify({chat_id:env.TG_SALES_CHAT_ID,text:('🏠 Новая заявка с сайта КубрДом\n'+lead.name+'\n'+lead.phone+'\n\n'+lead.msg+'\n\nCRM → Входящие\nhttps://portal.kubrdom.ru/admin\nНомер: '+lead.websiteRequestId).slice(0,4000),link_preview_options:{is_disabled:true}})
      });
      if(!response.ok || !(await response.json()).ok) throw new Error('delivery');
      await env.DB.prepare("UPDATE website_lead_outbox SET state='sent',attempts=attempts+1 WHERE id=?").bind(row.id).run();
    } catch {
      const delay=Math.min(3600000,300000*2**Math.min(row.attempts,4));
      await env.DB.prepare("UPDATE website_lead_outbox SET state='pending',attempts=attempts+1,next_at=? WHERE id=?").bind(Date.now()+delay,row.id).run();
    }
  }
}
export async function websiteLeadFetch(request,env,ctx) {
  if(!env.WEBSITE_LEAD_TOKEN) return reply({error:'Not found'},404);
  if(!equal(request.headers.get('Authorization'), 'Bearer '+env.WEBSITE_LEAD_TOKEN)) return reply({error:'Unauthorized'},401);
  if(request.method!=='POST') return reply({error:'Method not allowed'},405);
  let lead; try {lead=normalizeLead(await boundedJSON(request));} catch {return reply({error:'Некорректная заявка'},400);}
  if(!lead) return reply({error:'Проверьте имя и телефон'},400);
  try {
    const result=await saveWebsiteLead(env,lead);
    if(result.conflict) return reply({error:'Изменённая заявка требует нового номера'},409);
    ctx.waitUntil(deliverWebsiteLeads(env).catch(()=>{}));
    return reply({success:true,id:result.id},result.duplicate?200:201);
  } catch {return reply({error:'Не удалось сохранить заявку. Попробуйте ещё раз.'},503);}
}
