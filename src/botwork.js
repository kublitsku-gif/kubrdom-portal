// ─── ОТМЕТКА ВЫПОЛНЕННЫХ РАБОТ ЧЕРЕЗ БОТА ────────────────────────────────────
// Повторяет правила панели: отмечать могут производственные роли и админ, а без
// записанных часов галочка не ставится (кроме админа и финансиста) — это защита от
// «сделано» задним числом без трудозатрат. Разница одна: бот не упирается в замок,
// а сразу спрашивает часы и записывает их вместе с отметкой.

import { sendTg, escapeHtml } from "./notify.js";
import { objTeam, money, mskToday } from "./reminders.js";
import { logEvent } from "./audit.js";

const PAGE = 8;                                   // работ на экран: больше кнопок не влезает
const MARK_ROLES = ["admin", "brigadier", "worker", "prod_head"];
const has = (roles, list) => (roles || []).some(function (r) { return list.indexOf(r) >= 0; });
const canMark = (roles) => has(roles, MARK_ROLES);
const isAdmFin = (roles) => has(roles, ["admin", "financier"]);

async function snap(env, keys) {
  const ph = keys.map(function () { return "?"; }).join(",");
  const rows = await env.DB.prepare("SELECT work_id, data FROM work_states WHERE storage_key='admin_panel' AND work_id IN (" + ph + ")").bind(...keys).all();
  const out = {};
  for (const r of (rows.results || [])) { try { out[r.work_id] = JSON.parse(r.data); } catch { out[r.work_id] = null; } }
  return out;
}
async function saveObjects(env, objects) {
  await env.DB.prepare("INSERT INTO work_states (storage_key, work_id, data, updated_at) VALUES ('admin_panel','objects',?,?) ON CONFLICT(storage_key,work_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind(JSON.stringify(objects), Date.now()).run();
}
async function dlgSet(env, uid, st) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tg_dialog (uid TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
  if (!st) { await env.DB.prepare("DELETE FROM tg_dialog WHERE uid=?").bind(uid).run(); return; }
  await env.DB.prepare("INSERT INTO tg_dialog (uid, state, updated_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at")
    .bind(uid, JSON.stringify(st), Date.now()).run();
}
async function dlgGet(env, uid) {
  const r = await env.DB.prepare("SELECT state FROM tg_dialog WHERE uid=?").bind(uid).first();
  if (!r || !r.state) return null;
  try { return JSON.parse(r.state); } catch { return null; }
}
function findWork(st, oid, wid) {
  const o = (st.objects || []).find(function (x) { return x.id === oid; });
  if (!o) return null;
  for (const s of (o.stages || [])) {
    const w = (s.works || []).find(function (x) { return x.id === wid; });
    if (w) return { o: o, s: s, w: w };
  }
  return null;
}
function allowedObject(st, oid, uid, roles) {
  if (has(roles, ["admin", "financier", "prod_head"])) return true;
  return objTeam(st, oid).has(uid);
}

// ─── Список невыполненных работ ──────────────────────────────────────────────
export async function workList(env, chat, oid, page, uid, roles) {
  if (!canMark(roles)) return await sendTg(env, chat, "Отмечать работы могут бригадир, мастер, начальник производства и админ.");
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  if (!allowedObject(st, oid, uid, roles)) return await sendTg(env, chat, "Этот объект вам недоступен.");
  const o = (st.objects || []).find(function (x) { return x.id === oid; });
  if (!o) return await sendTg(env, chat, "Объект не найден.");

  const open = (o.stages || []).flatMap(function (s) { return (s.works || []).filter(function (w) { return !w.done; }).map(function (w) { return { s: s, w: w }; }); });
  if (!open.length) return await sendTg(env, chat, "🎉 На объекте «" + escapeHtml(o.name) + "» все работы отмечены выполненными.");

  const p = Math.max(0, Number(page) || 0);
  const slice = open.slice(p * PAGE, p * PAGE + PAGE);
  const rows = slice.map(function (x) {
    const label = (x.w.n || "Работа").slice(0, 40) + ((x.w.timeLogs || []).length ? " ⏱" : "");
    return [{ text: label, callback_data: "w:p:" + oid + ":" + x.w.id }];
  });
  const nav = [];
  if (p > 0) nav.push({ text: "‹ Назад", callback_data: "w:l:" + oid + ":" + (p - 1) });
  if ((p + 1) * PAGE < open.length) nav.push({ text: "Ещё ›", callback_data: "w:l:" + oid + ":" + (p + 1) });
  if (nav.length) rows.push(nav);

  return await sendTg(env, chat, "✅ <b>Какая работа выполнена?</b>\n«" + escapeHtml(o.name) + "» · осталось " + open.length
    + "\n<i>⏱ — по работе уже есть записанные часы.</i>", { reply_markup: { inline_keyboard: rows } });
}

// ─── Карточка работы ─────────────────────────────────────────────────────────
export async function workPick(env, chat, oid, wid, uid, roles) {
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  if (!allowedObject(st, oid, uid, roles)) return await sendTg(env, chat, "Этот объект вам недоступен.");
  const f = findWork(st, oid, wid);
  if (!f) return await sendTg(env, chat, "Работа не найдена.");
  const logs = f.w.timeLogs || [];
  const hours = logs.reduce(function (a, l) { return a + (Number(l.hours) || 0); }, 0);
  const needHours = !isAdmFin(roles) && !logs.length;

  const text = "🔨 <b>" + escapeHtml(f.w.n || "Работа") + "</b>\n"
    + "Этап: " + escapeHtml(f.s.n || "—") + "\n"
    + (f.w.cost ? "Стоимость: " + money(f.w.cost) + "\n" : "")
    + (Number(f.w.pay) ? "Оплата бригаде: <b>" + money(f.w.pay) + "</b>\n" : "")
    + "Часы: " + (hours ? "<b>" + hours + " ч</b> (" + logs.length + " записей)" : "не записаны")
    + (needHours ? "\n\n<i>Без часов отметить нельзя — бот спросит их перед отметкой.</i>" : "");
  const rows = [
    [{ text: needHours ? "⏱ Записать часы и отметить" : "✅ Отметить выполненной", callback_data: "w:d:" + oid + ":" + wid }],
    [{ text: "‹ К списку", callback_data: "w:l:" + oid + ":0" }],
  ];
  return await sendTg(env, chat, text, { reply_markup: { inline_keyboard: rows } });
}

// ─── Отметка (при необходимости — сперва часы) ───────────────────────────────
export async function workDone(env, chat, oid, wid, uid, roles) {
  if (!canMark(roles)) return await sendTg(env, chat, "Недостаточно прав.");
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  if (!allowedObject(st, oid, uid, roles)) return await sendTg(env, chat, "Этот объект вам недоступен.");
  const f = findWork(st, oid, wid);
  if (!f) return await sendTg(env, chat, "Работа не найдена.");
  if (f.w.done) return await sendTg(env, chat, "Эта работа уже отмечена выполненной.");

  const logs = f.w.timeLogs || [];
  if (!isAdmFin(roles) && !logs.length) {
    await dlgSet(env, uid, { mode: "hours", oid: oid, wid: wid });
    return await sendTg(env, chat, "⏱ <b>Сколько часов потрачено?</b>\nНапишите числом, например: <code>6</code> или <code>4.5</code>");
  }
  return await commitDone(env, chat, uid, roles, oid, wid, 0);
}

async function commitDone(env, chat, uid, roles, oid, wid, addHours) {
  const st = await snap(env, ["objects", "users", "contractDocs"]);
  const f = findWork(st, oid, wid);
  if (!f) return await sendTg(env, chat, "Работа не найдена.");
  const stamp = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

  const objects = (st.objects || []).map(function (o) {
    if (o.id !== oid) return o;
    return Object.assign({}, o, { stages: (o.stages || []).map(function (s) {
      if (s.id !== f.s.id) return s;
      return Object.assign({}, s, { works: (s.works || []).map(function (w) {
        if (w.id !== wid) return w;
        const next = Object.assign({}, w, { done: true, doneBy: uid, doneAt: stamp });
        if (addHours > 0) {
          next.timeLogs = (w.timeLogs || []).concat([{ id: "tl" + Date.now().toString(36), userId: uid, date: mskToday(), hours: addHours }]);
        }
        return next;
      }) });
    }) });
  });
  await saveObjects(env, objects);
  await dlgSet(env, uid, null);

  const me = (st.users || []).find(function (x) { return x.id === uid; });
  const title = (f.o.name || "Объект") + " › " + (f.s.n || "") + " › " + (f.w.n || "Работа");
  await logEvent(env, { uid: uid }, "objects", "edit", title, "отмечено выполненной через бота");

  const left = (objects.find(function (o) { return o.id === oid; }).stages || [])
    .flatMap(function (s) { return s.works || []; }).filter(function (w) { return !w.done; }).length;
  await sendTg(env, chat, "✅ <b>Отмечено выполненной</b>\n" + escapeHtml(f.w.n || "Работа")
    + (addHours > 0 ? "\nЗаписано часов: <b>" + addHours + "</b>" : "")
    + "\nОсталось работ на объекте: <b>" + left + "</b>",
    { reply_markup: { inline_keyboard: [[{ text: "✅ Отметить ещё", callback_data: "w:l:" + oid + ":0" }]] } });

  // Руководству — короткое уведомление о факте: это событие, а не напоминание по расписанию.
  const links = await env.DB.prepare("SELECT uid, chat_id FROM tg_links").all();
  for (const l of (links.results || [])) {
    if (l.uid === uid) continue;
    const u = (st.users || []).find(function (x) { return x.id === l.uid; });
    if (!u || !has(u.roles || [], ["admin", "prod_head"])) continue;
    await sendTg(env, l.chat_id, "✅ <b>" + escapeHtml((me && me.name) || uid) + "</b> отметил работу\n"
      + escapeHtml(title) + "\nОсталось на объекте: " + left);
  }
}

// ─── Роутер ──────────────────────────────────────────────────────────────────
export async function workText(env, uid, chat, text, roles) {
  const d = await dlgGet(env, uid);
  if (!d || d.mode !== "hours") return false;
  const t = String(text || "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) {
    await sendTg(env, chat, "Нужно число часов, например <code>6</code> или <code>4.5</code>.");
    return true;
  }
  const h = Number(t);
  if (!(h > 0) || h > 24) { await sendTg(env, chat, "Часов должно быть больше 0 и не больше 24."); return true; }
  await commitDone(env, chat, uid, roles, d.oid, d.wid, h);
  return true;
}
export async function workCallback(env, uid, chat, data, roles) {
  const p = String(data || "").split(":");
  if (p[0] !== "w") return false;
  if (p[1] === "l") { await workList(env, chat, p[2], p[3], uid, roles); return true; }
  if (p[1] === "p") { await workPick(env, chat, p[2], p[3], uid, roles); return true; }
  if (p[1] === "d") { await workDone(env, chat, p[2], p[3], uid, roles); return true; }
  return false;
}
