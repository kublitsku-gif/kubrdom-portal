// ─── CRM как отдельное приложение (/crm) ───
// Та же панель, но открытая по адресу /crm: свой манифест и иконка на рабочем столе,
// только CRM без остальных вкладок, лента переписки Авито и пуши о новых сообщениях.
// Здесь — чистая логика без DOM, её сторожит tools/test-crm-app.mjs.

export const CRM_APP_PATH = "/crm";

// /crm, /crm/ и /crm.html (clean URL Pages отдаёт crm.html по /crm) — да; /crmx и /admin — нет.
export function isCrmPath(pathname) {
  return /^\/crm(\/|\.html)?$/.test(String(pathname || ""));
}

// Ссылка, по которой пуш открывает диалог. Раздел — в ?go=, его разбирает applyDeepLink.
export function chatDeepLink(key) {
  return CRM_APP_PATH + "?go=" + encodeURIComponent("chat=" + key);
}

function lastOf(list, pred) {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) return list[i];
  return null;
}

// С какого момента клиент ждёт ответа: первая его реплика после нашего последнего
// отправленного ответа (черновики не в счёт). 0 — не ждёт.
export function waitSince(msgs) {
  const list = msgs || [];
  let since = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i] || {};
    if (m.status === "draft") continue;
    if (m.role !== "user") break;
    since = Number(m.ts) || since;
  }
  return since;
}

// Лента диалогов Авито: свежие сверху, у каждого — последняя реплика, «не отвечено»
// (последним писал клиент), ждущий черновик ИИ, объявление и привязанная карточка CRM.
export function chatFeed(chats, clients) {
  const byKey = {};
  (clients || []).forEach((c) => { if (c && c.avitoKey) byKey[c.avitoKey] = c; });
  return Object.keys(chats || {})
    .filter((k) => chats[k] && chats[k].source === "avito")
    .map((k) => {
      const ch = chats[k];
      const msgs = ch.messages || [];
      const last = msgs[msgs.length - 1] || null;
      const lastSaid = lastOf(msgs, (m) => m.status !== "draft") || last;
      const client = byKey[k] || null;
      const name = (client && client.name) || ch.name || "Клиент Авито";
      const item = ch.item || null;
      return {
        key: k,
        name,
        clientId: client ? client.id : null,
        stage: client ? client.stage : null,
        phone: client ? String(client.phone || "") : "",
        text: lastSaid ? String(lastSaid.text || "") : "",
        ts: Number((last && last.ts) || ch.updatedAt || 0),
        // Черновик ИИ клиенту не ушёл, поэтому ответом не считается.
        unanswered: !!(lastSaid && lastSaid.role === "user"),
        waitSince: waitSince(msgs),
        draft: !!(last && last.status === "draft"),
        archived: !!ch.archived,
        spam: !!ch.spam,
        item,
        count: msgs.length,
        // Строка для поиска: имя, телефон, объявление и весь текст переписки.
        search: [name, client && client.phone, item && item.title].concat(msgs.map((m) => m && m.text))
          .filter(Boolean).join(" ").toLowerCase(),
      };
    })
    .sort((a, b) => b.ts - a.ts);
}

// Фильтры ленты. Архив и спам видны только в «Архиве», остальные режимы их прячут.
export const FEED_MODES = [
  { id: "all", label: "Все" },
  { id: "wait", label: "Ждут ответа" },
  { id: "draft", label: "С черновиком" },
  { id: "archive", label: "Архив" },
];
export function filterFeed(feed, opt) {
  const o = opt || {};
  const mode = o.mode || "all";
  const q = String(o.q || "").trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return (feed || []).filter((f) => {
    const hidden = f.archived || f.spam;
    if (mode === "archive" ? !hidden : hidden) return false;
    if (mode === "wait" && !f.unanswered) return false;
    if (mode === "draft" && !f.draft) return false;
    if (o.stage && f.stage !== o.stage) return false;
    if (!q) return true;
    if (f.search.indexOf(q) >= 0) return true;
    return qDigits.length >= 3 && f.search.replace(/\D/g, "").indexOf(qDigits) >= 0;
  });
}

// Таймер «ждёт ответа». После WAIT_ALERT_MIN минут строка краснеет и уходит повторный пуш.
export const WAIT_ALERT_MIN = 15;
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export function waitLabel(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < MIN) return "только что";
  if (v < HOUR) return Math.floor(v / MIN) + " мин";
  if (v < DAY) { const h = Math.floor(v / HOUR), m = Math.floor((v % HOUR) / MIN); return h + " ч" + (m ? " " + m + " мин" : ""); }
  return Math.floor(v / DAY) + " дн";
}

