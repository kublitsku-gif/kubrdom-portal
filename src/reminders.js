// ─── ЧТО И КОМУ НАПОМИНАТЬ ───────────────────────────────────────────────────
// Крон Worker'а ходит по UTC, а бригада живёт по Москве: все даты считаем в МСК (UTC+3),
// иначе «сегодня» на сервере наступает в 3 часа ночи по факту и вечерние проверки врут.
//
// Логика дедлайнов повторяет клиентскую (рабочие дни, штраф 2000 ₽/день): цифра в
// напоминании должна совпадать с тем, что человек видит в карточке объекта.

import { ensureNotifyTables, sendTg, defaultPrefs, escapeHtml } from "./notify.js";
import { stagesNeedingAttention } from "./stages.js";
import { pendingSelections } from "./supply.js";

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
export function deadlineInfo(c, uid, today) {
  const dl = (c && c.deadlines && c.deadlines[uid]) || {};
  const deadline = dl.deadline || (dl.startDate ? addBusinessDays(dl.startDate, 35) : "");
  if (!deadline) return { has: false };
  const daysLeft = today <= deadline ? countBusinessDaysBetween(today, deadline) : 0;
  const overdue = today > deadline ? countBusinessDaysBetween(deadline, today) : 0;
  return { has: true, deadline: deadline, daysLeft: daysLeft, overdue: overdue, fine: overdue * FINE_PER_DAY };
}

