// Карточка сообщения клиента в ветке Telegram (бот продаж): одно сообщение на реплику
// клиента — что написал, черновик ИИ, кнопки и строка статуса. Раньше это были 2–3
// отдельных сообщения, а кнопки «Отправить» оставались и после ответа из CRM.
// Чистая логика; отправка и правка сообщений — tgCard* в worker.js.

import { STAGE_TITLE, clientCode } from "./crm-contacts.js";

const TEXT_MAX = 3900;   // у Telegram 4096 символов на сообщение; оставляем запас под статус

// Метка сверху карточки: откуда клиент, по какому объявлению, на какой стадии.
export function dialogLabel({ source, itemTitle, stage, code }) {
  const where = source === "telegram" ? "✈️ Telegram" : source === "website" ? "🌐 Сайт" : "📢 Авито";
  return [where + (itemTitle ? " · " + String(itemTitle).slice(0, 60) : ""), clientCode(code), STAGE_TITLE[stage] || ""]
    .filter(Boolean).join(" · ");
}

// Время в строке статуса — по Москве, «17:50».
export function hhmm(ts) {
  return new Date(ts).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
}

// Текст карточки. draft — черновик ИИ (или надиктованный), status — строка внизу.
export function dialogCardText({ label, name, clientText, draft, tag, plansNote, status, dictated }) {
  const parts = [];
  if (label) parts.push(label);
  if (clientText) parts.push("👤 " + (name || "Клиент") + ":\n" + clientText);
  if (draft) parts.push((dictated ? "🎤 Вы надиктовали" : "🤖 Черновик" + (tag ? " (" + tag + ")" : "")) + ":\n" + draft + (plansNote ? "\n🖼 + " + plansNote : ""));
  let text = parts.join("\n\n");
  if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX) + "…";
  return status ? text + "\n\n" + status : text;
}

// Как переписать черновик одной кнопкой (те же указания, что в CRM).
export const TG_REDRAFT = [
  { k: "s", label: "🔄 Короче", hint: "Короче" },
  { k: "w", label: "🔄 Теплее", hint: "Теплее и проще" },
  { k: "p", label: "🔄 + цена", hint: "Добавь цену" },
];
export function redraftHint(k) {
  const h = TG_REDRAFT.find((x) => x.k === k);
  return h ? h.hint : "";
}

const cb = (text, data) => ({ text, callback_data: String(data).slice(0, 64) });

// Кнопки карточки с черновиком. idx — номер черновика в диалоге (запасной путь,
// основной — поиск по сообщению Telegram), crmUrl — диплинк диалога в CRM.
export function dialogKeyboard({ idx, plans, crmUrl, dictated }) {
  const rows = [];
  if (dictated) {
    rows.push([cb("✅ Отправить клиенту", "send:" + idx), cb("🤖 Пусть ИИ напишет", "rv:" + idx)]);
    rows.push([cb("✖ Не отправлять", "drop:" + idx)]);
  } else {
    rows.push(plans && plans.length
      ? [cb("✅ С планировкой", "sendp:" + idx), cb("✅ Только текст", "send:" + idx), cb("✏️ Изменить", "edit:" + idx)]
      : [cb("✅ Отправить", "send:" + idx), cb("✏️ Изменить", "edit:" + idx)]);
    rows.push(TG_REDRAFT.map((h) => cb(h.label, "rd:" + idx + ":" + h.k)));
    rows.push([cb("🖼 Планировки", "pl:" + idx), cb("🗄 Архив", "arc:" + idx), cb("🚫 Спам", "spm:" + idx)]);
  }
  if (crmUrl) rows.push([{ text: "🔗 Открыть в CRM", url: crmUrl }]);
  return { inline_keyboard: rows };
}

// Выбор планировки — кнопками на месте основных (по две в ряд) и «назад».
export function planKeyboard(idx, plans) {
  const keys = Object.keys(plans || {});
  const rows = [];
  for (let i = 0; i < keys.length; i += 2) {
    rows.push(keys.slice(i, i + 2).map((k) => cb("🖼 " + plans[k].title.split(" — ")[0], "pls:" + idx + ":" + k)));
  }
  rows.push([cb("« Назад", "plb:" + idx)]);
  return { inline_keyboard: rows };
}

// Строки статуса.
export const STATUS = {
  thinking: "⏳ ИИ готовит ответ…",
  paused: "🔕 Нейропродавец выключен — ответьте клиенту вручную.",
  failed: "⚠️ ИИ не подготовил ответ — ответьте вручную.",
  stale: "⏸ Клиент написал ещё — свежая карточка ниже.",
  archived: "🗄 Диалог в архиве.",
  spam: "🚫 Помечен спамом.",
};
// Ответ ушёл клиенту: как и когда. Ушёл не тот текст, что в черновике, — показываем, какой.
export function sentStatus({ how, ts, text, draft }) {
  const head = "✅ Отправлено " + hhmm(ts) + (how ? " · " + how : "");
  const own = text && String(text).trim() !== String(draft || "").trim();
  return own ? head + "\n🙋 Вы: " + String(text).slice(0, 600) : head;
}

// Ссылки на ветку и на диалог в CRM.
export function topicLink(chatId, topicId) {
  return "https://t.me/c/" + String(chatId).replace(/^-100/, "") + "/" + topicId;
}
export function crmChatLink(base, key) {
  return String(base || "https://portal.kubrdom.ru").replace(/\/$/, "") + "/crm?go=chat%3D" + encodeURIComponent(key);
}
