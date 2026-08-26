// ─── Общие вызовы Telegram Bot API ───────────────────────────────────────────
// Отдельный модуль, потому что этим пользуются и Worker (загрузка из панели), и бот
// (приём фото/видео от бригадира). Держать копию в каждом — верный способ развести
// поведение: тема объекта должна создаваться ОДИНАКОВО, откуда бы файл ни пришёл.

export const tgBase = (env) => "https://api.telegram.org/bot" + env.TG_BOT_TOKEN;

// Тема объекта в супергруппе: topicId > 0 — уже есть, иначе создаём по имени объекта.
export async function ensureTopic(env, tg, objName, topicId) {
  if (topicId) return { topicId };
  const r = await fetch(tg + "/createForumTopic", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TG_CHAT_ID, name: (objName || "Объект").slice(0, 128) }),
  });
  const j = await r.json();
  if (!j.ok) return { error: "Тема: " + j.description };
  return { topicId: j.result.message_thread_id };
}

// Копия сообщения (фото/видео) из личного чата в тему объекта: файл уже в Telegram,
// перезаливать его через ботовый лимит 20 МБ незачем.
export async function copyToTopic(env, fromChat, messageId, topicId, caption) {
  const r = await fetch(tgBase(env) + "/copyMessage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TG_CHAT_ID, message_thread_id: topicId,
      from_chat_id: String(fromChat), message_id: messageId,
      caption: caption ? String(caption).slice(0, 1000) : undefined,
    }),
  });
  const j = await r.json();
  return j && j.ok ? j.result.message_id : null;
}

// Скачивание файла бота: getFile → путь → байты. Лимит Bot API — 20 МБ.
export async function fetchTgFile(env, fileId) {
  const r = await fetch(tgBase(env) + "/getFile?file_id=" + encodeURIComponent(fileId));
  const j = await r.json();
  if (!j || !j.ok || !j.result || !j.result.file_path) return null;
  const path = j.result.file_path;
  const f = await fetch("https://api.telegram.org/file/bot" + env.TG_BOT_TOKEN + "/" + path);
  if (!f.ok) return null;
  return { buf: await f.arrayBuffer(), path: path, ext: (path.split(".").pop() || "jpg").toLowerCase() };
}
