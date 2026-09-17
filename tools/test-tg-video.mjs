// Видео с объекта в Telegram: размер кадра и потоковый просмотр.
// Без width/height Telegram на Mac показывал телефонный ролик маленьким окошком.
import { videoForm, videoMetaFromQuery } from "../src/tgvideo.js";

let fails = 0;
function check(name, ok, got) {
  if (ok) { console.log("  OK  " + name); return; }
  fails++; console.log("ФЕЙЛ  " + name + (got !== undefined ? "  << " + JSON.stringify(got) : ""));
}

const q = (s) => new URLSearchParams(s);
const form = (meta) => videoForm({
  chatId: -100, topicId: 7, blob: new Blob(["x"], { type: "video/mp4" }),
  fileName: "VID.mp4", caption: "Баня Буханка", meta,
});

console.log("Размер из query");
check("вертикальный ролик", JSON.stringify(videoMetaFromQuery(q("w=1080&h=1920&dur=11"))) === JSON.stringify({ width: 1080, height: 1920, duration: 11 }));
check("старый клиент без параметров — нули", JSON.stringify(videoMetaFromQuery(q("objName=x"))) === JSON.stringify({ width: 0, height: 0, duration: 0 }));
const half = videoMetaFromQuery(q("w=1080&h=0&dur=5"));
check("одна сторона без другой не передаётся", half.width === 0 && half.height === 0 && half.duration === 5, half);
const junk = videoMetaFromQuery(q("w=abc&h=-5&dur=Infinity"));
check("мусор отбрасывается", junk.width === 0 && junk.height === 0 && junk.duration === 0, junk);
check("нереальный размер отбрасывается", videoMetaFromQuery(q("w=99999&h=1920")).width === 0);

console.log("Форма sendVideo");
const full = form({ width: 1080, height: 1920, duration: 11 });
check("ширина и высота уходят в Telegram", full.get("width") === "1080" && full.get("height") === "1920");
check("длительность уходит в Telegram", full.get("duration") === "11");
check("потоковый просмотр включён", full.get("supports_streaming") === "true");
check("тема и подпись на месте", full.get("message_thread_id") === "7" && full.get("caption") === "Баня Буханка" && full.get("chat_id") === "-100");
const bare = form({ width: 0, height: 0, duration: 0 });
check("без размера поля не шлём", !bare.has("width") && !bare.has("height") && !bare.has("duration"));
check("стриминг и без размера", bare.get("supports_streaming") === "true");

if (fails) { console.log("\nПровалено: " + fails); process.exit(1); }
console.log("\nВсе проверки прошли");
