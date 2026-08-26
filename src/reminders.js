// ─── ЧТО И КОМУ НАПОМИНАТЬ ───────────────────────────────────────────────────
// Крон Worker'а ходит по UTC, а бригада живёт по Москве: все даты считаем в МСК (UTC+3),
// иначе «сегодня» на сервере наступает в 3 часа ночи по факту и вечерние проверки врут.
//
// Логика дедлайнов повторяет клиентскую (рабочие дни, штраф 2000 ₽/день): цифра в
// напоминании должна совпадать с тем, что человек видит в карточке объекта.

import { ensureNotifyTables, sendTg, defaultPrefs, escapeHtml } from "./notify.js";

const MSK_OFFSET_MS = 3 * 3600 * 1000;
const FINE_PER_DAY = 2000;
const PROD_ROLES = ["brigadier", "worker", "prod_head"];

export function mskToday() { return new Date(Date.now() + MSK_OFFSET_MS).toISOString().slice(0, 10); }

function countBusinessDaysBetween(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from + "T00:00:00"), b = new Date(to + "T00:00:00");
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  let count = 0;
  const cur = new Date(a);
  while (cur < b) { cur.setDate(cur.getDate() + 1); const wd = cur.getDay(); if (wd !== 0 && wd !== 6) count++; }
  return count;
}
function addBusinessDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  let added = 0;
  while (added < days) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) added++; }
  return d.toISOString().slice(0, 10);
}
function deadlineInfo(c, uid, today) {
  const dl = (c && c.deadlines && c.deadlines[uid]) || {};
  const deadline = dl.deadline || (dl.startDate ? addBusinessDays(dl.startDate, 35) : "");
  if (!deadline) return { has: false };
  const daysLeft = today <= deadline ? countBusinessDaysBetween(today, deadline) : 0;
  const overdue = today > deadline ? countBusinessDaysBetween(deadline, today) : 0;
  return { has: true, deadline: deadline, daysLeft: daysLeft, overdue: overdue, fine: overdue * FINE_PER_DAY };
}

const money = (v) => Math.round(v || 0).toLocaleString("ru-RU") + " ₽";

// Ссылка прямо в нужное место панели. Хеш разбирает applyDeepLink() в admin.js:
// #obj=<id> открывает объект, &view=receive — сразу режим «Приёмка», #tab=supply — вкладку.
function portal(env, hash) {
  const base = (env.PUBLIC_BASE_URL || "https://portal.kubrdom.ru").replace(/\/+$/, "");
  return base + "/admin" + (hash || "");
}
function linkTo(env, hash, label) {
  return '\n\n👉 <a href="' + portal(env, hash) + '">' + label + '</a>';
}

// ─── Кому слать ──────────────────────────────────────────────────────────────
// Привязанные чаты + персональные галочки. Роли берём из снимка: они же дают дефолт,
// если человек ещё ничего не настраивал.
async function audience(env, users, kind) {
  const rows = await env.DB.prepare(
    "SELECT l.uid AS uid, l.chat_id AS chat_id, p.prefs AS prefs FROM tg_links l LEFT JOIN notify_prefs p ON p.uid=l.uid"
  ).all();
  const out = [];
  for (const r of (rows.results || [])) {
    const u = users.find(function (x) { return x && x.id === r.uid; });
    if (!u) continue;
    let prefs = defaultPrefs(u.roles || []);
    if (r.prefs) { try { prefs = Object.assign(prefs, JSON.parse(r.prefs)); } catch { /* битый JSON — остаётся дефолт */ } }
    if (prefs[kind]) out.push({ uid: r.uid, chat: r.chat_id, user: u });
  }
  DIAG.push("audience(" + kind + "): привязок " + (rows.results || []).length + ", подходит " + out.length);
  return out;
}

