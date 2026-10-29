// Telegram Business: переписка с клиентами из вашего личного Telegram — в CRM.
// Бот продаж подключают к аккаунту в Telegram: Настройки → Telegram для бизнеса → Чат-боты
// (нужен Telegram Premium). Тогда бот получает business_message из выбранных личных чатов
// и может отвечать от вашего имени (sendMessage с business_connection_id).
// Чистая логика; приём — aiWebhook → tgBusinessWebhook в worker.js.

export const TG_PREFIX = "tg:";
export function tgChatKey(chatId) { return TG_PREFIX + String(chatId); }
export function isTgKey(key) { return String(key || "").indexOf(TG_PREFIX) === 0; }

export function tgName(chat) {
  const c = chat || {};
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return full || (c.username ? "@" + c.username : "Telegram");
}

// Подпись реплики без текста: фото, голосовое… Сами файлы не тянем — ссылка на файл
// у Telegram содержит токен бота, её нельзя отдавать в браузер.
const KIND_TEXT = { photo: "📷 Фото", video: "🎬 Видео", voice: "🎤 Голосовое", video_note: "🎥 Видеосообщение", audio: "🎵 Аудио", document: "📎 Файл", sticker: "🙂 Стикер", location: "📍 Геопозиция" };
const TEXT_MAX = 2000;

export function tgText(msg) {
  const m = msg || {};
  if (m.text) return String(m.text).slice(0, TEXT_MAX);
  if (m.contact) return ("👤 Контакт: " + [m.contact.first_name, m.contact.last_name].filter(Boolean).join(" ") + " " + (m.contact.phone_number || "")).trim();
  const kind = Object.keys(KIND_TEXT).find((k) => m[k]);
  const label = kind ? KIND_TEXT[kind] : "";
  const cap = m.caption ? String(m.caption).slice(0, TEXT_MAX) : "";
  return [label, cap].filter(Boolean).join(": ");
}

// Реплика CRM из сообщения: от владельца аккаунта — наш ответ («🙋 Вы»), иначе — клиента.
export function tgReply(msg, ownerId) {
  const mine = !!(msg && msg.from && ownerId && String(msg.from.id) === String(ownerId));
  const base = { role: mine ? "assistant" : "user", text: tgText(msg), status: mine ? "sent" : "in", ts: (Number(msg && msg.date) || 0) * 1000, tgMid: Number(msg && msg.message_id) || 0 };
  return mine ? { ...base, manual: true, fromTelegram: true } : base;
}

// Применить обновление Telegram Business к диалогу. Возвращает новый диалог или null — менять нечего.
// «Не клиент» (spam) — переписку не храним вовсе: это личный чат, ему не место в общей CRM.
export function applyBusinessUpdate(chat, upd, conn) {
  const owner = conn && conn.userId;
  const fresh = upd.business_message;
  const edited = upd.edited_business_message;
  const gone = upd.deleted_business_messages;
  if (chat && chat.spam) return null;
  if (fresh) {
    const reply = tgReply(fresh, owner);
    if (!reply.text) return null;
    const base = chat || { source: "telegram", name: tgName(fresh.chat), tgChatId: fresh.chat.id, messages: [] };
    if ((base.messages || []).some((m) => m.tgMid && m.tgMid === reply.tgMid)) return null;
    return { ...base, username: fresh.chat.username || base.username || "", bcId: fresh.business_connection_id || base.bcId,
      name: base.name && base.name !== "Telegram" ? base.name : tgName(fresh.chat),
      archived: reply.role === "user" ? false : base.archived,
      messages: (base.messages || []).concat([reply]), updatedAt: Date.now() };
  }
  if (edited && chat) {
    const text = tgText(edited);
    const mid = Number(edited.message_id);
    if (!(chat.messages || []).some((m) => m.tgMid === mid)) return null;
    return { ...chat, messages: chat.messages.map((m) => (m.tgMid === mid ? { ...m, text, edited: true } : m)) };
  }
  if (gone && chat) {
    const ids = new Set((gone.message_ids || []).map(Number));
    const left = (chat.messages || []).filter((m) => !ids.has(m.tgMid));
    return left.length === (chat.messages || []).length ? null : { ...chat, messages: left };
  }
  return null;
}

// Из какого чата обновление (ключ диалога в aiChats).
export function businessChatId(upd) {
  const m = upd.business_message || upd.edited_business_message || upd.deleted_business_messages;
  return m && m.chat ? m.chat.id : null;
}
export function businessConnId(upd) {
  const m = upd.business_message || upd.edited_business_message || upd.deleted_business_messages;
  return m ? m.business_connection_id || "" : "";
}

// Подключение бота к аккаунту → то, что храним (права «отвечать» — в rights у Bot API 9, can_reply раньше).
export function connectionRecord(bc) {
  const rights = bc.rights || {};
  return { userId: bc.user && bc.user.id, userName: tgName(bc.user), canReply: !!(rights.can_reply || bc.can_reply), enabled: !!bc.is_enabled, at: Date.now() };
}

export const BUSINESS_UPDATES = ["business_connection", "business_message", "edited_business_message", "deleted_business_messages"];
