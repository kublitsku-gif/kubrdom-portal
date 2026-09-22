// Saving, conflict resolution and live updates. The adapter supplies live state
// bindings; UI/domain modules stay independent of the synchronization controller.
export function createPanelSync(ctx) {
async function apiSave(opts){
  if (ctx._saving) return { success: true, busy: true };
  // Сохраняет только залогиненный СОТРУДНИК. На экране входа (нет currentUser) или в кабинете
  // клиента (read-only) — ничего не шлём и не показываем баннер сверки.
  if (!ctx.currentUser) { clearSaveError(); return { success: true, skipped: true }; }
  if (!ctx.getToken())  { clearSaveError(); return { success: true, skipped: true }; }
  const snap=JSON.stringify(ctx.serializeState());
  const items=JSON.parse(snap);
  // Нечего сохранять — и статус трогать нечего: экранный тумблер не правка, а
  // зелёная вспышка на каждый тап и была тем, из-за чего отметку перестали читать.
  if (snap === ctx._lastSavedJson) { return { success: true, skipped: true }; }
  // СТРАЖ v2. Правило: «не пиши туда, чего не видел».
  // (1) Пока не было успешного GET с НАСТОЯЩЕГО сервера — в облако не пишем вообще:
  //     вкладка, поднятая из localStorage-кэша, не знает актуального состояния и
  //     может затереть его старьём (так 15–28.06.2026 пропали договора и объекты).
  if (!ctx._serverVerified && !window._forceSaveOnce) {
    ctx.writeCache(items);   // правки целы локально; уйдут сами после первой сверки с сервером
    ctx._setPendingSave();
    showSaveError("Ждём ответа сервера для сверки данных. Правки сохранены на устройстве и уйдут в облако автоматически после проверки связи.");
    ctx.saveMarkSet("wait");
    return { success: false, blocked: "unverified" };
  }
  if (ctx._serverVerified && !window._forceSaveOnce) {
    const itemsById = {};
    items.forEach(function(it){ itemsById[it.work_id] = it.data; });
    const allow = window._allowEmptyOnce || {};
    const changedKeys=ctx.dirtySections(items).map(function(it){return it.work_id;});
    const guarded=ctx.GUARDED_KEYS.filter(function(k){return changedKeys.indexOf(k)>=0;});
    // (2) Полное обнуление разделов (страж v1): пусто локально, не пусто в облаке.
    const emptied = guarded.filter(function(k){
      const la = itemsById[k];
      return ctx._serverCounts[k] > 0 && Array.isArray(la) && la.length === 0 && !allow[k];
    });
    const mass = emptied.length >= 2 || emptied.some(function(k){ return ctx._serverCounts[k] >= 3; });
    // (3) УСУШКА: раздел стал заметно меньше серверного. Потеря 06.2026 была «4 реальных → 2 демо» —
    //     v1 ловил только «до нуля». Одиночное удаление (−1) и парное в мелком разделе пропускаем.
    const shrunk = guarded.filter(function(k){
      const la = itemsById[k];
      if (!Array.isArray(la) || !(ctx._serverCounts[k] > 0) || allow[k]) return false;
      const d = ctx._serverCounts[k] - la.length;
      return d >= 3 || (d >= 2 && d / ctx._serverCounts[k] >= 0.3);
    });
    // (4) РЕГРЕССИЯ К ДЕМО: шлём демо-запись, которой на сервере уже нет, — верный признак стейл-вкладки.
    const seedy = Object.keys(ctx.SEED_STALE_IDS).filter(function(k){
      const la = itemsById[k];
      if (!Array.isArray(la) || !(ctx._serverCounts[k] > 0) || !ctx._serverIds || !ctx._serverIds[k]) return false;
      return ctx.SEED_STALE_IDS[k].some(function(id){
        return !ctx._serverIds[k].has(id) && la.some(function(x){ return x && x.id === id; });
      });
    });
    if (mass || shrunk.length > 0 || seedy.length > 0) {
      if(ctx._latestServerItems && ctx.maxUpdatedAt(ctx._latestServerItems)>ctx._lastSeen) return _handleSaveConflict(ctx._latestServerItems);
      ctx.writeCache(items);   // локально ничего не теряем
      ctx._setPendingSave();
      const what = [].concat(emptied, shrunk, seedy).filter(function(v, i, a){ return a.indexOf(v) === i; });
      showSaveError("Защита данных: разделы «" + what.join(", ") + "» локально беднее или старее, чем в облаке. Похоже, вкладка устарела. Сохранение остановлено, чтобы не затереть данные.", 0, true);
      ctx.saveMarkSet("wait");
      return { success: false, blocked: what.join(",") };
    }
    window._allowEmptyOnce = {};   // одноразовые разрешения израсходованы
  }
  const forced = !!window._forceSaveOnce;  // «Сохранить как есть» — осознанная перезапись облака
  window._forceSaveOnce = false;           // форс-сохранение одноразовое
  // Форс шлём целиком: кнопка обещает перезаписать облако, а не его часть.
  const sendItems = forced ? items : ctx.dirtySections(items);
  if (!sendItems.length) { ctx._lastSavedJson = snap; return { success: true, skipped: true }; }
  const sentKeys = sendItems.map(function(it){ return it.work_id; });
  ctx._saving = true;
  ctx.saveMarkSet("saving");
  ctx.writeCache(items);                       // optimistic: локально всегда свежо
  ctx._setPendingSave();                       // …но сервером ещё не подтверждено — маркер до успеха
  try {
    const url  = ctx.API_BASE + "/api/state/" + encodeURIComponent(ctx.STORAGE_KEY);
    // base = optimistic locking: сервер откажет (409 + свежий снимок), если облако менялось
    // после base, — вместо тихого затирания чужих правок полным снимком этой вкладки.
    // Форс шлём БЕЗ base (безусловная запись — ровно то, что пообещала кнопка).
    const init = {
      method:  "POST",
      headers: ctx.authHeaders({ "Content-Type": "application/json" }),
      body:    JSON.stringify(forced ? { items: sendItems,force:true } : { items: sendItems,base:ctx._lastSeen||0,baseVersions:Object.fromEntries(sentKeys.map(function(k){return [k,ctx._baseVersions[k]||0];})) }),
    };
    // keepalive-режим (дожим при уходе со страницы): такой запрос браузер доотправляет даже
    // после закрытия вкладки. Без fetchT: abort-таймер после смерти страницы бессмыслен.
    const r = (opts && opts.keepalive)
      ? await fetch(url, Object.assign({ keepalive: true }, init))
      : await ctx.fetchT(url, init, 30000);   // 30с: на медленном/троттленом канале POST снимка (~1 МБ) может идти долго
    if (r.status === 401) { ctx.clearToken(); location.reload(); return { success: false, error: "unauthorized" }; }
    // 409 — optimistic locking: наш base устарел (облако менял кто-то другой). Сервер НИЧЕГО
    // не записал и прислал актуальный снимок — сливаем его с локальными правками и повторяем.
    if (r.status === 409) {
      let conf = null; try { conf = await r.json(); } catch { /* Keep the existing fallback state. */ }
      if (conf && conf.conflict && Array.isArray(conf.items)) return _handleSaveConflict(conf.items);
      throw new Error((conf && conf.error) || "HTTP 409");   // чужой 409: body уже прочитан — вниз не проваливаемся
    }
    if (!r.ok) {
      let detail = "HTTP " + r.status;
      try { const e = await r.json(); if (e && e.error) detail = e.error; } catch { /* Keep the existing fallback state. */ }
      throw new Error(detail);
    }
    const j = await r.json();
    const accepted=j&&Array.isArray(j.accepted)?j.accepted:[];
    const skipped=j&&Array.isArray(j.skipped)?j.skipped:[];
    const confirmed=sentKeys.filter(function(k){return accepted.indexOf(k)>=0&&skipped.indexOf(k)<0&&Number.isSafeInteger(j.versions&&j.versions[k]);});
    if(!j||!j.success||!j.versions)throw new Error((j&&j.error)||"Сервер не подтвердил сохранение. Обновите портал.");
    const oldBase={};try{(JSON.parse(ctx._lastSavedJson||"[]")||[]).forEach(function(it){oldBase[it.work_id]=it;});}catch { /* Keep the existing fallback state. */ }
    const canonical=new Map((j.items||[]).map(function(it){return [it.work_id,it];}));
    const current=ctx.serializeState();
    const normalizations=[];
    confirmed.forEach(function(k){
      const sent=sendItems.find(function(it){return it.work_id===k;});
      const normalized=canonical.get(k)||sent;
      const now=current.find(function(it){return it.work_id===k;});
      if(now&&ctx._jeq(now.data,sent.data)&&!ctx._jeq(now.data,normalized.data))normalizations.push(normalized);
      oldBase[k]=JSON.parse(JSON.stringify(normalized));
      ctx._baseVersions[k]=j.versions[k];
    });
    if(normalizations.length)ctx.applyState(normalizations);
    ctx._lastSavedJson=JSON.stringify(Object.values(oldBase));
    ctx.updateServerCounts(Array.from(canonical.values()).length?Array.from(canonical.values()):items,confirmed);
    const pending=ctx.dirtySections(ctx.serializeState()).length>0;
    if(pending){ctx._setPendingSave();ctx.saveMarkSet("wait");}
    else {ctx._clearPendingSave();ctx.saveMarkSet("ok");}
    ctx.writeCache(ctx.serializeState());
    if(confirmed.length!==sentKeys.length){
      showSaveError("Сервер не сохранил разделы: "+sentKeys.filter(function(k){return confirmed.indexOf(k)<0;}).join(", "));
      return {success:false,partial:true};
    }
    clearSaveError();
    if(pending)scheduleSave();
    return j;
  } catch (err) {
    showSaveError(String((err && err.message) || err), JSON.stringify(sendItems).length);  // НЕ глотаем: показываем пользователю
    ctx.saveMarkSet("wait");                               // статус называет то же, что баннер объясняет
    return { success: false, error: String((err && err.message) || err), fallback: "localStorage" };
  } finally {
    ctx._saving = false;
  }
}

function showSaveError(detail, snapLen, withActions){
  let b = document.getElementById("save-error-banner");
  if (!b){
    b = document.createElement("div");
    b.id = "save-error-banner";
    b.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:10000;max-width:92%;background:#c0392b;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3);font-size:13px;font-weight:600;text-align:center;line-height:1.4";
    document.body.appendChild(b);
  }
  const tooBig = /large|big|413|exceed|too\s|D1_|SQLITE|размер|велик/i.test(detail) || (snapLen && snapLen > 1500000);
  // Технические тексты → человеческие. Таймаут/обрыв сети — самый частый случай (медленный
  // канал или блокировка без VPN): данные целы локально, автосейв ретраит каждые 2.5с сам.
  let human = String(detail || "");
  if (/abort/i.test(human)) human = "Сервер не отвечает (таймаут сети). Проверьте интернет или включите VPN.";
  else if (/Failed to fetch|NetworkError|Load failed/i.test(human)) human = "Нет связи с сервером. Проверьте интернет или включите VPN.";
  b.innerHTML = "⚠️ Изменения НЕ сохраняются в облако!<br><span style='font-weight:400;font-size:12px'>" + ctx.esc(human)
    + (tooBig ? "<br>Снимок слишком большой (тяжёлые фото в base64). Обновите страницу (Cmd+Shift+R) — новая версия хранит фото отдельно в облаке." : "")
    + (ctx._cacheDurable?"<br>Правки сохранены на устройстве.":"<br>Не удалось сохранить копию на устройстве. Не закрывайте страницу до подтверждения облаком.")+"</span>";
  if (withActions && ctx.currentUser && ctx.currentUser.roles.includes("admin")){
    const row = document.createElement("div");
    row.style.cssText = "margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap";
    row.innerHTML = '<button id="seb-reload" style="border:0;border-radius:8px;padding:7px 14px;background:#fff;color:#c0392b;font-weight:700;font-size:12px;cursor:pointer">🔄 Обновить страницу</button>'
      + '<button id="seb-force" style="border:1px solid rgba(255,255,255,.5);border-radius:8px;padding:7px 14px;background:transparent;color:#fff;font-weight:600;font-size:12px;cursor:pointer">Сохранить как есть (перезапишет облако)</button>';
    b.appendChild(row);
    document.getElementById("seb-reload").onclick = function(){ location.reload(); };
    document.getElementById("seb-force").onclick = function(){
      if (!confirm("Точно перезаписать облако данными этой вкладки? Если вкладка устарела, более свежие данные с других устройств будут потеряны.")) return;
      window._forceSaveOnce = true; clearSaveError(); apiSave().catch(function(){});
    };
  }
}

function clearSaveError(){
  const b = document.getElementById("save-error-banner");
  if (b){ try { b.parentNode.removeChild(b); } catch { /* Keep the existing fallback state. */ } }
}

function scheduleSave(){
  if (!ctx._hydrated) return;                   // не сохраняем до завершения загрузки
  if(ctx.dirtySections(ctx.serializeState()).length)ctx._setPendingSave();
  clearTimeout(scheduleSave._t);
  scheduleSave._t = setTimeout(apiSave, 800);
}

function flushSaveOnLeave(){
  try{
    if (!ctx._hydrated) return;
    if (!ctx.currentUser || !ctx.getToken()) return;      // экран входа / кабинет клиента: нечего дожимать
    const items = ctx.serializeState();
    const snap  = JSON.stringify(items);
    if (snap === ctx._lastSavedJson) return;          // изменений нет — не дублируем штатный автосейв
    clearTimeout(scheduleSave._t);                // дебаунс уже не успеет сработать
    ctx.writeCache(items);                            // (1) синхронная страховка
    ctx._setPendingSave();
    if (ctx._saving) return;                          // штатный POST уже в полёте; умрёт со страницей — дожмёт boot
    if (flushSaveOnLeave._sent === snap) return;  // pagehide сразу после visibilitychange — не шлём дважды
    // Меряем ОТПРАВЛЯЕМОЕ, а не весь снимок: с сейвом по разделам правка обычно уходит
    // парой килобайт и в квоту keepalive влезает, тогда как целый снимок не влезал никогда
    // — и дожим при закрытии вкладки фактически не работал, всё ждало следующей загрузки.
    if (new Blob([JSON.stringify(ctx.dirtySections(items))]).size > ctx.FLUSH_KEEPALIVE_MAX) return;   // не влезет — остаётся (1)
    flushSaveOnLeave._sent = snap;
    apiSave({ keepalive: true }).catch(function(){});   // стражи и учёт _lastSavedJson — внутри apiSave
  }catch { /* Keep the existing fallback state. */ }
}

async function pollOnce(){
  if (!ctx._hydrated || ctx._pollPaused || document.hidden) return;
  const base = ctx.API_BASE + "/api/state/" + encodeURIComponent(ctx.STORAGE_KEY);
  // Сначала спрашиваем ТОЛЬКО версию. Снимок весит около мегабайта, а меняется редко:
  // тянуть его четыре раза в минуту ради сравнения одного числа — это трафик и батарея
  // телефона бригадира в поле. Версия не даёт ни одной цифры из данных.
  try {
    const rv = await ctx.fetchT(base + "/version", { headers: ctx.authHeaders() }, 9000);
    if (rv.status === 401) { ctx.clearToken(); location.reload(); return; }
    if (rv.ok) {
      const jv = await rv.json();
      // Ничего не менялось — выходим, полный снимок не нужен. Если версия непонятна
      // (старый Worker в окне деплоя отдаст 404), проваливаемся на полный опрос, как раньше.
      if (jv && jv.success && typeof jv.version === "number" && jv.version <= Math.max(ctx._lastSeen,ctx._dismissedVersion)) return;
    }
  } catch { return; }                                 // сеть/таймаут — тихо, попробуем позже
  let r;
  try { r = await ctx.fetchT(base, { headers: ctx.authHeaders() }, 9000); }
  catch { return; }                                   // сеть/таймаут — тихо, попробуем позже
  if (r.status === 401) { ctx.clearToken(); location.reload(); return; }
  if (!r.ok) return;
  const data = await r.json();
  if (!data || !Array.isArray(data.items)) return;
  ctx.updateServerCounts(data.items);   // страж всегда знает СВЕЖИЕ серверные счётчики (даже без применения стейта)
  const serverV = ctx.maxUpdatedAt(data.items);
  if (serverV > ctx._lastSeen) showUpdateBanner(data.items, serverV);
}

function showUpdateBanner(items, version){
  ctx._pollPaused = true;
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
  document.getElementById("live-apply").onclick = function(){_handleSaveConflict(items);};
  document.getElementById("live-dismiss").onclick = function(){
    ctx._dismissedVersion=version;b.remove();ctx._pollPaused=false;
  };
}

function _handleSaveConflict(serverItems,choices){
  ctx.updateServerCounts(serverItems);                 // страж сверяется со свежим сервером
  const local   = ctx.serializeState();                // свежее снимка до POST: могли успеть печатать
  let base = null;
  try { base = ctx._lastSavedJson ? JSON.parse(ctx._lastSavedJson) : null; } catch { /* Keep the existing fallback state. */ }
  const res = base ? ctx._merge3(base, local, serverItems,choices) : null;
  if (!res || res.conflicts.length > 0) {
    // Базы для слияния нет или запись правлена с двух сторон — решает пользователь.
    // Кэш и маркер дожима уже записаны в apiSave, локальные правки целы.
    showConflictDetails(serverItems,res,choices||{});
    ctx.saveMarkSet("wait");
    return { success: false, blocked: "conflict" };
  }
  const inServer = {};
  const mergedFull = serverItems.map(function(it){
    inServer[it.work_id] = 1;
    return (it.work_id in res.merged) ? { work_id: it.work_id, data: res.merged[it.work_id], updated_at: it.updated_at } : it;
  });
  Object.keys(res.merged).forEach(function(k){ if (!inServer[k]) mergedFull.push({ work_id: k, data: res.merged[k] }); });
  // Применяем и перерисовываем, только если слияние реально меняет локальные данные —
  // иначе (чужой сейв с тем же содержимым) зря дёргали бы DOM и сбивали фокус ввода.
  const lm = {}; local.forEach(function(it){ lm[it.work_id] = it.data; });
  const changed = Object.keys(res.merged).some(function(k){ return !ctx._jeq(res.merged[k], lm[k]); });
  if (changed) { ctx.applyState(mergedFull); ctx.render(); }
  const supplied=new Set(serverItems.map(function(it){return it.work_id;}));
  const confirmedBase=(base||[]).filter(function(it){return !supplied.has(it.work_id);}).concat(serverItems);
  ctx._acceptServerBase(serverItems);
  ctx._lastSavedJson=JSON.stringify(confirmedBase);
  ctx.writeCache(mergedFull);
  ctx._clearPendingSave(); ctx._setPendingSave();          // маркер дожима — уже от свежей базы
  // Слияние разрешило расхождение — висящий live-баннер (от поллинга) больше не актуален,
  // а его кнопка «Обновить» держит УСТАРЕВШИЙ снимок и откатила бы слитое. Закрываем.
  const lb = document.getElementById("live-banner");
  if (lb) { try { lb.remove(); } catch { /* Keep the existing fallback state. */ } ctx._pollPaused = false; }
  const localAfter = changed ? ctx.serializeState() : local;
  if (ctx._mergeIsNoop(localAfter, confirmedBase)) {
    // Всё «наше» уже в облаке — пересохранять нечего (и не дёргаем чужие вкладки).
    ctx._lastSavedJson = JSON.stringify(localAfter);
    ctx._clearPendingSave();
    clearSaveError();ctx.saveMarkSet("ok");ctx.writeCache(localAfter);
    return { success: true, merged: true };
  }
  // null — не только «есть что сохранять»: без базы сравнения apiSave отправит ВСЕ разделы.
  // После слияния это и нужно — слитыми могли оказаться несколько разделов сразу.
  ctx._lastSavedJson = JSON.stringify(confirmedBase);
  clearSaveError();ctx.saveMarkSet("wait");
  scheduleSave();                                  // ретрай уйдёт уже с новым base
  return { success: false, retry: true, merged: true };
}

function showConflictDetails(serverItems,result,choices){
  const previous=document.getElementById("live-banner");if(previous)previous.remove();ctx._pollPaused=true;
  const b=document.createElement("div");b.id="live-banner";
  b.style.cssText="position:fixed;inset:12px;z-index:10000;background:#fff;padding:20px;overflow:auto;border:2px solid #c0392b;border-radius:14px;box-shadow:0 8px 30px #0004";
  const title=document.createElement("h3");title.textContent="Данные изменились на другом устройстве";b.appendChild(title);
  const note=document.createElement("p");note.textContent="Ваши правки сохранены отдельно. Выберите значение только для полей, которые изменены с двух сторон.";b.appendChild(note);
  if(!result){const p=document.createElement("p");p.textContent="Не удалось найти исходную версию. Оставьте страницу открытой: автоматическая замена данных остановлена.";b.appendChild(p);}
  const preview=function(v){return typeof v==="string"?v.slice(0,240):JSON.stringify(v===undefined?"Удалено":v).slice(0,240);};
  (result&&result.details||[]).forEach(function(d){
    const row=document.createElement("div");row.style.cssText="padding:12px 0;border-bottom:1px solid #ddd";
    const label=document.createElement("div");label.textContent=d.path;row.appendChild(label);
    ["local","server"].forEach(function(side){
      const btn=document.createElement("button");btn.textContent=(side==="local"?"Моя правка: ":"Из облака: ")+preview(d[side]);btn.style.cssText="display:block;margin:6px 0;padding:10px;max-width:100%;text-align:left";
      btn.onclick=function(){choices[d.path]=side;_handleSaveConflict(serverItems,choices);};row.appendChild(btn);
    });b.appendChild(row);
  });
  const close=document.createElement("button");close.textContent="Решить позже";close.onclick=function(){b.remove();ctx._pollPaused=false;};b.appendChild(close);
  document.body.appendChild(b);
}
return {apiSave,showSaveError,clearSaveError,scheduleSave,flushSaveOnLeave,pollOnce,showUpdateBanner,_handleSaveConflict,showConflictDetails};
}