// Одно напоминание одного вида по одному поводу — один раз. Ключ хранит дату, поэтому
// «просрочка» повторится завтра, а «за 3 дня до дедлайна» — нет.
const DIAG = [];                                    // причины, почему сообщение не ушло
async function sendOnce(env, who, kind, key, text) {
  const res = await env.DB.prepare("INSERT OR IGNORE INTO notify_log (uid, kind, k, sent_at) VALUES (?,?,?,?)")
    .bind(who.uid, kind, key, Date.now()).run();
  const changed = res && res.meta && typeof res.meta.changes === "number" ? res.meta.changes : 1;
  if (!changed) { DIAG.push(kind + "/" + who.uid + ": уже слали сегодня"); return false; }
  const ok = await sendTg(env, who.chat, text);
  if (!ok) {
    await env.DB.prepare("DELETE FROM notify_log WHERE uid=? AND kind=? AND k=?").bind(who.uid, kind, key).run();
    DIAG.push(kind + "/" + who.uid + ": Telegram не принял (chat " + who.chat + ")");
  }
  return ok;
}

async function loadState(env, keys) {
  const ph = keys.map(function () { return "?"; }).join(",");
  const rows = await env.DB.prepare("SELECT work_id, data FROM work_states WHERE storage_key='admin_panel' AND work_id IN (" + ph + ")").bind(...keys).all();
  const out = {};
  for (const r of (rows.results || [])) { try { out[r.work_id] = JSON.parse(r.data); } catch { out[r.work_id] = null; } }
  return out;
}

const isProd = (u) => !!u && (u.roles || []).some(function (r) { return PROD_ROLES.indexOf(r) >= 0; });

// Кто закреплён за объектом. u.objs на боевых данных почти всегда пуст, поэтому главный
// источник — ответственные в подписанном договоре; objs остаётся запасным вариантом.
function objTeam(st, oid) {
  const ids = new Set();
  (st.contractDocs || []).forEach(function (c) {
    if (c.objId !== oid) return;
    if (c.status !== "signed" && c.status !== "closed") return;
    (c.responsible || []).forEach(function (uid) { ids.add(uid); });
    Object.keys(c.deadlines || {}).forEach(function (uid) { ids.add(uid); });
  });
  (st.users || []).forEach(function (u) { if ((u.objs || []).indexOf(oid) >= 0) ids.add(u.id); });
  return ids;
}
const objName = (objects, oid) => { const o = (objects || []).find(function (x) { return x.id === oid; }); return o ? o.name : "объект"; };

// ─── 1. Дедлайны и просрочка (утро) ──────────────────────────────────────────
async function runDeadlines(env, st, today) {
  const people = await audience(env, st.users || [], "deadline");
  if (!people.length) return 0;
  let sent = 0;
  const hot = [];                                   // сводка для руководителей

  for (const c of (st.contractDocs || [])) {
    if (c.status !== "signed" && c.status !== "closed") continue;
    const dls = c.deadlines || {};
    for (const uid of Object.keys(dls)) {
      const info = deadlineInfo(c, uid, today);
      if (!info.has) continue;
      const isHot = info.overdue > 0 || info.daysLeft <= 3;
      if (!isHot) continue;
      const on = objName(st.objects, c.objId);
      const u = (st.users || []).find(function (x) { return x && x.id === uid; });
      hot.push({ uid: uid, name: u ? u.name : uid, obj: on, info: info });

      const mine = people.find(function (p) { return p.uid === uid; });
      if (mine) {
        const text = info.overdue > 0
          ? "🔴 <b>Просрочка по объекту «" + escapeHtml(on) + "»</b>\nДедлайн был " + info.deadline + ", просрочено рабочих дней: " + info.overdue + ".\nШтраф на сегодня: <b>" + money(info.fine) + "</b> (" + money(FINE_PER_DAY) + "/день)."
          : (info.daysLeft === 0
            ? "🟠 <b>Сегодня дедлайн по объекту «" + escapeHtml(on) + "»</b>\nПосле него начинает капать штраф " + money(FINE_PER_DAY) + " в день."
            : "🟡 <b>Дедлайн по объекту «" + escapeHtml(on) + "» через " + info.daysLeft + " раб. дн.</b>\nСрок: " + info.deadline + ".")
          + linkTo(env, "#obj=" + c.objId, "Открыть объект");
        if (await sendOnce(env, mine, "deadline", c.id + ":" + uid + ":" + today, text)) sent++;
      }
    }
  }

  if (hot.length) {
    const boss = people.filter(function (p) { return !isProd(p.user) || (p.user.roles || []).indexOf("prod_head") >= 0; });
    const lines = hot.map(function (x) {
      return (x.info.overdue > 0 ? "🔴 " : "🟡 ") + escapeHtml(x.name) + " · " + escapeHtml(x.obj) + " · "
        + (x.info.overdue > 0 ? "просрочка " + x.info.overdue + " дн, штраф " + money(x.info.fine) : "осталось " + x.info.daysLeft + " раб. дн");
    });
    for (const p of boss) {
      const digest = "📋 <b>Дедлайны производства</b>\n" + lines.join("\n") + linkTo(env, "#tab=assign", "Открыть объекты");
      if (await sendOnce(env, p, "deadline", "digest:" + today, digest)) sent++;
    }
  }
  return sent;
}

