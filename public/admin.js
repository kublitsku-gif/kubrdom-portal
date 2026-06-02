/* ============================================================
   КубрДом — Портал управления · admin_panel_v3
   ------------------------------------------------------------
   ИЗМЕНЕНИЯ В ЭТОЙ ВЕРСИИ (v3):
   • Добавлена сводка «Сделанные работы + затраченное время»
     в детальную карточку объекта (функция buildWorkSummary).
     — учитываются только выполненные работы (w.done);
     — время сводится по исполнителям и по этапам;
     — видна всем, кто видит объект.
   Объём работы: 1 новый блок-сводка + KPI (выполнено/часы/сумма).
   Время на доработку: ~25 минут.
   ------------------------------------------------------------
   PENDING (следующее):
   • Google Drive для фото (нужен opt-in коннектора)
   • D1/R2 на Cloudflare для синка между сессиями
   ============================================================ */
const OBJ_ICONS=["🛁","🏠","🌾","🏗️","🏡","🏘️","🏢","🔨","⚡","🌊"];
const AVS=["👷","👩‍💼","🧑‍🔧","👨‍💼","👩‍🔧","👨‍💻","👷‍♀️","🧑‍💻","👔","🦺"];

// ─── СИНХРОНИЗАЦИЯ С CLOUDFLARE WORKER + D1 ─────────────────────────────────
// Снимок всего состояния панели хранится под одним storage_key="admin_panel"
// тремя строками: work_id ∈ {objects, templates, estimates}.
// API-first с graceful fallback на localStorage (паттерн из React-портала).
const API_BASE    = "https://kubrdom-portal-api.kublitsku.workers.dev";
const STORAGE_KEY  = "admin_panel";
const CACHE_KEY    = "state_" + STORAGE_KEY;

function readCache(){
  try { const r = localStorage.getItem(CACHE_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function writeCache(items){
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch {}
}

// ─── АВТОРИЗАЦИЯ: пароль-гейт ───────────────────────────────────────────────
// Токен (пароль) храним в localStorage — НЕ в коде. Вводится один раз на устройстве,
// дальше вход автоматический. Шлём заголовком X-Admin-Token; Worker сверяет с секретом.
const TOKEN_KEY = "admin_token";
function getToken(){ try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
function setToken(t){ try { localStorage.setItem(TOKEN_KEY, t); } catch {} }
function clearToken(){ try { localStorage.removeItem(TOKEN_KEY); } catch {} }
function authHeaders(extra){ return Object.assign({ "X-Admin-Token": getToken() }, extra || {}); }

// Экран входа: resolve(пароль) по сабмиту. Блокирует, пока не введут пароль.
function showLogin(message){
  return new Promise(function(resolve){
    const app = document.getElementById("app");
    app.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif">'
      + '<div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,.12);width:300px;text-align:center">'
      +   '<div style="font-size:40px">🔒</div>'
      +   '<h2 style="margin:10px 0 2px;font-size:18px;color:#243">КубрДом · вход</h2>'
      +   '<div style="font-size:13px;color:#e23;min-height:18px;margin-bottom:10px">' + (message || "") + '</div>'
      +   '<input id="login-pw" type="password" placeholder="Пароль" '
      +     'style="width:100%;padding:10px 12px;border:1px solid #cdd;border-radius:10px;font-size:15px;box-sizing:border-box">'
      +   '<button id="login-btn" style="margin-top:12px;width:100%;padding:10px;border:0;border-radius:10px;background:#2a5298;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Войти</button>'
      + '</div></div>';
    const pw = document.getElementById("login-pw");
    pw.focus();
    function submit(){ const v = pw.value.trim(); if (v) resolve(v); }
    document.getElementById("login-btn").onclick = submit;
    pw.onkeydown = function(e){ if (e.key === "Enter") submit(); };
  });
}

// Состояние панели → формат Worker: [{ work_id, data }, ...]
// Все НАБОРЫ ДАННЫХ панели (не UI-буферы) — единый снимок состояния.
function serializeState(){
  return [
    { work_id: "objects",         data: objects         },
    { work_id: "templates",       data: templates       },
    { work_id: "estimates",       data: estimates       },
    { work_id: "users",           data: users           },
    { work_id: "roles",           data: roles           },
    { work_id: "rolePermissions", data: rolePermissions },
    { work_id: "dbWorks",         data: dbWorks         },
    { work_id: "expProducts",     data: expProducts     },
    { work_id: "dbPlans",         data: dbPlans         },
    { work_id: "purchased",       data: purchased       },
    { work_id: "finTxns",         data: finTxns         },
    { work_id: "finSalaries",     data: finSalaries     },
    { work_id: "finContracts",    data: finContracts    },
    { work_id: "finExtraWorks",   data: finExtraWorks   },
    { work_id: "contractDocs",    data: contractDocs    },
    { work_id: "crmClients",      data: crmClients      },
  ];
}

// items с сервера/кэша → живое состояние панели.
// Перезаписываем только пришедшие ключи: отсутствующий ключ оставляет
// демо-данные нетронутыми (защита от пустого клоббера на первом запуске).
function applyState(items){
  if (!Array.isArray(items)) return;
  const byId = {};
  items.forEach(function(it){ byId[it.work_id] = it.data; });
  // Перезаписываем только пришедшие ключи (отсутствующий ключ оставляет
  // сид нетронутым). arr — для массивов, obj — для map-объектов.
  // отсеиваем null/undefined-элементы — один битый элемент иначе роняет рендер вкладки
  const arr = function(k, cur){ return Array.isArray(byId[k]) ? byId[k].filter(function(x){ return x != null; }) : cur; };
  const obj = function(k, cur){ return (byId[k] && typeof byId[k] === "object" && !Array.isArray(byId[k])) ? byId[k] : cur; };
  objects         = arr("objects",         objects);
  templates       = arr("templates",       templates);
  estimates       = arr("estimates",       estimates);
  users           = arr("users",           users);
  roles           = arr("roles",           roles);
  dbWorks         = arr("dbWorks",         dbWorks);
  expProducts     = arr("expProducts",     expProducts);
  dbPlans         = arr("dbPlans",         dbPlans);
  finTxns         = arr("finTxns",         finTxns);
  contractDocs    = arr("contractDocs",    contractDocs);
  crmClients      = arr("crmClients",      crmClients);
  rolePermissions = obj("rolePermissions", rolePermissions);
  purchased       = obj("purchased",       purchased);
  finSalaries     = obj("finSalaries",     finSalaries);
  finContracts    = obj("finContracts",    finContracts);
  finExtraWorks   = obj("finExtraWorks",   finExtraWorks);
}

async function apiLoad(){
  let r;
  try {
    r = await fetch(API_BASE + "/api/state/" + encodeURIComponent(STORAGE_KEY), { headers: authHeaders() });
  } catch {
    return readCache();                       // офлайн/сеть недоступна — отдаём кэш
  }
  if (r.status === 401) { const e = new Error("unauthorized"); e.unauthorized = true; throw e; }
  if (!r.ok) throw new Error("HTTP " + r.status);
  const data = await r.json();
  if (data && Array.isArray(data.items)) { writeCache(data.items); return data.items; }
  return null;
}

let _lastSavedJson = null;                 // снимок последнего успешного сохранения
let _saving = false;                       // защита от параллельных сохранений
async function apiSave(){
  if (_saving) return { success: true, busy: true };
  const items = serializeState();
  const snap  = JSON.stringify(items);
  if (snap === _lastSavedJson) return { success: true, skipped: true };  // нечего сохранять
  _saving = true;
  writeCache(items);                       // optimistic: локально всегда свежо
  try {
    const r = await fetch(API_BASE + "/api/state/" + encodeURIComponent(STORAGE_KEY), {
      method:  "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body:    JSON.stringify({ items: items }),
    });
    if (r.status === 401) { clearToken(); location.reload(); return { success: false, error: "unauthorized" }; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (j && j.updated_at) _lastSeen = j.updated_at;   // свой save — не считаем чужой правкой
    _lastSavedJson = snap;                             // запомнили, что отправили
    return j;
  } catch (err) {
    return { success: false, error: String((err && err.message) || err), fallback: "localStorage" };
  } finally {
    _saving = false;
  }
}

// fl() зовётся часто → шлём на сервер не чаще раза в ~800мс.
let _hydrated = false;
function scheduleSave(){
  if (!_hydrated) return;                   // не сохраняем до завершения загрузки
  clearTimeout(scheduleSave._t);
  scheduleSave._t = setTimeout(apiSave, 800);
}

// ─── LIVE-ОБНОВЛЕНИЕ ────────────────────────────────────────────────────────
// Опрашиваем сервер раз в POLL_MS. Если updated_at вырос (правка с другого
// устройства) — показываем баннер. Не авто-применяем: applyState заменяет весь
// стейт и стёр бы несохранённые правки, поэтому решение за пользователем.
const POLL_MS = 15000;
let _lastSeen   = 0;       // макс. updated_at, который мы уже знаем/применили
let _pollPaused = false;   // true пока висит баннер — не плодим уведомления

function maxUpdatedAt(items){
  return (items || []).reduce(function(m, it){ return Math.max(m, it.updated_at || 0); }, 0);
}

async function pollOnce(){
  if (!_hydrated || _pollPaused || document.hidden) return;
  let r;
  try { r = await fetch(API_BASE + "/api/state/" + encodeURIComponent(STORAGE_KEY), { headers: authHeaders() }); }
  catch { return; }                                   // сеть недоступна — тихо, попробуем позже
  if (r.status === 401) { clearToken(); location.reload(); return; }
  if (!r.ok) return;
  const data = await r.json();
  if (!data || !Array.isArray(data.items)) return;
  const serverV = maxUpdatedAt(data.items);
  if (serverV > _lastSeen) showUpdateBanner(data.items, serverV);
}

function showUpdateBanner(items, version){
  _pollPaused = true;
  let b = document.getElementById("live-banner");
  if (!b){
    b = document.createElement("div");
    b.id = "live-banner";
    b.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;"
      + "background:#243b55;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);"
      + "display:flex;align-items:center;gap:12px;font-family:-apple-system,sans-serif;font-size:14px";
    document.body.appendChild(b);
  }
  b.innerHTML = '<span>🔄 Данные изменены на другом устройстве</span>'
    + '<button id="live-apply" style="border:0;border-radius:8px;padding:6px 12px;background:#4a90d9;color:#fff;font-weight:600;cursor:pointer">Обновить</button>'
    + '<button id="live-dismiss" style="border:0;background:transparent;color:#9fb3c8;cursor:pointer;font-size:18px;line-height:1">×</button>';
  document.getElementById("live-apply").onclick = function(){
    applyState(items); _lastSeen = version; b.remove(); _pollPaused = false; render();
  };
  document.getElementById("live-dismiss").onclick = function(){
    _lastSeen = version; b.remove(); _pollPaused = false;   // версию подтвердили — больше не напоминаем
  };
}
const COLS=["#e67e22","#c0392b","#2980b9","#27ae60","#9b59b6","#7f8c8d","#16a085","#d35400","#8e44ad","#2c3e50"];
// Единицы измерения работ (готовый список; можно ввести свою)
const WORK_UNITS=["шт","м²","м.пог.","м³","компл.","л","кг","т","меш.","рул.","упак."];
// Единицы измерения материалов (по запросу: м.п. / м.кв. / шт / м.куб. / пачка / комплект)
const MAT_UNITS=["шт","м²","м.п.","м³","пачка","компл."];
// Нормализация полей работы: возвращает {unit, qty, unitCost, total}
// total = unitCost × qty. Для старых работ (только cost) → qty=1, unitCost=cost.
function workCalc(w){
  if(!w) return {unit:"",qty:1,unitCost:0,total:0};
  const qty=(w.qty!=null&&!isNaN(w.qty))?w.qty:1;
  const unitCost=(w.unitCost!=null&&!isNaN(w.unitCost))?w.unitCost:(w.cost||0);
  const unit=w.unit||"";
  return {unit:unit,qty:qty,unitCost:unitCost,total:Math.round(unitCost*qty)};
}
// Короткая подпись "3 м² × 1 000 ₽" (без итога). Пусто, если кол-во 1 и нет единицы.
function workQtyLabel(w){
  const c=workCalc(w);
  if(!c.unit && c.qty===1) return "";
  const q=Number.isInteger(c.qty)?c.qty:c.qty;
  return q+(c.unit?" "+c.unit:"")+" × "+c.unitCost.toLocaleString("ru-RU")+" ₽";
}
// Материал-«доставка» (скрывается в перечне «Материалы» Базы данных, но остаётся в данных)
function isDeliveryMat(m){return /^\s*доставк/i.test((m&&m.n)||"");}
// Выпадающий список единиц измерения материала. sel — текущая единица.
function matUnitSelect(cls,sel){
  sel=sel||"";
  return '<select class="'+cls+'" style="width:92px;padding:7px 6px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;background:#fff">'+
    '<option value=""'+(!sel?' selected':'')+'>ед.</option>'+
    MAT_UNITS.map(function(u){return '<option value="'+u+'"'+(sel===u?' selected':'')+'>'+u+'</option>';}).join('')+
    ((sel&&MAT_UNITS.indexOf(sel)<0)?'<option value="'+sel+'" selected>'+sel+'</option>':'')+
  '</select>';
}
// Материал продаётся упаковками? (задан коэффициент м² в упаковке)
function matSoldByPack(m){return !!(m&&m.packM2!=null&&!isNaN(m.packM2)&&Number(m.packM2)>0);}
// Переключатель единиц для материала базы (адаптер к expConv): цена за единицу = m.cost
function matConv(m){
  return expConv({mode:m&&m.mode,unitCost:Number(m&&m.cost)||0,packBase:m&&m.packBase,packPer:m&&m.packPer,sheetM2:m&&m.sheetM2,lenPer:m&&m.lenPer});
}
// HTML-экранирование пользовательского текста перед вставкой в разметку
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
// Красивое число: целое как есть, дробное — с запятой и без лишних нулей
function numRu(n){
  if(n==null||isNaN(n))return "0";
  return Number.isInteger(n)?String(n):parseFloat(Number(n).toFixed(2)).toString().replace(".",",");
}
const SC={"Озон":"#005bff","Белка":"#d68910","pechki.su":"#c0392b","Егорьевск":"#8e44ad","Лемана":"#e30613","Авито":"#00aaff","Нижний Новгород":"#27ae60","Грандлайн":"#7f8c8d","Южые ворота":"#f39c12","Доставка":"#95a5a6"};
const fmt=n=>n.toLocaleString("ru-RU")+" ₽";
// Format number value with spaces (5 500 000) - no ruble sign, for input fields
function fmtMoney(v){
  if(v===""||v==null||isNaN(v))return"";
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g," ");
}
// Strip spaces from money input to get raw number
function unfmtMoney(v){
  return parseInt(String(v||"").replace(/[^0-9-]/g,""))||0;
}
// Auto-format money inputs on input
window._delTxn=function(tid){
  if(!tid)return false;
  // Skip confirm — it can fail silently in WebView; just delete + toast
  try{
    if(typeof finTxns!=="undefined"){
      const before=finTxns.length;
      finTxns=finTxns.filter(function(t){return t.id!==tid;});
    }
    if(typeof fl==="function"){fl();}
    else if(typeof render==="function"){render();}
    // Show toast for visual feedback
    try{
      const toast=document.createElement("div");
      toast.textContent="🗑 Транзакция удалена";
      toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a2a3a;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3)";
      document.body.appendChild(toast);
      setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
    }catch(e){}
  }catch(e){console.log("[_delTxn] error:",e);}
  return false;
};

window._callPhone=function(phone,ev){
  // Strategy: try every possible way to initiate a call.
  // If tel: is blocked (e.g. inside Claude.ai/Telegram WebView), copy to clipboard + show alert.
  if(ev&&ev.preventDefault)ev.preventDefault();
  let success=false;

  // Method 1: hidden iframe (works in some restricted WebViews)
  try{
    const iframe=document.createElement("iframe");
    iframe.style.display="none";
    iframe.src="tel:"+phone;
    document.body.appendChild(iframe);
    setTimeout(function(){try{document.body.removeChild(iframe);}catch(e){}},500);
    success=true;
  }catch(e){}

  // Method 2: location.href
  try{
    window.location.href="tel:"+phone;
    success=true;
  }catch(e){}

  // Method 3: dynamic anchor click
  try{
    const a=document.createElement("a");
    a.href="tel:"+phone;
    a.style.display="none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    success=true;
  }catch(e){}

  // Always also copy to clipboard so user can paste into dialer
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(phone);
    } else {
      const t=document.createElement("textarea");
      t.value=phone;
      t.style.position="fixed";t.style.opacity="0";
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      document.body.removeChild(t);
    }
    // Show toast
    const toast=document.createElement("div");
    toast.textContent="📋 Номер скопирован: "+phone;
    toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a2a3a;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:90%;text-align:center";
    document.body.appendChild(toast);
    setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2500);
  }catch(e){}

  return false;
};

window._openExt=function(url,ev){
  if(ev&&ev.preventDefault)ev.preventDefault();
  // Try window.open first (works in most cases)
  try{
    const w=window.open(url,"_blank","noopener");
    if(w){return false;}
  }catch(e){}
  // Try anchor click
  try{
    const a=document.createElement("a");
    a.href=url;
    a.target="_blank";
    a.rel="noopener";
    a.style.display="none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return false;
  }catch(e){}
  // Last resort: location.href
  try{window.location.href=url;}catch(e){}
  // Also copy URL to clipboard
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url);
    }
    const toast=document.createElement("div");
    toast.textContent="📋 Ссылка скопирована";
    toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a2a3a;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
    document.body.appendChild(toast);
    setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2500);
  }catch(e){}
  return false;
};

window._crmStageToggle=function(){
  crmStagePickerOpen=!crmStagePickerOpen;
  render();
};

window._crmMove=function(btn,ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  // Walk up to find button with data-cid (in case child span was clicked)
  let target=btn;
  while(target&&!target.dataset.cid)target=target.parentElement;
  if(!target)return;
  const cid=target.dataset.cid, sid=target.dataset.sid;
  if(!cid||!sid)return;
  crmClients=crmClients.map(function(c){return c.id===cid?Object.assign({},c,{stage:sid}):c;});
  crmStagePickerOpen=false; // collapse after picking
  fl();
};

// Format raw digits to +7 (XXX) XXX-XX-XX
function formatRussianPhone(raw){
  // Strip everything but digits
  let d=(raw||"").replace(/\D/g,"");
  // If starts with 8 — replace with 7
  if(d.length&&d[0]==="8")d="7"+d.slice(1);
  // If starts with 9 (no country code) — prepend 7
  else if(d.length&&d[0]==="9")d="7"+d;
  // If doesn't start with 7 and we have digits — prepend 7
  else if(d.length&&d[0]!=="7")d="7"+d;
  // Cap at 11 digits (7 + 10)
  d=d.slice(0,11);
  if(!d)return "";
  // Build masked: +7 (XXX) XXX-XX-XX
  let res="+7";
  if(d.length>1)res+=" ("+d.slice(1,4);
  if(d.length>=5)res+=") "+d.slice(4,7);
  else if(d.length>4)res+=") "+d.slice(4,7);
  if(d.length>=8)res+="-"+d.slice(7,9);
  if(d.length>=10)res+="-"+d.slice(9,11);
  return res;
}

window._bindPhoneInputs=function(){
  document.querySelectorAll("input[data-phone-mask='1']").forEach(function(inp){
    if(inp._phoneBound)return;
    inp._phoneBound=true;
    // Format current value on bind
    if(inp.value)inp.value=formatRussianPhone(inp.value);
    inp.addEventListener("input",function(){
      const oldVal=this.value;
      const formatted=formatRussianPhone(oldVal);
      if(oldVal!==formatted){
        const pos=this.selectionStart||formatted.length;
        const diff=formatted.length-oldVal.length;
        this.value=formatted;
        try{this.setSelectionRange(pos+diff,pos+diff);}catch(e){}
      }
    });
    inp.addEventListener("focus",function(){
      // If empty, prepopulate with +7 prefix
      if(!this.value)this.value="+7 ";
    });
  });
};

window._bindMoneyInputs=function(){
  document.querySelectorAll("input[data-money='1']").forEach(function(inp){
    if(inp._moneyBound)return;
    inp._moneyBound=true;
    inp.addEventListener("input",function(){
      const raw=this.value.replace(/[^0-9-]/g,"");
      const formatted=raw?fmtMoney(raw):"";
      if(this.value!==formatted){
        const pos=this.selectionStart;
        const oldLen=this.value.length;
        this.value=formatted;
        const newLen=this.value.length;
        try{this.setSelectionRange(pos+(newLen-oldLen),pos+(newLen-oldLen));}catch(e){}
      }
      // Sync to state to survive re-render
      const numVal=unfmtMoney(this.value);
      if(this.id==="ct-amount")contractNew.amount=numVal;
    });
  });
};
const gid=()=>"x"+Date.now()+Math.random().toString(36).slice(2,5);

let roles=[
  {id:"admin",n:"Администратор",c:"#c0392b",group:"other"},
  {id:"brigadier",n:"Бригадир",c:"#e67e22",group:"prod"},
  {id:"worker",n:"Мастер",c:"#2980b9",group:"prod"},
  {id:"prod_head",n:"Начальник производства",c:"#d35400",group:"prod"},
  {id:"supply",n:"Снабженец",c:"#27ae60",group:"other"},
  {id:"contract_mgr",n:"Менеджер по договорам",c:"#2c5f9e",group:"other"},
  {id:"client_mgr",n:"Менеджер по сопровождению",c:"#d68910",group:"client"},
  {id:"sales_head",n:"РОП",c:"#2980b9",group:"sales"},
  {id:"sales_mgr",n:"Менеджер по продажам",c:"#3498db",group:"sales"},
  {id:"marketer",n:"Маркетолог",c:"#8e44ad",group:"other"},
  {id:"financier",n:"Финансист",c:"#16a085",group:"fin"},
];

// === РАЗРЕШЕНИЯ: какие вкладки открывает каждая роль ===
const TAB_DEFS=[
  {k:"assign",    n:"🏗️ Объекты"},
  {k:"analysis",  n:"📊 Анализ стройки"},
  {k:"supply",    n:"📦 Снабжение"},
  {k:"finance",   n:"💰 Финансы"},
  {k:"contracts", n:"📄 Договора"},
  {k:"crm",       n:"🤝 CRM-клиенты"},
  {k:"clients",   n:"👤 Клиенты"},
  {k:"works",     n:"🗄️ База данных"},
  {k:"team",      n:"👥 Команда"},
  {k:"marketing", n:"📣 Маркетинг"},
];
// rolePermissions[roleId] = массив ключей вкладок, которые открывает роль.
// Админ НЕ входит сюда — он всегда видит все вкладки (зафиксировано).
// Значения по умолчанию повторяют прежнюю жёстко зашитую логику доступа.
let rolePermissions={
  brigadier:   ["assign","analysis","finance"],
  worker:      ["assign","analysis","finance"],
  prod_head:   ["contracts","analysis"],
  supply:      ["supply","finance"],
  contract_mgr:[],
  client_mgr:  ["assign","contracts","crm","clients"],
  sales_head:  ["assign","finance","contracts","crm","marketing","works"],
  sales_mgr:   ["marketing","crm","works"],
  marketer:    ["marketing"],
  financier:   ["finance","crm"],
};
// Роли, которым во вкладке «База данных» доступен ТОЛЬКО раздел «Планировки»
const DB_PLANS_ONLY_ROLES=["sales_head","sales_mgr"];
// Уровень доступа к Базе данных: "full" | "plans" | "none"
function dbAccessLevel(){
  if(!currentUser) return "none";
  if(currentUser.roles.includes("admin")) return "full";
  const worksRoles=currentUser.roles.filter(function(r){return (rolePermissions[r]||[]).includes("works");});
  if(!worksRoles.length) return "none";
  // если все роли, дающие доступ к Базе, — «только планировки», то ограничиваем
  const allPlansOnly=worksRoles.every(function(r){return DB_PLANS_ONLY_ROLES.indexOf(r)>=0;});
  return allPlansOnly?"plans":"full";
}

let users=[
  {id:"yuriy",name:"Юрий",av:"👨‍💼",c:"#c0392b",roles:["admin","supply","prod_head","financier","marketer"],objs:[],pin:"1111"},
  {id:"valera",name:"Валера",av:"👷",c:"#e67e22",roles:["brigadier"],objs:[],pin:"1111"},
  {id:"inna",name:"Инна",av:"👩‍💼",c:"#9b59b6",roles:["brigadier"],objs:[],pin:"1111"},
  {id:"azis",name:"Азис",av:"🧑‍🔧",c:"#2980b9",roles:["worker"],objs:[],pin:"1111"},
  {id:"alexandr",name:"Александр",av:"👨‍🔧",c:"#7f8c8d",roles:["contract_mgr","client_mgr","sales_head","sales_mgr","marketer"],objs:[],pin:"1111"},
];

// Шаблоны
let templates=[
  {id:"t1",name:"Баня 20 футов",icon:"🛁",kind:"banya",stages:[
    {id:"ts_e1",n:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",c:"#e67e22",works:[
      {id:"dw1",n:"Двери и Окна Рехау Термо — ламинация, 3 стекла, энергосбережение",cost:50000,note:"50 тыс · комплект",mats:[]},
      {id:"dw2",n:"Аренда площадки",cost:50000,note:"25 тыс в месяц · 2 месяца",mats:[]},
      {id:"dw3",n:"Монтаж подвесов для обрешётки к стенам",cost:1570,note:"",mats:[{id:"dm3_1",n:"Подвесы крепежные прямые 27x270x0,5",cost:600,store:"Озон",url:"https://www.ozon.ru/product/podvesy-krepezhnye-pryamye-27x270x0-5-mm-dlya-profilya-100-sht-3735563806/",note:"100 шт"},{id:"dm3_2",n:"Tytan Professional Клей 2 фикс",cost:970,store:"Озон",url:"https://www.ozon.ru/product/tytan-professional-kley-stroitelnyy-290-ml-1-sht-215536620/",note:"1 шт"}]},
      {id:"dw4",n:"Усиление оконных и дверных проёмов",cost:6480,note:"Труба 40×40 или 50×50 мм",mats:[{id:"dm4_1",n:"Труба профильная 40x40x2мм 3 м",cost:3480,store:"Лемана",url:"https://lemanapro.ru/product/truba-profilnaya-40x40x2mm-3-m-13376760/",note:"6 шт по 3 м"},{id:"dm4_2",n:"Доставка",cost:3000,store:"Лемана",url:"",note:""}]},
      {id:"dw5",n:"Утепление пола — ЭППС 10 см",cost:20800,note:"",mats:[{id:"dm5_1",n:"ЭППС",cost:10500,store:"Егорьевск",url:"",note:"350 за кв м"},{id:"dm5_2",n:"Клей-пена POLYNOR 60 СЕКУНД",cost:3300,store:"Озон",url:"https://www.ozon.ru/product/kley-pena-polynor-60-sekund-box-polinor-60-sekund-universalnaya-komplekt-12-sht-948411658/",note:"6 баллонов по 550 р"},{id:"dm5_3",n:"Доставка",cost:7000,store:"Егорьевск",url:"",note:""}]},
      {id:"dw6",n:"Монтаж чернового пола из ОСП",cost:25210,note:"",mats:[{id:"dm6_1",n:"ОСП 30 м²",cost:14910,store:"Белка",url:"",note:"21 шт 1,25*2,5"},{id:"dm6_2",n:"Клей-пена POLYNOR 60 СЕКУНД",cost:3300,store:"Озон",url:"https://www.ozon.ru/product/kley-pena-polynor-60-sekund-box-polinor-60-sekund-universalnaya-komplekt-12-sht-948411658/",note:"6 баллонов"},{id:"dm6_3",n:"Доставка",cost:7000,store:"Белка",url:"",note:""}]},
      {id:"dw7",n:"Утепление стен и потолка — ППУ 3 см",cost:61992,note:"",mats:[]}
    ]},
    {id:"ts_e2",n:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",c:"#2980b9",works:[
      {id:"dw8",n:"Монтаж обрешётки из сухого строганого бруса",cost:4800,note:"",mats:[{id:"dm8_1",n:"Рейка строганная 20 на 40",cost:4800,store:"Белка",url:"",note:"60 шт по 80р"}]},
      {id:"dw9",n:"Монтаж перегородок",cost:3435,note:"",mats:[{id:"dm9_1",n:"Брусок строганный 50 на 50",cost:3435,store:"Белка",url:"",note:"15 шт по 229р"}]},
      {id:"dw10",n:"Разводка электрики кабелем по ГОСТ",cost:15710,note:"",mats:[{id:"dm10_1",n:"Кабель ВВГ Пнг (А) LS 3х2,5 мм2 100М",cost:7800,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3h2-5-mm2-100m-1605500925/",note:""},{id:"dm10_2",n:"Кабель ВВГ Пнг (А) LS 3х1,5 мм2 100М",cost:5100,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3h1-5-mm2-100m-1606304346/",note:""},{id:"dm10_3",n:"Коробка установочная в гипсокартон 68х45 мм (10 шт)",cost:500,store:"Озон",url:"https://www.ozon.ru/product/korobka-ustanovochnaya-v-gipsokarton-siniy-68h45-mm-10-sht-3168901039/",note:""},{id:"dm10_4",n:"Кабель ВВГ Пнг (А) Ls 3x4, 15 метров",cost:2310,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3x4-15-metrov-1667556252/",note:""}]},
      {id:"dw11",n:"Водоснабжение — сшитый полиэтилен",cost:15215,note:"",mats:[{id:"dm11_1",n:"Тройник Ростерм 16 мм латунь",cost:1310,store:"Лемана",url:"https://lemanapro.ru/product/troynik-rosterm-16-mm-latun-88700669/",note:"5 шт"},{id:"dm11_2",n:"Водорозетка Ростерм 1/2\"x16 мм ВР латунь",cost:1855,store:"Лемана",url:"https://lemanapro.ru/product/vodorozetka-rosterm-1-2x16-mm-vr-latun-82262639/",note:"5 шт"},{id:"dm11_3",n:"Монтажная гильза Ростерм 16x2.2 мм PVDF",cost:2190,store:"Лемана",url:"https://lemanapro.ru/product/montazhnaya-gilza-rosterm-16x22-mm-pvdf-82132721/",note:"30 шт"},{id:"dm11_4",n:"Труба из сшитого полиэтилена 100 м Valtec PEXA-EVOH 16 мм x 2,2 мм",cost:8860,store:"Озон",url:"https://www.ozon.ru/product/truba-iz-sshitogo-polietilena-100-m-valtec-pexa-evoh-va1622-3-c-100-16-mm-x-2-2-mm-1886739508/",note:"100 м"},{id:"dm11_5",n:"Теплоизоляция для труб Energoflex Super Protect 18/4-11 (2 бухты по 11м)",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/teploizolyatsiya-dlya-trub-energoflex-super-protect-18-4-11-sinyaya-krasnaya-uteplitel-dlya-trub-3574400762/",note:""}]},
      {id:"dw12",n:"Монтаж стен из ОСП, ГСП и утеплителя",cost:8606,note:"",mats:[{id:"dm12_1",n:"ОСП 18 м²",cost:4260,store:"Белка",url:"",note:"6 листов"},{id:"dm12_2",n:"Звукоизоляция Knauf АкустиKnauf 50 мм 6 м²",cost:2162,store:"Лемана",url:"https://lemanapro.ru/product/zvukoizolyaciya-knauf-insulation-akustiknauf-50-mm-10-sht-610x1000-mm-6-m-18482159/",note:""},{id:"dm12_3",n:"Гипсоволокнистый лист ГВЛВ ПК 10 мм Knauf 600x1200 мм",cost:2184,store:"Лемана",url:"https://lemanapro.ru/product/gipsovoloknistyy-list-gvlv-pk-10-mm-knauf-superlist-600x1200-mm-18527409/",note:""}]},
      {id:"dw13",n:"Санузел — гидроизоляция стен и пола",cost:6500,note:"",mats:[{id:"dm13_1",n:"Гидроизоляция для ванны, кровли, бетона 24 кг",cost:6500,store:"Озон",url:"https://www.ozon.ru/product/gidroizolyatsiya-dlya-vanny-krovli-betona-24-kg-2223640495/",note:""}]},
      {id:"dw14",n:"Монтаж теплого пола с заливкой",cost:9300,note:"",mats:[{id:"dm14_1",n:"Теплый пол 9 м² электрический мат под плитку 150 вт",cost:5200,store:"Озон",url:"https://www.ozon.ru/product/teplyy-pol-9-m2-elektricheskiy-mat-pod-plitku-150-vt-s-mehanicheskim-regulyatorom-735920062/",note:""},{id:"dm14_2",n:"Грунтовка Кнауф Тифенгрунд F мороз 10 кг",cost:1400,store:"Лемана",url:"https://lemanapro.ru/product/gruntovka-glubokogo-proniknoveniya-knauf-tifengrund-f-moroz-10-kg-85060727/",note:""},{id:"dm14_3",n:"Наливной пол Волма Нивелир Экспресс 25 кг",cost:2700,store:"Лемана",url:"https://lemanapro.ru/product/nalivnoy-pol-volma-nivelir-ekspress-25-kg-87481463/",note:"6 мешков"}]},
      {id:"dw15",n:"Вентиляция — клапаны приточные + вытяжные вентиляторы",cost:3700,note:"",mats:[{id:"dm15_1",n:"Оконный приточный клапан NovaVent",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/okonnyy-pritochnyy-klapan-novavent-max-s-filtrom-dlya-ventilyatsii-provetrivatel-okonnyy-2-shtuki-1439055176/",note:""},{id:"dm15_2",n:"Вентилятор вытяжной 100мм с обратным клапаном",cost:2700,store:"Озон",url:"https://www.ozon.ru/product/ventilyator-vytyazhnoy-100mm-s-obratnym-klapanom-airtube-classic-matt-white-100-matovyy-belyy-3626278570/",note:"2 шт"}]},
      {id:"dw16",n:"Монтаж канализации",cost:0,note:"",mats:[]}
    ]},
    {id:"ts_e3",n:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",c:"#27ae60",works:[
      {id:"dw17",n:"Фасад — покраска в 2 слоя",cost:4900,note:"",mats:[{id:"dm17_1",n:"Краска по металлу Elcon DIY грунт-эмаль 3 в 1 матовая графит RAL 7024 9 кг",cost:4900,store:"Озон",url:"https://www.ozon.ru/product/kraska-po-metallu-i-rzhavchine-elcon-diy-grunt-emal-3-v-1-bystrosohnushchaya-matovaya-grafit-3229869323/",note:""}]},
      {id:"dw18",n:"Монтаж окон и дверей пластиковых",cost:0,note:"",mats:[]},
      {id:"dw19",n:"Фасад — отделка оконных и дверных проёмов",cost:6600,note:"",mats:[{id:"dm19_1",n:"Планкен сосна АВ",cost:6600,store:"Белка",url:"",note:"600 кв м × 11р"},{id:"dm19_2",n:"Уголок 40 на 40",cost:2000,store:"Белка",url:"",note:"10 шт"}]},
      {id:"dw20",n:"Потолок весь — вагонка",cost:21000,note:"15 кв",mats:[{id:"dm20_1",n:"Вагонка паркет Экстра липа",cost:21000,store:"Нижний Новгород",url:"",note:"15 кв по 1400р"}]},
      {id:"dw21",n:"Стены комнаты отдыха — вагонка",cost:28000,note:"20 кв",mats:[{id:"dm21_1",n:"Вагонка паркет Экстра липа",cost:28000,store:"Нижний Новгород",url:"",note:"20 кв по 1400р"}]},
      {id:"dw22",n:"Монтаж розеток, выключателей и щитка",cost:7580,note:"",mats:[{id:"dm22_1",n:"Розетка Intro Plano 1-202-02",cost:1520,store:"Озон",url:"https://www.ozon.ru/product/rozetka-intro-plano-1-202-02-s-zazemleniem-2p-e-schuko-16a-250v-ip20-skrytoy-ustanovki-1607687840/",note:"10 шт"},{id:"dm22_2",n:"Выключатель трехклавишный слоновая кость",cost:340,store:"Озон",url:"https://www.ozon.ru/product/vyklyuchatel-trehklavishnyy-slonovaya-kost-10a-250v-b0053789-1-106-02-intro-plano-3441138006/",note:"2 шт"},{id:"dm22_3",n:"Выключатель Intro Plano двухклавишный",cost:380,store:"Озон",url:"https://www.ozon.ru/product/vyklyuchatel-intro-plano-1-105-02-dvuhklavishnyy-s-podsvetkoy-10a-250v-ip20-su-slonovaya-kost-1607686528/",note:"2 шт"},{id:"dm22_4",n:"Щиток",cost:490,store:"Озон",url:"https://www.ozon.ru/product/korpus-plastikovyy-navesnoy-dlya-avtomatov-intro-shchrn-p-12-258h198h95-ip41-prozrachnaya-3543755293/",note:""},{id:"dm22_5",n:"Дифференциальный автомат IEK АВДТ32 C25",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/differentsialnyy-avtomat-difavtomat-iek-avdt32-c25-30ma-tip-a-1680116803/",note:""},{id:"dm22_6",n:"Автоматический выключатель 16А (12 шт)",cost:1700,store:"Озон",url:"https://www.ozon.ru/product/avtomaticheskiy-vyklyuchatel-16a-iek-1p-4-5ka-tip-s-12sht-362248733/",note:""},{id:"dm22_7",n:"Автоматический выключатель 10А (12 шт)",cost:2150,store:"Озон",url:"https://www.ozon.ru/product/avtomaticheskiy-vyklyuchatel-10a-iek-1p-4-5ka-tip-s-va47-29-12-sht-362471013/",note:""}]},
      {id:"dw23",n:"Стены душевой и туалета — плитка SPC",cost:25200,note:"",mats:[{id:"dm23_1",n:"SPC плитка Виго класс 43 толщина 4 мм 1.8 м²",cost:25200,store:"Лемана",url:"https://lemanapro.ru/product/spc-plitka-vigo-klass-43-tolshchina-4-mm-18-m-89396935/",note:"9 пачек на 16 кв"}]},
      {id:"dw24",n:"Стены парной — вагонка",cost:29400,note:"",mats:[{id:"dm24_1",n:"Вагонка паркет Экстра липа",cost:29400,store:"Нижний Новгород",url:"",note:"21 кв по 1400р"},{id:"dm24_2",n:"Фольга",cost:0,store:"",url:"",note:""},{id:"dm24_3",n:"Войлок",cost:0,store:"",url:"",note:""}]},
      {id:"dw25",n:"Пол комнаты отдыха и туалета — кварцвинил (влагостойкий)",cost:8430,note:"",mats:[{id:"dm25_1",n:"SPC плитка Дуб Марсель класс 42 толщина 3.5 мм 2.16 м²",cost:7980,store:"Лемана",url:"https://lemanapro.ru/product/spc-plitka-dub-marsel-klass-42-tolshchina-35-mm-216-m-89396933/",note:"7 пачек"},{id:"dm25_2",n:"Подложка под напольное покрытие MONLID 3 мм 6 м²",cost:450,store:"Лемана",url:"https://lemanapro.ru/product/podlozhka-xps-dlya-teplogo-pola-18-mm-6m-17985854/",note:""}]},
      {id:"dw26",n:"Пол душевой и парной — керамогранит",cost:10022,note:"",mats:[{id:"dm26_1",n:"Глазурованный керамогранит Шахтинская Плитка Гранде 40x40x0.8 см",cost:5022,store:"Лемана",url:"https://lemanapro.ru/product/glazurovannyy-keramogranit-shahtinskaya-plitka-grande-40x40x08-sm-16-m-matovyy-cvet-svetlo-bezhevyy-89132470/",note:"6 кв м"},{id:"dm26_2",n:"Клей для плитки Церезит CM 17 Super Flex 25 кг",cost:5000,store:"Лемана",url:"https://lemanapro.ru/product/kley-dlya-plitki-cerezit-cm-17-super-flex-vysokoelastichnyy-25-kg-82040398/",note:"2 пачки"}]},
      {id:"dw27",n:"Межкомнатные банные двери — комплект 3 шт",cost:23400,note:"",mats:[{id:"dm27_1",n:"Дверь стеклянная банная СБМ правая / бронза матовое / короб сосна 6×680×1900 мм",cost:23400,store:"Белка",url:"",note:"3 шт"}]},
      {id:"dw28",n:"Инженерный узел — бойлер 80 л + мембрана + фильтр",cost:20600,note:"",mats:[{id:"dm28_1",n:"Гидроаккумулятор EcWATER АвтоБак CAВ 24 РД (24 литра)",cost:6500,store:"Озон",url:"https://www.ozon.ru/product/gidroakkumulyator-v-sbore-s-avtomatikoy-ecwater-avtobak-cav-24-rd-24-litra-vertikalnyy-s-1292076714/",note:""},{id:"dm28_2",n:"Водонагреватель Oasis 80VZ, 80 л",cost:14100,store:"Озон",url:"https://www.ozon.ru/product/vodonagrevatel-nakopitelnyy-elektricheskiy-boyler-dlya-vody-belyy-oasis-80vz-80-l-2000-vt-702804620/",note:""}]},
      {id:"dw29",n:"Монтаж плинтусов, откосов, наличников, окна банного",cost:8142,note:"",mats:[{id:"dm29_1",n:"Оконный блок Липа банный / стеклопакет прозр. / фурн. цинк (400×400 мм)",cost:1800,store:"Белка",url:"",note:""},{id:"dm29_2",n:"Наличник деревянный осина А сращенный",cost:2142,store:"Белка",url:"",note:"14 шт"},{id:"dm29_3",n:"Плинтус 15×42 мм липа экстра",cost:4200,store:"Белка",url:"",note:"60 шт"}]},
      {id:"dw30",n:"Монтаж полков",cost:28060,note:"",mats:[{id:"dm30_1",n:"Полок Термо Липа Экстра 26×90 мм",cost:10320,store:"Белка",url:"",note:"2 м × 12 шт по 430р/пм"},{id:"dm30_2",n:"Полок Термо Липа Экстра 26×90 мм",cost:3840,store:"Белка",url:"",note:"1,5 м × 8 шт по 240р/пм"},{id:"dm30_3",n:"Полок Осина массив Экстра 28×92 мм",cost:8400,store:"Белка",url:"",note:"2 м × 21 шт по 200р/пм"},{id:"dm30_4",n:"Полок Осина массив АВ 28×92 мм",cost:5500,store:"Белка",url:"",note:"2 м × 25 шт по 110р/пм"}]},
      {id:"dw31",n:"Монтаж пано можжевеловое, светильники, подсветки",cost:18320,note:"",mats:[{id:"dm31_1",n:"Можжевельник",cost:9000,store:"Авито",url:"https://www.avito.ru/pushkino/remont_i_stroitelstvo/mozhzhevelnik_7764702142",note:"3 кв м × 3000р/кв"},{id:"dm31_2",n:"Доставка можжевельника",cost:2000,store:"",url:"",note:""},{id:"dm31_3",n:"Гималайская соль",cost:2200,store:"Южные ворота",url:"",note:"2 коробки по 1100р"},{id:"dm31_4",n:"Лента светодиодная для бани 12V IP65 Теплый белый",cost:2560,store:"Озон",url:"https://www.ozon.ru/product/lenta-svetodiodnaya-dlya-bani-i-sauny-termostoykaya-12v-ip65-teplyy-belyy-2308956283/",note:"2 шт по 5 м"},{id:"dm31_5",n:"Блок питания 12V 200W импульсный",cost:1060,store:"Озон",url:"https://www.ozon.ru/product/blok-pitaniya-12v-200w-180-265-impulsnyy-dlya-svetodiodnyh-lent-i-svetilnikov-1623735974/",note:"2 шт"},{id:"dm31_6",n:"Светодиодная лента 10м COB 320LED 12V 10W/м 3000K 8мм",cost:1500,store:"Озон",url:"https://www.ozon.ru/product/svetodiodnaya-lenta-10m-cob-320-led-12v-10w-m-teplyy-belyy-3000k-8mm-2649025420/",note:""}]},
      {id:"dw32",n:"Монтаж печи и дымохода",cost:62777,note:"",mats:[{id:"dm32_1",n:"Печь для бани ASTON 24 (310M) Лонг",cost:36000,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/pech-dlya-bani-aston-24-310m-long/",note:""},{id:"dm32_2",n:"Сетка для камней ASTON",cost:3290,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/pechi-dlya-ban-i-saun/setki-dlya-kamney/setka-dlya-kamney-aston/",note:""},{id:"dm32_3",n:"Труба нерж. (AISI 430) L-1м d130",cost:1234,store:"pechki.su",url:"https://pechki.su/dymohody/truba-nerzh-aisi-43008mm-d130-l-1m/",note:""},{id:"dm32_4",n:"Шибер поворотный Сталь 1,0мм 115мм",cost:776,store:"pechki.su",url:"https://pechki.su/dymohody/shiber-lava-povorotnyy-stal-1mm/",note:""},{id:"dm32_5",n:"Переход на сэндвич нерж. (AISI 430) 115-180 мм",cost:1180,store:"pechki.su",url:"https://pechki.su/dymohody/perekhod-na-sendvich-nerzh-aisi-43008mm/",note:""},{id:"dm32_6",n:"Сэндвич-труба Оц+Нерж (AISI 430) L-1м 115-180",cost:5110,store:"pechki.su",url:"https://pechki.su/dymohody/ocinkovannye-dymohody-vezuviy/sendvich-truba-ocznerzh-aisi-43005mm-l-1m/",note:"2 шт"},{id:"dm32_7",n:"Хомут под растяжку (AISI 430) 115",cost:260,store:"pechki.su",url:"https://pechki.su/dymohody/homut-pod-rastyazhku-aisi-430-0-5mm/",note:""},{id:"dm32_8",n:"Хомут под растяжку (AISI 430) 180",cost:918,store:"pechki.su",url:"https://pechki.su/dymohody/homut-pod-rastyazhku-aisi-430-0-5mm/",note:"3 шт"},{id:"dm32_9",n:"Дефлектор Оц 115-180мм",cost:1836,store:"pechki.su",url:"https://pechki.su/dymohody/deflektor-ocz-aisi-43005mm/",note:""},{id:"dm32_10",n:"Герметик термостойкий ВЕЗУВИЙ 1500°С 290мл",cost:593,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/germetik-termostoykiy-vezuviy-1500s-chernyy-290-ml/",note:""},{id:"dm32_11",n:"Базальтовая вата (3кг)",cost:910,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/bazaltovye-materialy/bazaltovaya-vata-3kg/",note:""},{id:"dm32_12",n:"Базальтовый картон 1000х600х6мм (3шт/уп)",cost:780,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/bazaltovye-materialy/bazaltovyj-karton-1000kh600kh6mm-3shtup/",note:""},{id:"dm32_13",n:"ППУ нерж. (AISI 430) 185",cost:1970,store:"pechki.su",url:"https://pechki.su/dymohody/nerzhaveyuschie-dymohody-vezuviy/ppu-nerzh-aisi-43005mm/",note:""},{id:"dm32_14",n:"Кровельный проходник ВЕЗУВИЙ №4 (890х890мм) угл, силикон",cost:3330,store:"pechki.su",url:"https://pechki.su/dymohody/master-flesh/master-flesh-vezuviy-4-d-300-450mm-890h890mm-ugl-silikon/",note:""},{id:"dm32_15",n:"Камень Габбро-диабаз (мешок 20кг)",cost:2375,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/kamni-dlya-pechey/kamen-gabro-diabaz-meshok-20-kg/",note:"5 мешков"},{id:"dm32_16",n:"Камень Малиновый кварцит колотый (коробка 20кг)",cost:815,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/kamni-dlya-pechey/kamen-malinovyj-kvarczit-kolotyj-korobka-20kg/",note:"1 мешок"},{id:"dm32_17",n:"Герметизирующая лента NICOBAND Технониколь 10м",cost:1400,store:"Озон",url:"https://www.ozon.ru/product/germetiziruyushchaya-lenta-10m-15sm-serebristaya-samokleyashchayasya-nicoband-tehnonikol-1071209469/",note:""},{id:"dm32_18",n:"Мастика термовлагостойкая клеящая NEOMID 4 кг",cost:1050,store:"Озон",url:"https://www.ozon.ru/product/mastika-termovlagostoykaya-kleyashchaya-neomid-universalnaya-4-kg-kley-dlya-plitki-964540731/",note:""},{id:"dm32_19",n:"Плитка Керамин Студио 60x30 см матовая коричневый дерево",cost:3000,store:"Лемана",url:"https://lemanapro.ru/product/plitka-nastennaya-keramin-studio-60x30-sm-198-m-matovaya-cvet-korichnevyy-derevo-88923926/",note:"4 кв"}]},
      {id:"dw33",n:"Монтаж унитаза",cost:5700,note:"",mats:[{id:"dm33_1",n:"Унитаз компакт Sanita Master косой выпуск",cost:5700,store:"Лемана",url:"https://lemanapro.ru/product/unitaz-kompakt-sanita-master-kosoy-vypusk-dvoynoy-sliv-82624807/",note:""}]},
      {id:"dw34",n:"Кондиционер",cost:35000,note:"",mats:[]},
      {id:"dw35",n:"Покрытие полков маслом",cost:20000,note:"",mats:[]}
    ]}
  ]},
  {id:"t2",name:"Дом 40 футов",icon:"🏠",kind:"house",stages:[
    {id:"ts2_e1",n:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",c:"#e67e22",works:[
      {id:"dw1",n:"Двери и Окна Рехау Термо — ламинация, 3 стекла, энергосбережение",cost:50000,note:"50 тыс · комплект",mats:[]},
      {id:"dw2",n:"Аренда площадки",cost:50000,note:"25 тыс в месяц · 2 месяца",mats:[]},
      {id:"dw3",n:"Монтаж подвесов для обрешётки к стенам",cost:1570,note:"",mats:[{id:"dm3_1",n:"Подвесы крепежные прямые 27x270x0,5",cost:600,store:"Озон",url:"https://www.ozon.ru/product/podvesy-krepezhnye-pryamye-27x270x0-5-mm-dlya-profilya-100-sht-3735563806/",note:"100 шт"},{id:"dm3_2",n:"Tytan Professional Клей 2 фикс",cost:970,store:"Озон",url:"https://www.ozon.ru/product/tytan-professional-kley-stroitelnyy-290-ml-1-sht-215536620/",note:"1 шт"}]},
      {id:"dw4",n:"Усиление оконных и дверных проёмов",cost:6480,note:"Труба 40×40 или 50×50 мм",mats:[{id:"dm4_1",n:"Труба профильная 40x40x2мм 3 м",cost:3480,store:"Лемана",url:"https://lemanapro.ru/product/truba-profilnaya-40x40x2mm-3-m-13376760/",note:"6 шт по 3 м"},{id:"dm4_2",n:"Доставка",cost:3000,store:"Лемана",url:"",note:""}]},
      {id:"dw5",n:"Утепление пола — ЭППС 10 см",cost:20800,note:"",mats:[{id:"dm5_1",n:"ЭППС",cost:10500,store:"Егорьевск",url:"",note:"350 за кв м"},{id:"dm5_2",n:"Клей-пена POLYNOR 60 СЕКУНД",cost:3300,store:"Озон",url:"https://www.ozon.ru/product/kley-pena-polynor-60-sekund-box-polinor-60-sekund-universalnaya-komplekt-12-sht-948411658/",note:"6 баллонов по 550 р"},{id:"dm5_3",n:"Доставка",cost:7000,store:"Егорьевск",url:"",note:""}]},
      {id:"dw6",n:"Монтаж чернового пола из ОСП",cost:25210,note:"",mats:[{id:"dm6_1",n:"ОСП 30 м²",cost:14910,store:"Белка",url:"",note:"21 шт 1,25*2,5"},{id:"dm6_2",n:"Клей-пена POLYNOR 60 СЕКУНД",cost:3300,store:"Озон",url:"https://www.ozon.ru/product/kley-pena-polynor-60-sekund-box-polinor-60-sekund-universalnaya-komplekt-12-sht-948411658/",note:"6 баллонов"},{id:"dm6_3",n:"Доставка",cost:7000,store:"Белка",url:"",note:""}]},
      {id:"dw7",n:"Утепление стен и потолка — ППУ 3 см",cost:61992,note:"",mats:[]}
    ]},
    {id:"ts2_e2",n:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",c:"#2980b9",works:[
      {id:"dw8",n:"Монтаж обрешётки из сухого строганого бруса",cost:4800,note:"",mats:[{id:"dm8_1",n:"Рейка строганная 20 на 40",cost:4800,store:"Белка",url:"",note:"60 шт по 80р"}]},
      {id:"dw9",n:"Монтаж перегородок",cost:3435,note:"",mats:[{id:"dm9_1",n:"Брусок строганный 50 на 50",cost:3435,store:"Белка",url:"",note:"15 шт по 229р"}]},
      {id:"dw10",n:"Разводка электрики кабелем по ГОСТ",cost:15710,note:"",mats:[{id:"dm10_1",n:"Кабель ВВГ Пнг (А) LS 3х2,5 мм2 100М",cost:7800,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3h2-5-mm2-100m-1605500925/",note:""},{id:"dm10_2",n:"Кабель ВВГ Пнг (А) LS 3х1,5 мм2 100М",cost:5100,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3h1-5-mm2-100m-1606304346/",note:""},{id:"dm10_3",n:"Коробка установочная в гипсокартон 68х45 мм (10 шт)",cost:500,store:"Озон",url:"https://www.ozon.ru/product/korobka-ustanovochnaya-v-gipsokarton-siniy-68h45-mm-10-sht-3168901039/",note:""},{id:"dm10_4",n:"Кабель ВВГ Пнг (А) Ls 3x4, 15 метров",cost:2310,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3x4-15-metrov-1667556252/",note:""}]},
      {id:"dw11",n:"Водоснабжение — сшитый полиэтилен",cost:15215,note:"",mats:[{id:"dm11_1",n:"Тройник Ростерм 16 мм латунь",cost:1310,store:"Лемана",url:"https://lemanapro.ru/product/troynik-rosterm-16-mm-latun-88700669/",note:"5 шт"},{id:"dm11_2",n:"Водорозетка Ростерм 1/2\"x16 мм ВР латунь",cost:1855,store:"Лемана",url:"https://lemanapro.ru/product/vodorozetka-rosterm-1-2x16-mm-vr-latun-82262639/",note:"5 шт"},{id:"dm11_3",n:"Монтажная гильза Ростерм 16x2.2 мм PVDF",cost:2190,store:"Лемана",url:"https://lemanapro.ru/product/montazhnaya-gilza-rosterm-16x22-mm-pvdf-82132721/",note:"30 шт"},{id:"dm11_4",n:"Труба из сшитого полиэтилена 100 м Valtec PEXA-EVOH 16 мм x 2,2 мм",cost:8860,store:"Озон",url:"https://www.ozon.ru/product/truba-iz-sshitogo-polietilena-100-m-valtec-pexa-evoh-va1622-3-c-100-16-mm-x-2-2-mm-1886739508/",note:"100 м"},{id:"dm11_5",n:"Теплоизоляция для труб Energoflex Super Protect 18/4-11 (2 бухты по 11м)",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/teploizolyatsiya-dlya-trub-energoflex-super-protect-18-4-11-sinyaya-krasnaya-uteplitel-dlya-trub-3574400762/",note:""}]},
      {id:"dw12",n:"Монтаж стен из ОСП, ГСП и утеплителя",cost:8606,note:"",mats:[{id:"dm12_1",n:"ОСП 18 м²",cost:4260,store:"Белка",url:"",note:"6 листов"},{id:"dm12_2",n:"Звукоизоляция Knauf АкустиKnauf 50 мм 6 м²",cost:2162,store:"Лемана",url:"https://lemanapro.ru/product/zvukoizolyaciya-knauf-insulation-akustiknauf-50-mm-10-sht-610x1000-mm-6-m-18482159/",note:""},{id:"dm12_3",n:"Гипсоволокнистый лист ГВЛВ ПК 10 мм Knauf 600x1200 мм",cost:2184,store:"Лемана",url:"https://lemanapro.ru/product/gipsovoloknistyy-list-gvlv-pk-10-mm-knauf-superlist-600x1200-mm-18527409/",note:""}]},
      {id:"dw13",n:"Санузел — гидроизоляция стен и пола",cost:6500,note:"",mats:[{id:"dm13_1",n:"Гидроизоляция для ванны, кровли, бетона 24 кг",cost:6500,store:"Озон",url:"https://www.ozon.ru/product/gidroizolyatsiya-dlya-vanny-krovli-betona-24-kg-2223640495/",note:""}]},
      {id:"dw14",n:"Монтаж теплого пола с заливкой",cost:9300,note:"",mats:[{id:"dm14_1",n:"Теплый пол 9 м² электрический мат под плитку 150 вт",cost:5200,store:"Озон",url:"https://www.ozon.ru/product/teplyy-pol-9-m2-elektricheskiy-mat-pod-plitku-150-vt-s-mehanicheskim-regulyatorom-735920062/",note:""},{id:"dm14_2",n:"Грунтовка Кнауф Тифенгрунд F мороз 10 кг",cost:1400,store:"Лемана",url:"https://lemanapro.ru/product/gruntovka-glubokogo-proniknoveniya-knauf-tifengrund-f-moroz-10-kg-85060727/",note:""},{id:"dm14_3",n:"Наливной пол Волма Нивелир Экспресс 25 кг",cost:2700,store:"Лемана",url:"https://lemanapro.ru/product/nalivnoy-pol-volma-nivelir-ekspress-25-kg-87481463/",note:"6 мешков"}]},
      {id:"dw15",n:"Вентиляция — клапаны приточные + вытяжные вентиляторы",cost:3700,note:"",mats:[{id:"dm15_1",n:"Оконный приточный клапан NovaVent",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/okonnyy-pritochnyy-klapan-novavent-max-s-filtrom-dlya-ventilyatsii-provetrivatel-okonnyy-2-shtuki-1439055176/",note:""},{id:"dm15_2",n:"Вентилятор вытяжной 100мм с обратным клапаном",cost:2700,store:"Озон",url:"https://www.ozon.ru/product/ventilyator-vytyazhnoy-100mm-s-obratnym-klapanom-airtube-classic-matt-white-100-matovyy-belyy-3626278570/",note:"2 шт"}]},
      {id:"dw16",n:"Монтаж канализации",cost:0,note:"",mats:[]}
    ]},
    {id:"ts2_e3",n:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",c:"#27ae60",works:[
      {id:"dw17",n:"Фасад — покраска в 2 слоя",cost:4900,note:"",mats:[{id:"dm17_1",n:"Краска по металлу Elcon DIY грунт-эмаль 3 в 1 матовая графит RAL 7024 9 кг",cost:4900,store:"Озон",url:"https://www.ozon.ru/product/kraska-po-metallu-i-rzhavchine-elcon-diy-grunt-emal-3-v-1-bystrosohnushchaya-matovaya-grafit-3229869323/",note:""}]},
      {id:"dw18",n:"Монтаж окон и дверей пластиковых",cost:0,note:"",mats:[]},
      {id:"dw19",n:"Фасад — отделка оконных и дверных проёмов",cost:6600,note:"",mats:[{id:"dm19_1",n:"Планкен сосна АВ",cost:6600,store:"Белка",url:"",note:"600 кв м × 11р"},{id:"dm19_2",n:"Уголок 40 на 40",cost:2000,store:"Белка",url:"",note:"10 шт"}]},
      {id:"dw20",n:"Потолок весь — вагонка",cost:21000,note:"15 кв",mats:[{id:"dm20_1",n:"Вагонка паркет Экстра липа",cost:21000,store:"Нижний Новгород",url:"",note:"15 кв по 1400р"}]},
      {id:"dw21",n:"Стены комнаты отдыха — вагонка",cost:28000,note:"20 кв",mats:[{id:"dm21_1",n:"Вагонка паркет Экстра липа",cost:28000,store:"Нижний Новгород",url:"",note:"20 кв по 1400р"}]},
      {id:"dw22",n:"Монтаж розеток, выключателей и щитка",cost:7580,note:"",mats:[{id:"dm22_1",n:"Розетка Intro Plano 1-202-02",cost:1520,store:"Озон",url:"https://www.ozon.ru/product/rozetka-intro-plano-1-202-02-s-zazemleniem-2p-e-schuko-16a-250v-ip20-skrytoy-ustanovki-1607687840/",note:"10 шт"},{id:"dm22_2",n:"Выключатель трехклавишный слоновая кость",cost:340,store:"Озон",url:"https://www.ozon.ru/product/vyklyuchatel-trehklavishnyy-slonovaya-kost-10a-250v-b0053789-1-106-02-intro-plano-3441138006/",note:"2 шт"},{id:"dm22_3",n:"Выключатель Intro Plano двухклавишный",cost:380,store:"Озон",url:"https://www.ozon.ru/product/vyklyuchatel-intro-plano-1-105-02-dvuhklavishnyy-s-podsvetkoy-10a-250v-ip20-su-slonovaya-kost-1607686528/",note:"2 шт"},{id:"dm22_4",n:"Щиток",cost:490,store:"Озон",url:"https://www.ozon.ru/product/korpus-plastikovyy-navesnoy-dlya-avtomatov-intro-shchrn-p-12-258h198h95-ip41-prozrachnaya-3543755293/",note:""},{id:"dm22_5",n:"Дифференциальный автомат IEK АВДТ32 C25",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/differentsialnyy-avtomat-difavtomat-iek-avdt32-c25-30ma-tip-a-1680116803/",note:""},{id:"dm22_6",n:"Автоматический выключатель 16А (12 шт)",cost:1700,store:"Озон",url:"https://www.ozon.ru/product/avtomaticheskiy-vyklyuchatel-16a-iek-1p-4-5ka-tip-s-12sht-362248733/",note:""},{id:"dm22_7",n:"Автоматический выключатель 10А (12 шт)",cost:2150,store:"Озон",url:"https://www.ozon.ru/product/avtomaticheskiy-vyklyuchatel-10a-iek-1p-4-5ka-tip-s-va47-29-12-sht-362471013/",note:""}]},
      {id:"dw23",n:"Стены душевой и туалета — плитка SPC",cost:25200,note:"",mats:[{id:"dm23_1",n:"SPC плитка Виго класс 43 толщина 4 мм 1.8 м²",cost:25200,store:"Лемана",url:"https://lemanapro.ru/product/spc-plitka-vigo-klass-43-tolshchina-4-mm-18-m-89396935/",note:"9 пачек на 16 кв"}]},
      {id:"dw24",n:"Стены парной — вагонка",cost:29400,note:"",mats:[{id:"dm24_1",n:"Вагонка паркет Экстра липа",cost:29400,store:"Нижний Новгород",url:"",note:"21 кв по 1400р"},{id:"dm24_2",n:"Фольга",cost:0,store:"",url:"",note:""},{id:"dm24_3",n:"Войлок",cost:0,store:"",url:"",note:""}]},
      {id:"dw25",n:"Пол комнаты отдыха и туалета — кварцвинил (влагостойкий)",cost:8430,note:"",mats:[{id:"dm25_1",n:"SPC плитка Дуб Марсель класс 42 толщина 3.5 мм 2.16 м²",cost:7980,store:"Лемана",url:"https://lemanapro.ru/product/spc-plitka-dub-marsel-klass-42-tolshchina-35-mm-216-m-89396933/",note:"7 пачек"},{id:"dm25_2",n:"Подложка под напольное покрытие MONLID 3 мм 6 м²",cost:450,store:"Лемана",url:"https://lemanapro.ru/product/podlozhka-xps-dlya-teplogo-pola-18-mm-6m-17985854/",note:""}]},
      {id:"dw26",n:"Пол душевой и парной — керамогранит",cost:10022,note:"",mats:[{id:"dm26_1",n:"Глазурованный керамогранит Шахтинская Плитка Гранде 40x40x0.8 см",cost:5022,store:"Лемана",url:"https://lemanapro.ru/product/glazurovannyy-keramogranit-shahtinskaya-plitka-grande-40x40x08-sm-16-m-matovyy-cvet-svetlo-bezhevyy-89132470/",note:"6 кв м"},{id:"dm26_2",n:"Клей для плитки Церезит CM 17 Super Flex 25 кг",cost:5000,store:"Лемана",url:"https://lemanapro.ru/product/kley-dlya-plitki-cerezit-cm-17-super-flex-vysokoelastichnyy-25-kg-82040398/",note:"2 пачки"}]},
      {id:"dw27",n:"Межкомнатные банные двери — комплект 3 шт",cost:23400,note:"",mats:[{id:"dm27_1",n:"Дверь стеклянная банная СБМ правая / бронза матовое / короб сосна 6×680×1900 мм",cost:23400,store:"Белка",url:"",note:"3 шт"}]},
      {id:"dw28",n:"Инженерный узел — бойлер 80 л + мембрана + фильтр",cost:20600,note:"",mats:[{id:"dm28_1",n:"Гидроаккумулятор EcWATER АвтоБак CAВ 24 РД (24 литра)",cost:6500,store:"Озон",url:"https://www.ozon.ru/product/gidroakkumulyator-v-sbore-s-avtomatikoy-ecwater-avtobak-cav-24-rd-24-litra-vertikalnyy-s-1292076714/",note:""},{id:"dm28_2",n:"Водонагреватель Oasis 80VZ, 80 л",cost:14100,store:"Озон",url:"https://www.ozon.ru/product/vodonagrevatel-nakopitelnyy-elektricheskiy-boyler-dlya-vody-belyy-oasis-80vz-80-l-2000-vt-702804620/",note:""}]},
      {id:"dw29",n:"Монтаж плинтусов, откосов, наличников, окна банного",cost:8142,note:"",mats:[{id:"dm29_1",n:"Оконный блок Липа банный / стеклопакет прозр. / фурн. цинк (400×400 мм)",cost:1800,store:"Белка",url:"",note:""},{id:"dm29_2",n:"Наличник деревянный осина А сращенный",cost:2142,store:"Белка",url:"",note:"14 шт"},{id:"dm29_3",n:"Плинтус 15×42 мм липа экстра",cost:4200,store:"Белка",url:"",note:"60 шт"}]},
      {id:"dw30",n:"Монтаж полков",cost:28060,note:"",mats:[{id:"dm30_1",n:"Полок Термо Липа Экстра 26×90 мм",cost:10320,store:"Белка",url:"",note:"2 м × 12 шт по 430р/пм"},{id:"dm30_2",n:"Полок Термо Липа Экстра 26×90 мм",cost:3840,store:"Белка",url:"",note:"1,5 м × 8 шт по 240р/пм"},{id:"dm30_3",n:"Полок Осина массив Экстра 28×92 мм",cost:8400,store:"Белка",url:"",note:"2 м × 21 шт по 200р/пм"},{id:"dm30_4",n:"Полок Осина массив АВ 28×92 мм",cost:5500,store:"Белка",url:"",note:"2 м × 25 шт по 110р/пм"}]},
      {id:"dw31",n:"Монтаж пано можжевеловое, светильники, подсветки",cost:18320,note:"",mats:[{id:"dm31_1",n:"Можжевельник",cost:9000,store:"Авито",url:"https://www.avito.ru/pushkino/remont_i_stroitelstvo/mozhzhevelnik_7764702142",note:"3 кв м × 3000р/кв"},{id:"dm31_2",n:"Доставка можжевельника",cost:2000,store:"",url:"",note:""},{id:"dm31_3",n:"Гималайская соль",cost:2200,store:"Южные ворота",url:"",note:"2 коробки по 1100р"},{id:"dm31_4",n:"Лента светодиодная для бани 12V IP65 Теплый белый",cost:2560,store:"Озон",url:"https://www.ozon.ru/product/lenta-svetodiodnaya-dlya-bani-i-sauny-termostoykaya-12v-ip65-teplyy-belyy-2308956283/",note:"2 шт по 5 м"},{id:"dm31_5",n:"Блок питания 12V 200W импульсный",cost:1060,store:"Озон",url:"https://www.ozon.ru/product/blok-pitaniya-12v-200w-180-265-impulsnyy-dlya-svetodiodnyh-lent-i-svetilnikov-1623735974/",note:"2 шт"},{id:"dm31_6",n:"Светодиодная лента 10м COB 320LED 12V 10W/м 3000K 8мм",cost:1500,store:"Озон",url:"https://www.ozon.ru/product/svetodiodnaya-lenta-10m-cob-320-led-12v-10w-m-teplyy-belyy-3000k-8mm-2649025420/",note:""}]},
      {id:"dw32",n:"Монтаж печи и дымохода",cost:62777,note:"",mats:[{id:"dm32_1",n:"Печь для бани ASTON 24 (310M) Лонг",cost:36000,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/pech-dlya-bani-aston-24-310m-long/",note:""},{id:"dm32_2",n:"Сетка для камней ASTON",cost:3290,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/pechi-dlya-ban-i-saun/setki-dlya-kamney/setka-dlya-kamney-aston/",note:""},{id:"dm32_3",n:"Труба нерж. (AISI 430) L-1м d130",cost:1234,store:"pechki.su",url:"https://pechki.su/dymohody/truba-nerzh-aisi-43008mm-d130-l-1m/",note:""},{id:"dm32_4",n:"Шибер поворотный Сталь 1,0мм 115мм",cost:776,store:"pechki.su",url:"https://pechki.su/dymohody/shiber-lava-povorotnyy-stal-1mm/",note:""},{id:"dm32_5",n:"Переход на сэндвич нерж. (AISI 430) 115-180 мм",cost:1180,store:"pechki.su",url:"https://pechki.su/dymohody/perekhod-na-sendvich-nerzh-aisi-43008mm/",note:""},{id:"dm32_6",n:"Сэндвич-труба Оц+Нерж (AISI 430) L-1м 115-180",cost:5110,store:"pechki.su",url:"https://pechki.su/dymohody/ocinkovannye-dymohody-vezuviy/sendvich-truba-ocznerzh-aisi-43005mm-l-1m/",note:"2 шт"},{id:"dm32_7",n:"Хомут под растяжку (AISI 430) 115",cost:260,store:"pechki.su",url:"https://pechki.su/dymohody/homut-pod-rastyazhku-aisi-430-0-5mm/",note:""},{id:"dm32_8",n:"Хомут под растяжку (AISI 430) 180",cost:918,store:"pechki.su",url:"https://pechki.su/dymohody/homut-pod-rastyazhku-aisi-430-0-5mm/",note:"3 шт"},{id:"dm32_9",n:"Дефлектор Оц 115-180мм",cost:1836,store:"pechki.su",url:"https://pechki.su/dymohody/deflektor-ocz-aisi-43005mm/",note:""},{id:"dm32_10",n:"Герметик термостойкий ВЕЗУВИЙ 1500°С 290мл",cost:593,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/germetik-termostoykiy-vezuviy-1500s-chernyy-290-ml/",note:""},{id:"dm32_11",n:"Базальтовая вата (3кг)",cost:910,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/bazaltovye-materialy/bazaltovaya-vata-3kg/",note:""},{id:"dm32_12",n:"Базальтовый картон 1000х600х6мм (3шт/уп)",cost:780,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/bazaltovye-materialy/bazaltovyj-karton-1000kh600kh6mm-3shtup/",note:""},{id:"dm32_13",n:"ППУ нерж. (AISI 430) 185",cost:1970,store:"pechki.su",url:"https://pechki.su/dymohody/nerzhaveyuschie-dymohody-vezuviy/ppu-nerzh-aisi-43005mm/",note:""},{id:"dm32_14",n:"Кровельный проходник ВЕЗУВИЙ №4 (890х890мм) угл, силикон",cost:3330,store:"pechki.su",url:"https://pechki.su/dymohody/master-flesh/master-flesh-vezuviy-4-d-300-450mm-890h890mm-ugl-silikon/",note:""},{id:"dm32_15",n:"Камень Габбро-диабаз (мешок 20кг)",cost:2375,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/kamni-dlya-pechey/kamen-gabro-diabaz-meshok-20-kg/",note:"5 мешков"},{id:"dm32_16",n:"Камень Малиновый кварцит колотый (коробка 20кг)",cost:815,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/kamni-dlya-pechey/kamen-malinovyj-kvarczit-kolotyj-korobka-20kg/",note:"1 мешок"},{id:"dm32_17",n:"Герметизирующая лента NICOBAND Технониколь 10м",cost:1400,store:"Озон",url:"https://www.ozon.ru/product/germetiziruyushchaya-lenta-10m-15sm-serebristaya-samokleyashchayasya-nicoband-tehnonikol-1071209469/",note:""},{id:"dm32_18",n:"Мастика термовлагостойкая клеящая NEOMID 4 кг",cost:1050,store:"Озон",url:"https://www.ozon.ru/product/mastika-termovlagostoykaya-kleyashchaya-neomid-universalnaya-4-kg-kley-dlya-plitki-964540731/",note:""},{id:"dm32_19",n:"Плитка Керамин Студио 60x30 см матовая коричневый дерево",cost:3000,store:"Лемана",url:"https://lemanapro.ru/product/plitka-nastennaya-keramin-studio-60x30-sm-198-m-matovaya-cvet-korichnevyy-derevo-88923926/",note:"4 кв"}]},
      {id:"dw33",n:"Монтаж унитаза",cost:5700,note:"",mats:[{id:"dm33_1",n:"Унитаз компакт Sanita Master косой выпуск",cost:5700,store:"Лемана",url:"https://lemanapro.ru/product/unitaz-kompakt-sanita-master-kosoy-vypusk-dvoynoy-sliv-82624807/",note:""}]},
      {id:"dw34",n:"Кондиционер",cost:35000,note:"",mats:[]},
      {id:"dw35",n:"Покрытие полков маслом",cost:20000,note:"",mats:[]}
    ]}
  ]},
];

// Объекты — пустые по умолчанию
let objects=[
  {id:"obj_banya_kievka",name:"Баня на Киевке",icon:"🛁",templateId:"t1",stages:JSON.parse(JSON.stringify(templates[0].stages))},
  {id:"obj_dom_dmitrovka",name:"Дом на Дмитровке",icon:"🏠",templateId:"t2",stages:JSON.parse(JSON.stringify(templates[1].stages))},
];

// Демо-наполнение для «Анализа стройки» (часы по работам + выходные) — у Бани на Киевке
(function seedBuildAnalysis(){
  const obj=objects.find(function(o){return o.id==="obj_banya_kievka";});
  if(!obj) return;
  const allWorks=obj.stages.flatMap(function(s){return s.works||[];});
  // Раскидываем часы по первым работам на нескольких датах
  const plan=[
    {wi:0,logs:[["valera","2026-04-14",6],["azis","2026-04-14",6],["valera","2026-04-15",4]]},
    {wi:1,logs:[["valera","2026-04-15",4],["azis","2026-04-16",8]]},
    {wi:2,logs:[["azis","2026-04-17",8],["valera","2026-04-18",7]]},
    {wi:3,logs:[["valera","2026-04-21",6],["azis","2026-04-21",6],["valera","2026-04-22",5]]},
    {wi:4,logs:[["azis","2026-04-23",8],["valera","2026-04-24",6]]},
    {wi:5,logs:[["valera","2026-04-25",7]]},
  ];
  plan.forEach(function(p){
    const w=allWorks[p.wi];
    if(!w) return;
    w.timeLogs=(w.timeLogs||[]).concat(p.logs.map(function(l){return {id:gid(),userId:l[0],date:l[1],hours:l[2]};}));
    w.done=true;
    const last=p.logs[p.logs.length-1];
    w.doneBy=last[0]; w.doneAt=last[1]+"T17:00";
  });
  // Выходные
  obj.dayReports=(obj.dayReports||[]).concat([
    {id:gid(),userId:"valera",date:"2026-04-19",dayOff:true,cleanupPhotos:[]},
    {id:gid(),userId:"azis",date:"2026-04-19",dayOff:true,cleanupPhotos:[]},
    {id:gid(),userId:"valera",date:"2026-04-20",dayOff:true,cleanupPhotos:[]},
  ]);
})();

let tab="assign";
let analysisObjId=null; // выбранный объект во вкладке «Анализ стройки»
let currentUser=null; // null = show login page
let loginMode=null;   // null = выбор Сотрудник/Клиент; "employee" = список профилей; "client" = заглушка
let loginPinFor=null; // id сотрудника, у которого запрашиваем PIN при входе
let loginPinError=""; // текст ошибки ввода PIN
let empPhoneError=""; // ошибка входа сотрудника по телефону
let showPinChange=false; // открыт диалог смены своего PIN
// === КЛИЕНТСКИЙ ВХОД ===
let clientLoginStep="find";   // "find" (ввод номера/фамилии) | "pin"
let clientLoginMatch=null;    // id найденного договора
let clientLoginError="";      // ошибка на экране входа клиента
let clientAuthContract=null;  // id договора авторизованного клиента (его кабинет)
let clientTab="objects";      // вкладка кабинета клиента: objects | contract | finance
let mgrClientView=null;       // id договора, открытого менеджером в «Клиенты»
let mgrClientTab="objects";   // подвкладка превью у менеджера
let editU=null,editR=null;
let showNU=false,showNR=false;
let showNT=false,showNWSid="",showNMSid="";
let showNObj=false;
let matModal=null;
let showNStageTid="",newTStage={n:"",c:"#e67e22"},tnsMode="manual"; // manual | db
let dbStagePicks={}; // {stageName: true} — отмеченные этапы для массового добавления
let showNWorkSid="";
let tplMatModal=null;
// Global DB
let dbWorks=[
  {id:"dw1",n:"Двери и Окна Рехау Термо — ламинация, 3 стекла, энергосбережение",cost:50000,stage:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",note:"50 тыс · комплект",mats:[]},
  {id:"dw2",n:"Аренда площадки",cost:50000,unit:"мес.",qty:2,unitCost:25000,stage:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",note:"25 тыс в месяц · 2 месяца",mats:[]},
  {id:"dw3",n:"Монтаж подвесов для обрешётки к стенам",cost:1570,stage:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",note:"",mats:[{id:"dm3_1",n:"Подвесы крепежные прямые 27x270x0,5",cost:600,store:"Озон",url:"https://www.ozon.ru/product/podvesy-krepezhnye-pryamye-27x270x0-5-mm-dlya-profilya-100-sht-3735563806/",note:"100 шт"},{id:"dm3_2",n:"Tytan Professional Клей 2 фикс",cost:970,store:"Озон",url:"https://www.ozon.ru/product/tytan-professional-kley-stroitelnyy-290-ml-1-sht-215536620/",note:"1 шт"}]},
  {id:"dw4",n:"Усиление оконных и дверных проёмов",cost:6480,stage:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",note:"Труба 40×40 или 50×50 мм",mats:[{id:"dm4_1",n:"Труба профильная 40x40x2мм 3 м",cost:3480,store:"Лемана",url:"https://lemanapro.ru/product/truba-profilnaya-40x40x2mm-3-m-13376760/",note:"6 шт по 3 м"},{id:"dm4_2",n:"Доставка",cost:3000,store:"Лемана",url:"",note:""}]},
  {id:"dw5",n:"Утепление пола — ЭППС 10 см",cost:20800,stage:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",note:"",mats:[{id:"dm5_1",n:"ЭППС",cost:10500,store:"Егорьевск",url:"",note:"350 за кв м"},{id:"dm5_2",n:"Клей-пена POLYNOR 60 СЕКУНД",cost:3300,store:"Озон",url:"https://www.ozon.ru/product/kley-pena-polynor-60-sekund-box-polinor-60-sekund-universalnaya-komplekt-12-sht-948411658/",note:"6 баллонов по 550 р"},{id:"dm5_3",n:"Доставка",cost:7000,store:"Егорьевск",url:"",note:""}]},
  {id:"dw6",n:"Монтаж чернового пола из ОСП",cost:25210,stage:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",note:"",mats:[{id:"dm6_1",n:"ОСП 30 м²",cost:14910,store:"Белка",url:"",note:"21 шт 1,25*2,5"},{id:"dm6_2",n:"Клей-пена POLYNOR 60 СЕКУНД",cost:3300,store:"Озон",url:"https://www.ozon.ru/product/kley-pena-polynor-60-sekund-box-polinor-60-sekund-universalnaya-komplekt-12-sht-948411658/",note:"6 баллонов"},{id:"dm6_3",n:"Доставка",cost:7000,store:"Белка",url:"",note:""}]},
  {id:"dw7",n:"Утепление стен и потолка — ППУ 3 см",cost:61992,stage:"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ",note:"",mats:[]},
  {id:"dw8",n:"Монтаж обрешётки из сухого строганого бруса",cost:4800,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm8_1",n:"Рейка строганная 20 на 40",cost:4800,store:"Белка",url:"",note:"60 шт по 80р"}]},
  {id:"dw9",n:"Монтаж перегородок",cost:3435,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm9_1",n:"Брусок строганный 50 на 50",cost:3435,store:"Белка",url:"",note:"15 шт по 229р"}]},
  {id:"dw10",n:"Разводка электрики кабелем по ГОСТ",cost:15710,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm10_1",n:"Кабель ВВГ Пнг (А) LS 3х2,5 мм2 100М",cost:7800,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3h2-5-mm2-100m-1605500925/",note:""},{id:"dm10_2",n:"Кабель ВВГ Пнг (А) LS 3х1,5 мм2 100М",cost:5100,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3h1-5-mm2-100m-1606304346/",note:""},{id:"dm10_3",n:"Коробка установочная в гипсокартон 68х45 мм (10 шт)",cost:500,store:"Озон",url:"https://www.ozon.ru/product/korobka-ustanovochnaya-v-gipsokarton-siniy-68h45-mm-10-sht-3168901039/",note:""},{id:"dm10_4",n:"Кабель ВВГ Пнг (А) Ls 3x4, 15 метров",cost:2310,store:"Озон",url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3x4-15-metrov-1667556252/",note:""}]},
  {id:"dw11",n:"Водоснабжение — сшитый полиэтилен",cost:15215,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm11_1",n:"Тройник Ростерм 16 мм латунь",cost:1310,store:"Лемана",url:"https://lemanapro.ru/product/troynik-rosterm-16-mm-latun-88700669/",note:"5 шт"},{id:"dm11_2",n:"Водорозетка Ростерм 1/2\"x16 мм ВР латунь",cost:1855,store:"Лемана",url:"https://lemanapro.ru/product/vodorozetka-rosterm-1-2x16-mm-vr-latun-82262639/",note:"5 шт"},{id:"dm11_3",n:"Монтажная гильза Ростерм 16x2.2 мм PVDF",cost:2190,store:"Лемана",url:"https://lemanapro.ru/product/montazhnaya-gilza-rosterm-16x22-mm-pvdf-82132721/",note:"30 шт"},{id:"dm11_4",n:"Труба из сшитого полиэтилена 100 м Valtec PEXA-EVOH 16 мм x 2,2 мм",cost:8860,store:"Озон",url:"https://www.ozon.ru/product/truba-iz-sshitogo-polietilena-100-m-valtec-pexa-evoh-va1622-3-c-100-16-mm-x-2-2-mm-1886739508/",note:"100 м"},{id:"dm11_5",n:"Теплоизоляция для труб Energoflex Super Protect 18/4-11 (2 бухты по 11м)",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/teploizolyatsiya-dlya-trub-energoflex-super-protect-18-4-11-sinyaya-krasnaya-uteplitel-dlya-trub-3574400762/",note:""}]},
  {id:"dw12",n:"Монтаж стен из ОСП, ГСП и утеплителя",cost:8606,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm12_1",n:"ОСП 18 м²",cost:4260,store:"Белка",url:"",note:"6 листов"},{id:"dm12_2",n:"Звукоизоляция Knauf АкустиKnauf 50 мм 6 м²",cost:2162,store:"Лемана",url:"https://lemanapro.ru/product/zvukoizolyaciya-knauf-insulation-akustiknauf-50-mm-10-sht-610x1000-mm-6-m-18482159/",note:""},{id:"dm12_3",n:"Гипсоволокнистый лист ГВЛВ ПК 10 мм Knauf 600x1200 мм",cost:2184,store:"Лемана",url:"https://lemanapro.ru/product/gipsovoloknistyy-list-gvlv-pk-10-mm-knauf-superlist-600x1200-mm-18527409/",note:""}]},
  {id:"dw13",n:"Санузел — гидроизоляция стен и пола",cost:6500,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm13_1",n:"Гидроизоляция для ванны, кровли, бетона 24 кг",cost:6500,store:"Озон",url:"https://www.ozon.ru/product/gidroizolyatsiya-dlya-vanny-krovli-betona-24-kg-2223640495/",note:""}]},
  {id:"dw14",n:"Монтаж теплого пола с заливкой",cost:9300,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm14_1",n:"Теплый пол 9 м² электрический мат под плитку 150 вт",cost:5200,store:"Озон",url:"https://www.ozon.ru/product/teplyy-pol-9-m2-elektricheskiy-mat-pod-plitku-150-vt-s-mehanicheskim-regulyatorom-735920062/",note:""},{id:"dm14_2",n:"Грунтовка Кнауф Тифенгрунд F мороз 10 кг",cost:1400,store:"Лемана",url:"https://lemanapro.ru/product/gruntovka-glubokogo-proniknoveniya-knauf-tifengrund-f-moroz-10-kg-85060727/",note:""},{id:"dm14_3",n:"Наливной пол Волма Нивелир Экспресс 25 кг",cost:2700,store:"Лемана",url:"https://lemanapro.ru/product/nalivnoy-pol-volma-nivelir-ekspress-25-kg-87481463/",note:"6 мешков"}]},
  {id:"dw15",n:"Вентиляция — клапаны приточные + вытяжные вентиляторы",cost:3700,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm15_1",n:"Оконный приточный клапан NovaVent",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/okonnyy-pritochnyy-klapan-novavent-max-s-filtrom-dlya-ventilyatsii-provetrivatel-okonnyy-2-shtuki-1439055176/",note:""},{id:"dm15_2",n:"Вентилятор вытяжной 100мм с обратным клапаном",cost:2700,store:"Озон",url:"https://www.ozon.ru/product/ventilyator-vytyazhnoy-100mm-s-obratnym-klapanom-airtube-classic-matt-white-100-matovyy-belyy-3626278570/",note:"2 шт"}]},
  {id:"dw16",n:"Монтаж канализации",cost:0,stage:"ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА",note:"",mats:[]},
  {id:"dw17",n:"Фасад — покраска в 2 слоя",cost:4900,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm17_1",n:"Краска по металлу Elcon DIY грунт-эмаль 3 в 1 матовая графит RAL 7024 9 кг",cost:4900,store:"Озон",url:"https://www.ozon.ru/product/kraska-po-metallu-i-rzhavchine-elcon-diy-grunt-emal-3-v-1-bystrosohnushchaya-matovaya-grafit-3229869323/",note:""}]},
  {id:"dw18",n:"Монтаж окон и дверей пластиковых",cost:0,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[]},
  {id:"dw19",n:"Фасад — отделка оконных и дверных проёмов",cost:6600,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm19_1",n:"Планкен сосна АВ",cost:6600,store:"Белка",url:"",note:"600 кв м × 11р"},{id:"dm19_2",n:"Уголок 40 на 40",cost:2000,store:"Белка",url:"",note:"10 шт"}]},
  {id:"dw20",n:"Потолок весь — вагонка",cost:21000,unit:"м²",qty:15,unitCost:1400,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"15 кв",mats:[{id:"dm20_1",n:"Вагонка паркет Экстра липа",cost:21000,store:"Нижний Новгород",url:"",note:"15 кв по 1400р"}]},
  {id:"dw21",n:"Стены комнаты отдыха — вагонка",cost:28000,unit:"м²",qty:20,unitCost:1400,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"20 кв",mats:[{id:"dm21_1",n:"Вагонка паркет Экстра липа",cost:28000,store:"Нижний Новгород",url:"",note:"20 кв по 1400р"}]},
  {id:"dw22",n:"Монтаж розеток, выключателей и щитка",cost:7580,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm22_1",n:"Розетка Intro Plano 1-202-02",cost:1520,store:"Озон",url:"https://www.ozon.ru/product/rozetka-intro-plano-1-202-02-s-zazemleniem-2p-e-schuko-16a-250v-ip20-skrytoy-ustanovki-1607687840/",note:"10 шт"},{id:"dm22_2",n:"Выключатель трехклавишный слоновая кость",cost:340,store:"Озон",url:"https://www.ozon.ru/product/vyklyuchatel-trehklavishnyy-slonovaya-kost-10a-250v-b0053789-1-106-02-intro-plano-3441138006/",note:"2 шт"},{id:"dm22_3",n:"Выключатель Intro Plano двухклавишный",cost:380,store:"Озон",url:"https://www.ozon.ru/product/vyklyuchatel-intro-plano-1-105-02-dvuhklavishnyy-s-podsvetkoy-10a-250v-ip20-su-slonovaya-kost-1607686528/",note:"2 шт"},{id:"dm22_4",n:"Щиток",cost:490,store:"Озон",url:"https://www.ozon.ru/product/korpus-plastikovyy-navesnoy-dlya-avtomatov-intro-shchrn-p-12-258h198h95-ip41-prozrachnaya-3543755293/",note:""},{id:"dm22_5",n:"Дифференциальный автомат IEK АВДТ32 C25",cost:1000,store:"Озон",url:"https://www.ozon.ru/product/differentsialnyy-avtomat-difavtomat-iek-avdt32-c25-30ma-tip-a-1680116803/",note:""},{id:"dm22_6",n:"Автоматический выключатель 16А (12 шт)",cost:1700,store:"Озон",url:"https://www.ozon.ru/product/avtomaticheskiy-vyklyuchatel-16a-iek-1p-4-5ka-tip-s-12sht-362248733/",note:""},{id:"dm22_7",n:"Автоматический выключатель 10А (12 шт)",cost:2150,store:"Озон",url:"https://www.ozon.ru/product/avtomaticheskiy-vyklyuchatel-10a-iek-1p-4-5ka-tip-s-va47-29-12-sht-362471013/",note:""}]},
  {id:"dw23",n:"Стены душевой и туалета — плитка SPC",cost:25200,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm23_1",n:"SPC плитка Виго класс 43 толщина 4 мм 1.8 м²",cost:25200,store:"Лемана",url:"https://lemanapro.ru/product/spc-plitka-vigo-klass-43-tolshchina-4-mm-18-m-89396935/",note:"9 пачек на 16 кв"}]},
  {id:"dw24",n:"Стены парной — вагонка",cost:29400,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm24_1",n:"Вагонка паркет Экстра липа",cost:29400,store:"Нижний Новгород",url:"",note:"21 кв по 1400р"},{id:"dm24_2",n:"Фольга",cost:0,store:"",url:"",note:""},{id:"dm24_3",n:"Войлок",cost:0,store:"",url:"",note:""}]},
  {id:"dw25",n:"Пол комнаты отдыха и туалета — кварцвинил (влагостойкий)",cost:8430,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm25_1",n:"SPC плитка Дуб Марсель класс 42 толщина 3.5 мм 2.16 м²",cost:7980,store:"Лемана",url:"https://lemanapro.ru/product/spc-plitka-dub-marsel-klass-42-tolshchina-35-mm-216-m-89396933/",note:"7 пачек"},{id:"dm25_2",n:"Подложка под напольное покрытие MONLID 3 мм 6 м²",cost:450,store:"Лемана",url:"https://lemanapro.ru/product/podlozhka-xps-dlya-teplogo-pola-18-mm-6m-17985854/",note:""}]},
  {id:"dw26",n:"Пол душевой и парной — керамогранит",cost:10022,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm26_1",n:"Глазурованный керамогранит Шахтинская Плитка Гранде 40x40x0.8 см",cost:5022,store:"Лемана",url:"https://lemanapro.ru/product/glazurovannyy-keramogranit-shahtinskaya-plitka-grande-40x40x08-sm-16-m-matovyy-cvet-svetlo-bezhevyy-89132470/",note:"6 кв м"},{id:"dm26_2",n:"Клей для плитки Церезит CM 17 Super Flex 25 кг",cost:5000,store:"Лемана",url:"https://lemanapro.ru/product/kley-dlya-plitki-cerezit-cm-17-super-flex-vysokoelastichnyy-25-kg-82040398/",note:"2 пачки"}]},
  {id:"dw27",n:"Межкомнатные банные двери — комплект 3 шт",cost:23400,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm27_1",n:"Дверь стеклянная банная СБМ правая / бронза матовое / короб сосна 6×680×1900 мм",cost:23400,store:"Белка",url:"",note:"3 шт"}]},
  {id:"dw28",n:"Инженерный узел — бойлер 80 л + мембрана + фильтр",cost:20600,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm28_1",n:"Гидроаккумулятор EcWATER АвтоБак CAВ 24 РД (24 литра)",cost:6500,store:"Озон",url:"https://www.ozon.ru/product/gidroakkumulyator-v-sbore-s-avtomatikoy-ecwater-avtobak-cav-24-rd-24-litra-vertikalnyy-s-1292076714/",note:""},{id:"dm28_2",n:"Водонагреватель Oasis 80VZ, 80 л",cost:14100,store:"Озон",url:"https://www.ozon.ru/product/vodonagrevatel-nakopitelnyy-elektricheskiy-boyler-dlya-vody-belyy-oasis-80vz-80-l-2000-vt-702804620/",note:""}]},
  {id:"dw29",n:"Монтаж плинтусов, откосов, наличников, окна банного",cost:8142,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm29_1",n:"Оконный блок Липа банный / стеклопакет прозр. / фурн. цинк (400×400 мм)",cost:1800,store:"Белка",url:"",note:""},{id:"dm29_2",n:"Наличник деревянный осина А сращенный",cost:2142,store:"Белка",url:"",note:"14 шт"},{id:"dm29_3",n:"Плинтус 15×42 мм липа экстра",cost:4200,store:"Белка",url:"",note:"60 шт"}]},
  {id:"dw30",n:"Монтаж полков",cost:28060,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm30_1",n:"Полок Термо Липа Экстра 26×90 мм",cost:10320,store:"Белка",url:"",note:"2 м × 12 шт по 430р/пм"},{id:"dm30_2",n:"Полок Термо Липа Экстра 26×90 мм",cost:3840,store:"Белка",url:"",note:"1,5 м × 8 шт по 240р/пм"},{id:"dm30_3",n:"Полок Осина массив Экстра 28×92 мм",cost:8400,store:"Белка",url:"",note:"2 м × 21 шт по 200р/пм"},{id:"dm30_4",n:"Полок Осина массив АВ 28×92 мм",cost:5500,store:"Белка",url:"",note:"2 м × 25 шт по 110р/пм"}]},
  {id:"dw31",n:"Монтаж пано можжевеловое, светильники, подсветки",cost:18320,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm31_1",n:"Можжевельник",cost:9000,store:"Авито",url:"https://www.avito.ru/pushkino/remont_i_stroitelstvo/mozhzhevelnik_7764702142",note:"3 кв м × 3000р/кв"},{id:"dm31_2",n:"Доставка можжевельника",cost:2000,store:"",url:"",note:""},{id:"dm31_3",n:"Гималайская соль",cost:2200,store:"Южные ворота",url:"",note:"2 коробки по 1100р"},{id:"dm31_4",n:"Лента светодиодная для бани 12V IP65 Теплый белый",cost:2560,store:"Озон",url:"https://www.ozon.ru/product/lenta-svetodiodnaya-dlya-bani-i-sauny-termostoykaya-12v-ip65-teplyy-belyy-2308956283/",note:"2 шт по 5 м"},{id:"dm31_5",n:"Блок питания 12V 200W импульсный",cost:1060,store:"Озон",url:"https://www.ozon.ru/product/blok-pitaniya-12v-200w-180-265-impulsnyy-dlya-svetodiodnyh-lent-i-svetilnikov-1623735974/",note:"2 шт"},{id:"dm31_6",n:"Светодиодная лента 10м COB 320LED 12V 10W/м 3000K 8мм",cost:1500,store:"Озон",url:"https://www.ozon.ru/product/svetodiodnaya-lenta-10m-cob-320-led-12v-10w-m-teplyy-belyy-3000k-8mm-2649025420/",note:""}]},
  {id:"dw32",n:"Монтаж печи и дымохода",cost:62777,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm32_1",n:"Печь для бани ASTON 24 (310M) Лонг",cost:36000,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/pech-dlya-bani-aston-24-310m-long/",note:""},{id:"dm32_2",n:"Сетка для камней ASTON",cost:3290,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/pechi-dlya-ban-i-saun/setki-dlya-kamney/setka-dlya-kamney-aston/",note:""},{id:"dm32_3",n:"Труба нерж. (AISI 430) L-1м d130",cost:1234,store:"pechki.su",url:"https://pechki.su/dymohody/truba-nerzh-aisi-43008mm-d130-l-1m/",note:""},{id:"dm32_4",n:"Шибер поворотный Сталь 1,0мм 115мм",cost:776,store:"pechki.su",url:"https://pechki.su/dymohody/shiber-lava-povorotnyy-stal-1mm/",note:""},{id:"dm32_5",n:"Переход на сэндвич нерж. (AISI 430) 115-180 мм",cost:1180,store:"pechki.su",url:"https://pechki.su/dymohody/perekhod-na-sendvich-nerzh-aisi-43008mm/",note:""},{id:"dm32_6",n:"Сэндвич-труба Оц+Нерж (AISI 430) L-1м 115-180",cost:5110,store:"pechki.su",url:"https://pechki.su/dymohody/ocinkovannye-dymohody-vezuviy/sendvich-truba-ocznerzh-aisi-43005mm-l-1m/",note:"2 шт"},{id:"dm32_7",n:"Хомут под растяжку (AISI 430) 115",cost:260,store:"pechki.su",url:"https://pechki.su/dymohody/homut-pod-rastyazhku-aisi-430-0-5mm/",note:""},{id:"dm32_8",n:"Хомут под растяжку (AISI 430) 180",cost:918,store:"pechki.su",url:"https://pechki.su/dymohody/homut-pod-rastyazhku-aisi-430-0-5mm/",note:"3 шт"},{id:"dm32_9",n:"Дефлектор Оц 115-180мм",cost:1836,store:"pechki.su",url:"https://pechki.su/dymohody/deflektor-ocz-aisi-43005mm/",note:""},{id:"dm32_10",n:"Герметик термостойкий ВЕЗУВИЙ 1500°С 290мл",cost:593,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/germetik-termostoykiy-vezuviy-1500s-chernyy-290-ml/",note:""},{id:"dm32_11",n:"Базальтовая вата (3кг)",cost:910,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/bazaltovye-materialy/bazaltovaya-vata-3kg/",note:""},{id:"dm32_12",n:"Базальтовый картон 1000х600х6мм (3шт/уп)",cost:780,store:"pechki.su",url:"https://pechki.su/termoizolyaciya/bazaltovye-materialy/bazaltovyj-karton-1000kh600kh6mm-3shtup/",note:""},{id:"dm32_13",n:"ППУ нерж. (AISI 430) 185",cost:1970,store:"pechki.su",url:"https://pechki.su/dymohody/nerzhaveyuschie-dymohody-vezuviy/ppu-nerzh-aisi-43005mm/",note:""},{id:"dm32_14",n:"Кровельный проходник ВЕЗУВИЙ №4 (890х890мм) угл, силикон",cost:3330,store:"pechki.su",url:"https://pechki.su/dymohody/master-flesh/master-flesh-vezuviy-4-d-300-450mm-890h890mm-ugl-silikon/",note:""},{id:"dm32_15",n:"Камень Габбро-диабаз (мешок 20кг)",cost:2375,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/kamni-dlya-pechey/kamen-gabro-diabaz-meshok-20-kg/",note:"5 мешков"},{id:"dm32_16",n:"Камень Малиновый кварцит колотый (коробка 20кг)",cost:815,store:"pechki.su",url:"https://pechki.su/vse-dlya-bani-i-sauny/kamni-dlya-pechey/kamen-malinovyj-kvarczit-kolotyj-korobka-20kg/",note:"1 мешок"},{id:"dm32_17",n:"Герметизирующая лента NICOBAND Технониколь 10м",cost:1400,store:"Озон",url:"https://www.ozon.ru/product/germetiziruyushchaya-lenta-10m-15sm-serebristaya-samokleyashchayasya-nicoband-tehnonikol-1071209469/",note:""},{id:"dm32_18",n:"Мастика термовлагостойкая клеящая NEOMID 4 кг",cost:1050,store:"Озон",url:"https://www.ozon.ru/product/mastika-termovlagostoykaya-kleyashchaya-neomid-universalnaya-4-kg-kley-dlya-plitki-964540731/",note:""},{id:"dm32_19",n:"Плитка Керамин Студио 60x30 см матовая коричневый дерево",cost:3000,store:"Лемана",url:"https://lemanapro.ru/product/plitka-nastennaya-keramin-studio-60x30-sm-198-m-matovaya-cvet-korichnevyy-derevo-88923926/",note:"4 кв"}]},
  {id:"dw33",n:"Монтаж унитаза",cost:5700,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[{id:"dm33_1",n:"Унитаз компакт Sanita Master косой выпуск",cost:5700,store:"Лемана",url:"https://lemanapro.ru/product/unitaz-kompakt-sanita-master-kosoy-vypusk-dvoynoy-sliv-82624807/",note:""}]},
  {id:"dw34",n:"Кондиционер",cost:35000,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[]},
  {id:"dw35",n:"Покрытие полков маслом",cost:20000,stage:"ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА",note:"",mats:[]},
];
let dbSection="works";
let dbMatSearch=""; // поиск по материалам в Базе данных (название или магазин)
let matPackView={}; // {matId: "m2"|"pack"} — режим отображения цены для материалов, продаваемых упаковками
// === ДЕМО «Эксперимент»: список товаров (не сохраняется) ===
const EXP_MODES=[
  {k:"piece",icon:"🔢",label:"Штуки",unit:"шт"},
  {k:"pack", icon:"📦",label:"Пачка",unit:"пачка"},
  {k:"mp",   icon:"📏",label:"Метр пог.",unit:"м.п."},
  {k:"m2",   icon:"▦", label:"Кв. метр",unit:"м²"},
  {k:"sheet",icon:"📄",label:"Лист",unit:"лист"}
];
const EXP_BASE_UNITS=["м²","шт","м.п.","м³","кг"];
let expView={}; // {productId: "sale"|"base"} — режим цены для упаковочных товаров в списке
let expSearch=""; // поиск по списку эксперимента
let expOpenId=null; // id товара, открытого в редакторе (null = список)
let expContainer="dbexp-card"; // контейнер, в который рендерится список/редактор (Материалы или Эксперимент)
// ── СМЕТЫ: собираются из материалов каталога (expProducts) ──
const EST_STAGES=[
  {n:1, label:"Подготовительный", short:"Этап 1", color:"#e67e22"},
  {n:2, label:"Черновые работы",  short:"Этап 2", color:"#2980b9"},
  {n:3, label:"Чистовые работы",  short:"Этап 3", color:"#16a085"}
];
let estOpenId=null;       // открытая смета (null = список)
let estSearch="";         // поиск по сметам (по названию работы)
let estKind="banya";      // активный вид смет: banya | house
let estPicking=false;     // открыт ли выбор материала для добавления
let estPickSearch="";     // поиск в выборе материала
let estimates=[];         // заполняется ниже из работ базы (после expProducts)
const __MMAP={
  "Подвесы крепежные прямые 27x270x0,5":{mode:"piece", uc:6, qty:100},
  "Tytan Professional Клей 2 фикс":{mode:"piece", uc:970, qty:1},
  "Труба профильная 40x40x2мм 3 м":{mode:"mp", uc:193, qty:6, lenPer:3.0},
  "ЭППС":{mode:"m2", uc:350, qty:1},
  "Клей-пена POLYNOR 60 СЕКУНД":{mode:"piece", uc:550, qty:6},
  "ОСП 30 м²":{mode:"sheet", uc:710, qty:21, packBase:"м²", packPer:3.12},
  "Рейка строганная 20 на 40":{mode:"piece", uc:80, qty:60},
  "Брусок строганный 50 на 50":{mode:"piece", uc:229, qty:15},
  "Кабель ВВГ Пнг (А) LS 3х2,5 мм2 100М":{mode:"piece", uc:7800, qty:1},
  "Кабель ВВГ Пнг (А) LS 3х1,5 мм2 100М":{mode:"piece", uc:5100, qty:1},
  "Коробка установочная в гипсокартон 68х45 мм (10 шт)":{mode:"piece", uc:500, qty:1},
  "Кабель ВВГ Пнг (А) Ls 3x4, 15 метров":{mode:"piece", uc:2310, qty:1},
  "Тройник Ростерм 16 мм латунь":{mode:"piece", uc:262, qty:5},
  "Водорозетка Ростерм 1/2\"x16 мм ВР латунь":{mode:"piece", uc:371, qty:5},
  "Монтажная гильза Ростерм 16x2.2 мм PVDF":{mode:"piece", uc:73, qty:30},
  "Труба из сшитого полиэтилена 100 м Valtec PEXA-EVOH 16 мм x 2,2 мм":{mode:"mp", uc:89, qty:100},
  "Теплоизоляция для труб Energoflex Super Protect 18/4-11 (2 бухты по 11м)":{mode:"piece", uc:1000, qty:1},
  "ОСП 18 м²":{mode:"sheet", uc:710, qty:6},
  "Звукоизоляция Knauf АкустиKnauf 50 мм 6 м²":{mode:"piece", uc:2162, qty:1},
  "Гипсоволокнистый лист ГВЛВ ПК 10 мм Knauf 600x1200 мм":{mode:"piece", uc:2184, qty:1},
  "Гидроизоляция для ванны, кровли, бетона 24 кг":{mode:"piece", uc:6500, qty:1},
  "Теплый пол 9 м² электрический мат под плитку 150 вт":{mode:"piece", uc:5200, qty:1},
  "Грунтовка Кнауф Тифенгрунд F мороз 10 кг":{mode:"piece", uc:1400, qty:1},
  "Наливной пол Волма Нивелир Экспресс 25 кг":{mode:"piece", uc:450, qty:6},
  "Оконный приточный клапан NovaVent":{mode:"piece", uc:1000, qty:1},
  "Вентилятор вытяжной 100мм с обратным клапаном":{mode:"piece", uc:1350, qty:2},
  "Краска по металлу Elcon DIY грунт-эмаль 3 в 1 матовая графит RAL 7024 9 кг":{mode:"piece", uc:4900, qty:1},
  "Планкен сосна АВ":{mode:"m2", uc:11, qty:600},
  "Уголок 40 на 40":{mode:"piece", uc:200, qty:10},
  "Вагонка паркет Экстра липа":{mode:"m2", uc:1400, qty:15},
  "Розетка Intro Plano 1-202-02":{mode:"piece", uc:152, qty:10},
  "Выключатель трехклавишный слоновая кость":{mode:"piece", uc:170, qty:2},
  "Выключатель Intro Plano двухклавишный":{mode:"piece", uc:190, qty:2},
  "Щиток":{mode:"piece", uc:490, qty:1},
  "Дифференциальный автомат IEK АВДТ32 C25":{mode:"piece", uc:1000, qty:1},
  "Автоматический выключатель 16А (12 шт)":{mode:"piece", uc:1700, qty:1},
  "Автоматический выключатель 10А (12 шт)":{mode:"piece", uc:2150, qty:1},
  "SPC плитка Виго класс 43 толщина 4 мм 1.8 м²":{mode:"pack", uc:2800, qty:9, packBase:"м²", packPer:1.78},
  "Фольга":{mode:"piece", uc:0, qty:1},
  "Войлок":{mode:"piece", uc:0, qty:1},
  "SPC плитка Дуб Марсель класс 42 толщина 3.5 мм 2.16 м²":{mode:"pack", uc:1140, qty:7},
  "Подложка под напольное покрытие MONLID 3 мм 6 м²":{mode:"piece", uc:450, qty:1},
  "Глазурованный керамогранит Шахтинская Плитка Гранде 40x40x0.8 см":{mode:"m2", uc:837, qty:6},
  "Клей для плитки Церезит CM 17 Super Flex 25 кг":{mode:"pack", uc:2500, qty:2},
  "Дверь стеклянная банная СБМ правая / бронза матовое / короб сосна 6×680×1900 мм":{mode:"piece", uc:7800, qty:3},
  "Гидроаккумулятор EcWATER АвтоБак CAВ 24 РД (24 литра)":{mode:"piece", uc:6500, qty:1},
  "Водонагреватель Oasis 80VZ, 80 л":{mode:"piece", uc:14100, qty:1},
  "Оконный блок Липа банный / стеклопакет прозр. / фурн. цинк (400×400 мм)":{mode:"piece", uc:1800, qty:1},
  "Наличник деревянный осина А сращенный":{mode:"piece", uc:153, qty:14},
  "Плинтус 15×42 мм липа экстра":{mode:"piece", uc:70, qty:60},
  "Полок Термо Липа Экстра 26×90 мм":{mode:"mp", uc:430, qty:12, lenPer:2.0},
  "Полок Осина массив Экстра 28×92 мм":{mode:"mp", uc:200, qty:21, lenPer:2.0},
  "Полок Осина массив АВ 28×92 мм":{mode:"mp", uc:110, qty:25, lenPer:2.0},
  "Можжевельник":{mode:"m2", uc:3000, qty:3},
  "Гималайская соль":{mode:"piece", uc:1100, qty:2},
  "Лента светодиодная для бани 12V IP65 Теплый белый":{mode:"mp", uc:256, qty:2, lenPer:5.0},
  "Блок питания 12V 200W импульсный":{mode:"piece", uc:530, qty:2},
  "Светодиодная лента 10м COB 320LED 12V 10W/м 3000K 8мм":{mode:"piece", uc:1500, qty:1},
  "Печь для бани ASTON 24 (310M) Лонг":{mode:"piece", uc:36000, qty:1},
  "Сетка для камней ASTON":{mode:"piece", uc:3290, qty:1},
  "Труба нерж. (AISI 430) L-1м d130":{mode:"piece", uc:1234, qty:1},
  "Шибер поворотный Сталь 1,0мм 115мм":{mode:"piece", uc:776, qty:1},
  "Переход на сэндвич нерж. (AISI 430) 115-180 мм":{mode:"piece", uc:1180, qty:1},
  "Сэндвич-труба Оц+Нерж (AISI 430) L-1м 115-180":{mode:"piece", uc:2555, qty:2},
  "Хомут под растяжку (AISI 430) 115":{mode:"piece", uc:260, qty:1},
  "Хомут под растяжку (AISI 430) 180":{mode:"piece", uc:306, qty:3},
  "Дефлектор Оц 115-180мм":{mode:"piece", uc:1836, qty:1},
  "Герметик термостойкий ВЕЗУВИЙ 1500°С 290мл":{mode:"piece", uc:593, qty:1},
  "Базальтовая вата (3кг)":{mode:"piece", uc:910, qty:1},
  "Базальтовый картон 1000х600х6мм (3шт/уп)":{mode:"piece", uc:780, qty:1},
  "ППУ нерж. (AISI 430) 185":{mode:"piece", uc:1970, qty:1},
  "Кровельный проходник ВЕЗУВИЙ №4 (890х890мм) угл, силикон":{mode:"piece", uc:3330, qty:1},
  "Камень Габбро-диабаз (мешок 20кг)":{mode:"piece", uc:475, qty:5},
  "Камень Малиновый кварцит колотый (коробка 20кг)":{mode:"piece", uc:815, qty:1},
  "Герметизирующая лента NICOBAND Технониколь 10м":{mode:"piece", uc:1400, qty:1},
  "Мастика термовлагостойкая клеящая NEOMID 4 кг":{mode:"piece", uc:1050, qty:1},
  "Плитка Керамин Студио 60x30 см матовая коричневый дерево":{mode:"m2", uc:750, qty:4},
  "Унитаз компакт Sanita Master косой выпуск":{mode:"piece", uc:5700, qty:1}
};
// Нормализация материалов базы: цена за единицу как основная, режим продажи из авторазбора сметы.
(function(){try{dbWorks.forEach(function(w){(w.mats||[]).forEach(function(m){
  if(isDeliveryMat(m))return; var k=__MMAP[m.n]; if(!k)return;
  var orig=Number(m.cost)||0;
  m.mode=k.mode; m.unitCost=k.uc; m.cost=k.uc;
  m.qty=(k.uc>0?Math.round(orig/k.uc):(k.qty||1));
  if(k.packBase!=null)m.packBase=k.packBase; if(k.packPer!=null)m.packPer=k.packPer;
  if(k.lenPer!=null)m.lenPer=k.lenPer; if(k.sheetM2!=null)m.sheetM2=k.sheetM2;
});});}catch(e){console.warn('mat normalize',e);}})();
let expProducts=[
  // ── Все материалы проекта из базы (с ссылками). Режим продажи определён по примечанию ──
  {id:"db_dm3_1", emoji:"🔩", name:"Подвесы крепежные прямые 27x270x0,5", store:"Озон", url:"https://www.ozon.ru/product/podvesy-krepezhnye-pryamye-27x270x0-5-mm-dlya-profilya-100-sht-3735563806/", mode:"piece", unitCost:6, qty:100},
  {id:"db_dm3_2", emoji:"🧴", name:"Tytan Professional Клей 2 фикс", store:"Озон", url:"https://www.ozon.ru/product/tytan-professional-kley-stroitelnyy-290-ml-1-sht-215536620/", mode:"piece", unitCost:970, qty:1},
  {id:"db_dm4_1", emoji:"▭", name:"Труба профильная 40x40x2мм 3 м", store:"Лемана", url:"https://lemanapro.ru/product/truba-profilnaya-40x40x2mm-3-m-13376760/", mode:"mp", unitCost:193, qty:6, lenPer:3.0},
  {id:"db_dm5_1", emoji:"🟦", name:"ЭППС", store:"Егорьевск", url:"", mode:"m2", unitCost:350, qty:1},
  {id:"db_dm5_2", emoji:"🧴", name:"Клей-пена POLYNOR 60 СЕКУНД", store:"Озон", url:"https://www.ozon.ru/product/kley-pena-polynor-60-sekund-box-polinor-60-sekund-universalnaya-komplekt-12-sht-948411658/", mode:"piece", unitCost:550, qty:6},
  {id:"db_dm6_1", emoji:"🟫", name:"ОСП 30 м²", store:"Белка", url:"", mode:"sheet", unitCost:710, qty:21, packBase:"м²", packPer:3.12},
  {id:"db_dm8_1", emoji:"🪵", name:"Рейка строганная 20 на 40", store:"Белка", url:"", mode:"piece", unitCost:80, qty:60},
  {id:"db_dm9_1", emoji:"🪵", name:"Брусок строганный 50 на 50", store:"Белка", url:"", mode:"piece", unitCost:229, qty:15},
  {id:"db_dm10_1", emoji:"🔌", name:"Кабель ВВГ Пнг (А) LS 3х2,5 мм2 100М", store:"Озон", url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3h2-5-mm2-100m-1605500925/", mode:"piece", unitCost:7800, qty:1},
  {id:"db_dm10_2", emoji:"🔌", name:"Кабель ВВГ Пнг (А) LS 3х1,5 мм2 100М", store:"Озон", url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3h1-5-mm2-100m-1606304346/", mode:"piece", unitCost:5100, qty:1},
  {id:"db_dm10_3", emoji:"⬜", name:"Коробка установочная в гипсокартон 68х45 мм (10 шт)", store:"Озон", url:"https://www.ozon.ru/product/korobka-ustanovochnaya-v-gipsokarton-siniy-68h45-mm-10-sht-3168901039/", mode:"piece", unitCost:500, qty:1},
  {id:"db_dm10_4", emoji:"🔌", name:"Кабель ВВГ Пнг (А) Ls 3x4, 15 метров", store:"Озон", url:"https://www.ozon.ru/product/kabel-vvg-png-a-ls-3x4-15-metrov-1667556252/", mode:"piece", unitCost:2310, qty:1},
  {id:"db_dm11_1", emoji:"🔩", name:"Тройник Ростерм 16 мм латунь", store:"Лемана", url:"https://lemanapro.ru/product/troynik-rosterm-16-mm-latun-88700669/", mode:"piece", unitCost:262, qty:5},
  {id:"db_dm11_2", emoji:"🔌", name:"Водорозетка Ростерм 1/2\"x16 мм ВР латунь", store:"Лемана", url:"https://lemanapro.ru/product/vodorozetka-rosterm-1-2x16-mm-vr-latun-82262639/", mode:"piece", unitCost:371, qty:5},
  {id:"db_dm11_3", emoji:"🔩", name:"Монтажная гильза Ростерм 16x2.2 мм PVDF", store:"Лемана", url:"https://lemanapro.ru/product/montazhnaya-gilza-rosterm-16x22-mm-pvdf-82132721/", mode:"piece", unitCost:73, qty:30},
  {id:"db_dm11_4", emoji:"▭", name:"Труба из сшитого полиэтилена 100 м Valtec PEXA-EVOH 16 мм x 2,2 мм", store:"Озон", url:"https://www.ozon.ru/product/truba-iz-sshitogo-polietilena-100-m-valtec-pexa-evoh-va1622-3-c-100-16-mm-x-2-2-mm-1886739508/", mode:"mp", unitCost:89, qty:100},
  {id:"db_dm11_5", emoji:"🟨", name:"Теплоизоляция для труб Energoflex Super Protect 18/4-11 (2 бухты по 11м)", store:"Озон", url:"https://www.ozon.ru/product/teploizolyatsiya-dlya-trub-energoflex-super-protect-18-4-11-sinyaya-krasnaya-uteplitel-dlya-trub-3574400762/", mode:"piece", unitCost:1000, qty:1},
  {id:"db_dm12_1", emoji:"🟫", name:"ОСП 18 м²", store:"Белка", url:"", mode:"sheet", unitCost:710, qty:6},
  {id:"db_dm12_2", emoji:"🟨", name:"Звукоизоляция Knauf АкустиKnauf 50 мм 6 м²", store:"Лемана", url:"https://lemanapro.ru/product/zvukoizolyaciya-knauf-insulation-akustiknauf-50-mm-10-sht-610x1000-mm-6-m-18482159/", mode:"piece", unitCost:2162, qty:1},
  {id:"db_dm12_3", emoji:"🟫", name:"Гипсоволокнистый лист ГВЛВ ПК 10 мм Knauf 600x1200 мм", store:"Лемана", url:"https://lemanapro.ru/product/gipsovoloknistyy-list-gvlv-pk-10-mm-knauf-superlist-600x1200-mm-18527409/", mode:"piece", unitCost:2184, qty:1},
  {id:"db_dm13_1", emoji:"💧", name:"Гидроизоляция для ванны, кровли, бетона 24 кг", store:"Озон", url:"https://www.ozon.ru/product/gidroizolyatsiya-dlya-vanny-krovli-betona-24-kg-2223640495/", mode:"piece", unitCost:6500, qty:1},
  {id:"db_dm14_1", emoji:"◼️", name:"Теплый пол 9 м² электрический мат под плитку 150 вт", store:"Озон", url:"https://www.ozon.ru/product/teplyy-pol-9-m2-elektricheskiy-mat-pod-plitku-150-vt-s-mehanicheskim-regulyatorom-735920062/", mode:"piece", unitCost:5200, qty:1},
  {id:"db_dm14_2", emoji:"🧴", name:"Грунтовка Кнауф Тифенгрунд F мороз 10 кг", store:"Лемана", url:"https://lemanapro.ru/product/gruntovka-glubokogo-proniknoveniya-knauf-tifengrund-f-moroz-10-kg-85060727/", mode:"piece", unitCost:1400, qty:1},
  {id:"db_dm14_3", emoji:"🪣", name:"Наливной пол Волма Нивелир Экспресс 25 кг", store:"Лемана", url:"https://lemanapro.ru/product/nalivnoy-pol-volma-nivelir-ekspress-25-kg-87481463/", mode:"piece", unitCost:450, qty:6},
  {id:"db_dm15_1", emoji:"🪟", name:"Оконный приточный клапан NovaVent", store:"Озон", url:"https://www.ozon.ru/product/okonnyy-pritochnyy-klapan-novavent-max-s-filtrom-dlya-ventilyatsii-provetrivatel-okonnyy-2-shtuki-1439055176/", mode:"piece", unitCost:1000, qty:1},
  {id:"db_dm15_2", emoji:"🌀", name:"Вентилятор вытяжной 100мм с обратным клапаном", store:"Озон", url:"https://www.ozon.ru/product/ventilyator-vytyazhnoy-100mm-s-obratnym-klapanom-airtube-classic-matt-white-100-matovyy-belyy-3626278570/", mode:"piece", unitCost:1350, qty:2},
  {id:"db_dm17_1", emoji:"🧴", name:"Краска по металлу Elcon DIY грунт-эмаль 3 в 1 матовая графит RAL 7024 9 кг", store:"Озон", url:"https://www.ozon.ru/product/kraska-po-metallu-i-rzhavchine-elcon-diy-grunt-emal-3-v-1-bystrosohnushchaya-matovaya-grafit-3229869323/", mode:"piece", unitCost:4900, qty:1},
  {id:"db_dm19_1", emoji:"🪵", name:"Планкен сосна АВ", store:"Белка", url:"", mode:"m2", unitCost:11, qty:600},
  {id:"db_dm19_2", emoji:"📐", name:"Уголок 40 на 40", store:"Белка", url:"", mode:"piece", unitCost:200, qty:10},
  {id:"db_dm20_1", emoji:"🪵", name:"Вагонка паркет Экстра липа", store:"Нижний Новгород", url:"", mode:"m2", unitCost:1400, qty:15},
  {id:"db_dm22_1", emoji:"🔌", name:"Розетка Intro Plano 1-202-02", store:"Озон", url:"https://www.ozon.ru/product/rozetka-intro-plano-1-202-02-s-zazemleniem-2p-e-schuko-16a-250v-ip20-skrytoy-ustanovki-1607687840/", mode:"piece", unitCost:152, qty:10},
  {id:"db_dm22_2", emoji:"🔌", name:"Выключатель трехклавишный слоновая кость", store:"Озон", url:"https://www.ozon.ru/product/vyklyuchatel-trehklavishnyy-slonovaya-kost-10a-250v-b0053789-1-106-02-intro-plano-3441138006/", mode:"piece", unitCost:170, qty:2},
  {id:"db_dm22_3", emoji:"🔌", name:"Выключатель Intro Plano двухклавишный", store:"Озон", url:"https://www.ozon.ru/product/vyklyuchatel-intro-plano-1-105-02-dvuhklavishnyy-s-podsvetkoy-10a-250v-ip20-su-slonovaya-kost-1607686528/", mode:"piece", unitCost:190, qty:2},
  {id:"db_dm22_4", emoji:"⚡", name:"Щиток", store:"Озон", url:"https://www.ozon.ru/product/korpus-plastikovyy-navesnoy-dlya-avtomatov-intro-shchrn-p-12-258h198h95-ip41-prozrachnaya-3543755293/", mode:"piece", unitCost:490, qty:1},
  {id:"db_dm22_5", emoji:"⚡", name:"Дифференциальный автомат IEK АВДТ32 C25", store:"Озон", url:"https://www.ozon.ru/product/differentsialnyy-avtomat-difavtomat-iek-avdt32-c25-30ma-tip-a-1680116803/", mode:"piece", unitCost:1000, qty:1},
  {id:"db_dm22_6", emoji:"🔌", name:"Автоматический выключатель 16А (12 шт)", store:"Озон", url:"https://www.ozon.ru/product/avtomaticheskiy-vyklyuchatel-16a-iek-1p-4-5ka-tip-s-12sht-362248733/", mode:"piece", unitCost:1700, qty:1},
  {id:"db_dm22_7", emoji:"🔌", name:"Автоматический выключатель 10А (12 шт)", store:"Озон", url:"https://www.ozon.ru/product/avtomaticheskiy-vyklyuchatel-10a-iek-1p-4-5ka-tip-s-va47-29-12-sht-362471013/", mode:"piece", unitCost:2150, qty:1},
  {id:"db_dm23_1", emoji:"◼️", name:"SPC плитка Виго класс 43 толщина 4 мм 1.8 м²", store:"Лемана", url:"https://lemanapro.ru/product/spc-plitka-vigo-klass-43-tolshchina-4-mm-18-m-89396935/", mode:"pack", unitCost:2800, qty:9, packBase:"м²", packPer:1.78},
  {id:"db_dm24_2", emoji:"🟨", name:"Фольга", store:"", url:"", mode:"piece", unitCost:0, qty:1},
  {id:"db_dm24_3", emoji:"🟨", name:"Войлок", store:"", url:"", mode:"piece", unitCost:0, qty:1},
  {id:"db_dm25_1", emoji:"◼️", name:"SPC плитка Дуб Марсель класс 42 толщина 3.5 мм 2.16 м²", store:"Лемана", url:"https://lemanapro.ru/product/spc-plitka-dub-marsel-klass-42-tolshchina-35-mm-216-m-89396933/", mode:"pack", unitCost:1140, qty:7},
  {id:"db_dm25_2", emoji:"🟫", name:"Подложка под напольное покрытие MONLID 3 мм 6 м²", store:"Лемана", url:"https://lemanapro.ru/product/podlozhka-xps-dlya-teplogo-pola-18-mm-6m-17985854/", mode:"piece", unitCost:450, qty:1},
  {id:"db_dm26_1", emoji:"◼️", name:"Глазурованный керамогранит Шахтинская Плитка Гранде 40x40x0.8 см", store:"Лемана", url:"https://lemanapro.ru/product/glazurovannyy-keramogranit-shahtinskaya-plitka-grande-40x40x08-sm-16-m-matovyy-cvet-svetlo-bezhevyy-89132470/", mode:"m2", unitCost:837, qty:6},
  {id:"db_dm26_2", emoji:"◼️", name:"Клей для плитки Церезит CM 17 Super Flex 25 кг", store:"Лемана", url:"https://lemanapro.ru/product/kley-dlya-plitki-cerezit-cm-17-super-flex-vysokoelastichnyy-25-kg-82040398/", mode:"pack", unitCost:2500, qty:2},
  {id:"db_dm27_1", emoji:"🚪", name:"Дверь стеклянная банная СБМ правая / бронза матовое / короб сосна 6×680×1900 мм", store:"Белка", url:"", mode:"piece", unitCost:7800, qty:3},
  {id:"db_dm28_1", emoji:"🚿", name:"Гидроаккумулятор EcWATER АвтоБак CAВ 24 РД (24 литра)", store:"Озон", url:"https://www.ozon.ru/product/gidroakkumulyator-v-sbore-s-avtomatikoy-ecwater-avtobak-cav-24-rd-24-litra-vertikalnyy-s-1292076714/", mode:"piece", unitCost:6500, qty:1},
  {id:"db_dm28_2", emoji:"🚿", name:"Водонагреватель Oasis 80VZ, 80 л", store:"Озон", url:"https://www.ozon.ru/product/vodonagrevatel-nakopitelnyy-elektricheskiy-boyler-dlya-vody-belyy-oasis-80vz-80-l-2000-vt-702804620/", mode:"piece", unitCost:14100, qty:1},
  {id:"db_dm29_1", emoji:"🪟", name:"Оконный блок Липа банный / стеклопакет прозр. / фурн. цинк (400×400 мм)", store:"Белка", url:"", mode:"piece", unitCost:1800, qty:1},
  {id:"db_dm29_2", emoji:"🪵", name:"Наличник деревянный осина А сращенный", store:"Белка", url:"", mode:"piece", unitCost:153, qty:14},
  {id:"db_dm29_3", emoji:"🪵", name:"Плинтус 15×42 мм липа экстра", store:"Белка", url:"", mode:"piece", unitCost:70, qty:60},
  {id:"db_dm30_1", emoji:"🪵", name:"Полок Термо Липа Экстра 26×90 мм", store:"Белка", url:"", mode:"mp", unitCost:430, qty:12, lenPer:2.0},
  {id:"db_dm30_3", emoji:"🪵", name:"Полок Осина массив Экстра 28×92 мм", store:"Белка", url:"", mode:"mp", unitCost:200, qty:21, lenPer:2.0},
  {id:"db_dm30_4", emoji:"🪵", name:"Полок Осина массив АВ 28×92 мм", store:"Белка", url:"", mode:"mp", unitCost:110, qty:25, lenPer:2.0},
  {id:"db_dm31_1", emoji:"🌿", name:"Можжевельник", store:"Авито", url:"https://www.avito.ru/pushkino/remont_i_stroitelstvo/mozhzhevelnik_7764702142", mode:"m2", unitCost:3000, qty:3},
  {id:"db_dm31_3", emoji:"🧂", name:"Гималайская соль", store:"Южные ворота", url:"", mode:"piece", unitCost:1100, qty:2},
  {id:"db_dm31_4", emoji:"💡", name:"Лента светодиодная для бани 12V IP65 Теплый белый", store:"Озон", url:"https://www.ozon.ru/product/lenta-svetodiodnaya-dlya-bani-i-sauny-termostoykaya-12v-ip65-teplyy-belyy-2308956283/", mode:"mp", unitCost:256, qty:2, lenPer:5.0},
  {id:"db_dm31_5", emoji:"💡", name:"Блок питания 12V 200W импульсный", store:"Озон", url:"https://www.ozon.ru/product/blok-pitaniya-12v-200w-180-265-impulsnyy-dlya-svetodiodnyh-lent-i-svetilnikov-1623735974/", mode:"piece", unitCost:530, qty:2},
  {id:"db_dm31_6", emoji:"💡", name:"Светодиодная лента 10м COB 320LED 12V 10W/м 3000K 8мм", store:"Озон", url:"https://www.ozon.ru/product/svetodiodnaya-lenta-10m-cob-320-led-12v-10w-m-teplyy-belyy-3000k-8mm-2649025420/", mode:"piece", unitCost:1500, qty:1},
  {id:"db_dm32_1", emoji:"🔥", name:"Печь для бани ASTON 24 (310M) Лонг", store:"pechki.su", url:"https://pechki.su/vse-dlya-bani-i-sauny/pech-dlya-bani-aston-24-310m-long/", mode:"piece", unitCost:36000, qty:1},
  {id:"db_dm32_2", emoji:"🔥", name:"Сетка для камней ASTON", store:"pechki.su", url:"https://pechki.su/vse-dlya-bani-i-sauny/pechi-dlya-ban-i-saun/setki-dlya-kamney/setka-dlya-kamney-aston/", mode:"piece", unitCost:3290, qty:1},
  {id:"db_dm32_3", emoji:"▭", name:"Труба нерж. (AISI 430) L-1м d130", store:"pechki.su", url:"https://pechki.su/dymohody/truba-nerzh-aisi-43008mm-d130-l-1m/", mode:"piece", unitCost:1234, qty:1},
  {id:"db_dm32_4", emoji:"🔥", name:"Шибер поворотный Сталь 1,0мм 115мм", store:"pechki.su", url:"https://pechki.su/dymohody/shiber-lava-povorotnyy-stal-1mm/", mode:"piece", unitCost:776, qty:1},
  {id:"db_dm32_5", emoji:"🔥", name:"Переход на сэндвич нерж. (AISI 430) 115-180 мм", store:"pechki.su", url:"https://pechki.su/dymohody/perekhod-na-sendvich-nerzh-aisi-43008mm/", mode:"piece", unitCost:1180, qty:1},
  {id:"db_dm32_6", emoji:"▭", name:"Сэндвич-труба Оц+Нерж (AISI 430) L-1м 115-180", store:"pechki.su", url:"https://pechki.su/dymohody/ocinkovannye-dymohody-vezuviy/sendvich-truba-ocznerzh-aisi-43005mm-l-1m/", mode:"piece", unitCost:2555, qty:2},
  {id:"db_dm32_7", emoji:"📦", name:"Хомут под растяжку (AISI 430) 115", store:"pechki.su", url:"https://pechki.su/dymohody/homut-pod-rastyazhku-aisi-430-0-5mm/", mode:"piece", unitCost:260, qty:1},
  {id:"db_dm32_8", emoji:"📦", name:"Хомут под растяжку (AISI 430) 180", store:"pechki.su", url:"https://pechki.su/dymohody/homut-pod-rastyazhku-aisi-430-0-5mm/", mode:"piece", unitCost:306, qty:3},
  {id:"db_dm32_9", emoji:"📦", name:"Дефлектор Оц 115-180мм", store:"pechki.su", url:"https://pechki.su/dymohody/deflektor-ocz-aisi-43005mm/", mode:"piece", unitCost:1836, qty:1},
  {id:"db_dm32_10", emoji:"🧴", name:"Герметик термостойкий ВЕЗУВИЙ 1500°С 290мл", store:"pechki.su", url:"https://pechki.su/termoizolyaciya/germetik-termostoykiy-vezuviy-1500s-chernyy-290-ml/", mode:"piece", unitCost:593, qty:1},
  {id:"db_dm32_11", emoji:"🟨", name:"Базальтовая вата (3кг)", store:"pechki.su", url:"https://pechki.su/termoizolyaciya/bazaltovye-materialy/bazaltovaya-vata-3kg/", mode:"piece", unitCost:910, qty:1},
  {id:"db_dm32_12", emoji:"🟨", name:"Базальтовый картон 1000х600х6мм (3шт/уп)", store:"pechki.su", url:"https://pechki.su/termoizolyaciya/bazaltovye-materialy/bazaltovyj-karton-1000kh600kh6mm-3shtup/", mode:"piece", unitCost:780, qty:1},
  {id:"db_dm32_13", emoji:"🟦", name:"ППУ нерж. (AISI 430) 185", store:"pechki.su", url:"https://pechki.su/dymohody/nerzhaveyuschie-dymohody-vezuviy/ppu-nerzh-aisi-43005mm/", mode:"piece", unitCost:1970, qty:1},
  {id:"db_dm32_14", emoji:"📦", name:"Кровельный проходник ВЕЗУВИЙ №4 (890х890мм) угл, силикон", store:"pechki.su", url:"https://pechki.su/dymohody/master-flesh/master-flesh-vezuviy-4-d-300-450mm-890h890mm-ugl-silikon/", mode:"piece", unitCost:3330, qty:1},
  {id:"db_dm32_15", emoji:"🪨", name:"Камень Габбро-диабаз (мешок 20кг)", store:"pechki.su", url:"https://pechki.su/vse-dlya-bani-i-sauny/kamni-dlya-pechey/kamen-gabro-diabaz-meshok-20-kg/", mode:"piece", unitCost:475, qty:5},
  {id:"db_dm32_16", emoji:"🪨", name:"Камень Малиновый кварцит колотый (коробка 20кг)", store:"pechki.su", url:"https://pechki.su/vse-dlya-bani-i-sauny/kamni-dlya-pechey/kamen-malinovyj-kvarczit-kolotyj-korobka-20kg/", mode:"piece", unitCost:815, qty:1},
  {id:"db_dm32_17", emoji:"💡", name:"Герметизирующая лента NICOBAND Технониколь 10м", store:"Озон", url:"https://www.ozon.ru/product/germetiziruyushchaya-lenta-10m-15sm-serebristaya-samokleyashchayasya-nicoband-tehnonikol-1071209469/", mode:"piece", unitCost:1400, qty:1},
  {id:"db_dm32_18", emoji:"🧴", name:"Мастика термовлагостойкая клеящая NEOMID 4 кг", store:"Озон", url:"https://www.ozon.ru/product/mastika-termovlagostoykaya-kleyashchaya-neomid-universalnaya-4-kg-kley-dlya-plitki-964540731/", mode:"piece", unitCost:1050, qty:1},
  {id:"db_dm32_19", emoji:"◼️", name:"Плитка Керамин Студио 60x30 см матовая коричневый дерево", store:"Лемана", url:"https://lemanapro.ru/product/plitka-nastennaya-keramin-studio-60x30-sm-198-m-matovaya-cvet-korichnevyy-derevo-88923926/", mode:"m2", unitCost:750, qty:4},
  {id:"db_dm33_1", emoji:"🚽", name:"Унитаз компакт Sanita Master косой выпуск", store:"Лемана", url:"https://lemanapro.ru/product/unitaz-kompakt-sanita-master-kosoy-vypusk-dvoynoy-sliv-82624807/", mode:"piece", unitCost:5700, qty:1}
];
// ── Авто-генерация смет: на каждую работу, по двум видам (баня/дом) ──
(function(){try{
  var byName={}; expProducts.forEach(function(p){ if(byName[p.name]==null) byName[p.name]=p.id; });
  function stageN(s){ s=String(s||""); if(s.indexOf("ЭТАП 1")>=0||/подготов/i.test(s))return 1; if(s.indexOf("ЭТАП 2")>=0||/чернов/i.test(s))return 2; if(s.indexOf("ЭТАП 3")>=0||/чистов/i.test(s))return 3; return undefined; }
  var out=[];
  ["banya","house"].forEach(function(kind){
    dbWorks.forEach(function(w){
      if(isDeliveryMat(w)) return;
      var lines=[];
      (w.mats||[]).forEach(function(m){
        if(isDeliveryMat(m))return;
        var pid=byName[m.n]; if(!pid)return;
        lines.push({pid:pid, qty:(Number(m.qty)||1)});
      });
      out.push({id:"est_"+kind+"_w_"+w.id, kind:kind, name:w.n, stage:stageN(w.stage), cost:(Number(w.cost)||0), lines:lines});
    });
  });
  estimates=out;
}catch(e){console.warn("est gen",e);}})();
// ── Пересборка демо-объектов из смет: материалы по цене за единицу ──
(function(){try{
  var t1=templates.find(function(x){return x.id==="t1";}); if(t1)_tplRebuild(t1, estimates.filter(function(e){return e.kind==="banya";}).map(function(e){return e.id;}));
  var t2=templates.find(function(x){return x.id==="t2";}); if(t2)_tplRebuild(t2, estimates.filter(function(e){return e.kind==="house";}).map(function(e){return e.id;}));
  var bo=objects.find(function(x){return x.id==="obj_banya_kievka";}); if(bo&&t1) bo.stages=JSON.parse(JSON.stringify(t1.stages));
  var ho=objects.find(function(x){return x.id==="obj_dom_dmitrovka";}); if(ho&&t2) ho.stages=JSON.parse(JSON.stringify(t2.stages));
}catch(e){console.warn("tpl/obj rebuild",e);}})();
let purchased={}; // {matId: true} — отмечено снабженцем как куплено
let supplySearch=''; // поиск по материалам
let supplyStoreFilter=''; // фильтр по магазину
let dbEditWork=null,dbEditMat=null,dbDragWork=null,dbDragMat=null; // "works" | "mats"
let showNDBWork=false,showNDBMat=null; // showNDBMat = work id
// === ПЛАНИРОВКИ (база) ===
// dbPlans[i] = {id, name, img(base64)}
let dbPlans=[];
let showNDBPlan=false;            // открыта форма добавления планировки
let dbPlanNew={name:"",img:"",cat:"house"};   // буфер новой планировки
let dbPlanTab="house";            // активный подраздел планировок: house | banya
let crmPlanPickerFor=null;        // id клиента, для которого открыт выбор планировки
let newDBWork={n:"",cost:""};
let newDBMat={n:"",cost:"",store:""};
let showNObjStageTid="",newObjStage={n:"",c:"#e67e22"};
let showNObjWorkSid="",objMatModal=null;
let nu={name:"",av:"👷",c:"#e67e22",roles:[],objs:[]};
let nr={n:"",c:"#9b59b6",group:"other"};
let nt={name:"",icon:"🛁",kind:"banya"};
let tplPickFor=null;   // {eid} — для какой работы шаблона открыт выбор материала
let tplPickSearch="";  // поиск в выборе материала шаблона
let nobj={name:"",icon:"🛁",templateId:"",assignTo:[]};
let openTemplate=null,openObject=null;


function fl(){
  render();
  scheduleSave();
  // Show toast without re-render
  const t=document.getElementById("save-toast");
  if(t){
    t.style.opacity="1";t.style.transform="translateY(0)";
    clearTimeout(fl._t);
    fl._t=setTimeout(function(){t.style.opacity="0";t.style.transform="translateY(8px)";},1600);
  }
}
function deepCopy(x){return JSON.parse(JSON.stringify(x));}

function renderTplCards(){
  const grid=document.getElementById("tpl-grid");
  if(!grid)return;
  grid.innerHTML="";
  templates.forEach(function(t){
    const allW=t.stages.flatMap(function(s){return s.works;});
    const totalCost=allW.reduce(function(a,w){return a+w.cost;},0);
    const usedIn=objects.filter(function(o){return o.templateId===t.id;});
    const usedHtml=usedIn.length>0
      ? usedIn.map(function(o){return '<span style="font-size:11px;background:#e8f0fa;color:#2a5298;border-radius:8px;padding:2px 8px">'+o.icon+' '+o.name+'</span>';}).join("")
      : '<span style="font-size:11px;color:#aaa">Не использован</span>';
    const card=document.createElement("div");
    card.style.cssText="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:16px;box-sizing:border-box;width:100%;overflow:hidden";
    card.innerHTML=
      '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px">'+
        '<span style="font-size:32px">'+t.icon+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:15px;font-weight:700;color:#1a2a3a">'+t.name+'</div>'+
          '<div style="font-size:11px;color:#7a9aaa;margin-top:3px">'+t.stages.length+' этапов · '+allW.length+' работ</div>'+
          '<div style="font-size:11px;color:#5a7a9a;margin-top:2px">'+totalCost.toLocaleString("ru-RU")+' ₽</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">'+usedHtml+'</div>'+
      '<div style="display:flex;gap:6px">'+
        '<button id="edit-'+t.id+'" style="flex:1;padding:7px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:8px;cursor:pointer;font-size:12px;color:#5a7a9a;font-weight:600">✏️ Редактировать</button>'+
        '<button id="copy-'+t.id+'" style="flex:1;padding:7px;background:#f0f6ff;border:1px solid #4a7ac844;border-radius:8px;cursor:pointer;font-size:12px;color:#2a5298;font-weight:600">📋 Копировать</button>'+
        '<button id="del-'+t.id+'" style="width:34px;height:34px;background:transparent;border:1px solid #e74c3c44;border-radius:8px;cursor:pointer;color:#e74c3c;font-size:14px">✕</button>'+
      '</div>';
    grid.appendChild(card);
    document.getElementById("edit-"+t.id).onclick=function(){openTemplate=t.id;render();};
    document.getElementById("copy-"+t.id).onclick=function(){copyTemplate(t.id);};
    document.getElementById("del-"+t.id).onclick=function(){deleteTemplate(t.id);};
  });
}

function renderDbStageOptions(tid){
  const SC_MAP={"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ":"#e67e22","ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА":"#2980b9","ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА":"#27ae60"};
  const stages=[...new Set(dbWorks.map(function(w){return w.stage||"Без этапа";}))];
  let html='<div style="font-size:11px;color:#7a9aaa;font-weight:600;margin-bottom:8px">ВЫБЕРИТЕ ЭТАП ИЗ БАЗЫ ДАННЫХ</div>'+
    '<div style="font-size:11px;color:#5a7a9a;margin-bottom:10px">Работы и материалы этапа скопируются в шаблон</div>';
  stages.forEach(function(stage){
    const sw=dbWorks.filter(function(w){return(w.stage||"Без этапа")===stage;});
    const sc=SC_MAP[stage]||"#7f8c8d";
    const totalMats=sw.reduce(function(a,w){return a+(w.mats||[]).length;},0);
    const totalCost=sw.reduce(function(a,w){return a+w.cost;},0);
    const preview=sw.slice(0,3).map(function(w){return'<span style="font-size:10px;background:#f0f4f8;color:#5a7a9a;border-radius:5px;padding:1px 6px">'+w.n.substring(0,28)+(w.n.length>28?"…":"")+'</span>';}).join("");
    const more=sw.length>3?'<span style="font-size:10px;color:#7a9aaa">+'+( sw.length-3)+' ещё</span>':"";
    const safeStage=stage.replace(/&/g,"&amp;").replace(/"/g,"&quot;");
    const checked=!!dbStagePicks[stage];
    html+='<div data-a="tpl-pick-stage" data-stage="'+safeStage+'" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;margin-bottom:6px;border:1.5px solid '+(checked?sc:sc+"44")+';background:'+(checked?sc+"15":sc+"08")+'">'+
      '<div style="width:22px;height:22px;border-radius:6px;border:2px solid '+(checked?sc:"#c0d0e0")+';background:'+(checked?sc:"#fff")+';flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;margin-top:1px">'+(checked?"✓":"")+'</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:700;color:#1a2a3a">'+stage+'</div>'+
        '<div style="font-size:11px;color:#7a9aaa;margin-top:3px">'+sw.length+' работ · '+totalMats+' материалов · '+totalCost.toLocaleString("ru-RU")+' ₽</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">'+preview+more+'</div>'+
      '</div>'+
    '</div>';
  });
  const pickCount=stages.filter(function(s){return dbStagePicks[s];}).length;
  html+='<button data-a="tpl-add-picked" data-tid="'+tid+'" style="width:100%;padding:10px;background:'+(pickCount?"#27ae60":"#c8d8e8")+';border:none;border-radius:9px;cursor:'+(pickCount?"pointer":"default")+';font-size:13px;color:#fff;font-weight:700;margin-top:4px;margin-bottom:6px">'+(pickCount?"+ Добавить выбранные ("+pickCount+")":"Выберите этапы галочкой")+'</button>';
  html+='<button data-a="cancel-tns" style="width:100%;padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">Отмена</button>';
  return html;
}

function copyTemplate(tid){
  const src=templates.find(t=>t.id===tid);
  if(!src)return;
  const newId=gid();
  const copyStages=src.stages.map(s=>({
    ...s,id:gid(),
    works:s.works.map(w=>({...w,id:gid(),mats:(w.mats||[]).map(m=>({...m,id:gid()}))}))
  }));
  templates.push({id:newId,name:"Копия — "+src.name,icon:src.icon,stages:copyStages});
  openTemplate=newId;
  fl();
}

function deleteTemplate(tid){
  templates=templates.filter(t=>t.id!==tid);fl();
}

function markTplDirty(tid){
  const bar=document.getElementById("tpl-save-bar-"+tid);
  if(bar){bar.style.display="flex";}
}

function markDirty(oid){
  const bar=document.getElementById("save-bar-"+oid);
  if(bar)bar.style.display="block";
}

function renderDBLists(){
  // ── WORKS SECTION ────────────────────────────────────
  const wl=document.getElementById("dbworks-list");
  if(wl){
    wl.innerHTML="";
    // Stage group headers
    const stageC={"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ":"#e67e22","ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА":"#2980b9","ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА":"#27ae60"};
    let lastStage="";
    dbWorks.forEach(function(w,wi){
      // Insert stage divider when stage changes
      if((w.stage||"Без этапа")!==lastStage){
        lastStage=w.stage||"Без этапа";
        const sc3=stageC[lastStage]||"#7f8c8d";
        const divider=document.createElement("div");
        divider.style.cssText="display:flex;align-items:center;gap:8px;padding:7px 12px 5px;margin-top:"+(wi>0?"14px":"0");
        divider.innerHTML='<div style="flex:1;height:1px;background:'+sc3+'44"></div><span style="font-size:10px;font-weight:700;color:'+sc3+';letter-spacing:0.5px;white-space:nowrap">'+lastStage+'</span><div style="flex:1;height:1px;background:'+sc3+'44"></div>';
        wl.appendChild(divider);
      }
      const isEditW=dbEditWork===w.id;
      const card=document.createElement("div");
      card.style.cssText="background:#fff;border-radius:12px;border:1px solid #dde6f0;margin-bottom:8px;overflow:hidden";
      card.setAttribute("draggable","true");

      // --- Header ---
      const hdr=document.createElement("div");
      if(isEditW){
        hdr.style.cssText="padding:10px 14px;background:#f0f4f8;border-bottom:1px solid #d0dae8";
        const _wc=workCalc(w);
        const _isCustomUnit=_wc.unit&&WORK_UNITS.indexOf(_wc.unit)<0;
        hdr.innerHTML=
          '<input class="ew-n" value="'+w.n.replace(/"/g,'&quot;')+'" placeholder="Название" style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;font-weight:600;outline:none;box-sizing:border-box;margin-bottom:6px">'+
          '<div style="display:flex;gap:6px;margin-bottom:6px">'+
            '<div style="flex:1"><div style="font-size:9px;color:#7a9aaa;font-weight:700;margin-bottom:2px">КОЛ-ВО</div><input class="ew-qty" value="'+_wc.qty+'" type="number" step="any" min="0" style="width:100%;padding:7px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box"></div>'+
            '<div style="flex:1.2"><div style="font-size:9px;color:#7a9aaa;font-weight:700;margin-bottom:2px">ЕДИНИЦА</div><select class="ew-unit" style="width:100%;padding:7px 6px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;background:#fff;box-sizing:border-box">'+
              '<option value=""'+(!_wc.unit?" selected":"")+'>— нет —</option>'+
              WORK_UNITS.map(function(u){return '<option value="'+u+'"'+(_wc.unit===u?" selected":"")+'>'+u+'</option>';}).join("")+
              '<option value="__custom"'+(_isCustomUnit?" selected":"")+'>✏️ своя…</option>'+
            '</select></div>'+
            '<div style="flex:1.3"><div style="font-size:9px;color:#7a9aaa;font-weight:700;margin-bottom:2px">ЦЕНА/ЕД ₽</div><input class="ew-unitcost" value="'+_wc.unitCost+'" type="number" step="any" min="0" style="width:100%;padding:7px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box"></div>'+
          '</div>'+
          '<input class="ew-unit-custom" value="'+(_isCustomUnit?_wc.unit.replace(/"/g,"&quot;"):"")+'" placeholder="Своя единица (напр. погонаж)" style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:6px;display:'+(_isCustomUnit?"block":"none")+'">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#eaf3fb;border-radius:7px;margin-bottom:6px">'+
            '<span style="font-size:11px;color:#7a9aaa;font-weight:600">Итого по работе:</span>'+
            '<span class="ew-total" style="font-size:14px;font-weight:700;color:#2980b9">'+_wc.total.toLocaleString("ru-RU")+' ₽</span>'+
          '</div>'+
          '<select class="ew-stage" style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;margin-bottom:6px;background:#fff">'+
            '<option value="ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ"'+(w.stage==="ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ"?" selected":"")+'>Этап 1 — Подготовительные работы</option>'+
            '<option value="ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА"'+(w.stage==="ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА"?" selected":"")+'>Этап 2 — Черновая отделка</option>'+
            '<option value="ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА"'+(w.stage==="ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА"?" selected":"")+'>Этап 3 — Чистовая отделка</option>'+
          '</select>'+
          '<div style="display:flex;gap:6px">'+
            '<button class="ew-save" style="flex:1;padding:7px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">💾 Сохранить</button>'+
            '<button class="ew-cancel" style="padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">Отмена</button>'+
          '</div>';
        // Живой пересчёт итога + показ поля своей единицы
        const _unitSel=hdr.querySelector(".ew-unit");
        const _unitCustom=hdr.querySelector(".ew-unit-custom");
        const _qtyInp=hdr.querySelector(".ew-qty");
        const _ucInp=hdr.querySelector(".ew-unitcost");
        const _totalSpan=hdr.querySelector(".ew-total");
        function _recalc(){
          const q=parseFloat(_qtyInp.value)||0;
          const uc=parseFloat(_ucInp.value)||0;
          _totalSpan.textContent=Math.round(q*uc).toLocaleString("ru-RU")+" ₽";
        }
        _qtyInp.oninput=_recalc; _ucInp.oninput=_recalc;
        _unitSel.onchange=function(){
          if(_unitSel.value==="__custom"){_unitCustom.style.display="block";_unitCustom.focus();}
          else{_unitCustom.style.display="none";}
        };
        hdr.querySelector(".ew-save").onclick=function(){
          const n=hdr.querySelector(".ew-n").value.trim();
          const qty=parseFloat(_qtyInp.value)||0;
          const unitCost=parseFloat(_ucInp.value)||0;
          let unit=_unitSel.value;
          if(unit==="__custom") unit=_unitCustom.value.trim();
          const total=Math.round(qty*unitCost);
          const stage=hdr.querySelector(".ew-stage").value||w.stage;
          if(n)dbWorks=dbWorks.map(function(x){return x.id===w.id?Object.assign({},x,{n:n,unit:unit,qty:qty,unitCost:unitCost,cost:total,stage:stage}):x;});
          // Re-sort by stage order if stage changed
          if(stage!==w.stage){
            const stageOrder=["ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ","ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА","ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА"];
            dbWorks.sort(function(a,b){return stageOrder.indexOf(a.stage)-stageOrder.indexOf(b.stage);});
          }
          dbEditWork=null; fl();
        };
        hdr.querySelector(".ew-cancel").onclick=function(){dbEditWork=null;renderDBLists();};
      } else {
        hdr.style.cssText="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:grab;background:#fafbfc;border-bottom:1px solid #eef2f7";
        const sc2=({"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ":"#e67e22","ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА":"#2980b9","ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА":"#27ae60"})[w.stage]||"#7f8c8d";
        hdr.innerHTML=
          '<span style="font-size:14px;color:#b0b8c8">⋮⋮</span>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:13px;font-weight:700;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+w.n+'</div>'+
            '<div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">'+
              '<span style="font-size:10px;font-weight:700;color:'+sc2+';background:'+sc2+'18;border-radius:8px;padding:1px 7px;border:1px solid '+sc2+'44">'+(w.stage||"")+'</span>'+
              (function(){var ql=workQtyLabel(w);return ql?'<span style="font-size:10px;color:#16a085;background:#16a08515;border-radius:8px;padding:1px 7px;font-weight:600">'+ql+'</span>':'';})()+
              (w.cost>0?'<span style="font-size:11px;color:#7a9aaa;font-weight:700">= '+w.cost.toLocaleString("ru-RU")+' ₽</span>':'')+
              '<span style="font-size:11px;color:#7a9aaa">'+( w.mats||[]).length+' матер.</span>'+
            '</div>'+
          '</div>'+
          '<button class="ew-edit" style="padding:4px 9px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:6px;cursor:pointer;font-size:11px;color:#5a7a9a">✏️</button>'+
          '<button class="ew-del" style="width:26px;height:26px;background:transparent;border:1px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:12px">✕</button>';
        hdr.querySelector(".ew-edit").onclick=function(){dbEditWork=w.id;dbEditMat=null;renderDBLists();};
        hdr.querySelector(".ew-del").onclick=function(){dbWorks=dbWorks.filter(function(x){return x.id!==w.id;});fl();};
      }
      card.appendChild(hdr);

      // --- Mats body (collapsible) ---
      const mBody=document.createElement("div");
      mBody.style.cssText="padding:0 12px 6px";
      // Collapsible header for mats
      if((w.mats||[]).length>0){
        const matToggle=document.createElement("div");
        const isOpen=window._dbOpenMats&&window._dbOpenMats[w.id];
        matToggle.style.cssText="display:flex;align-items:center;gap:6px;padding:6px 0;cursor:pointer;border-top:1px solid #f0f4f8;margin-top:2px";
        matToggle.innerHTML='<span style="font-size:11px;color:#2980b9;transition:transform 0.2s;display:inline-block;transform:'+(isOpen?'rotate(90deg)':'rotate(0deg)')+'">▶</span>'+
          '<span style="font-size:11px;color:#2980b9;font-weight:600">Материалы ('+( w.mats||[]).length+')</span>';
        matToggle.onclick=function(){
          if(!window._dbOpenMats)window._dbOpenMats={};
          window._dbOpenMats[w.id]=!window._dbOpenMats[w.id];
          renderDBLists();
        };
        mBody.appendChild(matToggle);
        if(!isOpen){
          card.appendChild(mBody);
          wl.appendChild(card);
          // bind drag and work buttons (deferred)
          (function(card,hdr,w,wi){
          card.addEventListener("dragstart",function(e){if(e.target===card||e.target===hdr){dbDragWork={wid:w.id,wi};e.dataTransfer.effectAllowed="move";}});
          card.addEventListener("dragover",function(e){if(dbDragWork&&dbDragWork.wid!==w.id){e.preventDefault();card.style.borderColor="#4a7ac8";}});
          card.addEventListener("dragleave",function(){card.style.borderColor="#dde6f0";});
          card.addEventListener("drop",function(e){
            e.preventDefault();
            card.style.borderColor="#dde6f0";
            if(!dbDragWork||dbDragWork.wid===w.id){dbDragWork=null;return;}
            const STAGE_ORDER=["ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ","ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА","ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА"];
            const fromIdx=dbWorks.findIndex(function(x){return x.id===dbDragWork.wid;});
            const targetIdx=dbWorks.findIndex(function(x){return x.id===w.id;});
            if(fromIdx<0||targetIdx<0){dbDragWork=null;return;}
            const ws2=[].concat(dbWorks);
            const moved=ws2.splice(fromIdx,1)[0];
            // Перетащенная работа принимает этап целевой работы
            moved.stage=w.stage;
            // Вставляем перед целевой (пересчитываем её индекс после удаления)
            const insertIdx=ws2.findIndex(function(x){return x.id===w.id;});
            ws2.splice(insertIdx,0,moved);
            // Стабильная сортировка по порядку этапов, чтобы заголовки не дублировались
            const idxMap=new Map(ws2.map(function(x,i){return [x.id,i];}));
            ws2.sort(function(a,b){
              const sa=STAGE_ORDER.indexOf(a.stage), sb=STAGE_ORDER.indexOf(b.stage);
              if(sa!==sb) return sa-sb;
              return idxMap.get(a.id)-idxMap.get(b.id);
            });
            dbWorks=ws2;
            dbDragWork=null;
            fl();
          });
          })(card,hdr,w,wi);
          return; // skip mat rows
        }
      }
      (w.mats||[]).forEach(function(m,mi){
        const isEM=dbEditMat===w.id+":"+m.id;
        const mRow=document.createElement("div");
        mRow.style.cssText="border-top:1px solid #f4f6f9";
        mRow.setAttribute("draggable","true");
        if(isEM){
          mRow.innerHTML=
            '<div style="padding:8px 0;display:flex;flex-direction:column;gap:5px">'+
              '<div style="display:flex;gap:5px">'+
                '<input class="em-n" value="'+m.n.replace(/"/g,'&quot;').replace(/\n/g,' ')+'" placeholder="Название" style="flex:1;padding:6px 9px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
                '<input class="em-c" value="'+m.cost+'" type="number" placeholder="₽" style="width:80px;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
              '</div>'+
              '<div style="display:flex;gap:5px">'+
                '<input class="em-s" value="'+(m.store||'').replace(/"/g,'&quot;')+'" placeholder="Магазин" style="flex:1;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
                '<input class="em-u" value="'+(m.url||'').replace(/"/g,'&quot;')+'" placeholder="Ссылка https://..." style="flex:2;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
              '</div>'+
              '<div style="display:flex;gap:5px">'+
                '<input class="em-note" value="'+(m.note||'').replace(/"/g,'&quot;')+'" placeholder="Примечание" style="flex:1;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
                '<button class="em-save" style="padding:6px 12px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:11px;font-weight:700">💾</button>'+
                '<button class="em-cancel" style="padding:6px 10px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:11px;color:#7a9aaa">✕</button>'+
              '</div>'+
            '</div>';
          mRow.querySelector(".em-save").onclick=function(){
            const n=mRow.querySelector(".em-n").value.trim();
            const c=parseInt(mRow.querySelector(".em-c").value)||0;
            const s=mRow.querySelector(".em-s").value;
            const u=mRow.querySelector(".em-u").value;
            const note=mRow.querySelector(".em-note").value;
            dbWorks=dbWorks.map(function(x){
              if(x.id!==w.id)return x;
              return Object.assign({},x,{mats:(x.mats||[]).map(function(mx){
                return mx.id===m.id?Object.assign({},mx,{n,cost:c,store:s,url:u,note}):mx;
              })});
            });
            dbEditMat=null; fl();
          };
          mRow.querySelector(".em-cancel").onclick=function(){dbEditMat=null;renderDBLists();};
        } else {
          mRow.innerHTML=
            '<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0">'+
              '<span style="font-size:12px;color:#ccc;margin-top:3px;cursor:grab">⋮⋮</span>'+
              '<div style="flex:1;min-width:0">'+
                '<div style="font-size:12px;font-weight:600;color:#2a3a4a">'+m.n+'</div>'+
                '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;align-items:center">'+
                  (m.store?'<span style="font-size:10px;font-weight:700;background:'+(SC[m.store]||"#555")+';color:#fff;border-radius:4px;padding:1px 6px">'+m.store+'</span>':'')+
                  (m.cost>0?'<span style="font-size:11px;color:#7a9aaa">'+m.cost.toLocaleString("ru-RU")+' ₽</span>':'')+
                  (m.note?'<span style="font-size:10px;color:#9aabbf;font-style:italic">'+m.note+'</span>':'')+
                  (m.url?'<a href="'+m.url+'" target="_blank" style="font-size:10px;color:#fff;background:#2980b9;border-radius:4px;padding:1px 7px;text-decoration:none;font-weight:600">🔗 купить</a>':'')+
                '</div>'+
              '</div>'+
              '<button class="em-edit" style="padding:3px 8px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:6px;cursor:pointer;font-size:11px;color:#5a7a9a">✏️</button>'+
              '<button class="em-del" style="width:22px;height:22px;background:transparent;border:1px solid #e74c3c44;border-radius:5px;cursor:pointer;color:#e74c3c;font-size:11px">✕</button>'+
            '</div>';
          mRow.querySelector(".em-edit").onclick=function(){dbEditMat=w.id+":"+m.id;dbEditWork=null;renderDBLists();};
          mRow.querySelector(".em-del").onclick=function(){
            dbWorks=dbWorks.map(function(x){
              if(x.id!==w.id)return x;
              return Object.assign({},x,{mats:(x.mats||[]).filter(function(mx){return mx.id!==m.id;})});
            }); fl();
          };
        }
        // mat drag
        mRow.addEventListener("dragstart",function(e){dbDragMat={mid:m.id,wid:w.id,mi};e.dataTransfer.effectAllowed="move";mRow.style.opacity="0.4";});
        mRow.addEventListener("dragend",function(){mRow.style.opacity="1";});
        mRow.addEventListener("dragover",function(e){e.preventDefault();mRow.style.background="#e8f0fa";});
        mRow.addEventListener("dragleave",function(){mRow.style.background="";});
        mRow.addEventListener("drop",function(e){
          e.preventDefault();mRow.style.background="";
          if(!dbDragMat||dbDragMat.wid!==w.id)return;
          const fi=dbDragMat.mi,ti=mi;
          if(fi===ti)return;
          dbWorks=dbWorks.map(function(x){
            if(x.id!==w.id)return x;
            const ms=[].concat(x.mats||[]);
            ms.splice(ti,0,ms.splice(fi,1)[0]);
            return Object.assign({},x,{mats:ms});
          });
          dbDragMat=null;fl();
        });
        mBody.appendChild(mRow);
      });

      // add mat button / form
      const addBtn=document.createElement("button");
      addBtn.style.cssText="width:100%;padding:7px;margin:4px 0 0;background:transparent;border:1px dashed #2980b966;border-radius:7px;cursor:pointer;font-size:11px;color:#2980b9;font-weight:600";
      addBtn.textContent="+ Добавить материал";
      addBtn.onclick=function(){showNDBMat=(showNDBMat===w.id?null:w.id);dbEditMat=null;renderDBLists();};
      mBody.appendChild(addBtn);

      if(showNDBMat===w.id){
        const form=document.createElement("div");
        form.style.cssText="background:#f0f4f8;border-radius:9px;padding:10px;margin-top:6px";
        form.innerHTML=
          '<input class="nm-n" placeholder="Название материала" style="width:100%;padding:7px 9px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;margin-bottom:5px;box-sizing:border-box">'+
          '<div style="display:flex;gap:5px;margin-bottom:5px;align-items:center">'+
            '<input class="nm-uc" placeholder="Цена за ед., ₽" type="number" style="flex:1;min-width:0;padding:7px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
            '<span style="color:#7a9aaa;font-size:12px">×</span>'+
            '<input class="nm-q" placeholder="Кол-во" type="number" step="any" value="1" style="width:58px;padding:7px 6px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
            matUnitSelect("nm-unit","")+
          '</div>'+
          '<div style="font-size:11px;color:#5a7a9a;margin-bottom:5px">Итого: <b class="nm-total" style="color:#1a2a3a">0 ₽</b></div>'+
          '<div style="display:flex;gap:5px;margin-bottom:5px;align-items:center">'+
            '<span style="font-size:12px;color:#7a9aaa;white-space:nowrap">📦 1 упак =</span>'+
            '<input class="nm-pm2" type="number" step="any" placeholder="м² в упаковке (необязательно)" style="flex:1;min-width:0;padding:7px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
            '<span style="font-size:12px;color:#7a9aaa">м²</span>'+
          '</div>'+
          '<div style="display:flex;gap:5px;margin-bottom:5px">'+
            '<input class="nm-s" placeholder="Магазин" style="flex:1;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
            '<input class="nm-u" placeholder="Ссылка https://..." style="flex:2;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">'+
          '</div>'+
          '<input class="nm-note" placeholder="Примечание" style="width:100%;padding:6px 9px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;margin-bottom:6px;outline:none;box-sizing:border-box">'+
          '<div style="display:flex;gap:6px">'+
            '<button class="nm-save" style="flex:1;padding:7px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Добавить</button>'+
            '<button class="nm-cancel" style="padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>'+
          '</div>';
        const _nmRecalc=function(){
          const uc=parseInt(form.querySelector(".nm-uc").value)||0;
          const q=parseFloat(form.querySelector(".nm-q").value)||1;
          const t=form.querySelector(".nm-total");
          if(t)t.textContent=Math.round(uc*q).toLocaleString("ru-RU")+" ₽";
        };
        form.querySelector(".nm-uc").oninput=_nmRecalc;
        form.querySelector(".nm-q").oninput=_nmRecalc;
        form.querySelector(".nm-save").onclick=function(){
          const n=form.querySelector(".nm-n").value.trim();
          const uc=parseInt(form.querySelector(".nm-uc").value)||0;
          const q=parseFloat(form.querySelector(".nm-q").value)||1;
          const unit=form.querySelector(".nm-unit").value;
          const cost=Math.round(uc*q);
          const pm2v=parseFloat(form.querySelector(".nm-pm2").value);
          const packM2=(!isNaN(pm2v)&&pm2v>0)?pm2v:null;
          const s=form.querySelector(".nm-s").value;
          const u=form.querySelector(".nm-u").value;
          const note=form.querySelector(".nm-note").value;
          if(!n)return;
          dbWorks=dbWorks.map(function(x){
            if(x.id!==w.id)return x;
            return Object.assign({},x,{mats:[].concat(x.mats||[],[{id:gid(),n,unit:unit,qty:q,unitCost:uc,cost:uc,packM2:packM2,store:s,url:u,note}])});
          });
          showNDBMat=null;fl();
        };
        form.querySelector(".nm-cancel").onclick=function(){showNDBMat=null;renderDBLists();};
        mBody.appendChild(form);
      }

      card.appendChild(mBody);
      wl.appendChild(card);

      // work drag
      card.addEventListener("dragstart",function(e){
        if(e.target===card||e.target===hdr){dbDragWork={wid:w.id,wi};e.dataTransfer.effectAllowed="move";}
      });
      card.addEventListener("dragover",function(e){if(dbDragWork&&dbDragWork.wid!==w.id){e.preventDefault();card.style.borderColor="#4a7ac8";}});
      card.addEventListener("dragleave",function(){card.style.borderColor="#dde6f0";});
      card.addEventListener("drop",function(e){
        e.preventDefault();card.style.borderColor="#dde6f0";
        if(!dbDragWork||dbDragWork.wid===w.id)return;
        const ws2=[].concat(dbWorks);
        const moved=ws2.splice(dbDragWork.wi,1)[0];
        // Auto-update stage to match drop target's stage
        moved.stage=w.stage;
        ws2.splice(wi,0,moved);
        dbWorks=ws2;dbDragWork=null;fl();
      });
    });
  }

  // ── MATS SECTION = список Эксперимента (товары и цены за единицу) ──
  const ml=document.getElementById("dbmats-list");
  if(ml){
    if(dbSection==="mats"){ renderExpCard("dbmats-list"); }
    else { ml.innerHTML=""; }
  }
  // ── ESTIMATES SECTION = сметы из материалов ──
  const el_est=document.getElementById("dbest-list");
  if(el_est){
    if(dbSection==="est"){ renderEstimates(); }
    else { el_est.innerHTML=""; }
  }
}

// Последние 4 цифры телефона клиента (из связанного CRM-клиента)
function clientPhoneLast4(c){
  if(!c) return "";
  const cl=crmClients.find(function(x){return x.id===c.crmClientId;});
  const digits=((cl&&cl.phone)?cl.phone:"").replace(/\D/g,"");
  return digits.slice(-4);
}
// Действующий PIN клиента: ручной clientPin, иначе последние 4 цифры телефона
function effectiveClientPin(c){
  if(!c) return "";
  return (c.clientPin&&c.clientPin.trim())?c.clientPin.trim():clientPhoneLast4(c);
}
// Поиск договора по номеру/названию или фамилии клиента
function findClientContract(query){
  const q=(query||"").trim().toLowerCase();
  if(!q) return null;
  const qd=q.replace(/\D/g,""); // цифры запроса — для поиска по телефону
  return contractDocs.find(function(c){
    const nm=(c.name||"").toLowerCase();
    const cl=(c.client||"").toLowerCase();
    const cm=crmClients.find(function(x){return x.id===c.crmClientId;});
    const ph=((cm&&cm.phone)?cm.phone:"").replace(/\D/g,"");
    return nm.indexOf(q)>=0 || cl.indexOf(q)>=0 || (qd.length>=4 && ph.indexOf(qd)>=0);
  })||null;
}

function loginPage(){
  // Общая обёртка с шапкой
  function wrap(inner){
    return '<div style="min-height:100vh;background:linear-gradient(160deg,#f0f4f8 0%,#e8eef5 100%);display:flex;align-items:center;justify-content:center;padding:20px">'+
      '<div style="width:100%;max-width:360px">'+
        '<div style="text-align:center;margin-bottom:28px">'+
          '<div style="width:70px;height:70px;border-radius:20px;background:linear-gradient(135deg,#2980b9,#1a5276);display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 12px;box-shadow:0 8px 24px rgba(41,128,185,0.3)">🏗️</div>'+
          '<div style="font-size:26px;font-weight:800;color:#0d1b2e;letter-spacing:0.5px">КубрДом</div>'+
          '<div style="font-size:12px;color:#7a9aaa;margin-top:4px;letter-spacing:1.5px;font-weight:600">ПОРТАЛ УПРАВЛЕНИЯ</div>'+
        '</div>'+
        inner+
        '<div style="text-align:center;margin-top:14px;font-size:11px;color:#a0b4c8">КубрДом · Портал управления</div>'+
      '</div>'+
    '</div>';
  }

  // Экран 1 — выбор типа входа
  if(!loginMode){
    const inner='<div style="background:#fff;border-radius:20px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e8eef5">'+
        '<div style="font-size:14px;font-weight:700;color:#1a2a3a;margin-bottom:3px">Добро пожаловать</div>'+
        '<div style="font-size:12px;color:#7a9aaa;margin-bottom:18px">Как вы хотите войти?</div>'+
        '<div style="display:flex;flex-direction:column;gap:10px">'+
          '<button data-a="login-mode" data-m="employee" style="display:flex;align-items:center;gap:14px;padding:16px 16px;border-radius:14px;border:1.5px solid #e8eef5;background:#fff;cursor:pointer;text-align:left;width:100%;box-sizing:border-box">'+
            '<div style="width:48px;height:48px;border-radius:13px;background:linear-gradient(135deg,#2980b9,#1a5276);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">👷</div>'+
            '<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:700;color:#0d1b2e">Сотрудник</div><div style="font-size:12px;color:#7a9aaa;margin-top:2px">Вход в портал управления</div></div>'+
            '<span style="font-size:18px;color:#c8d8e8">›</span>'+
          '</button>'+
          '<button data-a="login-mode" data-m="client" style="display:flex;align-items:center;gap:14px;padding:16px 16px;border-radius:14px;border:1.5px solid #e8eef5;background:#fff;cursor:pointer;text-align:left;width:100%;box-sizing:border-box">'+
            '<div style="width:48px;height:48px;border-radius:13px;background:linear-gradient(135deg,#27ae60,#16a085);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🤝</div>'+
            '<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:700;color:#0d1b2e">Клиент</div><div style="font-size:12px;color:#7a9aaa;margin-top:2px">Личный кабинет клиента</div></div>'+
            '<span style="font-size:18px;color:#c8d8e8">›</span>'+
          '</button>'+
        '</div>'+
      '</div>';
    return wrap(inner);
  }

  // Экран — личный кабинет клиента (заглушка)
  if(loginMode==="client"){
    // Шаг 2 — ввод PIN найденного договора
    if(clientLoginStep==="pin"&&clientLoginMatch){
      const c=contractDocs.find(function(x){return x.id===clientLoginMatch;});
      if(c){
        const inner='<div style="background:#fff;border-radius:20px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e8eef5;text-align:center">'+
            '<div style="width:56px;height:56px;border-radius:14px;background:#27ae6015;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 10px">🤝</div>'+
            '<div style="font-size:15px;font-weight:700;color:#0d1b2e">'+(c.client||"Клиент")+'</div>'+
            '<div style="font-size:12px;color:#7a9aaa;margin-bottom:16px">'+c.name+'</div>'+
            '<input id="client-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••" style="width:160px;padding:12px;border-radius:12px;border:1.5px solid '+(clientLoginError?"#e74c3c":"#d0dae8")+';font-size:22px;text-align:center;letter-spacing:8px;outline:none;margin:0 auto;display:block;box-sizing:border-box">'+
            (clientLoginError?'<div style="font-size:12px;color:#e74c3c;font-weight:600;margin-top:8px">'+clientLoginError+'</div>':'')+
            '<button data-a="client-pin-submit" style="width:100%;margin-top:14px;padding:12px;background:#27ae60;border:none;border-radius:12px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">Войти</button>'+
            '<div style="font-size:11px;color:#9aabbf;margin-top:12px;line-height:1.5">Не знаете PIN? Узнайте его у вашего<br>менеджера по сопровождению.</div>'+
            '<button data-a="client-find-back" style="width:100%;margin-top:10px;padding:10px;background:#f0f4f8;border:1px solid #dde6f0;border-radius:10px;cursor:pointer;font-size:13px;color:#7a9aaa;font-weight:600">← Назад</button>'+
          '</div>';
        return wrap(inner);
      }
    }
    // Шаг 1 — ввод номера договора или фамилии
    const inner='<div style="background:#fff;border-radius:20px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e8eef5">'+
        '<div style="text-align:center;margin-bottom:16px"><div style="width:56px;height:56px;border-radius:14px;background:#27ae6015;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 10px">🤝</div>'+
        '<div style="font-size:16px;font-weight:700;color:#0d1b2e">Кабинет клиента</div>'+
        '<div style="font-size:12px;color:#7a9aaa;margin-top:2px">Войдите по номеру договора или фамилии</div></div>'+
        '<input id="client-query" value="'+"" +'" placeholder="Номер договора или фамилия" style="width:100%;padding:11px 12px;border-radius:11px;border:1.5px solid '+(clientLoginError?"#e74c3c":"#d0dae8")+';font-size:14px;outline:none;box-sizing:border-box">'+
        (clientLoginError?'<div style="font-size:12px;color:#e74c3c;font-weight:600;margin-top:8px">'+clientLoginError+'</div>':'')+
        '<button data-a="client-find" style="width:100%;margin-top:12px;padding:12px;background:#27ae60;border:none;border-radius:12px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">Далее</button>'+
        '<button data-a="login-back" style="width:100%;margin-top:8px;padding:10px;background:#f0f4f8;border:1px solid #dde6f0;border-radius:10px;cursor:pointer;font-size:13px;color:#7a9aaa;font-weight:600">← Назад</button>'+
      '</div>';
    return wrap(inner);
  }

  // Экран — ввод PIN выбранного сотрудника
  if(loginMode==="employee"&&loginPinFor){
    const u=users.find(function(x){return x.id===loginPinFor;});
    if(u){
      const inner='<div style="background:#fff;border-radius:20px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e8eef5;text-align:center">'+
          '<div style="width:56px;height:56px;border-radius:14px;background:'+u.c+';display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 10px">'+u.av+'</div>'+
          '<div style="font-size:16px;font-weight:700;color:#0d1b2e;margin-bottom:2px">'+u.name+'</div>'+
          '<div style="font-size:12px;color:#7a9aaa;margin-bottom:16px">Введите PIN для входа</div>'+
          '<input id="login-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••" style="width:160px;padding:12px;border-radius:12px;border:1.5px solid '+(loginPinError?"#e74c3c":"#d0dae8")+';font-size:22px;text-align:center;letter-spacing:8px;outline:none;margin:0 auto;display:block;box-sizing:border-box">'+
          (loginPinError?'<div style="font-size:12px;color:#e74c3c;font-weight:600;margin-top:8px">'+loginPinError+'</div>':'')+
          '<label style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px;font-size:13px;color:#5a7a9a;cursor:pointer;user-select:none"><input type="checkbox" id="remember-me" checked style="width:17px;height:17px;cursor:pointer">Запомнить меня</label>'+
          '<button data-a="login-pin-submit" style="width:100%;margin-top:12px;padding:12px;background:'+u.c+';border:none;border-radius:12px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">Войти</button>'+
          '<button data-a="login-pin-back" style="width:100%;margin-top:8px;padding:10px;background:#f0f4f8;border:1px solid #dde6f0;border-radius:10px;cursor:pointer;font-size:13px;color:#7a9aaa;font-weight:600">← Назад</button>'+
        '</div>';
      return wrap(inner);
    }
  }

  // Экран — список сотрудников
  let membersHtml='';
  users.forEach(function(u){
    const rolePills=u.roles.map(function(rid){
      const r=roles.find(function(x){return x.id===rid;});
      return r?'<span style="font-size:10px;font-weight:600;color:'+r.c+';background:'+r.c+'15;border-radius:6px;padding:1px 6px">'+r.n+'</span>':"";
    }).join("");
    membersHtml+=
      '<button data-a="login-as" data-uid="'+u.id+'" data-color="'+u.c+'" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1.5px solid #e8eef5;background:#fff;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;transition:border-color 0.15s">'+
        '<div style="width:44px;height:44px;border-radius:12px;background:'+u.c+';display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">'+u.av+'</div>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:14px;font-weight:700;color:#0d1b2e">'+u.name+'</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">'+rolePills+'</div>'+
        '</div>'+
        '<span style="font-size:18px;color:#c8d8e8">›</span>'+
      '</button>';
  });
  const inner='<div style="background:#fff;border-radius:20px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e8eef5">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">'+
        '<button data-a="login-back" style="width:28px;height:28px;background:#f0f4f8;border:1px solid #dde6f0;border-radius:8px;cursor:pointer;font-size:13px;color:#7a9aaa;flex-shrink:0">←</button>'+
        '<div style="font-size:14px;font-weight:700;color:#1a2a3a">Выберите свой профиль</div>'+
      '</div>'+
      '<div style="font-size:12px;color:#7a9aaa;margin:4px 0 14px 36px">Вход для сотрудников</div>'+
      '<input id="emp-phone" data-phone-mask="1" type="tel" inputmode="tel" autocomplete="off" placeholder="+7 (___) ___-__-__" style="width:100%;padding:12px;border-radius:12px;border:1.5px solid '+(empPhoneError?"#e74c3c":"#d0dae8")+';font-size:16px;outline:none;box-sizing:border-box">'+
      (empPhoneError?'<div style="font-size:12px;color:#e74c3c;font-weight:600;margin-top:6px">'+empPhoneError+'</div>':'')+
      '<button data-a="emp-phone-go" style="width:100%;margin-top:12px;padding:12px;background:#2980b9;border:none;border-radius:12px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">Войти</button>'+
    '</div>';
  return wrap(inner);
}


function _setInitialTab(){
  const _isAdmin=currentUser.roles.includes("admin");
  if(_isAdmin){ tab="assign"; return; }
  const r=currentUser.roles;
  if(r.includes("brigadier")||r.includes("worker")) tab="assign";
  else if(r.includes("supply")) tab="supply";
  else if(r.includes("marketer")) tab="marketing";
  else if(r.includes("financier")) tab="crm";
  else tab="assign";
}

function bindLogin(){
  document.querySelectorAll("[data-a='login-mode']").forEach(function(el){
    el.onclick=function(){ loginMode=el.dataset.m; render(); };
  });
  document.querySelectorAll("[data-a='login-back']").forEach(function(el){
    el.onclick=function(){ loginMode=null; clientLoginStep="find"; clientLoginMatch=null; clientLoginError=""; render(); };
  });
  // Клиент: поиск договора по номеру/фамилии
  document.querySelectorAll("[data-a='client-find']").forEach(function(el){
    const go=function(){
      const inp=document.getElementById("client-query");
      const q=inp?inp.value:"";
      const c=findClientContract(q);
      if(!c){
        clientLoginError="Договор не найден. Проверьте номер или фамилию, либо обратитесь к менеджеру по сопровождению.";
        render(); return;
      }
      clientLoginMatch=c.id; clientLoginStep="pin"; clientLoginError="";
      render();
    };
    el.onclick=go;
  });
  // Enter в поле поиска
  const cq=document.getElementById("client-query");
  if(cq){ cq.focus(); cq.onkeydown=function(e){ if(e.key==="Enter"){ const b=document.querySelector("[data-a='client-find']"); if(b)b.click(); } }; }
  // Клиент: назад к поиску
  document.querySelectorAll("[data-a='client-find-back']").forEach(function(el){
    el.onclick=function(){ clientLoginStep="find"; clientLoginMatch=null; clientLoginError=""; render(); };
  });
  // Клиент: проверка PIN и вход в кабинет
  document.querySelectorAll("[data-a='client-pin-submit']").forEach(function(el){
    const go=function(){
      const c=contractDocs.find(function(x){return x.id===clientLoginMatch;});
      if(!c)return;
      const inp=document.getElementById("client-pin");
      const val=(inp?inp.value:"").trim();
      const pin=effectiveClientPin(c);
      if(!pin){ clientLoginError="PIN не задан. Обратитесь к менеджеру по сопровождению."; render(); return; }
      if(val!==pin){ clientLoginError="Неверный PIN. Узнайте его у менеджера по сопровождению."; render(); return; }
      clientAuthContract=c.id;
      loginMode=null; clientLoginStep="find"; clientLoginMatch=null; clientLoginError=""; clientTab="objects";
      render();
    };
    el.onclick=go;
  });
  const cpin=document.getElementById("client-pin");
  if(cpin){ cpin.focus(); cpin.onkeydown=function(e){ if(e.key==="Enter"){ const b=document.querySelector("[data-a='client-pin-submit']"); if(b)b.click(); } }; }
  // Сотрудник: выбор профиля -> экран ввода PIN
  document.querySelectorAll("[data-a='emp-phone-go']").forEach(function(el){
    const go=function(){
      const inp=document.getElementById("emp-phone");
      const qd=((inp?inp.value:"")||"").replace(/\D/g,"");
      if(qd.length<4){ empPhoneError="Введите номер телефона"; render(); return; }
      const norm=function(s){return (s||"").replace(/\D/g,"").slice(-10);};
      const u=users.find(function(x){return x.phone && norm(x.phone)===norm(qd);});
      if(!u){ empPhoneError="Сотрудник с таким номером не найден. Телефон задаёт админ во вкладке «Команда»."; render(); return; }
      empPhoneError=""; loginPinFor=u.id; loginPinError=""; render();
    };
    el.onclick=go;
  });
  const _ep=document.getElementById("emp-phone");
  if(_ep){ _ep.onkeydown=function(e){ if(e.key==="Enter"){ const b=document.querySelector("[data-a='emp-phone-go']"); if(b)b.click(); } }; }
  if(window._bindPhoneInputs)window._bindPhoneInputs(); // маска телефона на экране входа (как в CRM)

  document.querySelectorAll("[data-a='login-as']").forEach(function(el){
    const c=el.dataset.color;
    el.onmouseenter=function(){this.style.borderColor=c;this.style.background=c+'10';};
    el.onmouseleave=function(){this.style.borderColor='#e8eef5';this.style.background='#fff';};
    el.onclick=function(){
      loginPinFor=el.dataset.uid;
      loginPinError="";
      render();
    };
  });
  // Назад с экрана PIN к списку профилей
  document.querySelectorAll("[data-a='login-pin-back']").forEach(function(el){
    el.onclick=function(){ loginPinFor=null; loginPinError=""; render(); };
  });
  // Проверка PIN и вход
  document.querySelectorAll("[data-a='login-pin-submit']").forEach(function(el){
    const doLogin=function(){
      const u=users.find(function(x){return x.id===loginPinFor;});
      if(!u)return;
      const inp=document.getElementById("login-pin");
      const val=(inp?inp.value:"").trim();
      if(val!==(u.pin||"1111")){
        loginPinError="Неверный PIN";
        render();
        return;
      }
      currentUser=u;
      try{ const rm=document.getElementById("remember-me"); if(!rm||rm.checked) localStorage.setItem("kubr_remember",u.id); else localStorage.removeItem("kubr_remember"); }catch(e){}
      loginPinFor=null; loginPinError="";
      _setInitialTab();
      render();
    };
    el.onclick=doLogin;
  });
  // Enter в поле PIN
  const pinInp=document.getElementById("login-pin");
  if(pinInp){
    pinInp.focus();
    pinInp.onkeydown=function(e){ if(e.key==="Enter"){ const b=document.querySelector("[data-a='login-pin-submit']"); if(b)b.click(); } };
  }
}

// ── КАБИНЕТ КЛИЕНТА (проект: объект + планировки + статус) ──
// ── ВКЛАДКА «АНАЛИЗ СТРОЙКИ» (производство): диаграмма Ганта по часам + выходные ──
function tBuildAnalysis(){
  // Админ и начальник производства видят все объекты; бригадир/мастер — только привязанные к нему
  const seeAll=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("prod_head"));
  const objs=seeAll?objects:objects.filter(function(o){return getUserObjects(currentUser).includes(o.id);});
  if(!objs.length) return '<div style="text-align:center;padding:30px 16px;color:#9aabbf;font-size:13px;border:1px dashed #d0dae8;border-radius:12px;margin-top:8px">К вам пока не привязан ни один объект. Анализ появится, когда вас назначат на объект.</div>';
  const selId=(analysisObjId&&objs.some(function(o){return o.id===analysisObjId;}))?analysisObjId:objs[0].id;
  const obj=objs.find(function(o){return o.id===selId;})||objs[0];

  let html='<div>';
  html+='<div style="margin-bottom:12px"><div style="font-size:15px;font-weight:800;color:#0d1b2e">📊 Анализ стройки</div><div style="font-size:12px;color:#7a9aaa;margin-top:2px">Сколько часов и когда выполнялись работы. 🏖 — отмеченные выходные.</div></div>';
  // Выбор объекта (если их несколько у пользователя)
  if(objs.length>1){
    html+='<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">';
    objs.forEach(function(o){
      const on=o.id===obj.id;
      html+='<button data-a="analysis-obj" data-oid="'+o.id+'" style="padding:8px 12px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700;border:1.5px solid '+(on?"#2980b9":"#dde6f0")+';background:'+(on?"#2980b9":"#fff")+';color:'+(on?"#fff":"#7a9aaa")+'">'+o.icon+' '+o.name+'</button>';
    });
    html+='</div>';
  }

  // Сбор ВСЕХ работ объекта, сгруппированных по этапам (включая работы без часов)
  const rows=[]; // {type:"stage"|"work", ...}
  let hasAnyLog=false;
  (obj.stages||[]).forEach(function(s){
    const sWorks=(s.works||[]);
    rows.push({type:"stage",name:(s.n||"Этап"),color:(s.c||"#7f8c8d"),count:sWorks.length});
    sWorks.forEach(function(w){
      const logs=w.timeLogs||[];
      const byDate={};
      logs.forEach(function(l){ byDate[l.date]=(byDate[l.date]||0)+(l.hours||0); });
      const total=logs.reduce(function(a,l){return a+(l.hours||0);},0);
      if(logs.length) hasAnyLog=true;
      // День отметки «выполнено»: последний день с часами, иначе дата doneAt
      let doneDate=null;
      if(w.done){
        const logDates=Object.keys(byDate).sort();
        doneDate=logDates.length?logDates[logDates.length-1]:((w.doneAt||"").slice(0,10)||null);
      }
      rows.push({type:"work",name:(w.n||w.name||"Работа"),color:(s.c||"#7f8c8d"),byDate:byDate,total:total,done:!!w.done,doneDate:doneDate});
    });
  });
  const works=rows.filter(function(r){return r.type==="work";}); // для сумм
  // Выходные
  const dayOff={};
  (obj.dayReports||[]).forEach(function(r){ if(r.dayOff) dayOff[r.date]=true; });

  // Диапазон дат: из отметок часов + выходных + дат выполнения
  const dset={};
  works.forEach(function(w){ Object.keys(w.byDate).forEach(function(d){dset[d]=true;}); if(w.doneDate)dset[w.doneDate]=true; });
  Object.keys(dayOff).forEach(function(d){dset[d]=true;});
  let allDates=Object.keys(dset).sort();
  // Всегда включаем сегодняшний день, чтобы маркер «сегодня» был виден
  const _todayISO=new Date().toISOString().slice(0,10);
  if(allDates.length && !dset[_todayISO]){ allDates.push(_todayISO); allDates.sort(); }
  // Если часов/выходных нет — показываем шкалу на 14 дней от сегодня (чтобы все работы были видны на сетке)
  if(!allDates.length){
    const base=new Date(); base.setHours(0,0,0,0);
    allDates=[base.toISOString().slice(0,10), new Date(base.getTime()+13*86400000).toISOString().slice(0,10)];
  }
  // Полный список дней от min до max
  const days=[];
  let cur=new Date(allDates[0]+"T00:00:00");
  const end=new Date(allDates[allDates.length-1]+"T00:00:00");
  let guard=0;
  while(cur<=end&&guard<180){
    days.push(cur.toISOString().slice(0,10));
    cur=new Date(cur.getTime()+86400000);
    guard++;
  }

  // Сводка
  const totalHours=works.reduce(function(a,w){return a+w.total;},0);
  const offCount=Object.keys(dayOff).length;
  html+='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
    '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #dde6f0;border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:#9aabbf;font-weight:700">ВСЕГО ЧАСОВ</div><div style="font-size:16px;font-weight:800;color:#16a085">'+totalHours+' ч</div></div>'+
    '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #dde6f0;border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:#9aabbf;font-weight:700">ВСЕГО РАБОТ</div><div style="font-size:16px;font-weight:800;color:#2980b9">'+works.length+'</div></div>'+
    '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #dde6f0;border-radius:10px;padding:10px 12px"><div style="font-size:9px;color:#9aabbf;font-weight:700">ВЫХОДНЫХ</div><div style="font-size:16px;font-weight:800;color:#9b59b6">'+offCount+'</div></div>'+
  '</div>';

  // Диаграмма Ганта (горизонтальный + вертикальный скролл, фиксированная шапка)
  const COL=40, LABEL=130;
  const monShort=["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  const monFull=["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const wdShort=["вс","пн","вт","ср","чт","пт","сб"];
  function dCell(d){ const dt=new Date(d+"T00:00:00"); return {day:dt.getDate(),wd:wdShort[dt.getDay()],mon:monShort[dt.getMonth()],monIdx:dt.getMonth(),year:dt.getFullYear(),weekend:(dt.getDay()===0||dt.getDay()===6)}; }
  const todayISOg=new Date().toISOString().slice(0,10);

  // Группировка дней по месяцам для верхней строки
  const monthSpans=[];
  days.forEach(function(d){
    const ci=dCell(d);
    const key=ci.year+"-"+ci.monIdx;
    const last=monthSpans[monthSpans.length-1];
    if(last&&last.key===key) last.count++;
    else monthSpans.push({key:key,label:monFull[ci.monIdx]+" "+ci.year,count:1});
  });

  html+='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin:4px 0 8px">📅 ДИАГРАММА ГАНТА</div>';
  html+='<div style="overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid #dde6f0;border-radius:12px;background:#fff;max-height:70vh">';
  html+='<div style="min-width:'+(LABEL+days.length*COL)+'px">';
  // Строка месяцев (sticky сверху)
  html+='<div style="display:flex;position:sticky;top:0;z-index:6;background:#f8fafc;border-bottom:1px solid #eef2f7">';
  html+='<div style="width:'+LABEL+'px;flex-shrink:0;padding:5px 8px;font-size:10px;color:#7a9aaa;font-weight:800;background:#f8fafc;border-right:1px solid #eef2f7;position:sticky;left:0;z-index:7">📅 Месяц</div>';
  monthSpans.forEach(function(ms){
    html+='<div style="width:'+(ms.count*COL)+'px;flex-shrink:0;text-align:center;padding:5px 0;font-size:10px;font-weight:800;color:#5a7a9a;border-right:1px solid #e5ebf2;text-transform:uppercase;letter-spacing:0.5px">'+ms.label+'</div>';
  });
  html+='</div>';
  // Строка дней (sticky под месяцами)
  html+='<div style="display:flex;position:sticky;top:28px;z-index:6;border-bottom:1px solid #eef2f7;background:#f8fafc">';
  html+='<div style="width:'+LABEL+'px;flex-shrink:0;padding:6px 8px;font-size:10px;color:#9aabbf;font-weight:700;background:#f8fafc;border-right:1px solid #eef2f7;position:sticky;left:0;z-index:7">Работа</div>';
  days.forEach(function(d){
    const ci=dCell(d); const off=dayOff[d]; const isToday=d===todayISOg;
    const bg=isToday?"#2980b9":(off?"#9b59b610":(ci.weekend?"#f3f0f8":"#f8fafc"));
    const fg=isToday?"#fff":(off?"#9b59b6":"#1a2a3a");
    const fg2=isToday?"#dceaf7":(off?"#9b59b6":"#9aabbf");
    html+='<div style="width:'+COL+'px;flex-shrink:0;text-align:center;padding:4px 0;background:'+bg+';border-right:1px solid #f0f3f7">'+
      '<div style="font-size:11px;font-weight:700;color:'+fg+'">'+ci.day+'</div>'+
      '<div style="font-size:8px;color:'+fg2+'">'+(isToday?"сегодня":(off?"🏖":ci.wd))+'</div>'+
    '</div>';
  });
  html+='</div>';
  // Строки: этапы (заголовки) + все работы
  const gridW=days.length*COL;
  rows.forEach(function(r){
    if(r.type==="stage"){
      html+='<div style="display:flex;border-bottom:1px solid #eef2f7;background:'+r.color+'14">'+
        '<div style="width:'+LABEL+'px;flex-shrink:0;padding:7px 8px;border-right:1px solid #eef2f7;display:flex;align-items:center;gap:5px;position:sticky;left:0;z-index:3;background:'+r.color+'14">'+
          '<span style="width:8px;height:8px;border-radius:2px;background:'+r.color+';flex-shrink:0"></span>'+
          '<span style="font-size:10px;font-weight:800;color:'+r.color+';line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+r.name+'</span>'+
        '</div>'+
        '<div style="width:'+gridW+'px;flex-shrink:0;background:'+r.color+'08"></div>'+
      '</div>';
      return;
    }
    // работа
    html+='<div style="display:flex;border-bottom:1px solid #f4f6f9">';
    html+='<div style="width:'+LABEL+'px;flex-shrink:0;padding:7px 8px 7px 16px;background:#fff;border-right:1px solid #eef2f7;position:sticky;left:0;z-index:3">'+
      '<div style="font-size:11px;font-weight:600;color:#1a2a3a;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+r.name+'</div>'+
      '<div style="font-size:9px;font-weight:700;margin-top:2px;color:'+(r.total>0?"#16a085":(r.done?"#27ae60":"#c8d8e8"))+'">'+(r.total>0?r.total+" ч":(r.done?"✓ выполнено":"—"))+'</div>'+
    '</div>';
    days.forEach(function(d){
      const h=r.byDate[d]; const off=dayOff[d]; const doneHere=r.doneDate===d; const isToday=d===todayISOg;
      const cellBg=isToday?"#2980b90a":(off?"#9b59b608":"#fff");
      if(h){
        html+='<div style="width:'+COL+'px;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:5px 3px;background:'+cellBg+';border-right:1px solid '+(isToday?"#2980b933":"#f4f6f9")+'">'+
          '<div style="background:'+r.color+';color:#fff;border-radius:6px;font-size:10px;font-weight:700;padding:4px 0;width:100%;text-align:center;position:relative">'+h+(doneHere?'<span style="position:absolute;top:-4px;right:-2px;font-size:9px">✓</span>':'')+'</div>'+
        '</div>';
      } else if(doneHere){
        html+='<div style="width:'+COL+'px;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:5px 3px;background:'+cellBg+';border-right:1px solid '+(isToday?"#2980b933":"#f4f6f9")+'">'+
          '<div style="background:#27ae60;color:#fff;border-radius:6px;font-size:11px;font-weight:700;padding:4px 0;width:100%;text-align:center">✓</div>'+
        '</div>';
      } else {
        html+='<div style="width:'+COL+'px;flex-shrink:0;background:'+(isToday?"#2980b90a":(off?"#9b59b610":"#fff"))+';border-right:1px solid '+(isToday?"#2980b933":"#f4f6f9")+'"></div>';
      }
    });
    html+='</div>';
  });
  // Итог по дням
  html+='<div style="display:flex;border-top:2px solid #eef2f7;background:#fafbfc;position:sticky;bottom:0;z-index:4">';
  html+='<div style="width:'+LABEL+'px;flex-shrink:0;padding:7px 8px;font-size:10px;font-weight:700;color:#7a9aaa;border-right:1px solid #eef2f7;position:sticky;left:0;z-index:5;background:#fafbfc">Часов за день</div>';
  days.forEach(function(d){
    const off=dayOff[d]; const isToday=d===todayISOg;
    const dayTot=works.reduce(function(a,w){return a+(w.byDate[d]||0);},0);
    html+='<div style="width:'+COL+'px;flex-shrink:0;text-align:center;padding:6px 0;font-size:10px;font-weight:700;color:'+(off?"#9b59b6":(dayTot?"#16a085":"#c8d8e8"))+';background:'+(isToday?"#2980b912":(off?"#9b59b610":"transparent"))+';border-right:1px solid '+(isToday?"#2980b933":"#f0f3f7")+'">'+(off?"🏖":(dayTot||"·"))+'</div>';
  });
  html+='</div>';
  html+='</div></div>';
  html+='<div style="font-size:10px;color:#9aabbf;margin-top:8px">↔️ Прокрутите график вправо, чтобы увидеть все дни. Цвет блока = этап, число = часы за день, ✓ = день отметки «выполнено».</div>';
  html+='</div>';
  return html;
}

// ── ВКЛАДКА «КЛИЕНТЫ» (для менеджера по сопровождению) ──
function tClients(){
  const isAdmin=currentUser&&currentUser.roles.includes("admin");
  // Договоры, которые ведёт менеджер: где он в ответственных. Админ видит все.
  const myContracts=contractDocs.filter(function(c){
    if(isAdmin) return true;
    return (c.responsible||[]).includes(currentUser.id);
  });

  // Детальный просмотр выбранного клиента — то же, что видит сам клиент
  if(mgrClientView){
    const c=contractDocs.find(function(x){return x.id===mgrClientView;});
    if(c&&myContracts.some(function(x){return x.id===c.id;})){
      let html='<div>';
      html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'+
        '<button data-a="mgr-client-back" style="padding:6px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Клиенты</button>'+
        '<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(c.client||"Клиент")+'</div><div style="font-size:11px;color:#7a9aaa">'+c.name+'</div></div>'+
      '</div>';
      html+='<div style="background:#eef7ff;border:1px solid #c9e2f7;border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:11px;color:#2980b9">👁️ Так этот раздел видит клиент в своём кабинете</div>';
      html+=clientSubTabs(mgrClientTab,"mgr-client-tab");
      html+=clientProjectContent(c, mgrClientTab);
      html+='</div>';
      return html;
    }
    mgrClientView=null;
  }

  // Список клиентов
  const STAT={draft:{label:"Оформляется",color:"#7f8c8d"},signed:{label:"В работе",color:"#2980b9"},closed:{label:"Завершён",color:"#27ae60"}};
  let html='<div>';
  html+='<div style="margin-bottom:14px"><div style="font-size:15px;font-weight:800;color:#0d1b2e">👤 Мои клиенты</div><div style="font-size:12px;color:#7a9aaa;margin-top:2px">Клиенты, которых вы ведёте. Откройте, чтобы увидеть их кабинет.</div></div>';
  if(!myContracts.length){
    html+='<div style="text-align:center;padding:30px 16px;color:#9aabbf;font-size:13px;border:1px dashed #d0dae8;border-radius:12px">У вас пока нет клиентов. Они появятся, когда вас назначат ответственным по договору.</div>';
    html+='</div>';
    return html;
  }
  html+='<div style="display:flex;flex-direction:column;gap:8px">';
  myContracts.forEach(function(c){
    const obj=objects.find(function(o){return o.id===c.objId;});
    const st=STAT[c.status]||STAT.draft;
    const eff=effectiveClientPin(c);
    html+='<button data-a="mgr-client-open" data-cid="'+c.id+'" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1px solid #e8eef5;background:#fff;cursor:pointer;text-align:left;width:100%;box-sizing:border-box">'+
      '<div style="width:42px;height:42px;border-radius:11px;background:#27ae6015;display:flex;align-items:center;justify-content:center;font-size:21px;flex-shrink:0">'+(obj?obj.icon:"🤝")+'</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:14px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(c.client||"Клиент")+'</div>'+
        '<div style="font-size:11px;color:#7a9aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</div>'+
        '<div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap">'+
          '<span style="font-size:9px;font-weight:700;color:'+st.color+';background:'+st.color+'18;border-radius:5px;padding:1px 7px">'+st.label+'</span>'+
          (eff?'<span style="font-size:9px;font-weight:700;color:#d68910;background:#d6891015;border-radius:5px;padding:1px 7px">🔑 PIN '+eff+'</span>':'')+
        '</div>'+
      '</div>'+
      '<span style="font-size:18px;color:#c8d8e8">›</span>'+
    '</button>';
  });
  html+='</div></div>';
  return html;
}

// Содержимое подвкладок клиента (objects | contract | finance) — общее для кабинета клиента и превью менеджера
function clientProjectContent(c, activeTab){
  const obj=objects.find(function(o){return o.id===c.objId;});
  const crmCl=crmClients.find(function(x){return x.id===c.crmClientId;});
  const planIds=(crmCl&&crmCl.planIds)?crmCl.planIds:[];
  const plans=planIds.map(function(pid){return dbPlans.find(function(p){return p.id===pid;});}).filter(Boolean);
  const STAT={draft:{label:"Оформляется",color:"#7f8c8d"},signed:{label:"В работе",color:"#2980b9"},closed:{label:"Завершён",color:"#27ae60"}};
  const st=STAT[c.status]||STAT.draft;
  const dl=contractDeadlineInfo(c.deadlineDate);
  const money=function(n){return (n||0).toLocaleString("ru-RU")+" ₽";};
  const extraWorks=c.extraWorks||[];
  const extraTotal=extraWorks.reduce(function(a,w){return a+(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);},0);
  const mainTotal=c.amount||0;
  const grandTotal=mainTotal+extraTotal;
  const payments=finTxns.filter(function(t){return t.type==="income"&&(t.objId===c.objId||t.contractId===c.id);})
    .sort(function(a,b){return (a.date||"").localeCompare(b.date||"");});
  const paidTotal=payments.reduce(function(a,t){return a+(t.amount||0);},0);
  const leftTotal=Math.max(0,grandTotal-paidTotal);
  let html="";

  // ── ОБЪЕКТ ──
  if(activeTab==="objects"){
    let progressHtml="";
    if(obj&&obj.stages){
      const allW=obj.stages.flatMap(function(s){return s.works||[];});
      const doneW=allW.filter(function(w){return w.done;}).length;
      const pct=allW.length?Math.round(doneW/allW.length*100):0;
      progressHtml='<div style="margin-top:10px">'+
        '<div style="display:flex;justify-content:space-between;font-size:11px;color:#7a9aaa;margin-bottom:4px"><span>Готовность работ</span><span style="font-weight:700;color:#1a2a3a">'+pct+'%</span></div>'+
        '<div style="height:8px;background:#eef2f7;border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+(pct>=100?"#27ae60":"#2980b9")+';border-radius:4px"></div></div>'+
        '<div style="font-size:10px;color:#9aabbf;margin-top:4px">Выполнено '+doneW+' из '+allW.length+' работ</div>'+
      '</div>';
    }
    html+='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:16px;margin-bottom:12px">'+
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'+
        '<span style="font-size:32px">'+(obj?obj.icon:"🏗️")+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:17px;font-weight:700;color:#0d1b2e">'+(obj?obj.name:"Ваш проект")+'</div>'+
          '<div style="display:inline-flex;align-items:center;gap:5px;margin-top:4px;background:'+st.color+'18;border-radius:7px;padding:2px 9px"><span style="width:7px;height:7px;border-radius:50%;background:'+st.color+'"></span><span style="font-size:11px;font-weight:700;color:'+st.color+'">'+st.label+'</span></div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
        (c.signDate?'<span style="font-size:11px;color:#5a7a9a;background:#f0f4f8;border-radius:7px;padding:3px 9px">📅 Подписан: '+c.signDate+'</span>':'')+
        (c.deadlineDate?'<span style="font-size:11px;font-weight:700;color:'+(dl?dl.color:"#e67e22")+';background:'+(dl?dl.color:"#e67e22")+'15;border-radius:7px;padding:3px 9px">🏁 Срок: '+c.deadlineDate+(dl&&(dl.overdue||dl.color!=="#27ae60")?" · "+dl.label:"")+'</span>':'')+
        ((crmCl&&crmCl.phone)?'<a href="tel:'+crmCl.phone+'" onclick="window._callPhone(\''+crmCl.phone+'\',event)" style="font-size:11px;font-weight:700;color:#27ae60;background:#27ae6015;border-radius:7px;padding:3px 9px;text-decoration:none;cursor:pointer">📞 '+crmCl.phone+'</a>':'')+
      '</div>'+
      progressHtml+
    '</div>';
    html+='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin:4px 0 8px">📐 ВАШИ ПЛАНИРОВКИ</div>';
    if(plans.length){
      html+='<div style="display:flex;flex-direction:column;gap:10px">';
      plans.forEach(function(p){
        html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;overflow:hidden">'+
          (p.img?'<a href="'+p.img+'" target="_blank" rel="noopener" style="display:block"><img src="'+p.img+'" style="width:100%;max-height:260px;object-fit:contain;background:#f8fafc;display:block"></a>':'<div style="padding:30px;text-align:center;color:#c8d8e8;font-size:30px;background:#f8fafc">📐</div>')+
          '<div style="padding:10px 12px;font-size:13px;font-weight:700;color:#1a2a3a">'+(p.name||"Планировка")+'</div>'+
        '</div>';
      });
      html+='</div>';
    } else {
      html+='<div style="text-align:center;padding:24px 16px;color:#9aabbf;font-size:13px;border:1px dashed #d0dae8;border-radius:12px">Менеджер ещё не прикрепил планировки. Они появятся здесь.</div>';
    }
  }

  // ── ДОГОВОР ──
  if(activeTab==="contract"){
    const cFiles=(c.files||[]).filter(function(f){return f.kind==="contract";});
    html+='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin:0 0 8px">📄 ДОГОВОР</div>';
    if(cFiles.length){
      html+='<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">';
      cFiles.forEach(function(f){
        const isImg=(f.mime||"").indexOf("image")===0;
        html+='<div style="background:#fff;border:1px solid #dde6f0;border-radius:12px;overflow:hidden">'+
          (isImg?'<a href="'+f.data+'" target="_blank" rel="noopener" style="display:block"><img src="'+f.data+'" style="width:100%;max-height:300px;object-fit:contain;background:#f8fafc;display:block"></a>':'')+
          '<div style="display:flex;align-items:center;gap:9px;padding:10px 12px">'+
            '<span style="font-size:20px">'+(isImg?"🖼":((f.mime||"").indexOf("pdf")>=0?"📕":"📄"))+'</span>'+
            '<div style="flex:1;min-width:0;font-size:12px;font-weight:600;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+f.name+'</div>'+
            '<a href="'+f.data+'" target="_blank" rel="noopener" style="padding:6px 12px;background:#2980b918;border:1px solid #2980b944;border-radius:7px;color:#2980b9;font-size:11px;font-weight:700;text-decoration:none">Открыть</a>'+
          '</div>'+
        '</div>';
      });
      html+='</div>';
    } else {
      html+='<div style="text-align:center;padding:22px 16px;color:#9aabbf;font-size:13px;border:1px dashed #d0dae8;border-radius:12px;margin-bottom:14px">Файл договора пока не прикреплён.</div>';
    }
    html+='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin:0 0 8px">➕ ДОПОЛНИТЕЛЬНЫЕ РАБОТЫ</div>';
    if(extraWorks.length){
      html+='<div style="background:#fff;border:1px solid #dde6f0;border-radius:12px;overflow:hidden">';
      extraWorks.forEach(function(w,i){
        const wc=(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);
        html+='<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;'+(i>0?"border-top:1px solid #f0f3f7;":"")+'">'+
          '<div style="flex:1;min-width:0;font-size:13px;color:#1a2a3a">'+(w.n||w.name||"Работа")+'</div>'+
          '<div style="font-size:13px;font-weight:700;color:#0d1b2e;white-space:nowrap">'+money(wc)+'</div>'+
        '</div>';
      });
      html+='<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:2px solid #eef2f7;background:#fafbfc">'+
        '<div style="flex:1;font-size:12px;font-weight:700;color:#7a9aaa">Итого доп. работы</div>'+
        '<div style="font-size:14px;font-weight:800;color:#27ae60">'+money(extraTotal)+'</div>'+
      '</div>';
      html+='</div>';
    } else {
      html+='<div style="text-align:center;padding:22px 16px;color:#9aabbf;font-size:13px;border:1px dashed #d0dae8;border-radius:12px">Дополнительных работ нет.</div>';
    }
  }

  // ── ФИНАНСЫ ──
  if(activeTab==="finance"){
    html+='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:14px;margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0"><span style="font-size:13px;color:#5a7a9a">Основной договор</span><span style="font-size:14px;font-weight:700;color:#1a2a3a">'+money(mainTotal)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0"><span style="font-size:13px;color:#5a7a9a">Дополнительные работы</span><span style="font-size:14px;font-weight:700;color:#1a2a3a">'+money(extraTotal)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;margin-top:4px;border-top:2px solid #eef2f7"><span style="font-size:13px;font-weight:700;color:#0d1b2e">Итого к оплате</span><span style="font-size:16px;font-weight:800;color:#0d1b2e">'+money(grandTotal)+'</span></div>'+
    '</div>';
    const pct=grandTotal?Math.min(100,Math.round(paidTotal/grandTotal*100)):0;
    html+='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:14px;margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span style="color:#27ae60;font-weight:700">Оплачено: '+money(paidTotal)+'</span><span style="color:#e67e22;font-weight:700">Остаток: '+money(leftTotal)+'</span></div>'+
      '<div style="height:9px;background:#eef2f7;border-radius:5px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:#27ae60;border-radius:5px"></div></div>'+
      '<div style="text-align:center;font-size:10px;color:#9aabbf;margin-top:4px">'+pct+'% оплачено</div>'+
    '</div>';
    html+='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin:4px 0 8px">💳 ВАШИ ПЛАТЕЖИ</div>';
    if(payments.length){
      html+='<div style="display:flex;flex-direction:column;gap:8px">';
      payments.forEach(function(t){
        const ml=payMethodLabel(t.method);
        html+='<div style="background:#fff;border:1px solid #dde6f0;border-radius:12px;padding:11px 13px;display:flex;align-items:center;gap:10px">'+
          '<div style="width:34px;height:34px;border-radius:9px;background:#27ae6015;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">'+(t.method==="cash"?"💵":"🏦")+'</div>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:13px;font-weight:700;color:#1a2a3a">'+money(t.amount)+'</div>'+
            '<div style="font-size:10px;color:#9aabbf">'+(t.date||"")+(ml?' · '+ml:'')+(t.note?' · '+t.note:'')+'</div>'+
          '</div>'+
        '</div>';
      });
      html+='</div>';
    } else {
      html+='<div style="text-align:center;padding:22px 16px;color:#9aabbf;font-size:13px;border:1px dashed #d0dae8;border-radius:12px">Платежей пока нет.</div>';
    }
  }
  return html;
}
// Панель подвкладок клиента (одинаковая для клиента и менеджера)
function clientSubTabs(activeTab, action){
  const tabs=[["objects","🏗️ Объект"],["contract","📄 Договор"],["finance","💰 Финансы"]];
  return '<div style="display:flex;gap:6px;margin-bottom:14px">'+
    tabs.map(function(t){const on=activeTab===t[0];return '<button data-a="'+action+'" data-t="'+t[0]+'" style="flex:1;padding:9px 4px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700;border:1.5px solid '+(on?"#27ae60":"#dde6f0")+';background:'+(on?"#27ae60":"#fff")+';color:'+(on?"#fff":"#7a9aaa")+'">'+t[1]+'</button>';}).join("")+
  '</div>';
}

function clientPortal(){
  const c=contractDocs.find(function(x){return x.id===clientAuthContract;});
  if(!c){ clientAuthContract=null; return loginPage(); }
  let html='<div style="max-width:480px;margin:0 auto;min-height:100vh;background:#f6f8fa;padding-bottom:40px;box-sizing:border-box">';
  html+='<div style="background:#fff;border-bottom:1px solid #eef2f7;padding:12px 14px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:50">'+
    '<div style="width:34px;height:34px;border-radius:9px;background:#27ae60;display:flex;align-items:center;justify-content:center;font-size:17px">🤝</div>'+
    '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:#0d1b2e">'+(c.client||"Клиент")+'</div><div style="font-size:10px;color:#7a9aaa">'+c.name+'</div></div>'+
    '<button data-a="client-logout" style="padding:5px 10px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:11px;color:#7a9aaa">Выйти</button>'+
  '</div>';
  const tabs=[["objects","🏗️ Объект"],["contract","📄 Договор"],["finance","💰 Финансы"]];
  html+='<div style="background:#fff;border-bottom:1px solid #dde6f0;padding:8px 10px;display:flex;gap:6px;position:sticky;top:59px;z-index:49">'+
    tabs.map(function(t){const on=clientTab===t[0];return '<button data-a="client-tab" data-t="'+t[0]+'" style="flex:1;padding:9px 4px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700;border:1.5px solid '+(on?"#27ae60":"#dde6f0")+';background:'+(on?"#27ae60":"#fff")+';color:'+(on?"#fff":"#7a9aaa")+'">'+t[1]+'</button>';}).join("")+
  '</div>';
  html+='<div style="padding:14px">'+clientProjectContent(c, clientTab)+'</div></div>';
  return html;
}

function render(){
  scheduleSave();   // любая мутация состояния через render() → debounced автосейв (с dirty-check)
  // Авто: все «Менеджеры по договорам» — ответственные по каждому договору
  const escortIds=users.filter(function(u){return u.roles.includes("contract_mgr");}).map(function(u){return u.id;});
  contractDocs=contractDocs.map(function(c){
    const resp=c.responsible||[];
    const merged=[...new Set(resp.concat(escortIds))];
    return merged.length!==resp.length?Object.assign({},c,{responsible:merged}):c;
  });
  const a=document.getElementById("app");
  if(!a)return;
  // Кабинет клиента
  if(clientAuthContract){
    a.innerHTML=clientPortal();
    const lo=a.querySelector("[data-a='client-logout']");
    if(lo)lo.onclick=function(){ clientAuthContract=null; loginMode=null; clientTab="objects"; render(); };
    a.querySelectorAll("[data-a='client-tab']").forEach(function(b){
      b.onclick=function(){ clientTab=b.dataset.t; render(); };
    });
    return;
  }
  if(!currentUser){ a.innerHTML=loginPage(); bindLogin(); return; }
  // Запоминаем позицию прокрутки ленты вкладок до перерисовки,
  // иначе при клике по крайним вкладкам («Команда»/«Маркетинг») лента прыгает влево.
  const _tabsScrollPrev=(function(){const e=document.getElementById("tabs-scroll");return e?e.scrollLeft:null;})();
  // Был ли фокус в поле поиска до перерисовки — чтобы не выдёргивать клавиатуру при открытии вкладки
  const _prevActiveId=(document.activeElement&&document.activeElement.id)||"";
  a.innerHTML=page();
  // Восстанавливаем прокрутку ленты вкладок, чтобы экран не «дёргался».
  if(_tabsScrollPrev!=null){const e=document.getElementById("tabs-scroll");if(e)e.scrollLeft=_tabsScrollPrev;}
  // Material picker modal overlay
  if(ctMatPicker){
    const objId=ctMatPicker.cid==="__new"?contractNew.objId:(contractDocs.find(function(x){return x.id===ctMatPicker.cid;})||{}).objId;
    const obj=objects.find(function(o){return o.id===objId;});
    if(obj){
      const allMats=obj.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});});
      const uniqMap={};
      allMats.forEach(function(m){if(!uniqMap[m.id])uniqMap[m.id]=m;});
      const uniqMats=Object.values(uniqMap);
      const q=(ctMatPicker.search||"").trim().toLowerCase();
      const filtered=q?uniqMats.filter(function(m){return m.name.toLowerCase().includes(q);}):uniqMats;

      let modal='<div id="ct-mat-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:flex-end;justify-content:center;padding:0">';
      modal+='<div style="background:#fff;width:100%;max-width:500px;max-height:80vh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;overflow:hidden">';
      modal+='<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e8eef5">'+
        '<div><div style="font-size:14px;font-weight:700;color:#1a2a3a">📦 Материал из базы</div><div style="font-size:11px;color:#7a9aaa">'+obj.icon+' '+obj.name+' · '+uniqMats.length+' материалов</div></div>'+
        '<button data-a="ct-mat-close" style="padding:6px 12px;background:#f0f4f8;border:none;border-radius:8px;cursor:pointer;font-size:13px;color:#7a9aaa;font-weight:600">✕</button>'+
      '</div>';
      modal+='<div style="padding:10px 16px"><input id="ct-mat-search" value="'+(ctMatPicker.search||"")+'" placeholder="🔍 Поиск материала..." style="width:100%;padding:9px 12px;border-radius:8px;border:1.5px solid #27ae6044;font-size:13px;outline:none;box-sizing:border-box"></div>';
      modal+='<div style="flex:1;overflow-y:auto;padding:0 8px 12px">';
      if(!filtered.length){
        modal+='<div style="padding:20px;text-align:center;font-size:12px;color:#aaa">Ничего не найдено</div>';
      } else {
        filtered.forEach(function(m){
          modal+='<div data-a="ct-mat-pick" data-mid="'+m.id+'" style="display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:8px;cursor:pointer;margin-bottom:3px;background:#fafbfc;border:1px solid #f0f3f7">'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:12px;font-weight:600;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+m.name+'</div>'+
            '</div>'+
            '<div style="font-size:13px;font-weight:700;color:#27ae60;white-space:nowrap">'+fmt(m.cost*(m.qty||1))+' ₽</div>'+
          '</div>';
        });
      }
      modal+='</div></div></div>';
      a.insertAdjacentHTML("beforeend",modal);
    }
  }
  bind();
  // Material picker search input
  if(ctMatPicker){
    const ms=document.getElementById("ct-mat-search");
    if(ms){ms.oninput=function(){ctMatPicker.search=this.value;render();};}
  }
  if((tab==="assign"||tab==="templates")&&!openTemplate)renderTplCards();
  if(tab==="contracts"&&(contractView||contractAddForm)){
    ["ct-client-search","ct-edit-client-search"].forEach(function(id){
      const si=document.getElementById(id);
      if(si){
        si.oninput=function(){ctClientSearch=this.value;render();};
      }
    });
    if(window._ctBindPickers){
      window._ctBindPickers();
      setTimeout(window._ctBindPickers, 50);
    }
  }
  if(tab==="supply"&&window._supplyViewing){
    const si=document.getElementById("supply-search-input");
    if(si){
      si.oninput=function(){supplySearch=this.value;render();};
      // Keep focus and cursor position
      si.focus();
      const len=si.value.length;
      si.setSelectionRange(len,len);
    }
  }
  if(tab==="works"){
    renderDBLists();
    // Toggle visibility AFTER both divs are filled
    const wl=document.getElementById("dbworks-list-wrap");
    const ml=document.getElementById("dbmats-list-wrap");
    const pl=document.getElementById("dbplans-list-wrap");
    const ex=document.getElementById("dbexp-list-wrap");
    if(wl)wl.style.display=dbSection==="works"?"block":"none";
    if(ml)ml.style.display=dbSection==="mats"?"block":"none";
    if(pl)pl.style.display=dbSection==="plans"?"block":"none";
    if(ex)ex.style.display="none";
    const esW=document.getElementById("dbest-list-wrap");
    if(esW)esW.style.display=dbSection==="est"?"block":"none";
  }
  // Always rebind client pickers after any render
  if(window._ctBindPickers)setTimeout(window._ctBindPickers,0);
  if(window._bindMoneyInputs)window._bindMoneyInputs();
  // Поиск материала в сборщике шаблона: держим фокус, чтобы не закрывалась клавиатура
  const _tps=document.getElementById("tpl-pick-search");
  if(_tps){ _tps.oninput=function(){tplPickSearch=this.value;render();}; _tps.focus(); const _L=_tps.value.length; try{_tps.setSelectionRange(_L,_L);}catch(e){} }
  if(window._bindPhoneInputs)window._bindPhoneInputs();
}

function page(){
  const isAdmin=currentUser&&currentUser.roles.includes("admin");
  const isSupplyOnly=currentUser&&currentUser.roles.includes("supply")&&!isAdmin;
  const isBrigWorker=currentUser&&currentUser.roles.some(function(r){return r==="brigadier"||r==="worker";})&&!isAdmin;
    // Admin tab order (draggable)
    if(!window._adminTabs) window._adminTabs=[
      ["assign","🏗️ Объекты"],
      ["analysis","📊 Анализ стройки"],
      ["supply","📦 Снабжение"],
      ["finance","💰 Финансы"],
      ["contracts","📄 Договора"],
      ["crm","🤝 CRM-клиенты"],
      ["clients","👤 Клиенты"],
      ["works","🗄️ База данных"],
      ["team","👥 Команда"],
      ["marketing","📣 Маркетинг"],
    ];
    // Подстраховка: дописываем вкладки из TAB_DEFS, которых нет в сохранённом порядке
    TAB_DEFS.forEach(function(t){
      if(!window._adminTabs.some(function(x){return x[0]===t.k;})) window._adminTabs.push([t.k,t.n]);
    });
    const ALL_TABS=window._adminTabs;
  // Build tabs based on ALL roles the user has
  let TABS;
  if(isAdmin){
    TABS=ALL_TABS;
  } else {
    // Доступ к вкладкам собирается из настраиваемых разрешений ролей (rolePermissions).
    const tabSet=new Set();
    const r=currentUser?currentUser.roles:[];
    r.forEach(function(rid){
      (rolePermissions[rid]||[]).forEach(function(k){tabSet.add(k);});
    });
    TABS=ALL_TABS.filter(([k])=>tabSet.has(k));
    if(!TABS.length) TABS=[["assign","🏗️ Объекты"]];
  }
  const SC={"Озон":"#005bff","Белка":"#d68910","pechki.su":"#c0392b","Егорьевск":"#8e44ad","Лемана":"#e30613","Авито":"#00aaff","Нижний Новгород":"#27ae60"};
  return`<div style="max-width:480px;margin:0 auto;min-height:100vh;background:#f6f8fa;padding-bottom:80px;box-sizing:border-box">
<div style="background:#fff;border-bottom:1px solid #eef2f7;padding:10px 14px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:50">
  <div style="width:32px;height:32px;border-radius:8px;background:${currentUser.c};display:flex;align-items:center;justify-content:center;font-size:16px">${currentUser.av}</div>
  <div style="flex:1;min-width:0">
    <div style="font-size:13px;font-weight:700;color:#0d1b2e">${currentUser.name}</div>
    <div style="font-size:10px;color:#7a9aaa">${currentUser.roles.map(rid=>{const r=roles.find(x=>x.id===rid);return r?r.n:"";}).filter(Boolean).join(", ")}</div>
  </div>
  <button data-a="pin-change-open" title="Сменить PIN" style="width:30px;height:30px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:13px;color:#7a9aaa;flex-shrink:0">🔑</button>
  <button data-a="logout" style="padding:5px 10px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:11px;color:#7a9aaa">Выйти</button>
</div>
${showPinChange?`<div style="background:#fff;border-bottom:1px solid #eef2f7;padding:14px;position:sticky;top:53px;z-index:48;box-shadow:0 4px 10px rgba(0,0,0,0.05)">
  <div style="max-width:340px;margin:0 auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:#0d1b2e">🔑 Пароль входа (PIN)</div>
      <button data-a="pin-change-close" style="width:26px;height:26px;background:#f0f4f8;border:1px solid #dde6f0;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
    </div>
    <div style="font-size:11px;color:#7a9aaa;margin-bottom:10px">Меняется только ваш PIN для входа. По умолчанию 1111.</div>
    <input id="pin-cur" type="password" inputmode="numeric" maxlength="6" placeholder="Текущий PIN" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:7px">
    <input id="pin-new" type="password" inputmode="numeric" maxlength="6" placeholder="Новый PIN (мин. 4 цифры)" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:7px">
    <input id="pin-new2" type="password" inputmode="numeric" maxlength="6" placeholder="Повторите новый PIN" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:10px">
    <button data-a="pin-change-save" style="width:100%;padding:10px;background:#27ae60;border:none;border-radius:9px;cursor:pointer;color:#fff;font-size:13px;font-weight:700">Сохранить PIN</button>
  </div>
</div>`:""}
<div style="background:linear-gradient(180deg,#fff 0%,#f8fafc 100%);border-bottom:1px solid #dde6f0;padding:8px 0;position:sticky;top:53px;z-index:49;box-shadow:0 2px 4px rgba(0,0,0,0.04)">
  <div style="display:flex;overflow-x:auto;padding:0 10px;scrollbar-width:none;-webkit-overflow-scrolling:touch;gap:6px" id="tabs-scroll">
  ${TABS.map(([k,n],i)=>{
    const active=tab===k;
    const tabBtn=`<button data-a="tab" data-k="${k}" style="flex-shrink:0;padding:9px 14px;border:none;border-radius:10px;background:${active?"#2980b9":"#f0f4f8"};cursor:pointer;font-size:12.5px;font-weight:${active?700:600};color:${active?"#fff":"#5a7080"};white-space:nowrap;box-shadow:${active?"0 2px 8px rgba(41,128,185,0.3)":"none"};transition:all 0.15s;letter-spacing:0.2px">${n}</button>`;
    return isAdmin
      ? `<div draggable="true" data-a="tab-drag" data-k="${k}" data-i="${i}" style="flex-shrink:0;cursor:grab">${tabBtn}</div>`
      : tabBtn;
  }).join("")}
  </div>
  ${TABS.length>4?`<div style="font-size:9px;color:#9aabbf;text-align:center;margin-top:4px;letter-spacing:0.5px">← смахни для других вкладок →</div>`:""}
</div>
<div style="padding:14px">
  ${tab==="assign"?tObjects():tab==="analysis"?tBuildAnalysis():tab==="supply"?tSupply():tab==="finance"?tFinance():tab==="contracts"?tContracts():tab==="works"?tWorks():tab==="team"?tTeam():tab==="marketing"?tMarketing():tab==="clients"?tClients():tCRM()}
</div>
<div id="save-toast" style="position:fixed;bottom:24px;right:24px;background:#27ae60;color:#fff;border-radius:12px;padding:10px 18px;font-size:13px;font-weight:700;box-shadow:0 4px 16px rgba(39,174,96,0.35);opacity:0;transform:translateY(8px);transition:opacity 0.2s,transform 0.2s;pointer-events:none;z-index:999">✓ Сохранено</div>
</div>`;
}

function renderObjCard(obj, isAdmin){
  const allWorks=obj.stages.flatMap(function(s){return s.works;});
  const allMats=allWorks.flatMap(function(w){return w.mats||[];});
  const totalCost=allWorks.reduce(function(a,w){return a+w.cost;},0);
  const st=getMatStatus(allMats);
  const pct=st?Math.round(st.done/st.total*100):0;

  let html='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;overflow:hidden">';
  // Header
  html+='<div style="padding:14px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #f0f4f8">';
  html+='<span style="font-size:28px;flex-shrink:0">'+obj.icon+'</span>';
  html+='<div style="flex:1;min-width:0">';
  html+='<div style="font-size:15px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+obj.name+'</div>';
  html+='<div style="font-size:11px;color:#7a9aaa;margin-top:2px">'+allWorks.length+' работ · '+allMats.length+' материалов · '+fmt(totalCost)+'</div>';
  // Дедлайн от начальника производства (из договоров объекта)
  (function(){
    const objContracts=contractDocs.filter(function(d){return d.objId===obj.id;});
    let info=null;
    const meIsProd=currentUser&&currentUser.roles.some(function(r){return r==="brigadier"||r==="worker";})&&!isAdmin;
    if(meIsProd){
      // Мой дедлайн по этому объекту
      for(const c of objContracts){ const i=getBrigadierDeadlineInfo(c,currentUser.id); if(i.hasDeadline){info=i;break;} }
    } else {
      // Ближайший дедлайн любого бригадира по объекту
      const cand=[];
      objContracts.forEach(function(c){
        Object.keys(c.deadlines||{}).forEach(function(uid){
          const i=getBrigadierDeadlineInfo(c,uid);
          if(i.hasDeadline)cand.push(i);
        });
      });
      cand.sort(function(a,b){return (a.deadline||"").localeCompare(b.deadline||"");});
      info=cand[0]||null;
    }
    if(info&&info.hasDeadline){
      // Календарные дни между сегодня и дедлайном
      const _today=new Date(todayISO()+"T00:00:00");
      const _dl=new Date(info.deadline+"T00:00:00");
      const calDiff=Math.round((_dl-_today)/86400000);
      const calLeft=calDiff>=0?calDiff:0;
      const calOverdue=calDiff<0?-calDiff:0;
      const color=calOverdue>0?"#e74c3c":(calLeft<=5?"#f39c12":"#27ae60");
      let lbl;
      if(calOverdue>0){
        lbl="🔴 просрочка "+calOverdue+" дн";
      } else if(calLeft<=5){
        lbl="🟡 осталось "+calLeft+" дн";
      } else {
        lbl="🟢 осталось "+calLeft+" дн";
      }
      const calFine=calOverdue*FINE_PER_DAY;
      html+='<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:5px">'+
        '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;color:'+color+';background:'+color+'15;border-radius:6px;padding:2px 8px">🏁 Дедлайн: '+info.deadline+' · '+lbl+'</span>'+
        (calOverdue>0?'<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#e74c3c;background:#e74c3c15;border-radius:6px;padding:2px 8px">⚠️ Штраф: '+calFine.toLocaleString("ru-RU")+' ₽ ('+FINE_PER_DAY.toLocaleString("ru-RU")+' ₽/день)</span>':'')+
      '</div>';
    }
  })();
  html+='</div>';
  html+='<button data-a="open-obj" data-oid="'+obj.id+'" style="padding:7px 14px;background:#e8f0fa;border:1px solid #4a7ac844;border-radius:8px;cursor:pointer;font-size:12px;color:#2a5298;font-weight:600;flex-shrink:0;white-space:nowrap">✏️ Открыть</button>';
  html+='</div>';
  // Purchase progress with money amounts
  if(st){
    const matsTotalCost=allMats.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
    const matsBoughtCost=allMats.filter(function(m){return!!purchased[m.id];}).reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
    const matsLeftCost=matsTotalCost-matsBoughtCost;
    html+='<div style="padding:8px 16px 10px;border-top:1px solid #f4f6f9">';
    // Top row: label + pct
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
    html+='<span style="font-size:10px;font-weight:700;color:'+st.color+';letter-spacing:0.3px">📦 ЗАКУПКА</span>';
    html+='<span style="font-size:10px;color:'+st.color+';font-weight:700">'+pct+'%</span>';
    html+='</div>';
    // Progress bar
    html+='<div style="background:#e8eef5;border-radius:6px;height:5px;overflow:hidden;margin-bottom:8px">';
    html+='<div style="height:100%;border-radius:6px;background:'+st.color+';width:'+pct+'%;transition:width 0.3s"></div>';
    html+='</div>';
    // Money row
    html+='<div style="display:flex;gap:6px">';
    html+='<div style="flex:1;background:'+st.color+'10;border:1px solid '+st.color+'33;border-radius:8px;padding:6px 10px;text-align:center">';
    html+='<div style="font-size:11px;font-weight:700;color:'+st.color+'">'+(matsBoughtCost>0?matsBoughtCost.toLocaleString("ru-RU")+' ₽':'—')+'</div>';
    html+='<div style="font-size:9px;color:#9aabbf;margin-top:1px">куплено</div>';
    html+='</div>';
    html+='<div style="flex:1;background:'+(matsLeftCost===0?st.color+'10':'#fdf0f0')+';border:1px solid '+(matsLeftCost===0?st.color+'33':'#e74c3c33')+';border-radius:8px;padding:6px 10px;text-align:center">';
    html+='<div style="font-size:11px;font-weight:700;color:'+(matsLeftCost===0?st.color:'#e74c3c')+'">'+(matsLeftCost>0?matsLeftCost.toLocaleString("ru-RU")+' ₽':'✓')+'</div>';
    html+='<div style="font-size:9px;color:#9aabbf;margin-top:1px">'+(matsLeftCost===0?'готово':'осталось')+'</div>';
    html+='</div>';
    html+='<div style="flex:1;background:#f0f4f8;border-radius:8px;padding:6px 10px;text-align:center">';
    html+='<div style="font-size:11px;font-weight:600;color:#5a7a9a">'+matsTotalCost.toLocaleString("ru-RU")+' ₽</div>';
    html+='<div style="font-size:9px;color:#9aabbf;margin-top:1px">всего</div>';
    html+='</div>';
    html+='</div>';
    html+='</div>';
  }
  // Team row (admin only)
  html+=buildTeamRow(obj.id, isAdmin);
  html+='</div>';
  return html;
}


function buildTeamRow(oid, isAdmin){
  // Team assignment moved to Contracts tab — no longer shown on object cards
  return '';
}

// ── СВОДКА: сделанные работы + затраченное время по объекту ──
// Показывается всем, кто видит объект. Учитывает ТОЛЬКО выполненные работы (w.done).
// Время сводится двумя способами: по исполнителям и по этапам.
function buildWorkSummary(obj){
  if(!obj||!obj.stages) return '';
  // Собираем выполненные работы по этапам
  const stageRows=[];          // [{name,color,count,cost,hours}]
  const userHours={};          // {userId: hours}  — суммарные часы по timeLogs всех ВЫПОЛНЕННЫХ работ
  let totalDone=0, totalCost=0, totalHours=0;

  obj.stages.forEach(function(st){
    let sCount=0, sCost=0, sHours=0;
    (st.works||[]).forEach(function(w){
      if(!w.done) return;                       // только выполненные
      sCount++; totalDone++;
      sCost+=(w.cost||0); totalCost+=(w.cost||0);
      (w.timeLogs||[]).forEach(function(l){
        const h=l.hours||0;
        sHours+=h; totalHours+=h;
        userHours[l.userId]=(userHours[l.userId]||0)+h;
      });
    });
    if(sCount>0){
      stageRows.push({name:st.n,color:st.c||'#7f8c8d',count:sCount,cost:sCost,hours:sHours});
    }
  });

  // Если нет ни одной выполненной работы — компактная заглушка
  if(totalDone===0){
    return '<div style="background:#fff;border-radius:14px;border:1px dashed #d0dae8;padding:16px;margin-bottom:14px;text-align:center">'+
      '<div style="font-size:11px;color:#16a085;font-weight:700;letter-spacing:1px;margin-bottom:4px">✅ СДЕЛАННЫЕ РАБОТЫ</div>'+
      '<div style="font-size:12px;color:#9aabbf">Пока нет выполненных работ. Отметьте работы галочкой ✓ в перечне ниже.</div>'+
    '</div>';
  }

  // Список исполнителей с часами (по убыванию)
  const userRows=Object.keys(userHours).map(function(uid){
    const u=users.find(function(x){return x.id===uid;});
    return {u:u,hours:userHours[uid]};
  }).filter(function(r){return r.u;}).sort(function(a,b){return b.hours-a.hours;});

  let h='<div style="background:linear-gradient(135deg,#fff,#fafbfc);border-radius:14px;border:1.5px solid #16a08533;padding:14px 16px;margin-bottom:14px;box-shadow:0 2px 6px rgba(22,160,133,0.06)">';
  // Header + сводные KPI
  h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
       '<div style="font-size:11px;color:#16a085;font-weight:700;letter-spacing:1px">✅ СДЕЛАННЫЕ РАБОТЫ И ВРЕМЯ</div>'+
     '</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:12px">'+
       '<div style="background:#27ae6010;border:1px solid #27ae6033;border-radius:9px;padding:8px 6px;text-align:center"><div style="font-size:9px;color:#9aabbf;font-weight:700">ВЫПОЛНЕНО</div><div style="font-size:16px;font-weight:700;color:#27ae60">'+totalDone+'</div><div style="font-size:9px;color:#9aabbf">работ</div></div>'+
       '<div style="background:#16a08510;border:1px solid #16a08533;border-radius:9px;padding:8px 6px;text-align:center"><div style="font-size:9px;color:#9aabbf;font-weight:700">ЧАСОВ</div><div style="font-size:16px;font-weight:700;color:#16a085">'+totalHours+'</div><div style="font-size:9px;color:#9aabbf">отмечено</div></div>'+
       '<div style="background:#2980b910;border:1px solid #2980b933;border-radius:9px;padding:8px 6px;text-align:center"><div style="font-size:9px;color:#9aabbf;font-weight:700">СУММА</div><div style="font-size:14px;font-weight:700;color:#2980b9">'+totalCost.toLocaleString("ru-RU")+'</div><div style="font-size:9px;color:#9aabbf">₽ работ</div></div>'+
     '</div>';

  // ── По исполнителям ──
  if(userRows.length){
    h+='<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">👷 ВРЕМЯ ПО ИСПОЛНИТЕЛЯМ</div>';
    userRows.forEach(function(r){
      const pct=totalHours>0?Math.round(r.hours/totalHours*100):0;
      h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0">'+
           '<span style="font-size:16px">'+r.u.av+'</span>'+
           '<div style="flex:1;min-width:0">'+
             '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">'+
               '<span style="font-size:12px;font-weight:700;color:#1a2a3a">'+r.u.name+'</span>'+
               '<span style="font-size:11px;font-weight:700;color:#16a085">'+r.hours+' ч</span>'+
             '</div>'+
             '<div style="height:5px;background:#eef2f7;border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+r.u.c+';border-radius:3px"></div></div>'+
           '</div>'+
         '</div>';
    });
  }

  // ── По этапам ──
  if(stageRows.length){
    h+='<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin:10px 0 6px">📋 ПО ЭТАПАМ</div>';
    stageRows.forEach(function(sr){
      h+='<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:'+sr.color+'08;border:1px solid '+sr.color+'22;border-radius:8px;margin-bottom:4px">'+
           '<div style="width:8px;height:8px;border-radius:50%;background:'+sr.color+';flex-shrink:0"></div>'+
           '<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+sr.name+'</div></div>'+
           '<span style="font-size:10px;color:#27ae60;font-weight:700;white-space:nowrap">✓ '+sr.count+'</span>'+
           '<span style="font-size:10px;color:#16a085;font-weight:700;white-space:nowrap;min-width:38px;text-align:right">'+sr.hours+' ч</span>'+
           '<span style="font-size:10px;color:#7a9aaa;white-space:nowrap;min-width:64px;text-align:right">'+sr.cost.toLocaleString("ru-RU")+' ₽</span>'+
         '</div>';
    });
  }

  h+='</div>';
  return h;
}

function getMatStatus(mats){
  if(!mats||mats.length===0)return null;
  const done=mats.filter(function(m){return!!purchased[m.id];}).length;
  const total=mats.length;
  if(done===0)return{done,total,color:"#e74c3c",bg:"#fdf0f0",label:"Не куплено"};
  if(done===total)return{done,total,color:"#27ae60",bg:"#f0fdf4",label:"Куплено"};
  return{done,total,color:"#f39c12",bg:"#fffbf0",label:"Частично"};
}

function tObjects(){
  const isAdmin=currentUser&&currentUser.roles.includes("admin");
  const isBrigWorker=currentUser&&currentUser.roles.some(function(r){return r==="brigadier"||r==="worker";})&&!isAdmin;
  if(openObject){
    const obj=objects.find(x=>x.id===openObject);
    if(!obj)return"";
    const allWorks=obj.stages.flatMap(s=>s.works);
    const totalCost=allWorks.reduce((a,w)=>a+w.cost,0);
    const assigned=users.filter(u=>u.objs.includes(obj.id));
    return`<div>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
  <button data-a="close-obj" style="padding:7px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Объекты</button>
  <div style="flex:1"></div>
  ${isAdmin?`<button data-a="del-obj" data-oid="${obj.id}" style="padding:6px 12px;background:transparent;border:1px solid #e74c3c44;border-radius:8px;cursor:pointer;font-size:11px;color:#e74c3c">🗑 Удалить объект</button>`:""}
</div>

<!-- Заголовок объекта -->
<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:16px;margin-bottom:14px">
  ${isAdmin?`
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
    <select id="obj-icon-${obj.id}" style="padding:4px 2px;border-radius:8px;border:1px solid #d0dae8;font-size:22px;outline:none;cursor:pointer;flex-shrink:0;width:54px;text-align:center">
      ${["🛁","🏠","🌾","🏗️","🏡","🏘️","🏢","🔨","⚡","🌊"].map(i=>`<option value="${i}" ${obj.icon===i?"selected":""}>${i}</option>`).join("")}
    </select>
    <input id="obj-name-${obj.id}" value="${obj.name}" style="flex:1;min-width:0;padding:9px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:15px;font-weight:700;outline:none;color:#0d1b2e">
    <button data-a="save-obj-info" data-oid="${obj.id}" style="width:42px;height:42px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:18px;font-weight:700;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0">💾</button>
  </div>`:`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
    <span style="font-size:32px">${obj.icon}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:18px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${obj.name}</div>
    </div>
  </div>`}
  <div style="font-size:12px;color:#7a9aaa;margin-bottom:12px">
    ${allWorks.length} работ · ${fmt(totalCost)}
  </div>

  <!-- Сотрудники: только те, кто назначен в договорах этого объекта -->
  ${(()=>{
    // Get all users who are responsible in any active contract on this object
    const objContracts=contractDocs.filter(d=>d.objId===obj.id&&(d.status==="signed"||d.status==="closed"));
    const assignedIds=new Set();
    objContracts.forEach(d=>(d.responsible||[]).forEach(uid=>assignedIds.add(uid)));
    const assignedUsers=users.filter(u=>assignedIds.has(u.id));

    if(!assignedUsers.length){
      return `<div style="background:#f8fafc;border:1px dashed #c8d8e8;border-radius:12px;padding:14px;text-align:center;font-size:11px;color:#9aabbf">
        Никто не назначен. Назначение делается во вкладке <b style="color:#5a7080">📄 Договора</b> — ответственные за договор автоматически появятся здесь.
      </div>`;
    }

    return `<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:0.8px;margin-bottom:8px">КОМАНДА НА ОБЪЕКТЕ · ${assignedUsers.length} ${assignedUsers.length===1?"человек":"чел"}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${assignedUsers.map(u=>{
        // Show role on this object (first matching contract role)
        const userRoles=u.roles.map(rid=>{const r=roles.find(x=>x.id===rid);return r?r.n:"";}).filter(Boolean);
        const primaryRole=userRoles[0]||"";
        return `<div style="display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:18px;background:${u.c}15;border:1.5px solid ${u.c}55">
          <span style="font-size:14px">${u.av}</span>
          <div style="display:flex;flex-direction:column;line-height:1.1">
            <span style="font-size:11px;font-weight:700;color:#1a2a3a">${u.name}</span>
            <span style="font-size:9px;color:${u.c}">${primaryRole}</span>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div style="font-size:9px;color:#9aabbf;margin-top:8px;font-style:italic">💡 Управляется через вкладку «Договора»</div>`;
  })()}
</div>

<!-- Отчёт дня (только для производства — бригадир/мастер/нач.пр./админ) -->
${(()=>{
  if(!currentUser)return "";
  const isProd=currentUser.roles.some(r=>["brigadier","worker","prod_head"].includes(r));
  const isAdmin=currentUser.roles.includes("admin")||currentUser.roles.includes("financier");
  if(!isProd&&!isAdmin)return "";
  // Check if current user is responsible on this object
  const objContractsAll=contractDocs.filter(d=>d.objId===obj.id&&(d.status==="signed"||d.status==="closed"));
  const respIds=new Set();
  objContractsAll.forEach(d=>(d.responsible||[]).forEach(uid=>respIds.add(uid)));
  if(isProd&&!respIds.has(currentUser.id))return "";
  
  const todayISOd=new Date().toISOString().slice(0,10);
  const todayLabel=new Date().toLocaleDateString("ru-RU",{day:"2-digit",month:"long",weekday:"long"});
  
  // For admin — show today's report for all prod users; for prod — show their own
  let viewUsers=[];
  if(isAdmin&&!isProd){
    viewUsers=users.filter(u=>respIds.has(u.id)&&u.roles.some(r=>["brigadier","worker","prod_head"].includes(r)));
  } else {
    viewUsers=[currentUser];
  }
  
  let out='<div style="background:linear-gradient(135deg,#fff,#fafbfc);border-radius:14px;border:1.5px solid #2980b933;padding:14px 16px;margin-bottom:14px;box-shadow:0 2px 6px rgba(41,128,185,0.06)">';
  out+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  out+='<div><div style="font-size:11px;color:#2980b9;font-weight:700;letter-spacing:1px">📋 ОТЧЁТ ДНЯ</div><div style="font-size:10px;color:#9aabbf;margin-top:2px">'+todayLabel+'</div></div>';
  out+='<div style="font-size:13px;font-weight:800;color:#27ae60">+'+CLEANUP_BONUS+' ₽</div>';
  out+='</div>';
  
  viewUsers.forEach(function(u){
    const report=getTodayReport(obj,u.id,todayISOd);
    const isOff=report&&report.dayOff;
    const cleanupPhotos=(report&&report.cleanupPhotos)||[];
    const bonusPaid=getCleanupBonusPaid(obj.id,u.id,todayISOd);
    const canEdit=isAdmin||u.id===currentUser.id;
    const completedWorks=(obj.stages||[]).reduce(function(a,st){return a+(st.works||[]).filter(function(w){
      return w.done&&w.doneBy===u.id&&(w.doneAt||"").indexOf(todayISOd)===0;
    }).length;},0);
    const hoursToday=(obj.stages||[]).reduce(function(a,st){return a+(st.works||[]).reduce(function(b,w){
      return b+(w.timeLogs||[]).filter(function(l){return l.userId===u.id&&l.date===todayISOd;}).reduce(function(c,l){return c+(l.hours||0);},0);
    },0);},0);
    
    out+='<div style="background:#fafbfc;border-radius:10px;border:1px solid #e5ebf2;padding:10px 12px;margin-bottom:6px">';
    out+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">';
    out+='<span style="font-size:18px">'+u.av+'</span>';
    out+='<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;color:#1a2a3a">'+u.name+(u.id===currentUser.id?' (вы)':'')+'</div>';
    if(isOff){
      out+='<div style="font-size:10px;color:#9b59b6;font-weight:600;margin-top:1px">🏖 Выходной</div>';
    } else if(cleanupPhotos.length>0){
      out+='<div style="font-size:10px;color:#27ae60;font-weight:600;margin-top:1px">✓ Отчёт сдан · '+cleanupPhotos.length+' фото</div>';
    } else {
      out+='<div style="font-size:10px;color:#9aabbf;font-style:italic;margin-top:1px">Отчёт не сдан</div>';
    }
    out+='</div>';
    out+='</div>';
    
    // Quick day stats
    if(!isOff){
      out+='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:9px">';
      out+='<div style="background:#fff;border:1px solid #e5ebf2;border-radius:6px;padding:7px 9px"><div style="font-size:9px;color:#9aabbf;font-weight:700">⏱ ЧАСОВ ОТМЕЧЕНО</div><div style="font-size:14px;color:#16a085;font-weight:700">'+hoursToday+' ч</div></div>';
      out+='<div style="background:#fff;border:1px solid #e5ebf2;border-radius:6px;padding:7px 9px"><div style="font-size:9px;color:#9aabbf;font-weight:700">✓ ВЫПОЛНЕНО РАБОТ</div><div style="font-size:14px;color:#27ae60;font-weight:700">'+completedWorks+'</div></div>';
      out+='</div>';
    }
    
    if(canEdit&&!isOff){
      // Cleanup photos block
      out+='<div style="background:#fff;border:1px dashed #27ae6055;border-radius:8px;padding:8px;margin-bottom:6px">';
      out+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">';
      out+='<div style="font-size:10px;color:#27ae60;font-weight:700">🧹 ФОТО УБОРКИ МЕСТА</div>';
      if(bonusPaid>0){
        out+='<div style="font-size:10px;color:#27ae60;font-weight:700;background:#27ae6018;padding:3px 8px;border-radius:5px">✓ Премия +'+bonusPaid+' ₽</div>';
      } else if(cleanupPhotos.length>0){
        out+='<div style="font-size:10px;color:#f39c12;font-weight:700;background:#f39c1218;padding:3px 8px;border-radius:5px">⏳ Премия начисляется...</div>';
      }
      out+='</div>';
      if(cleanupPhotos.length){
        out+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:6px">';
        cleanupPhotos.forEach(function(p){
          out+='<div style="position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;border:1px solid #27ae6055">';
          out+='<img src="'+p.data+'" style="width:100%;height:100%;object-fit:cover" alt="">';
          if(canEdit){
            out+='<button data-a="dr-del-cleanup" data-oid="'+obj.id+'" data-uid="'+u.id+'" data-date="'+todayISOd+'" data-pid="'+p.id+'" style="position:absolute;top:2px;right:2px;width:20px;height:20px;background:rgba(231,76,60,0.9);border:none;border-radius:4px;cursor:pointer;color:#fff;font-size:10px">✕</button>';
          }
          out+='</div>';
        });
        out+='</div>';
      }
      out+='<label data-a="dr-cleanup-label" data-oid="'+obj.id+'" data-uid="'+u.id+'" data-date="'+todayISOd+'" style="display:block;width:100%;padding:8px;background:#27ae60;border-radius:6px;cursor:pointer;color:#fff;font-size:11px;font-weight:700;text-align:center;box-sizing:border-box">📷 '+(cleanupPhotos.length?'Добавить ещё фото уборки':'Сдать отчёт · фото уборки · +'+CLEANUP_BONUS+' ₽')+'<input id="dr-cleanup-inp-'+obj.id+'-'+u.id+'" type="file" accept="image/*" multiple style="display:none"></label>';
      out+='</div>';
      
      // Day off button (only if no cleanup photos for today)
      if(cleanupPhotos.length===0){
        out+='<button data-a="dr-day-off" data-oid="'+obj.id+'" data-uid="'+u.id+'" data-date="'+todayISOd+'" style="width:100%;padding:8px;background:#fff;border:1.5px solid #9b59b655;border-radius:7px;cursor:pointer;color:#9b59b6;font-size:11px;font-weight:700">🏖 Отметить выходной</button>';
      }
    } else if(canEdit&&isOff){
      out+='<button data-a="dr-undo-off" data-oid="'+obj.id+'" data-uid="'+u.id+'" data-date="'+todayISOd+'" style="width:100%;padding:7px;background:#fff;border:1px solid #9b59b633;border-radius:6px;cursor:pointer;color:#9b59b6;font-size:10px;font-weight:600">↺ Я всё-таки работал · отменить выходной</button>';
    }
    out+='</div>';
  });
  
  // History toggle
  const allReports=(obj.dayReports||[]).filter(function(r){return r.date<todayISOd;});
  if(allReports.length){
    out+='<button data-a="dr-hist-toggle" style="width:100%;margin-top:6px;padding:6px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:6px;cursor:pointer;color:#7a9aaa;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:space-between">';
    out+='<span>📜 История ('+allReports.length+' за прошлые дни)</span><span>'+(dayReportHistOpen?'▲':'▼')+'</span>';
    out+='</button>';
    if(dayReportHistOpen){
      // Group by date desc
      const byDate={};
      allReports.forEach(function(r){if(!byDate[r.date])byDate[r.date]=[];byDate[r.date].push(r);});
      const dates=Object.keys(byDate).sort().reverse().slice(0,10);
      out+='<div style="margin-top:6px">';
      dates.forEach(function(d){
        out+='<div style="background:#f8fafc;border:1px solid #e5ebf2;border-radius:6px;padding:7px 9px;margin-bottom:4px">';
        out+='<div style="font-size:10px;color:#7a9aaa;font-weight:700;margin-bottom:4px">'+new Date(d+"T00:00:00").toLocaleDateString("ru-RU",{day:"2-digit",month:"long",weekday:"short"})+'</div>';
        byDate[d].forEach(function(r){
          const u=users.find(x=>x.id===r.userId);
          const bonusD=getCleanupBonusPaid(obj.id,r.userId,d);
          out+='<div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:3px 0;color:#5a7a9a">';
          out+='<span>'+(u?u.av:"👤")+'</span><span style="font-weight:600">'+(u?u.name:"—")+'</span>';
          if(r.dayOff){out+='<span style="color:#9b59b6">· 🏖 Выходной</span>';}
          else if((r.cleanupPhotos||[]).length>0){out+='<span style="color:#27ae60">· ✓ '+r.cleanupPhotos.length+' фото · +'+bonusD+' ₽</span>';}
          out+='</div>';
        });
        out+='</div>';
      });
      out+='</div>';
    }
  }
  
  out+='</div>';
  return out;
})()}

<!-- Дедлайны для производства (видят бригадир/мастер/админ/нач.пр./финансист) -->
${(()=>{
  if(!currentUser)return "";
  const isProd=currentUser.roles.some(r=>["brigadier","worker","prod_head","admin","financier"].includes(r));
  if(!isProd)return "";
  const objContractsAll=contractDocs.filter(d=>d.objId===obj.id&&(d.status==="signed"||d.status==="closed"));
  if(!objContractsAll.length)return "";
  // For each prod user (visible to current user) — get deadline info aggregated across contracts
  let showUsers=[];
  if(currentUser.roles.includes("admin")||currentUser.roles.includes("financier")||currentUser.roles.includes("prod_head")){
    const ids=new Set();
    objContractsAll.forEach(d=>(d.responsible||[]).forEach(uid=>{
      const u=users.find(x=>x.id===uid);
      if(u&&u.roles.some(r=>["brigadier","worker"].includes(r)))ids.add(uid);
    }));
    showUsers=Array.from(ids).map(id=>users.find(u=>u.id===id)).filter(Boolean);
  } else if(currentUser.roles.some(r=>["brigadier","worker"].includes(r))){
    // Brigadier sees only themselves
    showUsers=[currentUser];
  }
  if(!showUsers.length)return "";
  let out='<div style="background:#fff;border-radius:14px;border:1px solid #d3580033;padding:14px 16px;margin-bottom:14px">';
  out+='<div style="font-size:11px;color:#d35800;font-weight:700;letter-spacing:1px;margin-bottom:10px">📅 ДЕДЛАЙН '+(showUsers.length===1&&showUsers[0].id===currentUser.id?'· МОЙ':'БРИГАДИРОВ')+'</div>';
  showUsers.forEach(function(u){
    // Find first contract with deadline for this user
    let info=null,activeC=null;
    for(const c of objContractsAll){
      const i=getBrigadierDeadlineInfo(c,u.id);
      if(i.hasDeadline){info=i;activeC=c;break;}
    }
    if(!info)info=getBrigadierDeadlineInfo(objContractsAll[0],u.id);
    const isMe=u.id===currentUser.id;
    out+='<div style="background:#fafbfc;border-radius:10px;border:1px solid #e5ebf2;padding:10px 12px;margin-bottom:6px">';
    out+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:'+(info.hasDeadline?'8px':'0')+'">';
    out+='<span style="font-size:18px">'+u.av+'</span>';
    out+='<span style="flex:1;font-size:13px;font-weight:700;color:#1a2a3a">'+u.name+(isMe?' (вы)':'')+'</span>';
    if(!info.hasDeadline){
      out+='<span style="font-size:10px;color:#9aabbf;background:#f0f4f8;padding:3px 9px;border-radius:5px;font-weight:600">⚪ Не задан</span>';
    } else if(info.overdueDays>0){
      out+='<span style="font-size:11px;color:#e74c3c;background:#e74c3c12;padding:4px 10px;border-radius:6px;font-weight:700">🔴 ПРОСРОЧКА</span>';
    } else if(info.daysLeft<=5){
      out+='<span style="font-size:11px;color:#f39c12;background:#f39c1212;padding:4px 10px;border-radius:6px;font-weight:700">🟡 Скоро дедлайн</span>';
    } else {
      out+='<span style="font-size:11px;color:#27ae60;background:#27ae6012;padding:4px 10px;border-radius:6px;font-weight:700">🟢 В графике</span>';
    }
    out+='</div>';
    if(info.hasDeadline){
      out+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:10px">';
      out+='<div><div style="color:#9aabbf;font-weight:700;letter-spacing:0.5px">СТАРТ</div><div style="color:#1a2a3a;font-weight:600;font-size:11px">'+(info.startDate||"—")+'</div></div>';
      out+='<div><div style="color:#9aabbf;font-weight:700;letter-spacing:0.5px">ДЕДЛАЙН</div><div style="color:#1a2a3a;font-weight:600;font-size:11px">'+info.deadline+'</div></div>';
      if(info.overdueDays>0){
        out+='<div><div style="color:#e74c3c;font-weight:700;letter-spacing:0.5px">ШТРАФ</div><div style="color:#e74c3c;font-weight:700;font-size:12px">−'+info.fine.toLocaleString("ru-RU")+' ₽</div></div>';
      } else {
        out+='<div><div style="color:#27ae60;font-weight:700;letter-spacing:0.5px">ОСТАЛОСЬ</div><div style="color:#27ae60;font-weight:700;font-size:12px">'+info.daysLeft+' р.дн</div></div>';
      }
      out+='</div>';
      // ── УВЕДОМЛЕНИЕ ЗА 3 ДНЯ — animated banner ──
      if(info.overdueDays===0&&info.daysLeft>0&&info.daysLeft<=3){
        const dayWord=info.daysLeft===1?"день":(info.daysLeft<5?"дня":"дней");
        out+='<div style="margin-top:8px;padding:9px 12px;background:linear-gradient(135deg,#f39c1218,#f39c1208);border-left:4px solid #f39c12;border-radius:6px;font-size:11px;color:#b07d0a;font-weight:600;display:flex;align-items:center;gap:8px">';
        out+='<span style="font-size:18px">⏰</span>';
        out+='<div style="flex:1"><div style="font-weight:700;color:#d35400">Внимание! Скоро дедлайн</div><div style="font-size:10px;margin-top:2px">Осталось '+info.daysLeft+' рабоч. '+dayWord+'. После дедлайна — штраф '+FINE_PER_DAY.toLocaleString("ru-RU")+' ₽/день</div></div>';
        out+='</div>';
      }
      if(info.overdueDays>0){
        // Get applied fines for context
        const fines=activeC?getFinesApplied(activeC.id,u.id):0;
        out+='<div style="margin-top:6px;padding:8px 10px;background:#e74c3c08;border-left:3px solid #e74c3c;border-radius:4px">';
        out+='<div style="font-size:11px;color:#e74c3c;font-weight:700;margin-bottom:3px">⚠️ Просрочка '+info.overdueDays+' раб.дн</div>';
        out+='<div style="display:flex;gap:10px;font-size:9px;color:#5a7a9a">';
        out+='<span>Штраф/день: <b>'+FINE_PER_DAY.toLocaleString("ru-RU")+' ₽</b></span>';
        out+='<span>Применено: <b style="color:#1a2a3a">'+fines.toLocaleString("ru-RU")+' ₽</b></span>';
        out+='</div>';
        out+='</div>';
      }
    } else {
      out+='<div style="font-size:10px;color:#9aabbf;font-style:italic">Дедлайн будет установлен Начальником производства</div>';
    }
    out+='</div>';
  });
  out+='</div>';
  return out;
})()}

<!-- Сводка: сделанные работы + затраченное время (видна всем) -->
${buildWorkSummary(obj)}

<!-- Этапы и работы объекта — редактируемые -->
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
  <div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ПЕРЕЧЕНЬ РАБОТ</div>
  ${isAdmin?`<button data-a="obj-add-stage" data-oid="${obj.id}" style="padding:5px 12px;background:#2980b9;border:none;border-radius:7px;cursor:pointer;font-size:11px;color:#fff;font-weight:700">+ Этап</button>`:""}
</div>

${showNObjStageTid===obj.id?`<div style="background:#fff;border-radius:12px;border:2px solid #4a7ac8;padding:12px;margin-bottom:10px">
  <input id="ons-n" placeholder="Название этапа" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;box-sizing:border-box">
  <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">${["#e67e22","#2980b9","#27ae60","#9b59b6","#c0392b","#16a085"].map(c=>`<div data-a="pick-ons-c" data-c="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:${newObjStage.c===c?"3px solid #0d1b2e":"3px solid transparent"}"></div>`).join("")}</div>
  <div style="display:flex;gap:6px">
    <button data-a="obj-save-stage" data-oid="${obj.id}" style="flex:1;padding:7px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Добавить</button>
    <button data-a="cancel-ons" style="padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
  </div>
</div>`:""}

${obj.stages.map(s=>`<div style="background:#fff;border-radius:12px;border:1px solid ${s.c}44;margin-bottom:10px;overflow:hidden">
  <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:linear-gradient(135deg,${s.c}15,transparent);border-bottom:1px solid ${s.c}22">
    <div style="width:8px;height:8px;border-radius:50%;background:${s.c}"></div>
    <span style="font-size:13px;font-weight:700;color:#1a2a3a;flex:1">${s.n}</span>
    ${(()=>{const sm=s.works.flatMap(w=>w.mats||[]);const st=getMatStatus(sm);return st?`<span style="font-size:10px;font-weight:700;color:${st.color};background:${st.bg};border-radius:6px;padding:2px 8px;margin-right:6px">${st.label} ${st.done}/${st.total}</span>`:"";})()}
    <span style="font-size:11px;color:${s.c};font-weight:600;margin-right:8px">${s.works.length} работ · ${fmt(s.works.reduce((a,w)=>a+w.cost,0))}</span>
    ${isAdmin?`<button data-a="obj-del-stage" data-oid="${obj.id}" data-sid="${s.id}" style="padding:2px 7px;background:transparent;border:1px solid #e74c3c44;border-radius:5px;cursor:pointer;font-size:10px;color:#e74c3c">✕</button>`:""}
  </div>
  <div style="padding:8px 12px">
    ${s.works.map(w=>{
      const logs=w.timeLogs||[];
      const totalH=logs.reduce((a,l)=>a+(l.hours||0),0);
      const isTimeOpen=openTimeWid===w.id;
      const isPhotoOpen=openPhotoWid===w.id;
      const isDone=!!w.done;
      const photos=w.photos||[];
      // Can mark complete: production roles + admin
      const canComplete=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("brigadier")||currentUser.roles.includes("worker")||currentUser.roles.includes("prod_head"));
      const hasTimeLog=logs.length>0;
      const isAdminOrFin=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("financier"));
      // Block check: must have time log first (except admin/fin can always toggle)
      const canCheck=canComplete&&(isAdminOrFin||hasTimeLog||isDone);
      let h=`<div style="background:${isDone?'#27ae6008':'#f8fafc'};border:1px solid ${isDone?'#27ae6055':'#dde6f0'};border-radius:8px;margin-bottom:4px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:7px 10px">
        ${canComplete?(canCheck?`<button data-a="obj-toggle-done" data-oid="${obj.id}" data-sid="${s.id}" data-wid="${w.id}" style="width:24px;height:24px;flex-shrink:0;background:${isDone?'#27ae60':'#fff'};border:2px solid ${isDone?'#27ae60':'#c0d0e0'};border-radius:6px;cursor:pointer;color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0;line-height:1">${isDone?'✓':''}</button>`:`<button data-a="obj-need-time" data-wid="${w.id}" style="width:24px;height:24px;flex-shrink:0;background:#f8fafc;border:2px dashed #d0dae8;border-radius:6px;cursor:pointer;color:#9aabbf;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0;line-height:1" title="Сначала отметьте часы">🔒</button>`):`<div style="width:24px;height:24px;flex-shrink:0;background:${isDone?'#27ae60':'#f0f4f8'};border:2px solid ${isDone?'#27ae60':'#dde6f0'};border-radius:6px;color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1">${isDone?'✓':''}</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:${isDone?'#27ae60':'#1a2a3a'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${isDone?'text-decoration:line-through;text-decoration-color:#27ae6066':''}">${w.n}</div>
          <div style="display:flex;gap:6px;margin-top:2px;align-items:center;flex-wrap:wrap">
            ${(()=>{const ql=workQtyLabel(w);return ql?`<span style="font-size:10px;color:#16a085;background:#16a08515;border-radius:5px;padding:2px 7px;font-weight:600">${ql}</span>`:"";})()}
            ${w.cost>0?`<span style="font-size:11px;color:#7a9aaa;font-weight:700">${fmt(w.cost)}</span>`:""}
            ${(()=>{const st=getMatStatus(w.mats||[]);const cnt=(w.mats||[]).length;const c=st?st.color:'#2980b9';const bg=st?st.bg:'rgba(41,128,185,0.1)';const lbl=st&&st.done===st.total&&st.total>0?'✓':(st&&st.done>0?st.done+'/'+st.total+' ':'');return`<button data-a="obj-open-mats" data-oid="${obj.id}" data-wid="${w.id}" data-wn="${w.n}" style="padding:2px 7px;background:${bg};border:1px solid ${c}44;border-radius:5px;cursor:pointer;font-size:10px;color:${c};font-weight:600">${lbl}📦 ${cnt}</button>`;})()}
            ${(()=>{
              const canLogTime=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("financier")||currentUser.roles.includes("brigadier")||currentUser.roles.includes("worker")||currentUser.roles.includes("prod_head"));
              if(!canLogTime&&totalH===0)return "";
              return `<button data-a="obj-toggle-time" data-oid="${obj.id}" data-sid="${s.id}" data-wid="${w.id}" style="padding:2px 7px;background:${totalH>0?'#16a08518':isTimeOpen?'#16a08533':'transparent'};border:1px solid ${isTimeOpen?'#16a085':'#16a08544'};border-radius:5px;cursor:pointer;font-size:10px;color:#16a085;font-weight:600">⏱ ${totalH>0?totalH+'ч ('+logs.length+')':'+'}</button>`;
            })()}
            ${(()=>{
              const showPhoto=canComplete||photos.length>0;
              if(!showPhoto)return "";
              const bg=isPhotoOpen?'#3498db33':photos.length>0?'#3498db18':'transparent';
              const bd=isPhotoOpen?'#3498db':'#3498db44';
              return `<button data-a="obj-toggle-photo" data-oid="${obj.id}" data-sid="${s.id}" data-wid="${w.id}" style="padding:2px 7px;background:${bg};border:1px solid ${bd};border-radius:5px;cursor:pointer;font-size:10px;color:#3498db;font-weight:600">📷 ${photos.length>0?photos.length:'+'}</button>`;
            })()}
          </div>
        </div>
        ${isAdmin?`<button data-a="obj-del-work" data-oid="${obj.id}" data-sid="${s.id}" data-wid="${w.id}" style="width:22px;height:22px;background:transparent;border:1px solid #e74c3c44;border-radius:5px;cursor:pointer;color:#e74c3c;font-size:11px;flex-shrink:0">✕</button>`:""}
      </div>`;
      // Time-log block when open
      if(isTimeOpen){
        // List of eligible users for executor selection: brigadier + worker (and admin/escort) who are responsible on any contract for this obj
        const respIds=new Set();
        contractDocs.filter(d=>d.objId===obj.id&&(d.status==="signed"||d.status==="closed")).forEach(d=>(d.responsible||[]).forEach(uid=>respIds.add(uid)));
        // Production roles: brigadier, worker, prod_head — these are the executors
        const PROD_ROLES=["brigadier","worker","prod_head"];
        let eligibleUsers=users.filter(u=>respIds.has(u.id)&&u.roles.some(r=>PROD_ROLES.includes(r)));
        // Restrict choice: if current user is brig/worker/prod_head (not admin/financier), they can only log their own time
        const isAdminOrFin=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("financier"));
        if(!isAdminOrFin&&currentUser){
          eligibleUsers=eligibleUsers.filter(u=>u.id===currentUser.id);
        }
        const HOURS=[0.5,1,1.5,2,2.5,3,4,5,6,7,8];
        const today=new Date().toISOString().slice(0,10);
        h+=`<div style="padding:10px 12px;background:#16a08508;border-top:1px solid #16a08522">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:10px;color:#16a085;font-weight:700;letter-spacing:0.5px">⏱ УЧЁТ ВРЕМЕНИ</div>
            ${logs.length?`<button data-a="obj-toggle-history" data-wid="${w.id}" style="padding:3px 9px;background:transparent;border:1px solid #16a08544;border-radius:6px;cursor:pointer;color:#16a085;font-size:10px;font-weight:700;display:flex;align-items:center;gap:5px">
              <span>ИТОГО: ${totalH} ч (${logs.length})</span>
              <span style="font-size:9px">${timeHistoryExpanded[w.id]?'▲':'▼'}</span>
            </button>`:""}
          </div>
          ${logs.length&&timeHistoryExpanded[w.id]?`<div style="margin-bottom:8px">
            ${logs.map(l=>{
              const u=users.find(x=>x.id===l.userId);
              return `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:#fff;border-radius:6px;margin-bottom:3px;font-size:11px;border:1px solid #16a08522">
                <span style="font-size:13px">${u?u.av:'👤'}</span>
                <div style="flex:1;min-width:0"><div style="font-weight:600;color:#1a2a3a">${u?u.name:'—'}</div><div style="font-size:9px;color:#9aabbf">${l.date}</div></div>
                <span style="font-weight:700;color:#16a085;font-size:12px">${l.hours} ч</span>
                <button data-a="obj-del-time" data-oid="${obj.id}" data-sid="${s.id}" data-wid="${w.id}" data-lid="${l.id}" style="width:24px;height:24px;background:transparent;border:1px solid #e74c3c33;border-radius:5px;cursor:pointer;color:#e74c3c;font-size:11px">✕</button>
              </div>`;
            }).join("")}
          </div>`:""}
          <div style="background:#fff;border-radius:8px;padding:8px;border:1px dashed #16a08555">
            <div style="font-size:9px;color:#9aabbf;font-weight:700;margin-bottom:5px">ДОБАВИТЬ ЗАПИСЬ</div>
            ${eligibleUsers.length?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px" id="tl-users-${w.id}">
              ${eligibleUsers.map((u,ui)=>`<button data-a="obj-tl-user" data-uid="${u.id}" data-wid="${w.id}" style="padding:4px 9px;border-radius:14px;cursor:pointer;font-size:11px;font-weight:600;background:${(newTimeLog.userId===u.id||(!newTimeLog.userId&&ui===0))?u.c:'#f0f4f8'};color:${(newTimeLog.userId===u.id||(!newTimeLog.userId&&ui===0))?'#fff':'#5a7a9a'};border:1.5px solid ${u.c}55">${u.av} ${u.name}</button>`).join("")}
            </div>`:`<div style="font-size:10px;color:#e74c3c;margin-bottom:6px">Нет назначенных бригадиров (через Договора)</div>`}
            <div style="display:flex;gap:5px;margin-bottom:6px;align-items:center">
              <span style="font-size:10px;color:#9aabbf;font-weight:600;width:36px">ДАТА:</span>
              <input id="tl-date-${w.id}" type="date" value="${newTimeLog.date||today}" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid #d0dae8;font-size:11px;outline:none;box-sizing:border-box">
            </div>
            <div style="display:flex;gap:4px;margin-bottom:6px;align-items:center;flex-wrap:wrap">
              <span style="font-size:10px;color:#9aabbf;font-weight:600;width:36px">ЧАСОВ:</span>
              ${HOURS.map(hh=>`<button data-a="obj-tl-hours" data-h="${hh}" data-wid="${w.id}" style="padding:4px 9px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;background:${newTimeLog.hours===hh?'#16a085':'#f0f4f8'};color:${newTimeLog.hours===hh?'#fff':'#5a7a9a'};border:1.5px solid ${newTimeLog.hours===hh?'#16a085':'#d0dae8'};min-width:36px">${hh}</button>`).join("")}
            </div>
            <button data-a="obj-tl-save" data-oid="${obj.id}" data-sid="${s.id}" data-wid="${w.id}" style="width:100%;padding:7px;background:#16a085;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">💾 Сохранить запись</button>
          </div>
        </div>`;
      }
      // Photo gallery + uploader block
      if(isPhotoOpen){
        h+=`<div style="padding:10px 12px;background:#3498db08;border-top:1px solid #3498db22">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:10px;color:#3498db;font-weight:700;letter-spacing:0.5px">📷 ФОТО ВЫПОЛНЕНИЯ${photos.length?' · '+photos.length+' шт':''}</div>
            ${canComplete?`<label data-a="obj-photo-label" data-oid="${obj.id}" data-sid="${s.id}" data-wid="${w.id}" style="padding:4px 10px;background:#3498db;border-radius:6px;cursor:pointer;color:#fff;font-size:10px;font-weight:700">+ Добавить фото<input id="photo-inp-${w.id}" type="file" accept="image/*" multiple style="display:none"></label>`:""}
          </div>
          ${photos.length?`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
            ${photos.map(p=>`<div style="position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;background:#dde6f0;border:1px solid #c0d0e0">
              <img src="${p.data}" style="width:100%;height:100%;object-fit:cover;display:block" alt="">
              ${canComplete?`<button data-a="obj-del-photo" data-oid="${obj.id}" data-sid="${s.id}" data-wid="${w.id}" data-pid="${p.id}" style="position:absolute;top:3px;right:3px;width:22px;height:22px;background:rgba(231,76,60,0.9);border:none;border-radius:5px;cursor:pointer;color:#fff;font-size:11px;font-weight:700">✕</button>`:""}
              <div style="position:absolute;bottom:0;left:0;right:0;padding:3px 6px;background:linear-gradient(0deg,rgba(0,0,0,0.7),transparent);color:#fff;font-size:8px">${(p.uploader||"—")}<br>${p.date||""}</div>
            </div>`).join("")}
          </div>`:`<div style="text-align:center;padding:14px 8px;background:#fff;border:1px dashed #3498db44;border-radius:8px;font-size:11px;color:#9aabbf">Нет фото. Прикрепите фото-отчёт о выполнении работы.</div>`}
          <div style="font-size:9px;color:#9aabbf;margin-top:6px;font-style:italic">💡 Фото пока хранятся локально. При подключении Google Drive — автозагрузка туда.</div>
        </div>`;
      }
      h+=`</div>`;
      return h;
    }).join("")}
    ${isAdmin?(showNObjWorkSid===s.id?`<div style="margin-top:6px;background:#f0f4f8;border-radius:9px;padding:9px">
      <input id="onw-n" placeholder="Название работы" style="width:100%;padding:7px 9px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;margin-bottom:5px;outline:none;box-sizing:border-box">
      <div style="display:flex;gap:5px">
        <input id="onw-cost" placeholder="Стоимость ₽" type="number" style="flex:1;padding:7px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">
        <button data-a="obj-save-work" data-oid="${obj.id}" data-sid="${s.id}" style="padding:7px 12px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">+</button>
        <button data-a="cancel-onw" style="padding:7px 10px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
      </div>
    </div>`:`<button data-a="obj-show-work" data-sid="${s.id}" style="width:100%;margin-top:5px;padding:7px;background:transparent;border:1px dashed ${s.c}66;border-radius:7px;cursor:pointer;font-size:12px;color:${s.c};font-weight:600">+ Добавить работу</button>`):""}
  </div>
</div>`).join("")}

${objMatModal?`<div style="position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;justify-content:center;padding:60px 16px;z-index:200">
  <div style="background:#fff;border-radius:16px;width:100%;max-width:440px;padding:20px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div><div style="font-size:14px;font-weight:700;color:#0d1b2e">📦 Материалы</div><div style="font-size:12px;color:#7a9aaa">${objMatModal.wn}</div></div>
      <button data-a="close-obj-mm" style="width:30px;height:30px;border-radius:50%;background:#f0f4f8;border:none;cursor:pointer;font-size:16px">✕</button>
    </div>
    ${(()=>{const o=objects.find(x=>x.id===objMatModal.oid);const work=o?.stages.flatMap(s=>s.works).find(w=>w.id===objMatModal.wid);const wMats=work?.mats||[];
    return wMats.map(function(m){
      const mode=EXP_MODES.find(function(x){return x.k===(m.mode||"piece");})||EXP_MODES[0];
      const conv=matConv(m);
      const idx=conv?(expView[m.id]==="1"?1:(expView[m.id]==="0"?0:conv.def)):0;
      const price=conv?conv.views[idx].price:(Number(m.cost)||0);
      const unit=conv?conv.views[idx].unit:mode.unit;
      const qty=m.qty||1;
      const on="background:#2a3142;color:#fff", off="background:transparent;color:#7a9aaa";
      return `<div style="padding:8px 10px;border-radius:8px;margin-bottom:5px;background:#f8fafc;border:1px solid #dde6f0">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#1a2a3a">${m.n}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:3px;flex-wrap:wrap">
            ${m.store?`<span style="font-size:10px;font-weight:700;background:${SC[m.store]||"#666"};color:#fff;border-radius:4px;padding:1px 5px">${m.store}</span>`:""}
            <span style="font-size:10px;font-weight:700;color:#5a7a9a;background:#eef2f7;border-radius:4px;padding:1px 6px">${mode.icon} ${mode.unit}</span>
            ${m.cost>0?`<span style="font-size:11px;color:#7a9aaa">${price.toLocaleString("ru-RU")} ₽/${unit} × ${numRu(qty)} = <b style="color:#0d1b2e">${fmt((Number(m.cost)||0)*qty)}</b></span>`:""}
          </div>
        </div>
        <button data-a="obj-del-mat" data-oid="${objMatModal.oid}" data-wid="${objMatModal.wid}" data-mid="${m.id}" style="width:24px;height:24px;background:transparent;border:1px solid #e74c3c44;border-radius:5px;cursor:pointer;color:#e74c3c;font-size:11px;flex-shrink:0">✕</button>
      </div>
      ${conv?`<div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">
        <div style="display:inline-flex;background:#e9eef4;border-radius:20px;padding:2px">
          <button data-a="objmat-view" data-mid="${m.id}" data-v="0" style="border:none;cursor:pointer;font-size:10px;font-weight:700;padding:3px 9px;border-radius:18px;${idx===0?on:off}">${conv.views[0].unit}</button>
          <button data-a="objmat-view" data-mid="${m.id}" data-v="1" style="border:none;cursor:pointer;font-size:10px;font-weight:700;padding:3px 9px;border-radius:18px;${idx===1?on:off}">${conv.views[1].unit}</button>
        </div>
        <span style="font-size:10px;color:#9aabbf">${conv.footer}</span>
      </div>`:""}
    </div>`;}).join("")+`${wMats.length===0?`<div style="text-align:center;color:#aaa;font-size:13px;padding:12px">Нет материалов</div>`:""}<div style="margin-top:10px;background:#f0f4f8;border-radius:10px;padding:12px">
      <input id="opm-n" placeholder="Название" style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;margin-bottom:5px;outline:none;box-sizing:border-box">
      <div style="display:flex;gap:5px;margin-bottom:7px">
        <input id="opm-cost" placeholder="Цена ₽" type="number" style="flex:1;padding:7px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">
        <input id="opm-store" placeholder="Магазин" style="flex:1;padding:7px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none">
      </div>
      <button data-a="obj-add-mat" style="width:100%;padding:8px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Добавить материал</button>
    </div>`;})()}
  </div>
</div>`:""}

<!-- Sticky bottom save bar -->
<div id="save-bar-${obj.id}" style="display:none;position:sticky;bottom:0;background:#fff;border-top:2px solid #27ae60;padding:12px 16px;margin:16px -14px -14px;z-index:100">
  <div style="display:flex;align-items:center;gap:10px">
    <span style="flex:1;font-size:13px;color:#e67e22;font-weight:700">⚠ Есть несохранённые изменения</span>
    <button data-a="discard-obj" data-oid="${obj.id}" style="padding:8px 16px;background:transparent;border:1px solid #d0dae8;border-radius:8px;cursor:pointer;font-size:13px;color:#7a9aaa">Отменить</button>
    <button data-a="save-obj-info" data-oid="${obj.id}" style="padding:9px 24px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">💾 Сохранить изменения</button>
  </div>
</div>
</div>`;
  }

  const _vo=currentUser&&currentUser.roles.includes("admin")?objects:objects.filter(function(o){return currentUser&&getUserObjects(currentUser).includes(o.id);});
  return`<div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
  <div>
    <div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ОБЪЕКТЫ (${(isAdmin?objects:objects.filter(function(o){return currentUser&&getUserObjects(currentUser).includes(o.id);})).length})</div>
    <div style="font-size:12px;color:#5a7a9a;margin-top:2px">Создаются из шаблонов</div>
  </div>
  ${isAdmin?`<button data-a="show-nobj" style="padding:7px 16px;background:#c0392b;border:none;border-radius:9px;cursor:pointer;font-size:13px;color:#fff;font-weight:700">+ Новый объект</button>`:""}
</div>

${showNObj?`<div style="background:#fff;border-radius:14px;border:2px solid #c0392b;padding:16px;margin-bottom:14px">
  <div style="font-size:14px;font-weight:700;color:#0d1b2e;margin-bottom:14px">Новый объект</div>
  <div style="display:flex;gap:8px;margin-bottom:10px">
    <select id="nobj-icon" style="padding:8px;border-radius:8px;border:1px solid #d0dae8;font-size:20px;outline:none">
      ${OBJ_ICONS.map(i=>`<option value="${i}">${i}</option>`).join("")}
    </select>
    <input id="nobj-name" value="${nobj.name}" placeholder="Название объекта" style="flex:1;padding:9px 12px;border-radius:8px;border:1px solid #d0dae8;font-size:14px;outline:none">
  </div>
  <div style="margin-bottom:10px">
    <div style="font-size:11px;color:#7a9aaa;font-weight:600;margin-bottom:6px">ВЫБЕРИТЕ ШАБЛОН</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${templates.map(t=>{const sel=nobj.templateId===t.id;return`<div data-a="pick-nobj-t" data-tid="${t.id}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;cursor:pointer;border:2px solid ${sel?t.stages[0]?.c||"#4a7ac8":"#dde6f0"};background:${sel?"#f0f6ff":"#f8fafc"}">
        <span style="font-size:24px">${t.icon}</span>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:#1a2a3a">${t.name}</div>
          <div style="font-size:11px;color:#7a9aaa">${t.stages.length} этапов · ${t.stages.flatMap(s=>s.works).length} работ</div>
        </div>
        ${sel?`<span style="font-size:14px;color:#27ae60;font-weight:700">✓</span>`:""}
      </div>`;}).join("")}
    </div>
  </div>
  <div style="margin-bottom:12px">
    <div style="font-size:11px;color:#7a9aaa;font-weight:600;margin-bottom:6px">НАЗНАЧИТЬ СОТРУДНИКОВ</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${users.map(u=>{const on=nobj.assignTo.includes(u.id);return`<div data-a="toggle-nobj-u" data-uid="${u.id}" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;cursor:pointer;background:${on?u.c:"transparent"};border:1.5px solid ${on?u.c:"#d0dae8"}">
        <span style="font-size:14px">${u.av}</span>
        <span style="font-size:12px;font-weight:600;color:${on?"#fff":"#5a7a9a"}">${u.name}</span>
      </div>`;}).join("")}
    </div>
  </div>
  <div style="display:flex;gap:8px">
    <button data-a="add-obj" style="flex:1;padding:10px;background:#27ae60;border:none;border-radius:10px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">Создать объект</button>
    <button data-a="cancel-nobj" style="padding:10px 16px;background:transparent;border:1px solid #d0dae8;border-radius:10px;cursor:pointer;font-size:13px;color:#7a9aaa">Отмена</button>
  </div>
</div>`:""}

<!-- Объекты — карточки -->
${_vo.length===0?`<div style="background:#fff;border-radius:14px;border:2px dashed #d0dae8;padding:32px;text-align:center;margin-bottom:14px">
  <div style="font-size:40px;margin-bottom:10px">🏗️</div>
  <div style="font-size:14px;font-weight:600;color:#5a7a9a;margin-bottom:6px">Нет объектов</div>
  <div style="font-size:12px;color:#a0b4c8">Нажмите «+ Новый объект» чтобы создать первый</div>
</div>`:`<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
  ${_vo.map(obj=>renderObjCard(obj,isAdmin)).join("")}
</div>`}

<!-- ── ШАБЛОНЫ ── -->
${isAdmin?`<div style="border-top:2px solid #e8eef5;padding-top:20px;margin-top:6px;overflow:hidden">${tTemplates()}</div>`:""}
</div>`;
}

// ── ШАБЛОНЫ ──────────────────────────────────────────────────────
function tTemplates(){
  if(openTemplate){
    const t=templates.find(x=>x.id===openTemplate);
    if(!t)return"";
    const selIds=(t.stages||[]).flatMap(s=>s.works||[]).map(w=>w.estId).filter(Boolean);
    const selWorks={}; (t.stages||[]).forEach(s=>(s.works||[]).forEach(w=>{if(w.estId)selWorks[w.estId]=w;}));
    const allW=(t.stages||[]).flatMap(s=>s.works||[]);
    const grand=allW.reduce((a,w)=>a+(w.cost||0),0);
    const tKind=t.kind||"banya";
    const _est=estimates.filter(e=>(e.kind||"banya")===tKind);
    const groups=EST_STAGES.map(st=>({st:st,items:_est.filter(e=>Number(e.stage)===st.n)}));
    const noStage=_est.filter(e=>!EST_STAGES.find(x=>x.n===Number(e.stage)));
    if(noStage.length)groups.push({st:null,items:noStage});
    return`<div>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
  <button data-a="close-tpl" style="padding:7px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Шаблоны</button>
  <div style="flex:1"></div>
  <span style="font-size:11px;color:#7a9aaa">Изменения влияют только на новые объекты</span>
</div>
<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:14px;margin-bottom:14px">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <select id="tpl-icon-${t.id}" style="padding:6px;border-radius:8px;border:1px solid #d0dae8;font-size:26px;outline:none;cursor:pointer">
      ${["🛁","🏠","🌾","🏗️","🏡","🏘️","🏢","🔨","⚡","🌊"].map(i=>`<option value="${i}" ${t.icon===i?"selected":""}>${i}</option>`).join("")}
    </select>
    <input id="tpl-name-${t.id}" value="${t.name}" placeholder="Название шаблона" style="flex:1;padding:9px 12px;border-radius:8px;border:1px solid #d0dae8;font-size:16px;font-weight:700;outline:none;color:#0d1b2e">
    <button data-a="save-tpl-info" data-tid="${t.id}" style="padding:9px 18px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:13px;font-weight:700;white-space:nowrap;flex-shrink:0">💾 Сохранить</button>
  </div>
  <div style="font-size:12px;color:#7a9aaa">${allW.length} работ · <span id="tpl-grand">${fmt(grand)}</span> · в ${objects.filter(o=>o.templateId===t.id).length} объектах</div>
</div>
<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:8px">СОБРАТЬ ИЗ СМЕТ (${tKind==="house"?"🏠 дом":"🛁 баня"}) — отметьте работы галочками</div>
${groups.map(g=>{
  const stN=g.st?g.st.n:0;
  const color=g.st?g.st.color:"#7a9aaa";
  const title=g.st?(g.st.short+" · "+g.st.label):"Без этапа";
  const ids=g.items.map(e=>e.id);
  const selN=ids.filter(id=>selIds.includes(id)).length;
  const allSel=ids.length&&selN===ids.length;
  const someSel=selN>0&&!allSel;
  return`<div style="background:#fff;border-radius:12px;border:1px solid ${color}44;margin-bottom:10px;overflow:hidden">
  <div data-a="tpl-est-stage" data-st="${stN}" style="display:flex;align-items:center;gap:9px;padding:10px 13px;background:linear-gradient(135deg,${color}15,transparent);border-bottom:1px solid ${color}22;cursor:pointer">
    <div style="width:20px;height:20px;border-radius:6px;border:2px solid ${color};background:${allSel?color:(someSel?color+"55":"#fff")};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:800;flex-shrink:0">${allSel?"✓":(someSel?"–":"")}</div>
    <span style="font-size:12px;font-weight:800;color:${color};letter-spacing:0.3px;flex:1">${title.toUpperCase()}</span>
    <span style="font-size:10px;color:#9aabbf">${selN}/${ids.length}</span>
  </div>
  <div style="padding:6px 10px">
    ${g.items.length?g.items.map(e=>{const on=selIds.includes(e.id);const tw=on?selWorks[e.id]:null;const wTotal=tw?tw.cost:estTotal(e);
      return`<div style="margin-bottom:4px">
      <div data-a="tpl-est" data-eid="${e.id}" style="display:flex;align-items:center;gap:9px;padding:8px;border-radius:8px;cursor:pointer;background:${on?color+"10":"transparent"}">
        <div style="width:19px;height:19px;border-radius:5px;border:2px solid ${on?color:"#cdd8e6"};background:${on?color:"#fff"};display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;flex-shrink:0">${on?"✓":""}</div>
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#1a2a3a;line-height:1.25">${e.name}</div>
        <div style="font-size:10px;color:#9aabbf;margin-top:1px">${(e.lines||[]).length} мат.</div></div>
        <span id="tplw-t-${e.id}" style="font-size:12px;font-weight:700;color:#0d1b2e;white-space:nowrap">${fmt(wTotal)}</span>
      </div>
      ${on?`<div style="padding:2px 8px 8px 34px">
        ${(tw.mats||[]).length?(tw.mats||[]).map(m=>{const mo=EXP_MODES.find(x=>x.k===(m.mode||"piece"))||EXP_MODES[0];const conv=expConv({mode:m.mode,unitCost:Number(m.cost)||0,packBase:m.packBase,packPer:m.packPer,sheetM2:m.sheetM2,lenPer:m.lenPer});const lt=Math.round((Number(m.cost)||0)*(m.qty||0));
          return`<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-top:1px solid #f0f4f8">
            <div style="flex:1;min-width:0"><div style="font-size:12px;color:#1a2a3a;font-weight:600;line-height:1.2">${m.n}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:2px">
              ${m.store?`<span style="font-size:9px;font-weight:700;background:${SC[m.store]||'#666'};color:#fff;border-radius:4px;padding:1px 6px">${m.store}</span>`:''}
              <span style="font-size:10px;color:#9aabbf">${(Number(m.cost)||0).toLocaleString('ru-RU')} ₽/${mo.unit}</span>
              ${m.url?`<a href="${m.url}" target="_blank" rel="noopener" style="font-size:9px;color:#fff;background:#2980b9;border-radius:4px;padding:1px 6px;text-decoration:none;font-weight:700">🔗 купить</a>`:''}
            </div>
            ${conv?`<div style="font-size:10px;color:#7a9aaa;margin-top:2px">${conv.footer}</div>`:''}
            </div>
            <input data-a="tpl-mq" data-eid="${e.id}" data-mid="${m.id}" type="number" step="any" value="${m.qty}" style="width:46px;padding:5px 4px;border-radius:6px;border:1px solid #d0dae8;font-size:12px;text-align:center;outline:none">
            <span style="font-size:10px;color:#9aabbf;width:22px">${mo.unit}</span>
            <span id="tplm-lt-${e.id}-${m.id}" style="font-size:12px;font-weight:700;color:#0d1b2e;width:60px;text-align:right;white-space:nowrap">${lt.toLocaleString('ru-RU')} ₽</span>
          </div>`;}).join(''):`<div style="font-size:11px;color:#bbb;padding:6px 0">Без материалов · фикс. стоимость ${fmt(tw.cost)}</div>`}
        <button data-a="tpl-add-mat-open" data-eid="${e.id}" style="width:100%;margin-top:6px;padding:8px;background:#eef6f4;border:1px dashed #16a085;border-radius:9px;cursor:pointer;color:#16a085;font-size:12px;font-weight:700">+ Добавить материал</button>
      </div>`:''}
    </div>`;}).join(""):`<div style="text-align:center;color:#bbb;font-size:12px;padding:10px">Нет смет на этом этапе</div>`}
  </div>
</div>`;
}).join("")}
${tplPickFor?`<div style="position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;justify-content:center;padding:50px 14px;z-index:200">
  <div style="background:#fff;border-radius:16px;width:100%;max-width:460px;max-height:80vh;overflow:auto;padding:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:15px;font-weight:800;color:#0d1b2e">Добавить материал</div>
      <button data-a="tpl-pick-close" style="width:30px;height:30px;border-radius:50%;background:#f0f4f8;border:none;cursor:pointer;font-size:16px">✕</button>
    </div>
    <input id="tpl-pick-search" value="${(tplPickSearch||'').replace(/"/g,'&quot;')}" placeholder="🔍 Поиск материала..." style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #dde6f0;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:10px">
    ${(()=>{const q=(tplPickSearch||'').trim().toLowerCase();const list=q?expProducts.filter(p=>(p.name||'').toLowerCase().indexOf(q)>=0||(p.store||'').toLowerCase().indexOf(q)>=0):expProducts;return list.length?list.map(p=>{const mo=EXP_MODES.find(x=>x.k===(p.mode||'piece'))||EXP_MODES[0];const conv=expConv(p);return `<div data-a="tpl-pick-mat" data-pid="${p.id}" style="display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid #e6ecf3;border-radius:11px;margin-bottom:7px;cursor:pointer">
      <div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:700;color:#0d1b2e">${p.name}</div>
      <div style="font-size:10px;color:#7a9aaa;margin-top:2px">${p.store?p.store+' · ':''}${mo.icon} ${mo.label}</div>
      ${conv?`<div style="font-size:10px;color:#7a9aaa;margin-top:2px">${conv.footer}</div>`:''}</div>
      <div style="font-size:13px;font-weight:800;color:#16a085;white-space:nowrap">${(Number(p.unitCost)||0).toLocaleString('ru-RU')} ₽<span style="font-size:10px;color:#9aabbf;font-weight:600">/${mo.unit}</span></div>
    </div>`;}).join(''):'<div style="text-align:center;color:#aaa;font-size:13px;padding:20px">Ничего не найдено</div>';})()}
  </div>
</div>`:''}
</div>`;
  }

  return`<div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
  <div>
    <div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ШАБЛОНЫ ОБЪЕКТОВ</div>
    <div style="font-size:12px;color:#5a7a9a;margin-top:2px">Создайте шаблон — используйте для новых объектов</div>
  </div>
  <button data-a="show-nt" style="padding:7px 16px;background:#9b59b6;border:none;border-radius:9px;cursor:pointer;font-size:13px;color:#fff;font-weight:700">+ Шаблон</button>
</div>

${showNT?`<div style="background:#fff;border-radius:14px;border:2px solid #9b59b6;padding:16px;margin-bottom:14px">
  <div style="font-size:14px;font-weight:700;color:#0d1b2e;margin-bottom:12px">Новый шаблон</div>
  <div style="display:flex;gap:8px;margin-bottom:10px">
    <select id="nt-icon" style="padding:8px;border-radius:8px;border:1px solid #d0dae8;font-size:20px;outline:none">
      ${OBJ_ICONS.map(i=>`<option value="${i}">${i}</option>`).join("")}
    </select>
    <input id="nt-name" placeholder="Название шаблона (напр. Баня 6х4)" style="flex:1;padding:9px 12px;border-radius:8px;border:1px solid #d0dae8;font-size:14px;outline:none">
  </div>
  <div style="font-size:11px;color:#7a9aaa;font-weight:700;margin-bottom:6px">Сметы какого вида использовать</div>
  <div style="display:flex;gap:6px;margin-bottom:12px">
    <button data-a="nt-kind" data-k="banya" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;border:2px solid ${(nt.kind||"banya")==="banya"?"#16a085":"#dde6f0"};background:${(nt.kind||"banya")==="banya"?"#16a085":"#fff"};color:${(nt.kind||"banya")==="banya"?"#fff":"#7a9aaa"}">🛁 Баня</button>
    <button data-a="nt-kind" data-k="house" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;border:2px solid ${nt.kind==="house"?"#16a085":"#dde6f0"};background:${nt.kind==="house"?"#16a085":"#fff"};color:${nt.kind==="house"?"#fff":"#7a9aaa"}">🏠 Дом</button>
  </div>
  <div style="display:flex;gap:8px">
    <button data-a="add-tpl" style="flex:1;padding:9px;background:#9b59b6;border:none;border-radius:9px;cursor:pointer;color:#fff;font-size:13px;font-weight:700">Создать шаблон</button>
    <button data-a="cancel-nt" style="padding:9px 14px;background:transparent;border:1px solid #d0dae8;border-radius:9px;cursor:pointer;font-size:13px;color:#7a9aaa">Отмена</button>
  </div>
</div>`:""}

<div id="tpl-grid" style="display:flex;flex-direction:column;gap:10px"></div>
</div>`;
}

// ── ПЕРЕЧЕНЬ РАБОТ ──────────────────────────────────────────────
function tWorks(){
  const allMats=dbWorks.flatMap(w=>(w.mats||[]).map(m=>({...m,wn:w.n,wid:w.id})));
  // Уровень доступа: отдел продаж видит только планировки
  const dbLevel=dbAccessLevel();
  const plansOnly=dbLevel==="plans";
  if(plansOnly) dbSection="plans";
  return`<div>
<!-- Переключатель разделов -->
${plansOnly?"":`<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
  <button data-a="db-tab" data-dt="works" style="flex:1;min-width:96px;padding:11px 6px;border-radius:12px;cursor:pointer;font-size:12px;font-weight:700;border:2px solid ${dbSection==="works"?"#e67e22":"#dde6f0"};background:${dbSection==="works"?"#e67e22":"#fff"};color:${dbSection==="works"?"#fff":"#7a9aaa"};box-shadow:${dbSection==="works"?"0 3px 10px rgba(230,126,34,0.3)":"none"};transition:all 0.15s">🔨 Работы</button>
  <button data-a="db-tab" data-dt="mats" style="flex:1;min-width:96px;padding:11px 6px;border-radius:12px;cursor:pointer;font-size:12px;font-weight:700;border:2px solid ${dbSection==="mats"?"#2980b9":"#dde6f0"};background:${dbSection==="mats"?"#2980b9":"#fff"};color:${dbSection==="mats"?"#fff":"#7a9aaa"};box-shadow:${dbSection==="mats"?"0 3px 10px rgba(41,128,185,0.3)":"none"};transition:all 0.15s">📦 Материалы</button>
  <button data-a="db-tab" data-dt="plans" style="flex:1;min-width:96px;padding:11px 6px;border-radius:12px;cursor:pointer;font-size:12px;font-weight:700;border:2px solid ${dbSection==="plans"?"#8e44ad":"#dde6f0"};background:${dbSection==="plans"?"#8e44ad":"#fff"};color:${dbSection==="plans"?"#fff":"#7a9aaa"};box-shadow:${dbSection==="plans"?"0 3px 10px rgba(142,68,173,0.3)":"none"};transition:all 0.15s">📐 Планировки</button>
  <button data-a="db-tab" data-dt="est" style="flex:1;min-width:96px;padding:11px 6px;border-radius:12px;cursor:pointer;font-size:12px;font-weight:700;border:2px solid ${dbSection==="est"?"#16a085":"#dde6f0"};background:${dbSection==="est"?"#16a085":"#fff"};color:${dbSection==="est"?"#fff":"#7a9aaa"};box-shadow:${dbSection==="est"?"0 3px 10px rgba(22,160,133,0.3)":"none"};transition:all 0.15s">🧾 Сметы</button>
</div>`}

<div id="dbworks-list-wrap" style="display:block">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
  <div>
    <div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ПЕРЕЧЕНЬ РАБОТ (${dbWorks.length})</div>
    <div style="font-size:12px;color:#5a7a9a;margin-top:2px">Используются в шаблонах. К каждой работе привязаны материалы.</div>
  </div>
  <button data-a="db-add-work" style="padding:6px 14px;background:#2980b9;border:none;border-radius:8px;cursor:pointer;font-size:12px;color:#fff;font-weight:700">+ Работа</button>
</div>
${showNDBWork?`<div style="background:#fff;border-radius:12px;border:2px solid #4a7ac8;padding:14px;margin-bottom:12px">
  <div style="display:flex;gap:8px;margin-bottom:6px">
    <input id="ndbw-n" placeholder="Название работы" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none">
  </div>
  <div style="display:flex;gap:6px;margin-bottom:6px">
    <input id="ndbw-qty" placeholder="Кол-во" type="number" step="any" min="0" value="1" style="flex:1;padding:8px 8px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box">
    <select id="ndbw-unit" data-a="db-ndbw-unit-change" style="flex:1.2;padding:8px 6px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;outline:none;background:#fff;box-sizing:border-box">
      <option value="">— нет —</option>
      ${WORK_UNITS.map(u=>`<option value="${u}">${u}</option>`).join("")}
      <option value="__custom">✏️ своя…</option>
    </select>
    <input id="ndbw-cost" placeholder="Цена/ед ₽" type="number" step="any" style="flex:1.3;padding:8px 8px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box">
  </div>
  <input id="ndbw-unit-custom" placeholder="Своя единица" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;outline:none;margin-bottom:8px;box-sizing:border-box;display:none">
  <select id="ndbw-stage" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none;margin-bottom:8px;background:#fff">
    <option value="ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ">Этап 1 — Подготовительные работы</option>
    <option value="ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА">Этап 2 — Черновая отделка</option>
    <option value="ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА">Этап 3 — Чистовая отделка</option>
  </select>
  <div style="display:flex;gap:6px">
    <button data-a="db-save-work" style="flex:1;padding:7px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Добавить</button>
    <button data-a="db-cancel-work" style="padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
  </div>
</div>`:""}
<div id="dbworks-list"></div>
</div>
<div id="dbmats-list-wrap" style="display:none">
<div style="margin-bottom:10px">
  <div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ПЕРЕЧЕНЬ МАТЕРИАЛОВ (${expProducts.length})</div>
  <div style="font-size:12px;color:#5a7a9a;margin-top:2px">Цена за единицу · пачка / лист / хлыст / м² / шт</div>
</div>
<div id="dbmats-list"></div>
</div>
<div id="dbplans-list-wrap" style="display:${dbSection==="plans"?"block":"none"}">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
  <div>
    <div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ПЕРЕЧЕНЬ ПЛАНИРОВОК (${dbPlans.length})</div>
    <div style="font-size:12px;color:#5a7a9a;margin-top:2px">Готовые планировки. Их можно прикреплять клиентам в CRM.</div>
  </div>
  ${plansOnly?"":`<button data-a="db-add-plan" style="padding:6px 14px;background:#8e44ad;border:none;border-radius:8px;cursor:pointer;font-size:12px;color:#fff;font-weight:700">+ Планировка</button>`}
</div>
<!-- Вкладки подразделов планировок -->
${(function(){
  const nH=dbPlans.filter(function(p){return (p.cat||"house")==="house";}).length;
  const nB=dbPlans.filter(function(p){return p.cat==="banya";}).length;
  const tabBtn=function(cat,icon,label,n,color){
    const on=dbPlanTab===cat;
    return '<button data-a="db-plan-tab" data-c="'+cat+'" style="flex:1;padding:10px 6px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;border:2px solid '+(on?color:"#dde6f0")+';background:'+(on?color:"#fff")+';color:'+(on?"#fff":"#7a9aaa")+';box-shadow:'+(on?"0 3px 10px "+color+"4d":"none")+';transition:all 0.15s">'+icon+' '+label+' ('+n+')</button>';
  };
  return '<div style="display:flex;gap:8px;margin-bottom:14px">'+
    tabBtn("house","🏠","Дома",nH,"#2980b9")+
    tabBtn("banya","🛁","Бани",nB,"#e67e22")+
  '</div>';
})()}
${showNDBPlan?`<div style="background:#fff;border-radius:12px;border:2px solid #8e44ad;padding:14px;margin-bottom:12px">
  <div style="font-size:9px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">НОВАЯ ПЛАНИРОВКА · ${dbPlanNew.cat==="banya"?"🛁 БАНИ":"🏠 ДОМА"}</div>
  <input id="ndbplan-n" value="${(dbPlanNew.name||"").replace(/"/g,"&quot;")}" placeholder="Название планировки (напр. Дом 40 футов, 1 спальня)" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:8px">
  ${dbPlanNew.img
    ? `<div style="position:relative;margin-bottom:8px"><img src="${dbPlanNew.img}" style="width:100%;border-radius:8px;border:1px solid #e0e6ee;max-height:220px;object-fit:contain;background:#f8fafc"><button data-a="db-plan-img-clear" style="position:absolute;top:6px;right:6px;width:28px;height:28px;background:rgba(0,0,0,0.55);border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:13px">✕</button></div>`
    : `<label data-a="db-plan-img-label" style="display:block;text-align:center;padding:22px;border:2px dashed #8e44ad55;border-radius:10px;cursor:pointer;color:#8e44ad;font-size:13px;font-weight:600;margin-bottom:8px">🖼 Загрузить изображение планировки<input id="ndbplan-img" type="file" accept="image/*" style="display:none"></label>`}
  <div style="display:flex;gap:6px">
    <button data-a="db-save-plan" style="flex:1;padding:8px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Сохранить</button>
    <button data-a="db-cancel-plan" style="padding:8px 14px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
  </div>
</div>`:""}
${(function(){
  function planCard(p){
    return `<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;overflow:hidden">
      ${p.img?`<a href="${p.img}" target="_blank" rel="noopener" style="display:block"><img src="${p.img}" style="width:100%;max-height:240px;object-fit:contain;background:#f8fafc;display:block"></a>`:`<div style="padding:30px;text-align:center;color:#c8d8e8;font-size:30px;background:#f8fafc">📐</div>`}
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px">
        <div style="flex:1;min-width:0;font-size:13px;font-weight:700;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name||"Без названия"}</div>
        ${plansOnly?"":`<button data-a="db-del-plan" data-pid="${p.id}" style="width:28px;height:28px;background:transparent;border:1px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:12px;flex-shrink:0">✕</button>`}
      </div>
    </div>`;
  }
  const items=dbPlans.filter(function(p){return (p.cat||"house")===dbPlanTab;});
  if(!items.length){
    const lbl=dbPlanTab==="banya"?"бань":"домов";
    return `<div style="text-align:center;padding:30px 16px;color:#9aabbf;font-size:13px;border:1px dashed #d0dae8;border-radius:12px">В разделе пока нет ${lbl}. Нажмите «+ Планировка».</div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:10px">${items.map(planCard).join("")}</div>`;
})()}
</div>
<div id="dbexp-list-wrap" style="display:none">
<div style="margin-bottom:12px">
  <div style="font-size:11px;color:#16a085;font-weight:700;letter-spacing:1px">🧪 ЭКСПЕРИМЕНТ · КАРТОЧКА ТОВАРА</div>
  <div style="font-size:12px;color:#5a7a9a;margin-top:2px">Демо нового интерфейса материала. Данные не сохраняются.</div>
</div>
<div id="dbexp-card"></div>
</div>
<div id="dbest-list-wrap" style="display:none">
<div style="margin-bottom:10px">
  <div style="font-size:11px;color:#16a085;font-weight:700;letter-spacing:1px">🧾 СМЕТЫ</div>
  <div style="font-size:12px;color:#5a7a9a;margin-top:2px">Собирайте смету из материалов каталога</div>
</div>
<div id="dbest-list"></div>
</div>
</div>`;
}

// ── ЭКСПЕРИМЕНТ: список товаров (демо) ──────────────────────────
// Описание двух режимов цены для товара (переключатель). null = переключателя нет.
function expConv(p){
  const mode=EXP_MODES.find(function(x){return x.k===p.mode;})||EXP_MODES[0];
  const uc=Number(p.unitCost)||0;
  if((p.mode==="pack"||p.mode==="sheet")&&Number(p.packPer)>0){
    const ratio=Number(p.packPer), base=p.packBase||"м²", per=ratio>0?Math.round(uc/ratio):uc;
    return {
      views:[{unit:base,price:per},{unit:mode.unit,price:uc}], def:1,
      footer:"1 "+mode.unit+" = "+numRu(ratio)+" "+base+(per>0?" · "+per.toLocaleString("ru-RU")+" ₽/"+base:""),
      altTotal:function(qty){return numRu(qty*ratio)+" "+base+" по "+per.toLocaleString("ru-RU")+" ₽";}
    };
  }
  if(p.mode==="m2"&&Number(p.sheetM2)>0){
    const r=Number(p.sheetM2), perSheet=Math.round(uc*r);
    return {
      views:[{unit:"м²",price:uc},{unit:"лист",price:perSheet}], def:0,
      footer:"1 лист = "+numRu(r)+" м² · "+perSheet.toLocaleString("ru-RU")+" ₽/лист",
      altTotal:function(qty){const sheets=r>0?Math.round(qty/r*100)/100:0;return numRu(sheets)+" лист по "+perSheet.toLocaleString("ru-RU")+" ₽";}
    };
  }
  if(p.mode==="mp"&&Number(p.lenPer)>0){
    const L=Number(p.lenPer), perPiece=Math.round(uc*L);
    return {
      views:[{unit:"м.п.",price:uc},{unit:"хлыст",price:perPiece}], def:0,
      footer:"1 хлыст = "+numRu(L)+" м.п. · "+perPiece.toLocaleString("ru-RU")+" ₽/хлыст",
      altTotal:function(qty){const need=L>0?Math.ceil(qty/L):0;return need+" хлыст ("+numRu(need*L)+" м.п.) по "+perPiece.toLocaleString("ru-RU")+" ₽";}
    };
  }
  return null;
}
function expViewIdx(p,conv){ const v=expView[p.id]; return (v==="1")?1:(v==="0"?0:conv.def); }
function expRowHtml(p){
  const mode=EXP_MODES.find(function(x){return x.k===p.mode;})||EXP_MODES[0];
  const saleUnit=mode.unit;
  const uc=Number(p.unitCost)||0;
  const conv=expConv(p);
  const idx=conv?expViewIdx(p,conv):0;
  const big=conv?conv.views[idx].price:uc;
  const bigUnit=conv?conv.views[idx].unit:saleUnit;
  const storeColor=SC[p.store]||"#16a085";
  // безопасная ссылка: только http(s) + экранирование (защита от javascript:-схемы и брейкаута из атрибута)
  const safeUrl=(typeof p.url==="string"&&/^https?:\/\//i.test(p.url))?p.url.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"):null;
  const grad={piece:"#2980b9,#1f6391",pack:"#16a085,#0d6e5d",mp:"#e67e22,#b8631a",m2:"#8e44ad,#6c3483",sheet:"#0e7490,#0c5e74"}[p.mode]||"#16a085,#0d6e5d";
  return `
  <div data-exp-open="${p.id}" style="background:#fff;border-radius:14px;border:1px solid #e6ecf3;box-shadow:0 2px 8px rgba(20,40,70,0.04);padding:11px 12px;margin-bottom:8px;cursor:pointer">
    <div style="display:flex;gap:11px;align-items:flex-start">
      <div style="width:46px;height:46px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px;background:linear-gradient(135deg,${grad})">${p.photo?`<img src="${p.photo}" style="width:100%;height:100%;border-radius:11px;object-fit:cover">`:p.emoji}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:700;color:#0d1b2e;line-height:1.25">${p.name}</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;align-items:center">
          ${safeUrl?`<a href="${safeUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:10px;font-weight:700;background:${storeColor};color:#fff;border-radius:5px;padding:1px 7px;text-decoration:none">${esc(p.store)} ↗</a>`:`<span style="font-size:10px;font-weight:700;background:${storeColor};color:#fff;border-radius:5px;padding:1px 7px">${esc(p.store)}</span>`}
          <span style="font-size:10px;font-weight:700;color:#5a7a9a;background:#eef2f7;border-radius:5px;padding:1px 7px">${mode.icon} ${mode.label}</span>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:17px;font-weight:800;color:#0d1b2e;white-space:nowrap">${big.toLocaleString("ru-RU")} ₽</div>
        <div style="font-size:10px;color:#9aabbf">за ${bigUnit}</div>
      </div>
    </div>
    ${conv?`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;padding-top:9px;border-top:1px dashed #eef2f7">
      <span style="font-size:11px;color:#7a9aaa">${conv.footer}</span>
      <span style="display:inline-flex;border:1px solid #d0dae8;border-radius:18px;overflow:hidden;flex-shrink:0">
        <button data-exp-tg="0" data-id="${p.id}" style="border:none;cursor:pointer;font-size:10px;font-weight:700;padding:3px 10px;border-radius:18px;background:${idx===0?"#2a3142":"transparent"};color:${idx===0?"#fff":"#7a9aaa"}">${conv.views[0].unit}</button>
        <button data-exp-tg="1" data-id="${p.id}" style="border:none;cursor:pointer;font-size:10px;font-weight:700;padding:3px 10px;border-radius:18px;background:${idx===1?"#2a3142":"transparent"};color:${idx===1?"#fff":"#7a9aaa"}">${conv.views[1].unit}</button>
      </span>
    </div>`:``}
  </div>`;
}
// ── СМЕТЫ: сборка из материалов каталога ─────────────────────────
function estProd(pid){return expProducts.find(function(p){return p.id===pid;});}
function estLineTotal(line){var p=estProd(line.pid);return p?Math.round((Number(p.unitCost)||0)*(Number(line.qty)||0)):0;}
function estTotal(e){return (e.lines||[]).reduce(function(a,l){return a+estLineTotal(l);},0);}
// Построение работы шаблона из сметы (cost = итог сметы, mats = пер-юнит разбивка)
function _tplEstWork(e){
  var mats=(e.lines||[]).map(function(l){var p=estProd(l.pid)||{};return {id:gid(), n:p.name||"", store:p.store||"", url:p.url||"", note:"", cost:Number(p.unitCost)||0, qty:Number(l.qty)||1, mode:p.mode||"piece", unitCost:Number(p.unitCost)||0, packBase:p.packBase, packPer:p.packPer, lenPer:p.lenPer, sheetM2:p.sheetM2};});
  var matSum=mats.reduce(function(a,m){return a+(Number(m.cost)||0)*(m.qty||0);},0);
  var total=Number(e.cost)||matSum;
  return {id:gid(), estId:e.id, n:e.name, cost:total, labor:Math.max(0,total-matSum), note:"", mats:mats};
}
// Пересборка этапов шаблона из набора id выбранных смет
function _tplRebuild(t, ids){
  var existing={}; (t.stages||[]).forEach(function(s){(s.works||[]).forEach(function(w){if(w.estId)existing[w.estId]=w;});});
  var out=[];
  function stageObj(n){
    var st=EST_STAGES.find(function(x){return x.n===n;});
    var key=st?st.n:0;
    var f=out.find(function(s){return s._k===key;});
    if(f)return f;
    var ns={id:gid(), _k:key, n:st?(st.short.toUpperCase()+" — "+st.label.toUpperCase()):"БЕЗ ЭТАПА", c:st?st.color:"#7a9aaa", works:[]};
    out.push(ns); return ns;
  }
  estimates.forEach(function(e){ if(ids.indexOf(e.id)<0)return; var n=EST_STAGES.find(function(x){return x.n===Number(e.stage);})?Number(e.stage):0; stageObj(n).works.push(existing[e.id]||_tplEstWork(e)); });
  out.sort(function(a,b){return (a._k||99)-(b._k||99);});
  t.stages=out;
}
function renderEstimates(){
  var el=document.getElementById("dbest-list");
  if(!el)return;
  var _act=(document.activeElement&&document.activeElement.id)||"";
  if(estOpenId){
    var e=estimates.find(function(x){return x.id===estOpenId;});
    if(!e){estOpenId=null;return renderEstimates();}
    if(estPicking){
      var q=(estPickSearch||"").trim().toLowerCase();
      var list=q?expProducts.filter(function(p){return (p.name||"").toLowerCase().indexOf(q)>=0||(p.store||"").toLowerCase().indexOf(q)>=0;}):expProducts;
      el.innerHTML=
        '<button id="est-pick-back" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;padding:7px 12px;background:#fff;border:1px solid #dde6f0;border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;color:#5a7a9a">← Отмена</button>'+
        '<div style="margin-bottom:10px"><input id="est-pick-search" value="'+(estPickSearch||"").replace(/"/g,"&quot;")+'" placeholder="🔍 Поиск материала..." style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #dde6f0;font-size:13px;outline:none;box-sizing:border-box"></div>'+
        list.map(function(p){var mo=EXP_MODES.find(function(x){return x.k===(p.mode||"piece");})||EXP_MODES[0];var conv=expConv(p);
          return '<div class="est-pick" data-pid="'+p.id+'" style="background:#fff;border:1px solid #e6ecf3;border-radius:11px;padding:9px 11px;margin-bottom:7px;cursor:pointer;display:flex;align-items:center;gap:9px">'+
            '<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:700;color:#0d1b2e">'+p.name+'</div>'+
            '<div style="font-size:10px;color:#7a9aaa;margin-top:2px">'+(p.store?p.store+' · ':'')+mo.icon+' '+mo.label+'</div>'+
            (conv?'<div style="font-size:10px;color:#7a9aaa;margin-top:2px">'+conv.footer+'</div>':'')+'</div>'+
            '<div style="font-size:13px;font-weight:800;color:#16a085;white-space:nowrap">'+(Number(p.unitCost)||0).toLocaleString("ru-RU")+' ₽<span style="font-size:10px;color:#9aabbf;font-weight:600">/'+mo.unit+'</span></div>'+
          '</div>';
        }).join("")+
        (list.length?'':'<div style="text-align:center;color:#aaa;font-size:13px;padding:20px">Ничего не найдено</div>');
      var sb=document.getElementById("est-pick-back"); if(sb)sb.onclick=function(){estPicking=false;estPickSearch="";renderEstimates();};
      var ps=document.getElementById("est-pick-search");
      if(ps){ ps.oninput=function(){estPickSearch=this.value;renderEstimates();}; if(_act==="est-pick-search"){ps.focus();var L=ps.value.length;try{ps.setSelectionRange(L,L);}catch(_e){}} }
      el.querySelectorAll(".est-pick").forEach(function(c){c.onclick=function(){
        var pid=c.dataset.pid; var ln=e.lines.find(function(l){return l.pid===pid;});
        if(ln){ln.qty=(Number(ln.qty)||0)+1;} else {e.lines.push({pid:pid,qty:1});}
        estPicking=false;estPickSearch="";renderEstimates();
      };});
      return;
    }
    el.innerHTML=
      '<button id="est-back" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;padding:7px 12px;background:#fff;border:1px solid #dde6f0;border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;color:#5a7a9a">← К сметам</button>'+
      '<div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 4px 16px rgba(20,40,70,0.05);overflow:hidden">'+
        '<div style="padding:14px 16px 8px"><input id="est-name" value="'+(e.name||"").replace(/"/g,"&quot;")+'" placeholder="Название сметы" style="width:100%;border:none;outline:none;font-size:17px;font-weight:800;color:#0d1b2e;background:transparent"></div>'+
        '<div style="padding:0 16px 10px"><div style="font-size:10px;font-weight:700;color:#9aabbf;letter-spacing:0.5px;margin-bottom:6px">ЭТАП РАБОТ</div>'+
          '<div style="display:flex;gap:6px">'+EST_STAGES.map(function(st){var on=(Number(e.stage)||0)===st.n;
            return '<button class="est-stage" data-st="'+st.n+'" style="flex:1;border:1.5px solid '+(on?st.color:"#dde6f0")+';background:'+(on?st.color:"#fff")+';color:'+(on?"#fff":"#7a9aaa")+';border-radius:9px;padding:7px 2px;font-size:11px;font-weight:700;line-height:1.25;cursor:pointer"><div style="font-size:13px">'+st.n+'</div>'+st.label+'</button>';
          }).join("")+'</div>'+
        '</div>'+
        '<div style="padding:0 12px">'+
          (e.lines.length?e.lines.map(function(l,i){var p=estProd(l.pid);if(!p)return '';var mo=EXP_MODES.find(function(x){return x.k===(p.mode||"piece");})||EXP_MODES[0];var conv=expConv(p);
            return '<div style="display:flex;align-items:center;gap:7px;padding:9px 4px;border-bottom:1px solid #f0f4f8">'+
              '<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600;color:#1a2a3a;line-height:1.25">'+p.name+'</div>'+
              '<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:3px">'+
                (p.store?'<span style="font-size:9px;font-weight:700;background:'+(SC[p.store]||"#666")+';color:#fff;border-radius:4px;padding:1px 6px">'+p.store+'</span>':'')+
                '<span style="font-size:10px;color:#9aabbf">'+(Number(p.unitCost)||0).toLocaleString("ru-RU")+' ₽/'+mo.unit+'</span>'+
                (p.url?'<a href="'+p.url+'" target="_blank" rel="noopener" style="font-size:9px;color:#fff;background:#2980b9;border-radius:4px;padding:1px 6px;text-decoration:none;font-weight:700">🔗 купить</a>':'')+
              '</div>'+
              (conv?'<div style="font-size:10px;color:#7a9aaa;margin-top:3px">'+conv.footer+'</div>':'')+
              '</div>'+
              '<input class="est-q" data-i="'+i+'" type="number" step="any" value="'+(l.qty)+'" style="width:52px;padding:6px 4px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;text-align:center;outline:none">'+
              '<span style="font-size:10px;color:#9aabbf;width:26px">'+mo.unit+'</span>'+
              '<span id="est-lt-'+i+'" style="font-size:13px;font-weight:800;color:#0d1b2e;width:72px;text-align:right;white-space:nowrap">'+estLineTotal(l).toLocaleString("ru-RU")+' ₽</span>'+
              '<button class="est-del" data-i="'+i+'" style="width:24px;height:24px;flex-shrink:0;background:transparent;border:1px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:11px">✕</button>'+
            '</div>';
          }).join(""):'<div style="text-align:center;color:#aaa;font-size:12px;padding:16px">Пока пусто — добавьте материалы</div>')+
        '</div>'+
        '<div style="padding:10px 12px"><button id="est-add" style="width:100%;padding:10px;background:#eef6f4;border:1px dashed #16a085;border-radius:10px;cursor:pointer;color:#16a085;font-size:13px;font-weight:700">+ Добавить материал</button></div>'+
        '<div style="margin:0 12px 12px;padding:13px 14px;background:#0d1b2e;border-radius:12px;color:#fff;display:flex;align-items:center;justify-content:space-between">'+
          '<span style="font-size:12px;color:#9fb3c8;font-weight:600">Итого по смете</span>'+
          '<span id="est-grand" style="font-size:21px;font-weight:800">'+estTotal(e).toLocaleString("ru-RU")+' ₽</span>'+
        '</div>'+
        '<div style="padding:0 12px 12px"><button id="est-delete" style="width:100%;padding:9px;background:#fff;border:1px solid #e74c3c55;border-radius:9px;cursor:pointer;color:#e74c3c;font-size:12px;font-weight:700">Удалить смету</button></div>'+
      '</div>';
    var bk=document.getElementById("est-back"); if(bk)bk.onclick=function(){estOpenId=null;renderEstimates();};
    var nm=document.getElementById("est-name"); if(nm){nm.oninput=function(){e.name=this.value;}; if(_act==="est-name"){nm.focus();var L=nm.value.length;try{nm.setSelectionRange(L,L);}catch(_e){}}}
    var ad=document.getElementById("est-add"); if(ad)ad.onclick=function(){estPicking=true;estPickSearch="";renderEstimates();};
    el.querySelectorAll(".est-stage").forEach(function(b){b.onclick=function(){e.stage=+b.dataset.st;renderEstimates();};});
    el.querySelectorAll(".est-q").forEach(function(inp){inp.oninput=function(){
      var i=+inp.dataset.i; e.lines[i].qty=parseFloat(this.value)||0;
      var lts=document.getElementById("est-lt-"+i); if(lts)lts.textContent=estLineTotal(e.lines[i]).toLocaleString("ru-RU")+" ₽";
      var gt=document.getElementById("est-grand"); if(gt)gt.textContent=estTotal(e).toLocaleString("ru-RU")+" ₽";
    };});
    el.querySelectorAll(".est-del").forEach(function(b){b.onclick=function(){var i=+b.dataset.i;e.lines.splice(i,1);renderEstimates();};});
    var dl=document.getElementById("est-delete"); if(dl)dl.onclick=function(){estimates=estimates.filter(function(x){return x.id!==e.id;});estOpenId=null;renderEstimates();};
    return;
  }
  var _q=(estSearch||"").trim().toLowerCase();
  var _fl=estimates.filter(function(e){return (e.kind||"banya")===estKind;}).filter(function(e){return !_q||(e.name||"").toLowerCase().indexOf(_q)>=0;});
  function estCardHtml(e){var t=estTotal(e),n=(e.lines||[]).length;
    return '<div class="est-card" data-id="'+e.id+'" style="background:#fff;border-radius:14px;border:1px solid #e6ecf3;box-shadow:0 2px 8px rgba(20,40,70,0.04);padding:13px 14px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:10px">'+
      '<div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;background:linear-gradient(135deg,#16a085,#0d6e5d)">🧾</div>'+
      '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:#0d1b2e;line-height:1.25">'+e.name+'</div>'+
      '<div style="font-size:11px;color:#9aabbf;margin-top:2px">'+n+' поз.</div></div>'+
      '<div style="font-size:16px;font-weight:800;color:#0d1b2e;white-space:nowrap">'+t.toLocaleString("ru-RU")+' ₽</div>'+
    '</div>';
  }
  var _groups=[];
  EST_STAGES.forEach(function(st){var items=_fl.filter(function(e){return Number(e.stage)===st.n;});if(items.length)_groups.push({st:st,items:items});});
  var _noStage=_fl.filter(function(e){return !EST_STAGES.find(function(x){return x.n===Number(e.stage);});});
  if(_noStage.length)_groups.push({st:null,items:_noStage});
  el.innerHTML=
    '<div style="display:flex;gap:6px;margin-bottom:10px">'+
      '<button class="est-kind" data-k="banya" style="flex:1;padding:9px 6px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;border:2px solid '+(estKind==="banya"?"#16a085":"#dde6f0")+';background:'+(estKind==="banya"?"#16a085":"#fff")+';color:'+(estKind==="banya"?"#fff":"#7a9aaa")+'">🛁 Баня</button>'+
      '<button class="est-kind" data-k="house" style="flex:1;padding:9px 6px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;border:2px solid '+(estKind==="house"?"#16a085":"#dde6f0")+';background:'+(estKind==="house"?"#16a085":"#fff")+';color:'+(estKind==="house"?"#fff":"#7a9aaa")+'">🏠 Дом</button>'+
    '</div>'+
    '<div style="margin-bottom:10px"><input id="est-search" value="'+(estSearch||"").replace(/"/g,"&quot;")+'" placeholder="🔍 Поиск по названию работы..." style="width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid #dde6f0;font-size:13px;outline:none;box-sizing:border-box"></div>'+
    '<button id="est-new" style="width:100%;margin-bottom:6px;padding:11px;background:#16a085;border:none;border-radius:11px;cursor:pointer;color:#fff;font-size:13px;font-weight:700">+ Новая смета</button>'+
    (_fl.length?_groups.map(function(g){
      var head=g.st
        ? '<div style="display:flex;align-items:center;gap:7px;margin:16px 2px 8px"><span style="width:9px;height:9px;border-radius:50%;background:'+g.st.color+';flex-shrink:0"></span><span style="font-size:11px;font-weight:800;letter-spacing:0.5px;color:'+g.st.color+'">'+g.st.short.toUpperCase()+' · '+g.st.label.toUpperCase()+'</span><span style="font-size:10px;color:#9aabbf">· '+g.items.length+'</span></div>'
        : '<div style="margin:16px 2px 8px;font-size:11px;font-weight:800;letter-spacing:0.5px;color:#9aabbf">БЕЗ ЭТАПА · '+g.items.length+'</div>';
      return head+g.items.map(estCardHtml).join("");
    }).join(""):'<div style="text-align:center;color:#aaa;font-size:13px;padding:20px">'+(_q?'Ничего не найдено':'Смет пока нет')+'</div>');
  el.querySelectorAll(".est-kind").forEach(function(b){b.onclick=function(){estKind=b.dataset.k;estSearch="";renderEstimates();};});
  var es=document.getElementById("est-search");
  if(es){ es.oninput=function(){estSearch=this.value;renderEstimates();}; if(_act==="est-search"){es.focus();var L2=es.value.length;try{es.setSelectionRange(L2,L2);}catch(_e){}} }
  var nw=document.getElementById("est-new"); if(nw)nw.onclick=function(){var ne={id:gid(),kind:estKind,name:"Новая смета",lines:[]};estimates.unshift(ne);estOpenId=ne.id;renderEstimates();};
  el.querySelectorAll(".est-card").forEach(function(c){c.onclick=function(){estOpenId=c.dataset.id;renderEstimates();};});
}
function renderExpCard(containerId){
  if(containerId)expContainer=containerId;
  const el=document.getElementById(expContainer);
  if(!el)return;
  // Режим редактора одного товара
  if(expOpenId){
    const p=expProducts.find(function(x){return x.id===expOpenId;});
    if(p){ el.innerHTML=expEditorHtml(p); bindExpEditor(p); return; }
    expOpenId=null;
  }
  // Режим списка: поиск + отфильтрованные карточки
  const q=(expSearch||"").trim().toLowerCase();
  const list=q?expProducts.filter(function(p){return (p.name||"").toLowerCase().indexOf(q)>=0||(p.store||"").toLowerCase().indexOf(q)>=0;}):expProducts;
  // Был ли фокус в поиске ДО перерисовки — чтобы не выдёргивать клавиатуру при тапе на переключатель
  const _wasSearch=document.activeElement&&document.activeElement.id==="exp-search";
  el.innerHTML=
    '<div style="position:relative;margin-bottom:12px">'+
      '<input id="exp-search" value="'+(expSearch||"").replace(/"/g,"&quot;")+'" placeholder="🔍 Поиск по названию или магазину..." style="width:100%;padding:10px 34px 10px 12px;border-radius:10px;border:1.5px solid #dde6f0;font-size:13px;outline:none;box-sizing:border-box">'+
      (expSearch?'<button id="exp-search-clear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:22px;height:22px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:6px;cursor:pointer;font-size:11px;color:#7a9aaa">✕</button>':'')+
    '</div>'+
    '<button id="exp-add" style="width:100%;margin-bottom:12px;padding:11px;background:#16a085;border:none;border-radius:11px;cursor:pointer;color:#fff;font-size:13px;font-weight:700">+ Добавить товар</button>'+
    (list.length?list.map(expRowHtml).join(""):'<div style="text-align:center;color:#aaa;font-size:13px;padding:24px">Ничего не найдено</div>');
  const si=document.getElementById("exp-search");
  if(si){ si.oninput=function(){expSearch=this.value;renderExpCard();}; if(_wasSearch){ si.focus(); const L=si.value.length; try{si.setSelectionRange(L,L);}catch(e){} } }
  const sc=document.getElementById("exp-search-clear");
  if(sc)sc.onclick=function(){expSearch="";renderExpCard();};
  const ab=document.getElementById("exp-add");
  if(ab)ab.onclick=function(){
    const np={id:gid(),emoji:"📦",name:"Новый товар",store:"",url:"",photo:"",mode:"piece",unitCost:0,qty:1};
    expProducts.unshift(np);
    expOpenId=np.id;
    renderExpCard();
  };
  el.querySelectorAll("[data-exp-tg]").forEach(function(b){b.onclick=function(ev){if(ev)ev.stopPropagation();expView[b.dataset.id]=b.dataset.expTg;renderExpCard();};});
  el.querySelectorAll("[data-exp-open]").forEach(function(c){c.onclick=function(){expOpenId=c.dataset.expOpen;renderExpCard();};});
}

// ── ЭКСПЕРИМЕНТ: редактор товара (раскрывается по тапу) ─────────
function expField(id,label,value){
  return '<div style="flex:1;min-width:0">'+
    '<div style="font-size:10px;font-weight:700;color:#9aabbf;letter-spacing:0.4px;margin-bottom:4px">'+label.toUpperCase()+'</div>'+
    '<input id="'+id+'" value="'+(value===0?0:(value||''))+'" type="number" step="any" style="width:100%;padding:9px 10px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:14px;font-weight:600;color:#0d1b2e;outline:none;box-sizing:border-box">'+
  '</div>';
}
function _expRecalc(){
  const p=expProducts.find(function(x){return x.id===expOpenId;});
  if(!p)return;
  const mode=EXP_MODES.find(function(x){return x.k===p.mode;})||EXP_MODES[0];
  const saleUnit=mode.unit;
  const uc=Number(p.unitCost)||0, qty=Number(p.qty!=null?p.qty:1)||0;
  const total=Math.round(uc*qty);
  const conv=expConv(p);
  const idx=conv?expViewIdx(p,conv):0;
  const heroPrice=conv?conv.views[idx].price:uc;
  const set=function(id,txt){const e=document.getElementById(id);if(e)e.textContent=txt;};
  set("exp-hero",heroPrice.toLocaleString("ru-RU")+" ₽");
  set("exp-total",total.toLocaleString("ru-RU")+" ₽");
  const bd=document.getElementById("exp-breakdown");
  if(bd)bd.textContent=qty+" "+saleUnit+" × "+uc.toLocaleString("ru-RU")+" ₽"+(conv?" · "+conv.altTotal(qty):"");
}
function expEditorHtml(p){
  const mode=EXP_MODES.find(function(x){return x.k===p.mode;})||EXP_MODES[0];
  const saleUnit=mode.unit;
  const uc=Number(p.unitCost)||0, qty=Number(p.qty!=null?p.qty:1)||0;
  const total=Math.round(uc*qty);
  const base=p.packBase||"м²", packPer=Number(p.packPer)||0, sheetM2=Number(p.sheetM2)||0, lenPer=Number(p.lenPer)||0;
  const showPack=(p.mode==="pack"||p.mode==="sheet"); // продаётся ед., содержащей base-единицы
  const showSheet=(p.mode==="m2");                    // продаётся за м², пересчёт в лист
  const showMp=(p.mode==="mp");                        // продаётся хлыстами фиксированной длины
  const conv=expConv(p);
  const idx=conv?expViewIdx(p,conv):0;
  const storeColor=SC[p.store]||"#16a085";
  const heroPrice=conv?conv.views[idx].price:uc;
  const heroUnit=conv?conv.views[idx].unit:saleUnit;
  return `
  <button id="exp-back" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;padding:7px 12px;background:#fff;border:1px solid #dde6f0;border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;color:#5a7a9a">← К списку</button>
  <div style="background:#fff;border-radius:18px;border:1px solid #e2e8f0;box-shadow:0 6px 22px rgba(20,40,70,0.06);overflow:hidden">
    <div style="display:flex;gap:12px;padding:16px 16px 12px">
      <label style="width:66px;height:66px;border-radius:14px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;background:linear-gradient(135deg,#16a085,#0d6e5d);box-shadow:0 4px 12px rgba(22,160,133,0.35);position:relative;overflow:hidden">
        ${p.photo?`<img src="${p.photo}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`:(p.emoji||"📦")}
        <input id="exp-photo" type="file" accept="image/*" style="display:none">
      </label>
      <div style="flex:1;min-width:0">
        <input id="exp-name" value="${(p.name||"").replace(/"/g,"&quot;")}" placeholder="Название товара" style="width:100%;border:none;outline:none;font-size:16px;font-weight:800;color:#0d1b2e;padding:2px 0;background:transparent">
        <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
          <span style="width:9px;height:9px;border-radius:50%;background:${storeColor};flex-shrink:0"></span>
          <input id="exp-store" value="${(p.store||"").replace(/"/g,"&quot;")}" placeholder="Магазин" style="border:none;outline:none;font-size:12px;font-weight:700;color:#5a7a9a;background:transparent;width:108px">
          <input id="exp-url" value="${(p.url||"").replace(/"/g,"&quot;")}" placeholder="ссылка на товар" style="flex:1;min-width:0;border:none;outline:none;font-size:11px;color:#9aabbf;background:transparent;border-bottom:1px dashed #e2e8f0">
        </div>
      </div>
    </div>
    <div style="padding:4px 16px 0">
      <div style="font-size:10px;font-weight:700;color:#9aabbf;letter-spacing:0.6px;margin-bottom:6px">КАК ПРОДАЁТСЯ</div>
      <div style="display:flex;gap:6px;background:#f1f5f9;border-radius:12px;padding:4px">
        ${EXP_MODES.map(function(x){const on=x.k===p.mode;return `<button data-exp-mode="${x.k}" style="flex:1;min-width:0;border:none;cursor:pointer;border-radius:9px;padding:8px 1px;font-size:10px;font-weight:700;line-height:1.3;background:${on?"#16a085":"transparent"};color:${on?"#fff":"#5a7a9a"};box-shadow:${on?"0 2px 8px rgba(22,160,133,0.35)":"none"};transition:all .15s"><div style="font-size:16px">${x.icon}</div>${x.label}</button>`;}).join("")}
      </div>
    </div>
    <div style="margin:14px 16px;padding:14px 16px;background:linear-gradient(135deg,#f6fbfa,#eef6f4);border:1px solid #d6ebe5;border-radius:14px">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px">
        <div style="min-width:0">
          <div style="font-size:11px;color:#7a9aaa;font-weight:600">Цена за ${heroUnit}</div>
          <div style="margin-top:2px"><span id="exp-hero" style="font-size:26px;font-weight:800;color:#0d1b2e">${heroPrice.toLocaleString("ru-RU")} ₽</span></div>
        </div>
        ${conv?`<div style="display:inline-flex;border:1px solid #cfe4dd;border-radius:20px;overflow:hidden;background:#fff;flex-shrink:0">
          <button data-exp-view="0" style="border:none;cursor:pointer;font-size:11px;font-weight:700;padding:5px 11px;border-radius:20px;background:${idx===0?"#2a3142":"transparent"};color:${idx===0?"#fff":"#7a9aaa"}">${conv.views[0].unit}</button>
          <button data-exp-view="1" style="border:none;cursor:pointer;font-size:11px;font-weight:700;padding:5px 11px;border-radius:20px;background:${idx===1?"#2a3142":"transparent"};color:${idx===1?"#fff":"#7a9aaa"}">${conv.views[1].unit}</button>
        </div>`:``}
      </div>
      ${conv?`<div style="font-size:11px;color:#7a9aaa;margin-top:8px">${conv.footer}</div>`:``}
    </div>
    <div style="padding:0 16px">
      <div style="display:flex;gap:8px">
        ${expField("exp-uc","Цена за "+saleUnit+", ₽",uc)}
        ${expField("exp-qty","Количество, "+saleUnit,qty)}
      </div>
      ${showPack?`<div style="display:flex;gap:8px;margin-top:8px">${expField("exp-per","1 "+saleUnit+" = ? "+base,packPer||"")}<div style="flex:1"></div></div>
      <div style="margin-top:10px"><div style="font-size:10px;font-weight:700;color:#9aabbf;letter-spacing:0.5px;margin-bottom:5px">ЕДИНИЦА ВНУТРИ ${saleUnit==="лист"?"ЛИСТА":"ПАЧКИ"}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${EXP_BASE_UNITS.map(function(u){const on=u===base;return `<button data-exp-base="${u}" style="border:1px solid ${on?"#16a085":"#dde6f0"};background:${on?"#16a085":"#fff"};color:${on?"#fff":"#5a7a9a"};border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer">${u}</button>`;}).join("")}</div></div>`:``}
      ${showSheet?`<div style="display:flex;gap:8px;margin-top:8px">${expField("exp-sheetm2","1 лист = ? м²",sheetM2||"")}<div style="flex:1"></div></div>
      <div style="font-size:10px;color:#9aabbf;margin-top:5px">Заполни — на карточке появится переключатель м² / лист</div>`:``}
      ${showMp?`<div style="display:flex;gap:8px;margin-top:8px">${expField("exp-lenper","Длина 1 хлыста, м.п.",lenPer||"")}<div style="flex:1"></div></div>
      <div style="font-size:10px;color:#9aabbf;margin-top:5px">Если продаётся хлыстами (напр. по 3 м) — появится переключатель м.п. / хлыст</div>`:``}
    </div>
    <div style="margin:14px 16px 16px;padding:14px 16px;background:#0d1b2e;border-radius:14px;color:#fff">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;color:#9fb3c8;font-weight:600">Итого</span>
        <span id="exp-total" style="font-size:22px;font-weight:800">${total.toLocaleString("ru-RU")} ₽</span>
      </div>
      <div id="exp-breakdown" style="font-size:11px;color:#7e96b0;margin-top:4px">${qty} ${saleUnit} × ${uc.toLocaleString("ru-RU")} ₽${conv?` · ${conv.altTotal(qty)}`:``}</div>
    </div>
    <div style="padding:0 16px 16px">
      <button id="exp-done" style="width:100%;padding:11px;background:#16a085;border:none;border-radius:11px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">Готово</button>
    </div>
  </div>`;
}
function bindExpEditor(p){
  const el=document.getElementById(expContainer);
  if(!el)return;
  const back=function(){expOpenId=null;renderExpCard();};
  const bk=document.getElementById("exp-back"); if(bk)bk.onclick=back;
  const dn=document.getElementById("exp-done"); if(dn)dn.onclick=back;
  el.querySelectorAll("[data-exp-mode]").forEach(function(b){b.onclick=function(){p.mode=b.dataset.expMode;if((p.mode==="pack"||p.mode==="sheet")){if(!p.packBase)p.packBase="м²";if(!Number(p.packPer))p.packPer=1;}renderExpCard();};});
  el.querySelectorAll("[data-exp-base]").forEach(function(b){b.onclick=function(){p.packBase=b.dataset.expBase;renderExpCard();};});
  el.querySelectorAll("[data-exp-view]").forEach(function(b){b.onclick=function(){expView[p.id]=b.dataset.expView;renderExpCard();};});
  const bindText=function(id,field,num){const i=document.getElementById(id);if(i)i.oninput=function(){p[field]=num?(parseFloat(this.value)||0):this.value;_expRecalc();};};
  bindText("exp-name","name",false);
  bindText("exp-store","store",false);
  bindText("exp-url","url",false);
  bindText("exp-uc","unitCost",true);
  bindText("exp-qty","qty",true);
  bindText("exp-per","packPer",true);
  bindText("exp-sheetm2","sheetM2",true);
  bindText("exp-lenper","lenPer",true);
  const ph=document.getElementById("exp-photo");
  if(ph)ph.onchange=function(e){const f=e.target.files&&e.target.files[0];if(!f)return;const r=new FileReader();r.onload=function(ev){p.photo=ev.target.result;renderExpCard();};r.readAsDataURL(f);};
}

// ── КОМАНДА ──────────────────────────────────────────────────────
function buildClientSelector(selId, selectedName, searchId){
  const q=(ctClientSearch||"").trim().toLowerCase();
  const contractClients=crmClients.filter(function(cl){return cl.stage==="contract";});
  const otherClients=crmClients.filter(function(cl){return cl.stage!=="contract";});
  const allSorted=contractClients.concat(otherClients);
  const filtered=q?allSorted.filter(function(cl){
    return cl.name.toLowerCase().includes(q)||cl.phone.replace(/[^0-9]/g,"").includes(q.replace(/[^0-9]/g,""));
  }):allSorted;
  window._ctPickList=window._ctPickList||{};
  window._ctPickList[selId]=filtered;

  let html='<div style="margin-bottom:10px">'+
    '<div style="font-size:9px;color:#27ae60;font-weight:700;letter-spacing:0.5px;margin-bottom:5px">👤 КЛИЕНТ ИЗ CRM</div>'+
    '<input id="'+searchId+'" value="'+(ctClientSearch||'')+'" placeholder="🔍 Поиск по имени или телефону..." style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid #27ae6044;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:6px">'+
    '<div style="max-height:180px;overflow-y:auto;border:1px solid #d0dae8;border-radius:8px;background:#fff;position:relative;z-index:10">';

  if(!filtered.length) html+='<div style="padding:10px;text-align:center;font-size:12px;color:#aaa">Ничего не найдено</div>';

  filtered.forEach(function(cl,idx){
    const isContract=cl.stage==="contract";
    const isSelected=selectedName===cl.name;
    html+=
      '<div onclick="window._ctPick(this)" data-sid="'+selId+'" data-cid="'+cl.id+'" '+
      'style="display:flex;align-items:center;gap:8px;padding:14px 12px;cursor:pointer;user-select:none;min-height:48px;-webkit-tap-highlight-color:rgba(39,174,96,0.4);'+
      'background:'+(isSelected?'#27ae6015':'transparent')+';border-bottom:1px solid #f4f6f9">'+
        '<div style="flex:1;min-width:0;pointer-events:none">'+
          '<div style="font-size:13px;font-weight:'+(isSelected?700:500)+';color:'+(isSelected?'#27ae60':'#1a2a3a')+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none">'+
            (isSelected?'✓ ':'')+cl.name+
          '</div>'+
          '<div style="font-size:10px;color:#7a9aaa;margin-top:1px;pointer-events:none">'+cl.phone+
            (isContract?' · <span style="color:#27ae60;font-weight:700">Договор ✓</span>':' · <span style="color:#aaa">'+cl.stage+'</span>')+
          '</div>'+
        '</div>'+
      '</div>';
  });
  html+='</div>';
  // Show full CRM client card if selected
  const selectedClient=selectedName?crmClients.find(function(cl){return cl.name===selectedName;}):null;
  if(selectedClient){
    const stageNames={new:"Входящие",qualified:"Квалифицированный",kp:"Отправлено КП",meeting:"Встреча",contract:"Договор",montaj:"Монтаж"};
    // Find existing contracts for this client
    const existingContracts=contractDocs.filter(function(d){return d.client===selectedClient.name||d.crmClientId===selectedClient.id;});
    const totalMain=existingContracts.filter(function(d){return d.type==="main";}).reduce(function(a,d){return a+(d.amount||0);},0);
    const totalExtra=existingContracts.reduce(function(a,d){
      return a+(d.extraWorks||[]).reduce(function(b,w){
        return b+(w.cost||0)+(w.mats||[]).reduce(function(c,m){return c+(m.cost||0)*(m.qty||1);},0);
      },0);
    },0);

    html+='<div style="margin-top:8px;background:linear-gradient(135deg,#27ae6012,#27ae6006);border:1px solid #27ae6033;border-radius:12px;padding:10px 14px">';
    // Top: avatar + name + phone
    html+='<div style="display:flex;align-items:flex-start;gap:10px">'+
      '<div style="width:36px;height:36px;border-radius:10px;background:#27ae6020;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">👤</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:700;color:#1a2a3a">'+selectedClient.name+'</div>'+
        '<div style="font-size:11px;color:#5a7a9a;margin-top:2px">'+selectedClient.phone+'</div>'+
        '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">'+
          '<span style="font-size:10px;background:#27ae6015;color:#27ae60;border-radius:6px;padding:1px 8px;font-weight:700">📝 Этап: '+(stageNames[selectedClient.stage]||selectedClient.stage)+'</span>'+
        '</div>'+
        (selectedClient.msg?'<div style="font-size:11px;color:#7a9aaa;margin-top:4px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">«'+selectedClient.msg+'»</div>':'')+
      '</div>'+
    '</div>';

    // Existing contracts summary
    if(existingContracts.length){
      html+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #27ae6022">';
      html+='<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin-bottom:4px">📋 СУЩЕСТВУЮЩИЕ ДОГОВОРА КЛИЕНТА ('+existingContracts.length+')</div>';
      if(totalMain>0){
        html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:#5a7a9a;padding:2px 0"><span>Основной:</span><span style="font-weight:700;color:#2980b9">'+fmt(totalMain)+'</span></div>';
      }
      if(totalExtra>0){
        html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:#5a7a9a;padding:2px 0"><span>Доп. работы:</span><span style="font-weight:700;color:#8e44ad">'+fmt(totalExtra)+'</span></div>';
      }
      if(totalMain+totalExtra>0){
        html+='<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:#1a2a3a;padding:4px 0 0;border-top:1px dashed #d0dae8;margin-top:2px"><span>Итого:</span><span style="color:#27ae60">'+fmt(totalMain+totalExtra)+'</span></div>';
      }
      html+='</div>';
    }
    html+='</div>';
  } else if(selectedName){
    // Manual entry, no CRM match
    html+='<div style="margin-top:5px;font-size:12px;color:#7a9aaa;font-weight:600">Клиент: '+selectedName+' <span style="color:#aaa;font-weight:400">(вручную)</span></div>';
  }
  html+=''+
    '<input id="'+selId+'" type="hidden" value="'+(selectedName||'').replace(/"/g,"&quot;")+'"></div>';
  return html;
}


function tContracts(){
  if(contractView) return tContractDetail(contractView);
  return tContractList();
}

function tContractList(){
  const STATUS={
    draft:  {label:"Черновик",     color:"#7f8c8d"},
    signed: {label:"Подписан",     color:"#2980b9"},
    closed: {label:"Закрыт",       color:"#27ae60"},
  };

  let html='<div>';
  html+=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
      '<div>'+
        '<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ДОГОВОРА</div>'+
        '<div style="font-size:12px;color:#5a7a9a;margin-top:2px">'+contractDocs.length+' документов</div>'+
      '</div>'+
      '<button data-a="ct-add" style="padding:6px 14px;background:#2980b9;border:none;border-radius:8px;cursor:pointer;font-size:12px;color:#fff;font-weight:700">+ Договор</button>'+
    '</div>';

  // Add form
  if(contractAddForm){
    html+=
      '<div style="background:#fff;border-radius:12px;border:2px solid #2980b9;padding:14px;margin-bottom:14px">'+
        '<div style="font-size:13px;font-weight:700;color:#1a2a3a;margin-bottom:10px">Новый договор</div>'+
        // Object selector
        '<select id="ct-obj" data-a="ct-obj-change" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;background:#fff">'+
          '<option value=""'+(!contractNew.objId?' selected':'')+'>— Без объекта (черновик) —</option>'+
          objects.map(function(o){
            const sel=(contractNew.objId===o.id)?' selected':'';
            return'<option value="'+o.id+'"'+sel+'>'+o.icon+' '+o.name+'</option>';
          }).join("")+
        '</select>'+
        // Type
        '<div style="display:flex;gap:6px;margin-bottom:8px">'+
          '<button data-a="ct-type" data-t="main" style="flex:1;padding:6px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:'+(contractNew.type==="main"?'#2980b9':'#f0f4f8')+';color:'+(contractNew.type==="main"?'#fff':'#7a9aaa')+'">Основной</button>'+
          '<button data-a="ct-type" data-t="extra" style="flex:1;padding:6px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:'+(contractNew.type==="extra"?'#8e44ad':'#f0f4f8')+';color:'+(contractNew.type==="extra"?'#fff':'#7a9aaa')+'">Доп. работы</button>'+
        '</div>'+
        '<input id="ct-name" value="'+contractNew.name+'" placeholder="Название / номер договора" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;box-sizing:border-box">'+
        buildClientSelector('ct-client-sel', contractNew.client, 'ct-client-search')+
        '<div style="display:flex;gap:8px;margin-bottom:4px">'+
          '<input id="ct-amount" type="text" inputmode="numeric" data-money="1" value="'+fmtMoney(contractNew.amount)+'" placeholder="Сумма ₽" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none">'+
        '</div>'+
        '<div style="display:flex;gap:8px;margin-bottom:8px">'+
          '<div style="flex:1"><div style="font-size:9px;color:#7a9aaa;font-weight:700;margin-bottom:3px">📅 ПОДПИСАНИЕ</div><input id="ct-date" type="date" value="'+contractNew.signDate+'" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box"></div>'+
          '<div style="flex:1"><div style="font-size:9px;color:#e67e22;font-weight:700;margin-bottom:3px">🏁 ДЕДЛАЙН</div><input id="ct-deadline" type="date" value="'+(contractNew.deadlineDate||"")+'" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #e67e2255;font-size:13px;outline:none;box-sizing:border-box"></div>'+
        '</div>'+
        '<textarea id="ct-note" placeholder="Примечания" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;height:60px;resize:none;outline:none;margin-bottom:10px;box-sizing:border-box">'+contractNew.note+'</textarea>'+
        // Файлы (договор + планировка) — буфер contractNew.files
        (function(){
          function miniSection(kind,title,color){
            const files=(contractNew.files||[]).filter(function(f){return f.kind===kind;});
            let h='<div style="background:#fafbfc;border:1px solid '+color+'33;border-radius:9px;padding:9px 11px;margin-bottom:8px">';
            h+='<div style="display:flex;align-items:center;justify-content:space-between">'+
                 '<span style="font-size:10px;color:'+color+';font-weight:700">'+title+(files.length?' · '+files.length:'')+'</span>'+
                 '<label data-a="ct-new-file-label" data-kind="'+kind+'" style="padding:3px 10px;background:'+color+';border:none;border-radius:6px;cursor:pointer;color:#fff;font-size:11px;font-weight:700">+ Прикрепить<input id="ct-new-file-inp-'+kind+'" type="file" multiple style="display:none"></label>'+
               '</div>';
            if(files.length){
              h+='<div style="margin-top:6px">';
              files.forEach(function(f){
                h+='<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:#fff;border:1px solid #f0f3f7;border-radius:6px;margin-bottom:3px">'+
                     '<span style="font-size:13px">📄</span>'+
                     '<span style="flex:1;min-width:0;font-size:11px;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+f.name+'</span>'+
                     '<button data-a="ct-new-file-del" data-fid="'+f.id+'" style="width:22px;height:22px;background:transparent;border:1px solid #e74c3c44;border-radius:5px;cursor:pointer;color:#e74c3c;font-size:11px">✕</button>'+
                   '</div>';
              });
              h+='</div>';
            }
            h+='</div>';
            return h;
          }
          return '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">📎 ФАЙЛЫ</div>'+
                 miniSection("contract","📄 Файл договора","#2980b9")+
                 miniSection("plan","📐 Файл планировки","#8e44ad");
        })()+
        // Extra works block (visible always - main can have extras too)
        (function(){
          let extraHtml='';
          const ews=contractNew.extraWorks||[];
          const totalCost=ews.reduce(function(a,w){return a+(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);},0);
          extraHtml+='<div style="background:#fafbfc;border:1px solid #8e44ad44;border-radius:10px;padding:10px 12px;margin-bottom:10px">';
          extraHtml+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
            '<div style="font-size:10px;color:#8e44ad;font-weight:700;letter-spacing:1px">'+(contractNew.type==="extra"?"🔨 РАБОТЫ И МАТЕРИАЛЫ":"➕ ДОП. РАБОТЫ")+'</div>'+
            '<button data-a="ct-new-ew-add" style="padding:4px 10px;background:#8e44ad;border:none;border-radius:6px;cursor:pointer;font-size:11px;color:#fff;font-weight:600">+ Работа</button>'+
          '</div>';
          if(!ews.length){
            extraHtml+='<div style="font-size:11px;color:#aaa;text-align:center;padding:10px;border:1px dashed #e0e6ee;border-radius:8px">Нет работ. Нажмите + Работа</div>';
          } else {
            ews.forEach(function(ew,ewi){
              const matsTotal=(ew.mats||[]).reduce(function(a,m){return a+(m.cost||0)*(m.qty||1);},0);
              const wTotal=(ew.cost||0)+matsTotal;
              extraHtml+='<div style="background:#fff;border-radius:8px;padding:8px 10px;margin-bottom:6px;border-left:3px solid #8e44ad">';
              extraHtml+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">'+
                '<div style="flex:1;min-width:0">'+
                  '<div style="font-size:12px;font-weight:700;color:#1a2a3a">'+(ew.name||"Работа")+'</div>'+
                  '<div style="font-size:9px;color:#9aabbf">Этап: '+(ew.stage||"—")+'</div>'+
                '</div>'+
                '<div style="font-size:12px;font-weight:700;color:#8e44ad;white-space:nowrap">'+fmt(wTotal)+'</div>'+
                '<button data-a="ct-new-ew-del" data-ewi="'+ewi+'" style="padding:3px 7px;background:#e74c3c12;border:1px solid #e74c3c33;border-radius:5px;cursor:pointer;color:#e74c3c;font-size:9px">🗑</button>'+
              '</div>';
              extraHtml+='<div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">'+
                '<span style="font-size:9px;color:#7a9aaa;min-width:55px">Работа ₽:</span>'+
                '<input id="ct-new-ew-cost-'+ewi+'" type="text" inputmode="numeric" data-money="1" value="'+fmtMoney(ew.cost||0)+'" placeholder="0" style="flex:1;padding:4px 7px;border-radius:5px;border:1px solid #d0dae8;font-size:11px;outline:none;text-align:right">'+
                '<button data-a="ct-new-ew-save" data-ewi="'+ewi+'" style="padding:4px 7px;background:#8e44ad;border:none;border-radius:5px;cursor:pointer;color:#fff;font-size:10px;font-weight:700">💾</button>'+
              '</div>';
              const mats=ew.mats||[];
              if(mats.length){
                extraHtml+='<div style="font-size:9px;color:#7a9aaa;margin:6px 0 3px">📦 Материалы:</div>';
                mats.forEach(function(m,mi){
                  const mTotal=(m.cost||0)*(m.qty||1);
                  extraHtml+='<div style="display:flex;align-items:center;gap:4px;padding:3px 5px;background:#fafbfc;border-radius:5px;margin-bottom:2px;border:1px solid #f0f3f7">'+
                    '<div style="flex:1;min-width:0;font-size:10px;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+m.name+'</div>'+
                    '<input id="ct-new-ewm-qty-'+ewi+'-'+mi+'" type="number" value="'+(m.qty||1)+'" style="width:38px;padding:2px 4px;border-radius:4px;border:1px solid #d0dae8;font-size:10px;outline:none;text-align:center">'+
                    '<span style="font-size:9px;color:#9aabbf">×</span>'+
                    '<input id="ct-new-ewm-cost-'+ewi+'-'+mi+'" type="text" inputmode="numeric" data-money="1" value="'+fmtMoney(m.cost||0)+'" style="width:60px;padding:2px 4px;border-radius:4px;border:1px solid #d0dae8;font-size:10px;outline:none;text-align:right">'+
                    '<span style="font-size:9px;color:#27ae60;font-weight:700;min-width:50px;text-align:right">'+fmt(mTotal)+'</span>'+
                    '<button data-a="ct-new-ewm-save" data-ewi="'+ewi+'" data-mi="'+mi+'" style="padding:2px 4px;background:#27ae60;border:none;border-radius:3px;cursor:pointer;color:#fff;font-size:8px">💾</button>'+
                    '<button data-a="ct-new-ewm-del" data-ewi="'+ewi+'" data-mi="'+mi+'" style="padding:2px 4px;background:transparent;border:none;cursor:pointer;color:#e74c3c;font-size:10px">✕</button>'+
                  '</div>';
                });
              }
              extraHtml+='<button data-a="ct-new-ewm-add" data-ewi="'+ewi+'" style="width:100%;padding:4px;background:#27ae6012;border:1px dashed #27ae6044;border-radius:5px;cursor:pointer;color:#27ae60;font-size:9px;font-weight:600;margin-top:3px">+ Материал из базы</button>';
              extraHtml+='</div>';
            });
            extraHtml+='<div style="display:flex;justify-content:space-between;padding:6px 4px;margin-top:4px;border-top:1px solid #e0e6ee">'+
              '<span style="font-size:11px;font-weight:700;color:#1a2a3a">Итого:</span>'+
              '<span style="font-size:13px;font-weight:700;color:#8e44ad">'+fmt(totalCost)+'</span>'+
            '</div>';
          }
          extraHtml+='</div>';
          return extraHtml;
        })()+
        '<div style="display:flex;gap:6px">'+
          '<button data-a="ct-save" style="flex:1;padding:8px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Создать</button>'+
          '<button data-a="ct-cancel" style="padding:8px 14px;background:transparent;border:1px solid #d0dae8;border-radius:8px;cursor:pointer;font-size:12px;color:#7a9aaa">Отмена</button>'+
        '</div>'+
      '</div>';
  }

  if(!contractDocs.length){
    html+='<div style="background:#fff;border-radius:14px;border:2px dashed #dde6f0;padding:32px 20px;text-align:center">'+
      '<div style="font-size:40px;margin-bottom:10px">📄</div>'+
      '<div style="font-size:14px;font-weight:600;color:#5a7a9a;margin-bottom:4px">Нет договоров</div>'+
      '<div style="font-size:12px;color:#a0b4c8">Нажмите + Договор чтобы добавить</div>'+
    '</div>';
    return html+'</div>';
  }

  // Group by object
  const byObj={};
  const noObjDocs=[];
  contractDocs.forEach(function(c){
    if(!c.objId){ noObjDocs.push(c); return; }
    if(!byObj[c.objId])byObj[c.objId]=[];
    byObj[c.objId].push(c);
  });

  // Рендер одной карточки договора (используется в группах и в списке без объекта)
  function renderContractCard(c){
    const st=STATUS[c.status]||STATUS.draft;
    return '<div data-a="ct-open" data-cid="'+c.id+'" style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:8px;cursor:pointer;border-left:3px solid '+st.color+'">'+
        '<div style="display:flex;align-items:flex-start;gap:10px">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">'+
              '<span style="font-size:10px;font-weight:700;background:'+st.color+'18;color:'+st.color+';border-radius:5px;padding:1px 7px">'+st.label+'</span>'+
              '<span style="font-size:10px;background:'+(c.type==="main"?'#2980b918':'#8e44ad18')+';color:'+(c.type==="main"?'#2980b9':'#8e44ad')+';border-radius:5px;padding:1px 7px">'+(c.type==="main"?'Основной':'Доп. работы')+'</span>'+
              (!c.objId?'<span style="font-size:10px;background:#e67e2218;color:#e67e22;border-radius:5px;padding:1px 7px">📎 Без объекта</span>':'')+
            '</div>'+
            '<div style="font-size:13px;font-weight:700;color:#1a2a3a">'+c.name+'</div>'+
            (function(){
              const cl=c.crmClientId?crmClients.find(function(x){return x.id===c.crmClientId;}):crmClients.find(function(x){return x.name===c.client;});
              const phone=cl&&cl.phone?cl.phone:'';
              return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px">'+
                '<span style="font-size:11px;color:#7a9aaa">'+(c.client||'')+'</span>'+
                (phone?'<a href="tel:'+phone.replace(/[^0-9+]/g,'')+'" data-stop="1" style="font-size:11px;color:#2980b9;font-weight:600;text-decoration:none" onclick="event.stopPropagation()">📞 '+phone+'</a>':'')+
              '</div>';
            })()+
            (function(){
              // Чипы важных дат
              const dlInfo=contractDeadlineInfo(c.deadlineDate);
              let chips='';
              if(c.signDate) chips+='<span style="font-size:10px;color:#5a7a9a;background:#f0f4f8;border-radius:6px;padding:1px 8px;font-weight:600">📅 '+c.signDate+'</span>';
              if(c.deadlineDate) chips+='<span style="font-size:10px;font-weight:700;color:'+(dlInfo?dlInfo.color:"#e67e22")+';background:'+(dlInfo?dlInfo.color:"#e67e22")+'15;border-radius:6px;padding:1px 8px">🏁 '+c.deadlineDate+(dlInfo&&(dlInfo.overdue||dlInfo.color!=="#27ae60")?' · '+dlInfo.label:'')+'</span>';
              return chips?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">'+chips+'</div>':'';
            })()+
            (function(){
              const respIds=c.responsible||[];
              if(!respIds.length)return '';
              const respUsers=users.filter(function(u){return respIds.includes(u.id);});
              return '<div style="display:flex;align-items:center;gap:4px;margin-top:6px;flex-wrap:wrap">'+
                '<span style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.3px">ОТВЕТСТВЕННЫЕ:</span>'+
                respUsers.map(function(u){
                  return '<span style="display:inline-flex;align-items:center;gap:3px;background:'+u.c+'15;border:1px solid '+u.c+'33;border-radius:10px;padding:1px 7px;font-size:10px;color:'+u.c+';font-weight:600">'+u.av+' '+u.name+'</span>';
                }).join('')+
              '</div>';
            })()+
          '</div>'+
          '<div style="text-align:right;flex-shrink:0">'+
            '<div style="font-size:14px;font-weight:700;color:#1a2a3a">'+(c.amount?c.amount.toLocaleString("ru-RU")+' ₽':'—')+'</div>'+
            '<span style="font-size:12px;color:#c8d8e8">›</span>'+
          '</div>'+
        '</div>'+
      '</div>';
  }

  objects.forEach(function(obj){
    const docs=byObj[obj.id];
    if(!docs||!docs.length)return;
    html+='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:8px;margin-top:14px">'+obj.icon+' '+obj.name.toUpperCase()+'</div>';
    docs.forEach(function(c){ html+=renderContractCard(c); });
  });

  // Договоры без объекта — общим списком, без группы
  if(noObjDocs.length){
    html+='<div style="height:14px"></div>';
    noObjDocs.forEach(function(c){ html+=renderContractCard(c); });
  }

  html+='</div>';
  return html;
}

// Статус дедлайна договора: возвращает {daysLeft, overdue, color, label}
function contractDeadlineInfo(deadlineStr){
  if(!deadlineStr) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const d=new Date(deadlineStr+"T00:00:00");
  if(isNaN(d.getTime())) return null;
  const diff=Math.round((d-today)/86400000);
  if(diff<0) return {days:Math.abs(diff),overdue:true,color:"#e74c3c",label:"Просрочка "+Math.abs(diff)+" дн"};
  if(diff===0) return {days:0,overdue:false,color:"#e74c3c",label:"Сегодня дедлайн"};
  if(diff<=7) return {days:diff,overdue:false,color:"#f39c12",label:"Осталось "+diff+" дн"};
  return {days:diff,overdue:false,color:"#27ae60",label:"Осталось "+diff+" дн"};
}

// Рендер блока прикреплённых файлов договора (договор + планировка)
// Селектор способа оплаты (наличка/перевод) — показывается для приходных операций
function payMethodSelector(){
  if(finNewTxn.type!=="income") return "";
  const m=finNewTxn.method||"transfer";
  function btn(val,label,color){
    const on=m===val;
    return '<button type="button" data-a="fin-method" data-m="'+val+'" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;border:1.5px solid '+(on?color:"#dde6f0")+';background:'+(on?color:"#f8fafc")+';color:'+(on?"#fff":"#7a9aaa")+'">'+label+'</button>';
  }
  return '<div style="display:flex;gap:6px;margin-bottom:8px">'+btn("cash","💵 Наличка","#16a085")+btn("transfer","🏦 Перевод","#2980b9")+'</div>';
}
function payMethodLabel(m){ return m==="cash"?"💵 Наличка":(m==="transfer"?"🏦 Перевод":""); }

function buildContractFiles(c){
  function fileIcon(f){
    const mime=(f.mime||"").toLowerCase();
    const nm=(f.name||"").toLowerCase();
    if(mime.indexOf("image")===0||/\.(png|jpe?g|gif|webp|heic)$/.test(nm)) return "🖼";
    if(mime.indexOf("pdf")>=0||nm.endsWith(".pdf")) return "📕";
    if(/\.(docx?|rtf|odt)$/.test(nm)) return "📘";
    if(/\.(xlsx?|csv)$/.test(nm)) return "📗";
    return "📄";
  }
  function fmtSize(n){
    if(!n) return "";
    if(n<1024) return n+" Б";
    if(n<1024*1024) return Math.round(n/1024)+" КБ";
    return (n/1024/1024).toFixed(1)+" МБ";
  }
  function section(kind,title,color){
    const files=(c.files||[]).filter(function(f){return f.kind===kind;});
    let h='<div style="background:#fff;border-radius:12px;border:1px solid '+color+'33;padding:12px 14px;margin-bottom:10px">';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
         '<div style="font-size:10px;color:'+color+';font-weight:700;letter-spacing:0.5px">'+title+(files.length?' · '+files.length:'')+'</div>'+
         '<label data-a="ct-file-label" data-cid="'+c.id+'" data-kind="'+kind+'" style="padding:4px 11px;background:'+color+';border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:11px;font-weight:700">+ Прикрепить<input id="ct-file-inp-'+c.id+'-'+kind+'" type="file" multiple style="display:none"></label>'+
       '</div>';
    if(!files.length){
      h+='<div style="font-size:11px;color:#9aabbf;text-align:center;padding:12px;border:1px dashed '+color+'44;border-radius:8px">Нет файлов. Нажмите «+ Прикрепить»</div>';
    } else {
      files.forEach(function(f){
        const isImg=(f.mime||"").indexOf("image")===0;
        h+='<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;background:#fafbfc;border:1px solid #f0f3f7;border-radius:8px;margin-bottom:5px">';
        if(isImg){
          h+='<img src="'+f.data+'" style="width:34px;height:34px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid #e0e6ee" alt="">';
        } else {
          h+='<div style="width:34px;height:34px;border-radius:6px;background:'+color+'15;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0">'+fileIcon(f)+'</div>';
        }
        h+='<div style="flex:1;min-width:0">'+
             '<div style="font-size:12px;font-weight:600;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+f.name+'</div>'+
             '<div style="font-size:9px;color:#9aabbf">'+(f.date||"")+(f.size?' · '+fmtSize(f.size):'')+'</div>'+
           '</div>'+
           '<a href="'+f.data+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="padding:5px 10px;background:'+color+'18;border:1px solid '+color+'44;border-radius:6px;cursor:pointer;color:'+color+';font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap">Открыть</a>'+
           '<button data-a="ct-file-del" data-cid="'+c.id+'" data-fid="'+f.id+'" style="width:28px;height:28px;background:transparent;border:1px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:12px;flex-shrink:0">✕</button>'+
           '</div>';
      });
    }
    h+='</div>';
    return h;
  }
  let html='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin:14px 0 8px">📎 ФАЙЛЫ</div>';
  html+=section("contract","📄 ФАЙЛ ДОГОВОРА","#2980b9");
  html+=section("plan","📐 ФАЙЛ ПЛАНИРОВКИ","#8e44ad");
  return html;
}

function tContractDetail(cid){
  const c=contractDocs.find(function(x){return x.id===cid;});
  if(!c)return tContractList();
  const obj=objects.find(function(o){return o.id===c.objId;});
  const STATUS={draft:{label:"Черновик",color:"#7f8c8d"},signed:{label:"Подписан",color:"#2980b9"},closed:{label:"Закрыт",color:"#27ae60"}};
  const st=STATUS[c.status]||STATUS.draft;
  const responsible=c.responsible||[];
  const salaries=c.salaries||{};

  // Find linked CRM client
  const crmLinked=c.crmClientId?crmClients.find(function(cl){return cl.id===c.crmClientId;}):crmClients.find(function(cl){return cl.name===c.client&&cl.stage==="contract";});
  const CRM_STAGE_NAMES={new:"Входящие",qualified:"Квалифицированный",kp:"Отправлено КП",meeting:"Встреча",contract:"Договор",montaj:"Монтаж"};

  let html='<div>';

  // Header
  html+=
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'+
      '<button data-a="ct-back" style="padding:6px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Договора</button>'+
      '<div style="font-size:14px;font-weight:700;color:#0d1b2e;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</div>'+
    '</div>';

  // Важные даты — подписание и дедлайн
  (function(){
    const dlInfo=contractDeadlineInfo(c.deadlineDate);
    html+='<div style="display:flex;gap:8px;margin-bottom:10px">'+
      '<div style="flex:1;background:#fff;border:1px solid #dde6f0;border-radius:12px;padding:10px 12px">'+
        '<div style="font-size:9px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin-bottom:3px">📅 ПОДПИСАНИЕ</div>'+
        '<div style="font-size:14px;font-weight:700;color:#1a2a3a">'+(c.signDate||"—")+'</div>'+
      '</div>'+
      '<div style="flex:1;background:#fff;border:1px solid '+(dlInfo?dlInfo.color+"44":"#dde6f0")+';border-radius:12px;padding:10px 12px">'+
        '<div style="font-size:9px;color:#e67e22;font-weight:700;letter-spacing:0.5px;margin-bottom:3px">🏁 ДЕДЛАЙН</div>'+
        '<div style="font-size:14px;font-weight:700;color:#1a2a3a">'+(c.deadlineDate||"—")+'</div>'+
        (dlInfo?'<div style="font-size:9px;font-weight:700;color:'+dlInfo.color+';margin-top:2px">'+(dlInfo.overdue?"🔴 ":(dlInfo.color==="#f39c12"?"🟡 ":"🟢 "))+dlInfo.label+'</div>':'')+
      '</div>'+
    '</div>';
  })();

  // PIN клиента для входа в кабинет — только админ и менеджер по сопровождению
  (function(){
    const canSee=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("client_mgr"));
    if(!canSee) return;
    const eff=effectiveClientPin(c);
    const isCustom=c.clientPin&&c.clientPin.trim();
    html+='<div style="background:#fff;border:1px solid #d6890044;border-radius:12px;padding:12px 14px;margin-bottom:10px">'+
      '<div style="font-size:10px;color:#d68910;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">🔑 PIN КЛИЕНТА ДЛЯ ВХОДА</div>'+
      '<div style="font-size:11px;color:#7a9aaa;margin-bottom:8px">Клиент входит по номеру договора или фамилии + этот PIN. По умолчанию — последние 4 цифры его телефона'+(eff?' ('+eff+')':' (телефон не указан)')+'.</div>'+
      '<div style="display:flex;gap:6px">'+
        '<input id="ct-clientpin-'+c.id+'" type="text" inputmode="numeric" maxlength="6" value="'+(isCustom?c.clientPin:"")+'" placeholder="'+(eff||"PIN")+'" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:14px;outline:none;letter-spacing:3px;box-sizing:border-box">'+
        '<button data-a="ct-clientpin-save" data-cid="'+c.id+'" style="padding:8px 14px;background:#d68910;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Задать</button>'+
        (isCustom?'<button data-a="ct-clientpin-reset" data-cid="'+c.id+'" style="padding:8px 12px;background:transparent;border:1px solid #dde6f0;border-radius:8px;cursor:pointer;color:#7a9aaa;font-size:12px">Сброс</button>':'')+
      '</div>';
    html+='</div>';
  })();

  // CRM client card
  if(crmLinked){
    html+=
      '<div style="background:linear-gradient(135deg,#27ae6012,#27ae6006);border:1px solid #27ae6033;border-radius:12px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:flex-start;gap:10px">'+
        '<div style="width:36px;height:36px;border-radius:10px;background:#27ae6020;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">👤</div>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:700;color:#1a2a3a">'+crmLinked.name+'</div>'+
          '<div style="font-size:11px;color:#5a7a9a;margin-top:2px">'+crmLinked.phone+'</div>'+
          '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">'+
            '<span style="font-size:10px;background:#27ae6015;color:#27ae60;border-radius:6px;padding:1px 8px;font-weight:700">📝 Этап: '+(CRM_STAGE_NAMES[crmLinked.stage]||crmLinked.stage)+'</span>'+
            (crmLinked.notes?'<span style="font-size:10px;color:#7a9aaa;font-style:italic">'+crmLinked.notes+'</span>':'')+
          '</div>'+
          (crmLinked.msg?'<div style="font-size:11px;color:#7a9aaa;margin-top:4px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">«'+crmLinked.msg+'»</div>':'')+
        '</div>'+
        '<button data-a="ct-goto-crm" data-crmid="'+crmLinked.id+'" style="padding:4px 8px;background:#27ae60;border:none;border-radius:6px;cursor:pointer;font-size:10px;color:#fff;font-weight:700;flex-shrink:0;white-space:nowrap">→ CRM</button>'+
      '</div>';
  }

  // Status
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:10px">';
  html+='<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:8px">СТАТУС</div>';
  html+='<div style="display:flex;gap:6px">';
  Object.keys(STATUS).forEach(function(k){
    const s=STATUS[k];
    html+='<button data-a="ct-status" data-cid="'+c.id+'" data-s="'+k+'" style="flex:1;padding:7px 4px;border-radius:8px;border:none;cursor:pointer;font-size:11px;font-weight:700;background:'+(c.status===k?s.color:'#f0f4f8')+';color:'+(c.status===k?'#fff':'#7a9aaa')+'">'+s.label+'</button>';
  });
  html+='</div></div>';

  // Details — editable or view
  const isEditing=contractEditId===cid;
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:10px">';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
    '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ДЕТАЛИ</div>'+
    '<button data-a="ct-edit-toggle" data-cid="'+cid+'" style="padding:3px 10px;background:'+(isEditing?'#f0f4f8':'#2980b9')+';border:none;border-radius:6px;cursor:pointer;font-size:11px;color:'+(isEditing?'#7a9aaa':'#fff')+';font-weight:600">'+(isEditing?'✕ Отмена':'✏️ Изменить')+'</button>'+
  '</div>';

  if(isEditing){
    html+=
      '<select id="ct-edit-obj" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;background:#fff;box-sizing:border-box">'+
        '<option value=""'+(!c.objId?' selected':'')+'>— Без объекта —</option>'+
        objects.map(function(o){return'<option value="'+o.id+'"'+(c.objId===o.id?' selected':'')+'>'+o.icon+' '+o.name+'</option>';}).join("")+
      '</select>'+
      '<div style="display:flex;gap:6px;margin-bottom:8px">'+
        '<button data-a="ct-edit-type" data-cid="'+cid+'" data-t="main" style="flex:1;padding:6px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:'+(c.type==="main"?'#2980b9':'#f0f4f8')+';color:'+(c.type==="main"?'#fff':'#7a9aaa')+'">Основной</button>'+
        '<button data-a="ct-edit-type" data-cid="'+cid+'" data-t="extra" style="flex:1;padding:6px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:'+(c.type==="extra"?'#8e44ad':'#f0f4f8')+';color:'+(c.type==="extra"?'#fff':'#7a9aaa')+'">Доп. работы</button>'+
      '</div>'+
      '<input id="ct-edit-name" value="'+c.name.replace(/"/g,"&quot;")+'" placeholder="Название / номер" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;box-sizing:border-box">'+
      (c.status==="draft"?buildClientSelector('ct-edit-client-sel', c.client, 'ct-edit-client-search'):'<div style="margin-bottom:8px"><div style="font-size:9px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin-bottom:3px">КЛИЕНТ</div><div style="font-size:13px;font-weight:600;color:#1a2a3a;padding:8px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e8eef5">'+(c.client||'—')+'</div></div>')+
      '<div style="display:flex;gap:8px;margin-bottom:4px">'+
        '<input id="ct-edit-amount" type="text" inputmode="numeric" data-money="1" value="'+(c.amount?fmtMoney(c.amount):'')+'" placeholder="Сумма ₽" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none">'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-bottom:8px">'+
        '<div style="flex:1"><div style="font-size:9px;color:#7a9aaa;font-weight:700;margin-bottom:3px">📅 ПОДПИСАНИЕ</div><input id="ct-edit-date" type="date" value="'+(c.signDate||'')+'" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box"></div>'+
        '<div style="flex:1"><div style="font-size:9px;color:#e67e22;font-weight:700;margin-bottom:3px">🏁 ДЕДЛАЙН</div><input id="ct-edit-deadline" type="date" value="'+(c.deadlineDate||'')+'" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #e67e2255;font-size:13px;outline:none;box-sizing:border-box"></div>'+
      '</div>'+
      '<textarea id="ct-edit-note" placeholder="Примечания" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;height:60px;resize:none;outline:none;margin-bottom:10px;box-sizing:border-box">'+(c.note||'')+'</textarea>'+
      '<button data-a="ct-edit-save" data-cid="'+cid+'" style="width:100%;padding:9px;background:#27ae60;border:none;border-radius:9px;cursor:pointer;color:#fff;font-size:13px;font-weight:700">💾 Сохранить изменения</button>';
  } else {
    // Calculate extra works total
    const ewTotal=(c.extraWorks||[]).reduce(function(a,w){
      return a+(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);
    },0);
    const mainAmount=c.amount||0;
    const grandTotal=mainAmount+ewTotal;

    const rows=[
      {label:"Объект", val:obj?obj.icon+" "+obj.name:"—"},
      {label:"Тип",    val:c.type==="main"?"Основной":"Доп. работы"},
      {label:"Клиент", val:c.client||"—"},
      {label:"Дата",   val:c.signDate||"—"},
    ];
    rows.forEach(function(row){
      html+=
        '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f4f6f9">'+
          '<span style="font-size:12px;color:#7a9aaa">'+row.label+'</span>'+
          '<span style="font-size:12px;font-weight:600;color:#1a2a3a">'+row.val+'</span>'+
        '</div>';
    });

    // Sum breakdown
    html+='<div style="margin-top:8px;padding-top:8px;border-top:2px solid #e8eef5">';
    html+=
      '<div style="display:flex;justify-content:space-between;padding:4px 0">'+
        '<span style="font-size:12px;color:#7a9aaa">Основной договор</span>'+
        '<span style="font-size:13px;font-weight:700;color:#2980b9">'+(mainAmount?fmt(mainAmount):"—")+'</span>'+
      '</div>';
    if(ewTotal>0){
      html+=
        '<div style="display:flex;justify-content:space-between;padding:4px 0">'+
          '<span style="font-size:12px;color:#7a9aaa">Доп. работы</span>'+
          '<span style="font-size:13px;font-weight:700;color:#8e44ad">+'+fmt(ewTotal)+'</span>'+
        '</div>';
    }
    html+=
      '<div style="display:flex;justify-content:space-between;padding:6px 0;margin-top:4px;border-top:1px dashed #d0dae8">'+
        '<span style="font-size:13px;font-weight:700;color:#1a2a3a">ИТОГО</span>'+
        '<span style="font-size:15px;font-weight:700;color:#27ae60">'+(grandTotal?fmt(grandTotal):"—")+'</span>'+
      '</div>';
    html+='</div>';

    if(c.note) html+='<div style="margin-top:8px;font-size:12px;color:#5a7a9a;background:#f8fafc;border-radius:8px;padding:8px">'+c.note+'</div>';
  }
  html+='</div>';

  // Responsible — who manages this contract
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:10px">';
  html+='<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:8px">ОТВЕТСТВЕННЫЕ ЗА ДОГОВОР</div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
  users.forEach(function(u){
    const on=responsible.includes(u.id);
    html+=
      '<div data-a="ct-resp-toggle" data-cid="'+c.id+'" data-uid="'+u.id+'" style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:16px;cursor:pointer;background:'+(on?u.c:'#f4f6f8')+';border:1.5px solid '+(on?u.c:'#dde6f0')+'">'+
        '<span style="font-size:13px">'+u.av+'</span>'+
        '<span style="font-size:11px;font-weight:600;color:'+(on?'#fff':'#7a9aaa')+'">'+u.name+'</span>'+
        (on?'<span style="font-size:10px;color:rgba(255,255,255,0.8)">✓</span>':'')+
      '</div>';
  });
  html+='</div></div>';

  // ===== SALARY SECTIONS — managed here, used in финансы (read-only) =====
  function _renderSalSection(opts){
    // opts: {title, color, users, salaryKey}
    const us=opts.users;
    if(!us.length)return "";
    let h='<div style="background:#fff;border-radius:12px;border:1px solid '+opts.color+'33;padding:12px 14px;margin-bottom:10px">';
    h+='<div style="font-size:10px;color:'+opts.color+';font-weight:700;letter-spacing:1px;margin-bottom:10px">'+opts.title+'</div>';
    us.forEach(function(u){
      const ud=salaries[u.id]||{};
      const effPlan=ud.plan!=null&&ud.plan!==0?ud.plan:getDefaultSalary(u);
      const paid=getSalaryPaid(c,u);
      const left=Math.max(0,effPlan-paid);
      h+=
        '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #f4f6f9">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
            '<div style="width:30px;height:30px;border-radius:8px;background:'+u.c+';display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">'+u.av+'</div>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:12px;font-weight:700;color:#1a2a3a">'+u.name+'</div>'+
              '<div style="font-size:10px;color:#9aabbf">'+u.roles.map(function(r){const ro=roles.find(function(x){return x.id===r;});return ro?ro.n:"";}).filter(Boolean).join(", ")+'</div>'+
            '</div>'+
            (left>0?
              '<span style="font-size:10px;color:#e67e22;font-weight:700;background:#e67e2212;border-radius:6px;padding:2px 7px;white-space:nowrap">−'+left.toLocaleString("ru-RU")+'</span>':
              paid>0?'<span style="font-size:10px;color:#27ae60;font-weight:700;background:#27ae6012;border-radius:6px;padding:2px 7px">✓ Выпл.</span>':
              '<span style="font-size:10px;color:#9aabbf;background:#f0f4f8;border-radius:6px;padding:2px 7px">План</span>')+
          '</div>'+
          '<div style="display:flex;gap:6px;align-items:end">'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:9px;color:#9aabbf;margin-bottom:3px">ПЛАН ₽ (по умолчанию '+getDefaultSalary(u).toLocaleString("ru-RU")+')</div>'+
              '<input id="ctsal-plan-'+cid+'-'+u.id+'" type="text" inputmode="numeric" data-money="1" value="'+(ud.plan!=null&&ud.plan!==0?fmtMoney(ud.plan):"")+'" placeholder="'+getDefaultSalary(u).toLocaleString("ru-RU")+'" style="width:100%;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;text-align:right;box-sizing:border-box">'+
            '</div>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:9px;color:#9aabbf;margin-bottom:3px">ВЫПЛАЧЕНО ₽</div>'+
              '<div style="padding:6px 8px;border-radius:7px;border:1px solid #f0f4f8;background:#f8fafc;font-size:12px;text-align:right;color:'+(paid>0?"#27ae60":"#9aabbf")+';font-weight:600">'+paid.toLocaleString("ru-RU")+'</div>'+
            '</div>'+
            '<button data-a="ct-sal-save" data-cid="'+cid+'" data-uid="'+u.id+'" style="padding:7px 10px;background:'+u.c+';border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:13px;font-weight:700;flex-shrink:0">💾</button>'+
          '</div>'+
        '</div>';
    });
    // Totals
    let planT=0,paidT=0;
    us.forEach(function(u){
      const ud=salaries[u.id]||{};
      const ep=ud.plan!=null&&ud.plan!==0?ud.plan:getDefaultSalary(u);
      planT+=ep;
      paidT+=getSalaryPaid(c,u);
    });
    h+=
      '<div style="display:flex;justify-content:space-between;padding-top:4px">'+
        '<span style="font-size:11px;color:#7a9aaa">Итого план:</span>'+
        '<span style="font-size:11px;font-weight:700;color:#1a2a3a">'+planT.toLocaleString("ru-RU")+' ₽</span>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;margin-top:3px">'+
        '<span style="font-size:11px;color:#7a9aaa">Итого выплачено:</span>'+
        '<span style="font-size:11px;font-weight:700;color:#27ae60">'+paidT.toLocaleString("ru-RU")+' ₽</span>'+
      '</div>';
    h+='</div>';
    return h;
  }

  // Resolve eligible users from contract responsible list (NOT all in object)
  const respIds=c.responsible||[];
  const respUsers=users.filter(function(u){return respIds.includes(u.id);});
  const prodUsers=respUsers.filter(function(u){return u.roles.some(function(r){return r==="brigadier"||r==="worker";});});
  const escortUsers=respUsers.filter(function(u){return u.roles.includes("sales_head");});

  // Block 1: ЗАРПЛАТА ПРОИЗВОДСТВУ
  html+=_renderSalSection({title:"💼 ЗАРПЛАТА ПРОИЗВОДСТВУ",color:"#e67e22",users:prodUsers});

  // Block 1.5: ДЕДЛАЙНЫ БРИГАДИРОВ (only prod_head + admin can edit)
  if(prodUsers.length){
    const canEdit=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("prod_head"));
    html+='<div style="background:#fff;border-radius:12px;border:1px solid #d3580033;padding:12px 14px;margin-bottom:10px">';
    html+='<div style="font-size:11px;color:#d35800;font-weight:700;letter-spacing:0.5px;margin-bottom:10px">📅 ДЕДЛАЙНЫ БРИГАДИРОВ · 35 рабочих дней</div>';
    if(!canEdit){
      html+='<div style="font-size:10px;color:#9aabbf;font-style:italic;margin-bottom:8px">Управляется Начальником производства</div>';
    }
    prodUsers.forEach(function(u){
      const info=getBrigadierDeadlineInfo(c,u.id);
      const finesApplied=getFinesApplied(c.id,u.id);
      const pendingFine=Math.max(0,info.fine-finesApplied);
      const history=(c.deadlines&&c.deadlines[u.id]&&c.deadlines[u.id].history)||[];
      const status=!info.hasDeadline?{label:"⚪ Не задан",color:"#9aabbf",bg:"#f0f4f8"}
        :info.overdueDays>0?{label:"🔴 Просрочка "+info.overdueDays+" дн",color:"#e74c3c",bg:"#e74c3c12"}
        :info.daysLeft<=3?{label:"🟡 До дедлайна "+info.daysLeft+" р.дн",color:"#f39c12",bg:"#f39c1212"}
        :{label:"🟢 Осталось "+info.daysLeft+" р.дн",color:"#27ae60",bg:"#27ae6012"};
      html+='<div style="background:#fafbfc;border-radius:8px;border:1px solid #e5ebf2;padding:10px;margin-bottom:6px">';
      html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
      html+='<span style="font-size:16px">'+u.av+'</span>';
      html+='<span style="flex:1;font-size:13px;font-weight:700;color:#1a2a3a">'+u.name+'</span>';
      html+='<span style="font-size:10px;font-weight:700;color:'+status.color+';background:'+status.bg+';padding:3px 8px;border-radius:5px">'+status.label+'</span>';
      html+='</div>';
      if(canEdit){
        html+='<div style="display:flex;gap:5px;align-items:center;margin-bottom:5px">';
        html+='<span style="font-size:9px;color:#9aabbf;font-weight:700;width:60px">СТАРТ:</span>';
        html+='<input id="dl-start-'+c.id+'-'+u.id+'" type="date" value="'+(info.startDate||"")+'" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid #d0dae8;font-size:11px;outline:none;box-sizing:border-box">';
        html+='</div>';
        html+='<div style="display:flex;gap:5px;align-items:center;margin-bottom:6px">';
        html+='<span style="font-size:9px;color:#9aabbf;font-weight:700;width:60px">ДЕДЛАЙН:</span>';
        html+='<input id="dl-end-'+c.id+'-'+u.id+'" type="date" value="'+(info.deadline||"")+'" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid #d0dae8;font-size:11px;outline:none;box-sizing:border-box">';
        html+='</div>';
        html+='<button data-a="dl-save" data-cid="'+c.id+'" data-uid="'+u.id+'" style="width:100%;padding:6px;background:#d35800;border:none;border-radius:6px;cursor:pointer;color:#fff;font-size:11px;font-weight:700;margin-bottom:5px">💾 Сохранить дедлайн</button>';
      } else if(info.hasDeadline){
        html+='<div style="display:flex;gap:10px;font-size:10px;color:#7a9aaa;margin-bottom:5px">';
        html+='<span>📅 Старт: <b>'+(info.startDate||"—")+'</b></span>';
        html+='<span>🏁 До: <b>'+info.deadline+'</b></span>';
        html+='</div>';
      }
      // ── ШТРАФ блок ──
      if(info.hasDeadline&&info.overdueDays>0){
        html+='<div style="background:#e74c3c08;border:1px solid #e74c3c33;border-radius:7px;padding:8px 10px;margin-top:5px">';
        html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">';
        html+='<div style="font-size:10px;font-weight:700;color:#e74c3c">⚠️ ШТРАФ '+FINE_PER_DAY.toLocaleString("ru-RU")+' ₽/день × '+info.overdueDays+' дн</div>';
        html+='<div style="font-size:13px;font-weight:700;color:#e74c3c">−'+info.fine.toLocaleString("ru-RU")+' ₽</div>';
        html+='</div>';
        html+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;font-size:9px;margin-bottom:5px">';
        html+='<div><span style="color:#9aabbf">Применено: </span><span style="color:#1a2a3a;font-weight:700">'+finesApplied.toLocaleString("ru-RU")+' ₽</span></div>';
        html+='<div><span style="color:#9aabbf">К начислению: </span><span style="color:#e74c3c;font-weight:700">'+pendingFine.toLocaleString("ru-RU")+' ₽</span></div>';
        html+='</div>';
        if(canEdit&&pendingFine>0){
          html+='<button data-a="fine-apply" data-cid="'+c.id+'" data-uid="'+u.id+'" data-amt="'+pendingFine+'" style="width:100%;padding:6px;background:#e74c3c;border:none;border-radius:5px;cursor:pointer;color:#fff;font-size:10px;font-weight:700">⚠️ Применить штраф −'+pendingFine.toLocaleString("ru-RU")+' ₽</button>';
        } else if(pendingFine===0&&finesApplied>0){
          html+='<div style="text-align:center;font-size:10px;color:#27ae60;font-weight:700;padding:4px">✓ Штраф полностью применён</div>';
        }
        html+='</div>';
      }
      // ── ИСТОРИЯ изменений дедлайна ──
      if(history.length){
        const isOpen=window._dlHistOpen&&window._dlHistOpen[c.id+":"+u.id];
        html+='<div style="margin-top:6px">';
        html+='<button data-a="dl-hist-toggle" data-key="'+c.id+':'+u.id+'" style="width:100%;padding:5px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:5px;cursor:pointer;color:#7a9aaa;font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:space-between">';
        html+='<span>📜 История изменений ('+history.length+')</span><span>'+(isOpen?'▲':'▼')+'</span>';
        html+='</button>';
        if(isOpen){
          html+='<div style="margin-top:5px;background:#f8fafc;border:1px solid #e5ebf2;border-radius:6px;padding:6px">';
          history.slice().reverse().forEach(function(h){
            const editor=users.find(x=>x.id===h.by);
            html+='<div style="font-size:9px;color:#5a7a9a;padding:5px 7px;border-bottom:1px dashed #dde6f0;line-height:1.4">';
            html+='<div style="display:flex;align-items:center;gap:5px;color:#9aabbf;margin-bottom:2px">';
            html+='<span>'+(editor?editor.av:"👤")+'</span>';
            html+='<span style="font-weight:700;color:#1a2a3a">'+(editor?editor.name:"—")+'</span>';
            html+='<span>·</span>';
            html+='<span>'+h.when+'</span>';
            html+='</div>';
            html+='<div style="padding-left:18px"><b>'+(h.startDate||"—")+'</b> → <b>'+(h.deadline||"—")+'</b></div>';
            html+='</div>';
          });
          html+='</div>';
        }
        html+='</div>';
      }
      html+='</div>';
    });
    html+='</div>';
  }

  // Block 2: ЗАРПЛАТА СОПРОВОДИТЕЛЯ
  html+=_renderSalSection({title:"🚚 ЗАРПЛАТА РОПа",color:"#9b59b6",users:escortUsers});

  // Block 3: ПЛАН ДОП РАБОТ
  {
    const planItems=c.extraWorksPlan||[];
    const planSum=planItems.reduce(function(a,w){return a+(w.amount||0);},0);
    const paidExtra=getExtraWorksPaid(c);
    const leftExtra=Math.max(0,planSum-paidExtra);
    html+='<div style="background:#fff;border-radius:12px;border:1px solid #16a08533;padding:12px 14px;margin-bottom:10px">';
    html+='<div style="font-size:10px;color:#16a085;font-weight:700;letter-spacing:1px;margin-bottom:10px">🛠 ПЛАН ДОП РАБОТ ПРОИЗВОДСТВУ</div>';
    // Totals row
    html+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #f4f6f9">'+
      '<div><div style="font-size:9px;color:#9aabbf">ПЛАН</div><div style="font-size:13px;font-weight:700;color:#1a2a3a">'+planSum.toLocaleString("ru-RU")+'</div></div>'+
      '<div><div style="font-size:9px;color:#9aabbf">ВЫПЛАЧЕНО</div><div style="font-size:13px;font-weight:700;color:#16a085">'+paidExtra.toLocaleString("ru-RU")+'</div></div>'+
      '<div><div style="font-size:9px;color:#9aabbf">ОСТАЛОСЬ</div><div style="font-size:13px;font-weight:700;color:'+(leftExtra>0?"#e67e22":"#27ae60")+'">'+(leftExtra>0?leftExtra.toLocaleString("ru-RU"):"✓")+'</div></div>'+
    '</div>';
    // List of planned items
    if(planItems.length){
      planItems.forEach(function(it){
        html+='<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#16a08508;border-radius:8px;margin-bottom:4px;border:1px solid #16a08522">'+
          '<span style="font-size:14px">🛠</span>'+
          '<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;color:#1a2a3a">'+(it.title||"Доп работа")+'</div></div>'+
          '<div style="font-size:12px;font-weight:700;color:#16a085;white-space:nowrap">'+(it.amount||0).toLocaleString("ru-RU")+' ₽</div>'+
          '<button data-a="ew-plan-del" data-cid="'+cid+'" data-wid="'+it.id+'" style="width:28px;height:28px;background:#e74c3c12;border:1.5px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:13px;font-weight:700;line-height:1;flex-shrink:0">✕</button>'+
        '</div>';
      });
    } else {
      html+='<div style="font-size:11px;color:#9aabbf;text-align:center;padding:10px;border:1px dashed #d0dae8;border-radius:8px;margin-bottom:8px">Нет запланированных доп работ</div>';
    }
    // Add new plan form
    html+='<div style="margin-top:8px;padding:10px;background:#fafbfc;border-radius:8px;border:1px dashed #16a08544">'+
      '<div style="font-size:9px;color:#16a085;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">+ ЗАПЛАНИРОВАТЬ ДОП РАБОТУ</div>'+
      '<input id="ew-plan-title-'+cid+'" placeholder="Что за работа? (например: Утепление крыши)" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;margin-bottom:6px;outline:none;box-sizing:border-box">'+
      '<div style="display:flex;gap:6px">'+
        '<input id="ew-plan-amount-'+cid+'" type="text" inputmode="numeric" data-money="1" placeholder="Сумма ₽" style="flex:1;min-width:0;padding:8px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;box-sizing:border-box">'+
        '<button data-a="ew-plan-add" data-cid="'+cid+'" style="padding:8px 14px;background:#16a085;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700;flex-shrink:0">+ Добавить</button>'+
      '</div>'+
    '</div>';
    html+='</div>';
  }

  // Extra works block - available for ALL contracts (main can have extras too)
  {
    const extraWorks=c.extraWorks||[];
    const totalCost=extraWorks.reduce(function(a,w){return a+(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);},0);

    const blockTitle=c.type==="extra"?"🔨 РАБОТЫ И МАТЕРИАЛЫ":"➕ ДОП. РАБОТЫ И МАТЕРИАЛЫ";
    html+='<div style="background:#fff;border-radius:12px;border:1px solid #8e44ad44;padding:12px 14px;margin-bottom:10px">';
    html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
      '<div style="font-size:10px;color:#8e44ad;font-weight:700;letter-spacing:1px">'+blockTitle+'</div>'+
      '<button data-a="ct-extra-add" data-cid="'+cid+'" style="padding:4px 10px;background:#8e44ad;border:none;border-radius:6px;cursor:pointer;font-size:11px;color:#fff;font-weight:600">+ Работа</button>'+
    '</div>';

    if(obj){
      // Show stages from object
      html+='<div style="font-size:11px;color:#7a9aaa;margin-bottom:8px">Объект: '+obj.icon+' '+obj.name+'</div>';
    }

    if(!extraWorks.length){
      html+='<div style="font-size:12px;color:#aaa;text-align:center;padding:14px;border:1px dashed #e0e6ee;border-radius:8px">'+(c.type==="extra"?"Нет работ":"Нет дополнительных работ")+'. Нажмите + Работа</div>';
    } else {
      extraWorks.forEach(function(ew, ewi){
        const matsTotal=(ew.mats||[]).reduce(function(a,m){return a+(m.cost||0)*(m.qty||1);},0);
        const wTotal=(ew.cost||0)+matsTotal;

        html+='<div style="background:#fafbfc;border-radius:10px;padding:10px 12px;margin-bottom:8px;border-left:3px solid #8e44ad">';
        html+='<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:12px;font-weight:700;color:#1a2a3a">'+(ew.name||"Работа")+'</div>'+
            '<div style="font-size:10px;color:#9aabbf">Этап: '+(ew.stage||"—")+'</div>'+
          '</div>'+
          '<div style="font-size:13px;font-weight:700;color:#8e44ad;white-space:nowrap">'+fmt(wTotal)+' ₽</div>'+
          '<button data-a="ct-extra-del" data-cid="'+cid+'" data-ewi="'+ewi+'" style="padding:4px 8px;background:#e74c3c12;border:1px solid #e74c3c33;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:10px">🗑</button>'+
        '</div>';

        // Work cost
        html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">'+
          '<span style="font-size:10px;color:#7a9aaa;min-width:60px">Работа ₽:</span>'+
          '<input id="ct-ew-cost-'+cid+'-'+ewi+'" type="text" inputmode="numeric" data-money="1" value="'+fmtMoney(ew.cost||0)+'" placeholder="0" style="flex:1;padding:5px 8px;border-radius:6px;border:1px solid #d0dae8;font-size:12px;outline:none;text-align:right">'+
          '<button data-a="ct-ew-save" data-cid="'+cid+'" data-ewi="'+ewi+'" style="padding:5px 9px;background:#8e44ad;border:none;border-radius:6px;cursor:pointer;color:#fff;font-size:11px;font-weight:700">💾</button>'+
        '</div>';

        // Materials
        const mats=ew.mats||[];
        if(mats.length){
          html+='<div style="font-size:10px;color:#7a9aaa;margin:8px 0 4px">📦 Материалы:</div>';
          mats.forEach(function(m,mi){
            const mTotal=(m.cost||0)*(m.qty||1);
            html+='<div style="display:flex;align-items:center;gap:5px;padding:4px 6px;background:#fff;border-radius:6px;margin-bottom:3px;border:1px solid #f0f3f7">'+
              '<div style="flex:1;min-width:0;font-size:11px;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+m.name+'</div>'+
              '<input id="ct-ewm-qty-'+cid+'-'+ewi+'-'+mi+'" type="number" value="'+(m.qty||1)+'" style="width:42px;padding:3px 5px;border-radius:5px;border:1px solid #d0dae8;font-size:11px;outline:none;text-align:center">'+
              '<span style="font-size:10px;color:#9aabbf">×</span>'+
              '<input id="ct-ewm-cost-'+cid+'-'+ewi+'-'+mi+'" type="text" inputmode="numeric" data-money="1" value="'+fmtMoney(m.cost||0)+'" style="width:60px;padding:3px 5px;border-radius:5px;border:1px solid #d0dae8;font-size:11px;outline:none;text-align:right">'+
              '<span style="font-size:10px;color:#27ae60;font-weight:700;min-width:55px;text-align:right">'+fmt(mTotal)+'</span>'+
              '<button data-a="ct-ewm-save" data-cid="'+cid+'" data-ewi="'+ewi+'" data-mi="'+mi+'" style="padding:3px 5px;background:#27ae60;border:none;border-radius:4px;cursor:pointer;color:#fff;font-size:9px">💾</button>'+
              '<button data-a="ct-ewm-del" data-cid="'+cid+'" data-ewi="'+ewi+'" data-mi="'+mi+'" style="padding:3px 5px;background:transparent;border:none;cursor:pointer;color:#e74c3c;font-size:11px">✕</button>'+
            '</div>';
          });
        }

        // Add material button
        html+='<button data-a="ct-ewm-add" data-cid="'+cid+'" data-ewi="'+ewi+'" style="width:100%;padding:5px;background:#27ae6012;border:1px dashed #27ae6044;border-radius:6px;cursor:pointer;color:#27ae60;font-size:10px;font-weight:600;margin-top:4px">+ Материал из базы</button>';

        html+='</div>';
      });

      // Total
      html+='<div style="display:flex;justify-content:space-between;padding:8px 4px;margin-top:6px;border-top:1px solid #e0e6ee">'+
        '<span style="font-size:12px;font-weight:700;color:#1a2a3a">'+(c.type==="extra"?"Итого по доп. работам:":"Сумма доп. работ:")+'</span>'+
        '<span style="font-size:14px;font-weight:700;color:#8e44ad">'+fmt(totalCost)+' ₽</span>'+
      '</div>';
    }
    html+='</div>';
  }

    // Файлы договора и планировки
  html+=buildContractFiles(c);

    // Delete
  html+='<button data-a="ct-delete" data-cid="'+c.id+'" style="width:100%;padding:8px;background:transparent;border:1px solid #e74c3c44;border-radius:8px;cursor:pointer;color:#e74c3c;font-size:12px;margin-top:2px">🗑 Удалить договор</button>';
  html+='</div>';
  return html;
}

function tFinance(){
  if(finOpenContractId) return tFinanceContractPnL(finOpenContractId);
  if(finOpenObjId) return tFinancePnL(finOpenObjId);
  // Mode switcher: BDDS or P&L
  const isAdminOrFin=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("financier"));
  if(!isAdminOrFin) return tFinanceList(); // brigadiers/escorts see only their salary view
  return tFinanceMode();
}

function tFinanceMode(){
  // Header with mode tabs
  let html='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:6px;margin-bottom:14px;display:flex;gap:4px;box-shadow:0 2px 6px rgba(0,0,0,0.04)">'+
    '<button data-a="fin-mode" data-mode="bdds" style="flex:1;padding:10px 8px;background:'+(finMode==="bdds"?"#2980b9":"transparent")+';border:none;border-radius:10px;cursor:pointer;color:'+(finMode==="bdds"?"#fff":"#5a7080")+';font-size:13px;font-weight:700;transition:all 0.15s">💰 БДДС</button>'+
    '<button data-a="fin-mode" data-mode="pnl" style="flex:1;padding:10px 8px;background:'+(finMode==="pnl"?"#27ae60":"transparent")+';border:none;border-radius:10px;cursor:pointer;color:'+(finMode==="pnl"?"#fff":"#5a7080")+';font-size:13px;font-weight:700;transition:all 0.15s">📈 P&L</button>'+
    '<button data-a="fin-mode" data-mode="experiment" style="flex:1;padding:10px 8px;background:'+(finMode==="experiment"?"#16a085":"transparent")+';border:none;border-radius:10px;cursor:pointer;color:'+(finMode==="experiment"?"#fff":"#5a7080")+';font-size:13px;font-weight:700;transition:all 0.15s">✏️ Эксперимент</button>'+
  '</div>';
  // Sub-header explaining the modes
  html+='<div style="font-size:10px;color:#9aabbf;text-align:center;margin-bottom:10px;letter-spacing:0.3px">'+
    (finMode==="bdds"?"Движение денег · приход и расход во времени":finMode==="experiment"?"Корректные P&L и БДДС · прибыль отдельно от денег":"Прибыль по договорам · доходы минус расходы")+
  '</div>';

  if(finMode==="bdds") html+=tFinanceBDDS();
  else if(finMode==="experiment") html+=tFinanceExperiment();
  else html+=tFinanceList();

  return html;
}


function tFinanceExperiment(){
  const signed=contractDocs.filter(function(c){return c.status==="signed"||c.status==="closed";});
  function objMaterials(oid){
    const o=objects.find(function(x){return x.id===oid;}); if(!o)return 0;
    return o.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});})
      .reduce(function(a,m){return a+(Number(m.cost)||0)*(m.qty||1);},0);
  }
  function objLabor(c){
    let s=0;
    users.filter(function(u){return (c.responsible||[]).includes(u.id);}).forEach(function(u){
      const sal=(c.salaries||{})[u.id]||{};
      s+=(sal.plan!=null&&sal.plan!==0?sal.plan:getDefaultSalary(u));
    });
    s+=(c.extraWorksPlan||[]).reduce(function(a,w){return a+(w.amount||0);},0);
    return s;
  }
  // ── Итоги (P&L) ──
  let revenue=0,materials=0,labor=0;
  signed.forEach(function(c){ revenue+=getObjectContractAmount(c.objId); materials+=objMaterials(c.objId); labor+=objLabor(c); });
  const cogs=materials+labor, gross=revenue-cogs, margin=revenue>0?Math.round(gross/revenue*100):0;
  // ── БДДС (живые деньги) ──
  let factIn=0,factOut=0;
  finTxns.forEach(function(t){ if(t.type==="income")factIn+=t.amount||0; else if(t.type==="expense")factOut+=t.amount||0; });
  const flow=factIn-factOut, toReceive=revenue-factIn;
  const RP=function(n){return (n>=0?"+":"−")+Math.abs(n).toLocaleString("ru-RU")+" ₽";};
  const RU=function(n){return n.toLocaleString("ru-RU")+" ₽";};

  let html='';
  // Пояснение
  html+='<div style="background:#fff7ec;border:1px solid #f5d9a8;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:#7a5a2a;line-height:1.55">'+
    '<b>✏️ Эксперимент.</b> Два разных отчёта. <b>P&L</b> — прибыль: выручка по договору минус себестоимость (материалы + работа); показывает, заработаем ли. '+
    '<b>БДДС</b> — живые деньги: сколько поступило и оплачено сейчас. Можно иметь прибыль на бумаге и при этом кассовый разрыв.'+
  '</div>';
  // P&L карта
  html+='<div style="background:linear-gradient(135deg,#1e7e5a,#13603e);border-radius:16px;padding:16px;color:#fff;margin-bottom:12px">'+
    '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#bfe9d4;margin-bottom:12px">📈 P&L · ПРИБЫЛЬ ПО ВСЕМ ДОГОВОРАМ</div>'+
    '<div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:14px">'+
      '<div><div style="font-size:11px;color:#bfe9d4">Валовая прибыль</div><div style="font-size:26px;font-weight:800;line-height:1.1">'+RP(gross)+'</div></div>'+
      '<div style="text-align:right"><div style="font-size:11px;color:#bfe9d4">Маржа</div><div style="font-size:22px;font-weight:800">'+margin+'%</div></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'+
      '<div style="background:rgba(255,255,255,0.12);border-radius:10px;padding:10px"><div style="font-size:10px;color:#bfe9d4">ВЫРУЧКА (договоры)</div><div style="font-size:15px;font-weight:700">'+RU(revenue)+'</div></div>'+
      '<div style="background:rgba(0,0,0,0.18);border-radius:10px;padding:10px"><div style="font-size:10px;color:#bfe9d4">СЕБЕСТОИМОСТЬ</div><div style="font-size:15px;font-weight:700">−'+RU(cogs)+'</div></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;color:#cfeede">'+
      '<div>материалы<div style="font-size:13px;color:#fff;font-weight:700">−'+RU(materials)+'</div></div>'+
      '<div>работа (ФОТ)<div style="font-size:13px;color:#fff;font-weight:700">−'+RU(labor)+'</div></div>'+
    '</div>'+
  '</div>';
  // БДДС карта
  html+='<div style="background:linear-gradient(135deg,#1f4a6e,#14324b);border-radius:16px;padding:16px;color:#fff;margin-bottom:18px">'+
    '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#a9c7e0;margin-bottom:12px">💰 БДДС · ЖИВЫЕ ДЕНЬГИ</div>'+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'+
      '<div><div style="font-size:10px;color:#a9c7e0">ПОСТУПИЛО</div><div style="font-size:15px;font-weight:700;color:#5fd99a">+'+RU(factIn)+'</div></div>'+
      '<div><div style="font-size:10px;color:#a9c7e0">ОПЛАЧЕНО</div><div style="font-size:15px;font-weight:700;color:#f1948a">−'+RU(factOut)+'</div></div>'+
      '<div><div style="font-size:10px;color:#a9c7e0">ПОТОК</div><div style="font-size:15px;font-weight:700;color:'+(flow>=0?"#5fd99a":"#f1948a")+'">'+RP(flow)+'</div></div>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,0.12);margin-top:12px;padding-top:11px">'+
      '<span style="font-size:12px;color:#a9c7e0">Осталось получить по договорам</span>'+
      '<span style="font-size:16px;font-weight:800;color:#f0b94a">'+RU(toReceive)+'</span>'+
    '</div>'+
  '</div>';
  // По объектам
  html+='<div style="font-size:12px;font-weight:700;color:#7a9aaa;letter-spacing:0.5px;margin-bottom:10px">ПО ОБЪЕКТАМ</div>';
  signed.forEach(function(c){
    const o=objects.find(function(x){return x.id===c.objId;}); if(!o)return;
    const rev=getObjectContractAmount(c.objId), mat=objMaterials(c.objId), lab=objLabor(c);
    const profit=rev-mat-lab, pct=rev>0?Math.round(profit/rev*100):0;
    const oin=finTxns.filter(function(t){return t.objId===c.objId&&t.type==="income";}).reduce(function(a,t){return a+(t.amount||0);},0);
    const oout=finTxns.filter(function(t){return t.objId===c.objId&&t.type==="expense";}).reduce(function(a,t){return a+(t.amount||0);},0);
    const toRecv=rev-oin;
    html+='<div data-a="fin-open" data-cid="'+c.id+'" data-oid="'+c.objId+'" style="background:#fff;border:1px solid #dde6f0;border-radius:14px;padding:14px;margin-bottom:10px;cursor:pointer">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'+
        '<div style="font-size:15px;font-weight:700;color:#0d1b2e">'+(o.icon||"")+' '+o.name+'</div>'+
        '<div style="text-align:right"><div style="font-size:17px;font-weight:800;color:'+(profit>=0?"#27ae60":"#e74c3c")+'">'+RP(profit)+'</div><div style="font-size:10px;color:#9aabbf">прибыль · '+pct+'%</div></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px;margin-bottom:8px">'+
        '<div><div style="color:#9aabbf">ВЫРУЧКА</div><b style="color:#2980b9">'+RU(rev)+'</b></div>'+
        '<div><div style="color:#9aabbf">МАТЕРИАЛЫ</div><b style="color:#1a2a3a">'+RU(mat)+'</b></div>'+
        '<div><div style="color:#9aabbf">РАБОТА</div><b style="color:#1a2a3a">'+RU(lab)+'</b></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px;border-top:1px solid #eef2f7;padding-top:8px">'+
        '<div><div style="color:#9aabbf">ПОСТУПИЛО</div><b style="color:#27ae60">'+RU(oin)+'</b></div>'+
        '<div><div style="color:#9aabbf">ОПЛАЧЕНО</div><b style="color:#e74c3c">'+RU(oout)+'</b></div>'+
        '<div><div style="color:#9aabbf">К ПОЛУЧЕНИЮ</div><b style="color:#f0a020">'+RU(toRecv)+'</b></div>'+
      '</div>'+
      '<div style="margin-top:10px;text-align:center;font-size:12px;font-weight:700;color:#2980b9;background:#eaf2fb;border-radius:8px;padding:9px">📋 Открыть договор · приходы, снабжение, зарплаты, + транзакции →</div>'+
    '</div>';
  });
  return html;
}

function tFinanceBDDS(){
  // ===== BDDS: Cash Flow Movement =====
  let html='';

  // View switcher: by month or by contract
  html+='<div style="display:flex;gap:6px;margin-bottom:14px">'+
    '<button data-a="bdds-view" data-v="month" style="flex:1;padding:8px;background:'+(bddsView==="month"?"#2980b9":"#f0f4f8")+';border:none;border-radius:9px;cursor:pointer;color:'+(bddsView==="month"?"#fff":"#5a7080")+';font-size:12px;font-weight:700">📅 По месяцам</button>'+
    '<button data-a="bdds-view" data-v="contract" style="flex:1;padding:8px;background:'+(bddsView==="contract"?"#2980b9":"#f0f4f8")+';border:none;border-radius:9px;cursor:pointer;color:'+(bddsView==="contract"?"#fff":"#5a7080")+';font-size:12px;font-weight:700">📋 По договорам</button>'+
  '</div>';

  // ========== Compute aggregates ==========
  const signedContracts=contractDocs.filter(function(c){return c.status==="signed"||c.status==="closed";});

  // Total income/expense (FACT — from transactions)
  let factIn=0, factOut=0;
  finTxns.forEach(function(t){
    if(t.type==="income") factIn+=t.amount||0;
    else if(t.type==="expense") factOut+=t.amount||0;
  });

  // Total PLAN (from contracts)
  let planIn=0, planOut=0;
  signedContracts.forEach(function(c){
    planIn+=getObjectContractAmount(c.objId); // contract value = expected income
    // Plan expenses: materials + salaries + extra works
    const obj=objects.find(function(o){return o.id===c.objId;});
    if(obj){
      const allMats=obj.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});});
      planOut+=allMats.reduce(function(a,m){return a+(m.cost||0);},0);
    }
    const respUsers=users.filter(function(u){return (c.responsible||[]).includes(u.id);});
    respUsers.forEach(function(u){
      const sal=(c.salaries||{})[u.id]||{};
      const eff=sal.plan!=null&&sal.plan!==0?sal.plan:getDefaultSalary(u);
      planOut+=eff;
    });
    planOut+=(c.extraWorksPlan||[]).reduce(function(a,w){return a+(w.amount||0);},0);
  });
  // Avoid double-count: planIn already includes contract sums; planOut is what we PLAN to spend.
  // Cap planIn to avoid counting future income twice
  planIn=Math.max(planIn, factIn);

  // ========== Top KPI bar — Fact vs Plan ==========
  const balance=factIn-factOut;
  const projectedProfit=planIn-planOut;
  html+='<div style="background:linear-gradient(135deg,#1a2a3a,#2c3e50);border-radius:14px;padding:14px;color:#fff;margin-bottom:14px">'+
    '<div style="font-size:10px;color:#aabacc;letter-spacing:0.5px;font-weight:700;margin-bottom:10px">💵 СВОДКА ДЕНЕЖНЫХ ПОТОКОВ</div>'+
    // Fact row
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">'+
      '<div style="background:rgba(39,174,96,0.15);border-radius:10px;padding:8px"><div style="font-size:9px;color:#7fdca0">↑ ПРИХОД (факт)</div><div style="font-size:14px;font-weight:700;color:#27ae60">+'+factIn.toLocaleString("ru-RU")+'</div></div>'+
      '<div style="background:rgba(231,76,60,0.15);border-radius:10px;padding:8px"><div style="font-size:9px;color:#f1948a">↓ РАСХОД (факт)</div><div style="font-size:14px;font-weight:700;color:#e74c3c">−'+factOut.toLocaleString("ru-RU")+'</div></div>'+
      '<div style="background:rgba(255,255,255,0.08);border-radius:10px;padding:8px"><div style="font-size:9px;color:#aabacc">💵 БАЛАНС</div><div style="font-size:14px;font-weight:700;color:'+(balance>=0?"#27ae60":"#e74c3c")+'">'+(balance>=0?"+":"")+balance.toLocaleString("ru-RU")+'</div></div>'+
    '</div>'+
    // Plan row
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1)">'+
      '<div><div style="font-size:9px;color:#aabacc">↑ ПРИХОД (план)</div><div style="font-size:12px;font-weight:700;color:#bdf2d0">+'+planIn.toLocaleString("ru-RU")+'</div></div>'+
      '<div><div style="font-size:9px;color:#aabacc">↓ РАСХОД (план)</div><div style="font-size:12px;font-weight:700;color:#fadbd8">−'+planOut.toLocaleString("ru-RU")+'</div></div>'+
      '<div><div style="font-size:9px;color:#aabacc">📊 ПРОГНОЗ ПРИБ.</div><div style="font-size:12px;font-weight:700;color:'+(projectedProfit>=0?"#bdf2d0":"#fadbd8")+'">'+(projectedProfit>=0?"+":"")+projectedProfit.toLocaleString("ru-RU")+'</div></div>'+
    '</div>'+
  '</div>';

  // ========== Detail view ==========
  if(bddsView==="month") html+=_bddsByMonth();
  else html+=_bddsByContract();

  return html;
}

function _bddsByMonth(){
  // Group transactions by month (YYYY-MM)
  const monthMap={};
  finTxns.forEach(function(t){
    if(!t.date)return;
    const m=t.date.slice(0,7);
    if(!monthMap[m]) monthMap[m]={income:0,expense:0,txns:[]};
    if(t.type==="income") monthMap[m].income+=t.amount||0;
    else monthMap[m].expense+=t.amount||0;
    monthMap[m].txns.push(t);
  });
  const months=Object.keys(monthMap).sort().reverse(); // newest first

  if(!months.length){
    return '<div style="background:#fff;border-radius:12px;padding:30px;text-align:center;color:#9aabbf;font-size:12px;border:1px dashed #d0dae8">Нет транзакций. Добавьте приходы и расходы в P&L договоров.</div>';
  }

  // Running balance (oldest to newest)
  const monthsAsc=[].concat(months).reverse();
  let running=0;
  const runningMap={};
  monthsAsc.forEach(function(m){
    running+=monthMap[m].income-monthMap[m].expense;
    runningMap[m]=running;
  });

  const RU_MONTHS=["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  let html='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin-bottom:8px">📅 ДВИЖЕНИЕ ПО МЕСЯЦАМ</div>';

  months.forEach(function(m){
    const data=monthMap[m];
    const net=data.income-data.expense;
    const [y,mn]=m.split("-");
    const monthName=RU_MONTHS[parseInt(mn,10)-1]+" "+y;
    const rb=runningMap[m];
    html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;margin-bottom:8px;overflow:hidden">'+
      '<div style="padding:10px 12px;background:linear-gradient(135deg,#f8fafc,#fff);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f0f4f8">'+
        '<div><div style="font-size:13px;font-weight:700;color:#1a2a3a">'+monthName+'</div><div style="font-size:10px;color:#9aabbf">'+data.txns.length+" операц."+'</div></div>'+
        '<div style="text-align:right"><div style="font-size:13px;font-weight:700;color:'+(net>=0?"#27ae60":"#e74c3c")+'">'+(net>=0?"+":"")+net.toLocaleString("ru-RU")+'</div><div style="font-size:9px;color:#9aabbf">баланс мес.</div></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;padding:10px 12px;gap:6px">'+
        '<div><div style="font-size:9px;color:#7fdca0;font-weight:600">↑ ПРИХОД</div><div style="font-size:12px;font-weight:700;color:#27ae60">+'+data.income.toLocaleString("ru-RU")+'</div></div>'+
        '<div><div style="font-size:9px;color:#f1948a;font-weight:600">↓ РАСХОД</div><div style="font-size:12px;font-weight:700;color:#e74c3c">−'+data.expense.toLocaleString("ru-RU")+'</div></div>'+
        '<div><div style="font-size:9px;color:#9aabbf;font-weight:600">💵 НАКОПЛ.</div><div style="font-size:12px;font-weight:700;color:'+(rb>=0?"#1a2a3a":"#e74c3c")+'">'+(rb>=0?"+":"")+rb.toLocaleString("ru-RU")+'</div></div>'+
      '</div>'+
    '</div>';
  });

  return html;
}

function _bddsByContract(){
  // Each signed contract: income (received), expense (paid), net (cashflow)
  const signedContracts=contractDocs.filter(function(c){return c.status==="signed"||c.status==="closed";});
  if(!signedContracts.length){
    return '<div style="background:#fff;border-radius:12px;padding:30px;text-align:center;color:#9aabbf;font-size:12px;border:1px dashed #d0dae8">Нет подписанных договоров</div>';
  }

  // Group by object
  const objMap={};
  signedContracts.forEach(function(c){
    if(!objMap[c.objId]) objMap[c.objId]=[];
    objMap[c.objId].push(c);
  });

  let html='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:0.5px;margin-bottom:8px">📋 ДВИЖЕНИЕ ПО ДОГОВОРАМ</div>';

  Object.keys(objMap).forEach(function(oid){
    const obj=objects.find(function(o){return o.id===oid;});
    if(!obj)return;
    html+='<div style="display:flex;align-items:center;gap:8px;margin:14px 0 6px"><span style="font-size:18px">'+obj.icon+'</span><div style="font-size:12px;font-weight:700;color:#1a2a3a;letter-spacing:0.3px">'+obj.name.toUpperCase()+'</div></div>';

    objMap[oid].forEach(function(c){
      // Fact: income (received) and expense (paid out) for this contract
      const ctxns=finTxns.filter(function(t){return t.contractId===c.id||(!t.contractId&&t.objId===oid);});
      const factIn=ctxns.filter(function(t){return t.type==="income";}).reduce(function(a,t){return a+t.amount;},0);
      const factOut=ctxns.filter(function(t){return t.type==="expense";}).reduce(function(a,t){return a+t.amount;},0);
      const net=factIn-factOut;

      // Plan: contract amount (income), planned expenses (materials + salaries + extras)
      const planIn=c.amount||0;
      const allMats=obj.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});});
      let planExpMats=allMats.reduce(function(a,m){return a+(m.cost||0);},0);
      let planExpSal=0;
      const respUsers=users.filter(function(u){return (c.responsible||[]).includes(u.id);});
      respUsers.forEach(function(u){
        const sal=(c.salaries||{})[u.id]||{};
        const eff=sal.plan!=null&&sal.plan!==0?sal.plan:getDefaultSalary(u);
        planExpSal+=eff;
      });
      const planExpExtra=(c.extraWorksPlan||[]).reduce(function(a,w){return a+(w.amount||0);},0);
      const planOut=planExpMats+planExpSal+planExpExtra;
      const planNet=planIn-planOut;

      const ctName="Договор №"+(c.name||"").replace(/[^\d]/g,"")+(c.name?"":"")+(c.type==="extra"?" (доп)":"");
      const ratioIn=planIn>0?Math.min(100,Math.round(factIn/planIn*100)):0;
      const ratioOut=planOut>0?Math.min(100,Math.round(factOut/planOut*100)):0;

      html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:8px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
          '<div style="font-size:12px;font-weight:700;color:#1a2a3a;flex:1;min-width:0">'+ctName+'</div>'+
          '<div style="font-size:12px;font-weight:700;color:'+(net>=0?"#27ae60":"#e74c3c")+';white-space:nowrap">'+(net>=0?"+":"")+net.toLocaleString("ru-RU")+'</div>'+
        '</div>'+
        // Income row
        '<div style="margin-bottom:6px">'+
          '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px">'+
            '<span style="color:#27ae60;font-weight:700">↑ Приход</span>'+
            '<span style="color:#9aabbf">'+factIn.toLocaleString("ru-RU")+' / '+planIn.toLocaleString("ru-RU")+' ('+ratioIn+'%)</span>'+
          '</div>'+
          '<div style="height:5px;background:#f0f4f8;border-radius:3px;overflow:hidden"><div style="height:100%;width:'+ratioIn+'%;background:#27ae60"></div></div>'+
        '</div>'+
        // Expense row
        '<div>'+
          '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px">'+
            '<span style="color:#e74c3c;font-weight:700">↓ Расход</span>'+
            '<span style="color:#9aabbf">'+factOut.toLocaleString("ru-RU")+' / '+planOut.toLocaleString("ru-RU")+' ('+ratioOut+'%)</span>'+
          '</div>'+
          '<div style="height:5px;background:#f0f4f8;border-radius:3px;overflow:hidden"><div style="height:100%;width:'+ratioOut+'%;background:#e74c3c"></div></div>'+
        '</div>'+
        // Projected vs actual
        '<div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:8px;border-top:1px dashed #f0f4f8;font-size:10px">'+
          '<span style="color:#9aabbf">Прогноз прибыли:</span>'+
          '<span style="font-weight:700;color:'+(planNet>=0?"#27ae60":"#e74c3c")+'">'+(planNet>=0?"+":"")+planNet.toLocaleString("ru-RU")+'</span>'+
        '</div>'+
      '</div>';
    });
  });

  return html;
}

function tFinanceList(){
  let html='<div>';
  // Defined early — used both in header and dashboard render below
  const showDashboard=!currentUser||currentUser.roles.includes("admin")||currentUser.roles.includes("financier");
  const headerLabel=(currentUser&&(currentUser.roles.includes("brigadier")||currentUser.roles.includes("worker"))&&!currentUser.roles.includes("admin")&&!currentUser.roles.includes("financier"))?
    "💰 МОЯ ЗАРПЛАТА — ПРОИЗВОДСТВО":
    (currentUser&&currentUser.roles.includes("sales_head")&&!currentUser.roles.includes("admin")&&!currentUser.roles.includes("financier")&&!currentUser.roles.includes("brigadier")&&!currentUser.roles.includes("worker"))?
    "💰 МОЯ ЗАРПЛАТА — СОПРОВОЖДЕНИЕ":
    "ФИНАНСЫ — P&L"+(finSelectedContractIds.length?" · ВЫБРАНО: "+finSelectedContractIds.length:"");
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
    '<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">'+headerLabel+'</div>'+
    (finSelectedContractIds.length&&showDashboard?'<button data-a="fin-clear-selection" style="padding:5px 11px;background:#e74c3c12;border:1px solid #e74c3c33;border-radius:7px;cursor:pointer;color:#e74c3c;font-size:11px;font-weight:700">✕ Сбросить</button>':"")+
  '</div>';

  if(!objects.length){
    html+='<div style="background:#fff;border-radius:16px;border:2px dashed #dde6f0;padding:40px 20px;text-align:center">'+
      '<div style="font-size:40px;margin-bottom:10px">💰</div>'+
      '<div style="font-size:14px;font-weight:600;color:#5a7a9a">Нет объектов</div>'+
    '</div>';
    return html+'</div>';
  }

  // Determine scope: selected contracts OR all signed contracts (filtered by responsibility for non-admin)
  const isFiltered=finSelectedContractIds.length>0;
  let allSigned=contractDocs.filter(function(d){return d.status==="signed"||d.status==="closed";});
  if(currentUser&&!currentUser.roles.includes("admin")&&!currentUser.roles.includes("financier")){
    allSigned=allSigned.filter(function(d){return (d.responsible||[]).includes(currentUser.id);});
  }
  const scopedContracts=isFiltered?
    contractDocs.filter(function(d){return finSelectedContractIds.includes(d.id);}):
    allSigned;

  // Sum contract amounts (main + extras) for scoped
  let allContracts=0;
  scopedContracts.forEach(function(d){
    if(d.type==="main")allContracts+=(d.amount||0);
    allContracts+=(d.extraWorks||[]).reduce(function(a,w){return a+(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);},0);
  });

  // Transactions scoped to selected contracts
  // Include: (1) txns directly linked to selected contracts, (2) legacy txns on same objects without contractId
  const scopedObjIdsSet=new Set(scopedContracts.map(function(d){return d.objId;}));
  const scopedTxns=isFiltered?
    finTxns.filter(function(t){
      if(t.contractId&&finSelectedContractIds.includes(t.contractId))return true;
      if(!t.contractId&&scopedObjIdsSet.has(t.objId))return true;
      return false;
    }):
    finTxns;
  const allIncome=scopedTxns.filter(function(t){return t.type==="income";}).reduce(function(a,t){return a+t.amount;},0);
  const allExpense=scopedTxns.filter(function(t){return t.type==="expense";}).reduce(function(a,t){return a+t.amount;},0);
  const allBalance=allIncome-allExpense;

  // Supply/salary totals — for selected contracts use their objects, otherwise all
  const scopedObjIds=isFiltered?
    Array.from(new Set(scopedContracts.map(function(d){return d.objId;}))):
    objects.map(function(o){return o.id;});

  let allSupplyPlan=0, allSupplyFact=0;
  scopedObjIds.forEach(function(oid){
    const obj=objects.find(function(o){return o.id===oid;});
    if(!obj)return;
    const mats=obj.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});});
    allSupplyPlan+=mats.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
    allSupplyFact+=mats.filter(function(m){return!!purchased[m.id];}).reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
  });

  // Salaries from contract.salaries for scoped contracts
  let allSalPlan=0, allSalPaid=0;
  scopedContracts.forEach(function(d){
    const sd=d.salaries||{};
    Object.keys(sd).forEach(function(uid){
      allSalPlan+=(sd[uid].plan||0);
      allSalPaid+=(sd[uid].paid||0);
    });
  });

  // Real profit: contracts amount minus all spent (avoid double-counting expense)
  // expense already includes supply/salary txns that have contractId
  // For legacy: supply is from purchased flag, salary from finSalaries — for selected we use contract.salaries
  // Use TOTAL expenses (income - expense gives current balance)
  const allTotalExpenses=allExpense; // all expense transactions
  const allProfit=allContracts-allTotalExpenses;
  const allContractRemaining=allContracts-allIncome;

  function cell(label, val, color, sub){
    return '<div style="padding:8px 0">'+
      '<div style="font-size:9px;color:rgba(255,255,255,0.45);font-weight:700;letter-spacing:0.5px;margin-bottom:3px">'+label+'</div>'+
      '<div style="font-size:15px;font-weight:700;color:'+color+'">'+val+'</div>'+
      (sub?'<div style="font-size:9px;color:rgba(255,255,255,0.35);margin-top:1px">'+sub+'</div>':'')+
    '</div>';
  }

  // Dark dashboard — only for admin/financier (showDashboard declared at top)
  if(showDashboard){
  html+='<div style="background:linear-gradient(135deg,#1a2a3a,#2a4a6a);border-radius:14px;padding:14px 16px;margin-bottom:16px">';
  html+='<div style="font-size:10px;color:rgba(255,255,255,0.45);font-weight:700;letter-spacing:1px;margin-bottom:2px">'+(isFiltered?"ВЫБРАНО ДОГОВОРОВ: "+scopedContracts.length:"ИТОГО ПО ВСЕМ ОБЪЕКТАМ")+'</div>';
  html+='<div style="font-size:11px;color:rgba(255,255,255,0.25);margin-bottom:12px">'+objects.length+' объектов в работе</div>';

  // Row 1: Приходы / Расходы / Баланс
  html+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:10px">';
  html+=cell("ПРИХОДЫ", "+"+allIncome.toLocaleString("ru-RU")+" ₽", "#27ae60");
  html+=cell("РАСХОДЫ", "−"+allExpense.toLocaleString("ru-RU")+" ₽", "#e74c3c");
  html+=cell("БАЛАНС", (allBalance>=0?"+":"")+allBalance.toLocaleString("ru-RU")+" ₽", allBalance>=0?"#2ecc71":"#e74c3c");
  html+='</div>';

  // Row 2: Договоры / Остаток / Прибыль
  html+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:10px">';
  html+=cell("ДОГОВОРЫ", allContracts?allContracts.toLocaleString("ru-RU")+" ₽":"—", "#60a5fa");
  html+=cell("ОСТАТОК", allContracts?(allContractRemaining>0?allContractRemaining.toLocaleString("ru-RU")+" ₽":"✓ Оплачен"):"—", allContractRemaining>0?"#f59e0b":"#2ecc71", allContracts?Math.min(100,Math.round(allIncome/allContracts*100))+"% получено":"");
  html+=cell("ПРИБЫЛЬ", (allProfit>=0?"+":"")+allProfit.toLocaleString("ru-RU")+" ₽", allProfit>=0?"#2ecc71":"#e74c3c", "дог − расходы");
  html+='</div>';

  // Row 3: Снабжение / Зарплата
  html+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">';
  html+=cell("📦 СНАБЖЕНИЕ", allSupplyFact.toLocaleString("ru-RU")+" ₽", "rgba(255,255,255,0.85)", "потрачено · план: "+allSupplyPlan.toLocaleString("ru-RU")+" ₽");
  html+=cell("👷 ЗАРПЛАТА", allSalPaid.toLocaleString("ru-RU")+" ₽", "rgba(255,255,255,0.85)", "выплачено · план: "+allSalPlan.toLocaleString("ru-RU")+" ₽");
  html+='</div>';
  html+='</div>';
  } // end if(showDashboard)

  // Per-contract cards (each signed contract shown separately, grouped by object)
  objects.forEach(function(obj){
    let signedContracts=contractDocs.filter(function(d){return d.objId===obj.id&&(d.status==="signed"||d.status==="closed");});
    // Non-admin/financier roles see ONLY contracts where they are responsible
    if(currentUser&&!currentUser.roles.includes("admin")&&!currentUser.roles.includes("financier")){
      signedContracts=signedContracts.filter(function(d){return (d.responsible||[]).includes(currentUser.id);});
    }
    if(!signedContracts.length){
      // For non-admin/financier — skip empty objects entirely (don't clutter their view)
      if(currentUser&&!currentUser.roles.includes("admin")&&!currentUser.roles.includes("financier")){
        return;
      }
      // Admin/financier — show empty object header
      html+='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;margin-bottom:12px;padding:12px 14px">'+
        '<div style="display:flex;align-items:center;gap:10px;opacity:0.6">'+
          '<span style="font-size:22px">'+obj.icon+'</span>'+
          '<div style="flex:1"><div style="font-size:14px;font-weight:700;color:#1a2a3a">'+obj.name+'</div>'+
          '<div style="font-size:11px;color:#9aabbf">нет подписанных договоров</div></div>'+
        '</div>'+
      '</div>';
      return;
    }

    // Object header
    html+='<div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px 4px">'+
      '<span style="font-size:18px">'+obj.icon+'</span>'+
      '<span style="font-size:12px;font-weight:700;color:#7a9aaa;letter-spacing:0.5px">'+obj.name.toUpperCase()+'</span>'+
      '<span style="font-size:11px;color:#9aabbf">· '+signedContracts.length+' договор'+(signedContracts.length===1?"":"а")+'</span>'+
    '</div>';

    signedContracts.forEach(function(c){
      const mainAmt=c.type==="main"?(c.amount||0):0;
      const ewTotal=(c.extraWorks||[]).reduce(function(a,w){
        return a+(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);
      },0);
      const contractTotal=mainAmt+ewTotal;

      // Transactions linked to this contract (filter by contractId or fall back to obj)
      const txns=finTxns.filter(function(t){return t.contractId===c.id||(!t.contractId&&t.objId===obj.id);});
      const income=txns.filter(function(t){return t.type==="income";}).reduce(function(a,t){return a+t.amount;},0);
      const expense=txns.filter(function(t){return t.type==="expense";}).reduce(function(a,t){return a+t.amount;},0);
      const remaining=Math.max(0,contractTotal-income);
      const paidPct=contractTotal>0?Math.min(100,Math.round(income/contractTotal*100)):0;

      // Salaries for this contract
      const salaries=c.salaries||{};
      const salPaid=Object.values(salaries).reduce(function(a,s){return a+(s.paid||0);},0);
      const salPlan=Object.values(salaries).reduce(function(a,s){return a+(s.plan||0);},0);

      // Profit per contract
      const profit=contractTotal-expense-salPaid;

      // CRM client
      const cl=c.crmClientId?crmClients.find(function(cc){return cc.id===c.crmClientId;}):null;
      const phone=cl?cl.phone:"";
      // Responsible users (used in supply/salary blocks below)
      const respIds=c.responsible||[];

      // Status badge
      const statusColor=c.status==="closed"?"#27ae60":"#2980b9";
      const statusLabel=c.status==="closed"?"Закрыт":"Подписан";

      const isSelected=finSelectedContractIds.includes(c.id);

      // ── COMPACT VIEW for brigadier/worker (only their salary) ──
      const isBrigOnly=currentUser&&(currentUser.roles.includes("brigadier")||currentUser.roles.includes("worker"))&&!currentUser.roles.includes("admin")&&!currentUser.roles.includes("financier");
      const isEscortOnly=currentUser&&currentUser.roles.includes("sales_head")&&!currentUser.roles.includes("admin")&&!currentUser.roles.includes("financier")&&!currentUser.roles.includes("brigadier")&&!currentUser.roles.includes("worker");

      if(isBrigOnly||isEscortOnly){
        const salaries2=c.salaries||{};
        const me=currentUser;
        const rawUd2=salaries2[me.id]||{};
        const effPlan=rawUd2.plan!=null&&rawUd2.plan!==0?rawUd2.plan:getDefaultSalary(me);
        // Calculate paid from transactions (same source as everywhere else)
        const myPaid=getSalaryPaid(c,me);
        const myLeft=Math.max(0,effPlan-myPaid);
        const sColor=isBrigOnly?"#e67e22":"#9b59b6";
        const sTitle=isBrigOnly?"👷 ЗАРПЛАТА ПРОИЗВОДСТВА":"🚚 ЗАРПЛАТА РОПа";

        // Get user's payment transactions for this contract
        // Show: (1) tagged with this user.id, (2) untagged group txns if user is the only eligible (share)
        const respIds=c.responsible||[];
        const eligibleSameGroup=users.filter(function(u){
          if(!respIds.includes(u.id))return false;
          if(isEscortOnly)return u.roles.includes("sales_head");
          return u.roles.some(function(r){return r==="brigadier"||r==="worker";});
        });
        const myTxns=finTxns.filter(function(t){
          if(t.type!=="expense")return false;
          if(t.contractId!==c.id)return false;
          const grp=txnCategoryGroup(t.category);
          const isMyGroup=(isBrigOnly&&grp==="salary_prod")||(isEscortOnly&&grp==="salary_escort");
          if(!isMyGroup)return false;
          if(t.userId===me.id)return true;
          if(t.userId)return false;
          return eligibleSameGroup.find(function(u){return u.id===me.id;});
        });
        // Extra works — show separately for brigadier
        const myExtraTxns=isBrigOnly?finTxns.filter(function(t){
          return t.type==="expense"&&t.contractId===c.id&&txnCategoryGroup(t.category)==="salary_prod_extra";
        }):[];
        const myExtraTotal=myExtraTxns.reduce(function(a,t){return a+(t.amount||0);},0);

        // Премия за уборку (фото-отчёты) — накопительно, только для производства
        const myCleanupTxns=isBrigOnly?finTxns.filter(function(t){
          if(t.type!=="expense"||t.contractId!==c.id)return false;
          if((t.category||"").indexOf("Премия за уборку")<0)return false;
          if(t.userId===me.id)return true;
          if(t.userId)return false;
          return eligibleSameGroup.find(function(u){return u.id===me.id;});
        }):[];
        // По датам по возрастанию + нарастающий итог
        myCleanupTxns.sort(function(a,b){return (a.date||"").localeCompare(b.date||"");});
        const myCleanupTotal=myCleanupTxns.reduce(function(a,t){return a+(t.amount||0);},0);

        html+='<div style="background:#fff;border-radius:14px;border:2px solid '+sColor+'33;margin-bottom:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">';
        // Contract title (small)
        html+='<div style="padding:10px 14px;background:linear-gradient(135deg,#f8fafc,#ffffff);border-bottom:1px solid #f0f3f7">'+
          '<div style="font-size:12px;font-weight:700;color:#1a2a3a">'+c.name+'</div>'+
        '</div>';
        // Salary block
        html+='<div style="padding:12px 14px">'+
          '<div style="font-size:11px;color:'+sColor+';font-weight:700;letter-spacing:0.5px;margin-bottom:10px">'+sTitle+'</div>'+
          // Totals row
          '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:10px;background:'+sColor+'08;border-radius:10px;margin-bottom:8px">'+
            '<div><div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.3px">ПЛАН</div><div style="font-size:14px;font-weight:700;color:#1a2a3a;margin-top:2px">'+effPlan.toLocaleString("ru-RU")+'</div></div>'+
            '<div><div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.3px">ФАКТ</div><div style="font-size:14px;font-weight:700;color:#27ae60;margin-top:2px">'+myPaid.toLocaleString("ru-RU")+'</div></div>'+
            '<div><div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.3px">ОСТАЛОСЬ</div><div style="font-size:14px;font-weight:700;color:'+(myLeft>0?"#e67e22":"#27ae60")+';margin-top:2px">'+(myLeft>0?myLeft.toLocaleString("ru-RU"):"✓")+'</div></div>'+
          '</div>'+
          // History
          (myTxns.length?
            '<div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.5px;margin:10px 0 4px">ИСТОРИЯ ВЫПЛАТ ('+myTxns.length+')</div>'+
            myTxns.map(function(t){
              return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fafbfc;border-radius:8px;margin-bottom:4px;font-size:11px">'+
                '<div style="flex:1"><div style="font-weight:600;color:#1a2a3a">'+t.category+'</div><div style="font-size:9px;color:#9aabbf;margin-top:1px">'+t.date+(t.note?" · "+t.note:"")+'</div></div>'+
                '<div style="font-weight:700;color:#e74c3c">−'+t.amount.toLocaleString("ru-RU")+' ₽</div>'+
              '</div>';
            }).join(""):
            '<div style="text-align:center;padding:12px;color:#9aabbf;font-size:11px;border:1px dashed #dde6f0;border-radius:8px">Нет выплат пока</div>'
          )+
        '</div>';
        // 🧹 Премия за уборку — накопительная (фото-отчёты)
        if(isBrigOnly){
          const cleanOpen=!!cleanupExpanded[c.id];
          html+='<div style="padding:12px 14px;border-top:1px solid #f0f3f7">'+
            '<div data-a="cleanup-toggle" data-cid="'+c.id+'" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;'+(cleanOpen?'margin-bottom:8px':'')+'">'+
              '<div style="display:flex;align-items:center;gap:6px">'+
                '<span style="font-size:11px;color:#9aabbf;transition:transform 0.15s;display:inline-block;transform:rotate('+(cleanOpen?'90':'0')+'deg)">▶</span>'+
                '<div style="font-size:11px;color:#27ae60;font-weight:700;letter-spacing:0.5px">🧹 ПРЕМИЯ ЗА УБОРКУ</div>'+
                (myCleanupTxns.length?'<span style="font-size:9px;color:#9aabbf;background:#f0f4f8;border-radius:8px;padding:1px 6px;font-weight:700">'+myCleanupTxns.length+'</span>':'')+
              '</div>'+
              '<div style="font-size:13px;font-weight:800;color:#27ae60">+'+myCleanupTotal.toLocaleString("ru-RU")+' ₽</div>'+
            '</div>';
          if(cleanOpen){
            html+='<div style="font-size:10px;color:#9aabbf;margin-bottom:8px">Начисляется за каждый сданный отчёт с фото уборки (+'+CLEANUP_BONUS+' ₽). Сумма растёт с каждым отчётом.</div>';
            if(myCleanupTxns.length){
              let run=0;
              html+='<div style="display:flex;flex-direction:column;gap:4px">';
              myCleanupTxns.forEach(function(t){
                run+=(t.amount||0);
                html+='<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#27ae6008;border:1px solid #27ae6022;border-radius:8px;font-size:11px">'+
                  '<span style="font-size:13px">🧹</span>'+
                  '<div style="flex:1;min-width:0"><div style="font-weight:600;color:#1a2a3a">'+(t.date||"")+'</div>'+(t.note?'<div style="font-size:9px;color:#9aabbf;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+t.note+'</div>':'')+'</div>'+
                  '<div style="text-align:right;flex-shrink:0"><div style="font-weight:700;color:#27ae60">+'+(t.amount||0).toLocaleString("ru-RU")+'</div><div style="font-size:9px;color:#9aabbf">итого '+run.toLocaleString("ru-RU")+' ₽</div></div>'+
                '</div>';
              });
              html+='</div>';
              const maxRun=myCleanupTotal||1;
              html+='<div style="margin-top:8px;display:flex;align-items:flex-end;gap:3px;height:34px">';
              let run2=0;
              myCleanupTxns.forEach(function(t){
                run2+=(t.amount||0);
                const hpc=Math.round(run2/maxRun*100);
                html+='<div style="flex:1;background:#27ae60;border-radius:3px 3px 0 0;height:'+Math.max(8,hpc)+'%;min-width:6px" title="'+t.date+': '+run2+' ₽"></div>';
              });
              html+='</div>';
              html+='<div style="font-size:9px;color:#9aabbf;text-align:center;margin-top:3px">Рост премии по отчётам</div>';
            } else {
              html+='<div style="text-align:center;padding:12px;color:#9aabbf;font-size:11px;border:1px dashed #dde6f0;border-radius:8px">Пока нет премий. Сдайте отчёт с фото уборки — премия начнёт накапливаться.</div>';
            }
          }
          html+='</div>';
        }
        // Extra works block — separate (always show for brigadier if there are plans or txns)
        const cExtraPlan=c.extraWorksPlan||[];
        const cExtraPlanTotal=cExtraPlan.reduce(function(a,w){return a+(w.amount||0);},0);
        // Always show ДОП РАБОТЫ for brigadier on contracts where they're responsible
        if(isBrigOnly){
          const extraRemain=Math.max(0,cExtraPlanTotal-myExtraTotal);
          html+='<div style="padding:12px 14px;border-top:1px solid #f0f3f7">'+
            '<div style="font-size:11px;color:#16a085;font-weight:700;letter-spacing:0.5px;margin-bottom:8px">🛠 ДОП РАБОТЫ</div>'+
            // Plan / Fact / Remaining
            '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:10px;background:#16a08508;border-radius:10px;margin-bottom:8px">'+
              '<div><div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.3px">ПЛАН</div><div style="font-size:14px;font-weight:700;color:#1a2a3a;margin-top:2px">'+cExtraPlanTotal.toLocaleString("ru-RU")+'</div></div>'+
              '<div><div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.3px">ФАКТ</div><div style="font-size:14px;font-weight:700;color:#16a085;margin-top:2px">'+myExtraTotal.toLocaleString("ru-RU")+'</div></div>'+
              '<div><div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.3px">ОСТАЛОСЬ</div><div style="font-size:14px;font-weight:700;color:'+(extraRemain>0?"#e67e22":"#27ae60")+';margin-top:2px">'+(extraRemain>0?extraRemain.toLocaleString("ru-RU"):"✓")+'</div></div>'+
            '</div>'+
            // Planned items
            (cExtraPlan.length?
              '<div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.5px;margin:8px 0 4px">ЗАПЛАНИРОВАНО</div>'+
              cExtraPlan.map(function(it){
                return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#16a08508;border-radius:8px;margin-bottom:4px;border:1px solid #16a08522;font-size:11px">'+
                  '<span style="font-size:13px">🛠</span>'+
                  '<div style="flex:1"><div style="font-weight:700;color:#1a2a3a">'+(it.title||"Доп работа")+'</div></div>'+
                  '<div style="font-weight:700;color:#16a085">'+(it.amount||0).toLocaleString("ru-RU")+' ₽</div>'+
                '</div>';
              }).join(""):
              '<div style="font-size:11px;color:#9aabbf;text-align:center;padding:10px;border:1px dashed #d0dae8;border-radius:8px;margin-bottom:6px">Доп работ пока не запланировано</div>'
            )+
            // Paid transactions
            (myExtraTxns.length?
              '<div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.5px;margin:8px 0 4px">ВЫПЛАТЫ</div>'+
              myExtraTxns.map(function(t){
                return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fafbfc;border-radius:8px;margin-bottom:4px;font-size:11px">'+
                  '<div style="flex:1"><div style="font-weight:600;color:#1a2a3a">'+t.category+'</div><div style="font-size:9px;color:#9aabbf;margin-top:1px">'+t.date+(t.note?" · "+t.note:"")+'</div></div>'+
                  '<div style="font-weight:700;color:#16a085">+'+t.amount.toLocaleString("ru-RU")+' ₽</div>'+
                '</div>';
              }).join(""):"")+
          '</div>';
        }
        html+='</div>';
        return; // skip rest of full card
      }

      html+='<div style="background:#fff;border-radius:16px;border:2px solid '+(isSelected?statusColor:"#e0e8f0")+';margin-bottom:14px;overflow:hidden;box-shadow:'+(isSelected?"0 4px 16px "+statusColor+"33":"0 2px 8px rgba(0,0,0,0.06)")+'">';
      // Checkbox row above the card body
      html+='<div style="display:flex;align-items:center;gap:10px;padding:10px 14px 0;background:#fff">'+
        '<div data-a="fin-toggle-select" data-cid="'+c.id+'" style="width:22px;height:22px;border-radius:6px;background:'+(isSelected?statusColor:"#fff")+';border:2px solid '+(isSelected?statusColor:"#c8d8e8")+';display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">'+(isSelected?"✓":"")+'</div>'+
        '<div style="font-size:10px;color:#9aabbf;font-weight:600">'+(isSelected?"✓ Выбран для дашборда":"Нажмите ☐ чтобы добавить в дашборд")+'</div>'+
      '</div>';
      // The clickable area to open P&L
      html+='<div data-a="fin-open" data-oid="'+obj.id+'" data-cid="'+c.id+'" style="cursor:pointer">';

      // Header — contract name + client + profit
      html+='<div style="padding:12px 14px;border-bottom:1px solid #f0f3f7;background:linear-gradient(135deg,#f8fafc,#ffffff)">'+
        '<div style="display:flex;align-items:flex-start;gap:10px">'+
          '<div style="flex:1;min-width:0">'+
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'+
              '<span style="font-size:9px;font-weight:700;background:'+statusColor+'18;color:'+statusColor+';border-radius:5px;padding:1px 7px">'+statusLabel+'</span>'+
              '<span style="font-size:9px;background:'+(c.type==="main"?"#2980b918":"#8e44ad18")+';color:'+(c.type==="main"?"#2980b9":"#8e44ad")+';border-radius:5px;padding:1px 7px">'+(c.type==="main"?"Основной":"Доп. работы")+'</span>'+
            '</div>'+
            '<div style="font-size:13px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</div>'+
            '<div style="font-size:11px;color:#5a7a9a;margin-top:3px">'+
              '<span style="font-weight:600">👤 '+(c.client||"—")+'</span>'+
              (phone?'<span style="color:#9aabbf"> · '+phone+'</span>':'')+
            '</div>'+
            (c.signDate?'<div style="font-size:10px;color:#9aabbf;margin-top:2px">📅 '+c.signDate+'</div>':'')+
          '</div>'+
          '<div style="text-align:right;flex-shrink:0">'+
            '<div style="font-size:9px;color:#9aabbf;letter-spacing:0.5px">ПРИБЫЛЬ</div>'+
            '<div style="font-size:15px;font-weight:700;color:'+(profit>=0?"#27ae60":"#e74c3c")+'">'+(profit>=0?"+":"")+profit.toLocaleString("ru-RU")+' ₽</div>'+
          '</div>'+
        '</div>'+
      '</div>';

      // Main amounts row
      html+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid #f0f3f7">'+
        '<div style="padding:10px 12px;border-right:1px solid #f0f3f7">'+
          '<div style="font-size:9px;color:#2980b9;font-weight:700;letter-spacing:0.5px;margin-bottom:3px">ДОГОВОР</div>'+
          '<div style="font-size:13px;font-weight:700;color:#2980b9">'+(contractTotal?contractTotal.toLocaleString("ru-RU")+" ₽":"—")+'</div>'+
          (ewTotal>0?'<div style="font-size:9px;color:#8e44ad;margin-top:1px">+'+ewTotal.toLocaleString("ru-RU")+" доп.":"")+
        '</div>'+
        '<div style="padding:10px 12px;border-right:1px solid #f0f3f7">'+
          '<div style="font-size:9px;color:#27ae60;font-weight:700;letter-spacing:0.5px;margin-bottom:3px">ПОЛУЧЕНО</div>'+
          '<div style="font-size:13px;font-weight:700;color:#27ae60">+'+income.toLocaleString("ru-RU")+'</div>'+
          (contractTotal?'<div style="font-size:9px;color:#9aabbf;margin-top:1px">'+paidPct+'%</div>':'')+
        '</div>'+
        '<div style="padding:10px 12px">'+
          '<div style="font-size:9px;color:'+(remaining>0?"#f39c12":"#27ae60")+';font-weight:700;letter-spacing:0.5px;margin-bottom:3px">ОСТАТОК</div>'+
          '<div style="font-size:13px;font-weight:700;color:'+(remaining>0?"#f39c12":"#27ae60")+'">'+
            (contractTotal?(remaining<=0?"✓ 0 ₽":remaining.toLocaleString("ru-RU")+" ₽"):"—")+
          '</div>'+
        '</div>'+
      '</div>';

      // Progress bar
      if(contractTotal){
        html+='<div style="height:3px;background:#e8eef5"><div style="height:100%;background:'+(paidPct>=100?"#27ae60":paidPct>=50?"#2980b9":"#f39c12")+';width:'+paidPct+'%;transition:width 0.4s"></div></div>';
      }

      // ── SUPPLY BLOCK (materials for this object) ──
      const objMats=obj.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});});
      const matsTotal=objMats.length;
      const matsPlan=objMats.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
      const matsFact=objMats.filter(function(m){return!!purchased[m.id];}).reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
      const matsLeft=matsPlan-matsFact;
      const matsBought=objMats.filter(function(m){return!!purchased[m.id];}).length;

      html+='<div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #f0f3f7">'+
        '<div style="font-size:10px;color:#2980b9;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">📦 СНАБЖЕНИЕ</div>'+
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">'+
          '<div>'+
            '<div style="font-size:9px;color:#7a9aaa">МАТЕРИАЛОВ</div>'+
            '<div style="font-size:12px;font-weight:700;color:#1a2a3a">'+matsBought+' / '+matsTotal+'</div>'+
          '</div>'+
          '<div>'+
            '<div style="font-size:9px;color:#7a9aaa">ПОТРАЧЕНО ₽</div>'+
            '<div style="font-size:12px;font-weight:700;color:#27ae60">'+matsFact.toLocaleString("ru-RU")+'</div>'+
          '</div>'+
          '<div>'+
            '<div style="font-size:9px;color:#7a9aaa">КУПИТЬ ₽</div>'+
            '<div style="font-size:12px;font-weight:700;color:#2980b9">'+matsPlan.toLocaleString("ru-RU")+'</div>'+
          '</div>'+
          '<div>'+
            '<div style="font-size:9px;color:#7a9aaa">ОСТАЛОСЬ ₽</div>'+
            '<div style="font-size:12px;font-weight:700;color:'+(matsLeft>0?"#f39c12":"#27ae60")+'">'+matsLeft.toLocaleString("ru-RU")+'</div>'+
          '</div>'+
        '</div>'+
      '</div>';

      // ── PRODUCTION SALARIES (brigadier/worker) ──
      const prodSalUsers=users.filter(function(u){
        return respIds.includes(u.id)&&u.roles.some(function(r){return r==="brigadier"||r==="worker";});
      });
      if(prodSalUsers.length){
        html+='<div style="padding:10px 14px;border-bottom:1px solid #f0f3f7">'+
          '<div style="font-size:10px;color:#e67e22;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">👷 ЗАРПЛАТА ПРОИЗВОДСТВА</div>';
        prodSalUsers.forEach(function(u){
          const rawUd=salaries[u.id]||{};
          const effectivePlan=rawUd.plan!=null&&rawUd.plan!==0?rawUd.plan:getDefaultSalary(u);
          const actualPaid=getSalaryPaid(c,u);
          const ud={plan:effectivePlan,paid:actualPaid};
          const left=Math.max(0,(ud.plan||0)-(ud.paid||0));
          html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:5px 7px;background:#fafbfc;border-radius:7px;border:1px solid #f0f3f7">'+
            '<span style="font-size:14px">'+u.av+'</span>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:11px;font-weight:700;color:#1a2a3a">'+u.name+'</div>'+
              '<div style="font-size:9px;color:#9aabbf">'+u.roles.map(function(r){const ro=roles.find(function(x){return x.id===r;});return ro?ro.n:"";}).filter(Boolean).join(", ")+'</div>'+
            '</div>'+
            '<div style="text-align:right">'+
              '<div style="font-size:11px;font-weight:700;color:#27ae60">'+(ud.paid||0).toLocaleString("ru-RU")+'</div>'+
              '<div style="font-size:9px;color:#9aabbf">из '+(ud.plan||0).toLocaleString("ru-RU")+'</div>'+
            '</div>'+
            (left>0?'<span style="font-size:9px;color:#e67e22;font-weight:700;background:#e67e2212;border-radius:5px;padding:2px 6px;margin-left:4px">−'+left.toLocaleString("ru-RU")+'</span>':((ud.plan||0)>0?'<span style="font-size:9px;color:#27ae60;font-weight:700;background:#27ae6012;border-radius:5px;padding:2px 6px;margin-left:4px">✓ Выпл.</span>':'<span style="font-size:9px;color:#9aabbf;font-weight:700;background:#9aabbf18;border-radius:5px;padding:2px 6px;margin-left:4px">Без плана</span>'))+
          '</div>';
        });
        html+='</div>';
      }

      // ── ESCORT SALARIES (сопроводитель) ──
      const escortSalUsers=users.filter(function(u){
        return respIds.includes(u.id)&&u.roles.includes("sales_head");
      });
      if(escortSalUsers.length){
        html+='<div style="padding:10px 14px;border-bottom:1px solid #f0f3f7">'+
          '<div style="font-size:10px;color:#9b59b6;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">🚚 ЗАРПЛАТА РОПа</div>';
        escortSalUsers.forEach(function(u){
          const rawUd=salaries[u.id]||{};
          const effectivePlan=rawUd.plan!=null&&rawUd.plan!==0?rawUd.plan:getDefaultSalary(u);
          const actualPaid=getSalaryPaid(c,u);
          const ud={plan:effectivePlan,paid:actualPaid};
          const left=Math.max(0,(ud.plan||0)-(ud.paid||0));
          html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:5px 7px;background:#fafbfc;border-radius:7px;border:1px solid #f0f3f7">'+
            '<span style="font-size:14px">'+u.av+'</span>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:11px;font-weight:700;color:#1a2a3a">'+u.name+'</div>'+
              '<div style="font-size:9px;color:#9aabbf">РОП</div>'+
            '</div>'+
            '<div style="text-align:right">'+
              '<div style="font-size:11px;font-weight:700;color:#27ae60">'+(ud.paid||0).toLocaleString("ru-RU")+'</div>'+
              '<div style="font-size:9px;color:#9aabbf">из '+(ud.plan||0).toLocaleString("ru-RU")+'</div>'+
            '</div>'+
            (left>0?'<span style="font-size:9px;color:#e67e22;font-weight:700;background:#e67e2212;border-radius:5px;padding:2px 6px;margin-left:4px">−'+left.toLocaleString("ru-RU")+'</span>':((ud.plan||0)>0?'<span style="font-size:9px;color:#27ae60;font-weight:700;background:#27ae6012;border-radius:5px;padding:2px 6px;margin-left:4px">✓ Выпл.</span>':'<span style="font-size:9px;color:#9b59b6;font-weight:700;background:#9b59b612;border-radius:5px;padding:2px 6px;margin-left:4px">+ План</span>'))+
          '</div>';
        });
        html+='</div>';
      }

      // 🛠 ДОП РАБОТЫ block — show only when there's a plan or transactions
      const extraPlanItems=c.extraWorksPlan||[];
      const extraPlanSum=extraPlanItems.reduce(function(a,w){return a+(w.amount||0);},0);
      const extraPaid=getExtraWorksPaid(c);
      if(extraPlanItems.length||extraPaid>0){
        const extraLeft=Math.max(0,extraPlanSum-extraPaid);
        html+='<div style="padding:10px 14px;border-bottom:1px solid #f0f3f7">'+
          '<div style="font-size:10px;color:#16a085;font-weight:700;letter-spacing:0.5px;margin-bottom:6px">🛠 ДОП РАБОТЫ ПРОИЗВОДСТВА</div>'+
          '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:8px 10px;background:#16a08508;border-radius:8px;border:1px solid #16a08522">'+
            '<div><div style="font-size:9px;color:#9aabbf;font-weight:600">ПЛАН</div><div style="font-size:12px;font-weight:700;color:#1a2a3a">'+extraPlanSum.toLocaleString("ru-RU")+'</div></div>'+
            '<div><div style="font-size:9px;color:#9aabbf;font-weight:600">ВЫПЛАЧЕНО</div><div style="font-size:12px;font-weight:700;color:#16a085">'+extraPaid.toLocaleString("ru-RU")+'</div></div>'+
            '<div><div style="font-size:9px;color:#9aabbf;font-weight:600">ОСТАЛОСЬ</div><div style="font-size:12px;font-weight:700;color:'+(extraLeft>0?"#e67e22":"#27ae60")+'">'+(extraLeft>0?extraLeft.toLocaleString("ru-RU"):"✓")+'</div></div>'+
          '</div>'+
          // List of plans
          (extraPlanItems.length?
            extraPlanItems.map(function(it){
              return '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;padding:5px 8px;background:#fff;border-radius:7px;border:1px solid #f0f3f7;font-size:10.5px">'+
                '<span style="font-size:12px">🛠</span>'+
                '<div style="flex:1;min-width:0;color:#1a2a3a;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(it.title||"Доп работа")+'</div>'+
                '<div style="color:#16a085;font-weight:700;white-space:nowrap">'+(it.amount||0).toLocaleString("ru-RU")+' ₽</div>'+
              '</div>';
            }).join(""):"")+
        '</div>';
      }

      // Responsible footer
      if(respIds.length){
        const respUsers=users.filter(function(u){return respIds.includes(u.id);});
        html+='<div style="padding:7px 12px;background:#fafbfc;display:flex;align-items:center;gap:6px;flex-wrap:wrap;border-top:1px solid #f0f3f7">'+
          '<span style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.3px">ОТВЕТСТВЕННЫЕ:</span>'+
          respUsers.map(function(u){
            return '<span style="display:inline-flex;align-items:center;gap:3px;background:#fff;border:1px solid '+u.c+'33;border-radius:10px;padding:1px 7px;font-size:10px;color:'+u.c+';font-weight:600">'+u.av+" "+u.name+'</span>';
          }).join("")+
        '</div>';
      }

      html+='</div>'; // close fin-open inner
      html+='</div>'; // close outer card
    });
  });

  html+='</div>';
  return html;
}

function tFinanceContractPnL(cid){
  const c=contractDocs.find(function(x){return x.id===cid;});
  if(!c){finOpenContractId=null;return tFinanceList();}
  // Access guard: non-admin/financier can only view contracts where they're responsible
  if(currentUser&&!currentUser.roles.includes("admin")&&!currentUser.roles.includes("financier")&&!(c.responsible||[]).includes(currentUser.id)){
    finOpenContractId=null;
    return tFinanceList();
  }
  const obj=objects.find(function(o){return o.id===c.objId;});
  if(!obj){finOpenContractId=null;return tFinanceList();}

  const user=currentUser;
  const isAdmin=user&&user.roles.includes("admin");
  const isFinancier=user&&user.roles.includes("financier");
  const isSupply=user&&user.roles.includes("supply");
  const isBrigadier=user&&user.roles.includes("brigadier");
  const isWorker=user&&user.roles.includes("worker");
  const isEscort=user&&user.roles.includes("sales_head");
  const canAddSupply=isAdmin||isFinancier||isSupply;
  const canAddSalary=isAdmin||isFinancier;
  const canAddIncome=isAdmin||isFinancier;
  // Section visibility by role
  const canSeeIncome=isAdmin||isFinancier;
  const canSeeSupply=isAdmin||isFinancier||isSupply;
  const canSeeSalaryProd=isAdmin||isFinancier||isBrigadier||isWorker;
  const canSeeSalaryEscort=isAdmin||isFinancier||isEscort;

  // Contract amounts
  const mainAmt=c.type==="main"?(c.amount||0):0;
  const ewTotal=(c.extraWorks||[]).reduce(function(a,w){return a+(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);},0);
  const contractTotal=mainAmt+ewTotal;

  // Transactions for this contract (filter by contractId)
  const txns=finTxns.filter(function(t){return t.contractId===cid;}).slice().sort(function(a,b){return a.date.localeCompare(b.date);});

  // Group transactions
  const supplyTxns=txns.filter(function(t){return txnCategoryGroup(t.category)==="supply";});
  const salaryProdTxns=txns.filter(function(t){return txnCategoryGroup(t.category)==="salary_prod";});
  const salaryEscortTxns=txns.filter(function(t){return txnCategoryGroup(t.category)==="salary_escort";});
  const incomeTxns=txns.filter(function(t){return t.type==="income";});

  const supplySpent=supplyTxns.reduce(function(a,t){return a+t.amount;},0);
  const salaryProdSpent=salaryProdTxns.reduce(function(a,t){return a+t.amount;},0);
  const salaryEscortSpent=salaryEscortTxns.reduce(function(a,t){return a+t.amount;},0);
  const incomeTotal=incomeTxns.reduce(function(a,t){return a+t.amount;},0);

  const totalExpense=supplySpent+salaryProdSpent+salaryEscortSpent+txns.filter(function(t){return t.type==="expense"&&txnCategoryGroup(t.category)==="other";}).reduce(function(a,t){return a+t.amount;},0);
  const balance=incomeTotal-totalExpense;
  const profit=contractTotal-totalExpense;
  const remaining=Math.max(0,contractTotal-incomeTotal);
  const paidPct=contractTotal>0?Math.min(100,Math.round(incomeTotal/contractTotal*100)):0;

  // Plans from contract.salaries
  const salaries=c.salaries||{};
  const prodSalUsers=users.filter(function(u){return (c.responsible||[]).includes(u.id)&&u.roles.some(function(r){return r==="brigadier"||r==="worker";});});
  const escortSalUsers=users.filter(function(u){return (c.responsible||[]).includes(u.id)&&u.roles.includes("sales_head");});
  const prodPlanTotal=prodSalUsers.reduce(function(a,u){
    const raw=(salaries[u.id]||{});
    return a+(raw.plan!=null&&raw.plan!==0?raw.plan:getDefaultSalary(u));
  },0);
  const escortPlanTotal=escortSalUsers.reduce(function(a,u){
    const raw=(salaries[u.id]||{});
    return a+(raw.plan!=null&&raw.plan!==0?raw.plan:getDefaultSalary(u));
  },0);

  // Materials plan (из материалов объекта) + факт (отмеченные «куплено» снабженцем)
  const objMats=obj.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});});
  const matsPlan=objMats.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
  const matsFact=objMats.filter(function(m){return!!purchased[m.id];}).reduce(function(a,m){return a+m.cost*(m.qty||1);},0);

  // CRM client
  const crmCl=c.crmClientId?crmClients.find(function(cc){return cc.id===c.crmClientId;}):null;

  let html='<div>';

  // Header
  html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">'+
    '<button data-a="fin-back" style="padding:6px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Назад</button>'+
    '<div style="flex:1;min-width:0">'+
      '<div style="font-size:14px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</div>'+
      '<div style="font-size:11px;color:#7a9aaa;margin-top:1px">'+obj.icon+' '+obj.name+' · 👤 '+(c.client||"—")+(crmCl?" · "+crmCl.phone:"")+'</div>'+
    '</div>'+
  '</div>';

  // Top summary card
  html+='<div style="background:linear-gradient(135deg,#1a2a3a,#2a4a6a);border-radius:14px;padding:14px 16px;margin-bottom:14px;color:#fff">'+
    '<div style="font-size:10px;color:rgba(255,255,255,0.5);font-weight:700;letter-spacing:1px;margin-bottom:10px">P&L ПО ДОГОВОРУ</div>'+
    '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:10px">'+
      '<div><div style="font-size:9px;color:rgba(255,255,255,0.45);font-weight:700;margin-bottom:3px">ДОГОВОР</div><div style="font-size:15px;font-weight:700;color:#60a5fa">'+contractTotal.toLocaleString("ru-RU")+'</div></div>'+
      '<div><div style="font-size:9px;color:rgba(255,255,255,0.45);font-weight:700;margin-bottom:3px">ПОЛУЧЕНО</div><div style="font-size:15px;font-weight:700;color:#27ae60">+'+incomeTotal.toLocaleString("ru-RU")+'</div><div style="font-size:9px;color:rgba(255,255,255,0.35);margin-top:1px">'+paidPct+'%</div></div>'+
      '<div><div style="font-size:9px;color:rgba(255,255,255,0.45);font-weight:700;margin-bottom:3px">ОСТАТОК</div><div style="font-size:15px;font-weight:700;color:'+(remaining>0?"#f59e0b":"#27ae60")+'">'+(remaining>0?remaining.toLocaleString("ru-RU"):"✓")+'</div></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">'+
      '<div><div style="font-size:9px;color:rgba(255,255,255,0.45);font-weight:700;margin-bottom:3px">РАСХОДЫ</div><div style="font-size:14px;font-weight:700;color:#e74c3c">−'+totalExpense.toLocaleString("ru-RU")+'</div></div>'+
      '<div><div style="font-size:9px;color:rgba(255,255,255,0.45);font-weight:700;margin-bottom:3px">ПРИБЫЛЬ</div><div style="font-size:14px;font-weight:700;color:'+(profit>=0?"#2ecc71":"#e74c3c")+'">'+(profit>=0?"+":"")+profit.toLocaleString("ru-RU")+'</div></div>'+
    '</div>'+
  '</div>';

  // ── INCOME SECTION (admin / financier only) ──
  if(canSeeIncome){
    html+=renderContractSection({
      title:"💰 ПРИХОДЫ ОТ КЛИЕНТА",
      color:"#27ae60",
      txns:incomeTxns,
      total:incomeTotal,
      planLabel:"План",
      planAmount:contractTotal,
      canAdd:canAddIncome,
      addAction:"fin-add-typed",
      addType:"income",
      cid:cid
    });
  }

  // ── SUPPLY SECTION (admin / financier / supply) ──
  if(canSeeSupply){
    html+=renderContractSection({
      title:"📦 СНАБЖЕНИЕ",
      color:"#2980b9",
      txns:supplyTxns,
      total:supplySpent+matsFact,
      planLabel:"План",
      planAmount:matsPlan,
      factNote:matsFact>0?"вкл. «куплено» "+matsFact.toLocaleString("ru-RU")+" ₽":"",
      canAdd:canAddSupply,
      addAction:"fin-add-typed",
      addType:"expense",
      addCategory:"📦 Закупка материалов",
      cid:cid
    });
  }

  // ── PRODUCTION SALARY SECTION (brigadier/worker see only this; admin/financier see all) ──
  if(canSeeSalaryProd){
    // For brigadier/worker — filter to show only their own row
    const myProdUsers=(isBrigadier||isWorker)&&!isAdmin&&!isFinancier?
      prodSalUsers.filter(function(u){return u.id===user.id;}):
      prodSalUsers;
    html+=renderContractSection({
      title:"👷 ЗАРПЛАТА ПРОИЗВОДСТВА",
      color:"#e67e22",
      txns:salaryProdTxns,
      total:salaryProdSpent,
      planLabel:"План",
      planAmount:prodPlanTotal,
      canAdd:canAddSalary,
      addAction:"fin-add-typed",
      addType:"expense",
      addCategory:"👷 Зарплата производства",
      cid:cid,
      showUsers:myProdUsers,
      salaries:salaries
    });
    // ── EXTRA WORKS SECTION (separate from main salary, not summed) ──
    const extraTxns=txns.filter(function(t){return t.type==="expense"&&txnCategoryGroup(t.category)==="salary_prod_extra";});
    const extraSpent=extraTxns.reduce(function(a,t){return a+t.amount;},0);
    const extraPlanItems=c.extraWorksPlan||[];
    const extraPlanTotal=extraPlanItems.reduce(function(a,w){return a+(w.amount||0);},0);
    if(extraTxns.length||extraPlanItems.length||isAdmin||isFinancier){
      html+=renderContractSection({
        title:"🛠 ДОП РАБОТЫ ПРОИЗВОДСТВА",
        color:"#16a085",
        txns:extraTxns,
        total:extraSpent,
        planLabel:"План",
        planAmount:extraPlanTotal,
        canAdd:canAddSalary,
        addAction:"fin-add-typed",
        addType:"expense",
        addCategory:"🛠 Доп. работы производства",
        cid:cid,
        showUsers:[],
        salaries:salaries,
        isExtra:true,
        extraPlanItems:extraPlanItems
      });
    }
  }

  // ── ESCORT SALARY SECTION (escort see only this; admin/financier see all) ──
  if(canSeeSalaryEscort&&(escortSalUsers.length||salaryEscortTxns.length)){
    // For escort — filter to show only their own row
    const myEscortUsers=isEscort&&!isAdmin&&!isFinancier?
      escortSalUsers.filter(function(u){return u.id===user.id;}):
      escortSalUsers;
    html+=renderContractSection({
      title:"🚚 ЗАРПЛАТА РОПа",
      color:"#9b59b6",
      txns:salaryEscortTxns,
      total:salaryEscortSpent,
      planLabel:"План",
      planAmount:escortPlanTotal,
      canAdd:canAddSalary,
      addAction:"fin-add-typed",
      addType:"expense",
      addCategory:"🚚 Зарплата сопроводителя",
      cid:cid,
      showUsers:myEscortUsers,
      salaries:salaries
    });
  }

  // Form is rendered inline inside the matching section (renderContractSection)

  html+='</div>';
  return html;
}

function renderContractSection(opts){
  // Determine if THIS section should show the add form
  // sectionGroup is set from fin-add-typed handler
  const myGroup=opts.addType==="income"?"income":txnCategoryGroup(opts.addCategory||"");
  const showFormHere=finAddForm&&finNewTxn.sectionGroup===myGroup;
  const c=contractDocs.find(function(x){return x.id===opts.cid;});

  let html='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:10px">';

  // Header
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
    '<div style="font-size:11px;color:'+opts.color+';font-weight:700;letter-spacing:0.5px">'+opts.title+'</div>'+
    (opts.canAdd?'<button data-a="'+opts.addAction+'" data-cid="'+opts.cid+'" data-type="'+opts.addType+'" data-cat="'+(opts.addCategory||"")+'" style="padding:4px 10px;background:'+(showFormHere?"#7a9aaa":opts.color)+';border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:11px;font-weight:600">'+(showFormHere?"× Отмена":"+ Транзакция")+'</button>':"")+
  '</div>';

  // Inline form right under section header when this section is active
  if(showFormHere&&c){
    html+='<div id="fin-form-anchor"></div>';
    html+=renderAddTxnForm(c);
  }

  // Plan vs Fact row
  const left=Math.max(0,(opts.planAmount||0)-opts.total);
  html+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #f0f3f7">'+
    '<div><div style="font-size:9px;color:#9aabbf">ПЛАН</div><div style="font-size:12px;font-weight:700;color:#1a2a3a">'+(opts.planAmount||0).toLocaleString("ru-RU")+'</div></div>'+
    '<div><div style="font-size:9px;color:#9aabbf">ФАКТ</div><div style="font-size:12px;font-weight:700;color:'+opts.color+'">'+opts.total.toLocaleString("ru-RU")+'</div>'+(opts.factNote?'<div style="font-size:8px;color:#9aabbf;margin-top:1px">'+opts.factNote+'</div>':'')+'</div>'+
    '<div><div style="font-size:9px;color:#9aabbf">ОСТАЛОСЬ</div><div style="font-size:12px;font-weight:700;color:'+(left>0?"#f39c12":"#27ae60")+'">'+(left>0?left.toLocaleString("ru-RU"):"✓")+'</div></div>'+
  '</div>';

  // For Extra Works section in финансы: show planned items read-only (manage in договоры)
  if(opts.isExtra){
    const items=opts.extraPlanItems||[];
    if(items.length){
      html+='<div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.5px;margin:8px 0 4px">ЗАПЛАНИРОВАНО ('+items.length+')</div>';
      items.forEach(function(it){
        html+='<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#16a08508;border-radius:8px;margin-bottom:4px;border:1px solid #16a08522">'+
          '<span style="font-size:14px">🛠</span>'+
          '<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:700;color:#1a2a3a">'+(it.title||"Доп работа")+'</div></div>'+
          '<div style="font-size:12px;font-weight:700;color:#16a085">'+(it.amount||0).toLocaleString("ru-RU")+' ₽</div>'+
        '</div>';
      });
      html+='<div style="font-size:9px;color:#9aabbf;margin-top:6px;font-style:italic;text-align:center">💡 Планирование в карточке договора</div>';
    } else if(opts.canAdd){
      html+='<div style="font-size:11px;color:#9aabbf;text-align:center;padding:12px;border:1px dashed #d0dae8;border-radius:8px;margin-bottom:8px">Нет запланированных доп работ.<br><span style="font-size:9px">Планирование в карточке договора</span></div>';
    }
  }

  // Show users with salaries (production/escort) — editable plan
  if(opts.showUsers&&opts.showUsers.length){
    opts.showUsers.forEach(function(u){
      const rawSal=(opts.salaries||{})[u.id]||{};
      const effectivePlan=rawSal.plan!=null&&rawSal.plan!==0?rawSal.plan:getDefaultSalary(u);
      // Compute paid from transactions (fallback to stored value)
      const contractObj=contractDocs.find(function(x){return x.id===opts.cid;});
      const actualPaid=contractObj?getSalaryPaid(contractObj,u):(rawSal.paid||0);
      const sal={plan:effectivePlan,paid:actualPaid};
      const left=Math.max(0,(sal.plan||0)-(sal.paid||0));
      // Read-only row: plan comes from contract, paid from txns
      html+='<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fafbfc;border-radius:8px;margin-bottom:4px;border:1px solid #f0f3f7">'+
        '<span style="font-size:16px">'+u.av+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12px;font-weight:700;color:#1a2a3a">'+u.name+'</div>'+
          '<div style="display:flex;gap:10px;align-items:center;margin-top:3px;font-size:10px">'+
            '<span style="color:#9aabbf">ПЛАН <b style="color:#1a2a3a">'+(sal.plan||0).toLocaleString("ru-RU")+'</b></span>'+
            '<span style="color:#9aabbf">ВЫПЛ <b style="color:'+(sal.paid>0?"#27ae60":"#9aabbf")+'">'+(sal.paid||0).toLocaleString("ru-RU")+'</b></span>'+
            (left>0?'<span style="color:#e67e22;font-weight:700">−'+left.toLocaleString("ru-RU")+'</span>':sal.plan>0?'<span style="color:#27ae60;font-weight:700">✓</span>':"")+
          '</div>'+
        '</div>'+
      '</div>';
    });
  }

  // Transaction history
  if(opts.txns.length){
    html+='<div style="font-size:9px;color:#9aabbf;font-weight:700;letter-spacing:0.5px;margin:10px 0 5px">ИСТОРИЯ ('+opts.txns.length+')</div>';
    opts.txns.forEach(function(t){
      const isIncome=t.type==="income";
      html+='<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;background:#fafbfc;border-radius:7px;margin-bottom:3px;border:1px solid #f0f3f7">'+
        '<div style="width:24px;height:24px;border-radius:6px;background:'+(isIncome?"#27ae6018":"#e74c3c18")+';display:flex;align-items:center;justify-content:center;color:'+(isIncome?"#27ae60":"#e74c3c")+';font-size:13px;flex-shrink:0">'+(isIncome?"↑":"↓")+'</div>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:11px;font-weight:700;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(t.category||"")+'</div>'+
          '<div style="font-size:9px;color:#9aabbf">'+t.date+(t.note?" · "+t.note:"")+'</div>'+
        '</div>'+
        '<div style="font-size:11px;font-weight:700;color:'+(isIncome?"#27ae60":"#e74c3c")+';white-space:nowrap">'+(isIncome?"+":"−")+t.amount.toLocaleString("ru-RU")+'</div>'+
        '<button data-a="fin-del" data-tid="'+t.id+'" style="padding:6px 10px;background:#e74c3c12;border:1.5px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:14px;font-weight:700;min-width:36px;min-height:36px;line-height:1">✕</button>'+
      '</div>';
    });
  } else {
    html+='<div style="font-size:11px;color:#aaa;text-align:center;padding:10px;border:1px dashed #e0e6ee;border-radius:8px">Нет транзакций</div>';
  }

  html+='</div>';
  return html;
}

function renderAddTxnForm(c){
  const isIncome=finNewTxn.type==="income";
  let cats=isIncome?FIN_INCOME_CATS:FIN_EXPENSE_CATS;
  if(!isIncome&&finNewTxn.sectionGroup){
    const g=finNewTxn.sectionGroup;
    cats=cats.filter(function(c){
      const grp=txnCategoryGroup(c);
      return grp===g;
    });
    if(!cats.length)cats=FIN_EXPENSE_CATS;
  }
  // For salary forms: show user selector
  const isSalaryForm=finNewTxn.sectionGroup==="salary_prod"||finNewTxn.sectionGroup==="salary_escort";
  const salaryUsers=isSalaryForm?users.filter(function(u){
    if(!(c.responsible||[]).includes(u.id))return false;
    if(finNewTxn.sectionGroup==="salary_prod"){
      return u.roles.some(function(r){return r==="brigadier"||r==="worker";});
    }
    return u.roles.includes("sales_head");
  }):[];
  // Default userId to first salary user
  if(isSalaryForm&&!finNewTxn.userId&&salaryUsers.length){
    finNewTxn.userId=salaryUsers[0].id;
  }
  return '<div style="background:#fff;border-radius:14px;border:2px solid #2980b9;padding:14px;margin-bottom:14px">'+
    '<div style="font-size:13px;font-weight:700;color:#1a2a3a;margin-bottom:10px">+ Новая транзакция</div>'+
    '<div style="display:flex;gap:6px;margin-bottom:8px">'+
      '<button data-a="fin-type" data-t="income" style="flex:1;padding:7px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:'+(isIncome?"#27ae60":"#f0f4f8")+';color:'+(isIncome?"#fff":"#7a9aaa")+'">↑ Приход</button>'+
      '<button data-a="fin-type" data-t="expense" style="flex:1;padding:7px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:'+(!isIncome?"#e74c3c":"#f0f4f8")+';color:'+(!isIncome?"#fff":"#7a9aaa")+'">↓ Расход</button>'+
    '</div>'+
    '<select id="fin-cat" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;background:#fff;box-sizing:border-box">'+
      cats.map(function(cat){return'<option value="'+cat+'"'+(finNewTxn.category===cat?" selected":"")+'>'+cat+'</option>';}).join("")+
    '</select>'+
    '<div style="display:flex;gap:8px;margin-bottom:8px">'+
      '<input id="fin-amt" type="text" inputmode="numeric" data-money="1" value="'+(finNewTxn.amount?fmtMoney(finNewTxn.amount):"")+'" placeholder="Сумма ₽" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;font-weight:600;outline:none">'+
      '<input id="fin-date" type="date" value="'+(finNewTxn.date||new Date().toISOString().slice(0,10))+'" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none">'+
    '</div>'+
    '<input id="fin-note" value="'+(finNewTxn.note||"")+'" placeholder="Примечание" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;margin-bottom:10px;outline:none;box-sizing:border-box">'+
    payMethodSelector()+
    '<div style="display:flex;gap:6px">'+
      '<button data-a="fin-save" data-cid="'+c.id+'" style="flex:1;padding:8px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">💾 Сохранить</button>'+
      '<button data-a="fin-cancel" style="padding:8px 14px;background:transparent;border:1px solid #d0dae8;border-radius:8px;cursor:pointer;font-size:12px;color:#7a9aaa">Отмена</button>'+
    '</div>'+
  '</div>';
}

function tFinancePnL(oid){
  const obj=objects.find(function(o){return o.id===oid;});
  if(!obj) return tFinanceList();

  const txns=finTxns.filter(function(t){return t.objId===oid;}).slice().sort(function(a,b){return a.date.localeCompare(b.date);});
  const income=txns.filter(function(t){return t.type==="income";}).reduce(function(a,t){return a+t.amount;},0);
  const expense=txns.filter(function(t){return t.type==="expense";}).reduce(function(a,t){return a+t.amount;},0);
  const balance=income-expense;

  let html='<div>';

  // Header + back
  html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'+
    '<button data-a="fin-back" style="padding:6px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Назад</button>'+
    '<span style="font-size:22px">'+obj.icon+'</span>'+
    '<div style="flex:1;min-width:0">'+
      '<div style="font-size:15px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+obj.name+'</div>'+
    '</div>'+
    '<button data-a="fin-add" data-oid="'+oid+'" style="padding:6px 14px;background:#2980b9;border:none;border-radius:9px;cursor:pointer;font-size:12px;color:#fff;font-weight:700">+ Транзакция</button>'+
  '</div>';

  // Contract info
  const contractAmt=getObjectContractAmount(oid);
  const extraWorks=(finExtraWorks[oid]||[]);
  const extraTotal=extraWorks.reduce(function(a,w){return a+w.amount;},0);
  const contractTotal=contractAmt+extraTotal;
  const contractRemaining=contractTotal-income;

  // Contract block
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
    '<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ДОГОВОР</div>'+
    '<button data-a="fin-edit-contract" data-oid="'+oid+'" style="padding:3px 10px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:6px;cursor:pointer;font-size:11px;color:#5a7a9a">✏️ Изменить</button>'+
  '</div>';
  // Contract row
  html+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px">';
  html+='<div style="background:#2980b910;border:1px solid #2980b933;border-radius:10px;padding:10px;text-align:center">'+
    '<div style="font-size:9px;color:#2980b9;font-weight:700;letter-spacing:0.5px;margin-bottom:3px">СУММА ДОГОВОРА</div>'+
    '<div style="font-size:16px;font-weight:700;color:#2980b9">'+(contractAmt?contractAmt.toLocaleString("ru-RU"):'—')+'</div>'+
    (extraTotal>0?'<div style="font-size:9px;color:#9aabbf">+'+extraTotal.toLocaleString("ru-RU")+' доп. работы</div>':'')+
  '</div>';
  html+='<div style="background:'+(contractRemaining<=0?'#27ae6010':'#f39c1210')+';border:1px solid '+(contractRemaining<=0?'#27ae6033':'#f39c1233')+';border-radius:10px;padding:10px;text-align:center">'+
    '<div style="font-size:9px;color:'+(contractRemaining<=0?'#27ae60':'#f39c12')+';font-weight:700;letter-spacing:0.5px;margin-bottom:3px">ОСТАТОК ПО ДОГОВОРУ</div>'+
    '<div style="font-size:16px;font-weight:700;color:'+(contractRemaining<=0?'#27ae60':'#f39c12')+'">'+(contractAmt?(contractRemaining<=0?'✓ Оплачен':contractRemaining.toLocaleString("ru-RU")+' ₽'):'—')+'</div>'+
    (contractAmt?'<div style="font-size:9px;color:#9aabbf">из '+contractTotal.toLocaleString("ru-RU")+' ₽</div>':'')+
  '</div>';
  html+='</div>';
  // Progress bar
  if(contractAmt){
    const paidPct=Math.min(100,Math.round(income/contractTotal*100));
    html+='<div style="background:#e8eef5;border-radius:6px;height:6px;overflow:hidden">'+
      '<div style="height:100%;border-radius:6px;background:'+(paidPct>=100?'#27ae60':'#2980b9')+';width:'+paidPct+'%;transition:width 0.4s"></div>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;margin-top:3px">'+
      '<span style="font-size:10px;color:#9aabbf">Оплачено '+paidPct+'%</span>'+
      '<span style="font-size:10px;color:#9aabbf">Получено: '+income.toLocaleString("ru-RU")+' ₽</span>'+
    '</div>';
  }
  html+='</div>';

  // Extra works block
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
    '<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ДОП. РАБОТЫ</div>'+
    '<div style="display:flex;align-items:center;gap:6px">'+
      (extraTotal>0?'<span style="font-size:11px;font-weight:700;color:#8e44ad">'+extraTotal.toLocaleString("ru-RU")+' ₽</span>':'')+
      '<button data-a="fin-add-extra" data-oid="'+oid+'" style="padding:3px 10px;background:#8e44ad;border:none;border-radius:6px;cursor:pointer;font-size:11px;color:#fff;font-weight:700">+ Добавить</button>'+
    '</div>'+
  '</div>';
  if(!extraWorks.length){
    html+='<div style="text-align:center;font-size:12px;color:#aaa;padding:8px">Нет доп. работ</div>';
  }
  extraWorks.forEach(function(w){
    html+=
      '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #f4f6f9">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12px;font-weight:600;color:#1a2a3a">'+w.name+'</div>'+
          '<div style="font-size:10px;color:#9aabbf">'+w.date+(w.note?' · '+w.note:'')+'</div>'+
        '</div>'+
        '<span style="font-size:13px;font-weight:700;color:#8e44ad">+'+w.amount.toLocaleString("ru-RU")+' ₽</span>'+
        '<button data-a="fin-del-extra" data-oid="'+oid+'" data-eid="'+w.id+'" style="width:22px;height:22px;background:transparent;border:1px solid #e74c3c33;border-radius:5px;cursor:pointer;color:#e74c3c;font-size:11px">✕</button>'+
      '</div>';
  });
  html+='</div>';

  // P&L summary
  html+='<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:16px">';
  html+='<div style="background:#27ae6015;border:1px solid #27ae6044;border-radius:12px;padding:12px 10px;text-align:center">'+
    '<div style="font-size:10px;color:#27ae60;font-weight:700;letter-spacing:0.5px;margin-bottom:4px">ПРИХОДЫ</div>'+
    '<div style="font-size:18px;font-weight:700;color:#27ae60">'+income.toLocaleString("ru-RU")+'</div>'+
    '<div style="font-size:9px;color:#9aabbf;margin-top:1px">₽</div>'+
  '</div>';
  html+='<div style="background:#e74c3c15;border:1px solid #e74c3c44;border-radius:12px;padding:12px 10px;text-align:center">'+
    '<div style="font-size:10px;color:#e74c3c;font-weight:700;letter-spacing:0.5px;margin-bottom:4px">РАСХОДЫ</div>'+
    '<div style="font-size:18px;font-weight:700;color:#e74c3c">'+expense.toLocaleString("ru-RU")+'</div>'+
    '<div style="font-size:9px;color:#9aabbf;margin-top:1px">₽</div>'+
  '</div>';
  html+='<div style="background:'+(balance>=0?'#27ae6015':'#e74c3c15')+';border:1px solid '+(balance>=0?'#27ae6044':'#e74c3c44')+';border-radius:12px;padding:12px 10px;text-align:center">'+
    '<div style="font-size:10px;color:'+(balance>=0?'#27ae60':'#e74c3c')+';font-weight:700;letter-spacing:0.5px;margin-bottom:4px">БАЛАНС</div>'+
    '<div style="font-size:18px;font-weight:700;color:'+(balance>=0?'#27ae60':'#e74c3c')+'">'+(balance>=0?'+':'')+balance.toLocaleString("ru-RU")+'</div>'+
    '<div style="font-size:9px;color:#9aabbf;margin-top:1px">₽</div>'+
  '</div>';
  html+='</div>';

  // Salary section for assigned users
  const assignedU=users.filter(function(u){return u.objs.includes(oid);});
  if(assignedU.length){
    const salD=finSalaries[oid]||{};
    html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">';
    html+='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:10px">👷 ЗАРПЛАТЫ БРИГАДЫ</div>';
    assignedU.forEach(function(u){
      const ud=salD[u.id]||{plan:0,paid:0};
      const uLeft=Math.max(0,(ud.plan||0)-(ud.paid||0));
      html+=
        '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #f4f6f9">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'+
            '<div style="width:30px;height:30px;border-radius:8px;background:'+u.c+';display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">'+u.av+'</div>'+
            '<div style="flex:1">'+
              '<div style="font-size:12px;font-weight:700;color:#1a2a3a">'+u.name+'</div>'+
              '<div style="font-size:10px;color:#7a9aaa">'+u.roles.map(function(rid){const r=roles.find(function(x){return x.id===rid;});return r?r.n:'';}).filter(Boolean).join(', ')+'</div>'+
            '</div>'+
            (uLeft>0?'<span style="font-size:10px;color:#e67e22;font-weight:700;background:#e67e2212;border-radius:6px;padding:2px 7px">осталось: '+uLeft.toLocaleString("ru-RU")+' ₽</span>':
             ud.plan>0?'<span style="font-size:10px;color:#27ae60;font-weight:700;background:#27ae6012;border-radius:6px;padding:2px 7px">✓ выплачено</span>':'')+
          '</div>'+
          '<div style="display:flex;gap:6px">'+
            '<div style="flex:1">'+
              '<div style="font-size:9px;color:#7a9aaa;margin-bottom:3px">ПЛАН ₽</div>'+
              '<input id="sal-plan-'+oid+'-'+u.id+'" type="text" inputmode="numeric" data-money="1" value="'+(ud.plan?fmtMoney(ud.plan):'')+'" placeholder="0" style="width:100%;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;box-sizing:border-box;text-align:right">'+
            '</div>'+
            '<div style="flex:1">'+
              '<div style="font-size:9px;color:#7a9aaa;margin-bottom:3px">ВЫПЛАЧЕНО ₽</div>'+
              '<input id="sal-paid-'+oid+'-'+u.id+'" type="text" inputmode="numeric" data-money="1" value="'+(ud.paid?fmtMoney(ud.paid):'')+'" placeholder="0" style="width:100%;padding:6px 8px;border-radius:7px;border:1px solid #d0dae8;font-size:12px;outline:none;box-sizing:border-box;text-align:right">'+
            '</div>'+
            '<button data-a="sal-save" data-oid="'+oid+'" data-uid="'+u.id+'" style="align-self:flex-end;padding:6px 10px;background:'+u.c+';border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:11px;font-weight:700">💾</button>'+
          '</div>'+
        '</div>';
    });
    html+='</div>';
  }

  // Add form
  if(finAddForm){
    html+='<div style="background:#fff;border-radius:12px;border:2px solid #2980b9;padding:14px;margin-bottom:14px">';
    html+='<div style="font-size:13px;font-weight:700;color:#1a2a3a;margin-bottom:10px">Новая транзакция</div>';
    // Type toggle
    html+='<div style="display:flex;gap:6px;margin-bottom:10px">'+
      '<button data-a="fin-type" data-t="income" style="flex:1;padding:7px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:'+(finNewTxn.type==="income"?'#27ae60':'#f0f4f8')+';color:'+(finNewTxn.type==="income"?'#fff':'#7a9aaa')+'">↑ Приход</button>'+
      '<button data-a="fin-type" data-t="expense" style="flex:1;padding:7px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:'+(finNewTxn.type==="expense"?'#e74c3c':'#f0f4f8')+';color:'+(finNewTxn.type==="expense"?'#fff':'#7a9aaa')+'">↓ Расход</button>'+
    '</div>';
    let cats=finNewTxn.type==="income"?FIN_INCOME_CATS:FIN_EXPENSE_CATS;
    if(finNewTxn.type==="expense"&&finNewTxn.sectionGroup){
      const g=finNewTxn.sectionGroup;
      cats=cats.filter(function(c){return txnCategoryGroup(c)===g;});
      if(!cats.length)cats=FIN_EXPENSE_CATS;
    }
    html+='<select id="fin-cat" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;background:#fff">'+
      cats.map(function(c){return'<option'+(finNewTxn.category===c?' selected':'')+'>'+c+'</option>';}).join("")+
    '</select>';
    html+='<div style="display:flex;gap:8px;margin-bottom:8px">'+
      '<input id="fin-amt" type="text" inputmode="numeric" data-money="1" value="'+(finNewTxn.amount?fmtMoney(finNewTxn.amount):'')+'" placeholder="Сумма ₽" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;font-weight:600;outline:none">'+
      '<input id="fin-date" type="date" value="'+finNewTxn.date+'" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none">'+
    '</div>';
    html+='<input id="fin-note" value="'+(finNewTxn.note||'')+'" placeholder="Примечание" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;margin-bottom:10px;outline:none;box-sizing:border-box">';
    html+=payMethodSelector();
    html+='<div style="display:flex;gap:6px">'+
      '<button data-a="fin-save-txn" data-oid="'+oid+'" style="flex:1;padding:8px;background:'+(finNewTxn.type==="income"?'#27ae60':'#e74c3c')+';border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Добавить</button>'+
      '<button data-a="fin-cancel-add" style="padding:8px 14px;background:transparent;border:1px solid #d0dae8;border-radius:8px;cursor:pointer;font-size:12px;color:#7a9aaa">Отмена</button>'+
    '</div>';
    html+='</div>';
  }

  // Transaction list with running balance
  html+='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;overflow:hidden">';
  html+='<div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #eef2f7;display:flex;align-items:center;gap:8px">'+
    '<span style="font-size:11px;font-weight:700;color:#1a2a3a;flex:1">ИСТОРИЯ ТРАНЗАКЦИЙ</span>'+
    '<span style="font-size:11px;color:#7a9aaa">'+txns.length+' записей</span>'+
  '</div>';

  if(!txns.length){
    html+='<div style="text-align:center;padding:24px;color:#aaa;font-size:13px">Нет транзакций. Нажмите + Транзакция.</div>';
  }

  let runningBalance=0;
  txns.forEach(function(t){
    runningBalance+=t.type==="income"?t.amount:-t.amount;
    const isIncome=t.type==="income";
    html+=
      '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid #f4f6f9">'+
        '<div style="width:28px;height:28px;border-radius:8px;background:'+(isIncome?'#27ae6018':'#e74c3c18')+';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">'+(isIncome?'↑':'↓')+'</div>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="display:flex;align-items:center;gap:6px">'+
            '<span style="font-size:13px;font-weight:600;color:#1a2a3a">'+t.category+'</span>'+
          '</div>'+
          '<div style="display:flex;align-items:center;gap:6px;margin-top:2px">'+
            '<span style="font-size:11px;color:#9aabbf">'+t.date+'</span>'+
            (t.note?'<span style="font-size:11px;color:#9aabbf;font-style:italic">· '+t.note+'</span>':'')+
          '</div>'+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0">'+
          '<div style="font-size:13px;font-weight:700;color:'+(isIncome?'#27ae60':'#e74c3c')+'">'+(isIncome?'+':'−')+t.amount.toLocaleString("ru-RU")+' ₽</div>'+
          '<div style="font-size:10px;color:'+(runningBalance>=0?'#7a9aaa':'#e74c3c')+';margin-top:1px">баланс: '+(runningBalance>=0?'+':'')+runningBalance.toLocaleString("ru-RU")+'</div>'+
        '</div>'+
        '<button data-a="fin-del-txn" data-tid="'+t.id+'" data-oid="'+oid+'" style="width:36px;height:36px;background:#e74c3c12;border:1.5px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:14px;font-weight:700;flex-shrink:0;margin-top:3px;line-height:1">✕</button>'+
      '</div>';
  });
  html+='</div>';
  html+='</div>';
  return html;
}


function tSupply(){
  const sel=window._supplySelected||{};      // {objId: true/false}
  const viewing=window._supplyViewing||false; // showing detail
  const sortBy=window._supplySort||"stage";
  if(!viewing) return tSupplySelect(sel);
  return tSupplyDetail(sel, sortBy);
}

function tSupplySelect(sel){
  const anySelected=Object.values(sel).some(Boolean);
  let html='<div>'+
    '<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:4px">СНАБЖЕНИЕ</div>'+
    '<div style="font-size:12px;color:#5a7a9a;margin-bottom:14px">Выберите один или несколько объектов</div>';

  if(!objects.length){
    return html+'<div style="text-align:center;color:#aaa;padding:30px">Нет объектов. Создайте объект во вкладке Объекты.</div></div>';
  }

  objects.forEach(function(obj){
    const allMats=obj.stages.flatMap(function(s){return s.works.flatMap(function(w){return(w.mats||[]).map(function(m){return Object.assign({},m,{wn:w.n});});});});
    const totalCost=allMats.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
    const assigned=users.filter(function(u){return u.objs.includes(obj.id);});
    const isOn=!!sel[obj.id];
    html+=
      '<div data-a="supply-toggle" data-oid="'+obj.id+'" style="background:#fff;border-radius:14px;border:2px solid '+(isOn?'#2980b9':'#dde6f0')+';padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:border-color 0.15s,background 0.15s;background:'+(isOn?'#f0f6ff':'#fff')+'">'+
        '<div style="display:flex;align-items:center;gap:12px">'+
          '<div style="width:26px;height:26px;border-radius:8px;border:2px solid '+(isOn?'#2980b9':'#c8d8e8')+';background:'+(isOn?'#2980b9':'transparent')+';display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s">'+
            (isOn?'<span style="color:#fff;font-size:14px;font-weight:700">✓</span>':'')+
          '</div>'+
          '<span style="font-size:28px;flex-shrink:0">'+obj.icon+'</span>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:15px;font-weight:700;color:#0d1b2e">'+obj.name+'</div>'+
            '<div style="font-size:11px;color:#7a9aaa;margin-top:2px">'+allMats.length+' матер. · '+totalCost.toLocaleString("ru-RU")+' ₽</div>'+
            (assigned.length?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">'+assigned.map(function(u){return'<span style="font-size:10px;background:'+u.c+'18;color:'+u.c+';border-radius:8px;padding:1px 7px;border:1px solid '+u.c+'33">'+u.av+' '+u.name+'</span>';}).join("")+'</div>':'')+
          '</div>'+
        '</div>'+
      '</div>';
  });

  // Bottom CTA
  const selectedObjs=objects.filter(function(o){return!!sel[o.id];});
  const selectedMats=selectedObjs.flatMap(function(o){return o.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});});});
  const selectedCost=selectedMats.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);

  html+='<div style="position:sticky;bottom:0;background:rgba(246,248,250,0.97);padding:12px 0 4px;margin-top:4px">';
  if(anySelected){
    html+=
      '<div style="background:#2980b9;border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:12px">'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:700;color:#fff">'+selectedObjs.length+' объект'+( selectedObjs.length===1?'':'а/ов')+' выбрано</div>'+
          '<div style="font-size:11px;color:rgba(255,255,255,0.75);margin-top:1px">'+selectedMats.length+' материалов · '+selectedCost.toLocaleString("ru-RU")+' ₽</div>'+
        '</div>'+
        '<button data-a="supply-view" style="padding:9px 18px;background:#fff;border:none;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;color:#2980b9;white-space:nowrap">Смотреть →</button>'+
      '</div>';
  } else {
    html+=
      '<div style="background:#f0f4f8;border-radius:12px;padding:12px 16px;text-align:center">'+
        '<div style="font-size:12px;color:#a0b4c8">Выберите объекты выше чтобы посмотреть материалы</div>'+
      '</div>';
  }
  html+='</div>';

  return html+'</div>';
}

let supplyEditMid=null;   // id материала, открытого на редактирование в снабжении
let supplyAddOpen=false;  // открыта ли форма добавления материала в снабжении
function tSupplyDetail(sel, sortBy){
  const STORECOL={"Озон":"#005bff","Белка":"#d68910","pechki.su":"#c0392b","Егорьевск":"#8e44ad","Лемана":"#e30613","Авито":"#00aaff","Нижний Новгород":"#27ae60"};
  const sortBy2=sortBy||"stage";
  const multiMode=Object.values(sel).filter(Boolean).length>1;
  const targetObjs=objects.filter(function(o){return!!sel[o.id];});

  let allMats=[];
  targetObjs.forEach(function(obj){
    obj.stages.forEach(function(s){
      s.works.forEach(function(w){
        (w.mats||[]).forEach(function(m){
          allMats.push(Object.assign({},m,{wn:w.n,sn:s.n,sc:s.c,objName:obj.name,objIcon:obj.icon,objId:obj.id}));
        });
      });
    });
  });

  const totalCost=allMats.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);

  // Header
  let title=targetObjs.length===1?(targetObjs[0].icon+' '+targetObjs[0].name):('🗂️ '+targetObjs.length+' объектa/ов');
  let html='<div>'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'+
      '<button data-a="supply-back" style="padding:6px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Назад</button>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:15px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+title+'</div>'+
        '<div style="font-size:12px;color:#7a9aaa">'+allMats.length+' материалов · '+totalCost.toLocaleString("ru-RU")+' ₽</div>'+
      '</div>'+
      '<button data-a="supply-add-open" style="padding:6px 12px;background:#27ae60;border:none;border-radius:20px;cursor:pointer;font-size:12px;color:#fff;font-weight:700;white-space:nowrap;flex-shrink:0">+ Материал</button>'+
    '</div>';

  // Search
  html+=
    '<div style="position:relative;margin-bottom:12px">'+
      '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none">🔍</span>'+
      '<input id="supply-search-input" value="'+supplySearch.replace(/"/g,"&quot;")+
        '" placeholder="Поиск по материалам..." style="width:100%;padding:10px 12px 10px 38px;border-radius:10px;border:1.5px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box;background:#fff">'+
    '</div>';

  const q=supplySearch.trim().toLowerCase();
  if(q) allMats=allMats.filter(function(m){return m.n.toLowerCase().includes(q)||(m.store||'').toLowerCase().includes(q)||(m.note||'').toLowerCase().includes(q)||(m.wn||'').toLowerCase().includes(q);});
  if(supplyStoreFilter) allMats=allMats.filter(function(m){return(m.store||'Без магазина')===supplyStoreFilter;});

  // Sort tabs
  html+=
    '<div style="display:flex;gap:8px;margin-bottom:16px">'+
      '<button data-a="supply-sort" data-s="stage" style="flex:1;padding:11px 8px;border-radius:12px;cursor:pointer;font-size:13px;font-weight:700;border:2px solid '+(sortBy2==="stage"?"#2980b9":"#dde6f0")+';background:'+(sortBy2==="stage"?"#2980b9":"#fff")+';color:'+(sortBy2==="stage"?"#fff":"#7a9aaa")+';box-shadow:'+(sortBy2==="stage"?"0 3px 10px rgba(41,128,185,0.3)":"none")+';transition:all 0.15s">📋 По этапам</button>'+
      '<button data-a="supply-sort" data-s="store" style="flex:1;padding:11px 8px;border-radius:12px;cursor:pointer;font-size:13px;font-weight:700;border:2px solid '+(sortBy2==="store"?"#27ae60":"#dde6f0")+';background:'+(sortBy2==="store"?"#27ae60":"#fff")+';color:'+(sortBy2==="store"?"#fff":"#7a9aaa")+';box-shadow:'+(sortBy2==="store"?"0 3px 10px rgba(39,174,96,0.3)":"none")+';transition:all 0.15s">🏪 По магазинам</button>'+
    '</div>';

  // Store summary — use full unfiltered mats for pills
  const storesAll=[...new Set(allMats.map(function(m){return m.store||"Без магазина";}))];
  html+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">';
  storesAll.forEach(function(store){
    const sm=allMats.filter(function(m){return(m.store||"Без магазина")===store;});
    const sc=STORECOL[store]||"#555";
    const isActive=supplyStoreFilter===store;
    const safeStore=store.replace(/"/g,'&quot;');
    html+='<div data-a="supply-store-filter" data-store="'+safeStore+'" style="display:flex;align-items:center;gap:6px;border-radius:10px;padding:7px 12px;cursor:pointer;border:2px solid '+(isActive?sc:sc+'55')+';background:'+(isActive?sc:'#fff')+';transition:all 0.15s">'+
      '<span style="font-size:11px;font-weight:700;color:'+(isActive?'#fff':sc)+'">'+store+'</span>'+
      '<span style="font-size:11px;color:'+(isActive?'rgba(255,255,255,0.85)':sc)+';background:'+(isActive?'rgba(255,255,255,0.2)':sc+'18')+';border-radius:6px;padding:0 6px">'+sm.length+'</span>'+
      (isActive?'<span style="font-size:10px;color:rgba(255,255,255,0.8)">✕</span>':'')+
    '</div>';
  });
  html+='</div>';

  // Progress bar — in money
  const costTotal=allMats.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
  const costDone=allMats.filter(function(m){return!!purchased[m.id];}).reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
  const costLeft=costTotal-costDone;
  const pct=costTotal>0?Math.round(costDone/costTotal*100):0;
  const allDone=costTotal>0&&costLeft===0;
  html+=
    '<div style="background:#fff;border-radius:12px;border:1px solid '+(allDone?'#27ae6044':'#dde6f0')+';padding:12px 14px;margin-bottom:14px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'+
        '<span style="font-size:12px;font-weight:700;color:#1a2a3a">Прогресс закупки</span>'+
        '<span style="font-size:12px;font-weight:700;color:'+(allDone?'#27ae60':'#2980b9')+'">'+pct+'%</span>'+
      '</div>'+
      '<div style="background:#e8eef5;border-radius:8px;height:10px;overflow:hidden;margin-bottom:10px">'+
        '<div style="height:100%;border-radius:8px;background:'+(allDone?'#27ae60':'#2980b9')+';width:'+pct+'%;transition:width 0.4s"></div>'+
      '</div>'+
      '<div style="display:flex;gap:6px">'+
        '<div style="flex:1;background:#27ae6010;border:1px solid #27ae6033;border-radius:9px;padding:8px 10px;text-align:center">'+
          '<div style="font-size:10px;color:#27ae60;font-weight:700;letter-spacing:0.3px;margin-bottom:2px">КУПЛЕНО</div>'+
          '<div style="font-size:14px;font-weight:700;color:#27ae60">'+costDone.toLocaleString("ru-RU")+' ₽</div>'+
        '</div>'+
        '<div style="flex:1;background:'+(allDone?'#27ae6010':'#e74c3c10')+';border:1px solid '+(allDone?'#27ae6033':'#e74c3c33')+';border-radius:9px;padding:8px 10px;text-align:center">'+
          '<div style="font-size:10px;color:'+(allDone?'#27ae60':'#e74c3c')+';font-weight:700;letter-spacing:0.3px;margin-bottom:2px">'+(allDone?'ГОТОВО':'ОСТАЛОСЬ')+'</div>'+
          '<div style="font-size:14px;font-weight:700;color:'+(allDone?'#27ae60':'#e74c3c')+'">'+(allDone?'✓ Всё куплено':costLeft.toLocaleString("ru-RU")+' ₽')+'</div>'+
          (allDone?'':'<div style="font-size:10px;color:#aaa;margin-top:2px">из '+costTotal.toLocaleString("ru-RU")+' ₽</div>')+
        '</div>'+
      '</div>'+
    '</div>';

  function matRow(m){
    const sc=STORECOL[m.store||""]||"#555";
    const done=!!purchased[m.id];
    const mode=EXP_MODES.find(function(x){return x.k===(m.mode||"piece");})||EXP_MODES[0];
    const conv=matConv(m);
    const idx=conv?(expView[m.id]==="1"?1:(expView[m.id]==="0"?0:conv.def)):0;
    const price=conv?conv.views[idx].price:(Number(m.cost)||0);
    const unit=conv?conv.views[idx].unit:mode.unit;
    const qty=m.qty||1;
    const on="background:#2a3142;color:#fff",off="background:transparent;color:#7a9aaa";
    const lineTotal=((Number(m.cost)||0)*qty).toLocaleString("ru-RU");
    return '<div data-a="supply-check" data-mid="'+m.id+'" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;margin-bottom:6px;background:'+(done?'#f0fdf4':'#f8fafc')+';border:1.5px solid '+(done?'#27ae60':'#dde6f0')+';cursor:pointer;transition:all 0.15s">'+
      '<div style="flex-shrink:0;margin-top:1px">'+
        '<div style="width:22px;height:22px;border-radius:6px;border:2px solid '+(done?'#27ae60':'#c8d8e8')+';background:'+(done?'#27ae60':'#fff')+';display:flex;align-items:center;justify-content:center;transition:all 0.15s">'+
          (done?'<span style="color:#fff;font-size:13px;font-weight:700;line-height:1">✓</span>':'')+
        '</div>'+
      '</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:600;color:'+(done?'#7a9aaa':'#1a2a3a')+';text-decoration:'+(done?'line-through':'none')+'">'+m.n+'</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;align-items:center">'+
          (multiMode?'<span style="font-size:10px;background:#e8f0fa;color:#2a5298;border-radius:4px;padding:1px 6px">'+m.objIcon+' '+m.objName+'</span>':'')+
          '<span style="font-size:10px;color:#9aabbf">↳ '+m.wn+'</span>'+
          (m.store?'<span style="font-size:10px;font-weight:700;background:'+sc+';color:#fff;border-radius:4px;padding:1px 6px;opacity:'+(done?'0.5':'1')+'">'+m.store+'</span>':'')+
          '<span style="font-size:10px;font-weight:700;color:#5a7a9a;background:#eef2f7;border-radius:4px;padding:1px 6px">'+mode.icon+' '+mode.unit+'</span>'+
          (m.cost>0?'<span style="font-size:11px;color:'+(done?'#b0c8b0':'#7a9aaa')+'">'+price.toLocaleString("ru-RU")+' ₽/'+unit+' × '+numRu(qty)+' = <b style="color:'+(done?'#b0c8b0':'#0d1b2e')+'">'+lineTotal+' ₽</b></span>':'')+
          (m.note?'<span style="font-size:10px;color:#9aabbf;font-style:italic">'+m.note+'</span>':'')+
          (!done&&m.url?'<a href="'+m.url+'" target="_blank" style="font-size:10px;color:#fff;background:#2980b9;border-radius:4px;padding:1px 7px;text-decoration:none;font-weight:600" onclick="event.stopPropagation()">🔗 купить</a>':'')+
          (done?'<span style="font-size:10px;font-weight:700;color:#27ae60;background:#d4edda;border-radius:6px;padding:1px 8px">✓ Куплено</span>':'')+
          '<button data-a="supply-edit-mat" data-mid="'+m.id+'" style="font-size:10px;color:#7a9aaa;background:#fff;border:1px solid #d0dae8;border-radius:5px;padding:1px 7px;cursor:pointer" onclick="event.stopPropagation()">✏️ изм.</button>'+
        '</div>'+
        (conv?'<div style="display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap">'+
          '<span style="font-size:10px;font-weight:700;color:#e67e22;background:#fff3e0;border-radius:6px;padding:2px 8px">🛒 Купить: '+conv.altTotal(qty)+'</span>'+
          '<div style="display:inline-flex;background:#e9eef4;border-radius:20px;padding:2px" onclick="event.stopPropagation()">'+
            '<button data-a="objmat-view" data-mid="'+m.id+'" data-v="0" style="border:none;cursor:pointer;font-size:10px;font-weight:700;padding:3px 9px;border-radius:18px;'+(idx===0?on:off)+'">'+conv.views[0].unit+'</button>'+
            '<button data-a="objmat-view" data-mid="'+m.id+'" data-v="1" style="border:none;cursor:pointer;font-size:10px;font-weight:700;padding:3px 9px;border-radius:18px;'+(idx===1?on:off)+'">'+conv.views[1].unit+'</button>'+
          '</div>'+
        '</div>':'')+
      '</div>'+
    '</div>';
  }

  if(sortBy2==="stage"){
    const stageNames=[...new Set(allMats.map(function(m){return m.sn;}))];
    stageNames.forEach(function(sn){
      const sm=allMats.filter(function(m){return m.sn===sn;});
      const sc=sm[0]?sm[0].sc:"#7f8c8d";
      const stageCost=sm.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
      const stageAllDone=sm.length>0&&sm.every(function(m){return!!purchased[m.id];});
      const stageDoneCount=sm.filter(function(m){return!!purchased[m.id];}).length;
      const safeIds=sm.map(function(m){return m.id;}).join(',');
      html+='<div style="background:#fff;border-radius:14px;border:1px solid '+(stageAllDone?'#27ae60':sc+'44')+';margin-bottom:12px;overflow:hidden;transition:border-color 0.2s">'+
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:'+(stageAllDone?'linear-gradient(135deg,#27ae6018,transparent)':'linear-gradient(135deg,'+sc+'15,transparent)')+';border-bottom:1px solid '+(stageAllDone?'#27ae6022':sc+'22')+'">'+
          '<div style="width:8px;height:8px;border-radius:50%;background:'+(stageAllDone?'#27ae60':sc)+'"></div>'+
          '<span style="font-size:13px;font-weight:700;color:#1a2a3a;flex:1">'+sn+'</span>'+
          '<span style="font-size:11px;color:'+(stageAllDone?'#27ae60':sc)+';font-weight:600;margin-right:6px">'+stageDoneCount+'/'+sm.length+' · '+stageCost.toLocaleString("ru-RU")+' ₽</span>'+
          '<button data-a="supply-stage-check" data-ids="'+safeIds+'" data-done="'+(stageAllDone?'1':'0')+'" style="padding:4px 10px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700;border:1.5px solid '+(stageAllDone?'#27ae60':'#c8d8e8')+';background:'+(stageAllDone?'#27ae60':'#fff')+';color:'+(stageAllDone?'#fff':'#7a9aaa')+';transition:all 0.15s;white-space:nowrap">'+
            (stageAllDone?'✓ Всё куплено':'☐ Отметить всё')+
          '</button>'+
        '</div>'+
        '<div style="padding:8px 12px">'+sm.map(matRow).join("")+'</div>'+
      '</div>';
    });
  } else {
    const storesForGroup=[...new Set(allMats.map(function(m){return m.store||"Без магазина";}))]; 
    storesForGroup.forEach(function(store){
      const sm=allMats.filter(function(m){return(m.store||"Без магазина")===store;});
      const sc=STORECOL[store]||"#555";
      const storeCost=sm.reduce(function(a,m){return a+m.cost*(m.qty||1);},0);
      const storeUrl=sm.find(function(m){return m.url&&m.url.startsWith("http");});
      const baseUrl=storeUrl?(storeUrl.url.match(/https?:\/\/[^/]+/)||[""])[0]:"";
      html+='<div style="background:#fff;border-radius:14px;border:1px solid '+sc+'44;margin-bottom:12px;overflow:hidden">'+
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:'+sc+'10;border-bottom:1px solid '+sc+'22">'+
          '<span style="font-size:12px;font-weight:700;background:'+sc+';color:#fff;border-radius:6px;padding:2px 10px">'+store+'</span>'+
          '<span style="flex:1"></span>'+
          '<span style="font-size:11px;color:'+sc+';font-weight:600">'+sm.length+' поз. · '+storeCost.toLocaleString("ru-RU")+' ₽</span>'+
          (baseUrl?'<a href="'+baseUrl+'" target="_blank" style="font-size:11px;color:#fff;background:'+sc+';border-radius:6px;padding:4px 10px;text-decoration:none;font-weight:600;flex-shrink:0">🛒 Открыть</a>':'')+
        '</div>'+
        '<div style="padding:8px 12px">'+sm.map(matRow).join("")+'</div>'+
      '</div>';
    });
  }

  // Модалка редактирования материала (запись обратно в исходную работу объекта)
  if(supplyEditMid){
    let em=null; objects.forEach(function(o){(o.stages||[]).forEach(function(s){(s.works||[]).forEach(function(w){(w.mats||[]).forEach(function(m){if(m.id===supplyEditMid)em=m;});});});});
    if(em){
      const opts=EXP_MODES.map(function(o){return '<option value="'+o.k+'"'+(o.k===(em.mode||"piece")?' selected':'')+'>'+o.icon+' '+o.label+'</option>';}).join("");
      const inp="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box";
      html+='<div style="position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;justify-content:center;padding:50px 16px;z-index:300">'+
        '<div style="background:#fff;border-radius:16px;width:100%;max-width:420px;padding:20px">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
            '<div style="font-size:15px;font-weight:700;color:#0d1b2e">✏️ Материал</div>'+
            '<button data-a="supply-mat-close" style="width:30px;height:30px;border-radius:50%;background:#f0f4f8;border:none;cursor:pointer;font-size:16px">✕</button>'+
          '</div>'+
          '<input id="sem-n" value="'+(em.n||"").replace(/"/g,"&quot;")+'" placeholder="Название" style="'+inp+';margin-bottom:8px">'+
          '<div style="display:flex;gap:8px;margin-bottom:8px">'+
            '<select id="sem-mode" style="'+inp+';flex:1">'+opts+'</select>'+
            '<input id="sem-qty" type="number" step="any" value="'+(em.qty||1)+'" placeholder="Кол-во" style="'+inp+';flex:1">'+
          '</div>'+
          '<div style="display:flex;gap:8px;margin-bottom:8px">'+
            '<input id="sem-cost" type="number" value="'+(Number(em.cost)||0)+'" placeholder="Цена ₽/ед" style="'+inp+';flex:1">'+
            '<input id="sem-store" value="'+(em.store||"").replace(/"/g,"&quot;")+'" placeholder="Магазин" style="'+inp+';flex:1">'+
          '</div>'+
          '<input id="sem-note" value="'+(em.note||"").replace(/"/g,"&quot;")+'" placeholder="Заметка" style="'+inp+';margin-bottom:12px">'+
          '<button data-a="supply-mat-save" style="width:100%;padding:10px;background:#2980b9;border:none;border-radius:9px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">Сохранить</button>'+
        '</div>'+
      '</div>';
    }
  }

  // Модалка добавления материала: один список «Объект — Работа» → пишем в выбранную работу
  if(supplyAddOpen){
    const inp="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box";
    let tgtOpts="";
    (targetObjs.length?targetObjs:objects).forEach(function(o){
      (o.stages||[]).forEach(function(s){
        (s.works||[]).forEach(function(w){
          tgtOpts+='<option value="'+o.id+'|'+w.id+'">'+(o.icon||"")+' '+o.name+' — '+w.n+'</option>';
        });
      });
    });
    const opts=EXP_MODES.map(function(o){return '<option value="'+o.k+'">'+o.icon+' '+o.label+'</option>';}).join("");
    html+='<div style="position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;justify-content:center;padding:50px 16px;z-index:300">'+
      '<div style="background:#fff;border-radius:16px;width:100%;max-width:420px;padding:20px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
          '<div style="font-size:15px;font-weight:700;color:#0d1b2e">➕ Новый материал</div>'+
          '<button data-a="supply-add-close" style="width:30px;height:30px;border-radius:50%;background:#f0f4f8;border:none;cursor:pointer;font-size:16px">✕</button>'+
        '</div>'+
        '<div style="font-size:11px;color:#7a9aaa;font-weight:700;margin-bottom:4px">КУДА (объект · работа)</div>'+
        '<select id="sao-target" style="'+inp+';margin-bottom:10px">'+tgtOpts+'</select>'+
        '<input id="sao-n" placeholder="Название материала" style="'+inp+';margin-bottom:8px">'+
        '<div style="display:flex;gap:8px;margin-bottom:8px">'+
          '<select id="sao-mode" style="'+inp+';flex:1">'+opts+'</select>'+
          '<input id="sao-qty" type="number" step="any" value="1" placeholder="Кол-во" style="'+inp+';flex:1">'+
        '</div>'+
        '<div style="display:flex;gap:8px;margin-bottom:8px">'+
          '<input id="sao-cost" type="number" placeholder="Цена ₽/ед" style="'+inp+';flex:1">'+
          '<input id="sao-store" placeholder="Магазин" style="'+inp+';flex:1">'+
        '</div>'+
        '<input id="sao-note" placeholder="Заметка" style="'+inp+';margin-bottom:12px">'+
        '<button data-a="supply-add-save" style="width:100%;padding:10px;background:#27ae60;border:none;border-radius:9px;cursor:pointer;color:#fff;font-size:14px;font-weight:700">Добавить в объект</button>'+
      '</div>'+
    '</div>';
  }

  return html+'</div>';
}


function tTeam(){
  return`<div style="display:flex;flex-direction:column;gap:0">
<div style="margin-bottom:16px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">СОТРУДНИКИ</div>
    <button data-a="show-nu" style="padding:5px 10px;background:#2980b9;border:none;border-radius:7px;cursor:pointer;font-size:11px;color:#fff;font-weight:700">+ Добавить</button>
  </div>
  ${showNU?`<div style="background:#fff;border-radius:12px;border:2px solid #4a7ac8;padding:14px;margin-bottom:10px">
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <select id="nu-av" style="padding:6px;border-radius:7px;border:1px solid #d0dae8;font-size:16px;outline:none">${AVS.map(a=>`<option>${a}</option>`).join("")}</select>
      <input id="nu-name" placeholder="Имя" style="flex:1;padding:7px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;outline:none">
    </div>
    <input id="nu-phone" data-phone-mask="1" type="tel" inputmode="tel" placeholder="+7 (___) ___-__-__" style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:8px">
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">${COLS.map(c=>`<div data-a="nu-c" data-c="${c}" style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:${nu.c===c?"3px solid #0d1b2e":"2px solid transparent"}"></div>`).join("")}</div>
    <div style="font-size:10px;color:#7a9aaa;font-weight:600;margin-bottom:5px">РОЛИ</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${roles.map(r=>{const on=nu.roles.includes(r.id);return`<div data-a="nu-role" data-rid="${r.id}" style="padding:4px 10px;border-radius:16px;cursor:pointer;font-size:11px;font-weight:600;background:${on?r.c:"transparent"};color:${on?"#fff":r.c};border:1.5px solid ${r.c}">${r.n}</div>`;}).join("")}</div>
    <div style="display:flex;gap:6px">
      <button data-a="add-u" style="flex:1;padding:7px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Добавить</button>
      <button data-a="cancel-nu" style="padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
    </div>
  </div>`:""}
  ${users.map(u=>{const isE=editU===u.id;return`<div style="background:#fff;border-radius:12px;border:${isE?"2px solid #4a7ac8":"1px solid #dde6f0"};padding:12px;margin-bottom:8px">
    ${isE?`<div style="display:flex;gap:6px;margin-bottom:8px">
      <select id="eu-av-${u.id}" style="padding:5px;border-radius:7px;border:1px solid #d0dae8;font-size:15px;outline:none">${AVS.map(a=>`<option ${u.av===a?"selected":""}>${a}</option>`).join("")}</select>
      <input id="eu-n-${u.id}" value="${u.name}" style="flex:1;padding:6px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;font-weight:600;outline:none">
    </div>
    <input id="eu-phone-${u.id}" value="${u.phone||''}" data-phone-mask="1" type="tel" inputmode="tel" placeholder="+7 (___) ___-__-__" style="width:100%;padding:6px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:8px">
    <div style="font-size:10px;color:#9aabbf;margin-bottom:8px">PIN для входа = последние 4 цифры телефона</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">${COLS.map(c=>`<div data-a="eu-c" data-uid="${u.id}" data-c="${c}" style="width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;border:${u.c===c?"3px solid #0d1b2e":"2px solid transparent"}"></div>`).join("")}</div>
    <div style="font-size:10px;color:#7a9aaa;font-weight:600;margin-bottom:5px">РОЛИ</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${roles.map(r=>{const on=u.roles.includes(r.id);return`<div data-a="eu-role" data-uid="${u.id}" data-rid="${r.id}" style="padding:4px 10px;border-radius:16px;cursor:pointer;font-size:11px;font-weight:600;background:${on?r.c:"transparent"};color:${on?"#fff":r.c};border:1.5px solid ${r.c}">${r.n}</div>`;}).join("")}</div>
    <div style="display:flex;gap:6px">
      <button data-a="save-u" data-uid="${u.id}" style="flex:1;padding:7px;background:#27ae60;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Сохранить</button>
      <button data-a="cancel-eu" style="padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
    </div>`:`<div style="display:flex;align-items:center;gap:8px">
      <div style="width:38px;height:38px;border-radius:50%;background:${u.c};display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;flex-shrink:0">${u.av}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#1a2a3a">${u.name}${u.phone?` <span style="font-weight:600;color:#7a9aaa;font-size:11px">· ${esc(u.phone)}</span>`:''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">
          ${u.roles.map(rid=>{const r=roles.find(x=>x.id===rid);return r?`<span style="font-size:10px;background:${r.c}18;color:${r.c};border-radius:10px;padding:1px 6px;border:1px solid ${r.c}33">${r.n}</span>`:""}).join("")}
          ${u.objs.length>0?`<span style="font-size:10px;color:#5a7a9a;background:#e8f0fa;border-radius:10px;padding:1px 6px">${u.objs.map(id=>objects.find(o=>o.id===id)?.icon||"").join("")}</span>`:""}
        </div>
      </div>
      <button data-a="edit-u" data-uid="${u.id}" style="padding:4px 9px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:11px;color:#5a7a9a">✏️</button>
      <button data-a="del-u" data-uid="${u.id}" style="width:26px;height:26px;background:transparent;border:1px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:12px">✕</button>
    </div>`}
  </div>`;}).join("")}
</div>
<div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">РОЛИ</div>
    <button data-a="show-nr" style="padding:5px 10px;background:#9b59b6;border:none;border-radius:7px;cursor:pointer;font-size:11px;color:#fff;font-weight:700">+ Роль</button>
  </div>
  ${showNR?`<div style="background:#fff;border-radius:12px;border:2px solid #9b59b6;padding:14px;margin-bottom:10px">
    <input id="nr-n" placeholder="Название роли" style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;box-sizing:border-box">
    <div style="font-size:10px;color:#7a9aaa;font-weight:600;margin-bottom:5px">ЦВЕТ</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${COLS.map(c=>`<div data-a="nr-c" data-c="${c}" style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:${nr.c===c?"3px solid #0d1b2e":"2px solid transparent"}"></div>`).join("")}</div>
    <div style="font-size:10px;color:#7a9aaa;font-weight:600;margin-bottom:5px">БЛОК</div>
    <div style="display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap">
      ${[{k:"prod",n:"🔨 Производство",c:"#e67e22"},{k:"fin",n:"💼 Финансы",c:"#16a085"},{k:"sales",n:"🎯 Отдел продаж",c:"#2980b9"},{k:"client",n:"🤝 Сопровождение",c:"#d68910"},{k:"other",n:"Другое",c:"#7a9aaa"}].map(g=>{const on=nr.group===g.k;return `<div data-a="nr-group" data-g="${g.k}" style="padding:6px 12px;border-radius:18px;cursor:pointer;font-size:11px;font-weight:700;background:${on?g.c:"#f8fafc"};color:${on?"#fff":g.c};border:1.5px solid ${on?g.c:g.c+"55"};transition:all 0.15s">${g.n}</div>`;}).join("")}
    </div>
    <div style="display:flex;gap:6px">
      <button data-a="add-r" style="flex:1;padding:7px;background:#9b59b6;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Создать</button>
      <button data-a="cancel-nr" style="padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
    </div>
  </div>`:""}
  ${(()=>{
    // Helper to render one role card
    const renderRole=(r)=>{
      const isE=editR===r.id;
      const wr=users.filter(u=>u.roles.includes(r.id));
      return `<div style="background:#fff;border-radius:12px;border:${isE?"2px solid #9b59b6":"1px solid #dde6f0"};padding:12px;margin-bottom:8px">
    ${isE?`<input id="er-n-${r.id}" value="${r.n}" style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid #d0dae8;font-size:13px;font-weight:600;margin-bottom:8px;outline:none;box-sizing:border-box">
    <div style="font-size:10px;color:#7a9aaa;font-weight:600;margin-bottom:5px">ЦВЕТ</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${COLS.map(c=>`<div data-a="er-c" data-rid="${r.id}" data-c="${c}" style="width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;border:${r.c===c?"3px solid #0d1b2e":"2px solid transparent"}"></div>`).join("")}</div>
    <div style="font-size:10px;color:#7a9aaa;font-weight:600;margin-bottom:5px">БЛОК</div>
    <div style="display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap">
      ${[{k:"prod",n:"🔨 Производство",c:"#e67e22"},{k:"fin",n:"💼 Финансы",c:"#16a085"},{k:"sales",n:"🎯 Отдел продаж",c:"#2980b9"},{k:"client",n:"🤝 Сопровождение",c:"#d68910"},{k:"other",n:"Другое",c:"#7a9aaa"}].map(g=>{const on=(r.group||"other")===g.k;return `<div data-a="er-group" data-rid="${r.id}" data-g="${g.k}" style="padding:6px 12px;border-radius:18px;cursor:pointer;font-size:11px;font-weight:700;background:${on?g.c:"#f8fafc"};color:${on?"#fff":g.c};border:1.5px solid ${on?g.c:g.c+"55"}">${g.n}</div>`;}).join("")}
    </div>
    <div style="font-size:10px;color:#7a9aaa;font-weight:600;margin-bottom:5px">🔐 РАЗРЕШЕНИЯ · какие вкладки видит роль</div>
    ${r.id==="admin"
      ?`<div style="background:#c0392b10;border:1px solid #c0392b33;border-radius:8px;padding:9px 11px;margin-bottom:10px;font-size:11px;color:#c0392b;font-weight:600">👑 Администратор всегда видит все вкладки — настройка зафиксирована</div>`
      :`<div style="display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap">${TAB_DEFS.map(t=>{const on=(rolePermissions[r.id]||[]).includes(t.k);return `<div data-a="er-perm" data-rid="${r.id}" data-k="${t.k}" style="padding:6px 11px;border-radius:16px;cursor:pointer;font-size:11px;font-weight:700;background:${on?"#2980b9":"#f8fafc"};color:${on?"#fff":"#5a7080"};border:1.5px solid ${on?"#2980b9":"#dde6f0"};transition:all 0.15s">${on?"✓ ":""}${t.n}</div>`;}).join("")}</div>`}
    <div style="display:flex;gap:6px">
      <button data-a="save-r" data-rid="${r.id}" style="flex:1;padding:7px;background:#9b59b6;border:none;border-radius:7px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">Сохранить</button>
      <button data-a="cancel-er" style="padding:7px 12px;background:transparent;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:12px;color:#7a9aaa">✕</button>
    </div>`:`<div style="display:flex;align-items:center;gap:8px">
      <div style="width:38px;height:38px;border-radius:50%;background:${r.c};display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;font-weight:700;flex-shrink:0">${r.n.charAt(0)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:#1a2a3a">${r.n}</div>
        <div style="font-size:11px;color:#7a9aaa;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${wr.length>0?wr.map(u=>`${u.av} ${u.name}`).join(", "):"Никому не назначена"}</div>
      </div>
      <span style="font-size:11px;background:${r.c}18;color:${r.c};border-radius:6px;padding:2px 7px;font-weight:700;flex-shrink:0">${wr.length} чел.</span>
      <button data-a="edit-r" data-rid="${r.id}" style="padding:4px 9px;background:#f0f4f8;border:1px solid #d0dae8;border-radius:7px;cursor:pointer;font-size:11px;color:#5a7a9a">✏️</button>
      <button data-a="del-r" data-rid="${r.id}" style="width:26px;height:26px;background:transparent;border:1px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:12px">✕</button>
    </div>`}
  </div>`;
    };

    // Group by role.group property (prod, fin, other)
    const groupHeader=(icon,title,color)=>`<div style="display:flex;align-items:center;gap:8px;margin:18px 0 10px;padding:6px 12px;background:linear-gradient(90deg,${color}15,transparent);border-left:3px solid ${color};border-radius:0 8px 8px 0">
      <span style="font-size:16px">${icon}</span>
      <div style="font-size:11px;font-weight:700;color:${color};letter-spacing:1px;text-transform:uppercase">${title}</div>
    </div>`;

    let out="";

    const prodRoles=roles.filter(r=>r.group==="prod");
    if(prodRoles.length){
      out+=groupHeader("🔨","Производство","#e67e22");
      out+=prodRoles.map(renderRole).join("");
    }

    const finRoles=roles.filter(r=>r.group==="fin");
    if(finRoles.length){
      out+=groupHeader("💼","Финансы","#16a085");
      out+=finRoles.map(renderRole).join("");
    }

    const salesRoles=roles.filter(r=>r.group==="sales");
    if(salesRoles.length){
      out+=groupHeader("🎯","Отдел продаж","#2980b9");
      out+=salesRoles.map(renderRole).join("");
    }

    const clientRoles=roles.filter(r=>r.group==="client");
    if(clientRoles.length){
      out+=groupHeader("🤝","Сопровождение клиентов","#d68910");
      out+=clientRoles.map(renderRole).join("");
    }

    const otherRoles=roles.filter(r=>!r.group||r.group==="other");
    if(otherRoles.length){
      out+='<div style="height:18px"></div>';
      out+=otherRoles.map(renderRole).join("");
    }

    return out;
  })()}
</div>
</div>`;
}


function tMarketing(){
  const instView=window._mktInstView||false;
  if(instView) return tMarketingInstruction();
  return tMarketingMain();
}

function tMarketingMain(){
  let html='<div>';
  html+='<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:14px">МАРКЕТИНГ</div>';

  // Avito → Telegram → AI block
  html+='<div style="background:linear-gradient(135deg,#005bff15,#00aaff08);border:1.5px solid #005bff33;border-radius:14px;padding:16px;margin-bottom:14px">'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'+
      '<span style="font-size:28px">🤖</span>'+
      '<div style="flex:1">'+
        '<div style="font-size:14px;font-weight:700;color:#1a2a3a">Авито → Telegram → Нейропродавец</div>'+
        '<div style="font-size:11px;color:#5a7a9a;margin-top:2px">Автоматизированная обработка входящих лидов</div>'+
      '</div>'+
      '<span style="font-size:10px;font-weight:700;color:#f39c12;background:#fff9e6;border-radius:6px;padding:2px 8px;border:1px solid #f39c1244">В разработке</span>'+
    '</div>'+
    // Flow
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap">'+
      '<div style="background:#005bff;border-radius:10px;padding:8px 12px;text-align:center;min-width:70px">'+
        '<div style="font-size:18px">🅰️</div>'+
        '<div style="font-size:10px;color:#fff;font-weight:700;margin-top:2px">Авито</div>'+
        '<div style="font-size:9px;color:rgba(255,255,255,0.7)">Клиент пишет</div>'+
      '</div>'+
      '<div style="font-size:18px;color:#7a9aaa">→</div>'+
      '<div style="background:#229ed9;border-radius:10px;padding:8px 12px;text-align:center;min-width:70px">'+
        '<div style="font-size:18px">✈️</div>'+
        '<div style="font-size:10px;color:#fff;font-weight:700;margin-top:2px">Telegram</div>'+
        '<div style="font-size:9px;color:rgba(255,255,255,0.7)">API передаёт</div>'+
      '</div>'+
      '<div style="font-size:18px;color:#7a9aaa">→</div>'+
      '<div style="background:#8e44ad;border-radius:10px;padding:8px 12px;text-align:center;min-width:70px">'+
        '<div style="font-size:18px">🤖</div>'+
        '<div style="font-size:10px;color:#fff;font-weight:700;margin-top:2px">Нейро</div>'+
        '<div style="font-size:9px;color:rgba(255,255,255,0.7)">Отвечает</div>'+
      '</div>'+
      '<div style="font-size:18px;color:#7a9aaa">→</div>'+
      '<div style="background:#27ae60;border-radius:10px;padding:8px 12px;text-align:center;min-width:70px">'+
        '<div style="font-size:18px">👤</div>'+
        '<div style="font-size:10px;color:#fff;font-weight:700;margin-top:2px">CRM</div>'+
        '<div style="font-size:9px;color:rgba(255,255,255,0.7)">Лид в воронке</div>'+
      '</div>'+
    '</div>'+
    '<button data-a="mkt-instruction" style="width:100%;padding:9px;background:#fff;border:1px solid #005bff44;border-radius:9px;cursor:pointer;font-size:12px;color:#005bff;font-weight:700">📋 Инструкция нейропродавца →</button>'+
  '</div>';

  // Placeholder sections
  html+='<div style="background:#fff;border-radius:14px;border:2px dashed #dde6f0;padding:24px;text-align:center">'+
    '<div style="font-size:36px;margin-bottom:8px">📣</div>'+
    '<div style="font-size:14px;font-weight:700;color:#1a2a3a;margin-bottom:6px">Рекламные кампании</div>'+
    '<div style="font-size:12px;color:#7a9aaa">Авито, ВКонтакте, Яндекс.Директ — аналитика и управление</div>'+
  '</div>';

  html+='</div>';
  return html;
}

function tMarketingInstruction(){
  let html='<div>';
  html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'+
    '<button data-a="mkt-back" style="padding:6px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Маркетинг</button>'+
    '<div style="font-size:14px;font-weight:700;color:#0d1b2e;flex:1">📋 Инструкция нейропродавца</div>'+
  '</div>';

  // Editable instruction
  html+='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:14px;margin-bottom:12px">'+
    '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:8px">ТЕКСТ ИНСТРУКЦИИ</div>'+
    '<textarea id="mkt-inst-text" style="width:100%;padding:10px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;line-height:1.7;outline:none;box-sizing:border-box;height:380px;resize:vertical;background:#fafbfc;font-family:inherit">'+AI_INSTRUCTION.replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea>'+
    '<button data-a="mkt-save-inst" style="width:100%;margin-top:8px;padding:9px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">💾 Сохранить инструкцию</button>'+
  '</div>';

  html+='</div>';
  return html;
}

// CRM state
// Finance state — per-object financial data
// Finance: transactions per object
// txn = {id, objId, type:"income"|"expense", category, amount, date, note}
let financeData={}; // legacy compat
let openPhotoWid=null; // {wid} of work with open photo block
let dayReportHistOpen=false; // history toggle
const CLEANUP_BONUS=500; // ₽ premia at cleanup
function getTodayReport(obj,uid,dateISO){
  const reports=obj.dayReports||[];
  return reports.find(function(r){return r.userId===uid&&r.date===dateISO;});
}
function getCleanupBonusPaid(oid,uid,dateISO){
  return finTxns.filter(function(t){
    return t.type==="expense"&&txnCategoryGroup(t.category)==="salary_prod_bonus"&&t.objId===oid&&t.userId===uid&&t.date===dateISO;
  }).reduce(function(a,t){return a+(t.amount||0);},0);
}
let timeHistoryExpanded={}; // {wid: true} which work histories are expanded
let openTimeWid=null; // {wid} of work with open time-log form
let openTimeOid=null;
let openTimeSid=null;
let newTimeLog={hours:1,date:""}; // staged values for new time entry
let finMode="pnl"; // "bdds" | "pnl" | "experiment"
let bddsView="month"; // "month" or "contract"
let finTxns=[
  // Баня на Киевке — sample data
  {id:"ft1",objId:"obj_banya_kievka",type:"income",  category:"Аванс клиента 1", amount:255000,date:"2026-04-15",note:"Первый аванс 30%",method:"transfer"},
  {id:"ft2",objId:"obj_banya_kievka",type:"income",  category:"Аванс клиента 2", amount:340000,date:"2026-05-10",note:"Второй аванс 40%",method:"cash"},
  {id:"ft3",objId:"obj_banya_kievka",type:"expense", category:"Закупка материалов",amount:148000,date:"2026-04-20",note:"Озон, Лемана — 1 этап"},
  {id:"ft4",objId:"obj_banya_kievka",type:"expense", category:"Зарплата аванс 1", amount:85000, date:"2026-04-28",note:"Бригада Валера+Азис"},
  {id:"ft5",objId:"obj_banya_kievka",type:"expense", category:"Закупка материалов",amount:62000, date:"2026-05-12",note:"Белка — 2 этап"},
  {id:"ft6",objId:"obj_banya_kievka",type:"expense", category:"Зарплата аванс 2", amount:70000, date:"2026-05-20",note:"Бригада"},
  // Дом на Дмитровке — sample data
  {id:"ft7",objId:"obj_dom_dmitrovka",type:"income",  category:"Аванс клиента 1", amount:600000,date:"2026-04-01",note:"Первый аванс 30%",method:"transfer"},
  {id:"ft8",objId:"obj_dom_dmitrovka",type:"expense", category:"Закупка материалов",amount:220000,date:"2026-04-10",note:"Лемана — фундамент"},
  {id:"ft9",objId:"obj_dom_dmitrovka",type:"expense", category:"Зарплата аванс 1", amount:120000,date:"2026-04-25",note:"Бригада Инна"},,
  // Legacy paid amounts converted to transactions
  {id:"ftleg1",objId:"obj_banya_kievka",contractId:"ct001",userId:"valera",type:"expense",category:"👷 Зарплата производства",amount:85000,date:"2026-04-20",note:"Аванс производству"},
  {id:"ftleg2",objId:"obj_banya_kievka",contractId:"ct001",userId:"azis",type:"expense",category:"👷 Зарплата производства",amount:55000,date:"2026-04-20",note:"Аванс производству"},
  {id:"ftleg3",objId:"obj_dom_dmitrovka",contractId:"ct002",userId:"inna",type:"expense",category:"👷 Зарплата производства",amount:70000,date:"2026-04-15",note:"Аванс производству"},
  {id:"ftb1",objId:"obj_banya_kievka",contractId:"ct001",userId:"valera",type:"expense",category:"🧹 Премия за уборку",amount:500,date:"2026-04-14",note:"Уборка рабочего места · Баня на Киевке · Валера"},
  {id:"ftb2",objId:"obj_banya_kievka",contractId:"ct001",userId:"valera",type:"expense",category:"🧹 Премия за уборку",amount:500,date:"2026-04-16",note:"Уборка рабочего места · Баня на Киевке · Валера"},
  {id:"ftb3",objId:"obj_banya_kievka",contractId:"ct001",userId:"valera",type:"expense",category:"🧹 Премия за уборку",amount:500,date:"2026-04-18",note:"Уборка рабочего места · Баня на Киевке · Валера"},
  {id:"ftb4",objId:"obj_banya_kievka",contractId:"ct001",userId:"valera",type:"expense",category:"🧹 Премия за уборку",amount:500,date:"2026-04-22",note:"Уборка рабочего места · Баня на Киевке · Валера"},
];
let finOpenObjId=null;
let finOpenContractId=null; // contract P&L view
let cleanupExpanded={}; // {contractId: true} — раскрыт ли список премий за уборку
let finSelectedContractIds=[]; // contracts selected for dashboard aggregation
let finAddForm=false;
let finNewTxn={type:"income",category:"",amount:"",date:new Date().toISOString().slice(0,10),note:"",method:"transfer"};
// Contracts
let contractDocs=[
  {
    id:"ct001",
    objId:"obj_banya_kievka",
    type:"main",
    name:"Договор №47 — Баня на Киевке",
    amount:850000,
    signDate:"2026-04-12",
    deadlineDate:"2026-06-30",
    client:"Галина Соколова",
    status:"signed",
    note:"Баня 20 футов под ключ. Отделка липой, печь ASTON 24, дымоход, полки. Срок сдачи — 30 июня 2026.",
    crmClientId:"c22", responsible:["yuriy","valera","alexandr"], // Галина Соколова = c22
    deadlines:{ "valera":{startDate:"2026-04-14",deadline:"2026-06-20"} },
    salaries:{
      "valera":{},
      "azis":  {}
    }
  },
  {
    id:"ct002",
    objId:"obj_dom_dmitrovka",
    type:"main",
    name:"Договор №48 — Дом на Дмитровке",
    amount:2000000,
    signDate:"2026-04-01",
    deadlineDate:"2026-08-15",
    client:"Дмитрий Новиков",
    status:"signed",
    note:"Дом 40 футов, ПМЖ. Электрика, водоснабжение, канализация, чистовая отделка. Срок сдачи — 15 августа 2026.",
    crmClientId:"c21", responsible:["yuriy","inna"], // Дмитрий Новиков = c21
    salaries:{
      "inna":{}
    }
  },
]; // {id, objId, type:"main"|"extra", name, amount, signDate, client, status:"draft"|"signed"|"closed", file:"", note}
let contractView=null; // null=list, id=detail
let contractEditId=null; // id being edited
let ctClientSearch=""; // search in client dropdown
let ctMatPicker=null; // {cid, ewi, search:""} - shows material picker modal
// Global client picker function - called from inline onclick
window._ctPick=function(el){
  if(!el||!el.dataset){return;}
  var node=el;
  for(var i=0;i<5&&node&&!node.dataset.sid;i++){node=node.parentElement;}
  if(!node||!node.dataset.sid){return;}
  var selId=node.dataset.sid;
  var cid=node.dataset.cid;
  var cl=null;
  for(var j=0;j<crmClients.length;j++){
    if(crmClients[j].id===cid){cl=crmClients[j];break;}
  }
  if(!cl){return;}
  // Update source data so render() shows selection
  if(selId==="ct-client-sel"){
    contractNew.client=cl.name;
  } else if(selId==="ct-edit-client-sel"&&contractEditId){
    contractDocs=contractDocs.map(function(d){
      return d.id===contractEditId?Object.assign({},d,{client:cl.name,crmClientId:cl.id}):d;
    });
  }
  try{if(document.activeElement&&document.activeElement.blur){document.activeElement.blur();}}catch(e){}
  ctClientSearch="";
  render();
};

// Helper to bind clicks to all client picker items - called after every render
window._ctBindPickers=function(){
  const items=document.querySelectorAll("[data-sid][data-cid]");
  for(let i=0;i<items.length;i++){
    const el=items[i];
    el.onclick=function(){window._ctPick(el);return false;};
    el.style.cursor="pointer";
  }
};
let contractAddForm=false;
let contractNew={objId:"",type:"main",name:"",amount:"",signDate:new Date().toISOString().slice(0,10),client:"",status:"draft",note:"",deadlineDate:"",responsible:[],salaries:{},files:[]};

let finSalaries={}; // {objId: {userId: {plan:0, paid:0}}}
let finContracts={"obj_banya_kievka":850000,"obj_dom_dmitrovka":2000000}; // {objId: contractAmount} - fallback if no signed contracts

// Auto-aggregate contract amount from signed contracts (main + extra works)
function getObjectContractAmount(oid){
  const signed=contractDocs.filter(function(d){return d.objId===oid&&(d.status==="signed"||d.status==="closed");});
  if(!signed.length)return finContracts[oid]||0;
  // Sum: main contracts amount + extra works for all signed
  let total=0;
  signed.forEach(function(d){
    if(d.type==="main") total+=(d.amount||0);
    total+=(d.extraWorks||[]).reduce(function(a,w){
      return a+(w.cost||0)+(w.mats||[]).reduce(function(b,m){return b+(m.cost||0)*(m.qty||1);},0);
    },0);
  });
  return total;
}
let finExtraWorks={}; // {objId: [{id,name,amount,date,note}]}
const FIN_INCOME_CATS=["💰 Аванс клиента","💰 Окончательный расчёт","💰 Доп. оплата","💰 Прочий приход"];
// Default salary plans (when not explicitly set)
const DEFAULT_SALARY_PROD=200000;   // brigadier/worker
const DEFAULT_SALARY_ESCORT=150000; // РОП (sales_head)
const FIN_EXPENSE_CATS=["📦 Закупка материалов","📦 Доставка материалов","👷 Зарплата производства","🛠 Доп. работы производства","🧹 Премия за уборку","🚚 Зарплата сопроводителя","⚠️ Штраф просрочка","🔧 Аренда техники","💼 Прочий расход"];

// Role-based category filtering for "+Транзакция" button
// Get all object IDs accessible to a user:
// (1) explicitly assigned via u.objs, OR
// (2) implicitly assigned via being responsible in any contract for that object
function getUserObjects(user){
  if(!user)return [];
  const explicit=user.objs||[];
  const fromContracts=contractDocs
    .filter(function(c){return (c.responsible||[]).includes(user.id);})
    .map(function(c){return c.objId;});
  // Union (dedup)
  const all=explicit.concat(fromContracts);
  return all.filter(function(id,i){return id&&all.indexOf(id)===i;});
}

function getDefaultSalary(user){
  if(!user||!user.roles)return 0;
  if(user.roles.includes("sales_head"))return DEFAULT_SALARY_ESCORT;
  if(user.roles.includes("brigadier")||user.roles.includes("worker"))return DEFAULT_SALARY_PROD;
  return 0;
}

// === DEADLINE / FINE HELPERS ===
const FINE_PER_DAY=2000;
function addBusinessDays(dateStr,days){
  if(!dateStr)return "";
  const d=new Date(dateStr+"T00:00:00");
  if(isNaN(d.getTime()))return "";
  let added=0;
  while(added<days){
    d.setDate(d.getDate()+1);
    const wd=d.getDay();
    if(wd!==0&&wd!==6)added++;
  }
  return d.toISOString().slice(0,10);
}
function countBusinessDaysBetween(from,to){
  if(!from||!to)return 0;
  const a=new Date(from+"T00:00:00"),b=new Date(to+"T00:00:00");
  if(isNaN(a)||isNaN(b)||b<=a)return 0;
  let count=0;
  const cur=new Date(a);
  while(cur<b){
    cur.setDate(cur.getDate()+1);
    const wd=cur.getDay();
    if(wd!==0&&wd!==6)count++;
  }
  return count;
}
function todayISO(){return new Date().toISOString().slice(0,10);}
function getBrigadierDeadlineInfo(c,uid){
  const dl=c&&c.deadlines&&c.deadlines[uid]||{};
  const startDate=dl.startDate||"";
  const deadline=dl.deadline||(startDate?addBusinessDays(startDate,35):"");
  if(!deadline)return {hasDeadline:false,startDate,deadline:"",daysLeft:0,overdueDays:0,fine:0};
  const today=todayISO();
  let daysLeft=0,overdueDays=0;
  if(today<=deadline){
    daysLeft=countBusinessDaysBetween(today,deadline);
  } else {
    overdueDays=countBusinessDaysBetween(deadline,today);
  }
  return {hasDeadline:true,startDate,deadline,daysLeft,overdueDays,fine:overdueDays*FINE_PER_DAY};
}

// Get fines applied (as transactions) for a brigadier on a contract
function getFinesApplied(contractId,userId){
  return finTxns.filter(function(t){
    return t.type==="expense"&&t.contractId===contractId&&txnCategoryGroup(t.category)==="fine"&&t.userId===userId;
  }).reduce(function(a,t){return a+(t.amount||0);},0);
}
// Calculate total ДОП РАБОТЫ paid for a contract (across all brigade)
function getExtraWorksPaid(contract){
  if(!contract)return 0;
  return finTxns.filter(function(t){
    return t.type==="expense"&&t.contractId===contract.id&&txnCategoryGroup(t.category)==="salary_prod_extra";
  }).reduce(function(a,t){return a+(t.amount||0);},0);
}

// Get total planned amount for extra works on contract
function getExtraWorksPlan(contract){
  if(!contract||!contract.extraWorksPlan)return 0;
  return contract.extraWorksPlan.reduce(function(a,w){return a+(w.amount||0);},0);
}

// Calculate actual salary paid to a user on a contract — sum of transactions only.
// Strategy:
// 1) Sum transactions tagged with this user.id
// 2) PLUS share of untagged group transactions (split equally among users of same group on this contract)
function getSalaryPaid(contract, user){
  if(!contract||!user)return 0;
  const isEscort=user.roles.includes("sales_head");
  const grp=isEscort?"salary_escort":"salary_prod";
  let total=0;

  // 1) Tagged transactions for this user
  const tagged=finTxns.filter(function(t){
    return t.type==="expense"&&t.contractId===contract.id&&t.userId===user.id&&txnCategoryGroup(t.category)===grp;
  });
  total+=tagged.reduce(function(a,t){return a+(t.amount||0);},0);

  // 2) Untagged group transactions — split among eligible users
  const untaggedGroup=finTxns.filter(function(t){
    return t.type==="expense"&&t.contractId===contract.id&&!t.userId&&txnCategoryGroup(t.category)===grp;
  });
  if(untaggedGroup.length){
    const respIds=contract.responsible||[];
    const eligibleUsers=users.filter(function(u){
      if(!respIds.includes(u.id))return false;
      if(grp==="salary_escort")return u.roles.includes("sales_head");
      return u.roles.some(function(r){return r==="brigadier"||r==="worker";});
    });
    if(eligibleUsers.length&&eligibleUsers.find(function(u){return u.id===user.id;})){
      const groupSum=untaggedGroup.reduce(function(a,t){return a+(t.amount||0);},0);
      total+=Math.round(groupSum/eligibleUsers.length);
    }
  }

  return total;
}

function getAvailableCategories(user, type){
  if(!user) return type==="income"?FIN_INCOME_CATS:FIN_EXPENSE_CATS;
  const isAdmin=user.roles.includes("admin");
  const isFinancier=user.roles.includes("financier");
  const isSupply=user.roles.includes("supply");
  if(isAdmin||isFinancier){
    // Full access
    return type==="income"?FIN_INCOME_CATS:FIN_EXPENSE_CATS;
  }
  if(isSupply&&type==="expense"){
    // Supply only sees supply categories
    return FIN_EXPENSE_CATS.filter(function(c){return c.indexOf("📦")===0;});
  }
  // Others see nothing for income, limited for expense
  return [];
}

// Detect transaction category type for filtering
function txnCategoryGroup(category){
  if(!category) return "other";
  if(category.indexOf("📦")===0) return "supply";
  if(category.indexOf("👷")===0) return "salary_prod";
  if(category.indexOf("🛠")===0) return "salary_prod_extra";
  if(category.indexOf("🧹")===0) return "salary_prod_bonus";
  if(category.indexOf("🚚")===0) return "salary_escort";
  if(category.indexOf("⚠️")===0) return "fine";
  if(category.indexOf("💰")===0) return "income";
  return "other";
}

let crmClients=[
  // Этап 1 — Входящие (10 клиентов)
  {id:"c1", name:"Иван Петров",       phone:"+7 925 123-45-67",source:"Авито",stage:"new",      msg:"Добрый день! Интересует баня под ключ, 20 футов. Бюджет около 800к. Есть участок в Серпухове.",date:"2026-05-27",notes:""},
  {id:"c2", name:"Максим Воронов",    phone:"+7 916 234-11-22",source:"Авито",stage:"new",      msg:"Здравствуйте, смотрел ваше объявление на Авито. Хочу баню из контейнера, 20 футов. Сколько стоит?",date:"2026-05-27",notes:""},
  {id:"c3", name:"Светлана Орлова",   phone:"+7 903 987-65-43",source:"Авито",stage:"new",      msg:"Интересует дом 40 футов под ПМЖ. Участок в Раменском районе, 12 соток.",date:"2026-05-26",notes:""},
  {id:"c4", name:"Алексей Зайцев",    phone:"+7 909 555-33-11",source:"Авито",stage:"new",      msg:"Добрый день. Хочу узнать про баню 6 метров. Срок изготовления? Доставка в Тулу?",date:"2026-05-26",notes:""},
  {id:"c5", name:"Ольга Федорова",    phone:"+7 926 444-22-88",source:"Авито",stage:"new",      msg:"Здравствуйте! Видела ваши работы, очень нравится. Планируем баню на дачном участке в Калуге.",date:"2026-05-25",notes:""},
  {id:"c6", name:"Роман Белов",       phone:"+7 915 678-90-12",source:"Авито",stage:"new",      msg:"Интересует дом-баня 2в1 из 40-футового контейнера. Бюджет до 1.5 млн. Участок есть.",date:"2026-05-25",notes:""},
  {id:"c7", name:"Надежда Смирнова",  phone:"+7 901 234-56-78",source:"Авито",stage:"new",      msg:"Здравствуйте, хочу заказать баню 20 футов. Можно ли сделать под ключ с печью и полком из липы?",date:"2026-05-24",notes:""},
  {id:"c8", name:"Андрей Лебедев",    phone:"+7 917 321-00-55",source:"Авито",stage:"new",      msg:"Добрый день! Интересует контейнерный дом 40 футов. Планирую под аренду. Срок и гарантия?",date:"2026-05-24",notes:""},
  {id:"c9", name:"Татьяна Кузнецова", phone:"+7 906 789-45-23",source:"Авито",stage:"new",      msg:"Хотим баню на семью 4 человека, хорошая парилка, комната отдыха. Бюджет 700-900к.",date:"2026-05-23",notes:""},
  {id:"c10",name:"Виктор Морозов",    phone:"+7 923 111-22-33",source:"Авито",stage:"new",      msg:"Смотрел видео на ютубе, понравилась баня. Хочу 20 футов с дымоходом ASTON. Цена?",date:"2026-05-23",notes:""},
  // Этап 2 — Квалифицированные (6 клиентов)
  {id:"c11",name:"Олег Сидоров",      phone:"+7 916 234-56-78",source:"Авито",stage:"qualified",msg:"Хотим дом 40 футов, участок в Подмосковье. Бюджет до 2 млн. Готовы встретиться.",date:"2026-05-22",notes:"Участок 15 соток, ИЖС, Мытищи"},
  {id:"c12",name:"Елена Громова",     phone:"+7 910 456-78-90",source:"Авито",stage:"qualified",msg:"Баня 20 футов, есть участок в Рязанской области. Бюджет 850к. Уточнила все детали.",date:"2026-05-21",notes:"Приезжает на авто, нужна парковка"},
  {id:"c13",name:"Кирилл Антонов",    phone:"+7 929 543-21-00",source:"Авито",stage:"qualified",msg:"Дом 40 футов под ПМЖ. Участок 20 соток, Ступинский район. Бюджет 1.8 млн.",date:"2026-05-20",notes:"Хочет второй этаж-антресоль"},
  {id:"c14",name:"Марина Волкова",    phone:"+7 904 222-33-44",source:"Авито",stage:"qualified",msg:"Баня + хозблок из двух контейнеров. Участок в Серпухове. Бюджет 1.2 млн.",date:"2026-05-19",notes:"Два контейнера, спросить про стыковку"},
  {id:"c15",name:"Сергей Козлов",     phone:"+7 918 777-88-99",source:"Авито",stage:"qualified",msg:"Дом 40 футов для сдачи в аренду на выходные. Участок в Тверской области.",date:"2026-05-18",notes:"Нужен выход на Booking/Суточно.ру"},
  {id:"c16",name:"Ирина Павлова",     phone:"+7 905 666-55-44",source:"Авито",stage:"qualified",msg:"Баня 20 футов, деревня Подольского района. Бюджет 750к, хочет печь ASTON.",date:"2026-05-17",notes:"Муж строитель, сам подготовит фундамент"},
  // Этап 3 — Встреча на производстве (4 клиента)
  {id:"c17",name:"Анна Козлова",      phone:"+7 903 345-67-89",source:"Авито",stage:"meeting",  msg:"Согласовали встречу на производстве. Интересует баня 20 футов с отделкой липой.",date:"2026-05-16",notes:"Приедет в пятницу в 11:00, с мужем"},
  {id:"c18",name:"Борис Никитин",     phone:"+7 912 000-11-22",source:"Авито",stage:"meeting",  msg:"Записались на экскурсию. Хотят дом 40 футов, смотреть аналог на площадке.",date:"2026-05-15",notes:"Едут из Воронежа, нужно показать готовый дом"},
  {id:"c19",name:"Юлия Захарова",     phone:"+7 928 333-44-55",source:"Авито",stage:"meeting",  msg:"Встреча назначена. Баня 20 футов, хочет обсудить отделку можжевельником.",date:"2026-05-14",notes:"Была на производстве, второй визит — с родителями"},
  {id:"c20",name:"Павел Степанов",    phone:"+7 907 888-99-00",source:"Авито",stage:"meeting",  msg:"Договорились на встречу в субботу. Дом 40 футов, интересует планировка.",date:"2026-05-13",notes:"Привезёт архитектора для консультации"},
  // Этап 4 — Договор (3 клиента)
  {id:"c21",name:"Дмитрий Новиков",   phone:"+7 499 456-78-90",source:"Авито",stage:"contract", msg:"Готовы подписать договор, внесём аванс 30%. Дом 40 футов, срок 3 месяца.",date:"2026-05-10",notes:"Аванс 540к, остаток при сдаче. Нотариус не нужен"},
  {id:"c22",name:"Галина Соколова",   phone:"+7 913 123-45-00",source:"Авито",stage:"contract", msg:"Договор подписан. Баня 20 футов с печью ASTON. Ждёт КП с графиком.",date:"2026-05-08",notes:"Аванс получен 255к, остаток 595к при сдаче"},
  {id:"c23",name:"Николай Тарасов",   phone:"+7 921 987-00-11",source:"Авито",stage:"contract", msg:"Согласовали все детали, аванс переведён. Дом 40 футов, отделка под ключ.",date:"2026-05-05",notes:"Аванс 600к. Срок сдачи — 10 августа"},
  // Этап 3 — КП отправлено (5 клиентов)
  {id:"c26",name:"Константин Попов",  phone:"+7 965 111-22-33",source:"Авито",stage:"kp",       msg:"Получил КП, изучаю. Хочу баню 20 футов с можжевельником и печью ASTON.",date:"2026-05-20",notes:"КП отправлено 20 мая. Бюджет 900к. Ждёт ответа по скидке"},
  {id:"c27",name:"Валентина Крылова", phone:"+7 937 444-55-66",source:"Авито",stage:"kp",       msg:"Спасибо за КП! Покажите, пожалуйста, более детальный чертёж планировки.",date:"2026-05-19",notes:"Дом 40 футов. Хочет 2 спальни + санузел. КП 1.65 млн"},
  {id:"c28",name:"Артём Коробов",     phone:"+7 952 777-88-99",source:"Авито",stage:"kp",       msg:"КП получил. Обсудил с женой — готовы ехать смотреть. Когда удобно?",date:"2026-05-18",notes:"Баня 20 футов + терраса. Почти готовы к встрече"},
  {id:"c29",name:"Наталья Фролова",   phone:"+7 931 000-11-22",source:"Авито",stage:"kp",       msg:"Добрый день, изучила КП. Есть вопросы по материалам отделки и гарантии.",date:"2026-05-17",notes:"Дом 40 футов под ПМЖ. Важна гарантия и качество отделки"},
  {id:"c30",name:"Геннадий Макаров",  phone:"+7 908 333-44-55",source:"Авито",stage:"kp",       msg:"КП отличное! Хочу добавить кондиционер и второй унитаз. Можно пересчитать?",date:"2026-05-16",notes:"Баня 20 футов. Просит доп. опции — кондей и сантехника"},
  // Этап 5 — Монтаж (2 клиента)
  {id:"c24",name:"Александр Титов",   phone:"+7 924 555-00-11",source:"Авито",stage:"montaj",   msg:"Баня 20 футов в работе. Монтаж идёт по графику.",date:"2026-04-20",notes:"Бригадир: Валера. Срок сдачи 30 мая. Осталось: полок + печь"},
  {id:"c25",name:"Людмила Ершова",    phone:"+7 911 222-33-44",source:"Авито",stage:"montaj",   msg:"Дом 40 футов, второй этап монтажа. Электрика завершена, идёт чистовая отделка.",date:"2026-04-10",notes:"Бригадир: Инна. Сдача 15 июня. Клиент хочет фото-отчёт"},
];
let crmView="funnel"; // "funnel" | "client" | "instruction"
let crmOpenId=null;
let crmAddForm=false;
let crmStageFilter=null; // filter by stage id
let crmClientSearch=""; // search by name/phone
let crmStagePickerOpen=false; // expanded stage selector
let crmNewClient={name:"",phone:"",msg:"",notes:""};

const CRM_STAGES=[
  {id:"new",      label:"📥 Входящие",               color:"#7f8c8d", desc:"Новый лид из Авито"},
  {id:"qualified",label:"✅ Квалифицированный",       color:"#2980b9", desc:"Подтверждён интерес и бюджет"},
  {id:"kp",       label:"📄 Отправлено КП",           color:"#16a085", desc:"Коммерческое предложение отправлено"},
  {id:"meeting",  label:"🏭 Встреча на производстве", color:"#e67e22", desc:"Ключевой этап воронки"},
  {id:"contract", label:"📝 Договор",                color:"#27ae60", desc:"Договор подписан / аванс получен"},
  {id:"montaj",   label:"🔨 Монтаж",                 color:"#8e44ad", desc:"Объект в производстве"},
];

let AI_INSTRUCTION="# Инструкция нейропродавца КубрДом\n\n## Роль\nТы — менеджер по продажам КубрДом. Отвечаешь на входящие сообщения клиентов из Авито. Твоя цель — квалифицировать клиента и назначить встречу на производстве.\n\n## Этапы работы с клиентом\n\n**1. Приветствие (Входящие)**\n- Отвечай в течение 5 минут\n- Поздоровайся, представься, уточни запрос\n- Пример: «Добрый день! Меня зовут [имя], менеджер КубрДом. Вы интересовались баней из контейнера — расскажите подробнее, что вы хотите?»\n\n**2. Квалификация**\nЗадай 3 вопроса:\n- Какой объект интересует? (баня/дом, размер)\n- Есть ли земельный участок? (адрес, назначение)\n- Бюджет и сроки?\n\n**3. Ключевой этап — Встреча на производстве**\n- Предложи приехать на производство: «Лучший способ убедиться в качестве — приехать и всё увидеть своими глазами. Мы находимся в [адрес]. Когда вам удобно?»\n- Встреча = 70% вероятность сделки\n\n**4. Договор**\n- После встречи высылай КП в течение 24 часов\n- Аванс 30%, остаток при сдаче\n\n## Важно\n- Не называй точную стоимость без расчёта\n- Всегда веди к встрече на производстве\n- Отвечай дружелюбно, без канцеляризма\n- Если клиент не отвечает 2 дня — напомни о себе";

function tCRM(){
  if(crmView==="instruction") return tCRMInstruction();
  if(crmView==="client"&&crmOpenId) return tCRMClient(crmOpenId);
  return tCRMFunnel();
}

function tCRMFunnel(){
  // Stats
  const total=crmClients.length;
  const byStage={};
  CRM_STAGES.forEach(function(s){byStage[s.id]=crmClients.filter(function(c){return c.stage===s.id;});});

  let html='<div>';
  // Header
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
    '<div>'+
      '<div style="font-size:11px;color:#7a9aaa;font-weight:700;letter-spacing:1px">CRM — ВОРОНКА АВИТО</div>'+
      '<div style="font-size:12px;color:#5a7a9a;margin-top:2px">'+total+' клиентов в работе</div>'+
    '</div>'+
    '<div style="display:flex;gap:6px">'+
      
      '<button data-a="crm-add" style="padding:6px 12px;background:#2980b9;border:none;border-radius:8px;cursor:pointer;font-size:11px;color:#fff;font-weight:700">+ Клиент</button>'+
    '</div>'+
  '</div>';

  // Pipeline — horizontal bar funnel with icons
  const totalClients=crmClients.length;
  const contractedCnt=(byStage["contract"]||[]).length;
  const convRate=totalClients>0?Math.round(contractedCnt/totalClients*100):0;

  // Stage icons map
  const STAGE_ICONS={
    "new":"📥","qualified":"✅","kp":"📄","meeting":"🏭","contract":"📝","montaj":"🔨"
  };

  // Add form (right after header, near "+ Клиент" button)
  if(crmAddForm){
    html+='<div style="background:#fff;border-radius:12px;border:2px solid #2980b9;padding:14px;margin-bottom:14px;animation:slideDown 0.2s ease-out">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'+
        '<div style="font-size:13px;font-weight:700;color:#1a2a3a">➕ Новый клиент</div>'+
        '<button data-a="crm-cancel-new" style="padding:4px 9px;background:transparent;border:1px solid #d0dae8;border-radius:6px;cursor:pointer;font-size:11px;color:#7a9aaa">✕</button>'+
      '</div>'+
      '<input id="crm-n" placeholder="Имя клиента" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;box-sizing:border-box" autofocus>'+
      '<input id="crm-p" data-phone-mask="1" type="tel" inputmode="tel" placeholder="+7 (___) ___-__-__" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:8px;outline:none;box-sizing:border-box">'+
      '<textarea id="crm-m" placeholder="Первое сообщение / запрос клиента" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;margin-bottom:8px;outline:none;box-sizing:border-box;height:70px;resize:none"></textarea>'+
      '<button data-a="crm-save-new" style="width:100%;padding:10px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:13px;font-weight:700">✓ Добавить клиента</button>'+
    '</div>';
  }

  // Metric cards
  html+=
    '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:14px">'+
      '<div style="background:var(--color-background-secondary,#f6f8fa);border-radius:8px;padding:12px">'+
        '<div style="font-size:22px;font-weight:500;color:var(--color-text-primary,#1a2a3a)">'+totalClients+'</div>'+
        '<div style="font-size:12px;color:var(--color-text-secondary,#7a9aaa);margin-top:2px">Всего клиентов</div>'+
      '</div>'+
      '<div style="background:var(--color-background-secondary,#f6f8fa);border-radius:8px;padding:12px">'+
        '<div style="font-size:22px;font-weight:500;color:'+(convRate>=20?'#27ae60':convRate>=10?'#f39c12':'#e74c3c')+'">'+convRate+'%</div>'+
        '<div style="font-size:12px;color:var(--color-text-secondary,#7a9aaa);margin-top:2px">Конверсия в договор</div>'+
      '</div>'+
    '</div>';

  // Funnel rows
  html+='<div style="display:flex;flex-direction:column;gap:0;margin-bottom:12px">';
  CRM_STAGES.forEach(function(s,i){
    const cnt=byStage[s.id].length;
    const pct=totalClients>0?Math.round(cnt/totalClients*100):0;
    const isActive=crmStageFilter===s.id;
    const icon=STAGE_ICONS[s.id]||"•";

    // Row — vertical layout: label on top, bar below (no overlap)
    html+=
      '<div data-a="crm-filter-stage" data-sid="'+s.id+'" style="'+
        'display:flex;align-items:center;gap:10px;'+
        'padding:8px 10px;border-radius:10px;cursor:pointer;'+
        'background:'+(isActive?s.color+"12":"transparent")+';'+
        'border:1.5px solid '+(isActive?s.color:"transparent")+';'+
        'transition:all 0.15s'+
      '">'+
        // Icon
        '<div style="width:36px;height:36px;border-radius:8px;background:'+s.color+'20;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">'+icon+'</div>'+
        // Right column: label + bar stacked
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">'+
          // Label row with count
          '<div style="display:flex;align-items:baseline;gap:6px">'+
            '<span style="font-size:12px;font-weight:700;color:#1a2a3a;line-height:1.2;flex:1;min-width:0">'+s.label.replace(/^\S+\s*/,"")+'</span>'+
            '<span style="font-size:13px;font-weight:700;color:'+s.color+';flex-shrink:0">'+cnt+'</span>'+
          '</div>'+
          // Desc
          '<div style="font-size:10px;color:#7a9aaa;line-height:1.2">'+s.desc+'</div>'+
          // Bar
          '<div style="height:8px;background:#f0f4f8;border-radius:4px;overflow:hidden;margin-top:2px">'+
            '<div style="height:100%;background:'+s.color+';width:'+pct+'%;transition:width 0.4s ease;border-radius:4px"></div>'+
          '</div>'+
        '</div>'+
      '</div>';

    // Conversion arrow between stages
    if(i<CRM_STAGES.length-1){
      const next=CRM_STAGES[i+1];
      const nextCnt=byStage[next.id].length;
      const conv=cnt>0?Math.round(nextCnt/cnt*100):0;
      const cvCol=conv>=50?'#27ae60':conv>=25?'#f39c12':'#e74c3c';
      html+=
        '<div style="display:flex;align-items:center;gap:6px;padding:2px 10px 2px 56px;opacity:0.7">'+
          '<div style="width:1px;height:10px;background:'+s.color+';opacity:0.4"></div>'+
          '<span style="font-size:10px;color:'+cvCol+';font-weight:600">↓ '+conv+'%</span>'+
          '<span style="font-size:10px;color:var(--color-text-secondary,#9aabbf)">конверсия</span>'+
        '</div>';
    }
  });
  html+='</div>';

  // Active filter banner (no duplicate icon since label has its own emoji)
  if(crmStageFilter){
    const fs=CRM_STAGES.find(function(s){return s.id===crmStageFilter;});
    html+=
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;background:'+(fs?fs.color+"15":"#f0f4f8")+';border:1.5px solid '+(fs?fs.color:"#dde6f0")+';border-radius:10px;padding:10px 12px">'+
        '<span style="font-size:10px;color:'+(fs?fs.color:"#7a9aaa")+';font-weight:700;letter-spacing:0.5px">ФИЛЬТР:</span>'+
        '<span style="font-size:13px;color:#1a2a3a;flex:1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(fs?fs.label:"")+'</span>'+
        '<span style="font-size:11px;color:'+(fs?fs.color:"#7a9aaa")+';font-weight:700;background:#fff;border-radius:8px;padding:2px 8px">'+(byStage[crmStageFilter]||[]).length+'</span>'+
        '<button data-a="crm-clear-filter" style="padding:4px 9px;background:#fff;border:1px solid #d0dae8;border-radius:6px;cursor:pointer;font-size:11px;color:#7a9aaa;font-weight:700;min-width:30px">✕</button>'+
      '</div>';
  }

  // Search input (placed AFTER funnel, so results appear right below it)
  html+='<div style="margin:8px 0 12px">'+
    '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:6px">🔍 ПОИСК КЛИЕНТА</div>'+
    '<div style="position:relative">'+
      '<input id="crm-search" value="'+crmClientSearch.replace(/"/g,"&quot;")+'" placeholder="Поиск по ФИО или телефону..." style="width:100%;padding:10px 36px 10px 12px;border-radius:10px;border:1px solid #d0dae8;font-size:13px;outline:none;box-sizing:border-box;background:#fff">'+
      (crmClientSearch?'<button data-a="crm-search-clear" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);padding:4px 9px;background:#e74c3c12;border:1px solid #e74c3c33;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:11px;font-weight:700">✕</button>':"")+
    '</div>'+
    '<div id="crm-found-badge" style="display:'+(crmClientSearch?"":"none")+';margin-top:6px;padding:6px 10px;background:#e8f4fd;border:1px solid #2980b933;border-radius:8px;font-size:11px;color:#2980b9;font-weight:600">'+
      'Найдено: <span style="font-weight:800">0</span> · <span style="color:#7a9aaa;font-weight:500">результаты ниже ↓</span>'+
    '</div>'+
  '</div>';

  // Apply search filter
  const searchQ=(crmClientSearch||"").trim().toLowerCase();
  function matchesSearch(c){
    if(!searchQ)return true;
    const name=(c.name||"").toLowerCase();
    const phone=(c.phone||"").toLowerCase().replace(/[\s\-\(\)\+]/g,"");
    const msg=(c.msg||"").toLowerCase();
    const notes=(c.notes||"").toLowerCase();
    const qPhone=searchQ.replace(/[\s\-\(\)\+]/g,"");
    // Match if query is in name, phone (digits-only), message or notes
    return name.indexOf(searchQ)>=0||(qPhone&&phone.indexOf(qPhone)>=0)||msg.indexOf(searchQ)>=0||notes.indexOf(searchQ)>=0;
  }
  const filteredByStage={};
  CRM_STAGES.forEach(function(s){filteredByStage[s.id]=(byStage[s.id]||[]).filter(matchesSearch);});
  const totalFound=Object.values(filteredByStage).reduce(function(a,arr){return a+arr.length;},0);

  if(searchQ){
    html+='<div style="font-size:11px;color:#7a9aaa;margin-bottom:10px;padding:6px 10px;background:#f0f4f8;border-radius:8px">Найдено: <span style="font-weight:700;color:#2980b9">'+totalFound+'</span> '+(totalFound===1?"клиент":totalFound>=2&&totalFound<=4?"клиента":"клиентов")+'</div>';
  }

  // Clients by stage
  const stagesToShow=crmStageFilter?CRM_STAGES.filter(function(s){return s.id===crmStageFilter;}):CRM_STAGES;
  stagesToShow.forEach(function(s){
    const clients=filteredByStage[s.id]||[];
    if(searchQ&&clients.length===0)return; // hide empty stages during search
    // Hide section header when filtering by this stage (it's already shown in filter banner)
    if(!crmStageFilter||stagesToShow.length>1){
      html+='<div style="margin-bottom:16px">'+
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;margin-bottom:8px;border-bottom:2px solid '+s.color+'22">'+
          '<div style="width:10px;height:10px;border-radius:50%;background:'+s.color+';flex-shrink:0"></div>'+
          '<span style="font-size:12px;font-weight:700;color:#1a2a3a;flex:1">'+s.label+'</span>'+
          '<span style="font-size:11px;font-weight:700;color:'+s.color+';background:'+s.color+'15;border-radius:8px;padding:1px 8px">'+clients.length+'</span>'+
        '</div>';
    } else {
      html+='<div style="margin-bottom:16px">';
    }

    if(clients.length===0){
      html+='<div style="text-align:center;font-size:12px;color:#c0c8d0;padding:12px">Нет клиентов на этом этапе</div>';
    }

    clients.forEach(function(c){
      // Find prev/next stage for move buttons
      const sIdx=CRM_STAGES.findIndex(function(st){return st.id===s.id;});
      const prevStage=sIdx>0?CRM_STAGES[sIdx-1]:null;
      const nextStage=sIdx<CRM_STAGES.length-1?CRM_STAGES[sIdx+1]:null;

      html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:8px;border-left:3px solid '+s.color+'">'+
        '<div data-a="crm-open" data-cid="'+c.id+'" style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">'+
          '<div style="width:38px;height:38px;border-radius:10px;background:'+s.color+'18;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;pointer-events:none">👤</div>'+
          '<div style="flex:1;min-width:0;pointer-events:none">'+
            '<div style="font-size:13px;font-weight:700;color:#1a2a3a">'+c.name+'</div>'+
            '<div style="font-size:11px;color:#7a9aaa;margin-top:2px">'+(c.phone?'<a href="tel:'+c.phone.replace(/[^0-9+]/g,"")+'" onclick="event.stopPropagation();return true" style="color:#27ae60;text-decoration:none;font-weight:700">📞 '+c.phone+'</a>':'')+'  ·  '+c.source+'  ·  '+c.date+'</div>'+
            '<div style="font-size:12px;color:#5a7a9a;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.msg+'</div>'+
            (c.notes?'<div style="font-size:10px;color:#9aabbf;margin-top:2px;font-style:italic">📝 '+c.notes+'</div>':'')+
            // Qualification badges
            (function(){
              const plotMap={"yes":{l:"✅ Участок есть",c:"#27ae60"},"progress":{l:"⏳ Участок в процессе",c:"#f39c12"},"no":{l:"❌ Без участка",c:"#e74c3c"}};
              const timeMap={"month":{l:"🔥 1 мес",c:"#e74c3c"},"3months":{l:"📅 3 мес",c:"#f39c12"},"later":{l:"⏰ Позже",c:"#7a9aaa"}};
              const badges=[];
              if(c.plot&&plotMap[c.plot])badges.push('<span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 7px;border-radius:5px;background:'+plotMap[c.plot].c+'18;color:'+plotMap[c.plot].c+'">'+plotMap[c.plot].l+'</span>');
              if(c.timeline&&timeMap[c.timeline])badges.push('<span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 7px;border-radius:5px;background:'+timeMap[c.timeline].c+'18;color:'+timeMap[c.timeline].c+'">'+timeMap[c.timeline].l+'</span>');
              return badges.length?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">'+badges.join("")+'</div>':'';
            })()+
          '</div>'+
          '<span style="font-size:18px;color:#c8d8e8;flex-shrink:0;pointer-events:none">›</span>'+
        '</div>'+
        // Priority/readiness indicator — only for early funnel stages (before "contract")
        (function(){
          // Hide for clients already at "contract" or "montaj" stages — they're already signed
          if(c.stage==="contract"||c.stage==="montaj")return "";
          const tl=c.timeline;
          const pl=c.plot;
          let priority="cold";
          let label="";
          let bg="#f8fafc";
          let color="#7a9aaa";
          let border="#dde6f0";
          if(tl==="month"&&pl==="yes"){
            priority="hot";
            label="🔥 ГОРЯЧИЙ — Звонить срочно!";
            bg="#fee2e2";color="#dc2626";border="#fca5a5";
          } else if(tl==="month"){
            priority="warm-hot";
            label="🔥 Готов купить в течение месяца";
            bg="#fef3c7";color="#dc2626";border="#fcd34d";
          } else if(tl==="3months"&&pl==="yes"){
            priority="warm";
            label="📅 Тёплый — 3 мес, участок есть";
            bg="#fef3c7";color="#d97706";border="#fcd34d";
          } else if(tl==="3months"){
            priority="warm";
            label="📅 В течение 3 месяцев";
            bg="#fef3c7";color="#d97706";border="#fcd34d";
          } else if(tl==="later"){
            priority="cold";
            label="⏰ Покупка позже";
            bg="#f1f5f9";color="#64748b";border="#cbd5e1";
          } else if(pl==="yes"){
            label="✅ Участок есть · уточнить срок";
            bg="#dbeafe";color="#2563eb";border="#93c5fd";
          } else if(pl==="no"){
            label="❌ Без участка";
            bg="#f1f5f9";color="#64748b";border="#cbd5e1";
          } else {
            // Not qualified yet — show nothing
            return "";
          }
          return '<div style="margin-top:8px;padding:8px 12px;background:'+bg+';border:1px solid '+border+';border-radius:8px;font-size:11px;color:'+color+';font-weight:700;text-align:center'+(priority==="hot"?";animation:pulse 2s infinite":"")+'">'+label+'</div>';
        })()+
      '</div>';
    });
    html+='</div>';
  });

  html+='</div>';
  return html;
}

function tCRMClient(cid){
  const c=crmClients.find(function(x){return x.id===cid;});
  if(!c) return tCRMFunnel();
  const stage=CRM_STAGES.find(function(s){return s.id===c.stage;})||CRM_STAGES[0];
  let html='<div>';
  // Back button + name
  html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'+
    '<button data-a="crm-back" style="padding:6px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← Воронка</button>'+
    '<div style="flex:1;font-size:15px;font-weight:700;color:#0d1b2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</div>'+
  '</div>';
  // Stage section: current badge (clickable to expand) + optional full list
  const curStageIdx=CRM_STAGES.findIndex(function(s){return s.id===c.stage;});
  const curStage=CRM_STAGES[curStageIdx]||CRM_STAGES[0];
  const prevS=curStageIdx>0?CRM_STAGES[curStageIdx-1]:null;
  const nextS=curStageIdx<CRM_STAGES.length-1?CRM_STAGES[curStageIdx+1]:null;
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
      '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px">ЭТАП ВОРОНКИ</div>'+
      '<button onclick="window._crmStageToggle()" style="padding:3px 9px;background:'+(crmStagePickerOpen?"#2980b9":"#f0f4f8")+';border:1px solid '+(crmStagePickerOpen?"#2980b9":"#dde6f0")+';border-radius:6px;cursor:pointer;font-size:10px;color:'+(crmStagePickerOpen?"#fff":"#7a9aaa")+';font-weight:700">'+(crmStagePickerOpen?"× Свернуть":"📋 Все этапы")+'</button>'+
    '</div>'+
    // Current stage badge (also clickable to expand)
    '<div onclick="window._crmStageToggle()" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:'+curStage.color+';margin-bottom:8px;cursor:pointer">'+
      '<div style="width:8px;height:8px;border-radius:50%;background:#fff;flex-shrink:0;pointer-events:none"></div>'+
      '<span style="font-size:13px;font-weight:700;color:#fff;flex:1;pointer-events:none">'+curStage.label+'</span>'+
      '<span style="font-size:11px;color:rgba(255,255,255,0.8);pointer-events:none">'+(curStageIdx+1)+' / '+CRM_STAGES.length+(crmStagePickerOpen?" ▲":" ▼")+'</span>'+
    '</div>';
  // Expanded list - all stages clickable
  if(crmStagePickerOpen){
    html+='<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;padding:8px;background:#f8fafc;border-radius:8px">';
    CRM_STAGES.forEach(function(s,i){
      const active=c.stage===s.id;
      html+='<button onclick="window._crmMove(this)" data-cid="'+c.id+'" data-sid="'+s.id+'" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;background:'+(active?s.color:"#fff")+';border:1.5px solid '+(active?s.color:"#dde6f0")+';width:100%;text-align:left">'+
        '<span style="font-size:10px;font-weight:700;color:'+(active?"rgba(255,255,255,0.6)":"#9aabbf")+';min-width:18px;pointer-events:none">'+(i+1)+'.</span>'+
        '<div style="width:8px;height:8px;border-radius:50%;background:'+(active?"#fff":s.color)+';flex-shrink:0;pointer-events:none"></div>'+
        '<span style="font-size:12px;font-weight:700;color:'+(active?"#fff":"#1a2a3a")+';flex:1;pointer-events:none">'+s.label+'</span>'+
        (active?'<span style="font-size:11px;color:rgba(255,255,255,0.9);pointer-events:none">✓ Текущий</span>':'')+
      '</button>';
    });
    html+='</div>';
  }
  html+='</div>';
  // Quick contact buttons (only if phone exists)
  const phoneRaw=(c.phone||"").replace(/[^0-9+]/g,"");
  const phoneDigits=phoneRaw.replace(/[^0-9]/g,"");
  if(phoneRaw){
    html+='<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:12px">'+
      // Call — multiple fallbacks: <a> + onclick that forces tel:
      '<a href="tel:'+phoneRaw+'" onclick="window._callPhone(\''+phoneRaw+'\',event)" style="padding:11px 8px;background:#27ae60;border:none;border-radius:10px;text-decoration:none;color:#fff;font-size:12px;font-weight:700;text-align:center;display:flex;align-items:center;justify-content:center;gap:5px;min-height:44px;cursor:pointer">📞 Позвонить</a>'+
      // WhatsApp
      '<a href="https://wa.me/'+phoneDigits+'" onclick="window._openExt(\'https://wa.me/'+phoneDigits+'\',event)" target="_blank" rel="noopener" style="padding:11px 8px;background:#25d366;border:none;border-radius:10px;text-decoration:none;color:#fff;font-size:12px;font-weight:700;text-align:center;display:flex;align-items:center;justify-content:center;gap:5px;min-height:44px;cursor:pointer">💬 WhatsApp</a>'+
      // Telegram
      '<a href="https://t.me/+'+phoneDigits+'" onclick="window._openExt(\'https://t.me/+'+phoneDigits+'\',event)" target="_blank" rel="noopener" style="padding:11px 8px;background:#0088cc;border:none;border-radius:10px;text-decoration:none;color:#fff;font-size:12px;font-weight:700;text-align:center;display:flex;align-items:center;justify-content:center;gap:5px;min-height:44px;cursor:pointer">✈️ Telegram</a>'+
      // Max (VK messenger)
      '<a href="https://max.ru/'+phoneDigits+'" onclick="window._openExt(\'https://max.ru/'+phoneDigits+'\',event)" target="_blank" rel="noopener" style="padding:11px 8px;background:#5b3aff;border:none;border-radius:10px;text-decoration:none;color:#fff;font-size:12px;font-weight:700;text-align:center;display:flex;align-items:center;justify-content:center;gap:5px;min-height:44px;cursor:pointer">💜 Max</a>'+
    '</div>';
  }

  // Contact info — editable
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">'+
    '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:8px">КОНТАКТ</div>'+
    '<input id="crm-edit-name-'+c.id+'" value="'+c.name.replace(/"/g,"&quot;")+'" placeholder="Имя клиента" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;font-weight:600;margin-bottom:6px;outline:none;box-sizing:border-box">'+
    '<input id="crm-edit-phone-'+c.id+'" data-phone-mask="1" type="tel" inputmode="tel" value="'+c.phone.replace(/"/g,"&quot;")+'" placeholder="+7 (___) ___-__-__" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:6px;outline:none;box-sizing:border-box">'+
    '<input id="crm-edit-source-'+c.id+'" value="'+c.source.replace(/"/g,"&quot;")+'" placeholder="Источник" style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:13px;margin-bottom:6px;outline:none;box-sizing:border-box">'+
    '<button data-a="crm-save-contact" data-cid="'+c.id+'" style="width:100%;padding:7px;background:#2980b9;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">💾 Сохранить контакт</button>'+
  '</div>';
  // ── QUALIFICATION: Plot ownership + Purchase timeline ──
  const plotVal=c.plot||"none"; // "yes"|"progress"|"no"|"none"
  const timeVal=c.timeline||"none"; // "month"|"3months"|"later"|"none"
  const plotOpts=[
    {v:"yes",l:"✅ Да",c:"#27ae60"},
    {v:"progress",l:"⏳ В процессе",c:"#f39c12"},
    {v:"no",l:"❌ Нет",c:"#e74c3c"}
  ];
  const timeOpts=[
    {v:"month",l:"🔥 В течение месяца",c:"#e74c3c"},
    {v:"3months",l:"📅 В течение 3 месяцев",c:"#f39c12"},
    {v:"later",l:"⏰ Позже",c:"#7a9aaa"}
  ];
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">'+
    '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:10px">📋 КВАЛИФИКАЦИЯ</div>'+
    // Plot
    '<div style="font-size:11px;color:#5a7a9a;font-weight:600;margin-bottom:6px">Есть ли участок?</div>'+
    '<div style="display:flex;gap:5px;margin-bottom:12px">'+
      plotOpts.map(function(o){
        const active=plotVal===o.v;
        return '<button data-a="crm-plot" data-cid="'+c.id+'" data-v="'+o.v+'" style="flex:1;padding:7px 4px;border-radius:8px;border:1.5px solid '+(active?o.c:"#dde6f0")+';background:'+(active?o.c:"#f8fafc")+';color:'+(active?"#fff":"#1a2a3a")+';cursor:pointer;font-size:11px;font-weight:'+(active?"700":"500")+';min-height:36px">'+o.l+'</button>';
      }).join("")+
    '</div>'+
    // Timeline
    '<div style="font-size:11px;color:#5a7a9a;font-weight:600;margin-bottom:6px">Когда планируется покупка?</div>'+
    '<div style="display:flex;flex-direction:column;gap:5px">'+
      timeOpts.map(function(o){
        const active=timeVal===o.v;
        return '<button data-a="crm-timeline" data-cid="'+c.id+'" data-v="'+o.v+'" style="padding:8px 10px;border-radius:8px;border:1.5px solid '+(active?o.c:"#dde6f0")+';background:'+(active?o.c:"#f8fafc")+';color:'+(active?"#fff":"#1a2a3a")+';cursor:pointer;font-size:12px;font-weight:'+(active?"700":"500")+';text-align:left;min-height:36px">'+o.l+'</button>';
      }).join("")+
    '</div>'+
  '</div>';

  // First message — editable
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">'+
    '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:8px">ПЕРВОЕ СООБЩЕНИЕ</div>'+
    '<textarea id="crm-edit-msg-'+c.id+'" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;outline:none;box-sizing:border-box;height:80px;resize:none;border-left:3px solid '+stage.color+'">'+c.msg+'</textarea>'+
    '<button data-a="crm-save-msg" data-cid="'+c.id+'" style="width:100%;margin-top:6px;padding:7px;background:#2980b9;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">💾 Сохранить</button>'+
  '</div>';
  // Notes
  html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">'+
    '<div style="font-size:10px;color:#7a9aaa;font-weight:700;letter-spacing:1px;margin-bottom:8px">ЗАМЕТКИ</div>'+
    '<textarea id="crm-notes-'+c.id+'" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d0dae8;font-size:12px;outline:none;box-sizing:border-box;height:80px;resize:none;background:#f8fafc">'+c.notes+'</textarea>'+
    '<button data-a="crm-save-notes" data-cid="'+c.id+'" style="width:100%;margin-top:8px;padding:8px;background:#27ae60;border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:12px;font-weight:700">💾 Сохранить заметку</button>'+
  '</div>';
  // ── ПЛАНИРОВКИ клиента (из базы) ──
  (function(){
    const attached=(c.planIds||[]).map(function(pid){return dbPlans.find(function(p){return p.id===pid;});}).filter(Boolean);
    html+='<div style="background:#fff;border-radius:12px;border:1px solid #dde6f0;padding:12px 14px;margin-bottom:12px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
        '<div style="font-size:10px;color:#8e44ad;font-weight:700;letter-spacing:1px">📐 ПЛАНИРОВКИ КЛИЕНТУ'+(attached.length?" · "+attached.length:"")+'</div>'+
        '<button data-a="crm-plan-pick" data-cid="'+c.id+'" style="padding:4px 11px;background:#8e44ad;border:none;border-radius:7px;cursor:pointer;font-size:11px;color:#fff;font-weight:700">+ Прикрепить</button>'+
      '</div>';
    // Открытый выбор планировки из базы
    if(crmPlanPickerFor===c.id){
      if(!dbPlans.length){
        html+='<div style="font-size:11px;color:#9aabbf;padding:10px;border:1px dashed #d0dae8;border-radius:8px;margin-bottom:8px">В базе пока нет планировок. Добавьте их в «База данных → Планировки».</div>';
      } else {
        html+='<div style="background:#faf6fd;border:1px solid #8e44ad33;border-radius:10px;padding:8px;margin-bottom:8px">'+
          '<div style="font-size:10px;color:#8e44ad;font-weight:700;margin-bottom:6px">Выберите планировку:</div>'+
          '<div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto">';
        dbPlans.forEach(function(p){
          const on=(c.planIds||[]).includes(p.id);
          html+='<div data-a="crm-plan-toggle" data-cid="'+c.id+'" data-pid="'+p.id+'" style="display:flex;align-items:center;gap:8px;padding:6px;border-radius:8px;cursor:pointer;background:'+(on?"#8e44ad15":"#fff")+';border:1.5px solid '+(on?"#8e44ad":"#e8eef5")+'">'+
            (p.img?'<img src="'+p.img+'" style="width:46px;height:36px;border-radius:5px;object-fit:cover;flex-shrink:0;border:1px solid #e0e6ee">':'<div style="width:46px;height:36px;border-radius:5px;background:#f0f4f8;display:flex;align-items:center;justify-content:center;flex-shrink:0">📐</div>')+
            '<span style="flex:1;min-width:0;font-size:12px;font-weight:600;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(p.name||"Планировка")+'<span style="font-size:9px;color:'+((p.cat||"house")==="banya"?"#e67e22":"#2980b9")+';font-weight:700;margin-left:5px">'+((p.cat||"house")==="banya"?"🛁 баня":"🏠 дом")+'</span></span>'+
            '<span style="font-size:13px;color:'+(on?"#8e44ad":"#c8d8e8")+';font-weight:700;flex-shrink:0">'+(on?"✓":"+")+'</span>'+
          '</div>';
        });
        html+='</div>'+
          '<button data-a="crm-plan-pick-close" style="width:100%;margin-top:8px;padding:6px;background:#f0f4f8;border:none;border-radius:7px;cursor:pointer;font-size:11px;color:#7a9aaa;font-weight:600">Готово</button>'+
        '</div>';
      }
    }
    // Прикреплённые планировки
    if(attached.length){
      html+='<div style="display:flex;flex-direction:column;gap:8px">';
      attached.forEach(function(p){
        html+='<div style="border:1px solid #e8eef5;border-radius:10px;overflow:hidden">'+
          (p.img?'<a href="'+p.img+'" target="_blank" rel="noopener" style="display:block"><img src="'+p.img+'" style="width:100%;max-height:200px;object-fit:contain;background:#f8fafc;display:block"></a>':'')+
          '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px">'+
            '<span style="flex:1;min-width:0;font-size:12px;font-weight:700;color:#1a2a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(p.name||"Планировка")+'</span>'+
            '<button data-a="crm-plan-toggle" data-cid="'+c.id+'" data-pid="'+p.id+'" style="padding:3px 9px;background:transparent;border:1px solid #e74c3c44;border-radius:6px;cursor:pointer;color:#e74c3c;font-size:10px;font-weight:700">Открепить</button>'+
          '</div>'+
        '</div>';
      });
      html+='</div>';
    } else if(crmPlanPickerFor!==c.id){
      html+='<div style="font-size:11px;color:#9aabbf">Планировки не прикреплены</div>';
    }
    html+='</div>';
  })();
  // Delete — admin only
  if(currentUser&&currentUser.roles.includes("admin")){
    html+='<button data-a="crm-delete" data-cid="'+c.id+'" style="width:100%;padding:12px;background:#e74c3c12;border:1.5px solid #e74c3c66;border-radius:10px;cursor:pointer;color:#e74c3c;font-size:13px;font-weight:600;min-height:44px">🗑 Удалить клиента</button>';
  }
  html+='</div>';
  return html;
}

function tCRMInstruction(){
  let html='<div>';
  html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'+
    '<button data-a="crm-back" style="padding:6px 14px;background:transparent;border:1px solid #d0dae8;border-radius:20px;cursor:pointer;font-size:12px;color:#7a9aaa">← CRM</button>'+
    '<div style="font-size:14px;font-weight:700;color:#0d1b2e;flex:1">📋 Инструкция нейропродавца</div>'+
  '</div>';
  html+='<div style="background:#fff;border-radius:14px;border:1px solid #dde6f0;padding:16px;white-space:pre-wrap;font-size:12px;line-height:1.7;color:#2a3a4a;font-family:inherit">'+AI_INSTRUCTION.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';
  html+='</div>';
  return html;
}


function bind(){
  // Defensive: also bind real click listener to all _crmMove buttons (iOS Safari sometimes ignores onclick)
  document.querySelectorAll('[onclick*="_crmMove"]').forEach(function(b){
    if(b._mvBound)return;
    b._mvBound=true;
    b.addEventListener("click",function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      window._crmMove(b,ev);
    },true);
  });
  // Same for stage toggle
  document.querySelectorAll('[onclick*="_crmStageToggle"]').forEach(function(b){
    if(b._stBound)return;
    b._stBound=true;
    b.addEventListener("click",function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      window._crmStageToggle();
    },true);
  });

  // Bind CRM search input (live filtering without re-render)
  const csInp=document.getElementById("crm-search");
  if(csInp&&!csInp._csBound){
    csInp._csBound=true;
    csInp.addEventListener("input",function(){
      crmClientSearch=this.value;
      const raw=this.value.trim().toLowerCase();
      const qPhone=raw.replace(/[\s\-\(\)\+]/g,"");
      let firstMatchWrapper=null;
      let matchCount=0;
      // Stage section headers - hide if no matches in section
      const sectionMap={};
      document.querySelectorAll('[data-a="crm-open"]').forEach(function(inner){
        const cid=inner.dataset.cid;
        const c=crmClients.find(function(x){return x.id===cid;});
        if(!c)return;
        const wrapper=inner.parentElement;
        const name=(c.name||"").toLowerCase();
        const phone=(c.phone||"").toLowerCase().replace(/[\s\-\(\)\+]/g,"");
        const msg=(c.msg||"").toLowerCase();
        const notes=(c.notes||"").toLowerCase();
        const matches=!raw||name.indexOf(raw)>=0||(qPhone&&phone.indexOf(qPhone)>=0)||msg.indexOf(raw)>=0||notes.indexOf(raw)>=0;
        if(wrapper){
          wrapper.style.display=matches?"":"none";
          if(matches){
            matchCount++;
            if(!firstMatchWrapper)firstMatchWrapper=wrapper;
            // Track section (parent of wrapper)
            const section=wrapper.parentElement;
            if(section)sectionMap[section.dataset?.stage||"_"]=section;
          }
        }
      });
      // Update found counter badge
      const badge=document.getElementById("crm-found-badge");
      if(badge){
        if(raw){
          badge.style.display="";
          badge.querySelector("span").textContent=matchCount;
        } else {
          badge.style.display="none";
        }
      }
      // Auto-scroll search input INTO view so user sees results below it
      if(raw&&firstMatchWrapper){
        clearTimeout(csInp._scrollT);
        csInp._scrollT=setTimeout(function(){
          try{
            // Scroll the search input to top so results appear directly below
            csInp.scrollIntoView({behavior:"smooth",block:"start"});
          }catch(e){}
        },300);
      }
    });
  }

  document.querySelectorAll("[data-a]").forEach(el=>{
    const a=el.dataset.a;
    if(a==="login-as"){/* handled by bindLogin */}
    else if(a==="logout"){el.onclick=()=>{try{localStorage.removeItem("kubr_remember");}catch(e){}currentUser=null;loginMode=null;loginPinFor=null;loginPinError="";showPinChange=false;tab="assign";render();};}
    else if(a==="pin-change-open"){el.onclick=()=>{showPinChange=true;render();};}
    else if(a==="pin-change-close"){el.onclick=()=>{showPinChange=false;render();};}
    else if(a==="pin-change-save"){el.onclick=()=>{
      const cur=(document.getElementById("pin-cur")||{}).value||"";
      const n1=(document.getElementById("pin-new")||{}).value||"";
      const n2=(document.getElementById("pin-new2")||{}).value||"";
      function toast(msg,color){
        try{
          const t=document.createElement("div");
          t.textContent=msg;
          t.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:"+(color||"#1a2a3a")+";color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(t);
          setTimeout(function(){try{document.body.removeChild(t);}catch(e){}},2200);
        }catch(e){}
      }
      if(cur!==(currentUser.pin||"1111")){ toast("⚠️ Текущий PIN неверный","#e67e22"); return; }
      if(!/^[0-9]{4,6}$/.test(n1)){ toast("⚠️ Новый PIN — 4–6 цифр","#e67e22"); return; }
      if(n1!==n2){ toast("⚠️ PIN не совпадают","#e67e22"); return; }
      currentUser.pin=n1;
      users=users.map(function(u){return u.id===currentUser.id?Object.assign({},u,{pin:n1}):u;});
      currentUser=users.find(function(u){return u.id===currentUser.id;});
      showPinChange=false;
      toast("✅ PIN изменён","#27ae60");
      render();
    };}
    else if(a==="portal-tab"){el.onclick=()=>{tab=el.dataset.k;render();};}
    else if(a==="tab"){el.onclick=()=>{tab=el.dataset.k;openTemplate=null;openObject=null;render();};}
    // Объекты
    else if(a==="db-tab"){el.onclick=()=>{
      dbSection=el.dataset.dt;
      showNDBWork=false;showNDBMat=null;showNDBPlan=false;
      render();
    };}
    else if(a==="dbmat-search-clear"){el.onclick=()=>{dbMatSearch="";render();};}
    else if(a==="db-plan-tab"){el.onclick=()=>{ dbPlanTab=el.dataset.c; render(); };}
    else if(a==="db-add-plan"){el.onclick=()=>{showNDBPlan=true;dbPlanNew={name:"",img:"",cat:dbPlanTab};render();};}
    else if(a==="db-cancel-plan"){el.onclick=()=>{showNDBPlan=false;dbPlanNew={name:"",img:"",cat:"house"};render();};}
    else if(a==="db-plan-img-clear"){el.onclick=()=>{
      // сохраняем имя из поля
      const nm=document.getElementById("ndbplan-n");
      if(nm)dbPlanNew.name=nm.value;
      dbPlanNew.img="";render();
    };}
    else if(a==="db-plan-img-label"){
      const inp=document.getElementById("ndbplan-img");
      if(inp&&!inp._bound){
        inp._bound=true;
        inp.addEventListener("change",function(){
          const f=(inp.files||[])[0];
          if(!f)return;
          const nm=document.getElementById("ndbplan-n");
          if(nm)dbPlanNew.name=nm.value;
          const reader=new FileReader();
          reader.onload=function(e){ dbPlanNew.img=e.target.result; render(); };
          reader.readAsDataURL(f);
        });
      }
    }
    else if(a==="db-save-plan"){el.onclick=()=>{
      const name=(document.getElementById("ndbplan-n")||{}).value||dbPlanNew.name||"";
      if(!dbPlanNew.img){
        try{
          const toast=document.createElement("div");
          toast.textContent="🖼 Сначала загрузите изображение";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#e67e22;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2200);
        }catch(e){}
        return;
      }
      dbPlans.push({id:gid(),name:name.trim()||"Планировка",img:dbPlanNew.img,cat:dbPlanNew.cat||"house"});
      dbPlanTab=dbPlanNew.cat||"house";
      showNDBPlan=false;dbPlanNew={name:"",img:"",cat:dbPlanTab};fl();
    };}
    else if(a==="db-del-plan"){el.onclick=()=>{
      if(!confirm("Удалить планировку?"))return;
      const pid=el.dataset.pid;
      dbPlans=dbPlans.filter(function(p){return p.id!==pid;});
      // также убрать из прикреплённых у клиентов
      crmClients=crmClients.map(function(c){return Object.assign({},c,{planIds:(c.planIds||[]).filter(function(x){return x!==pid;})});});
      fl();
    };}
    else if(a==="db-add-work"){el.onclick=()=>{showNDBWork=true;render();};}
    else if(a==="db-ndbw-unit-change"){el.onchange=()=>{
      const cu=document.getElementById("ndbw-unit-custom");
      if(cu){ cu.style.display=el.value==="__custom"?"block":"none"; if(el.value==="__custom")cu.focus(); }
    };}
    else if(a==="db-cancel-work"){el.onclick=()=>{showNDBWork=false;render();};}
    else if(a==="db-save-work"){el.onclick=()=>{
      const n=document.getElementById("ndbw-n")?.value?.trim();
      const qty=parseFloat(document.getElementById("ndbw-qty")?.value)||1;
      const unitCost=parseFloat(document.getElementById("ndbw-cost")?.value)||0;
      let unit=document.getElementById("ndbw-unit")?.value||"";
      if(unit==="__custom")unit=(document.getElementById("ndbw-unit-custom")?.value||"").trim();
      const cost=Math.round(qty*unitCost);
      const stage=document.getElementById("ndbw-stage")?.value||"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ";
      if(!n)return;
      // Insert at end of that stage group
      const lastIdx=dbWorks.reduce((acc,w,i)=>w.stage===stage?i:acc,-1);
      const newWork={id:gid(),n:n,unit:unit,qty:qty,unitCost:unitCost,cost:cost,stage:stage,note:"",mats:[]};
      if(lastIdx>=0){ dbWorks.splice(lastIdx+1,0,newWork); }
      else { dbWorks.push(newWork); }
      showNDBWork=false;fl();
    };}
    else if(a==="show-nobj"){el.onclick=()=>{showNObj=true;nobj={name:"",icon:"🛁",templateId:"",assignTo:[]};render();};}
    else if(a==="cancel-nobj"){el.onclick=()=>{showNObj=false;render();};}
    else if(a==="pick-nobj-t"){el.onclick=()=>{nobj.templateId=el.dataset.tid;nobj.name=document.getElementById("nobj-name")?.value||nobj.name;nobj.icon=document.getElementById("nobj-icon")?.value||nobj.icon;render();};}
    else if(a==="toggle-nobj-u"){el.onclick=()=>{const uid=el.dataset.uid;nobj.assignTo=nobj.assignTo.includes(uid)?nobj.assignTo.filter(x=>x!==uid):[...nobj.assignTo,uid];render();};}
    else if(a==="add-obj"){el.onclick=()=>{
      const name=document.getElementById("nobj-name")?.value?.trim();
      const icon=document.getElementById("nobj-icon")?.value||"🏠";
      if(!name||!nobj.templateId)return;
      const tmpl=templates.find(t=>t.id===nobj.templateId);
      const newId=gid();
      objects.push({id:newId,name,icon,templateId:nobj.templateId,stages:deepCopy(tmpl.stages)});
      nobj.assignTo.forEach(uid=>{users=users.map(u=>u.id===uid?{...u,objs:[...u.objs,newId]}:u);});
      showNObj=false;fl();
    };}
    else if(a==="open-obj"){el.onclick=()=>{openObject=el.dataset.oid;render();};}
    else if(a==="close-obj"){el.onclick=()=>{openObject=null;render();};}
    else if(a==="tog-obj"){el.onclick=()=>{const uid=el.dataset.uid,oid=el.dataset.oid;users=users.map(u=>{if(u.id!==uid)return u;const o=u.objs.includes(oid)?u.objs.filter(x=>x!==oid):[...u.objs,oid];return{...u,objs:o};});fl();};}
    else if(a==="tog-user-obj"){el.onclick=()=>{const uid=el.dataset.uid,oid=el.dataset.oid;users=users.map(u=>{if(u.id!==uid)return u;const o=u.objs.includes(oid)?u.objs.filter(x=>x!==oid):[...u.objs,oid];return{...u,objs:o};});fl();};}
    // Шаблоны
    else if(a==="show-nt"){el.onclick=()=>{showNT=true;nt={name:"",icon:"🛁",kind:"banya"};render();};}
    else if(a==="nt-kind"){el.onclick=()=>{nt.kind=el.dataset.k;nt.name=document.getElementById("nt-name")?.value||nt.name;nt.icon=document.getElementById("nt-icon")?.value||nt.icon;render();};}
    else if(a==="cancel-nt"){el.onclick=()=>{showNT=false;render();};}
    else if(a==="add-tpl"){el.onclick=()=>{
      const name=document.getElementById("nt-name")?.value?.trim();
      const icon=document.getElementById("nt-icon")?.value||"🏠";
      if(!name)return;
      const nid=gid();
      templates.push({id:nid,name,icon,kind:(nt.kind||"banya"),stages:[]});
      showNT=false;openTemplate=nid;fl();
    };}
    else if(a==="tpl-mq"){el.oninput=()=>{
      const t=templates.find(x=>x.id===openTemplate);if(!t)return;
      const eid=el.dataset.eid,mid=el.dataset.mid;
      const w=(t.stages||[]).flatMap(s=>s.works||[]).find(x=>x.estId===eid);if(!w)return;
      const m=(w.mats||[]).find(x=>x.id===mid);if(!m)return;
      m.qty=parseFloat(el.value)||0;
      const lt=Math.round((Number(m.cost)||0)*(m.qty||0));
      const lts=document.getElementById("tplm-lt-"+eid+"-"+mid);if(lts)lts.textContent=lt.toLocaleString("ru-RU")+" ₽";
      const sum=(w.mats||[]).reduce((a,mm)=>a+(Number(mm.cost)||0)*(mm.qty||0),0);
      w.cost=(Number(w.labor)||0)+sum;
      const wt=document.getElementById("tplw-t-"+eid);if(wt)wt.textContent=fmt(w.cost);
      const grand=(t.stages||[]).flatMap(s=>s.works||[]).reduce((a,ww)=>a+(ww.cost||0),0);
      const gt=document.getElementById("tpl-grand");if(gt)gt.textContent=fmt(grand);
    };}
    else if(a==="tpl-add-mat-open"){el.onclick=()=>{tplPickFor={eid:el.dataset.eid};tplPickSearch="";render();};}
    else if(a==="tpl-pick-close"){el.onclick=()=>{tplPickFor=null;tplPickSearch="";render();};}
    else if(a==="tpl-pick-mat"){el.onclick=()=>{
      const t=templates.find(x=>x.id===openTemplate);if(!t||!tplPickFor)return;
      const w=(t.stages||[]).flatMap(s=>s.works||[]).find(x=>x.estId===tplPickFor.eid);if(!w)return;
      const p=expProducts.find(x=>x.id===el.dataset.pid);if(!p)return;
      const ex=(w.mats||[]).find(x=>x.n===p.name);
      if(ex){ex.qty=(Number(ex.qty)||0)+1;}else{(w.mats=w.mats||[]).push({id:gid(),n:p.name,store:p.store||"",url:p.url||"",note:"",cost:Number(p.unitCost)||0,qty:1,mode:p.mode||"piece",unitCost:Number(p.unitCost)||0,packBase:p.packBase,packPer:p.packPer,lenPer:p.lenPer,sheetM2:p.sheetM2});}
      w.cost=(Number(w.labor)||0)+(w.mats||[]).reduce((a,m)=>a+(Number(m.cost)||0)*(m.qty||0),0);
      tplPickFor=null;tplPickSearch="";render();
    };}
    else if(a==="tpl-est"){el.onclick=()=>{
      const t=templates.find(x=>x.id===openTemplate);if(!t)return;
      let ids=(t.stages||[]).flatMap(s=>s.works||[]).map(w=>w.estId).filter(Boolean);
      const eid=el.dataset.eid;const i=ids.indexOf(eid);
      if(i>=0)ids.splice(i,1);else ids.push(eid);
      _tplRebuild(t,ids);render();
    };}
    else if(a==="tpl-est-stage"){el.onclick=()=>{
      const t=templates.find(x=>x.id===openTemplate);if(!t)return;
      const tKind=t.kind||"banya";
      let ids=(t.stages||[]).flatMap(s=>s.works||[]).map(w=>w.estId).filter(Boolean);
      const stN=Number(el.dataset.st);
      const stIds=estimates.filter(e=>(e.kind||"banya")===tKind&&(EST_STAGES.find(x=>x.n===Number(e.stage))?Number(e.stage):0)===stN).map(e=>e.id);
      const allSel=stIds.length&&stIds.every(id=>ids.includes(id));
      if(allSel){ids=ids.filter(id=>stIds.indexOf(id)<0);}else{stIds.forEach(id=>{if(ids.indexOf(id)<0)ids.push(id);});}
      _tplRebuild(t,ids);render();
    };}
    else if(a==="open-tpl"){el.onclick=()=>{openTemplate=el.dataset.tid;render();};}
    else if(a==="close-tpl"){el.onclick=()=>{openTemplate=null;render();};}
    else if(a==="del-tpl"){el.onclick=()=>{templates=templates.filter(t=>t.id!==el.dataset.tid);fl();};}
    else if(a==="copy-tpl"){el.onclick=()=>{
      const src=templates.find(t=>t.id===el.dataset.tid);
      if(!src)return;
      const newId=gid();
      // Deep copy stages/works/mats with new ids
      const copyStages=src.stages.map(s=>({
        ...s,id:gid(),
        works:s.works.map(w=>({...w,id:gid(),mats:(w.mats||[]).map(m=>({...m,id:gid()}))}))
      }));
      templates.push({id:newId,name:"Копия — "+src.name,icon:src.icon,stages:copyStages});
      openTemplate=newId;
      fl();
    };}
    // Команда
    else if(a==="supply-toggle"){el.onclick=()=>{
      if(!window._supplySelected)window._supplySelected={};
      window._supplySelected[el.dataset.oid]=!window._supplySelected[el.dataset.oid];
      render();
    };}
    else if(a==="supply-view"){el.onclick=()=>{window._supplyViewing=true;render();};}
    else if(a==="supply-back"){el.onclick=()=>{window._supplyViewing=false;supplySearch='';supplyStoreFilter='';render();};}
    else if(a==="supply-store-filter"){el.onclick=()=>{supplyStoreFilter=supplyStoreFilter===el.dataset.store?'':el.dataset.store;render();};}  
    else if(a==="supply-check"){el.onclick=()=>{
      const mid=el.dataset.mid;
      purchased[mid]=!purchased[mid];
      render();
    };}
    else if(a==="supply-stage-check"){el.onclick=()=>{
      const ids=el.dataset.ids.split(',');
      const allDone=el.dataset.done==="1";
      ids.forEach(function(id){if(id)purchased[id]=!allDone;});
      render();
    };}
    else if(a==="supply-sort"){el.onclick=()=>{window._supplySort=el.dataset.s;render();};}
    else if(a==="supply-edit-mat"){el.onclick=(ev)=>{ev&&ev.stopPropagation();supplyEditMid=el.dataset.mid;render();};}
    else if(a==="supply-mat-close"){el.onclick=()=>{supplyEditMid=null;render();};}
    else if(a==="supply-mat-save"){el.onclick=()=>{
      const mid=supplyEditMid; if(!mid)return;
      const patch={
        n:(document.getElementById("sem-n")?.value||"").trim(),
        mode:document.getElementById("sem-mode")?.value||"piece",
        qty:parseFloat(document.getElementById("sem-qty")?.value)||0,
        cost:parseInt(document.getElementById("sem-cost")?.value)||0,
        store:(document.getElementById("sem-store")?.value||"").trim(),
        note:(document.getElementById("sem-note")?.value||"").trim(),
      };
      objects=objects.map(o=>({...o,stages:(o.stages||[]).map(s=>({...s,works:(s.works||[]).map(w=>({...w,mats:(w.mats||[]).map(m=>m.id===mid?{...m,...patch}:m)}))}))}));
      supplyEditMid=null; render();
    };}
    else if(a==="supply-add-open"){el.onclick=()=>{supplyAddOpen=true;render();};}
    else if(a==="supply-add-close"){el.onclick=()=>{supplyAddOpen=false;render();};}
    else if(a==="supply-add-save"){el.onclick=()=>{
      const tgt=(document.getElementById("sao-target")?.value||"").split("|");
      const oid=tgt[0], wid=tgt[1];
      const n=(document.getElementById("sao-n")?.value||"").trim();
      if(!oid||!wid||!n)return;
      const newMat={
        id:gid(), n:n,
        mode:document.getElementById("sao-mode")?.value||"piece",
        qty:parseFloat(document.getElementById("sao-qty")?.value)||1,
        cost:parseInt(document.getElementById("sao-cost")?.value)||0,
        store:(document.getElementById("sao-store")?.value||"").trim(),
        note:(document.getElementById("sao-note")?.value||"").trim(),
      };
      objects=objects.map(o=>o.id!==oid?o:{...o,stages:o.stages.map(s=>({...s,works:s.works.map(w=>w.id!==wid?w:{...w,mats:[...(w.mats||[]),newMat]})}))});
      supplyAddOpen=false; render();
    };}
    else if(a==="show-nu"){el.onclick=()=>{showNU=true;nu={name:"",av:"👷",c:"#e67e22",roles:[],objs:[]};render();};}
    else if(a==="cancel-nu"){el.onclick=()=>{showNU=false;render();};}
    else if(a==="nu-c"){el.onclick=()=>{nu.c=el.dataset.c;render();};}
    else if(a==="nu-role"){el.onclick=()=>{const rid=el.dataset.rid;nu.roles=nu.roles.includes(rid)?nu.roles.filter(x=>x!==rid):[...nu.roles,rid];render();};}
    else if(a==="add-u"){el.onclick=()=>{const n=document.getElementById("nu-name")?.value?.trim();const av=document.getElementById("nu-av")?.value||"👷";const phone=(document.getElementById("nu-phone")?.value||"").trim();if(!n)return;const pin=(phone.match(/\d/g)||[]).join("").slice(-4);users.push({id:gid(),name:n,av,c:nu.c,roles:[...nu.roles],objs:[],phone:phone,pin:pin||"1111"});showNU=false;fl();};}
    else if(a==="edit-u"){el.onclick=()=>{editU=el.dataset.uid;render();};}
    else if(a==="cancel-eu"){el.onclick=()=>{editU=null;render();};}
    else if(a==="eu-c"){el.onclick=()=>{users=users.map(u=>u.id===el.dataset.uid?{...u,c:el.dataset.c}:u);render();};}
    else if(a==="eu-role"){el.onclick=()=>{const uid=el.dataset.uid,rid=el.dataset.rid;users=users.map(u=>{if(u.id!==uid)return u;const r=u.roles.includes(rid)?u.roles.filter(x=>x!==rid):[...u.roles,rid];return{...u,roles:r};});render();};}
    else if(a==="save-u"){el.onclick=()=>{const uid=el.dataset.uid;const n=document.getElementById("eu-n-"+uid)?.value?.trim();const av=document.getElementById("eu-av-"+uid)?.value;const phone=(document.getElementById("eu-phone-"+uid)?.value||"").trim();const pin=(phone.match(/\d/g)||[]).join("").slice(-4);if(n)users=users.map(u=>u.id===uid?{...u,name:n,av:av||u.av,phone:phone,pin:(pin||u.pin||"1111")}:u);editU=null;fl();};}
    else if(a==="del-u"){el.onclick=()=>{users=users.filter(u=>u.id!==el.dataset.uid);fl();};}
    else if(a==="show-nr"){el.onclick=()=>{showNR=true;nr={n:"",c:"#9b59b6",group:"other"};render();};}
    else if(a==="cancel-nr"){el.onclick=()=>{showNR=false;render();};}
    else if(a==="nr-group"){el.onclick=()=>{nr.group=el.dataset.g;render();};}
    else if(a==="er-group"){el.onclick=()=>{const rid=el.dataset.rid;const g=el.dataset.g;roles=roles.map(r=>r.id===rid?Object.assign({},r,{group:g}):r);fl();};}
    else if(a==="er-perm"){el.onclick=()=>{
      // Только администратор может менять разрешения; роль admin не настраивается
      if(!currentUser||!currentUser.roles.includes("admin"))return;
      const rid=el.dataset.rid, k=el.dataset.k;
      if(rid==="admin")return;
      const cur=rolePermissions[rid]||[];
      rolePermissions[rid]=cur.includes(k)?cur.filter(function(x){return x!==k;}):cur.concat([k]);
      fl();
    };}
    else if(a==="nr-c"){el.onclick=()=>{nr.c=el.dataset.c;render();};}
    else if(a==="add-r"){el.onclick=()=>{const n=document.getElementById("nr-n")?.value?.trim();if(!n)return;roles.push({id:gid(),n,c:nr.c,group:nr.group||"other"});showNR=false;fl();};}
    else if(a==="edit-r"){el.onclick=()=>{editR=el.dataset.rid;render();};}
    else if(a==="cancel-er"){el.onclick=()=>{editR=null;render();};}
    else if(a==="er-c"){el.onclick=()=>{roles=roles.map(r=>r.id===el.dataset.rid?{...r,c:el.dataset.c}:r);render();};}
    else if(a==="save-r"){el.onclick=()=>{const rid=el.dataset.rid;const n=document.getElementById("er-n-"+rid)?.value?.trim();if(n)roles=roles.map(r=>r.id===rid?{...r,n}:r);editR=null;fl();};}
    else if(a==="del-r"){el.onclick=()=>{const rid=el.dataset.rid;roles=roles.filter(r=>r.id!==rid);users=users.map(u=>({...u,roles:u.roles.filter(r=>r!==rid)}));fl();};}
    // ── CRM ──────────────────────────────────────────────
    else if(a==="fin-toggle-select"){el.onclick=(ev)=>{
      if(ev&&ev.stopPropagation)ev.stopPropagation();
      const cid=el.dataset.cid;
      const idx=finSelectedContractIds.indexOf(cid);
      if(idx>=0)finSelectedContractIds.splice(idx,1);
      else finSelectedContractIds.push(cid);
      render();
    };}
    else if(a==="fin-clear-selection"){el.onclick=()=>{finSelectedContractIds=[];render();};}
    else if(a==="ew-plan-add"){el.onclick=function(){
      const cid=el.dataset.cid;
      const ti=document.getElementById("ew-plan-title-"+cid);
      const ai=document.getElementById("ew-plan-amount-"+cid);
      const title=(ti?ti.value:"").trim();
      const amount=unfmtMoney(ai?ai.value:"");
      if(!title){alert("Укажите название работы");return;}
      if(!amount){alert("Укажите сумму");return;}
      contractDocs=contractDocs.map(function(c){
        if(c.id!==cid)return c;
        const newItem={id:gid(),title,amount};
        return Object.assign({},c,{extraWorksPlan:(c.extraWorksPlan||[]).concat([newItem])});
      });
      fl();
    };}
    else if(a==="ew-plan-del"){el.onclick=function(){
      const cid=el.dataset.cid, wid=el.dataset.wid;
      contractDocs=contractDocs.map(function(c){
        if(c.id!==cid)return c;
        return Object.assign({},c,{extraWorksPlan:(c.extraWorksPlan||[]).filter(function(w){return w.id!==wid;})});
      });
      fl();
    };}
    else if(a==="sal-save-plan"){el.onclick=()=>{
      const cid=el.dataset.cid, uid=el.dataset.uid;
      const inp=document.getElementById("sal-plan-"+cid+"-"+uid);
      const newPlan=unfmtMoney((inp||{}).value);
      contractDocs=contractDocs.map(function(c){
        if(c.id!==cid)return c;
        const sals=Object.assign({},c.salaries||{});
        sals[uid]=Object.assign({plan:0,paid:0},sals[uid]||{},{plan:newPlan});
        return Object.assign({},c,{salaries:sals});
      });
      fl();
    };}
    else if(a==="fin-mode"){el.onclick=()=>{finMode=el.dataset.mode;render();};}
    else if(a==="bdds-view"){el.onclick=()=>{bddsView=el.dataset.v;render();};}
    else if(a==="fin-open"){el.onclick=()=>{
      finOpenContractId=el.dataset.cid||null;
      finOpenObjId=el.dataset.oid;
      finAddForm=false;
      render();
    };}
    else if(a==="fin-back"){el.onclick=()=>{finOpenObjId=null;finOpenContractId=null;finAddForm=false;render();};}
    else if(a==="fin-add"){el.onclick=()=>{finAddForm=!finAddForm;finNewTxn={type:"income",category:FIN_INCOME_CATS[0],amount:"",date:new Date().toISOString().slice(0,10),note:"",method:"transfer"};render();};}
    else if(a==="fin-add-typed"){el.onclick=()=>{
      const type=el.dataset.type||"income";
      const cat=el.dataset.cat||(type==="income"?FIN_INCOME_CATS[0]:FIN_EXPENSE_CATS[0]);
      const sectionGroup=type==="income"?"income":txnCategoryGroup(cat);
      // Toggle: if already open in this section, close it
      if(finAddForm&&finNewTxn.sectionGroup===sectionGroup){
        finAddForm=false;
        render();
        return;
      }
      finAddForm=true;
      finNewTxn={type,category:cat,amount:"",date:new Date().toISOString().slice(0,10),note:"",sectionGroup,method:"transfer"};
      render();
      setTimeout(function(){
        const anchor=document.getElementById("fin-form-anchor");
        if(anchor){
          try{anchor.scrollIntoView({behavior:"smooth",block:"center"});}catch(e){}
        }
      },50);
    };}
    else if(a==="fin-type"){el.onclick=()=>{
      finNewTxn.type=el.dataset.t;
      let cats=finNewTxn.type==="income"?FIN_INCOME_CATS:FIN_EXPENSE_CATS;
    if(finNewTxn.type==="expense"&&finNewTxn.sectionGroup){
      const g=finNewTxn.sectionGroup;
      cats=cats.filter(function(c){return txnCategoryGroup(c)===g;});
      if(!cats.length)cats=FIN_EXPENSE_CATS;
    }
      finNewTxn.category=cats[0];
      render();
    };}
    else if(a==="fin-cancel-add"){el.onclick=()=>{finAddForm=false;render();};}
    else if(a==="fin-type"){el.onclick=()=>{
      finNewTxn.type=el.dataset.t;
      let cats=finNewTxn.type==="income"?FIN_INCOME_CATS:FIN_EXPENSE_CATS;
    if(finNewTxn.type==="expense"&&finNewTxn.sectionGroup){
      const g=finNewTxn.sectionGroup;
      cats=cats.filter(function(c){return txnCategoryGroup(c)===g;});
      if(!cats.length)cats=FIN_EXPENSE_CATS;
    }
      finNewTxn.category=cats[0];
      render();
    };}
    else if(a==="cleanup-toggle"){el.onclick=()=>{const cid=el.dataset.cid;cleanupExpanded[cid]=!cleanupExpanded[cid];render();};}
    else if(a==="fin-method"){el.onclick=()=>{
      finNewTxn.method=el.dataset.m;
      document.querySelectorAll("[data-a='fin-method']").forEach(function(b){
        const on=b.dataset.m===finNewTxn.method;
        const color=b.dataset.m==="cash"?"#16a085":"#2980b9";
        b.style.borderColor=on?color:"#dde6f0";
        b.style.background=on?color:"#f8fafc";
        b.style.color=on?"#fff":"#7a9aaa";
      });
    };}
    else if(a==="fin-save-txn"){el.onclick=()=>{
      const oid=el.dataset.oid;
      const cat=(document.getElementById("fin-cat")||{}).value||finNewTxn.category;
      const amt=unfmtMoney((document.getElementById("fin-amt")||{}).value);
      const date=(document.getElementById("fin-date")||{}).value||finNewTxn.date;
      const note=(document.getElementById("fin-note")||{}).value||"";
      if(!amt)return;
      finTxns.push({id:gid(),objId:oid,type:finNewTxn.type,category:cat,amount:amt,date,note,method:finNewTxn.type==="income"?(finNewTxn.method||"transfer"):undefined});
      finAddForm=false;fl();
    };}
    else if(a==="ct-add"){el.onclick=()=>{contractAddForm=!contractAddForm;contractNew={objId:"",type:"main",name:"",amount:"",signDate:new Date().toISOString().slice(0,10),client:"",status:"draft",note:"",deadlineDate:"",extraWorks:[],files:[]};render();};}
    else if(a==="ct-cancel"){el.onclick=()=>{contractAddForm=false;render();};}
    else if(a==="ct-new-file-label"){
      const kind=el.dataset.kind;
      const inp=document.getElementById("ct-new-file-inp-"+kind);
      if(inp&&!inp._bound){
        inp._bound=true;
        inp.addEventListener("change",function(){
          const files=Array.from(inp.files||[]);
          if(!files.length)return;
          let processed=0;
          const added=[];
          files.forEach(function(f){
            const reader=new FileReader();
            reader.onload=function(e){
              added.push({id:gid(),kind:kind,name:f.name,data:e.target.result,mime:f.type||"",size:f.size,date:new Date().toISOString().slice(0,16).replace("T"," ")});
              processed++;
              if(processed===files.length){
                contractNew.files=(contractNew.files||[]).concat(added);
                render();
              }
            };
            reader.readAsDataURL(f);
          });
        });
      }
    }
    else if(a==="ct-new-file-del"){el.onclick=()=>{
      const fid=el.dataset.fid;
      contractNew.files=(contractNew.files||[]).filter(function(f){return f.id!==fid;});
      render();
    };}
    else if(a==="ct-obj-change"){el.onchange=()=>{contractNew.objId=el.value;};}
    else if(a==="ct-new-ew-add"){el.onclick=()=>{
      const obj=objects.find(function(o){return o.id===contractNew.objId;});
      const stageName=obj&&obj.stages[0]?obj.stages[0].name:"Доп.";
      contractNew.extraWorks=(contractNew.extraWorks||[]).concat([{id:gid(),name:"Новая работа",stage:stageName,cost:0,mats:[]}]);
      render();
    };}
    else if(a==="ct-new-ew-del"){el.onclick=()=>{
      const ewi=parseInt(el.dataset.ewi);
      if(!confirm("Удалить работу?"))return;
      contractNew.extraWorks=(contractNew.extraWorks||[]).filter(function(_,i){return i!==ewi;});
      render();
    };}
    else if(a==="ct-new-ew-save"){el.onclick=()=>{
      const ewi=parseInt(el.dataset.ewi);
      const cost=unfmtMoney((document.getElementById("ct-new-ew-cost-"+ewi)||{}).value);
      const newName=prompt("Название работы:",(contractNew.extraWorks||[])[ewi]?.name||"Работа");
      if(newName===null)return;
      const ews=(contractNew.extraWorks||[]).slice();
      if(ews[ewi])ews[ewi]=Object.assign({},ews[ewi],{cost,name:newName||ews[ewi].name});
      contractNew.extraWorks=ews;
      fl();
    };}
    else if(a==="ct-new-ewm-add"){el.onclick=()=>{
      const ewi=parseInt(el.dataset.ewi);
      ctMatPicker={cid:"__new",ewi,search:""};
      render();
    };}
    else if(a==="ct-new-ewm-save"){el.onclick=()=>{
      const ewi=parseInt(el.dataset.ewi),mi=parseInt(el.dataset.mi);
      const qty=parseFloat((document.getElementById("ct-new-ewm-qty-"+ewi+"-"+mi)||{}).value)||1;
      const cost=unfmtMoney((document.getElementById("ct-new-ewm-cost-"+ewi+"-"+mi)||{}).value);
      const ews=(contractNew.extraWorks||[]).slice();
      if(ews[ewi]&&ews[ewi].mats&&ews[ewi].mats[mi]){
        const mats=ews[ewi].mats.slice();
        mats[mi]=Object.assign({},mats[mi],{qty,cost});
        ews[ewi]=Object.assign({},ews[ewi],{mats});
      }
      contractNew.extraWorks=ews;
      fl();
    };}
    else if(a==="ct-new-ewm-del"){el.onclick=()=>{
      const ewi=parseInt(el.dataset.ewi),mi=parseInt(el.dataset.mi);
      const ews=(contractNew.extraWorks||[]).slice();
      if(ews[ewi]&&ews[ewi].mats){
        ews[ewi]=Object.assign({},ews[ewi],{mats:ews[ewi].mats.filter(function(_,i){return i!==mi;})});
      }
      contractNew.extraWorks=ews;
      fl();
    };}
    else if(a==="ct-type"){el.onclick=()=>{contractNew.type=el.dataset.t;render();};}
    else if(a==="ct-save"){el.onclick=()=>{
      let name=(document.getElementById("ct-name")||{}).value||"";
      const client=contractNew.client||(document.getElementById("ct-client")||{}).value||"";
      const amtVal=(document.getElementById("ct-amount")||{}).value||"";
      const amount=unfmtMoney(amtVal)||contractNew.amount||0;
      const date=(document.getElementById("ct-date")||{}).value||contractNew.signDate||new Date().toISOString().slice(0,10);
      const note=(document.getElementById("ct-note")||{}).value||"";
      const deadlineDate=(document.getElementById("ct-deadline")||{}).value||contractNew.deadlineDate||"";
      let objId=(document.getElementById("ct-obj")||{}).value||contractNew.objId||"";
      // Объект необязателен — договор без объекта создаётся как черновик
      // Auto-generate name if empty
      if(!name.trim()){
        const obj=objects.find(function(o){return o.id===objId;});
        const num=contractDocs.length+47;
        name=obj?("Договор №"+num+" — "+obj.name):("Договор №"+num);
      }
      const cl=crmClients.find(function(c){return c.name===client;});
      const crmClientId=cl?cl.id:"";
      const escortIds=users.filter(function(u){return u.roles.includes("contract_mgr");}).map(function(u){return u.id;});
      contractDocs.push({id:gid(),objId,type:contractNew.type,name:name.trim(),amount,signDate:date,deadlineDate,client,status:"draft",note,crmClientId,responsible:escortIds,salaries:{},extraWorks:contractNew.extraWorks||[],files:contractNew.files||[]});
      contractAddForm=false;
      contractNew={objId:"",type:"main",name:"",amount:"",signDate:new Date().toISOString().slice(0,10),client:"",status:"draft",note:"",deadlineDate:"",extraWorks:[],files:[]};
      fl();
    };}
    else if(a==="ct-open"){el.onclick=()=>{contractView=el.dataset.cid;render();};}
    else if(a==="ct-back"){el.onclick=()=>{contractView=null;render();};}
    else if(a==="ct-status"){el.onclick=()=>{
      const cid=el.dataset.cid,s=el.dataset.s;
      const c=contractDocs.find(function(x){return x.id===cid;});
      // Подписать/закрыть можно только с привязанным объектом
      if((s==="signed"||s==="closed")&&c&&!c.objId){
        try{
          const toast=document.createElement("div");
          toast.innerHTML="⚠️ Сначала привяжите объект<br><span style='font-size:10px;opacity:0.85;font-weight:500'>Договор без объекта остаётся черновиком</span>";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#e67e22;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;text-align:center;line-height:1.4;box-shadow:0 4px 16px rgba(230,126,34,0.4)";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2600);
        }catch(e){}
        return;
      }
      contractDocs=contractDocs.map(function(c){return c.id===cid?Object.assign({},c,{status:s}):c;});
      fl();
    };}
    else if(a==="ct-pick-client"){/* handled by window._ctPick */}
    else if(a==="ct-goto-crm"){el.onclick=()=>{
      const crmid=el.dataset.crmid;
      tab="crm"; crmView="client"; crmOpenId=crmid; render();
    };}
    else if(a==="ct-edit-toggle"){el.onclick=()=>{contractEditId=contractEditId===el.dataset.cid?null:el.dataset.cid;render();};}
    else if(a==="ct-edit-type"){el.onclick=()=>{
      const cid=el.dataset.cid,t=el.dataset.t;
      contractDocs=contractDocs.map(function(c){return c.id===cid?Object.assign({},c,{type:t}):c;});
      render();
    };}
    else if(a==="ct-edit-save"){el.onclick=()=>{
      const cid=el.dataset.cid;
      const name=(document.getElementById("ct-edit-name")||{}).value||"";
      const client=(document.getElementById("ct-edit-client-sel")||{}).value||(document.getElementById("ct-edit-client")||{}).value||"";
      const amount=unfmtMoney((document.getElementById("ct-edit-amount")||{}).value);
      const date=(document.getElementById("ct-edit-date")||{}).value||"";
      const deadlineDate=(document.getElementById("ct-edit-deadline")||{}).value||"";
      const note=(document.getElementById("ct-edit-note")||{}).value||"";
      const objId=(document.getElementById("ct-edit-obj")||{}).value||"";
      contractDocs=contractDocs.map(function(c){return c.id===cid?Object.assign({},c,{name:name.trim()||c.name,client,amount,signDate:date,deadlineDate,note,objId}):c;});
      contractEditId=null;fl();
    };}
    else if(a==="ct-resp-toggle"){el.onclick=()=>{
      const cid=el.dataset.cid, uid=el.dataset.uid;
      contractDocs=contractDocs.map(function(c){
        if(c.id!==cid)return c;
        const r=c.responsible||[];
        return Object.assign({},c,{responsible:r.includes(uid)?r.filter(function(x){return x!==uid;}):r.concat([uid])});
      });
      fl();
    };}
    else if(a==="ct-sal-save"){el.onclick=()=>{
      const cid=el.dataset.cid, uid=el.dataset.uid;
      const plan=unfmtMoney((document.getElementById("ctsal-plan-"+cid+"-"+uid)||{}).value);
      contractDocs=contractDocs.map(function(c){
        if(c.id!==cid)return c;
        const sal=Object.assign({},c.salaries||{});
        const existing=sal[uid]||{};
        sal[uid]=Object.assign({},existing,{plan});  // keep any legacy paid field if present
        return Object.assign({},c,{salaries:sal});
      });
      fl();
    };}
    else if(a==="ct-extra-add"){el.onclick=()=>{
      const cid=el.dataset.cid;
      const c=contractDocs.find(function(x){return x.id===cid;});
      if(!c)return;
      const obj=objects.find(function(o){return o.id===c.objId;});
      const stageName=obj&&obj.stages[0]?obj.stages[0].name:"Доп.";
      const newWork={id:gid(),name:"Новая работа",stage:stageName,cost:0,mats:[]};
      contractDocs=contractDocs.map(function(x){
        if(x.id!==cid)return x;
        return Object.assign({},x,{extraWorks:(x.extraWorks||[]).concat([newWork])});
      });
      fl();
    };}
    else if(a==="ct-extra-del"){el.onclick=()=>{
      const cid=el.dataset.cid,ewi=parseInt(el.dataset.ewi);
      if(!confirm("Удалить работу?"))return;
      contractDocs=contractDocs.map(function(x){
        if(x.id!==cid)return x;
        const ew=(x.extraWorks||[]).filter(function(_,i){return i!==ewi;});
        return Object.assign({},x,{extraWorks:ew});
      });
      fl();
    };}
    else if(a==="ct-ew-save"){el.onclick=()=>{
      const cid=el.dataset.cid,ewi=parseInt(el.dataset.ewi);
      const cost=unfmtMoney((document.getElementById("ct-ew-cost-"+cid+"-"+ewi)||{}).value);
      const newName=prompt("Название работы:",((contractDocs.find(function(x){return x.id===cid;})||{}).extraWorks||[])[ewi]?.name||"Работа");
      if(newName===null)return;
      contractDocs=contractDocs.map(function(x){
        if(x.id!==cid)return x;
        const ew=(x.extraWorks||[]).slice();
        if(ew[ewi])ew[ewi]=Object.assign({},ew[ewi],{cost,name:newName||ew[ewi].name});
        return Object.assign({},x,{extraWorks:ew});
      });
      fl();
    };}
    else if(a==="ct-ewm-add"){el.onclick=()=>{
      ctMatPicker={cid:el.dataset.cid,ewi:parseInt(el.dataset.ewi),search:""};
      render();
    };}
    else if(a==="ct-mat-pick"){el.onclick=()=>{
      const mid=el.dataset.mid;
      if(!ctMatPicker)return;
      const objId=ctMatPicker.cid==="__new"?contractNew.objId:(contractDocs.find(function(x){return x.id===ctMatPicker.cid;})||{}).objId;
      const obj=objects.find(function(o){return o.id===objId;});
      if(!obj){ctMatPicker=null;render();return;}
      const allMats=obj.stages.flatMap(function(s){return s.works.flatMap(function(w){return w.mats||[];});});
      const uniqMap={};
      allMats.forEach(function(m){if(!uniqMap[m.id])uniqMap[m.id]=m;});
      const m=uniqMap[mid];
      if(!m){ctMatPicker=null;render();return;}
      const ewi=ctMatPicker.ewi;
      if(ctMatPicker.cid==="__new"){
        // Add to contractNew
        const ews=(contractNew.extraWorks||[]).slice();
        if(ews[ewi])ews[ewi]=Object.assign({},ews[ewi],{mats:(ews[ewi].mats||[]).concat([{id:gid(),name:m.name,cost:m.cost,qty:1}])});
        contractNew.extraWorks=ews;
      } else {
        const cid=ctMatPicker.cid;
        contractDocs=contractDocs.map(function(x){
          if(x.id!==cid)return x;
          const ew=(x.extraWorks||[]).slice();
          if(ew[ewi])ew[ewi]=Object.assign({},ew[ewi],{mats:(ew[ewi].mats||[]).concat([{id:gid(),name:m.name,cost:m.cost,qty:1}])});
          return Object.assign({},x,{extraWorks:ew});
        });
      }
      ctMatPicker=null;
      fl();
    };}
    else if(a==="ct-mat-close"){el.onclick=()=>{ctMatPicker=null;render();};}
    else if(a==="ct-ewm-save"){el.onclick=()=>{
      const cid=el.dataset.cid,ewi=parseInt(el.dataset.ewi),mi=parseInt(el.dataset.mi);
      const qty=parseFloat((document.getElementById("ct-ewm-qty-"+cid+"-"+ewi+"-"+mi)||{}).value)||1;
      const cost=unfmtMoney((document.getElementById("ct-ewm-cost-"+cid+"-"+ewi+"-"+mi)||{}).value);
      contractDocs=contractDocs.map(function(x){
        if(x.id!==cid)return x;
        const ew=(x.extraWorks||[]).slice();
        if(ew[ewi]&&ew[ewi].mats&&ew[ewi].mats[mi]){
          const mats=ew[ewi].mats.slice();
          mats[mi]=Object.assign({},mats[mi],{qty,cost});
          ew[ewi]=Object.assign({},ew[ewi],{mats});
        }
        return Object.assign({},x,{extraWorks:ew});
      });
      fl();
    };}
    else if(a==="ct-ewm-del"){el.onclick=()=>{
      const cid=el.dataset.cid,ewi=parseInt(el.dataset.ewi),mi=parseInt(el.dataset.mi);
      contractDocs=contractDocs.map(function(x){
        if(x.id!==cid)return x;
        const ew=(x.extraWorks||[]).slice();
        if(ew[ewi]&&ew[ewi].mats){
          ew[ewi]=Object.assign({},ew[ewi],{mats:ew[ewi].mats.filter(function(_,i){return i!==mi;})});
        }
        return Object.assign({},x,{extraWorks:ew});
      });
      fl();
    };}
    else if(a==="ct-clientpin-save"){el.onclick=()=>{
      const cid=el.dataset.cid;
      const v=((document.getElementById("ct-clientpin-"+cid)||{}).value||"").trim();
      if(v&&!/^[0-9]{4,6}$/.test(v)){
        try{const t=document.createElement("div");t.textContent="⚠️ PIN — 4–6 цифр";t.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#e67e22;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";document.body.appendChild(t);setTimeout(function(){try{document.body.removeChild(t);}catch(e){}},2200);}catch(e){}
        return;
      }
      contractDocs=contractDocs.map(function(c){return c.id===cid?Object.assign({},c,{clientPin:v}):c;});
      fl();
    };}
    else if(a==="ct-clientpin-reset"){el.onclick=()=>{
      const cid=el.dataset.cid;
      contractDocs=contractDocs.map(function(c){return c.id===cid?Object.assign({},c,{clientPin:""}):c;});
      fl();
    };}
    else if(a==="ct-delete"){el.onclick=()=>{
      if(!confirm("Удалить договор?"))return;
      contractDocs=contractDocs.filter(function(c){return c.id!==el.dataset.cid;});
      contractView=null;fl();
    };}
    else if(a==="ct-file-label"){
      const cid=el.dataset.cid, kind=el.dataset.kind;
      const inp=document.getElementById("ct-file-inp-"+cid+"-"+kind);
      if(inp&&!inp._bound){
        inp._bound=true;
        inp.addEventListener("change",function(){
          const files=Array.from(inp.files||[]);
          if(!files.length)return;
          let processed=0;
          const added=[];
          files.forEach(function(f){
            const reader=new FileReader();
            reader.onload=function(e){
              added.push({id:gid(),kind:kind,name:f.name,data:e.target.result,mime:f.type||"",size:f.size,date:new Date().toISOString().slice(0,16).replace("T"," ")});
              processed++;
              if(processed===files.length){
                contractDocs=contractDocs.map(function(c){
                  if(c.id!==cid)return c;
                  return Object.assign({},c,{files:(c.files||[]).concat(added)});
                });
                try{
                  const toast=document.createElement("div");
                  toast.textContent="📎 Прикреплено файлов: "+added.length;
                  toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#2980b9;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
                  document.body.appendChild(toast);
                  setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
                }catch(e){}
                fl();
              }
            };
            reader.readAsDataURL(f);
          });
        });
      }
    }
    else if(a==="ct-file-del"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const cid=el.dataset.cid, fid=el.dataset.fid;
        contractDocs=contractDocs.map(function(c){
          if(c.id!==cid)return c;
          return Object.assign({},c,{files:(c.files||[]).filter(function(f){return f.id!==fid;})});
        });
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="sal-save"){el.onclick=()=>{
      const oid=el.dataset.oid, uid=el.dataset.uid;
      const plan=unfmtMoney((document.getElementById("sal-plan-"+oid+"-"+uid)||{}).value);
      const paid=unfmtMoney((document.getElementById("sal-paid-"+oid+"-"+uid)||{}).value);
      if(!finSalaries[oid])finSalaries[oid]={};
      finSalaries[oid][uid]={plan,paid};
      fl();
    };}
    else if(a==="fin-edit-contract"){el.onclick=()=>{
      const oid=el.dataset.oid;
      const cur=finContracts[oid]||0;
      const v=prompt("Сумма договора (₽):",cur);
      if(v===null)return;
      const amt=parseInt(v)||0;
      finContracts[oid]=amt;
      fl();
    };}
    else if(a==="fin-add-extra"){el.onclick=()=>{
      const oid=el.dataset.oid;
      const name=prompt("Название доп. работы:");
      if(!name)return;
      const amt=parseInt(prompt("Сумма ₽:"))||0;
      if(!amt)return;
      const date=prompt("Дата (ГГГГ-ММ-ДД):",new Date().toISOString().slice(0,10))||new Date().toISOString().slice(0,10);
      const note=prompt("Примечание (необязательно):")||"";
      if(!finExtraWorks[oid])finExtraWorks[oid]=[];
      finExtraWorks[oid].push({id:gid(),name,amount:amt,date,note});
      fl();
    };}
    else if(a==="fin-del-extra"){el.onclick=()=>{
      const oid=el.dataset.oid,eid=el.dataset.eid;
      if(!confirm("Удалить доп. работу?"))return;
      if(finExtraWorks[oid])finExtraWorks[oid]=finExtraWorks[oid].filter(function(w){return w.id!==eid;});
      fl();
    };}
    else if(a==="fin-del-txn"||a==="fin-del"){
      // Use addEventListener with capture phase so we run before any parent handlers
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const tid=el.dataset.tid;
        if(!tid)return false;
        finTxns=finTxns.filter(function(t){return t.id!==tid;});
        // Visual feedback
        try{
          const toast=document.createElement("div");
          toast.textContent="🗑 Транзакция удалена";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a2a3a;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      // Also use addEventListener as backup (capture phase to beat any parent)
      el.addEventListener("click",handler,true);
      // Also handle touchend for iOS reliability
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="fin-save"){el.onclick=()=>{
      const cid=el.dataset.cid||finOpenContractId||"";
      const cat=(document.getElementById("fin-cat")||{}).value||finNewTxn.category;
      const amt=unfmtMoney((document.getElementById("fin-amt")||{}).value);
      const date=(document.getElementById("fin-date")||{}).value||new Date().toISOString().slice(0,10);
      const note=(document.getElementById("fin-note")||{}).value||"";
      if(!amt){alert("Введите сумму");return;}
      const objId=cid?(contractDocs.find(function(x){return x.id===cid;})||{}).objId:finOpenObjId;
      finTxns.push({id:gid(),type:finNewTxn.type,category:cat,amount:amt,date,note,objId,contractId:cid,method:finNewTxn.type==="income"?(finNewTxn.method||"transfer"):undefined});
      finAddForm=false;
      fl();
    };}
    else if(a==="crm-filter-stage"){el.onclick=()=>{crmStageFilter=crmStageFilter===el.dataset.sid?null:el.dataset.sid;render();};}
    else if(a==="crm-clear-filter"){el.onclick=()=>{crmStageFilter=null;render();};}
    else if(a==="crm-search-clear"){el.onclick=()=>{crmClientSearch="";render();};}
    else if(a==="crm-add"){el.onclick=()=>{crmAddForm=!crmAddForm;render();};}
    else if(a==="crm-cancel-new"){el.onclick=()=>{crmAddForm=false;render();};}
    else if(a==="crm-save-new"){el.onclick=()=>{
      const name=(document.getElementById("crm-n")||{}).value||"";
      const phone=(document.getElementById("crm-p")||{}).value||"";
      const msg=(document.getElementById("crm-m")||{}).value||"";
      if(!name.trim())return;
      crmClients.push({id:gid(),name:name.trim(),phone,source:"Авито",stage:"new",msg,date:new Date().toISOString().slice(0,10),notes:""});
      crmAddForm=false;fl();
    };}
    else if(a==="analysis-obj"){el.onclick=()=>{analysisObjId=el.dataset.oid;render();};}
    else if(a==="mgr-client-open"){el.onclick=()=>{mgrClientView=el.dataset.cid;mgrClientTab="objects";render();};}
    else if(a==="mgr-client-back"){el.onclick=()=>{mgrClientView=null;render();};}
    else if(a==="mgr-client-tab"){el.onclick=()=>{mgrClientTab=el.dataset.t;render();};}
    else if(a==="crm-open"){el.onclick=()=>{
      crmOpenId=el.dataset.cid;
      crmView="client";
      crmStagePickerOpen=false; // reset stage picker
      render();
      // Scroll to top so user starts from header, not bottom
      setTimeout(function(){
        try{window.scrollTo({top:0,behavior:"instant"});}catch(e){window.scrollTo(0,0);}
      },0);
    };}
    else if(a==="crm-back"){el.onclick=()=>{
      crmView="funnel";
      crmOpenId=null;
      render();
      setTimeout(function(){
        try{window.scrollTo({top:0,behavior:"instant"});}catch(e){window.scrollTo(0,0);}
      },0);
    };}
    else if(a==="crm-stage"){el.onclick=()=>{
      const cid=el.dataset.cid,sid=el.dataset.sid;
      crmClients=crmClients.map(function(c){return c.id===cid?Object.assign({},c,{stage:sid}):c;});
      crmStagePickerOpen=false;
      fl();
    };}
    else if(a==="crm-plot"){el.onclick=()=>{
      const cid=el.dataset.cid,v=el.dataset.v;
      crmClients=crmClients.map(function(c){return c.id===cid?Object.assign({},c,{plot:v}):c;});
      fl();
    };}
    else if(a==="crm-timeline"){el.onclick=()=>{
      const cid=el.dataset.cid,v=el.dataset.v;
      crmClients=crmClients.map(function(c){return c.id===cid?Object.assign({},c,{timeline:v}):c;});
      fl();
    };}
    else if(a==="crm-save-contact"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const cid=el.dataset.cid;
        if(!cid)return false;
        const name=((document.getElementById("crm-edit-name-"+cid)||{}).value||"").trim();
        const phone=(document.getElementById("crm-edit-phone-"+cid)||{}).value||"";
        const source=(document.getElementById("crm-edit-source-"+cid)||{}).value||"";
        crmClients=crmClients.map(function(c){return c.id===cid?Object.assign({},c,{name:name||c.name,phone:phone,source:source}):c;});
        try{
          const toast=document.createElement("div");
          toast.textContent="💾 Контакт сохранён";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#27ae60;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="crm-save-msg"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const cid=el.dataset.cid;
        if(!cid)return false;
        const inp=document.getElementById("crm-edit-msg-"+cid);
        const msg=inp?inp.value:"";
        crmClients=crmClients.map(function(c){return c.id===cid?Object.assign({},c,{msg:msg}):c;});
        try{
          const toast=document.createElement("div");
          toast.textContent="💾 Сообщение сохранено";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#27ae60;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="crm-save-notes"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const cid=el.dataset.cid;
        if(!cid)return false;
        const inp=document.getElementById("crm-notes-"+cid);
        const notes=inp?inp.value:"";
        crmClients=crmClients.map(function(c){return c.id===cid?Object.assign({},c,{notes:notes}):c;});
        try{
          const toast=document.createElement("div");
          toast.textContent="💾 Заметка сохранена";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#27ae60;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(39,174,96,0.4)";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="crm-plan-pick"){el.onclick=()=>{ crmPlanPickerFor=el.dataset.cid; render(); };}
    else if(a==="crm-plan-pick-close"){el.onclick=()=>{ crmPlanPickerFor=null; render(); };}
    else if(a==="crm-plan-toggle"){el.onclick=()=>{
      const cid=el.dataset.cid, pid=el.dataset.pid;
      crmClients=crmClients.map(function(c){
        if(c.id!==cid)return c;
        const cur=c.planIds||[];
        const next=cur.includes(pid)?cur.filter(function(x){return x!==pid;}):cur.concat([pid]);
        return Object.assign({},c,{planIds:next});
      });
      fl();
    };}
    else if(a==="crm-delete"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        // Safety: only admin can delete
        if(!currentUser||!currentUser.roles.includes("admin"))return false;
        const cid=el.dataset.cid;
        if(!cid)return false;
        try{
          crmClients=crmClients.filter(function(x){return x.id!==cid;});
          crmView="funnel";crmOpenId=null;
          const toast=document.createElement("div");
          toast.textContent="🗑 Клиент удалён";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a2a3a;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3)";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="crm-instruction"){el.onclick=()=>{crmView="instruction";render();};}
    // ── МАРКЕТИНГ ──────────────────────────────────────────────
    else if(a==="mkt-instruction"){el.onclick=()=>{window._mktInstView=true;render();};}
    else if(a==="mkt-back"){el.onclick=()=>{window._mktInstView=false;render();};}
    else if(a==="mkt-save-inst"){el.onclick=()=>{
      const v=(document.getElementById("mkt-inst-text")||{}).value;
      if(v!==undefined)AI_INSTRUCTION=v;
      fl();
    };}
    // ── TAB DRAG (admin) ──────────────────────────────────────────
    else if(a==="tab-drag"){
      el.addEventListener("dragstart",function(e){
        window._dragTabIdx=parseInt(el.dataset.i);
        e.dataTransfer.effectAllowed="move";
        el.style.opacity="0.4";
      });
      el.addEventListener("dragend",function(){el.style.opacity="1";});
      el.addEventListener("dragover",function(e){
        e.preventDefault();
        el.style.background="rgba(41,128,185,0.1)";
      });
      el.addEventListener("dragleave",function(){el.style.background="";});
      el.addEventListener("drop",function(e){
        e.preventDefault();
        el.style.background="";
        const from=window._dragTabIdx;
        const to=parseInt(el.dataset.i);
        if(from===to||from===undefined||isNaN(to))return;
        const tabs=[].concat(window._adminTabs);
        tabs.splice(to,0,tabs.splice(from,1)[0]);
        window._adminTabs=tabs;
        render();
      });
    }
    // Template editing
    else if(a==="tpl-add-stage"){el.onclick=()=>{showNStageTid=el.dataset.tid;newTStage={n:"",c:"#e67e22"};tnsMode="manual";dbStagePicks={};render();};}
    else if(a==="tns-mode"){el.onclick=()=>{tnsMode=el.dataset.m;dbStagePicks={};render();};}
    else if(a==="tpl-pick-stage"){el.onclick=()=>{
      const stage=el.dataset.stage;
      dbStagePicks[stage]=!dbStagePicks[stage];
      render();
    };}
    else if(a==="tpl-add-picked"){el.onclick=()=>{
      const tid=el.dataset.tid;
      const SC_MAP={"ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЕ РАБОТЫ":"#e67e22","ЭТАП 2 — ЧЕРНОВАЯ ОТДЕЛКА":"#2980b9","ЭТАП 3 — ЧИСТОВАЯ ОТДЕЛКА":"#27ae60"};
      const stages=[...new Set(dbWorks.map(function(w){return w.stage||"Без этапа";}))].filter(function(s){return dbStagePicks[s];});
      if(!stages.length)return;
      const newStages=stages.map(function(stage){
        const sc=SC_MAP[stage]||"#7f8c8d";
        const stageWorks=dbWorks.filter(w=>(w.stage||"Без этапа")===stage);
        const newWorks=stageWorks.map(function(w){
          return{id:gid(),n:w.n,cost:w.cost,unit:w.unit||"",qty:(w.qty!=null?w.qty:1),unitCost:(w.unitCost!=null?w.unitCost:w.cost),mats:JSON.parse(JSON.stringify(w.mats||[]))};
        });
        return{id:gid(),n:stage,c:sc,works:newWorks};
      });
      templates=templates.map(t=>t.id===tid?{...t,stages:[...t.stages,...newStages]}:t);
      dbStagePicks={};
      showNStageTid="";fl();
    };}
    else if(a==="cancel-tns"){el.onclick=()=>{dbStagePicks={};showNStageTid="";render();};}
    else if(a==="pick-tns-c"){el.onclick=()=>{newTStage.c=el.dataset.c;render();};}
    else if(a==="tpl-save-stage"){el.onclick=()=>{
      const tid=el.dataset.tid;
      const n=document.getElementById("tns-n")?.value?.trim();
      if(!n)return;
      templates=templates.map(t=>t.id===tid?{...t,stages:[...t.stages,{id:gid(),n,c:newTStage.c,works:[]}]}:t);
      showNStageTid="";fl();
    };}
    else if(a==="tpl-del-stage"){el.onclick=()=>{
      const tid=el.dataset.tid,sid=el.dataset.sid;
      templates=templates.map(t=>t.id===tid?{...t,stages:t.stages.filter(s=>s.id!==sid)}:t);fl();
    };}
    else if(a==="tpl-show-work"){el.onclick=()=>{showNWorkSid=el.dataset.sid;render();};}
    else if(a==="cancel-tnw"){el.onclick=()=>{showNWorkSid="";render();};}
    else if(a==="tpl-save-work"){el.onclick=()=>{
      const tid=el.dataset.tid,sid=el.dataset.sid;
      const sel=document.getElementById("tnw-db-select");
      if(sel&&sel.value){
        // Pick from DB
        const dbw=dbWorks.find(w=>w.id===sel.value);
        if(!dbw)return;
        const work={id:gid(),n:dbw.n,cost:dbw.cost,unit:dbw.unit||"",qty:(dbw.qty!=null?dbw.qty:1),unitCost:(dbw.unitCost!=null?dbw.unitCost:dbw.cost),mats:JSON.parse(JSON.stringify(dbw.mats||[]))};
        templates=templates.map(t=>t.id===tid?{...t,stages:t.stages.map(s=>s.id===sid?{...s,works:[...s.works,work]}:s)}:t);
      } else {
        const n=document.getElementById("tnw-n")?.value?.trim();
        const cost=parseInt(document.getElementById("tnw-cost")?.value)||0;
        if(!n)return;
        templates=templates.map(t=>t.id===tid?{...t,stages:t.stages.map(s=>s.id===sid?{...s,works:[...s.works,{id:gid(),n,cost,mats:[]}]}:s)}:t);
      }
      showNWorkSid="";fl();
    };}
    else if(a==="tpl-del-work"){el.onclick=()=>{
      const tid=el.dataset.tid,sid=el.dataset.sid,wid=el.dataset.wid;
      templates=templates.map(t=>t.id===tid?{...t,stages:t.stages.map(s=>s.id===sid?{...s,works:s.works.filter(w=>w.id!==wid)}:s)}:t);fl();
    };}
    else if(a==="tpl-open-mats"){el.onclick=()=>{tplMatModal={tid:el.dataset.tid,wid:el.dataset.wid,wn:el.dataset.wn};render();};}
    else if(a==="close-tpl-mm"){el.onclick=()=>{tplMatModal=null;render();};}
    else if(a==="tpl-del-mat"){el.onclick=()=>{
      const tid=el.dataset.tid,wid=el.dataset.wid,mid=el.dataset.mid;
      templates=templates.map(t=>t.id===tid?{...t,stages:t.stages.map(s=>({...s,works:s.works.map(w=>w.id===wid?{...w,mats:(w.mats||[]).filter(m=>m.id!==mid)}:w)}))}:t);
      render();
    };}
    else if(a==="tpl-add-mat"){el.onclick=()=>{
      if(!tplMatModal)return;
      const n=document.getElementById("tpm-n")?.value?.trim();
      const cost=parseInt(document.getElementById("tpm-cost")?.value)||0;
      const store=document.getElementById("tpm-store")?.value?.trim()||"";
      if(!n)return;
      const {tid,wid}=tplMatModal;
      templates=templates.map(t=>t.id===tid?{...t,stages:t.stages.map(s=>({...s,works:s.works.map(w=>w.id===wid?{...w,mats:[...(w.mats||[]),{id:gid(),n,cost,store}]}:w)}))}:t);
      render();
    };}
    // Object editing
    else if(a==="save-obj-info"){el.onclick=()=>{
      const oid=el.dataset.oid;
      const name=document.getElementById("obj-name-"+oid)?.value?.trim();
      const icon=document.getElementById("obj-icon-"+oid)?.value;
      if(name)objects=objects.map(o=>o.id===oid?{...o,name,icon:icon||o.icon}:o);
      fl();
    };}
    else if(a==="save-tpl-info"){el.onclick=()=>{
      const tid=el.dataset.tid;
      const name=document.getElementById("tpl-name-"+tid)?.value?.trim();
      const icon=document.getElementById("tpl-icon-"+tid)?.value;
      if(name)templates=templates.map(t=>t.id===tid?{...t,name,icon:icon||t.icon}:t);
      fl();
    };}
    else if(a==="discard-tpl-info"){el.onclick=()=>{
      const tid=el.dataset.tid;
      const t=templates.find(x=>x.id===tid);
      if(t){
        const inp=document.getElementById("tpl-name-"+tid);
        const sel=document.getElementById("tpl-icon-"+tid);
        if(inp)inp.value=t.name;
        if(sel)sel.value=t.icon;
      }
      const bar=document.getElementById("tpl-save-bar-"+tid);
      if(bar)bar.style.display="none";
    };}
    else if(a==="discard-obj"){el.onclick=()=>{
      const bar=document.getElementById("save-bar-"+el.dataset.oid);
      if(bar)bar.style.display="none";
      const obj=objects.find(o=>o.id===el.dataset.oid);
      if(obj){
        const inp=document.getElementById("obj-name-"+obj.id);
        const sel=document.getElementById("obj-icon-"+obj.id);
        if(inp)inp.value=obj.name;
        if(sel)sel.value=obj.icon;
      }
    };}
    else if(a==="del-obj"){el.onclick=()=>{
      const oid=el.dataset.oid;
      if(!confirm("Удалить объект? Это действие нельзя отменить."))return;
      objects=objects.filter(o=>o.id!==oid);
      users=users.map(u=>({...u,objs:u.objs.filter(id=>id!==oid)}));
      openObject=null;fl();
    };}
    else if(a==="obj-add-stage"){el.onclick=()=>{showNObjStageTid=el.dataset.oid;newObjStage={n:"",c:"#e67e22"};render();};}
    else if(a==="cancel-ons"){el.onclick=()=>{showNObjStageTid="";render();};}
    else if(a==="pick-ons-c"){el.onclick=()=>{newObjStage.c=el.dataset.c;render();};}
    else if(a==="obj-save-stage"){el.onclick=()=>{
      const oid=el.dataset.oid;
      const n=document.getElementById("ons-n")?.value?.trim();
      if(!n)return;
      objects=objects.map(o=>o.id===oid?{...o,stages:[...o.stages,{id:gid(),n,c:newObjStage.c,works:[]}]}:o);
      showNObjStageTid="";fl();
    };}
    else if(a==="obj-del-stage"){el.onclick=()=>{
      if(!currentUser||!currentUser.roles.includes("admin"))return;
      const oid=el.dataset.oid,sid=el.dataset.sid;
      objects=objects.map(o=>o.id===oid?{...o,stages:o.stages.filter(s=>s.id!==sid)}:o);fl();
    };}
    else if(a==="obj-show-work"){el.onclick=()=>{showNObjWorkSid=el.dataset.sid;render();};}
    else if(a==="cancel-onw"){el.onclick=()=>{showNObjWorkSid="";render();};}
    else if(a==="obj-save-work"){el.onclick=()=>{
      const oid=el.dataset.oid,sid=el.dataset.sid;
      const n=document.getElementById("onw-n")?.value?.trim();
      const cost=parseInt(document.getElementById("onw-cost")?.value)||0;
      if(!n)return;
      objects=objects.map(o=>o.id===oid?{...o,stages:o.stages.map(s=>s.id===sid?{...s,works:[...s.works,{id:gid(),n,cost,mats:[]}]}:s)}:o);
      showNObjWorkSid="";fl();
    };}
    else if(a==="dl-save"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const cu=currentUser;
        if(!cu||(!cu.roles.includes("admin")&&!cu.roles.includes("prod_head")))return false;
        const cid=el.dataset.cid,uid=el.dataset.uid;
        const startInp=document.getElementById("dl-start-"+cid+"-"+uid);
        const endInp=document.getElementById("dl-end-"+cid+"-"+uid);
        const startDate=startInp?startInp.value:"";
        const deadline=endInp?endInp.value:"";
        const now=new Date().toISOString().slice(0,16).replace("T"," ");
        contractDocs=contractDocs.map(function(c){
          if(c.id!==cid)return c;
          const dls=Object.assign({},c.deadlines||{});
          const prev=dls[uid]||{};
          // Skip recording if no actual change
          const changed=(prev.startDate||"")!==startDate||(prev.deadline||"")!==deadline;
          const history=(prev.history||[]).slice();
          if(changed)history.push({by:cu.id,when:now,startDate:startDate,deadline:deadline,prevStart:prev.startDate||"",prevDeadline:prev.deadline||""});
          dls[uid]={startDate:startDate,deadline:deadline,history:history};
          return Object.assign({},c,{deadlines:dls});
        });
        try{
          const toast=document.createElement("div");
          toast.textContent="📅 Дедлайн сохранён";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#d35800;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="dl-autocalc"){el.onclick=()=>{
      const cid=el.dataset.cid,uid=el.dataset.uid;
      const startInp=document.getElementById("dl-start-"+cid+"-"+uid);
      const endInp=document.getElementById("dl-end-"+cid+"-"+uid);
      if(startInp&&startInp.value&&endInp){
        endInp.value=addBusinessDays(startInp.value,35);
      }
    };}
    else if(a==="dl-hist-toggle"){el.onclick=()=>{
      if(!window._dlHistOpen)window._dlHistOpen={};
      const k=el.dataset.key;
      window._dlHistOpen[k]=!window._dlHistOpen[k];
      render();
    };}
    else if(a==="fine-apply"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const cu=currentUser;
        if(!cu||(!cu.roles.includes("admin")&&!cu.roles.includes("prod_head")&&!cu.roles.includes("financier")))return false;
        const cid=el.dataset.cid,uid=el.dataset.uid;
        const amt=parseFloat(el.dataset.amt)||0;
        if(amt<=0)return false;
        const c=contractDocs.find(x=>x.id===cid);
        const u=users.find(x=>x.id===uid);
        const info=getBrigadierDeadlineInfo(c,uid);
        finTxns.push({
          id:gid(),
          type:"expense",
          category:"⚠️ Штраф просрочка",
          amount:amt,
          date:new Date().toISOString().slice(0,10),
          contractId:cid,
          userId:uid,
          note:"Просрочка "+info.overdueDays+" р.дн · "+(u?u.name:"")
        });
        try{
          const toast=document.createElement("div");
          toast.textContent="⚠️ Штраф −"+amt.toLocaleString("ru-RU")+" ₽ применён";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#e74c3c;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2200);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="obj-toggle-history"){el.onclick=()=>{
      const wid=el.dataset.wid;
      timeHistoryExpanded[wid]=!timeHistoryExpanded[wid];
      render();
    };}
    else if(a==="dr-hist-toggle"){el.onclick=()=>{dayReportHistOpen=!dayReportHistOpen;render();};}
    else if(a==="dr-cleanup-label"){
      const oid=el.dataset.oid,uid=el.dataset.uid,date=el.dataset.date;
      const inp=document.getElementById("dr-cleanup-inp-"+oid+"-"+uid);
      if(inp&&!inp._bound){
        inp._bound=true;
        inp.addEventListener("change",function(){
          const files=Array.from(inp.files||[]);
          if(!files.length)return;
          let processed=0;
          const newPhotos=[];
          files.forEach(function(f){
            const reader=new FileReader();
            reader.onload=function(e){
              newPhotos.push({
                id:gid(),
                data:e.target.result,
                date:new Date().toISOString().slice(0,16).replace("T"," "),
                uploader:(users.find(u=>u.id===uid)||{}).name||"—",
                size:f.size,
                name:f.name
              });
              processed++;
              if(processed===files.length){
                // Update or create day report
                let wasEmpty=false;
                objects=objects.map(function(o){
                  if(o.id!==oid)return o;
                  const reports=(o.dayReports||[]).slice();
                  let idx=reports.findIndex(function(r){return r.userId===uid&&r.date===date;});
                  if(idx<0){
                    wasEmpty=true;
                    reports.push({id:gid(),userId:uid,date:date,cleanupPhotos:newPhotos,dayOff:false});
                  } else {
                    const existing=reports[idx];
                    wasEmpty=(existing.cleanupPhotos||[]).length===0;
                    reports[idx]=Object.assign({},existing,{cleanupPhotos:(existing.cleanupPhotos||[]).concat(newPhotos),dayOff:false});
                  }
                  return Object.assign({},o,{dayReports:reports});
                });
                
                // Auto-create bonus transaction (only first time bonus is earned for this day on this object)
                const obj=objects.find(o=>o.id===oid);
                const u=users.find(x=>x.id===uid);
                const existingBonus=getCleanupBonusPaid(oid,uid,date);
                if(existingBonus===0&&u){
                  // Find any active contract on this object for transaction binding
                  const objC=contractDocs.filter(d=>d.objId===oid&&(d.status==="signed"||d.status==="closed"))[0];
                  finTxns.push({
                    id:gid(),
                    type:"expense",
                    category:"🧹 Премия за уборку",
                    amount:CLEANUP_BONUS,
                    date:date,
                    objId:oid,
                    contractId:objC?objC.id:null,
                    userId:uid,
                    note:"Уборка рабочего места · "+(obj?obj.name:"")+" · "+u.name
                  });
                }
                
                try{
                  const toast=document.createElement("div");
                  toast.textContent=existingBonus===0?"🎉 Премия +"+CLEANUP_BONUS+" ₽ начислена!":"📷 Фото добавлены";
                  toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#27ae60;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(39,174,96,0.4)";
                  document.body.appendChild(toast);
                  setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2500);
                }catch(e){}
                fl();
              }
            };
            reader.readAsDataURL(f);
          });
        });
      }
    }
    else if(a==="dr-del-cleanup"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const oid=el.dataset.oid,uid=el.dataset.uid,date=el.dataset.date,pid=el.dataset.pid;
        objects=objects.map(function(o){
          if(o.id!==oid)return o;
          const reports=(o.dayReports||[]).map(function(r){
            if(r.userId!==uid||r.date!==date)return r;
            return Object.assign({},r,{cleanupPhotos:(r.cleanupPhotos||[]).filter(function(p){return p.id!==pid;})});
          });
          return Object.assign({},o,{dayReports:reports});
        });
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="dr-day-off"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const oid=el.dataset.oid,uid=el.dataset.uid,date=el.dataset.date;
        objects=objects.map(function(o){
          if(o.id!==oid)return o;
          const reports=(o.dayReports||[]).slice();
          const idx=reports.findIndex(function(r){return r.userId===uid&&r.date===date;});
          if(idx<0)reports.push({id:gid(),userId:uid,date:date,dayOff:true,cleanupPhotos:[]});
          else reports[idx]=Object.assign({},reports[idx],{dayOff:true});
          return Object.assign({},o,{dayReports:reports});
        });
        try{
          const toast=document.createElement("div");
          toast.textContent="🏖 Выходной отмечен";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#9b59b6;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},1800);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="dr-undo-off"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const oid=el.dataset.oid,uid=el.dataset.uid,date=el.dataset.date;
        objects=objects.map(function(o){
          if(o.id!==oid)return o;
          const reports=(o.dayReports||[]).map(function(r){
            if(r.userId!==uid||r.date!==date)return r;
            return Object.assign({},r,{dayOff:false});
          });
          return Object.assign({},o,{dayReports:reports});
        });
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="obj-toggle-done"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const cu=currentUser;
        const canMark=cu&&(cu.roles.includes("admin")||cu.roles.includes("brigadier")||cu.roles.includes("worker")||cu.roles.includes("prod_head"));
        if(!canMark)return false;
        const oid=el.dataset.oid,sid=el.dataset.sid,wid=el.dataset.wid;
        // Safety: brig/worker can only mark done if there's a time log
        const isAdmFin=cu.roles.includes("admin")||cu.roles.includes("financier");
        const o0=objects.find(x=>x.id===oid);
        const st0=o0&&o0.stages.find(x=>x.id===sid);
        const w0=st0&&st0.works.find(x=>x.id===wid);
        if(!isAdmFin&&w0&&!w0.done&&(!w0.timeLogs||!w0.timeLogs.length)){
          try{
            const toast=document.createElement("div");
            toast.textContent="🔒 Сначала отметьте часы";
            toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#e67e22;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
            document.body.appendChild(toast);
            setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
          }catch(e){}
          return false;
        }
        let became=null;
        objects=objects.map(function(o){
          if(o.id!==oid)return o;
          return Object.assign({},o,{stages:o.stages.map(function(st){
            if(st.id!==sid)return st;
            return Object.assign({},st,{works:st.works.map(function(w){
              if(w.id!==wid)return w;
              const newDone=!w.done;
              became=newDone;
              return Object.assign({},w,{done:newDone,doneBy:newDone?cu.id:undefined,doneAt:newDone?new Date().toISOString().slice(0,16).replace("T"," "):undefined});
            })});
          })});
        });
        try{
          const toast=document.createElement("div");
          toast.textContent=became?"✓ Работа выполнена":"☐ Снята отметка";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:"+(became?"#27ae60":"#7a9aaa")+";color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},1800);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="obj-need-time"){el.onclick=()=>{
      const wid=el.dataset.wid;
      try{
        const toast=document.createElement("div");
        toast.innerHTML="🔒 Сначала отметьте часы<br><span style='font-size:10px;opacity:0.85;font-weight:500'>Нажмите ⏱ на работе</span>";
        toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#e67e22;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;text-align:center;line-height:1.4;box-shadow:0 4px 16px rgba(230,126,34,0.4)";
        document.body.appendChild(toast);
        setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2400);
      }catch(e){}
      // Auto-open the time block for convenience
      const obj=objects.find(o=>o.stages.some(st=>st.works.some(w=>w.id===wid)));
      if(obj){
        const st=obj.stages.find(s=>s.works.some(w=>w.id===wid));
        openTimeWid=wid;openTimeOid=obj.id;openTimeSid=st.id;
        const respIds=new Set();
        contractDocs.filter(d=>d.objId===obj.id&&(d.status==="signed"||d.status==="closed")).forEach(d=>(d.responsible||[]).forEach(uid=>respIds.add(uid)));
        const PROD_ROLES=["brigadier","worker","prod_head"];
        let eligible=users.filter(u=>respIds.has(u.id)&&u.roles.some(r=>PROD_ROLES.includes(r)));
        const isAdminOrFin=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("financier"));
        let defaultUid=eligible[0]?eligible[0].id:null;
        if(!isAdminOrFin&&currentUser&&eligible.find(u=>u.id===currentUser.id)){defaultUid=currentUser.id;}
        newTimeLog={hours:1,date:new Date().toISOString().slice(0,10),userId:defaultUid};
        render();
      }
    };}
    else if(a==="obj-toggle-photo"){el.onclick=()=>{
      const wid=el.dataset.wid;
      if(openPhotoWid===wid)openPhotoWid=null;
      else openPhotoWid=wid;
      render();
    };}
    else if(a==="obj-photo-label"){
      // The label itself wraps a hidden <input type="file">. When user taps label, browser triggers input.
      // Hook the file input's change event when block is rendered.
      const wid=el.dataset.wid;
      const oid=el.dataset.oid,sid=el.dataset.sid;
      const inp=document.getElementById("photo-inp-"+wid);
      if(inp&&!inp._bound){
        inp._bound=true;
        inp.addEventListener("change",function(ev){
          const files=Array.from(inp.files||[]);
          if(!files.length)return;
          let processed=0;
          const newPhotos=[];
          files.forEach(function(f){
            const reader=new FileReader();
            reader.onload=function(e){
              newPhotos.push({
                id:gid(),
                data:e.target.result,
                date:new Date().toISOString().slice(0,16).replace("T"," "),
                uploader:(users.find(u=>u.id===(currentUser?currentUser.id:""))||{}).name||"—",
                uploaderId:currentUser?currentUser.id:"",
                size:f.size,
                name:f.name
              });
              processed++;
              if(processed===files.length){
                objects=objects.map(function(o){
                  if(o.id!==oid)return o;
                  return Object.assign({},o,{stages:o.stages.map(function(st){
                    if(st.id!==sid)return st;
                    return Object.assign({},st,{works:st.works.map(function(w){
                      if(w.id!==wid)return w;
                      return Object.assign({},w,{photos:(w.photos||[]).concat(newPhotos)});
                    })});
                  })});
                });
                try{
                  const toast=document.createElement("div");
                  toast.textContent="📷 Загружено "+newPhotos.length+" фото";
                  toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#3498db;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
                  document.body.appendChild(toast);
                  setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
                }catch(e){}
                fl();
              }
            };
            reader.readAsDataURL(f);
          });
        });
      }
    }
    else if(a==="obj-del-photo"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const oid=el.dataset.oid,sid=el.dataset.sid,wid=el.dataset.wid,pid=el.dataset.pid;
        objects=objects.map(function(o){
          if(o.id!==oid)return o;
          return Object.assign({},o,{stages:o.stages.map(function(st){
            if(st.id!==sid)return st;
            return Object.assign({},st,{works:st.works.map(function(w){
              if(w.id!==wid)return w;
              return Object.assign({},w,{photos:(w.photos||[]).filter(function(p){return p.id!==pid;})});
            })});
          })});
        });
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="obj-toggle-time"){el.onclick=()=>{
      const wid=el.dataset.wid;
      if(openTimeWid===wid){openTimeWid=null;openTimeOid=null;openTimeSid=null;}
      else{
        openTimeWid=wid;openTimeOid=el.dataset.oid;openTimeSid=el.dataset.sid;
        const obj=objects.find(o=>o.id===openTimeOid);
        const respIds=new Set();
        contractDocs.filter(d=>d.objId===openTimeOid&&(d.status==="signed"||d.status==="closed")).forEach(d=>(d.responsible||[]).forEach(uid=>respIds.add(uid)));
        const PROD_ROLES=["brigadier","worker","prod_head"];
        let eligible=users.filter(u=>respIds.has(u.id)&&u.roles.some(r=>PROD_ROLES.includes(r)));
        const isAdminOrFin=currentUser&&(currentUser.roles.includes("admin")||currentUser.roles.includes("financier"));
        // If user is brig/worker — preselect themselves
        let defaultUid=eligible[0]?eligible[0].id:null;
        if(!isAdminOrFin&&currentUser&&eligible.find(u=>u.id===currentUser.id)){
          defaultUid=currentUser.id;
        }
        newTimeLog={hours:1,date:new Date().toISOString().slice(0,10),userId:defaultUid};
      }
      render();
    };}
    else if(a==="obj-tl-user"){el.onclick=()=>{newTimeLog.userId=el.dataset.uid;render();};}
    else if(a==="obj-tl-hours"){el.onclick=()=>{newTimeLog.hours=parseFloat(el.dataset.h);render();};}
    else if(a==="obj-tl-save"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        // Safety: only production roles + admin/financier can save
        const cu=currentUser;
        const canSave=cu&&(cu.roles.includes("admin")||cu.roles.includes("financier")||cu.roles.includes("brigadier")||cu.roles.includes("worker")||cu.roles.includes("prod_head"));
        if(!canSave)return false;
        const oid=el.dataset.oid,sid=el.dataset.sid,wid=el.dataset.wid;
        // If user is brig/worker (not admin/fin), force userId to be themselves
        const isAdminOrFin=cu.roles.includes("admin")||cu.roles.includes("financier");
        if(!isAdminOrFin)newTimeLog.userId=cu.id;
        const dateInp=document.getElementById("tl-date-"+wid);
        const date=dateInp?dateInp.value:newTimeLog.date;
        const uid=newTimeLog.userId;
        const hours=newTimeLog.hours||1;
        if(!uid){alert("Выберите исполнителя");return false;}
        if(!date){alert("Укажите дату");return false;}
        objects=objects.map(function(o){
          if(o.id!==oid)return o;
          return Object.assign({},o,{stages:o.stages.map(function(st){
            if(st.id!==sid)return st;
            return Object.assign({},st,{works:st.works.map(function(w){
              if(w.id!==wid)return w;
              const logs=(w.timeLogs||[]).concat([{id:gid(),userId:uid,date:date,hours:hours}]);
              return Object.assign({},w,{timeLogs:logs});
            })});
          })});
        });
        // Reset form but keep block open
        newTimeLog={hours:1,date:date,userId:uid};
        try{
          const toast=document.createElement("div");
          toast.textContent="⏱ Запись сохранена";
          toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#16a085;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999";
          document.body.appendChild(toast);
          setTimeout(function(){try{document.body.removeChild(toast);}catch(e){}},2000);
        }catch(e){}
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="obj-del-time"){
      const handler=function(ev){
        if(ev){ev.stopPropagation();ev.preventDefault();}
        const cu=currentUser;
        const oid=el.dataset.oid,sid=el.dataset.sid,wid=el.dataset.wid,lid=el.dataset.lid;
        // Safety: brig/worker can only delete their own entries; admin can delete any
        const isAdminOrFin=cu&&(cu.roles.includes("admin")||cu.roles.includes("financier"));
        if(!isAdminOrFin){
          // Find the log and check ownership
          const o=objects.find(x=>x.id===oid);
          const st=o&&o.stages.find(x=>x.id===sid);
          const w=st&&st.works.find(x=>x.id===wid);
          const log=w&&(w.timeLogs||[]).find(x=>x.id===lid);
          if(!log||log.userId!==cu.id)return false;
        }
        objects=objects.map(function(o){
          if(o.id!==oid)return o;
          return Object.assign({},o,{stages:o.stages.map(function(st){
            if(st.id!==sid)return st;
            return Object.assign({},st,{works:st.works.map(function(w){
              if(w.id!==wid)return w;
              return Object.assign({},w,{timeLogs:(w.timeLogs||[]).filter(function(l){return l.id!==lid;})});
            })});
          })});
        });
        fl();
        return false;
      };
      el.onclick=handler;
      el.addEventListener("click",handler,true);
      el.addEventListener("touchend",function(ev){if(ev){ev.stopPropagation();ev.preventDefault();}handler(ev);},true);
    }
    else if(a==="obj-del-work"){el.onclick=()=>{
      if(!currentUser||!currentUser.roles.includes("admin"))return;
      const oid=el.dataset.oid,sid=el.dataset.sid,wid=el.dataset.wid;
      objects=objects.map(o=>o.id===oid?{...o,stages:o.stages.map(s=>s.id===sid?{...s,works:s.works.filter(w=>w.id!==wid)}:s)}:o);fl();
    };}
    else if(a==="obj-open-mats"){el.onclick=()=>{objMatModal={oid:el.dataset.oid,wid:el.dataset.wid,wn:el.dataset.wn};render();};}
    else if(a==="close-obj-mm"){el.onclick=()=>{objMatModal=null;render();};}
    else if(a==="objmat-view"){el.onclick=(ev)=>{ev&&ev.stopPropagation();expView[el.dataset.mid]=el.dataset.v;render();};}
    else if(a==="obj-del-mat"){el.onclick=()=>{
      const {oid,wid,mid}=el.dataset;
      objects=objects.map(o=>o.id===oid?{...o,stages:o.stages.map(s=>({...s,works:s.works.map(w=>w.id===wid?{...w,mats:(w.mats||[]).filter(m=>m.id!==mid)}:w)}))}:o);
      render();
    };}
    else if(a==="obj-add-mat"){el.onclick=()=>{
      if(!objMatModal)return;
      const n=document.getElementById("opm-n")?.value?.trim();
      const cost=parseInt(document.getElementById("opm-cost")?.value)||0;
      const store=document.getElementById("opm-store")?.value?.trim()||"";
      if(!n)return;
      const {oid,wid}=objMatModal;
      objects=objects.map(o=>o.id===oid?{...o,stages:o.stages.map(s=>({...s,works:s.works.map(w=>w.id===wid?{...w,mats:[...(w.mats||[]),{id:gid(),n,cost,store}]}:w)}))}:o);
      render();
    };}
  });
}

// Bootstrap: сначала авторизация (пароль-гейт), потом загрузка состояния и рендер.
(async function boot(){
  while (true){
    if (!getToken()) setToken(await showLogin(""));
    try {
      const items = await apiLoad();
      if (items){ applyState(items); _lastSeen = maxUpdatedAt(items); }
      _lastSavedJson = JSON.stringify(serializeState());  // базовый снимок — не сохраняем загруженное обратно
      break;                                  // успех (или офлайн-кэш) — выходим из гейта
    } catch (e){
      clearToken();
      setToken(await showLogin(e && e.unauthorized ? "Неверный пароль" : "Ошибка связи, попробуйте снова"));
    }
  }
  // авто-вход «Запомнить меня»: восстанавливаем сотрудника из localStorage (данные уже загружены)
  try{ const rid=localStorage.getItem("kubr_remember"); if(rid && !currentUser){ const u=users.find(function(x){return x.id===rid;}); if(u){ currentUser=u; _setInitialTab(); } } }catch(e){}
  _hydrated = true;
  render();

  // автосейв-страж: ловит ЛЮБЫЕ мутации (вкл. renderEstimates и прямые DOM-правки),
  // шлёт в D1 только при реальном изменении снимка (dirty-check внутри apiSave).
  setInterval(apiSave, 2500);

  // live-обновление: опрос + мгновенная проверка при возврате на вкладку
  setInterval(pollOnce, POLL_MS);
  document.addEventListener("visibilitychange", function(){ if (!document.hidden) pollOnce(); });
})();
