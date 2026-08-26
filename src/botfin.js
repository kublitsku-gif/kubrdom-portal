// ─── ВНЕСЕНИЕ ФИНАНСОВ ЧЕРЕЗ БОТА ────────────────────────────────────────────
// Мастер на кнопках (категория → объект → получатель → сумма → подтверждение) плюс
// быстрая строка «зп Валера 50000». Записывает в тот же раздел снимка finTxns, что
// редактирует панель: строка обновляется с новым updated_at, поэтому стейл-вкладка
// получит 409 от postState и подтянет свежие данные, а не затрёт запись.
//
// Транзакции бота ВСЕГДА содержат userId — панель умеет его учитывать («моя зарплата»),
// но руками его никто не проставляет, и выплаты делятся между людьми поровну наугад.

import { sendTg, escapeHtml } from "./notify.js";
import { logEvent } from "./audit.js";
import { objTeam } from "./reminders.js";

const TG_API = "https://api.telegram.org/bot";
const MSK_OFFSET_MS = 3 * 3600 * 1000;
const PROD_ROLES = ["brigadier", "worker", "prod_head"];
const ESCORT_ROLES = ["client_mgr", "sales_head", "sales_mgr", "contract_mgr"];

// Категории повторяют FIN_EXPENSE_CATS/FIN_INCOME_CATS панели дословно: запись из бота
// должна быть неотличима от сделанной руками, иначе она выпадет из группировок.
export const FIN_CATS = [
  { k: "avans",  cat: "💰 Аванс клиента",          type: "income",  who: null,     roles: ["admin", "financier"] },
  { k: "final",  cat: "💰 Окончательный расчёт",   type: "income",  who: null,     roles: ["admin", "financier"] },
  { k: "salpr",  cat: "👷 Зарплата производства",  type: "expense", who: "prod",   roles: ["admin", "financier"] },
  { k: "salesc", cat: "🚚 Зарплата сопроводителя", type: "expense", who: "escort", roles: ["admin", "financier"] },
  { k: "supply", cat: "📦 Закупка материалов",     type: "expense", who: null,     roles: ["admin", "financier", "supply"] },
  { k: "fine",   cat: "⚠️ Штраф просрочка",        type: "expense", who: "prod",   roles: ["admin", "financier"] },
];

const money = (v) => Math.round(v || 0).toLocaleString("ru-RU") + " ₽";
const mskToday = () => new Date(Date.now() + MSK_OFFSET_MS).toISOString().slice(0, 10);
const catByKey = (k) => FIN_CATS.find(function (c) { return c.k === k; });
const canUse = (roles, c) => c.roles.some(function (r) { return (roles || []).indexOf(r) >= 0; });

