// Расшифровка голосовых через SpeechKit — без сети и без Telegram.
// Проверяем не «вызвался ли fetch», а что решает модуль: когда расшифровывать,
// когда честно отказаться, и что при отказе голосовое всё равно не теряется.
import { transcribeVoice, sttSelfTest, STT_MAX_SEC } from "../src/stt.js";

let fails = 0;
function check(name, ok, got) {
  if (ok) { console.log("  OK  " + name); return; }
  fails++; console.log("ФЕЙЛ  " + name + (got !== undefined ? "  << " + JSON.stringify(got) : ""));
}

const ENV = { YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f", TG_BOT_TOKEN: "T" };
let lastUrl = "", lastHeaders = null, lastBody = null;

// Telegram отдаёт файл, SpeechKit — текст. Оба подменяем.
function mockFetch({ sttStatus = 200, sttJson = { result: "нужно ещё шесть квадратов вагонки" }, sttText = "", fileOk = true, fileBytes = 2048 } = {}) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/getFile")) {
      return { ok: true, json: async () => (fileOk ? { ok: true, result: { file_path: "voice/a.oga" } } : { ok: false }) };
    }
    if (u.includes("/file/bot")) {
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(fileBytes) };
    }
    if (u.includes("stt:recognize")) {
      lastUrl = u; lastHeaders = opts.headers; lastBody = opts.body;
      return { ok: sttStatus === 200, status: sttStatus,
        json: async () => sttJson, text: async () => sttText };
    }
    return { ok: true, json: async () => ({}) };
  };
}

console.log("\n── 1. Короткое голосовое превращается в текст");
mockFetch();
let r = await transcribeVoice(ENV, "vid", 12);
check("расшифровано", r.ok === true, r);
check("текст на месте", r.text === "нужно ещё шесть квадратов вагонки", r.text);
check("формат oggopus без перекодирования", /format=oggopus/.test(lastUrl), lastUrl);
check("язык русский", /lang=ru-RU/.test(lastUrl), lastUrl);
check("каталог передан", /folderId=f/.test(lastUrl), lastUrl);
check("авторизация Api-Key", lastHeaders.Authorization === "Api-Key k", lastHeaders);

console.log("\n── 2. Длинное голосовое не отправляем — сервис его всё равно не примет");
mockFetch();
lastUrl = "";
r = await transcribeVoice(ENV, "vid", STT_MAX_SEC + 5);
check("отказ", r.ok === false, r);
check("причина названа человеку", /длиннее/.test(r.reason), r.reason);
check("запрос в SpeechKit НЕ ушёл", lastUrl === "", lastUrl);

console.log("\n── 3. Файл больше 1 МБ тоже отсекаем до отправки");
mockFetch({ fileBytes: 1024 * 1024 + 1 });
lastUrl = "";
r = await transcribeVoice(ENV, "vid", 10);
check("отказ", r.ok === false && /1 МБ/.test(r.reason), r);
check("запрос НЕ ушёл", lastUrl === "", lastUrl);

console.log("\n── 4. Нет прав на SpeechKit — причина понятна, а не «ошибка 403»");
mockFetch({ sttStatus: 403, sttText: "forbidden" });
r = await transcribeVoice(ENV, "vid", 10);
check("отказ", r.ok === false, r);
check("сказано про права", /прав.*SpeechKit|роль/i.test(r.reason), r.reason);

console.log("\n── 5. Тишина в записи — не выдаём пустой текст за расшифровку");
mockFetch({ sttJson: { result: "   " } });
r = await transcribeVoice(ENV, "vid", 5);
check("отказ", r.ok === false && /не распознана/.test(r.reason), r);

console.log("\n── 6. Ключ не настроен — молчим понятно, без обращения к сети");
mockFetch();
lastUrl = "";
r = await transcribeVoice({ TG_BOT_TOKEN: "T" }, "vid", 5);
check("отказ", r.ok === false && /не настроена/.test(r.reason), r);
check("сети не касались", lastUrl === "", lastUrl);

console.log("\n── 7. Самопроверка ключа различает «нет прав» и «рабочий»");
mockFetch({ sttStatus: 403, sttText: "forbidden" });
let t = await sttSelfTest(ENV);
check("403 → не ок, названа роль", t.ok === false && /ai\.speechkit-stt\.user/.test(t.verdict), t);
mockFetch({ sttStatus: 400, sttText: "bad audio" });
t = await sttSelfTest(ENV);
check("400 на пустое аудио → ключ рабочий", t.ok === true, t);
t = await sttSelfTest({});
check("нет секрета → сказано прямо", t.ok === false && /YANDEX_API_KEY/.test(t.verdict), t);

console.log("\n" + (fails ? "❌ ПРОВАЛЕНО: " + fails : "✅ Все проверки пройдены"));
process.exit(fails ? 1 : 0);