export const money = (v) => Math.round(v || 0).toLocaleString("ru-RU") + " ₽";

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
export function objTeam(st, oid) {
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

// ─── 1б. Сроки этапов ────────────────────────────────────────────────────────
// Дедлайн договора говорит про сдачу целиком и загорается, когда всё уже сорвано.
// Этап — то, чем стройка меряется на площадке: «этап 2 просрочен на 4 дня» видно
// за месяц до срыва сдачи. Состояние считает общий модуль (src/stages.js) — тот же,
// что рисует плашку в панели, иначе чат и экран разошлись бы.
async function runStages(env, st, today) {
  const hot = stagesNeedingAttention(st.objects || [], today);
  if (!hot.length) return 0;
  const people = await audience(env, st.users || [], "deadline");
  if (!people.length) return 0;
  let sent = 0;

  const line = function (x) {
    const nm = escapeHtml(x.obj.name || "объект") + " · " + escapeHtml(x.stage.n || "этап");
    if (x.sc.state === "overdue") return "🔴 " + nm + " — просрочен на " + x.sc.days + " раб. дн (план до " + x.sc.plan.end + ")";
    if (x.sc.state === "notStarted") return "🟠 " + nm + " — не начат, план с " + x.sc.plan.start;
    return "🟡 " + nm + " — осталось " + x.sc.left + " раб. дн (до " + x.sc.plan.end + ")";
  };

  // Тем, кто ведёт объект, — про их объекты; руководству — сводка по всем.
  for (const x of hot) {
    const team = objTeam(st, x.obj.id);
    for (const p of people) {
      if (!team.has(p.uid)) continue;
      const text = "🗓 <b>Срок этапа</b>\n" + line(x) + linkTo(env, "#obj=" + x.obj.id, "Открыть объект");
      if (await sendOnce(env, p, "deadline", "stage:" + x.stage.id + ":" + x.sc.state + ":" + today, text)) sent++;
    }
  }
  const boss = people.filter(function (p) { return !isProd(p.user) || (p.user.roles || []).indexOf("prod_head") >= 0; });
  if (boss.length) {
    const digest = "🗓 <b>Этапы по срокам</b>\n" + hot.slice(0, 10).map(line).join("\n")
      + (hot.length > 10 ? "\n… и ещё " + (hot.length - 10) : "")
      + linkTo(env, "#tab=assign", "Открыть объекты");
    for (const p of boss) {
      if (await sendOnce(env, p, "deadline", "stages:digest:" + today, digest)) sent++;
    }
  }
  return sent;
}

// ─── 1в. Выбор клиента не сделан ─────────────────────────────────────────────
// Плитку и печь клиент выбирает сам, и пока он не выбрал — этап стоит. Молчать нельзя:
// это единственный простой, который производство не может расшить своими силами.
async function runSelections(env, st, today) {
  const pend = pendingSelections(st.objects || [], today).filter(function (x) { return x.overdue || x.due; });
  if (!pend.length) return 0;
  const people = await audience(env, st.users || [], "deadline");
  if (!people.length) return 0;
  let sent = 0;
  // Пишем сопровождению: разговаривать с клиентом — их работа, а не бригадира.
  const escort = people.filter(function (p) {
    const r = (p.user && p.user.roles) || [];
    return r.indexOf("client_mgr") >= 0 || r.indexOf("admin") >= 0 || r.indexOf("prod_head") >= 0;
  });
  if (!escort.length) return 0;
  const late = pend.filter(function (x) { return x.overdue; });
  const lines = pend.slice(0, 10).map(function (x) {
    return (x.overdue ? "🔴 " : "🟡 ") + escapeHtml(x.obj.name || "объект") + " · " + escapeHtml(x.mat.n || "позиция")
      + (x.due ? (x.overdue ? " — срок вышел " + x.due : " — выбрать до " + x.due) : "");
  });
  const text = "🎨 <b>Клиент ещё не выбрал</b>" + (late.length ? " · просрочено: " + late.length : "") + "\n"
    + lines.join("\n") + (pend.length > 10 ? "\n… и ещё " + (pend.length - 10) : "")
    + linkTo(env, "#tab=supply", "Открыть снабжение");
  for (const p of escort) {
    if (await sendOnce(env, p, "deadline", "sel:" + today + ":" + pend.length + ":" + late.length, text)) sent++;
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

// ─── 4. Финансы: долг клиентов и зарплата к выплате ──────────────────────────
// Эти суммы меняются раз в несколько дней, а не ежечасно. Поэтому проверяем ежедневно,
// но КЛЮЧ дедупликации содержит хеш самих цифр: пока ничего не изменилось, повторное
// сообщение не уйдёт вообще, а как только цифра сдвинулась — придёт в то же утро.
function hashNums(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function runFinance(env, st) {
  const people = await audience(env, st.users || [], "finance");
  if (!people.length) return 0;
  const txns = st.finTxns || [];
  const docs = (st.contractDocs || []).filter(function (c) { return c.status === "signed" || c.status === "closed"; });
  if (!docs.length) return 0;

  const sumBy = (pred) => txns.filter(pred).reduce(function (a, t) { return a + (Number(t.amount) || 0); }, 0);
  const debts = [];
  let salPlan = 0, salPaid = 0;

  docs.forEach(function (c) {
    const income = sumBy(function (t) { return t.type === "income" && t.contractId === c.id; });
    const left = (Number(c.amount) || 0) - income;
    if (left > 0) debts.push({ name: c.name || "Договор", obj: objName(st.objects, c.objId), left: left, amount: Number(c.amount) || 0, paid: income });
    Object.keys(c.salaries || {}).forEach(function (uid) { salPlan += Number((c.salaries[uid] || {}).plan) || 0; });
    salPaid += sumBy(function (t) { return t.type === "expense" && t.contractId === c.id && /Зарплата/i.test(String(t.category || "")); });
  });

  debts.sort(function (a, b) { return b.left - a.left; });
  const debtTotal = debts.reduce(function (a, d) { return a + d.left; }, 0);
  const salLeft = Math.max(0, salPlan - salPaid);
  if (!debtTotal && !salLeft) return 0;

  const top = debts.slice(0, 5);
  const lines = top.map(function (d) {
    return "• <b>" + escapeHtml(d.obj) + "</b>: " + money(d.left) + " из " + money(d.amount);
  });
  const text = "💰 <b>Финансы</b>\n"
    + "Клиенты должны: <b>" + money(debtTotal) + "</b>" + (debts.length > 5 ? " (показаны 5 крупнейших из " + debts.length + ")" : "") + "\n"
    + lines.join("\n")
    + "\n\nЗарплата к выплате: <b>" + money(salLeft) + "</b> (план " + money(salPlan) + ", выплачено " + money(salPaid) + ")"
    + linkTo(env, "#tab=finance", "Открыть финансы");

  // Хеш цифр в ключе: сообщение повторится только когда суммы реально изменятся.
  const key = "fin:" + hashNums(String(debtTotal) + ":" + salLeft + ":" + debts.length);
  let sent = 0;
  for (const p of people) {
    const r = p.user.roles || [];
    const canFin = r.indexOf("admin") >= 0 || r.indexOf("financier") >= 0;
    if (!canFin) continue;         // личные деньги сотрудник смотрит кнопкой «💰 Финансы» в боте
    if (await sendOnce(env, p, "finance", key, text)) sent++;
  }
  return sent;
}

// ─── 5. Сводка дня (вечер) ───────────────────────────────────────────────────
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

  // Вопросы в сводке: важно не «сколько всего», а «сколько ждёт самый старый» —
  // именно это отличает рабочий день от остановленной стройки.
  const openIss = (st.issues || []).filter(issueOpen);
  let issOldest = 0;
  openIss.forEach(function (t) {
    const f = String(t.at || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return;
    const a = countBusinessDaysBetween(f, today);
    if (a > issOldest) issOldest = a;
  });

  const text = "🌙 <b>Итоги дня " + today + "</b>\n"
    + "Часы за сегодня: <b>" + (Math.round(hours * 10) / 10) + " ч</b>\n"
    + "Правок в портале: <b>" + acts.length + "</b>" + (doneToday ? " (по объектам: " + doneToday + ")" : "") + "\n"
    + (top.length ? "Активнее всех: " + top.map(function (n) { return escapeHtml(n) + " (" + byUser[n] + ")"; }).join(", ") + "\n" : "")
    + "Открытых работ всего: <b>" + openTotal + "</b>\n"
    + (openIss.length ? "❓ Вопросов без ответа: <b>" + openIss.length + "</b>"
        + (issOldest >= 2 ? " (старший ждёт " + issOldest + " раб. дн)" : "") + "\n" : "")
    + (hot.length ? "🔴 Горит: " + hot.map(escapeHtml).join(", ") : "✅ Просрочек нет")
    + linkTo(env, "#tab=history", "Открыть историю действий");

  let sent = 0;
  for (const p of people) if (await sendOnce(env, p, "daily", "sum:" + today, text)) sent++;
  return sent;
}

// ─── ВОПРОСЫ С ОБЪЕКТА: эскалация по возрасту ────────────────────────────────
// Вопрос без ответа стареет и всплывает сам. Без этого любой список тикетов за месяц
// превращается в свалку, где красный бейдж горит всегда и его перестают замечать.
// Пороги: 2 рабочих дня — напоминание адресату, 5 — подъём начальнику производства.
// Считаем РАБОЧИМИ днями в МСК, тем же countBusinessDaysBetween, что и дедлайны:
// цифра в напоминании обязана совпадать с цифрой в панели.
const ISSUE_NUDGE_DAYS = 2;
const ISSUE_ESCALATE_DAYS = 5;
const ISSUE_ADDR_NAME = {
  supply: "снабженцу", client_mgr: "сопровождению", brigadier: "бригадиру",
  prod_head: "начальнику производства", financier: "финансисту", admin: "администратору",
};
// Держать в синхроне с ISSUE_KIND в public/admin.js и KINDS в src/botissue.js.
const ISSUE_KIND_TO = { supply: "supply", change: "client_mgr", question: "brigadier", money: "financier", matchg: "financier" };
const issueRole = (t) => (t && t.to) || ISSUE_KIND_TO[t && t.kind] || "admin";
const issueOpen = (t) => t && t.status !== "done" && t.status !== "rejected";

async function runIssues(env, st, today) {
  const list = (st.issues || []).filter(issueOpen);
  if (!list.length) return 0;
  const people = await audience(env, st.users || [], "issues");
  if (!people.length) return 0;
  const byUid = {};
  people.forEach(function (p) { byUid[p.uid] = p; });

  // Кто отвечает: носители роли на ЭТОМ объекте, иначе — все носители роли.
  // Молча проглотить вопрос нельзя: он повиснет там, где ответственных не расставили.
  const addressees = function (t) {
    const role = issueRole(t);
    const team = objTeam(st, t.objId);
    const withRole = (st.users || []).filter(function (u) { return (u.roles || []).indexOf(role) >= 0; });
    const onObj = withRole.filter(function (u) { return team.has(u.id); });
    return (onObj.length ? onObj : withRole).map(function (u) { return u.id; });
  };

  let sent = 0;
  for (const t of list) {
    const from = String(t.at || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) continue;
    const age = countBusinessDaysBetween(from, today);
    if (age < ISSUE_NUDGE_DAYS) continue;
    const hot = age >= ISSUE_ESCALATE_DAYS;
    const to = addressees(t);
    const head = (hot ? "🔴" : "🟠") + " <b>Вопрос без ответа " + age + " раб. дн</b>\n"
      + "«" + escapeHtml(objName(st.objects, t.objId)) + "»\n"
      + escapeHtml(String(t.text || "").slice(0, 300)) + "\n"
      + "<i>Задал " + escapeHtml(t.byName || "—") + " · " + escapeHtml(from) + "</i>";

    // Ключ с датой: пока вопрос висит, напоминание повторяется каждый день, но не дважды.
    const key = "iss:" + t.id + ":" + today;
    for (const uid of to) {
      const who = byUid[uid];
      if (!who) continue;
      if (await sendOnce(env, who, "issues", key, head + linkTo(env, "#tab=issues", "Ответить в портале"))) sent++;
    }
    if (!hot) continue;

    // Подъём наверх. Начальник производства и админ могут переадресовать или
    // передоговориться; адресат к этому моменту получил уже три напоминания.
    const bosses = (st.users || []).filter(function (u) {
      const r = u.roles || [];
      return r.indexOf("prod_head") >= 0 || r.indexOf("admin") >= 0;
    }).map(function (u) { return u.id; });
    for (const uid of bosses) {
      const who = byUid[uid];
      if (!who || to.indexOf(uid) >= 0) continue;   // адресату уже ушло выше
      if (await sendOnce(env, who, "issues", key + ":esc", head
        + "\n\nАдресовано " + (ISSUE_ADDR_NAME[issueRole(t)] || "—") + ", ответа нет " + age + " раб. дн."
        + linkTo(env, "#tab=issues", "Открыть вопросы"))) sent++;
    }
    // Автору: он вправе знать, что вопрос не забыт, а поднят наверх.
    const author = byUid[t.by];
    if (author && await sendOnce(env, author, "issues", key + ":auth",
      "🔴 <b>Ваш вопрос ждёт " + age + " раб. дн</b>\n«" + escapeHtml(objName(st.objects, t.objId)) + "»\n"
      + escapeHtml(String(t.text || "").slice(0, 200)) + "\n\nПоднял начальнику производства."
      + linkTo(env, "#tab=issues", "Открыть вопросы"))) sent++;
  }
  return sent;
}

// ─── Точка входа для крона ───────────────────────────────────────────────────
// cronExpr — то, что пришло в scheduled(event.cron); разные часы = разные наборы.
export async function runReminders(env, cronExpr, diag) {
  await ensureNotifyTables(env);
  DIAG.length = 0;
  const today = mskToday();
  const st = await loadState(env, ["objects", "users", "contractDocs", "purchased", "arrived", "finTxns", "issues"]);
  DIAG.push("снимок: объектов " + ((st.objects || []).length) + ", сотрудников " + ((st.users || []).length) + ", договоров " + ((st.contractDocs || []).length) + ", дата " + today);
  let sent = 0;
  if (cronExpr === "0 6 * * *") {                    // 09:00 МСК — утро
    sent += await runDeadlines(env, st, today);
    sent += await runStages(env, st, today);
    sent += await runSelections(env, st, today);
    sent += await runSupply(env, st, today);
    sent += await runIssues(env, st, today);
    sent += await runFinance(env, st);
  } else if (cronExpr === "0 16 * * *") {            // 19:00 МСК — вечер
    sent += await runHours(env, st, today);
  } else if (cronExpr === "0 17 * * *") {            // 20:00 МСК — сводка
    sent += await runDaily(env, st, today);
  }
  return diag ? { sent: sent, diag: DIAG.slice() } : sent;
}

// Ручной прогон из панели (админ): «а что бы ушло прямо сейчас».
export async function runRemindersNow(env, cronExpr) { return await runReminders(env, cronExpr); }
