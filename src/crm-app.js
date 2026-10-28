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

// Лента диалогов Авито: свежие сверху, у каждого — последняя реплика, «не отвечено»
// (последним писал клиент), ждущий черновик ИИ и привязанная карточка CRM.
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
      return {
        key: k,
        name: (client && client.name) || ch.name || "Клиент Авито",
        clientId: client ? client.id : null,
        stage: client ? client.stage : null,
        text: lastSaid ? String(lastSaid.text || "") : "",
        ts: Number((last && last.ts) || ch.updatedAt || 0),
        // Черновик ИИ клиенту не ушёл, поэтому ответом не считается.
        unanswered: !!(lastSaid && lastSaid.role === "user"),
        draft: !!(last && last.status === "draft"),
        count: msgs.length,
      };
    })
    .sort((a, b) => b.ts - a.ts);
}

// Время в ленте: сегодня — «14:05», раньше — «27.10».
export function feedTime(ts, now = Date.now()) {
  if (!ts) return "";
  const d = new Date(ts), n = new Date(now);
  const p = (x) => String(x).padStart(2, "0");
  if (d.toDateString() === n.toDateString()) return p(d.getHours()) + ":" + p(d.getMinutes());
  return p(d.getDate()) + "." + p(d.getMonth() + 1);
}
