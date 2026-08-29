// ─── РЕЗКА OGG/OPUS ПО СТРАНИЦАМ ─────────────────────────────────────────────
// Синхронное распознавание SpeechKit берёт не больше 30 секунд за раз, а голосовое
// с объекта бывает и на три минуты. Асинхронное API требует Yandex Object Storage —
// отдельный бакет, сервисный аккаунт и новые ключи. Вместо этого режем аудио сами.
//
// Ogg — контейнер из страниц, и Opus внутри него режется по границам страниц БЕЗ
// перекодирования: это чистая работа с байтами, никакого ffmpeg (в Worker его и негде
// взять). Каждый кусок собирается как самостоятельный поток: два заголовка исходника
// (OpusHead + OpusTags) плюс своя порция аудиостраниц.
//
// Переписываем в каждой странице номер по порядку, гранулу (время от начала КУСКА)
// и флаги начала/конца потока — а значит обязаны пересчитать CRC: он считается по
// всей странице, включая эти поля.

const OGGS = 0x4f676753;                 // "OggS"
const RATE = 48000;                      // гранула Opus всегда в 48 кГц, независимо от записи

// CRC-32 Ogg: полином 0x04c11db7, без отражения бит, начальное 0, без финального XOR.
// Это НЕ обычный zip-CRC — тот отражённый, и на нём страницы не примет ни один декодер.
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();
function oggCrc(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function putU32le(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; }
// Гранула — 64 бита. Считаем через Number: 2^53 сэмплов при 48 кГц это ~5700 лет,
// в голосовом сообщении столько не бывает.
function readGranule(b, o) {
  let v = 0;
  for (let i = 7; i >= 0; i--) v = v * 256 + b[o + i];
  return v;
}
function writeGranule(b, o, v) {
  let x = Math.max(0, Math.floor(v));
  for (let i = 0; i < 8; i++) { b[o + i] = x % 256; x = Math.floor(x / 256); }
}

// Разбор потока на страницы. Возвращает [] на любом мусоре — вызывающий тогда
// просто не режет и работает как раньше, а не падает.
export function oggPages(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const pages = [];
  let o = 0;
  while (o + 27 <= b.length) {
    if (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 !== OGGS) return pages.length ? pages : [];
    const nseg = b[o + 26];
    const tableEnd = o + 27 + nseg;
    if (tableEnd > b.length) break;
    let payload = 0;
    for (let i = 0; i < nseg; i++) payload += b[tableEnd - nseg + i];
    const end = tableEnd + payload;
    if (end > b.length) break;
    pages.push({
      start: o, end: end,
      headerType: b[o + 5],
      granule: readGranule(b, o + 6),
      serial: u32le(b, o + 14),
      seq: u32le(b, o + 18),
      bytes: b.subarray(o, end),
    });
    o = end;
  }
  return pages;
}

// Собрать страницу заново с новыми номером/гранулой/флагами и пересчитанным CRC.
function rewritePage(src, { seq, granule, headerType }) {
  const p = new Uint8Array(src.length);
  p.set(src);
  p[5] = headerType;
  writeGranule(p, 6, granule);
  putU32le(p, 18, seq);
  putU32le(p, 22, 0);                    // CRC обнуляем перед подсчётом — так требует формат
  putU32le(p, 22, oggCrc(p));
  return p;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const startsWith = (page, s) => {
  const base = 27 + page.bytes[26];      // 27 байт заголовка + таблица сегментов
  for (let i = 0; i < s.length; i++) if (page.bytes[base + i] !== s.charCodeAt(i)) return false;
  return true;
};

// Режем на куски не длиннее maxSec. Возвращаем [] если поток не Opus или резать
// нечего — вызывающий тогда работает по-старому.
export function splitOpus(buf, maxSec, maxChunks) {
  const pages = oggPages(buf);
  if (pages.length < 3) return [];
  const heads = [];
  let i = 0;
  while (i < pages.length && (startsWith(pages[i], "OpusHead") || startsWith(pages[i], "OpusTags"))) { heads.push(pages[i]); i++; }
  if (!heads.length) return [];          // не Opus — не наш случай, пусть идёт как есть
  const audio = pages.slice(i);
  if (!audio.length) return [];

  const total = audio[audio.length - 1].granule / RATE;
  if (total <= maxSec) return [];        // влезает целиком — резать незачем

  const groups = [];
  let cur = [], base = 0;
  for (const pg of audio) {
    cur.push(pg);
    if ((pg.granule - base) / RATE >= maxSec) { groups.push({ pages: cur, base: base }); base = pg.granule; cur = []; }
  }
  if (cur.length) groups.push({ pages: cur, base: base });
  if (maxChunks && groups.length > maxChunks) return [];   // слишком длинное — решает вызывающий

  return groups.map(function (g) {
    const out = [];
    let seq = 0;
    // Заголовки повторяем в каждом куске: без них это не поток, а обрывок.
    for (const h of heads) out.push(rewritePage(h.bytes, { seq: seq++, granule: h.granule, headerType: h.headerType }));
    g.pages.forEach(function (pg, idx) {
      const last = idx === g.pages.length - 1;
      out.push(rewritePage(pg.bytes, {
        seq: seq++,
        granule: pg.granule - g.base,    // время внутри куска, а не от начала записи
        headerType: last ? (pg.headerType | 0x04) : (pg.headerType & ~0x04),  // EOS на последней
      }));
    });
    return concat(out);
  });
}

export { oggCrc };
