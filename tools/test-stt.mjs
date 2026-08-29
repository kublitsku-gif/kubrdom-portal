// Расшифровка голосовых через SpeechKit — без сети и без Telegram.
// Проверяем не «вызвался ли fetch», а что решает модуль: когда расшифровывать,
// когда честно отказаться, и что при отказе голосовое всё равно не теряется.
import { transcribeVoice, sttSelfTest, STT_MAX_SEC, STT_MAX_CHUNKS } from "../src/stt.js";
import { buildOpus } from "./helpers/ogg-fixture.mjs";

let fails = 0;
function check(name, ok, got) {
  if (ok) { console.log("  OK  " + name); return; }
  fails++; console.log("ФЕЙЛ  " + name + (got !== undefined ? "  << " + JSON.stringify(got) : ""));
}

const ENV = { YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f", TG_BOT_TOKEN: "T" };
let lastUrl = "", lastHeaders = null, lastBody = null;

// Telegram отдаёт файл, SpeechKit — текст. Оба подменяем.
let sttCalls = 0;
function mockFetch({ sttStatus = 200, sttJson = { result: "нужно ещё шесть квадратов вагонки" }, sttText = "", fileOk = true, fileBytes = 2048, audio = null, sttSeq = null } = {}) {
  sttCalls = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes("/getFile")) {
      return { ok: true, json: async () => (fileOk ? { ok: true, result: { file_path: "voice/a.oga" } } : { ok: false }) };
    }
    if (u.includes("/file/bot")) {
      const b = audio || new ArrayBuffer(fileBytes);
      return { ok: true, arrayBuffer: async () => b };
    }
    if (u.includes("stt:recognize")) {
      lastUrl = u; lastHeaders = opts.headers; lastBody = opts.body;
      const j = sttSeq ? { result: sttSeq[Math.min(sttCalls, sttSeq.length - 1)] } : sttJson;
      sttCalls++;
      return { ok: sttStatus === 200, status: sttStatus,
        json: async () => j, text: async () => sttText };
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

console.log("\n── 2. Длинное голосовое режется на куски и склеивается");
mockFetch({ audio: buildOpus(100).buffer, sttSeq: ["первый кусок", "второй кусок", "третий кусок", "четвёртый кусок"] });
r = await transcribeVoice(ENV, "vid", 100);
check("расшифровано", r.ok === true, r);
check("100 с при лимите 30 → 4 запроса", sttCalls === 4, sttCalls);
check("куски склеены по порядку", r.text === "первый кусок второй кусок третий кусок четвёртый кусок", r.text);

console.log("\n── 3. Глухой кусок в середине не рушит всю расшифровку");
mockFetch({ audio: buildOpus(100).buffer, sttSeq: ["начало", "  ", "конец", "хвост"] });
r = await transcribeVoice(ENV, "vid", 100);
check("расшифровка получена", r.ok === true, r);
check("пустой кусок пропущен, остальные на месте", r.text === "начало конец хвост", r.text);

console.log("\n── 3b. Слишком длинная запись — отказ с понятной причиной");
mockFetch({ audio: buildOpus(30 * (STT_MAX_CHUNKS + 4)).buffer });
r = await transcribeVoice(ENV, "vid", 30 * (STT_MAX_CHUNKS + 4));
check("отказ", r.ok === false, r);
check("сказано, что запись слишком длинная", /длиннее|минут/.test(r.reason), r.reason);

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
