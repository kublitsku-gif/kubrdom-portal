// ─── Web Push без библиотек: VAPID (RFC 8292) + шифрование aes128gcm (RFC 8291) ───
// Пуш уходит в push-сервис браузера (у Android Chrome это FCM). Текст шифруется ключами
// подписки, поэтому push-сервис его не видит; кто шлёт — подтверждает VAPID-подпись.
// Всё на WebCrypto: одинаково работает в Worker'е и в node (тесты).

const enc = new TextEncoder();

export function b64u(bytes) {
  let s = "";
  new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  parts.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
}

// Куда разрешено слать: только настоящие push-сервисы браузеров. Адрес подписки приходит
// от клиента, и без этого списка Worker можно было бы заставить постучаться куда угодно.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
const B64U = /^[A-Za-z0-9_-]+$/;

// Подписка из браузера → {endpoint, keys} или null, если она чужая или битая.
export function cleanSubscription(sub) {
  if (!sub || typeof sub !== "object") return null;
  const endpoint = String(sub.endpoint || "");
  let host;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return null;
    host = u.hostname;
  } catch (e) { return null; }
  if (endpoint.length > 1000 || !PUSH_HOSTS.some((re) => re.test(host))) return null;
  const k = sub.keys || {};
  const p256dh = String(k.p256dh || ""), auth = String(k.auth || "");
  if (!B64U.test(p256dh) || !B64U.test(auth) || unb64u(p256dh).length !== 65 || unb64u(auth).length !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// Шифрует payload ключами подписки — тело запроса с заголовком aes128gcm (одна запись).
export async function encryptPayload(keys, payload) {
  const uaPublic = unb64u(keys.p256dh);
  const authSecret = unb64u(keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));   // 0x02 — последняя запись, без паддинга
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]);                           // размер записи 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// VAPID: JWT на ES256, подписанный приватным ключом сервера (base64url 32 байта d),
// и публичный ключ (base64url 65 байт) — тот же, что браузер получил при подписке.
export async function vapidHeader(endpoint, vapid) {
  const pub = unb64u(vapid.publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: vapid.privateKey, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject };
  const body = b64u(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return "vapid t=" + head + "." + body + "." + b64u(sig) + ", k=" + vapid.publicKey;
}

// Один пуш одной подписке. Возвращает HTTP-статус push-сервиса (404/410 — подписка умерла).
export async function sendPush(sub, data, vapid, fetchFn = fetch) {
  const body = await encryptPayload(sub.keys, JSON.stringify(data));
  const r = await fetchFn(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body,
  });
  return r.status;
}
