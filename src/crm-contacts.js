// Клиенты CRM как телефонная книга: код клиента «КД-057», имя для экрана звонка и vCard.
// Чистая логика — её зовут и панель (код клиента в карточке), и Worker (CardDAV, src/carddav.js).

export const CODE_PREFIX = "КД-";
const CODE_DIGITS = 3;

// Значки стадий — те же, что в воронке CRM (CRM_STAGES в admin.js): при звонке видно, кто звонит.
export const STAGE_ICON = { new: "📥", qualified: "✅", kp: "📄", meeting: "🏭", contract: "📝", montaj: "🔨" };
export const STAGE_TITLE = { new: "Входящие", qualified: "Квалифицирован", kp: "Отправлено КП", meeting: "Встреча на производстве", contract: "Договор", montaj: "Монтаж" };

export function clientCode(n) {
  const num = Number(n);
  return num > 0 ? CODE_PREFIX + String(Math.floor(num)).padStart(CODE_DIGITS, "0") : "";
}

// Номер клиента выдаётся один раз и навсегда: следующий после самого большого, по порядку
// заведения. Две вкладки могли выдать один номер разным клиентам — позднему даём новый.
// Ничего не поменялось — возвращаем тот же массив (вызывающему так проще понять «сохранять ли»).
export function assignClientCodes(clients) {
  const list = Array.isArray(clients) ? clients : [];
  const order = list.map((c, i) => ({ c, i })).sort((a, b) =>
    String((a.c && a.c.date) || "").localeCompare(String((b.c && b.c.date) || "")) ||
    (Number(a.c && a.c.createdAt) || 0) - (Number(b.c && b.c.createdAt) || 0) || a.i - b.i);
  let max = list.reduce((m, c) => Math.max(m, Number(c && c.code) || 0), 0);
  const taken = new Set();
  const codes = new Array(list.length);
  order.forEach(({ c, i }) => {
    const own = Number(c && c.code) || 0;
    if (own > 0 && !taken.has(own)) { taken.add(own); codes[i] = own; return; }
    max += 1; taken.add(max); codes[i] = max;
  });
  if (list.every((c, i) => !c || Number(c.code) === codes[i])) return list;
  return list.map((c, i) => (c && Number(c.code) !== codes[i] ? { ...c, code: codes[i] } : c));
}

// Имя контакта в телефоне: «КД-057 📄 Светлана Орлова» — на экране звонка ~25 символов,
// поэтому главное в начале: номер клиента, стадия, имя.
export function contactName(c) {
  return [clientCode(c && c.code), STAGE_ICON[c && c.stage] || "", String((c && c.name) || "Клиент").trim()]
    .filter(Boolean).join(" ");
}

// Телефон в международном виде: «+7 (903) 259-93-33» и «89032599333» → «+79032599333».
export function contactPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return "+7" + d.slice(1);
  if (d.length === 10) return "+7" + d;
  return d.length >= 7 ? "+" + d : "";
}

// Текст vCard 3.0: экранируем \ , ; и переводы строк (RFC 2426).
function esc(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

const NOTE_MAX = 300;

export function clientVcard(c, baseUrl) {
  const name = contactName(c);
  const org = ["КубрДом", c.source || "", STAGE_TITLE[c.stage] || ""].filter(Boolean).join(" · ");
  const note = [c.msg, c.notes].filter(Boolean).join("\n").slice(0, NOTE_MAX);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "UID:kubrdom-crm-" + esc(c.id),
    "FN:" + esc(name),
    "N:;" + esc(name) + ";;;",
    "ORG:" + esc(org),
    "TEL;TYPE=CELL:" + contactPhone(c.phone),
    "CATEGORIES:КубрДом CRM",
  ];
  if (note) lines.push("NOTE:" + esc(note));
  if (baseUrl) lines.push("URL:" + String(baseUrl).replace(/\/$/, "") + "/crm?go=client%3D" + encodeURIComponent(c.id));
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

// Короткий хэш для ETag/ctag (не для безопасности): меняется вместе с текстом карточки.
export function textHash(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

// Адрес карточки в книге: только безопасные символы, иначе хэш id.
function cardFile(id) {
  const s = String(id || "");
  return (/^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : "h" + textHash(s)) + ".vcf";
}

// Книга целиком: клиенты с телефоном (без номера контакт звонок не опознает).
export function contactCards(clients, baseUrl) {
  return assignClientCodes(clients)
    .filter((c) => c && c.id && contactPhone(c.phone))
    .map((c) => {
      const vcard = clientVcard(c, baseUrl);
      return { id: String(c.id), file: cardFile(c.id), vcard, etag: '"' + textHash(vcard) + '"' };
    });
}
