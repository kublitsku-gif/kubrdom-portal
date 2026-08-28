// ─── ОТМЕТКА ВЫПОЛНЕННЫХ РАБОТ ЧЕРЕЗ БОТА ────────────────────────────────────
// Повторяет правила панели: отмечать могут производственные роли и админ, а без
// записанных часов галочка не ставится (кроме админа и финансиста) — это защита от
// «сделано» задним числом без трудозатрат. Разница одна: бот не упирается в замок,
// а сразу спрашивает часы и записывает их вместе с отметкой.

import { sendTg, escapeHtml } from "./notify.js";
import { objTeam, money, mskToday } from "./reminders.js";
import { logEvent } from "./audit.js";
import { ensureTopic, copyToTopic, fetchTgFile, tgBase } from "./tgapi.js";

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
  // Таблицу создаём и на чтении: первое сообщение пользователя может прийти раньше,
  // чем что-либо её создаст, и обработчик упадёт на «no such table».
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tg_dialog (uid TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
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

  // Номер этапа держим при работе: в плоском списке кнопок Telegram иначе не понять,
  // к какому этапу она относится, а порядок работ этого не проговаривает.
  const open = (o.stages || []).flatMap(function (s, si) {
    return (s.works || []).filter(function (w) { return !w.done; }).map(function (w) { return { s: s, w: w, n: si + 1 }; });
  });
  if (!open.length) return await sendTg(env, chat, "🎉 На объекте «" + escapeHtml(o.name) + "» все работы отмечены выполненными.");

  const p = Math.max(0, Number(page) || 0);
  const slice = open.slice(p * PAGE, p * PAGE + PAGE);
  const rows = slice.map(function (x) {
    const label = x.n + " · " + (x.w.n || "Работа").slice(0, 36) + ((x.w.timeLogs || []).length ? " ⏱" : "");
    return [{ text: label, callback_data: "w:p:" + oid + ":" + x.w.id }];
  });
  const nav = [];
  if (p > 0) nav.push({ text: "‹ Назад", callback_data: "w:l:" + oid + ":" + (p - 1) });
  if ((p + 1) * PAGE < open.length) nav.push({ text: "Ещё ›", callback_data: "w:l:" + oid + ":" + (p + 1) });
  if (nav.length) rows.push(nav);

  const byStage = (o.stages || []).map(function (s, si) {
    const left = (s.works || []).filter(function (w) { return !w.done; }).length;
    const all = (s.works || []).length;
    return left ? (si + 1) + " — " + escapeHtml(String(s.n || "").replace(/^ЭТАП\s*\d+\s*[—-]?\s*/i, "").trim() || "этап") + ": осталось " + left + " из " + all : null;
  }).filter(Boolean);

  return await sendTg(env, chat, "✅ <b>Какая работа выполнена?</b>\n«" + escapeHtml(o.name) + "» · осталось " + open.length + "\n"
    + (byStage.length ? byStage.join("\n") + "\n" : "")
    + "\n<i>Цифра на кнопке — номер этапа. ⏱ — по работе уже есть часы.</i>", { reply_markup: { inline_keyboard: rows } });
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
    + "\nФото: " + ((f.w.photos || []).length ? "<b>" + (f.w.photos || []).length + "</b>" : "нет")
    + (needHours ? "\n\n<i>Без часов отметить нельзя — бот спросит их перед отметкой.</i>" : "");
  const photos = (f.w.photos || []).length;
  const rows = [
    [{ text: needHours ? "⏱ Записать часы и отметить" : "✅ Отметить выполненной", callback_data: "w:d:" + oid + ":" + wid }],
    [{ text: "📷 Добавить фото" + (photos ? " (" + photos + ")" : ""), callback_data: "w:ph:" + oid + ":" + wid }],
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

// ─── Фото и видео от бригадира ───────────────────────────────────────────────
// Фото кладём в R2 и привязываем к работе — ровно как это делает панель (w.photos).
// Видео НЕ скачиваем: лимит Bot API 20 МБ, а ролик со стройки обычно больше. Вместо
// этого копируем сообщение в тему объекта и храним ссылку — так же устроено видео
// объекта в панели.
export async function workPhotoAsk(env, chat, oid, wid, uid, roles) {
  if (!canMark(roles)) return await sendTg(env, chat, "Недостаточно прав.");
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  if (!allowedObject(st, oid, uid, roles)) return await sendTg(env, chat, "Этот объект вам недоступен.");
  await dlgSet(env, uid, { mode: "photo", oid: oid, wid: wid });
  return await sendTg(env, chat, "📷 <b>Пришлите фото или видео</b>\nМожно несколько подряд. Фото попадёт в карточку работы, видео — в тему объекта.\n\nЧтобы закончить — нажмите любую кнопку внизу.");
}

export async function workMedia(env, uid, chat, msg, roles) {
  const d = await dlgGet(env, uid);
  const st = await snap(env, ["objects", "contractDocs", "users"]);
  if (!d || d.mode !== "photo") {
    return await sendTg(env, chat, "Не понял, к чему прикрепить. Откройте 🏗 Объекты → объект → ✅ Отметить работу → нужная работа → 📷 Добавить фото.");
  }
  if (!allowedObject(st, d.oid, uid, roles)) return await sendTg(env, chat, "Этот объект вам недоступен.");
  const f = findWork(st, d.oid, d.wid);
  if (!f) return await sendTg(env, chat, "Работа не найдена.");
  const me = (st.users || []).find(function (x) { return x.id === uid; });
  const stamp = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const caption = (f.o.name || "") + " · " + (f.w.n || "") + " · " + ((me && me.name) || uid);

  // ── Видео: копией в тему объекта ──
  if (msg.video) {
    const tg = tgBase(env);
    const t = await ensureTopic(env, tg, f.o.name, f.o.tgTopicId);
    if (t.error) return await sendTg(env, chat, "Не удалось открыть тему объекта: " + t.error);
    const mid = await copyToTopic(env, chat, msg.message_id, t.topicId, caption);
    if (!mid) return await sendTg(env, chat, "Telegram не принял видео.");
    const objects = (st.objects || []).map(function (o) {
      if (o.id !== d.oid) return o;
      return Object.assign({}, o, {
        tgTopicId: t.topicId,
        videos: (o.videos || []).concat([{
          id: "v" + Date.now().toString(36), name: (f.w.n || "Видео"), date: stamp,
          uploader: (me && me.name) || uid, size: (msg.video.file_size || 0), messageId: mid, topicId: t.topicId,
        }]),
      });
    });
    await saveObjects(env, objects);
    await logEvent(env, { uid: uid }, "objects", "add", (f.o.name || "") + " › видео › " + (f.w.n || ""), "через бота");
    return await sendTg(env, chat, "🎬 Видео добавлено в тему объекта «" + escapeHtml(f.o.name) + "».");
  }

  // ── Фото: в R2 и в карточку работы ──
  const ph = msg.photo ? msg.photo[msg.photo.length - 1] : null;   // последний размер = самый крупный
  const doc = !ph && msg.document && /^image\//.test(String(msg.document.mime_type || "")) ? msg.document : null;
  const fileId = ph ? ph.file_id : (doc ? doc.file_id : null);
  if (!fileId) return await sendTg(env, chat, "Пришлите фото или видео (документы других типов не принимаю).");
  if (!env.FILES) return await sendTg(env, chat, "Хранилище файлов не настроено.");

  const got = await fetchTgFile(env, fileId);
  if (!got) return await sendTg(env, chat, "Не смог скачать файл из Telegram (возможно, больше 20 МБ).");
  const ext = ["jpg", "jpeg", "png", "webp", "gif", "heic"].indexOf(got.ext) >= 0 ? got.ext : "jpg";
  const key = "works/" + crypto.randomUUID() + "." + ext;
  await env.FILES.put(key, got.buf, { httpMetadata: { contentType: ext === "png" ? "image/png" : "image/jpeg" } });

  const photo = {
    id: "p" + Date.now().toString(36), data: "/api/file/" + key, date: stamp,
    uploader: (me && me.name) || uid, uploaderId: uid, size: got.buf.byteLength, name: "telegram." + ext,
  };
  const objects = (st.objects || []).map(function (o) {
    if (o.id !== d.oid) return o;
    return Object.assign({}, o, { stages: (o.stages || []).map(function (sg) {
      if (sg.id !== f.s.id) return sg;
      return Object.assign({}, sg, { works: (sg.works || []).map(function (w) {
        return w.id !== d.wid ? w : Object.assign({}, w, { photos: (w.photos || []).concat([photo]) });
      }) });
    }) });
  });
  await saveObjects(env, objects);
  await logEvent(env, { uid: uid }, "objects", "add", (f.o.name || "") + " › фото › " + (f.w.n || ""), "через бота");

  // Бэкап в тему объекта — как это делает панель (mirrorPhotosToTelegram).
  try {
    const t = await ensureTopic(env, tgBase(env), f.o.name, f.o.tgTopicId);
    if (!t.error) await copyToTopic(env, chat, msg.message_id, t.topicId, caption);
  } catch { /* бэкап не критичен: фото уже в портале */ }

  const total = (f.w.photos || []).length + 1;
  return await sendTg(env, chat, "📷 Фото добавлено к работе «" + escapeHtml(f.w.n || "") + "» (всего " + total + ").\nМожно прислать ещё.",
    { reply_markup: { inline_keyboard: [[{ text: "✅ Отметить работу выполненной", callback_data: "w:d:" + d.oid + ":" + d.wid }]] } });
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
  if (p[1] === "ph") { await workPhotoAsk(env, chat, p[2], p[3], uid, roles); return true; }
  return false;
}