// Кому из ждущих пора напомнить пушем: ждёт дольше WAIT_ALERT_MIN, но меньше суток
// (иначе первый же прогон после выката напомнил бы обо всех старых диалогах), напоминание
// по этой реплике ещё не уходило (marks[key] === since), не архив и не спам.
// Ночью (по Москве до 8 и с 22) не будим — утренний прогон подберёт ночных.
export function waitReminders(chats, marks, now, mskHour) {
  if (mskHour < 8 || mskHour >= 22) return [];
  const out = [];
  Object.keys(chats || {}).forEach((k) => {
    const ch = chats[k];
    if (!ch || ch.source !== "avito" || ch.archived || ch.spam) return;
    const since = waitSince(ch.messages);
    if (!since) return;
    const waited = now - since;
    if (waited < WAIT_ALERT_MIN * MIN || waited > DAY) return;
    if (marks && marks[k] === since) return;
    out.push({ key: k, since, waited });
  });
  return out;
}

// Напоминания «перезвонить» из карточек: время пришло и пуш по этому времени не уходил.
export function dueReminders(clients, marks, now) {
  return (clients || []).filter((c) => c && c.id && Number(c.remindAt) > 0 && Number(c.remindAt) <= now &&
    !(marks && marks["r:" + c.id] === Number(c.remindAt)));
}

// Список «Сегодня»: напоминания до конца сегодняшнего дня (просроченные — тоже), по времени.
export function todayReminders(clients, now) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return (clients || []).filter((c) => c && Number(c.remindAt) > 0 && Number(c.remindAt) <= end.getTime())
    .slice().sort((a, b) => a.remindAt - b.remindAt);
}

// Ссылка из пуша-напоминания: открыть карточку клиента.
export function clientDeepLink(id) {
  return CRM_APP_PATH + "?go=" + encodeURIComponent("client=" + id);
}

// Картинка в переписке: только https (Авито) и наши файлы — иначе в src уйдёт что угодно.
export function safeImageUrl(u) {
  const s = String(u || "");
  return /^https:\/\/[^\s"'<>]+$/.test(s) || /^\/(api\/file|plans)\/[\w./-]+$/.test(s) ? s : "";
}

// Сообщение-картинка из вебхука Авито: content.image.sizes {"1280x960": url, ...} → самая крупная.
export function avitoImageUrl(content) {
  const sizes = content && content.image && content.image.sizes;
  if (!sizes || typeof sizes !== "object") return "";
  let best = "", bestW = -1;
  Object.keys(sizes).forEach((k) => {
    const w = parseInt(k, 10) || 0;
    if (w > bestW && safeImageUrl(sizes[k]).indexOf("https://") === 0) { best = sizes[k]; bestW = w; }
  });
  return best;
}

// Карточка чата Авито (messenger/v2 .../chats/{id}) → объявление и имя клиента.
export function avitoChatInfo(j, ownUserId) {
  const v = (j && j.context && j.context.value) || {};
  const imgs = (v.images && v.images.main) || {};
  const img = Object.keys(imgs).map((k) => imgs[k]).find((u) => safeImageUrl(u)) || "";
  const user = ((j && j.users) || []).find((u) => u && String(u.id) !== String(ownUserId));
  const item = v.title ? {
    id: v.id || null,
    title: String(v.title).slice(0, 200),
    price: String(v.price_string || "").slice(0, 60),
    url: /^https:\/\/(www\.)?avito\.ru\//.test(String(v.url || "")) ? String(v.url) : "",
    img,
  } : null;
  return { item, userName: user && user.name ? String(user.name).slice(0, 80) : "" };
}

// Быстрые ответы по умолчанию — пока в настройках не задан свой список.
export const QUICK_REPLIES_DEFAULT = [
  "Добрый день! Спасибо за интерес к КубрДом. Подскажите, баню или дом рассматриваете и какого размера?",
  "Пришлю планировки — посмотрите, какая ближе, и под неё сделаю расчёт.",
  "Оставьте, пожалуйста, номер телефона — менеджер перезвонит и всё подробно расскажет.",
  "Приглашаем на производство: покажем готовые бани и дома вживую. Когда вам удобно подъехать?",
  "Когда вам удобно созвониться? Расскажу по комплектации и срокам.",
  "Цена зависит от комплектации — уточните размер и что нужно внутри, посчитаю точно.",
];
export function quickReplies(settings) {
  const own = settings && Array.isArray(settings.crmQuickReplies) ? settings.crmQuickReplies : null;
  const list = (own || QUICK_REPLIES_DEFAULT).map((x) => String(x || "").trim()).filter(Boolean);
  return list.length ? list.slice(0, 30) : QUICK_REPLIES_DEFAULT.slice();
}

// Подсказки «переписать черновик» — что сказать ИИ одним тапом.
export const REDRAFT_HINTS = ["Короче", "Теплее и проще", "Добавь цену", "Предложи созвон", "Пригласи на производство"];

// Время в ленте: сегодня — «14:05», раньше — «27.10».
export function feedTime(ts, now = Date.now()) {
  if (!ts) return "";
  const d = new Date(ts), n = new Date(now);
  const p = (x) => String(x).padStart(2, "0");
  if (d.toDateString() === n.toDateString()) return p(d.getHours()) + ":" + p(d.getMinutes());
  return p(d.getDate()) + "." + p(d.getMonth() + 1);
}

// Что за черновик у каждой реплики диалога (null — обычная реплика):
//  "pending" — ИИ предлагает ответ сейчас: последний черновик, после него клиенту ничего не ушло;
//  "stale"   — черновик, который так и не отправили, а разговор ушёл дальше;
//  "used"    — черновик, который потом ушёл клиенту тем же текстом (показывать незачем);
//  "failed"  — ваш ответ из CRM, который Авито не принял (сервер кладёт его черновиком).
export function draftKinds(msgs) {
  const list = msgs || [];
  const sentAfter = new Set();
  let saidAfter = false;
  let pendingTaken = false;
  const kinds = new Array(list.length).fill(null);
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i] || {};
    if (m.status !== "draft") {
      saidAfter = true;
      if (m.role === "assistant") sentAfter.add(String(m.text || "").trim());
      continue;
    }
    if (m.manual) kinds[i] = "failed";
    else if (sentAfter.has(String(m.text || "").trim())) kinds[i] = "used";
    else if (!saidAfter && !pendingTaken) { kinds[i] = "pending"; pendingTaken = true; }
    else kinds[i] = "stale";
  }
  return kinds;
}