let _ready = false;
async function ensureDialog(env) {
  if (_ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tg_dialog (uid TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
  _ready = true;
}
async function getDialog(env, uid) {
  await ensureDialog(env);
  const r = await env.DB.prepare("SELECT state FROM tg_dialog WHERE uid=?").bind(uid).first();
  if (!r || !r.state) return null;
  try { return JSON.parse(r.state); } catch { return null; }
}
async function setDialog(env, uid, st) {
  await ensureDialog(env);
  if (!st) { await env.DB.prepare("DELETE FROM tg_dialog WHERE uid=?").bind(uid).run(); return; }
  await env.DB.prepare("INSERT INTO tg_dialog (uid, state, updated_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at")
    .bind(uid, JSON.stringify(st), Date.now()).run();
}

async function snapshot(env, keys) {
  const ph = keys.map(function () { return "?"; }).join(",");
  const rows = await env.DB.prepare("SELECT work_id, data FROM work_states WHERE storage_key='admin_panel' AND work_id IN (" + ph + ")").bind(...keys).all();
  const out = {};
  for (const r of (rows.results || [])) { try { out[r.work_id] = JSON.parse(r.data); } catch { out[r.work_id] = null; } }
  return out;
}

async function kb(env, chat, text, rows) {
  return await sendTg(env, chat, text, { reply_markup: { inline_keyboard: rows } });
}
export async function answerCb(env, id) {
  try { await fetch(TG_API + env.TG_BOT_TOKEN + "/answerCallbackQuery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: id }) }); } catch { /* не критично */ }
}

// Активные объекты = подписанные договоры. Транзакции привязываем и к объекту, и к договору:
// финансовые отчёты панели считают то по contractId, то по objId.
function activeObjects(st) {
  const out = [];
  (st.contractDocs || []).forEach(function (c) {
    if (c.status !== "signed" && c.status !== "closed") return;
    if (!c.objId) return;
    const o = (st.objects || []).find(function (x) { return x.id === c.objId; });
    out.push({ objId: c.objId, contractId: c.id, name: (o && o.name) || c.name || "Объект" });
  });
  return out;
}
// Выплачено этому человеку по договору. Повторяет getSalaryPaid() панели ОДИН В ОДИН:
// помеченные его userId транзакции плюс доля непомеченных, поделённая поровну между
// ответственными той же группы. Иначе бот показывал бы одну сумму, а портал — другую.
function txnGroup(cat) {
  const c = String(cat || "");
  if (c.indexOf("👷") === 0) return "salary_prod";
  if (c.indexOf("🚚") === 0) return "salary_escort";
  if (c.indexOf("🛠") === 0) return "salary_prod_extra";
  if (c.indexOf("🧹") === 0) return "salary_prod_bonus";
  return "other";
}
export function salaryPaid(st, contract, user) {
  if (!contract || !user) return 0;
  const txns = st.finTxns || [];
  const grp = (user.roles || []).indexOf("sales_head") >= 0 ? "salary_escort" : "salary_prod";
  const mine = txns.filter(function (t) { return t.type === "expense" && t.contractId === contract.id && t.userId === user.id && txnGroup(t.category) === grp; });
  let total = mine.reduce(function (a, t) { return a + (Number(t.amount) || 0); }, 0);

  const untagged = txns.filter(function (t) { return t.type === "expense" && t.contractId === contract.id && !t.userId && txnGroup(t.category) === grp; });
  if (untagged.length) {
    const resp = contract.responsible || [];
    const eligible = (st.users || []).filter(function (u) {
      if (resp.indexOf(u.id) < 0) return false;
      if (grp === "salary_escort") return (u.roles || []).indexOf("sales_head") >= 0;
      return (u.roles || []).some(function (r) { return r === "brigadier" || r === "worker"; });
    });
    if (eligible.length && eligible.some(function (u) { return u.id === user.id; })) {
      total += Math.round(untagged.reduce(function (a, t) { return a + (Number(t.amount) || 0); }, 0) / eligible.length);
    }
  }
  return total;
}
export function salaryPlan(contract, uid) { return Number(((contract && contract.salaries) || {})[uid] && contract.salaries[uid].plan) || 0; }
function contractOf(st, objId) {
  return (st.contractDocs || []).find(function (c) { return c.objId === objId && (c.status === "signed" || c.status === "closed"); });
}

function peopleFor(st, kind) {
  const want = kind === "escort" ? ESCORT_ROLES : PROD_ROLES;
  return (st.users || []).filter(function (u) { return (u.roles || []).some(function (r) { return want.indexOf(r) >= 0; }); });
}

// ─── Шаги мастера ────────────────────────────────────────────────────────────
async function askCategory(env, chat, roles) {
  const allowed = FIN_CATS.filter(function (c) { return canUse(roles, c); });
  if (!allowed.length) return await sendTg(env, chat, "У вас нет прав вносить финансы.");
  const rows = allowed.map(function (c) { return [{ text: c.cat, callback_data: "f:cat:" + c.k }]; });
  rows.push([{ text: "✕ Отмена", callback_data: "f:cancel" }]);
  return await kb(env, chat, "💵 <b>Что вносим?</b>", rows);
}
const k = (v) => Math.round((v || 0) / 1000) + "к";

// Кто закреплён за объектом: ответственные, у кого дедлайн, и те, кому задан план зарплаты.
function objPeople(st, objId, kind) {
  const team = objTeam(st, objId);
  (st.contractDocs || []).forEach(function (c) {
    if (c.objId !== objId) return;
    Object.keys(c.salaries || {}).forEach(function (u) { team.add(u); });
  });
  return peopleFor(st, kind).filter(function (u) { return team.has(u.id); });
}

// Шаг выбора объекта показывает то, что нужно ИМЕННО для этой категории: для зарплаты —
// кто на объекте и сколько ему выплачено, для прихода — сколько клиент ещё должен.
async function askObject(env, chat, st, catKey) {
  const objs = activeObjects(st);
  if (!objs.length) return await sendTg(env, chat, "Нет подписанных договоров — не к чему привязать запись.");
  const c = catByKey(catKey);
  const kind = c && c.who;
  const isIncome = c && c.type === "income";
  const lines = [], rows = [];

  objs.forEach(function (o) {
    const doc = contractOf(st, o.objId);
    let tail = "", note = "";
    if (kind) {
      const ppl = objPeople(st, o.objId, kind);
      let plan = 0, paid = 0;
      ppl.forEach(function (u) { plan += salaryPlan(doc, u.id); paid += salaryPaid(st, doc, u); });
      const names = ppl.map(function (u) { return (u.av || "👤") + " " + u.name; }).join(", ") || "никто не назначен";
      tail = plan ? " · " + k(paid) + " из " + k(plan) : (paid ? " · " + k(paid) : "");
      note = " — " + names + (plan ? " · выплачено " + money(paid) + " из " + money(plan)
        : (paid ? " · выплачено " + money(paid) + " (плана нет)" : " · план не задан"));
    } else if (isIncome && doc) {
      const inc = (st.finTxns || []).filter(function (t) { return t.type === "income" && t.contractId === doc.id; })
        .reduce(function (a, t) { return a + (Number(t.amount) || 0); }, 0);
      const left = Math.max(0, (Number(doc.amount) || 0) - inc);
      tail = left ? " · долг " + k(left) : " · оплачен";
      note = left ? " — клиент должен " + money(left) + " из " + money(doc.amount || 0) : " — оплачен полностью";
    }
    lines.push("• <b>" + escapeHtml(o.name) + "</b>" + escapeHtml(note));
    rows.push([{ text: o.name + tail, callback_data: "f:obj:" + o.objId }]);
  });
  rows.push([{ text: "✕ Отмена", callback_data: "f:cancel" }]);
  return await kb(env, chat, "🏗 <b>По какому объекту?</b>\n" + lines.join("\n"), rows);
}
async function askWho(env, chat, st, kind, objId) {
  const all = peopleFor(st, kind);
  if (!all.length) return await sendTg(env, chat, "Не нашёл, кому платить — в портале нет людей с нужной ролью.");
  // Показываем только тех, кто закреплён за этим объектом: ответственные в договоре и те,
  // кому в нём задан план или дедлайн. Иначе в списке весь штат, и легко заплатить не тому.
  const scoped = objId ? objPeople(st, objId, kind) : all;
  const ppl = scoped.length ? scoped : all;      // никто не назначен — лучше показать всех, чем тупик
  const c = contractOf(st, objId);
  const rows = ppl.map(function (u) {
    const plan = salaryPlan(c, u.id);
    const paid = c ? salaryPaid(st, c, u) : 0;
    // Сумму по объекту показываем прямо на кнопке: видно ДО ввода суммы, кому сколько осталось.
    const tail = plan ? " · " + Math.round(paid / 1000) + "к из " + Math.round(plan / 1000) + "к"
      : (paid ? " · выплачено " + Math.round(paid / 1000) + "к" : "");
    return [{ text: (u.av || "👤") + " " + u.name + tail, callback_data: "f:who:" + u.id }];
  });
  rows.push([{ text: "✕ Отмена", callback_data: "f:cancel" }]);
  const c2 = scoped.length
    ? (c ? "\n<i>Показано: выплачено из плана по этому объекту.</i>" : "")
    : "\n<i>В договоре объекта никто не назначен — показаны все.</i>";
  return await kb(env, chat, "👤 <b>Кому?</b>" + c2, rows);
}
async function askAmount(env, chat) {
  return await sendTg(env, chat, "💰 <b>Сумма?</b>\nНапишите числом, например: <code>50000</code>");
}
async function askConfirm(env, chat, st, d) {
  const c = catByKey(d.cat);
  const o = activeObjects(st).find(function (x) { return x.objId === d.objId; });
  const u = (st.users || []).find(function (x) { return x.id === d.userId; });
  let tail = "";
  if (u && (c.k === "salpr" || c.k === "salesc")) {
    const doc = contractOf(st, d.objId);
    const plan = salaryPlan(doc, u.id), paid = doc ? salaryPaid(st, doc, u) : 0;
    const after = paid + Math.round(d.amount);
    tail = "\n\n" + escapeHtml(u.name) + " по этому объекту:\n"
      + "было выплачено <b>" + money(paid) + "</b>" + (plan ? " из " + money(plan) : "") + "\n"
      + "станет <b>" + money(after) + "</b>"
      + (plan ? (after > plan
        ? " — <b>перебор на " + money(after - plan) + "</b>"
        : ", останется " + money(plan - after)) : "");
  }
  const text = "Проверьте запись:\n\n" + c.cat + "\n"
    + (o ? "Объект: <b>" + escapeHtml(o.name) + "</b>\n" : "")
    + (u ? "Кому: <b>" + escapeHtml(u.name) + "</b>\n" : "")
    + "Сумма: <b>" + money(d.amount) + "</b>\nДата: " + mskToday() + tail;
  return await kb(env, chat, text, [[{ text: "✅ Записать", callback_data: "f:ok" }, { text: "✕ Отмена", callback_data: "f:cancel" }]]);
}

// Следующий недостающий шаг. Одна функция и для мастера, и для быстрой строки —
// иначе разбор строки и кнопки разъедутся в поведении.
async function advance(env, chat, st, d, uid) {
  const c = catByKey(d.cat);
  if (!c) { await setDialog(env, uid, null); return await askCategory(env, chat, d.roles); }
  if (!d.objId) { await setDialog(env, uid, d); return await askObject(env, chat, st, d.cat); }
  if (c.who && !d.userId) { await setDialog(env, uid, d); return await askWho(env, chat, st, c.who, d.objId); }
  if (!d.amount) { await setDialog(env, uid, d); return await askAmount(env, chat); }
  await setDialog(env, uid, d);
  return await askConfirm(env, chat, st, d);
}

// ─── Запись ──────────────────────────────────────────────────────────────────
async function commit(env, chat, uid, d, roles) {
  const c = catByKey(d.cat);
  if (!c || !canUse(roles, c)) { await sendTg(env, chat, "Недостаточно прав для этой записи."); return; }
  const st = await snapshot(env, ["finTxns", "objects", "users", "contractDocs"]);
  const objs = activeObjects(st);
  const o = objs.find(function (x) { return x.objId === d.objId; });
  const txns = Array.isArray(st.finTxns) ? st.finTxns.slice() : [];
  const now = Date.now();
  const tx = {
    id: "tx" + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    type: c.type, category: c.cat, amount: Math.round(d.amount),
    date: mskToday(), objId: d.objId || "", contractId: (o && o.contractId) || "",
    note: "внесено через Telegram-бота",
  };
  if (d.userId) tx.userId = d.userId;
  txns.push(tx);

  await env.DB.prepare("INSERT INTO work_states (storage_key, work_id, data, updated_at) VALUES ('admin_panel','finTxns',?,?) ON CONFLICT(storage_key,work_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind(JSON.stringify(txns), now).run();

  const who = (st.users || []).find(function (x) { return x.id === d.userId; });
  const title = c.cat + " · " + money(tx.amount) + (o ? " · " + o.name : "") + (who ? " · " + who.name : "");
  await logEvent(env, { uid: uid }, "finTxns", "add", title, "через Telegram-бота");
  await setDialog(env, uid, null);

  // Итог считаем ПОСЛЕ записи — на свежем списке транзакций, включая только что добавленную.
  const stAfter = Object.assign({}, st, { finTxns: txns });
  const doc = contractOf(st, d.objId);
  let summary = "";
  if (who && doc && (c.k === "salpr" || c.k === "salesc")) {
    const plan = salaryPlan(doc, who.id), paid = salaryPaid(stAfter, doc, who);
    summary = "\n\n" + escapeHtml(who.name) + " по этому объекту: выплачено <b>" + money(paid) + "</b>"
      + (plan ? " из " + money(plan) + "\nОсталось: <b>" + money(Math.max(0, plan - paid)) + "</b>"
        + (paid > plan ? " (перебор " + money(paid - plan) + ")" : "") : "");
  }
  await sendTg(env, chat, "✅ <b>Записано в портал</b>\n" + escapeHtml(title) + summary);

  // Получателю выплаты — личное уведомление с накопительным итогом по объекту.
  if (who) {
    const link = await env.DB.prepare("SELECT chat_id FROM tg_links WHERE uid=?").bind(who.id).first();
    if (link && link.chat_id) {
      const paid = doc ? salaryPaid(Object.assign({}, st, { finTxns: txns }), doc, who) : 0;
      const plan = salaryPlan(doc, who.id);
      const isFine = c.k === "fine";
      const base = (env.PUBLIC_BASE_URL || "https://portal.kubrdom.ru").replace(/\/+$/, "");
      await sendTg(env, link.chat_id,
        (isFine ? "⚠️ <b>Вам начислен штраф " : "💸 <b>Вам проведена выплата ") + money(tx.amount) + "</b>"
        + (o ? "\nОбъект: «" + escapeHtml(o.name) + "»" : "")
        + (isFine ? "" : "\nВыплачено по объекту: <b>" + money(paid) + "</b>" + (plan ? " из " + money(plan) + "\nОсталось: <b>" + money(Math.max(0, plan - paid)) + "</b>" : ""))
        + '\n\n👉 <a href="' + base + '/admin#tab=finance">Открыть финансы</a>');
    }
  }
}

// ─── Быстрая строка ──────────────────────────────────────────────────────────
// «зп Валера 50000», «аванс 500000 хозблок», «закупка 12000». Чего не хватает —
// доспрашиваем кнопками: наугад не пишем ничего.
// ВАЖНО: \b здесь не работает — в JS граница слова считается по ASCII, и после
// кириллического «зп» её просто нет. Поэтому конец слова задаём явно через пробел/конец строки.
const QUICK = [
  { re: /^(зп|зарплата)(?:\s|$)/i, cat: "salpr" },
  { re: /^(аванс|приход|оплата)(?:\s|$)/i, cat: "avans" },
  { re: /^(расчёт|расчет|окончательный)(?:\s|$)/i, cat: "final" },
  { re: /^(закупка|материалы|снабжение)(?:\s|$)/i, cat: "supply" },
  { re: /^(роп|сопровождение)(?:\s|$)/i, cat: "salesc" },
  { re: /^(штраф)(?:\s|$)/i, cat: "fine" },
];
function parseQuick(text, st, roles) {
  const q = QUICK.find(function (x) { return x.re.test(text.trim()); });
  if (!q) return null;
  const c = catByKey(q.cat);
  if (!canUse(roles, c)) return null;
  const rest = text.trim().replace(q.re, "").trim();
  const nums = rest.match(/\d[\d\s]*/g) || [];
  const amount = nums.length ? Number(nums[nums.length - 1].replace(/\s/g, "")) : 0;
  const words = rest.replace(/\d[\d\s]*/g, " ").trim().toLowerCase();
  const d = { cat: q.cat, amount: amount > 0 ? amount : 0, roles: roles };
  if (words) {
    if (c.who) {
      const u = peopleFor(st, c.who).find(function (x) { return String(x.name || "").toLowerCase().indexOf(words.split(/\s+/)[0]) >= 0; });
      if (u) d.userId = u.id;
    }
    const o = activeObjects(st).find(function (x) { return String(x.name || "").toLowerCase().indexOf(words.split(/\s+/).pop()) >= 0; });
    if (o) d.objId = o.objId;
  }
  return d;
}

// ─── Точки входа из вебхука ──────────────────────────────────────────────────
export async function finText(env, uid, chat, text, roles) {
  const st = await snapshot(env, ["objects", "users", "contractDocs", "finTxns"]);
  const t = String(text || "").trim();

  // «💵 Внести деньги» — текст с постоянной клавиатуры, для бота это обычное сообщение.
  if (/^\/(money|dengi|деньги|fin)$/i.test(t) || /^(деньги|финансы)$/i.test(t) || /внести деньги/i.test(t)) {
    await setDialog(env, uid, { roles: roles });
    return await askCategory(env, chat, roles);
  }
  const d = await getDialog(env, uid);
  // Ждём сумму — принимаем только число, чтобы случайная фраза не стала платежом.
  if (d && d.cat && !d.amount && /^[\d\s]+$/.test(t)) {
    const amount = Number(t.replace(/\s/g, ""));
    if (!(amount > 0)) return await sendTg(env, chat, "Сумма должна быть больше нуля.");
    d.amount = amount; d.roles = roles;
    return await advance(env, chat, st, d, uid);
  }
  if (/напоминани/i.test(t)) {
    const base = (env.PUBLIC_BASE_URL || "https://portal.kubrdom.ru").replace(/\/+$/, "");
    await sendTg(env, chat, 'Настройка напоминаний — в портале: 🔔 в шапке.\n👉 <a href="' + base + '/admin">Открыть портал</a>');
    return true;
  }
  const quick = parseQuick(t, st, roles);
  if (quick) return await advance(env, chat, st, quick, uid);
  return false;   // не наше сообщение — пусть обработает общий вебхук
}

export async function finCallback(env, uid, chat, data, roles) {
  const st = await snapshot(env, ["objects", "users", "contractDocs", "finTxns"]);
  const parts = String(data || "").split(":");
  if (parts[0] !== "f") return false;
  const d = (await getDialog(env, uid)) || { roles: roles };
  d.roles = roles;

  if (parts[1] === "cancel") { await setDialog(env, uid, null); await sendTg(env, chat, "Отменено."); return true; }
  if (parts[1] === "cat") { d.cat = parts[2]; d.objId = null; d.userId = null; d.amount = 0; await advance(env, chat, st, d, uid); return true; }
  if (parts[1] === "obj") { d.objId = parts[2]; await advance(env, chat, st, d, uid); return true; }
  if (parts[1] === "who") { d.userId = parts[2]; await advance(env, chat, st, d, uid); return true; }
  if (parts[1] === "ok") {
    if (!d.cat || !d.amount) { await sendTg(env, chat, "Запись не готова — начните заново: /деньги"); return true; }
    await commit(env, chat, uid, d, roles);
    return true;
  }
  return false;
}
