// ─── РАСШИФРОВКА ГОЛОСОВЫХ (Yandex SpeechKit) ────────────────────────────────
// Голосовое с объекта — это самый дешёвый способ завести вопрос: бригадир не станет
// набирать абзац в перчатках. Но пока оно остаётся аудиофайлом, вопрос нельзя ни
// найти поиском, ни показать в сводке, ни переслать снабженцу текстом.
//
// Почему SpeechKit, а не Kimi: у Kimi (Moonshot) в API распознавания речи НЕТ —
// только чат и понимание изображений/видео. Открытая модель Kimi-Audio существует,
// но её надо разворачивать самим, из Worker это недостижимо. У SpeechKit русская
// речь — родной сценарий, и ключ с каталогом в портале уже есть (YandexGPT,
// голосовой обзвон), заводить новый секрет не требуется.
//
// Синхронное API: до 1 МБ и 30 секунд, один канал. Голосовое Telegram — это
// OGG/Opus моно, формат совпадает один в один, перекодировать не нужно.
// Что длиннее — не режем и не теряем: оставляем ссылку на аудио и пишем причину.

import { fetchTgFile } from "./tgapi.js";
import { splitOpus } from "./ogg.js";

const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";
export const STT_MAX_SEC = 30;
export const STT_MAX_BYTES = 1024 * 1024;
// Длинное голосовое режем на куски по 30 с и склеиваем расшифровки. Потолок в кусках,
// а не в секундах: каждый кусок — отдельный запрос, и на десятиминутной записи мы бы
// упёрлись во время ответа вебхука Telegram и получили повторную доставку.
export const STT_MAX_CHUNKS = 10;   // ~5 минут записи

// Причина словами — она попадёт в тикет вместо текста, чтобы человек понимал,
// почему расшифровки нет, и не считал это поломкой.
function why(reason) { return { ok: false, reason: reason }; }

export async function transcribeVoice(env, fileId, durationSec) {
  const key = env.YANDEX_API_KEY;
  const folder = env.YANDEX_FOLDER_ID;
  if (!key || !folder) return why("расшифровка не настроена");
  const f = await fetchTgFile(env, fileId);
  if (!f || !f.buf) return why("не удалось скачать аудио из Telegram");

  // Влезает целиком — один запрос, как было.
  if (f.buf.byteLength <= STT_MAX_BYTES && (!durationSec || durationSec <= STT_MAX_SEC)) {
    return await recognizeOne(env, f.buf);
  }

  // Не влезает — режем сами. Асинхронное API SpeechKit тут не помощник: оно берёт
  // аудио ТОЛЬКО из Yandex Object Storage, а это отдельный бакет, сервисный аккаунт
  // и новые ключи. Резка по страницам Ogg не требует ни того, ни другого.
  const chunks = splitOpus(f.buf, STT_MAX_SEC, STT_MAX_CHUNKS);
  if (!chunks.length) {
    const mins = Math.round((durationSec || 0) / 60);
    return why(durationSec && durationSec > STT_MAX_SEC * STT_MAX_CHUNKS
      ? "запись длиннее " + Math.floor(STT_MAX_SEC * STT_MAX_CHUNKS / 60) + " минут"
      : "не удалось разобрать аудио" + (mins ? " (" + mins + " мин)" : ""));
  }

  const parts = [];
  for (const c of chunks) {
    if (c.byteLength > STT_MAX_BYTES) return why("кусок записи больше 1 МБ");
    const one = await recognizeOne(env, c);
    // Один глухой кусок (пауза, шум) не должен рушить всю расшифровку —
    // пропускаем его, а на ошибке сервиса останавливаемся честно.
    if (!one.ok) {
      if (/не распознана/.test(one.reason || "")) continue;
      return parts.length ? { ok: true, text: parts.join(" "), partial: true } : one;
    }
    parts.push(one.text);
  }
  if (!parts.length) return why("речь не распознана");
  return { ok: true, text: parts.join(" "), chunks: chunks.length };
}

// Один вызов синхронного распознавания.
async function recognizeOne(env, audio) {
  const qs = new URLSearchParams({ folderId: env.YANDEX_FOLDER_ID, lang: "ru-RU", format: "oggopus" });
  let r;
  try {
    r = await fetch(STT_URL + "?" + qs.toString(), {
      method: "POST",
      headers: { "Authorization": "Api-Key " + env.YANDEX_API_KEY },
      body: audio,
    });
  } catch (e) { return why("сервис распознавания недоступен"); }

  if (!r.ok) {
    const body = await r.text().catch(function () { return ""; });
    // 401/403 — ключу не выданы права на SpeechKit; это настройка, а не сбой,
    // и текст ошибки должен об этом сказать прямо.
    if (r.status === 401 || r.status === 403) return why("нет прав на SpeechKit (проверьте роль ключа)");
    return why("распознавание вернуло " + r.status + (body ? ": " + body.slice(0, 120) : ""));
  }
  const j = await r.json().catch(function () { return null; });
  const text = j && typeof j.result === "string" ? j.result.trim() : "";
  if (!text) return why("речь не распознана");
  return { ok: true, text: text };
}

// Проверка ключа без реального аудио: пустое тело — заведомо некорректный запрос.
// 400 значит «авторизация прошла, не понравилось аудио» — то есть ключ рабочий.
// 401/403 — ключ или роль не те. Нужна, чтобы не выяснять это на живом голосовом.
export async function sttSelfTest(env) {
  if (!env.YANDEX_API_KEY) return { ok: false, status: 0, verdict: "секрет YANDEX_API_KEY не задан" };
  if (!env.YANDEX_FOLDER_ID) return { ok: false, status: 0, verdict: "не задан YANDEX_FOLDER_ID" };
  const qs = new URLSearchParams({ folderId: env.YANDEX_FOLDER_ID, lang: "ru-RU", format: "oggopus" });
  let r;
  try {
    r = await fetch(STT_URL + "?" + qs.toString(), {
      method: "POST",
      headers: { "Authorization": "Api-Key " + env.YANDEX_API_KEY },
      body: new Uint8Array(0),
    });
  } catch (e) { return { ok: false, status: 0, verdict: "сеть: " + String((e && e.message) || e) }; }
  const body = await r.text().catch(function () { return ""; });
  if (r.status === 401 || r.status === 403) {
    return { ok: false, status: r.status, verdict: "ключ есть, но нет прав на SpeechKit — выдайте сервисному аккаунту роль ai.speechkit-stt.user", body: body.slice(0, 200) };
  }
  if (r.status === 400) return { ok: true, status: 400, verdict: "ключ рабочий — SpeechKit отвечает (400 на пустое аудио это норма)" };
  return { ok: r.ok, status: r.status, verdict: "неожиданный ответ", body: body.slice(0, 200) };
}
