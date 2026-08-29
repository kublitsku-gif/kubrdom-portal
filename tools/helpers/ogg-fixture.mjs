// Синтетический поток Ogg/Opus для тестов: страницы настоящие (заголовок, таблица
// сегментов, CRC), полезная нагрузка условная — распознавание в тестах не вызывается,
// проверяется работа с контейнером. Длительность задаём точно, чтобы проверять границы резки.
import { oggCrc } from "../../src/ogg.js";

const RATE = 48000;
const bytes = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

function page({ type, granule, seq, payload }) {
  const nseg = Math.ceil(payload.length / 255) || 1;
  const seg = [];
  let left = payload.length;
  for (let i = 0; i < nseg; i++) { const v = Math.min(255, left); seg.push(v); left -= v; }
  const p = new Uint8Array(27 + nseg + payload.length);
  p[0] = 0x4f; p[1] = 0x67; p[2] = 0x67; p[3] = 0x53;
  p[4] = 0; p[5] = type;
  let g = granule; for (let i = 0; i < 8; i++) { p[6 + i] = g % 256; g = Math.floor(g / 256); }
  const put32 = (o, v) => { p[o] = v & 255; p[o + 1] = (v >>> 8) & 255; p[o + 2] = (v >>> 16) & 255; p[o + 3] = (v >>> 24) & 255; };
  put32(14, 0xcafe); put32(18, seq); put32(22, 0);
  p[26] = nseg;
  for (let i = 0; i < nseg; i++) p[27 + i] = seg[i];
  p.set(payload, 27 + nseg);
  put32(22, oggCrc(p));
  return p;
}

export function buildOpus(seconds, pageSec = 0.5) {
  const parts = [
    page({ type: 0x02, granule: 0, seq: 0, payload: bytes("OpusHead" + "x".repeat(11)) }),
    page({ type: 0x00, granule: 0, seq: 1, payload: bytes("OpusTags" + "y".repeat(20)) }),
  ];
  const n = Math.round(seconds / pageSec);
  for (let i = 1; i <= n; i++) {
    parts.push(page({ type: i === n ? 0x04 : 0x00, granule: Math.round(i * pageSec * RATE), seq: 1 + i, payload: bytes("a".repeat(64)) }));
  }
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export { RATE, bytes };
