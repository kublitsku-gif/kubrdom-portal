// ─── ПРОСМОТР ПОРТАЛА ИЗ БОТА ────────────────────────────────────────────────
// Кнопки «Финансы», «Снабжение», «Объекты» — те же цифры, что в напоминаниях, но по
// запросу. Расчёты берём из reminders.js (deadlineInfo, money), чтобы сводка в боте и
// напоминание не расходились в числах: одна формула — один ответ.

import { sendTg, escapeHtml } from "./notify.js";
import { deadlineInfo, objTeam, money, mskToday } from "./reminders.js";

const has = (roles, list) => (roles || []).some(function (r) { return list.indexOf(r) >= 0; });
const canFin = (roles) => has(roles, ["admin", "financier"]);
const canSupply = (roles) => has(roles, ["admin", "financier", "supply", "prod_head", "brigadier", "worker"]);

async function snap(env, keys) {
  const ph = keys.map(function () { return "?"; }).join(",");
  const rows = await env.DB.prepare("SELECT work_id, data FROM work_states WHERE storage_key='admin_panel' AND work_id IN (" + ph + ")").bind(...keys).all();
  const out = {};
  for (const r of (rows.results || [])) { try { out[r.work_id] = JSON.parse(r.data); } catch { out[r.work_id] = null; } }
  return out;
}
function link(env, hash, label) {
  const base = (env.PUBLIC_BASE_URL || "https://portal.kubrdom.ru").replace(/\/+$/, "");
  return '\n\n👉 <a href="' + base + "/admin" + hash + '">' + label + "</a>";
}
// Объекты, которые человек вправе видеть: админ и снабжение — все, производство — свои.
function visibleObjects(st, uid, roles) {
  const all = st.objects || [];
  if (has(roles, ["admin", "financier", "supply", "prod_head"])) return all;
  return all.filter(function (o) { return objTeam(st, o.id).has(uid); });
}
function objStats(st, o) {
  const works = (o.stages || []).flatMap(function (s) { return s.works || []; });
  const done = works.filter(function (w) { return w.done; });
  const mats = works.flatMap(function (w) { return w.mats || []; });
  const purchased = st.purchased || {}, arrived = st.arrived || {};
  const cost = works.reduce(function (a, w) { return a + (w.cost || 0); }, 0);
  const doneCost = done.reduce(function (a, w) { return a + (w.cost || 0); }, 0);
  return {
    works: works.length, done: done.length, cost: cost, doneCost: doneCost,
    pct: cost > 0 ? Math.round(doneCost / cost * 100) : 0,
    mats: mats.length,
    bought: mats.filter(function (m) { return purchased[m.id]; }).length,
    notArrived: mats.filter(function (m) { return purchased[m.id] && !arrived[m.id]; }).length,
    notBoughtSum: mats.filter(function (m) { return !purchased[m.id]; }).reduce(function (a, m) { return a + (m.cost || 0) * (m.qty || 1); }, 0),
    pay: works.reduce(function (a, w) { return a + (Number(w.pay) || 0); }, 0),
  };
}

// ─── 💰 Финансы ──────────────────────────────────────────────────────────────
export async function viewFinance(env, chat, roles) {
  if (!canFin(roles)) return await sendTg(env, chat, "Финансы доступны администратору и финансисту.");
  const st = await snap(env, ["objects", "contractDocs", "finTxns", "users"]);
  const docs = (st.contractDocs || []).filter(function (c) { return c.status === "signed" || c.status === "closed"; });
  const txns = st.finTxns || [];
  const sum = (pred) => txns.filter(pred).reduce(function (a, t) { return a + (Number(t.amount) || 0); }, 0);
  const objName = (oid) => { const o = (st.objects || []).find(function (x) { return x.id === oid; }); return o ? o.name : "объект"; };

  let debtTotal = 0, salPlan = 0, salPaid = 0;
  const rows = [];
  docs.forEach(function (c) {
    const inc = sum(function (t) { return t.type === "income" && t.contractId === c.id; });
    const left = (Number(c.amount) || 0) - inc;
    if (left > 0) { debtTotal += left; rows.push({ n: objName(c.objId), left: left, amount: Number(c.amount) || 0 }); }
    Object.keys(c.salaries || {}).forEach(function (uid) { salPlan += Number((c.salaries[uid] || {}).plan) || 0; });
    salPaid += sum(function (t) { return t.type === "expense" && t.contractId === c.id && /Зарплата|Премия|Доп\. работы/i.test(String(t.category || "")); });
  });
  rows.sort(function (a, b) { return b.left - a.left; });

  const income = sum(function (t) { return t.type === "income"; });
  const expense = sum(function (t) { return t.type === "expense"; });
  const text = "💰 <b>Финансы</b> · " + mskToday() + "\n\n"
    + "Приход: <b>" + money(income) + "</b>\nРасход: <b>" + money(expense) + "</b>\nОстаток: <b>" + money(income - expense) + "</b>\n\n"
    + "Клиенты должны: <b>" + money(debtTotal) + "</b>\n"
    + rows.slice(0, 6).map(function (r) { return "• " + escapeHtml(r.n) + ": " + money(r.left) + " из " + money(r.amount); }).join("\n")
    + "\n\nЗарплата к выплате: <b>" + money(Math.max(0, salPlan - salPaid)) + "</b> (план " + money(salPlan) + ", выплачено " + money(salPaid) + ")"
    + link(env, "#tab=finance", "Открыть финансы");
  return await sendTg(env, chat, text);
}

