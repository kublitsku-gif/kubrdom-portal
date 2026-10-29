// Shared sales rules. Existing cards are never given fabricated historical transitions.
export const SALES_STAGES = ['new','qualified','kp','meeting','contract','montaj'];
export const OUTCOMES = {new:'В работе',callback:'Перезвонить',waiting:'Отложено',contract:'Договор',refused:'Отказ',closed:'Неактуально / нет связи'};
export const BRIEF_FIELDS = {product:'Что строим',size:'Размер / площадь',budget:'Бюджет, ₽',region:'Регион доставки',equipment:'Комплектация'};
export function chatKeys(c) { return [...new Set([c.avitoKey,c.tgKey,...(c.avitoKeys||[]),...(c.tgKeys||[])].filter(Boolean))]; }
export function visibleClient(c) { return !!c && !c.mergedInto; }
export function activeClient(c) { return visibleClient(c) && !['refused','closed','waiting'].includes(c.salesStatus) && !['contract','montaj'].includes(c.stage); }
export function nextAt(c) { return Number(c.remindAt !== undefined ? c.remindAt : c.salesFollowupAt)||0; }
export function event(c,type,text,actor,now=Date.now(),extra={}) {
  return {...c,history:[...(c.history||[]),{id:globalThis.crypto.randomUUID(),type,text:String(text).slice(0,2000),actor:actor||'Система',at:now,...extra}]};
}
export function changeClient(c,patch,actor,now=Date.now()) {
  let out={...c,...patch};
  if(patch.stage && patch.stage!==c.stage) out=event(out,'stage',c.stage+' → '+patch.stage,actor,now,{from:c.stage,to:patch.stage});
  if(Object.prototype.hasOwnProperty.call(patch,'remindAt')) {
    out.salesFollowupAt=Number(patch.remindAt)||0; out.actionUpdatedAt=now;
    out=event(out,'task',out.remindAt?'Следующее действие: '+(out.remindNote||'Связаться'):'Действие завершено: '+(c.remindNote||'Связаться'),actor,now);
  }
  if(patch.proposals) {const old=c.proposals||[];for(const p of patch.proposals){const prev=old.find(x=>x.id===p.id);if(!prev)out=event(out,'proposal','Добавлена версия КП: '+p.title,actor,now);else if(p.sentAt&&!prev.sentAt)out=event(out,'proposal','Отправлено КП: '+p.title,actor,now);}}
  if(patch.ownerId!==undefined && patch.ownerId!==c.ownerId) out=event(out,'owner','Ответственный: '+(patch.ownerName||'не назначен'),actor,now);
  if(patch.salesStatus!==undefined && patch.salesStatus!==c.salesStatus) {out.statusUpdatedAt=now;out=event(out,'outcome',(OUTCOMES[patch.salesStatus]||patch.salesStatus)+(patch.lostReason?': '+patch.lostReason:''),actor,now);}
  return out;
}
export function duplicateCandidates(c,clients) {
  const phone=x=>String(x||'').replace(/\D/g,'').replace(/^8(?=\d{10}$)/,'7');
  return clients.filter(x=>visibleClient(x)&&x.id!==c.id&&phone(c.phone).length>=10&&phone(x.phone)===phone(c.phone));
}
export function mergeClients(target,source,actor,now=Date.now()) {
  if(!visibleClient(target)||!visibleClient(source)||target.id===source.id) throw new Error('Карточки уже объединены');
  let out={...source,...target,avitoKeys:[...new Set([target.avitoKey,source.avitoKey,...(target.avitoKeys||[]),...(source.avitoKeys||[])].filter(Boolean))],tgKeys:[...new Set([target.tgKey,source.tgKey,...(target.tgKeys||[]),...(source.tgKeys||[])].filter(Boolean))],planIds:[...new Set([...(target.planIds||[]),...(source.planIds||[])])],
    history:[...(target.history||[]),...(source.history||[])].sort((a,b)=>a.at-b.at), proposals:[...(target.proposals||[]),...(source.proposals||[])],
    brief:{...(source.brief||{}),...(target.brief||{})},notes:[target.notes,source.notes].filter(Boolean).join('\n'),mergedIds:[...(target.mergedIds||[]),source.id,...(source.mergedIds||[])]};
  if(nextAt(source)>0&&(!nextAt(target)||nextAt(source)<nextAt(target)))out=changeClient(out,{remindAt:nextAt(source),remindNote:source.remindNote||source.salesNote||'Связаться'},actor,now);
  out=event(out,'merge','Объединено с '+source.name+'; прежние действия: '+[target,source].filter(x=>nextAt(x)).map(x=>(x.remindNote||x.salesNote||'Связаться')+' · '+new Date(nextAt(x)).toISOString()).join('; '),actor,now);
  return [out,{...source,mergedInto:target.id}];
}
export function cohortReport(clients,from,to=Date.now()) {
  const list=clients.filter(c=>visibleClient(c)&&Number(c.createdAt||Date.parse(c.date))>=from&&Number(c.createdAt||Date.parse(c.date))<=to);
  // Only observed events; no assumption that a direct jump implies a meeting.
  const reached=s=>list.filter(c=>s==='new'||(c.history||[]).some(h=>h.type==='stage'&&h.to===s&&h.at<=to));
  const funnel=SALES_STAGES.map(id=>({id,count:reached(id).length,share:list.length?Math.round(100*reached(id).length/list.length):0}));
  return {count:list.length,legacy:list.filter(c=>!(c.history||[]).some(h=>h.type==='stage')).length,funnel};
}
export function campaignReport(clients,costs,contracts,from,to=Date.now()) {
  const rows=new Map();
  const row=k=>{if(!rows.has(k))rows.set(k,{key:k,leads:0,qualified:0,contracts:0,revenue:0,cost:0,costEntries:0});return rows.get(k);};
  for(const c of clients.filter(visibleClient)) {
    const ts=Number(c.createdAt||Date.parse(c.date)); if(!(ts>=from&&ts<=to))continue;
    const r=row(c.campaign||c.source||'Не указан');r.leads++;
    if((c.history||[]).some(h=>h.to==='qualified')||c.stage==='qualified')r.qualified++;
    const docs=contracts.filter(d=>(d.crmClientId===c.id||(c.mergedIds||[]).includes(d.crmClientId))&&['signed','closed'].includes(d.status)&&(d.type||'main')==='main');
    r.contracts+=docs.length;r.revenue+=docs.reduce((s,d)=>s+(Number(d.amount)||0),0);
  }
  for(const x of costs||[]) {const ts=Date.parse(x.date);if(ts>=from&&ts<=to){row(x.campaign).cost+=Number(x.amount)||0;row(x.campaign).costEntries++;}}
  return [...rows.values()];
}
export function safeProposalUrl(url) { return /^https:\/\/[^\s<>"']+$/i.test(url)||/^\/api\/file\/[\w./%-]+$/.test(url) ? url : ''; }
export function cleanBriefSuggestion(data) {
  const out={summary:String(data.summary||'').slice(0,2500),nextAction:String(data.nextAction||'').slice(0,300),brief:{}};
  for(const k of Object.keys(BRIEF_FIELDS))if(typeof data.brief?.[k]==='string')out.brief[k]=data.brief[k].slice(0,500);
  return out;
}
