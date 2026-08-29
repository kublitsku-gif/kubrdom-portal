// Резка OGG/Opus на куски. Главная проверка — CRC: он считается по нестандартному
// полиному без отражения бит, и ошибка здесь даёт страницы, которые молча отвергнет
// любой декодер. Поэтому сверяем свой расчёт с CRC, записанным настоящим кодировщиком
// в реальный .ogg файл, а не только с самими собой.
import fs from "node:fs";
import { oggPages, splitOpus, oggCrc } from "../src/ogg.js";
import { buildOpus, bytes, RATE } from "./helpers/ogg-fixture.mjs";

let fails = 0;
function check(name, ok, got) {
  if (ok) { console.log("  OK  " + name); return; }
  fails++; console.log("ФЕЙЛ  " + name + (got !== undefined ? "  << " + JSON.stringify(got) : ""));
}

// Пересчёт CRC страницы «как есть»: обнуляем поле и считаем заново.
function crcValid(pg) {
  const c = new Uint8Array(pg.bytes); const stored = (c[22]|(c[23]<<8)|(c[24]<<16)|(c[25]<<24))>>>0;
  c[22]=c[23]=c[24]=c[25]=0;
  return oggCrc(c) === stored;
}

console.log("\n── 1. CRC сверен с настоящим файлом, а не сам с собой");
const real = fs.existsSync("/tmp/sample_Example.ogg") ? new Uint8Array(fs.readFileSync("/tmp/sample_Example.ogg")) : null;
if (!real) { console.log("  ПРОПУСК  файла-образца нет"); }
else {
  const rp = oggPages(real);
  check("реальный файл разобран на страницы", rp.length >= 3, rp.length);
  check("CRC КАЖДОЙ страницы совпал с записанным кодировщиком", rp.every(crcValid), rp.filter(p => !crcValid(p)).length + " не сошлись");
  check("страницы покрыли файл целиком", rp[rp.length-1].end === real.length, { end: rp[rp.length-1].end, size: real.length });
}

console.log("\n── 2. Короткое не режем — незачем плодить запросы");
check("100 c при лимите 30 → режем", splitOpus(buildOpus(100), 30, 20).length > 1);
check("20 c при лимите 30 → не режем", splitOpus(buildOpus(20), 30, 20).length === 0);

console.log("\n── 3. Куски — самостоятельные потоки, а не обрывки");
const chunks = splitOpus(buildOpus(100), 30, 20);
check("получилось 4 куска на 100 с", chunks.length === 4, chunks.length);
chunks.forEach((c, i) => {
  const pg = oggPages(c);
  const head = pg[0], tags = pg[1];
  const hdrOk = String.fromCharCode(...head.bytes.subarray(27 + head.bytes[26], 27 + head.bytes[26] + 8)) === "OpusHead";
  const tagOk = String.fromCharCode(...tags.bytes.subarray(27 + tags.bytes[26], 27 + tags.bytes[26] + 8)) === "OpusTags";
  check(`кусок ${i+1}: заголовки OpusHead+OpusTags на месте`, hdrOk && tagOk);
  check(`кусок ${i+1}: CRC всех страниц пересчитан верно`, pg.every(crcValid));
  check(`кусок ${i+1}: нумерация страниц подряд с нуля`, pg.every((p, k) => p.seq === k));
  check(`кусок ${i+1}: последняя страница помечена концом потока`, (pg[pg.length-1].headerType & 0x04) !== 0);
  check(`кусок ${i+1}: время отсчитывается от начала куска`, pg[pg.length-1].granule / RATE <= 31, pg[pg.length-1].granule / RATE);
});

console.log("\n── 4. Слишком длинное отдаём наверх, а не режем на сотню кусков");
check("10 минут при лимите 4 куска → отказ", splitOpus(buildOpus(600), 30, 4).length === 0);

console.log("\n── 5. Мусор на входе не роняет разбор");
check("не Ogg → пусто", splitOpus(bytes("это не аудио вовсе"), 30, 20).length === 0);
check("обрезанный файл → пусто", splitOpus(buildOpus(100).subarray(0, 40), 30, 20).length === 0);

console.log("\n" + (fails ? "❌ ПРОВАЛЕНО: " + fails : "✅ Все проверки пройдены"));
process.exit(fails ? 1 : 0);