// ─── 📦 Снабжение ────────────────────────────────────────────────────────────
export async function viewSupply(env, chat, uid, roles) {
  if (!canSupply(roles)) return await sendTg(env, chat, "Снабжение вам недоступно.");
  const st = await snap(env, ["objects", "contractDocs", "users", "purchased", "arrived"]);
  const objs = visibleObjects(st, uid, roles);
  if (!objs.length) return await sendTg(env, chat, "Объектов не найдено.");
  let nb = 0, na = 0, nbSum = 0;
  const lines = objs.map(function (o) {
    const s = objStats(st, o);
    nb += (s.mats - s.bought); na += s.notArrived; nbSum += s.notBoughtSum;
    return "• <b>" + escapeHtml(o.name) + "</b>: куплено " + s.bought + "/" + s.mats
      + (s.notArrived ? " · не принято " + s.notArrived : "")
      + (s.mats - s.bought ? " · осталось купить на " + money(s.notBoughtSum) : " ✅");
  });
  const text = "📦 <b>Снабжение</b> · " + mskToday() + "\n\n" + lines.join("\n")
    + "\n\nИтого не куплено: <b>" + nb + " поз. на " + money(nbSum) + "</b>"
    + (na ? "\nНе принято на складе: <b>" + na + " поз.</b>" : "")
    + link(env, "#tab=supply", "Открыть снабжение");
  return await sendTg(env, chat, text);
}

// ─── 🏗 Объекты ──────────────────────────────────────────────────────────────
export async function viewObjects(env, chat, uid, roles) {
  const st = await snap(env, ["objects", "contractDocs", "users", "purchased", "arrived"]);
  const objs = visibleObjects(st, uid, roles);
  if (!objs.length) return await sendTg(env, chat, "За вами не закреплено ни одного объекта.");
  const lines = objs.map(function (o) {
    const s = objStats(st, o);
    return "• <b>" + escapeHtml(o.name) + "</b> — " + s.done + "/" + s.works + " работ" + (canFin(roles) ? " · " + s.pct + "%" : "");
  });
  const rows = objs.slice(0, 8).map(function (o) { return [{ text: o.name, callback_data: "v:obj:" + o.id }]; });
  return await sendTg(env, chat, "🏗 <b>Объекты</b>\n\n" + lines.join("\n") + "\n\nВыберите объект для подробностей:",
    { reply_markup: { inline_keyboard: rows } });
}

export async function viewObject(env, chat, oid, uid, roles) {
  const st = await snap(env, ["objects", "contractDocs", "users", "purchased", "arrived", "finTxns"]);
  const o = (st.objects || []).find(function (x) { return x.id === oid; });
  if (!o) return await sendTg(env, chat, "Объект не найден.");
  if (!visibleObjects(st, uid, roles).some(function (x) { return x.id === oid; })) return await sendTg(env, chat, "Этот объект вам недоступен.");
  const s = objStats(st, o);
  const today = mskToday();

  const dls = [];
  (st.contractDocs || []).forEach(function (c) {
    if (c.objId !== oid || (c.status !== "signed" && c.status !== "closed")) return;
    Object.keys(c.deadlines || {}).forEach(function (duid) {
      const i = deadlineInfo(c, duid, today);
      if (!i.has) return;
      const u = (st.users || []).find(function (x) { return x.id === duid; });
      dls.push((i.overdue > 0 ? "🔴 " : i.daysLeft <= 3 ? "🟡 " : "🟢 ") + escapeHtml((u && u.name) || duid) + " · "
        + (i.overdue > 0 ? "просрочка " + i.overdue + " дн, штраф " + money(i.fine) : "осталось " + i.daysLeft + " раб. дн до " + i.deadline));
    });
  });

  const text = "🏗 <b>" + escapeHtml(o.name) + "</b>\n\n"
    + "Работы: <b>" + s.done + " из " + s.works + "</b>" + (canFin(roles) ? " · " + s.pct + "% по деньгам" : "") + "\n"
    + (canFin(roles) ? "Закрыто: <b>" + money(s.doneCost) + "</b> из " + money(s.cost) + "\n" : "")
    + "Материалы: куплено <b>" + s.bought + "/" + s.mats + "</b>" + (s.notArrived ? ", не принято " + s.notArrived : "") + "\n"
    + (s.pay ? "Оплата бригаде по работам: <b>" + money(s.pay) + "</b>\n" : "")
    + (dls.length ? "\n" + dls.join("\n") : "")
    + link(env, "#obj=" + oid, "Открыть объект");
  return await sendTg(env, chat, text);
}

// ─── Роутер: текстовые кнопки и inline-нажатия просмотра ─────────────────────
export async function viewText(env, uid, chat, text, roles) {
  const t = String(text || "").trim();
  if (/^💰|^финанс/i.test(t)) { await viewFinance(env, chat, roles); return true; }
  if (/^📦|^снабжен/i.test(t)) { await viewSupply(env, chat, uid, roles); return true; }
  if (/^🏗|^объект/i.test(t)) { await viewObjects(env, chat, uid, roles); return true; }
  return false;
}
export async function viewCallback(env, uid, chat, data, roles) {
  const parts = String(data || "").split(":");
  if (parts[0] !== "v") return false;
  if (parts[1] === "obj") { await viewObject(env, chat, parts[2], uid, roles); return true; }
  return false;
}
