// ─── Пуш-уведомления CRM: подписки телефонов и рассылка ───
// Подписки лежат в work_states под своим storage_key (push_subs), по строке на телефон:
// в снимок панели они не попадают (тот читает только admin_panel и только STATE_SECTIONS),
// а версия снимка от них не растёт.
import { cleanSubscription, sendPush } from "./webpush.js";
import { chatDeepLink } from "./crm-app.js";

export const PUSH_STORAGE_KEY = "push_subs";
const PUSH_TEXT_MAX = 160;

export function pushReady(env) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}
function vapidOf(env) {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "https://portal.kubrdom.ru" };
}
async function subId(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return "s_" + Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

// POST /api/push/subscribe {subscription} — телефон включил уведомления.
export async function pushSubscribe(env, body, auth) {
  if (!pushReady(env)) return { success: false, error: "Уведомления не настроены на сервере" };
  const sub = cleanSubscription(body && body.subscription);
  if (!sub) return { success: false, error: "Неверная подписка браузера" };
  const row = { ...sub, uid: auth.uid, ts: Date.now() };
  await env.DB.prepare("INSERT INTO work_states (storage_key, work_id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(storage_key, work_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
    .bind(PUSH_STORAGE_KEY, await subId(sub.endpoint), JSON.stringify(row), row.ts).run();
  return { success: true };
}

// POST /api/push/unsubscribe {endpoint} — телефон выключил уведомления.
export async function pushUnsubscribe(env, body) {
  const endpoint = String((body && body.endpoint) || "");
  if (!endpoint) return { success: false, error: "need endpoint" };
  await env.DB.prepare("DELETE FROM work_states WHERE storage_key=? AND work_id=?").bind(PUSH_STORAGE_KEY, await subId(endpoint)).run();
  return { success: true };
}

async function listSubs(env) {
  const res = await env.DB.prepare("SELECT work_id, data FROM work_states WHERE storage_key=?").bind(PUSH_STORAGE_KEY).all();
  return (res.results || []).map((r) => {
    try { return { id: r.work_id, ...JSON.parse(r.data) }; } catch (e) { return null; }
  }).filter(Boolean);
}

// Рассылка по подпискам, чей владелец проходит allowUid. Умершие (404/410) удаляем сразу:
// иначе каждое сообщение клиента стучалось бы в них вечно.
export async function pushToAll(env, data, allowUid, fetchFn) {
  const out = { sent: 0, dropped: 0, failed: 0 };
  if (!pushReady(env)) return out;
  const subs = [];
  for (const s of await listSubs(env)) if (await allowUid(s.uid)) subs.push(s);
  await Promise.all(subs.map(async (s) => {
    try {
      const status = await sendPush(s, data, vapidOf(env), fetchFn);
      if (status === 404 || status === 410) {
        await env.DB.prepare("DELETE FROM work_states WHERE storage_key=? AND work_id=?").bind(PUSH_STORAGE_KEY, s.id).run();
        out.dropped++;
      } else if (status >= 200 && status < 300) out.sent++;
      else { out.failed++; console.error("push", status, s.id); }
    } catch (e) { out.failed++; console.error("push", s.id, String(e)); }
  }));
  return out;
}

// Текст пуша о новом сообщении клиента: имя из карточки CRM, если диалог к ней привязан.
export function avitoPushData(key, chatName, text, clients) {
  const client = (clients || []).find((c) => c && c.avitoKey === key);
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return {
    title: "💬 " + ((client && client.name) || chatName || "Клиент Авито"),
    body: t.length > PUSH_TEXT_MAX ? t.slice(0, PUSH_TEXT_MAX - 1) + "…" : t,
    tag: key,
    url: chatDeepLink(key),
  };
}
