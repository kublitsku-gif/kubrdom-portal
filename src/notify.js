// ─── НАПОМИНАНИЯ В TELEGRAM ──────────────────────────────────────────────────
// Telegram не даёт боту написать человеку первым, поэтому нужен разовый обряд:
// сотрудник открывает бота по ссылке с одноразовым кодом → бот получает /start <code>
// → Worker запоминает его chat_id. Только после этого возможны личные напоминания.
//
// Почему не в снимке admin_panel: раздел users пишет ТОЛЬКО админ, а привязку и настройки
// каждый сотрудник меняет себе сам. Плюс chat_id — это персональные данные, которым нечего
// делать в общем снимке, который целиком читает половина ролей. Держим в своих таблицах D1.

const CODE_TTL_MS = 15 * 60 * 1000;   // одноразовый код живёт 15 минут
const TG_API = "https://api.telegram.org/bot";

// Что можно напоминать. Ключи хранятся в prefs как {kind: true}.
export const NOTIFY_KINDS = {
  deadline: { n: "Дедлайны и просрочка", d: "за 3 дня, за день, в день дедлайна и каждое утро при просрочке", roles: ["brigadier", "worker", "prod_head", "admin", "financier"] },
  hours:    { n: "Часы и отметки работ", d: "вечером, если за день по объекту не записаны часы",              roles: ["brigadier", "worker", "prod_head", "admin"] },
  supply:   { n: "Снабжение",            d: "не куплено к старту этапа; куплено, но не принято на складе",     roles: ["supply", "prod_head", "admin", "brigadier"] },
  daily:    { n: "Сводка дня",           d: "вечером одним сообщением: что сделано, часы, что горит",          roles: ["admin", "financier", "prod_head"] },
};