// ─── 2. Часы за день не записаны (вечер) ─────────────────────────────────────
async function runHours(env, st, today) {
  const people = await audience(env, st.users || [], "hours");
  if (!people.length) return 0;
  let sent = 0;

  for (const o of (st.objects || [])) {
    const works = (o.stages || []).flatMap(function (s) { return s.works || []; });
    const open = works.filter(function (w) { return !w.done; });
    if (!open.length) continue;                     // объект закрыт — тишина
    const logged = works.some(function (w) { return (w.timeLogs || []).some(function (l) { return l && l.date === today; }); });
    if (logged) continue;

    const team = objTeam(st, o.id);
    for (const p of people) {
      if (!isProd(p.user)) continue;
      if (!team.has(p.uid)) continue;                            // только свой объект
      const text = "⏱ <b>Часы за сегодня не записаны</b>\nОбъект: «" + escapeHtml(o.name) + "», открытых работ: " + open.length + "."
        + "\n<i>Без часов галочку «сделано» поставить нельзя.</i>"
        + linkTo(env, "#obj=" + o.id + "&view=receive", "Записать часы");
      if (await sendOnce(env, p, "hours", o.id + ":" + today, text)) sent++;
    }
  }
  return sent;
}

// ─── 3. Снабжение: не куплено / не принято (утро) ────────────────────────────
async function runSupply(env, st, today) {
  const people = await audience(env, st.users || [], "supply");
  if (!people.length) return 0;
  const purchased = st.purchased || {}, arrived = st.arrived || {};
  const sum = (arr) => arr.reduce(function (a, m) { return a + (m.cost || 0) * (m.qty || 1); }, 0);
  // «Не принято на складе» висит сотнями позиций месяцами (приёмку почти не отмечают) —
  // ежедневное повторение одной и той же цифры перестанут читать через день. Раз в неделю.
  const isMonday = new Date(today + "T00:00:00Z").getUTCDay() === 1;

  const rows = [];
  for (const o of (st.objects || [])) {
    const mats = (o.stages || []).flatMap(function (s) { return (s.works || []).flatMap(function (w) { return w.mats || []; }); });
    if (!mats.length) continue;
    const notBought = mats.filter(function (m) { return !purchased[m.id]; });
    const notArrived = isMonday ? mats.filter(function (m) { return purchased[m.id] && !arrived[m.id]; }) : [];
    if (!notBought.length && !notArrived.length) continue;
    rows.push({ oid: o.id, name: o.name, nb: notBought.length, nbSum: sum(notBought), na: notArrived.length, naSum: sum(notArrived) });
  }
  if (!rows.length) return 0;

  let sent = 0;
  for (const p of people) {
    const roles = p.user.roles || [];
    const isSupply = roles.indexOf("supply") >= 0 || roles.indexOf("admin") >= 0 || roles.indexOf("prod_head") >= 0;
    // Снабженец видит все объекты, бригадир — только свои. Одно письмо, а не по штуке на объект.
    const mine = isSupply ? rows : rows.filter(function (r) { return objTeam(st, r.oid).has(p.uid); });
    if (!mine.length) continue;
    const lines = mine.map(function (r) {
      const parts = [];
      if (r.nb) parts.push("не куплено " + r.nb + " поз. на " + money(r.nbSum));
      if (r.na) parts.push("не принято " + r.na + " поз. на " + money(r.naSum));
      return "• <b>" + escapeHtml(r.name) + "</b>: " + parts.join("; ");
    });
    const text = "📦 <b>Снабжение</b>\n" + lines.join("\n")
      + (isMonday ? "\n\n<i>«Не принято» — отметьте приёмку в «Снабжение → Приёмка на складе».</i>" : "")
      + linkTo(env, "#tab=supply", "Открыть снабжение");
    if (await sendOnce(env, p, "supply", "digest:" + today, text)) sent++;
  }
  return sent;
}

