import {BRIEF_FIELDS,OUTCOMES,activeClient,visibleClient,nextAt,duplicateCandidates,chatKeys,cohortReport,campaignReport,safeProposalUrl} from './crm-sales.js';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
const btn=(a,t,id='')=>`<button data-a="sales-${a}" data-cid="${e(id)}" style="padding:9px;margin:4px;border:1px solid #ccd7e2;border-radius:8px;background:#fff;cursor:pointer">${t}</button>`;
const input=(id,label,value='',type='text')=>`<label style="display:block;margin:8px 0;font-size:12px">${e(label)}<input id="${id}" type="${type}" value="${e(value)}" style="display:block;width:100%;box-sizing:border-box;padding:9px;border:1px solid #ccd7e2;border-radius:6px"></label>`;
const box=(title,body)=>`<section style="background:#fff;border:1px solid #dce4ed;border-radius:12px;padding:14px;margin:12px 0"><h3 style="font-size:14px;margin:0 0 10px">${title}</h3>${body}</section>`;
export function salesToolbar(clients,filter) {
 const active=clients.filter(activeClient);const missing=active.filter(c=>!nextAt(c));const late=active.filter(c=>nextAt(c)&&nextAt(c)<Date.now());
 return box('Рабочий список',`<div style="font-size:12px">В работе: ${active.length} · Без следующего действия: ${missing.length} · Просрочено: ${late.length}</div>`+
 [['all','Все'],['active','В работе'],['mine','Мои'],['missing','Без действия'],['late','Просрочено'],['unassigned','Без менеджера'],['closed','Закрытые / отложенные']].map(([k,t])=>btn('filter',`${filter===k?'✓ ':''}${t}`,k)).join(''));
}
export function matchesSales(c,filter,uid) {
 if(!visibleClient(c))return false;
 if(filter==='active')return activeClient(c);
 if(filter==='mine')return c.ownerId===uid;
 if(filter==='missing')return activeClient(c)&&!nextAt(c);
 if(filter==='late')return activeClient(c)&&nextAt(c)>0&&nextAt(c)<Date.now();
 if(filter==='unassigned')return activeClient(c)&&!c.ownerId;
 if(filter==='closed')return ['refused','closed','waiting'].includes(c.salesStatus);
 return true;
}
export function salesCard(c,users,clients,chats,suggestion) {
 const id=c.id;let html='';
 html+=box('Сделка и ответственный',`<label>Ответственный <select id="sales-owner"> <option value="">Не назначен</option>${users.filter(u=>!u.disabled).map(u=>`<option value="${e(u.id)}" ${c.ownerId===u.id?'selected':''}>${e(u.name)}</option>`).join('')}</select></label>`+
 `<label style="display:block;margin:10px 0">Результат <select id="sales-status">${Object.entries(OUTCOMES).map(([k,v])=>`<option value="${k}" ${(c.salesStatus||'new')===k?'selected':''}>${v}</option>`).join('')}</select></label>`+
 input('sales-reason','Причина отказа / комментарий',c.lostReason)+input('sales-campaign','Кампания / объявление для учёта расходов',c.campaign||c.source)+btn('profile','Сохранить',id));
 html+=box('Бриф заказа',Object.entries(BRIEF_FIELDS).map(([k,v])=>input('sales-brief-'+k,v,c.brief?.[k])).join('')+btn('brief','Сохранить бриф',id));
 html+=box('ИИ: подготовка к звонку',btn('ai','Подготовить сводку и бриф',id)+(suggestion?`<p style="white-space:pre-wrap">${e(suggestion.summary)}</p><p><b>Следующее действие:</b> ${e(suggestion.nextAction)}</p>${input('sales-ai-action','Следующее действие',suggestion.nextAction)}${input('sales-ai-date','Назначить на (необязательно)','','datetime-local')}${Object.entries(suggestion.brief).map(([k,v])=>input('sales-ai-'+k,BRIEF_FIELDS[k],v)).join('')}<small>Проверьте предложения. Заполненные поля брифа сохраняются; дополняются только пустые.</small>${btn('ai-apply','Принять проверенные сведения',id)}`:(c.aiSummary?`<p style="white-space:pre-wrap">${e(c.aiSummary)}</p>`:'')));
 html+=box('Коммерческие предложения',`<div>${(c.proposals||[]).map((p,i)=>`<p><b>Версия ${i+1}: ${e(p.title)}</b> · ${e(p.amount)} ₽<br>${e(p.equipment)}<br>${safeProposalUrl(p.url)?`<a target="_blank" rel="noopener" href="${e(p.url)}">Открыть КП</a>`:''} · ${p.sentAt?'Отправлено '+date(p.sentAt):'Черновик'}${!p.sentAt?btn('proposal-sent','Отметить отправку',id+'|'+p.id):''}</p>`).join('')}</div>`+
 input('sales-kp-title','Название версии')+input('sales-kp-amount','Сумма, ₽','','number')+input('sales-kp-equipment','Комплектация')+input('sales-kp-url','Ссылка на КП (https)')+btn('proposal','Добавить версию',id));
 const candidates=duplicateCandidates(c,clients);
 html+=box('Обращения одного клиента',chatKeys(c).map(k=>btn('chat',e(chats?.[k]?.item?.title||chats?.[k]?.name||'Диалог'),k)).join('')+
 (candidates.length?candidates.map(x=>`<div>${e(x.name)} · ${e(x.phone)} ${btn('merge','Объединить сюда',id+'|'+x.id)}</div>`).join(''):'<small>Совпадений по телефону нет</small>'));
 html+=box('История работы',input('sales-event','Результат звонка, встречи или договорённость')+btn('event','Добавить запись',id)+
 (c.history||[]).slice().sort((a,b)=>b.at-a.at).map(h=>`<p style="font-size:12px"><small>${date(h.at)} · ${e(h.actor)}</small><br>${e(h.text)}</p>`).join(''));
 return html.replace(/<section /g,'<details ').replace(/<h3 /g,'<summary ').replace(/<\/h3>/g,'</summary>').replace(/<\/section>/g,'</details>').replace(/<details ([^>]+)><summary ([^>]+)>ИИ:/,`<details ${suggestion?'open ':''}$1><summary $2>ИИ:`);
}
export function salesAnalytics(clients,settings,contracts,days=30) {
 const from=Date.now()-days*86400000;const r=cohortReport(clients,from);const names={new:'Заявки',qualified:'Квалифицированы',kp:'КП',meeting:'Встречи',contract:'Договор',montaj:'Монтаж'};
 return box('Переходы по заявкам за '+days+' дней',`<select id="sales-days">${[30,90,365].map(n=>`<option ${n===days?'selected':''} value="${n}">${n} дней</option>`).join('')}</select>`+btn('period','Показать')+`<p style="font-size:12px">Доля от заявок выбранного периода. Учитываются зафиксированные переходы; переход через стадию не означает её прохождение. Без истории переходов: ${r.legacy}.</p>`+
 r.funnel.map(x=>`<div>${names[x.id]}: <b>${x.count}</b> · ${x.share}%</div>`).join(''))+
 box('Отдача рекламы',`<p style="font-size:12px">Заявки выбранного периода и связанные подписанные договоры. Расходы — за этот же период. Суммы договоров не означают полученную оплату.</p><div style="overflow:auto"><table style="width:100%;font-size:12px"><tr><th>Кампания</th><th>Заявки</th><th>Квалиф.</th><th>Договоры</th><th>Сумма</th><th>Расход</th><th>Цена квалиф.</th><th>Цена договора</th></tr>`+
 campaignReport(clients,settings.crmAdCosts,contracts,from).map(x=>`<tr><td>${e(x.key)}</td><td>${x.leads}</td><td>${x.qualified}</td><td>${x.contracts}</td><td>${x.revenue}</td><td>${x.costEntries?x.cost:"—"}</td><td>${x.costEntries&&x.qualified?Math.round(x.cost/x.qualified):'—'}</td><td>${x.costEntries&&x.contracts?Math.round(x.cost/x.contracts):'—'}</td></tr>`).join('')+'</table></div>'+input('sales-cost-campaign','Кампания / объявление')+input('sales-cost-date','Дата расхода',new Date().toISOString().slice(0,10),'date')+input('sales-cost-amount','Расход, ₽','','number')+btn('cost','Добавить расход')+
 (settings.crmAdCosts||[]).map(x=>`<div>${e(x.date)} · ${e(x.campaign)} · ${e(x.amount)} ₽ ${btn('cost-delete','Удалить запись',x.id)}</div>`).join(''));
}