// Время ответа по диалогу: от первой реплики клиента в «ожидании» до нашего отправленного ответа.
function responseTimes(msgs, from) {
  const out = [];
  let waitFrom = 0;
  (msgs || []).forEach((m) => {
    if (!m || m.status === "draft") return;
    if (m.role === "user") { if (!waitFrom) waitFrom = Number(m.ts) || 0; return; }
    if (waitFrom && Number(m.ts) >= waitFrom && waitFrom >= from) out.push(Number(m.ts) - waitFrom);
    waitFrom = 0;
  });
  return out;
}

// Сводка продаж: лиды за неделю, скорость ответа, воронка и какие объявления приводят клиентов.
// stages — порядок стадий воронки (id), «дошёл до стадии» = сейчас на ней или дальше.
export function salesSummary(chats, clients, stages, now) {
  const WEEK = 7 * DAY;
  const isoDay = (t) => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const weekAgo = isoDay(now - WEEK), twoWeeksAgo = isoDay(now - 2 * WEEK);
  const list = clients || [];
  const leadsWeek = list.filter((c) => c && c.date && c.date > weekAgo).length;
  const leadsPrev = list.filter((c) => c && c.date && c.date > twoWeeksAgo && c.date <= weekAgo).length;

  const avito = Object.keys(chats || {}).filter((k) => chats[k] && chats[k].source === "avito");
  const times = [];
  avito.forEach((k) => responseTimes(chats[k].messages, now - 30 * DAY).forEach((t) => times.push(t)));
  times.sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;
  const fast = times.filter((t) => t <= WAIT_ALERT_MIN * MIN).length;

  const order = (stages || []).map((s) => s.id || s);
  const idx = (sid) => order.indexOf(sid);
  const funnel = order.map((sid, i) => ({ id: sid, reached: list.filter((c) => c && idx(c.stage) >= i).length }));

  const byClientKey = {};
  list.forEach((c) => { if (c && c.avitoKey) byClientKey[c.avitoKey] = c; });
  const meetIdx = idx("meeting"), contractIdx = idx("contract");
  const listings = {};
  avito.forEach((k) => {
    const ch = chats[k];
    const title = (ch.item && ch.item.title) || "Без объявления";
    const row = listings[title] || (listings[title] = { title, dialogs: 0, meetings: 0, contracts: 0 });
    row.dialogs++;
    const c = byClientKey[k];
    if (c && meetIdx >= 0 && idx(c.stage) >= meetIdx) row.meetings++;
    if (c && contractIdx >= 0 && idx(c.stage) >= contractIdx) row.contracts++;
  });

  return {
    leadsWeek, leadsPrev,
    dialogsWeek: avito.filter((k) => { const m = (chats[k].messages || [])[0]; return m && Number(m.ts) > now - WEEK; }).length,
    waitingNow: avito.filter((k) => !chats[k].archived && !chats[k].spam && waitSince(chats[k].messages) > 0).length,
    responses: times.length, medianMs: median, fastShare: times.length ? Math.round(fast / times.length * 100) : 0,
    funnel,
    listings: Object.keys(listings).map((t) => listings[t]).sort((a, b) => b.dialogs - a.dialogs),
  };
}