// ─── 4. Сводка дня (вечер) ───────────────────────────────────────────────────
async function runDaily(env, st, today) {
  const people = await audience(env, st.users || [], "daily");
  if (!people.length) return 0;

  const dayStart = new Date(today + "T00:00:00Z").getTime() - MSK_OFFSET_MS;   // полночь МСК в UTC
  let acts = [];
  try {
    const r = await env.DB.prepare("SELECT uname, section, action FROM audit_log WHERE ts>=?").bind(dayStart).all();
    acts = r.results || [];
  } catch { /* истории может не быть — сводка обойдётся без неё */ }

  const byUser = {};
  acts.forEach(function (a) { byUser[a.uname || "?"] = (byUser[a.uname || "?"] || 0) + 1; });
  const top = Object.keys(byUser).sort(function (a, b) { return byUser[b] - byUser[a]; }).slice(0, 4);

  let hours = 0, openTotal = 0;
  (st.objects || []).forEach(function (o) {
    (o.stages || []).forEach(function (s) {
      (s.works || []).forEach(function (w) {
        if (!w.done) openTotal++;
        (w.timeLogs || []).forEach(function (l) { if (l && l.date === today) hours += Number(l.hours) || 0; });
      });
    });
  });
  const doneToday = acts.filter(function (a) { return a.section === "objects"; }).length;

  const hot = [];
  (st.contractDocs || []).forEach(function (c) {
    if (c.status !== "signed" && c.status !== "closed") return;
    Object.keys(c.deadlines || {}).forEach(function (uid) {
      const i = deadlineInfo(c, uid, today);
      if (i.has && i.overdue > 0) hot.push(objName(st.objects, c.objId) + " (просрочка " + i.overdue + " дн)");
    });
  });

  const text = "🌙 <b>Итоги дня " + today + "</b>\n"
    + "Часы за сегодня: <b>" + (Math.round(hours * 10) / 10) + " ч</b>\n"
    + "Правок в портале: <b>" + acts.length + "</b>" + (doneToday ? " (по объектам: " + doneToday + ")" : "") + "\n"
    + (top.length ? "Активнее всех: " + top.map(function (n) { return escapeHtml(n) + " (" + byUser[n] + ")"; }).join(", ") + "\n" : "")
    + "Открытых работ всего: <b>" + openTotal + "</b>\n"
    + (hot.length ? "🔴 Горит: " + hot.map(escapeHtml).join(", ") : "✅ Просрочек нет")
    + linkTo(env, "#tab=history", "Открыть историю действий");

  let sent = 0;
  for (const p of people) if (await sendOnce(env, p, "daily", "sum:" + today, text)) sent++;
  return sent;
}

// ─── Точка входа для крона ───────────────────────────────────────────────────
// cronExpr — то, что пришло в scheduled(event.cron); разные часы = разные наборы.
export async function runReminders(env, cronExpr, diag) {
  await ensureNotifyTables(env);
  DIAG.length = 0;
  const today = mskToday();
  const st = await loadState(env, ["objects", "users", "contractDocs", "purchased", "arrived"]);
  DIAG.push("снимок: объектов " + ((st.objects || []).length) + ", сотрудников " + ((st.users || []).length) + ", договоров " + ((st.contractDocs || []).length) + ", дата " + today);
  let sent = 0;
  if (cronExpr === "0 6 * * *") {                    // 09:00 МСК — утро
    sent += await runDeadlines(env, st, today);
    sent += await runSupply(env, st, today);
  } else if (cronExpr === "0 16 * * *") {            // 19:00 МСК — вечер
    sent += await runHours(env, st, today);
  } else if (cronExpr === "0 17 * * *") {            // 20:00 МСК — сводка
    sent += await runDaily(env, st, today);
  }
  return diag ? { sent: sent, diag: DIAG.slice() } : sent;
}

// Ручной прогон из панели (админ): «а что бы ушло прямо сейчас».
export async function runRemindersNow(env, cronExpr) { return await runReminders(env, cronExpr); }
