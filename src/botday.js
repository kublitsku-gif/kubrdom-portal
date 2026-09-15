// ─── ЗАКРЫТИЕ ДНЯ ИЗ ЧАТА ────────────────────────────────────────────────────
// Кнопки под вечерним напоминанием (src/reminders.js → runDayClose). Смысл модуля —
// закрыть день одним тапом там, где человек уже стоит: панель в перчатках на морозе
// не откроешь, а «🏖 Выходной» и короткий текст — это одно движение.
//
// Пишет ровно в те же места снимка, что и панель: obj.dayReports[{userId,date,dayOff,note}].
// Само правило «день закрыт» здесь не считается — оно общее, в src/dayclose.js.

import { sendTg, escapeHtml, MAIN_BTNS } from "./notify.js";
import { objTeam } from "./reminders.js";
import { markDayOff, setDayNote, dayCloseState, dayFineCfg } from "./dayclose.js";
import { logEvent } from "./audit.js";

const NOTE_MAX = 500;

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
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tg_dialog (uid TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
  const r = await env.DB.prepare("SELECT state FROM tg_dialog WHERE uid=?").bind(uid).first();
  if (!r || !r.state) return null;
  try { return JSON.parse(r.state); } catch { return null; }
}

// id как в панели: время + случайность. Столкновение id отчётов дня стоило бы чужого выходного.
const newId = () => "dr" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

// Те же объекты, по которым считается штраф: где человек ответственный и есть открытые работы.
function activeObjectsOf(st, uid) {
  return (st.objects || []).filter(function (o) {
    if (!objTeam(st, o.id).has(uid)) return false;
    return (o.stages || []).some(function (s) { return (s.works || []).some(function (w) { return !w.done; }); });
  });
}
const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

// ─── «🏖 Выходной» ───────────────────────────────────────────────────────────
// Пишем во ВСЕ активные объекты человека: выходной не бывает «на одном объекте», а
// диаграмма второго иначе покажет рабочий день без единого часа.
export async function dayOff(env, uid, chat, date) {
  if (!dateOk(date)) return await sendTg(env, chat, "Не понял дату.");
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  const objs = activeObjectsOf(st, uid);
  if (!objs.length) return await sendTg(env, chat, "За вами нет объектов с открытыми работами — отмечать выходной не нужно.");

  const objects = markDayOff(st.objects || [], uid, date, objs.map(function (o) { return o.id; }), newId);
  await saveObjects(env, objects);
  await dlgSet(env, uid, null);
  const me = (st.users || []).find(function (x) { return x.id === uid; });
  await logEvent(env, { uid: uid }, "objects", "edit", "Выходной · " + ((me && me.name) || uid) + " · " + date, "через бота");
  return await sendTg(env, chat, "🏖 <b>Выходной отмечен</b> · " + date
    + "\nДень закрыт, удержания не будет.");
}

// ─── «✍️ Отчёт текстом» ──────────────────────────────────────────────────────
// Свободный текст — это путь для того, кому сейчас не до часов по работам: написал
// «ставили стропила, ждём доску» — день закрыт, часы поправятся в панели.
export async function dayNoteAsk(env, uid, chat, date) {
  if (!dateOk(date)) return await sendTg(env, chat, "Не понял дату.");
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  const objs = activeObjectsOf(st, uid);
  if (!objs.length) return await sendTg(env, chat, "За вами нет объектов с открытыми работами.");
  await dlgSet(env, uid, { mode: "daynote", date: date, oid: objs[0].id });
  return await sendTg(env, chat, "✍️ <b>Что делали " + date + "?</b>\nНапишите одной фразой — запишу в отчёт дня по объекту «"
    + escapeHtml(objs[0].name || "—") + "».");
}

async function saveNote(env, uid, chat, d, text) {
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  const objects = setDayNote(st.objects || [], uid, d.date, d.oid, text.slice(0, NOTE_MAX), newId);
  await saveObjects(env, objects);
  await dlgSet(env, uid, null);
  const me = (st.users || []).find(function (x) { return x.id === uid; });
  const o = (st.objects || []).find(function (x) { return x.id === d.oid; });
  await logEvent(env, { uid: uid }, "objects", "add",
    "Отчёт дня · " + ((me && me.name) || uid) + " · " + d.date, text.slice(0, 200));
  return await sendTg(env, chat, "✅ <b>Записано в отчёт дня</b> · " + d.date
    + (o ? "\nОбъект: «" + escapeHtml(o.name || "—") + "»" : "")
    + "\n" + escapeHtml(text.slice(0, NOTE_MAX))
    + "\n\n<i>День закрыт. Часы по работам можно добавить в панели, во вкладке «Мой день».</i>");
}

// ─── Состояние дня по запросу ────────────────────────────────────────────────
export async function dayStatus(env, uid, chat, date) {
  const st = await snap(env, ["objects", "contractDocs", "users", "settings"]);
  const s = dayCloseState(st.objects || [], uid, date);
  const cfg = dayFineCfg(st.settings);
  if (s.closed) {
    const parts = [];
    if (s.off) parts.push("🏖 выходной");
    if (s.hours) parts.push("⏱ " + (Math.round(s.hours * 10) / 10) + " ч");
    if (s.works) parts.push("✅ работ: " + s.works);
    if (s.note) parts.push("✍️ " + escapeHtml(s.note.slice(0, 120)));
    return await sendTg(env, chat, "✅ <b>День " + date + " закрыт</b>\n" + parts.join("\n"));
  }
  return await sendTg(env, chat, "⚠️ <b>День " + date + " не закрыт</b>\nНи часов, ни выполненных работ, ни выходного."
    + (cfg.enabled && cfg.uids.indexOf(uid) >= 0 ? "\nУтром это стоит " + cfg.amount + " ₽." : ""));
}

// ─── Роутер ──────────────────────────────────────────────────────────────────
export async function dayText(env, uid, chat, text) {
  const d = await dlgGet(env, uid);
  if (!d || d.mode !== "daynote") return false;
  const t = String(text || "").trim();
  // Нажатие кнопки нижней клавиатуры — это команда разделу, а не текст отчёта:
  // иначе человек, передумавший на полпути, запишет в отчёт «🏗 Объекты».
  if (MAIN_BTNS.indexOf(t) >= 0) { await dlgSet(env, uid, null); return false; }
  if (!t) { await sendTg(env, chat, "Напишите пару слов о том, что делали."); return true; }
  await saveNote(env, uid, chat, d, t);
  return true;
}
export async function dayCallback(env, uid, chat, data) {
  const p = String(data || "").split(":");
  if (p[0] !== "dc") return false;
  if (p[1] === "off") { await dayOff(env, uid, chat, p[2]); return true; }
  if (p[1] === "note") { await dayNoteAsk(env, uid, chat, p[2]); return true; }
  if (p[1] === "st") { await dayStatus(env, uid, chat, p[2]); return true; }
  return false;
}