let _ready = false;
export async function ensureNotifyTables(env) {
  if (_ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS tg_links (uid TEXT PRIMARY KEY, chat_id TEXT NOT NULL, uname TEXT, linked_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS tg_codes (code TEXT PRIMARY KEY, uid TEXT NOT NULL, exp INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS notify_prefs (uid TEXT PRIMARY KEY, prefs TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    // Защита от повторов: одно напоминание одного вида по одному поводу в сутки.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS notify_log (uid TEXT NOT NULL, kind TEXT NOT NULL, k TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (uid, kind, k))"),
  ]);
  _ready = true;
}

export async function sendTg(env, chatId, text, extra) {
  if (!env.TG_BOT_TOKEN || !chatId) return false;
  try {
    const body = Object.assign({ chat_id: String(chatId), text: text, parse_mode: "HTML", disable_web_page_preview: true }, extra || {});
    const r = await fetch(TG_API + env.TG_BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json();
    return !!(j && j.ok);
  } catch { return false; }
}

let _botUser = null;
async function botUsername(env) {
  if (_botUser) return _botUser;
  try {
    const r = await fetch(TG_API + env.TG_BOT_TOKEN + "/getMe");
    const j = await r.json();
    if (j && j.ok && j.result && j.result.username) _botUser = j.result.username;
  } catch { /* без имени просто не покажем ссылку */ }
  return _botUser;
}

function randCode() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a).map(function (b) { return "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]; }).join("");
}

// Значения по умолчанию: включено то, что относится к ролям сотрудника. Человек, впервые
// привязавший Telegram, сразу получает осмысленный набор, а не тишину.
export function defaultPrefs(roles) {
  const out = {};
  const rs = roles || [];
  Object.keys(NOTIFY_KINDS).forEach(function (k) {
    out[k] = NOTIFY_KINDS[k].roles.some(function (r) { return rs.indexOf(r) >= 0; });
  });
  return out;
}

export async function getPrefs(env, uid, roles) {
  const row = await env.DB.prepare("SELECT prefs FROM notify_prefs WHERE uid=?").bind(uid).first();
  if (row && row.prefs) { try { return Object.assign(defaultPrefs(roles), JSON.parse(row.prefs)); } catch { /* битый JSON — отдаём дефолт */ } }
  return defaultPrefs(roles);
}

export async function tgStatus(env, auth, roles) {
  await ensureNotifyTables(env);
  const uid = auth.uid;
  const link = await env.DB.prepare("SELECT chat_id, uname, linked_at FROM tg_links WHERE uid=?").bind(uid).first();
  const prefs = await getPrefs(env, uid, roles);
  return {
    success: true,
    linked: !!link,
    uname: link ? link.uname : null,
    linkedAt: link ? link.linked_at : null,
    prefs: prefs,
    kinds: NOTIFY_KINDS,
    bot: await botUsername(env),
  };
}

// Одноразовый код + готовая ссылка вида https://t.me/<bot>?start=<code>
export async function tgMakeCode(env, auth) {
  await ensureNotifyTables(env);
  const code = randCode();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tg_codes WHERE uid=? OR exp<?").bind(auth.uid, now),
    env.DB.prepare("INSERT INTO tg_codes (code, uid, exp) VALUES (?,?,?)").bind(code, auth.uid, now + CODE_TTL_MS),
  ]);
  const bot = await botUsername(env);
  return { success: true, code: code, bot: bot, link: bot ? ("https://t.me/" + bot + "?start=" + code) : null, ttlMin: Math.round(CODE_TTL_MS / 60000) };
}

export async function tgUnlink(env, auth) {
  await ensureNotifyTables(env);
  await env.DB.prepare("DELETE FROM tg_links WHERE uid=?").bind(auth.uid).run();
  return { success: true };
}

export async function tgSavePrefs(env, auth, body) {
  await ensureNotifyTables(env);
  const src = (body && body.prefs) || {};
  const clean = {};
  Object.keys(NOTIFY_KINDS).forEach(function (k) { clean[k] = !!src[k]; });
  await env.DB.prepare("INSERT INTO notify_prefs (uid, prefs, updated_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET prefs=excluded.prefs, updated_at=excluded.updated_at")
    .bind(auth.uid, JSON.stringify(clean), Date.now()).run();
  return { success: true, prefs: clean };
}

export async function tgTest(env, auth, name) {
  await ensureNotifyTables(env);
  const link = await env.DB.prepare("SELECT chat_id FROM tg_links WHERE uid=?").bind(auth.uid).first();
  if (!link) return { success: false, error: "Telegram не привязан" };
  const ok = await sendTg(env, link.chat_id, "🔔 <b>Проверка связи</b>\nПортал КубрДом умеет писать вам сюда, " + escapeHtml(name || "коллега") + ".");
  return ok ? { success: true } : { success: false, error: "Telegram не принял сообщение" };
}

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Вебхук бота ─────────────────────────────────────────────────────────────
// Единственное, что обрабатываем — «/start <код>». Всё остальное вежливо игнорируем:
// бот не должен превращаться в чат-интерфейс к порталу.
export async function tgWebhook(env, request) {
  let upd; try { upd = await request.json(); } catch { return { ok: true }; }
  const msg = upd && (upd.message || upd.edited_message);
  const text = msg && typeof msg.text === "string" ? msg.text.trim() : "";
  const chatId = msg && msg.chat && msg.chat.id;
  if (!chatId || !text) return { ok: true };
  if (msg.chat.type !== "private") return { ok: true };     // в группах бот молчит

  await ensureNotifyTables(env);
  const m = text.match(/^\/start(?:\s+([A-Za-z0-9_-]+))?/);
  if (!m) {
    await sendTg(env, chatId, "Это бот напоминаний портала КубрДом. Чтобы получать напоминания, откройте портал → 🔔 Напоминания → «Привязать Telegram».");
    return { ok: true };
  }
  const code = m[1];
  if (!code) {
    await sendTg(env, chatId, "Привет! Откройте портал → 🔔 Напоминания → «Привязать Telegram» и нажмите кнопку — вернётесь сюда уже с кодом.");
    return { ok: true };
  }
  const now = Date.now();
  const row = await env.DB.prepare("SELECT uid, exp FROM tg_codes WHERE code=?").bind(code).first();
  if (!row || row.exp < now) {
    await sendTg(env, chatId, "⌛ Код устарел или уже использован. Откройте портал → 🔔 Напоминания и получите новый.");
    return { ok: true };
  }
  const uname = (msg.from && (msg.from.username ? "@" + msg.from.username : [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "))) || "";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tg_links (uid, chat_id, uname, linked_at) VALUES (?,?,?,?) ON CONFLICT(uid) DO UPDATE SET chat_id=excluded.chat_id, uname=excluded.uname, linked_at=excluded.linked_at")
      .bind(row.uid, String(chatId), uname, now),
    env.DB.prepare("DELETE FROM tg_codes WHERE code=?").bind(code),
  ]);
  await sendTg(env, chatId, "✅ <b>Готово!</b> Напоминания портала КубрДом будут приходить сюда.\nЧто именно присылать — настраивается в портале: 🔔 Напоминания.");
  return { ok: true };
}

// Разовая установка вебхука (зовёт админ из панели): токен не покидает Worker.
export async function tgSetupWebhook(env, publicBase) {
  if (!env.TG_BOT_TOKEN) return { success: false, error: "TG_BOT_TOKEN не задан" };
  const url = (publicBase || env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") + "/api/tg/webhook";
  const r = await fetch(TG_API + env.TG_BOT_TOKEN + "/setWebhook", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url, secret_token: env.WEBHOOK_SECRET || undefined, allowed_updates: ["message"] }),
  });
  const j = await r.json();
  const info = await (await fetch(TG_API + env.TG_BOT_TOKEN + "/getWebhookInfo")).json();
  return { success: !!(j && j.ok), url: url, telegram: j, info: info && info.result };
}
