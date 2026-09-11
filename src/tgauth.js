// ─── ВХОД В ПОРТАЛ ИЗ TELEGRAM (Mini App) ────────────────────────────────────
// Кнопка «Портал» в боте и кнопки под напоминаниями открывают панель внутри Telegram,
// и Telegram кладёт в адрес подписанную строку initData: кто открыл и когда. Подпись
// сделана токеном НАШЕГО бота — без токена её не подделать, поэтому PIN здесь не нужен.
//
// Алгоритм — core.telegram.org/bots/webapps: секрет = HMAC-SHA256(ключ «WebAppData»,
// токен бота); hash = hex HMAC-SHA256(секрет, все поля кроме hash, отсортированные по
// имени, «имя=значение» через перевод строки).

// Подпись годна час: Telegram выписывает её заново при каждом открытии, а вход по ней
// нужен только в момент старта. Строка, утёкшая из истории браузера, через час бесполезна.
export const TG_INIT_MAX_AGE_S = 3600;
// Часы Telegram и Cloudflare расходятся на секунды — «подпись из будущего» терпим в этих пределах.
const CLOCK_SKEW_S = 60;
// Настоящая initData — сотни байт; длинную строку не хешируем, это чужой мусор.
const MAX_INIT_LEN = 4096;

const enc = new TextEncoder();

async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

const toHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

// Сравнение без раннего выхода: иначе по времени ответа подпись подбирается побайтно.
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// → { ok: true, tgUserId, authDate } | { ok: false, reason }
export async function verifyInitData(initData, botToken, nowMs) {
  if (typeof initData !== "string" || !initData || initData.length > MAX_INIT_LEN) return { ok: false, reason: "нет данных Telegram" };
  if (!botToken) return { ok: false, reason: "бот не настроен" };

  const params = new URLSearchParams(initData);
  const hash = (params.get("hash") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: "нет подписи" };

  const checkString = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + "=" + v)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  if (!sameHex(hash, toHex(await hmac(secret, checkString)))) return { ok: false, reason: "подпись не сошлась" };

  const authDate = Number(params.get("auth_date"));
  const nowS = Math.floor(nowMs / 1000);
  if (!Number.isFinite(authDate) || authDate > nowS + CLOCK_SKEW_S || nowS - authDate > TG_INIT_MAX_AGE_S) {
    return { ok: false, reason: "подпись устарела" };
  }

  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch { user = null; }
  if (!user || user.id === undefined || user.id === null) return { ok: false, reason: "в данных нет пользователя" };
  return { ok: true, tgUserId: String(user.id), authDate: authDate };
}
