// CardDAV только на чтение: клиенты CRM — отдельная адресная книга «КубрДом CRM» в телефоне
// (Android — приложение DAVx⁵, iPhone — встроенная учётная запись CardDAV). Телефон сам
// подтягивает новых клиентов и смену стадии, а при звонке показывает «КД-057 📄 Имя».
//
// Минимум протокола, которого хватает DAVx⁵ и iOS: OPTIONS, PROPFIND (корень → принципал →
// дом книг → книга → карточки), REPORT addressbook-multiget/addressbook-query, GET.
// Записи нет: правка контакта в телефоне в CRM не уходит (книгу помечаем «только чтение»).
//
// Адреса — под /api/, потому что наружу портал отдаёт Worker только через прокси /api/*.

import { textHash } from "./crm-contacts.js";

export const DAV_ROOT = "/api/dav/";
const PRINCIPAL = DAV_ROOT + "principal/";
const HOME = DAV_ROOT + "books/";
const BOOK = HOME + "crm/";
const BOOK_NAME = "КубрДом CRM";
const REALM = "KubrDom CRM";

const NS = 'xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/"';

function xmlEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function multistatus(responses) {
  return '<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus ' + NS + ">" + responses.join("") + "</d:multistatus>";
}
function response(href, props) {
  return "<d:response><d:href>" + xmlEsc(href) + "</d:href><d:propstat><d:prop>" + props +
    "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>";
}
function davResponse(status, body, extra) {
  return new Response(body, { status, headers: Object.assign({ "Content-Type": "application/xml; charset=utf-8", DAV: "1, 3, addressbook" }, extra || {}) });
}

const READ_ONLY = "<d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>";
const POINTERS = "<d:current-user-principal><d:href>" + PRINCIPAL + "</d:href></d:current-user-principal>" +
  "<card:addressbook-home-set><d:href>" + HOME + "</d:href></card:addressbook-home-set>";

function bookProps(cards) {
  const ctag = cards.map((c) => c.id + c.etag).join("|");
  return "<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>" +
    "<d:displayname>" + xmlEsc(BOOK_NAME) + "</d:displayname>" +
    "<cs:getctag>" + xmlEsc(String(cards.length) + "-" + textHash(ctag)) + "</cs:getctag>" +
    "<d:supported-report-set>" +
      "<d:supported-report><d:report><card:addressbook-multiget/></d:report></d:supported-report>" +
      "<d:supported-report><d:report><card:addressbook-query/></d:report></d:supported-report>" +
    "</d:supported-report-set>" + READ_ONLY + POINTERS;
}
function cardProps(c, withData) {
  return "<d:getetag>" + xmlEsc(c.etag) + "</d:getetag><d:getcontenttype>text/vcard; charset=utf-8</d:getcontenttype><d:resourcetype/>" +
    (withData ? "<card:address-data>" + xmlEsc(c.vcard) + "</card:address-data>" : "");
}

// Basic-авторизация: логин — телефон сотрудника, пароль — отдельный пароль для телефона из CRM.
function basicCreds(request) {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  try {
    const raw = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0)));
    const i = raw.indexOf(":");
    return i < 0 ? null : { user: raw.slice(0, i), pass: raw.slice(i + 1) };
  } catch (e) { return null; }
}
function unauthorized() {
  return new Response("Нужен логин и пароль из CRM", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="' + REALM + '", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" } });
}

// Какие карточки просит addressbook-multiget (их адреса в <d:href>); пусто — значит все (query).
function requestedFiles(body) {
  const out = [];
  const re = /<(?:[A-Za-z0-9_-]+:)?href>([^<]+)<\/(?:[A-Za-z0-9_-]+:)?href>/g;
  let m;
  while ((m = re.exec(body))) {
    const href = decodeURIComponent(m[1].trim().replace(/^https?:\/\/[^/]+/, ""));
    if (href.indexOf(BOOK) === 0) out.push(href.slice(BOOK.length));
  }
  return out;
}

// deps: authenticate(user, pass) → uid | null; loadCards() → [{id,file,vcard,etag}].
export async function handleCardDav(request, url, deps) {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, { status: 200, headers: { DAV: "1, 3, addressbook", Allow: "OPTIONS, GET, HEAD, PROPFIND, REPORT" } });
  }
  const creds = basicCreds(request);
  if (!creds || !(await deps.authenticate(creds.user, creds.pass))) return unauthorized();
  let path = url.pathname;
  if (!path.endsWith("/") && !path.endsWith(".vcf")) path += "/";
  if (["PUT", "DELETE", "MKCOL", "PROPPATCH", "MOVE", "COPY", "POST"].includes(method)) {
    return new Response("Книга только для чтения — клиентов правят в CRM", { status: 403 });
  }
  const cards = await deps.loadCards();
  const depth = request.headers.get("Depth") || "0";

  if (method === "PROPFIND") {
    if (path === DAV_ROOT || path === PRINCIPAL) {
      const type = path === PRINCIPAL ? "<d:resourcetype><d:principal/></d:resourcetype>" : "<d:resourcetype><d:collection/></d:resourcetype>";
      return davResponse(207, multistatus([response(path, type + "<d:displayname>КубрДом</d:displayname>" + POINTERS)]));
    }
    if (path === HOME) {
      const out = [response(HOME, "<d:resourcetype><d:collection/></d:resourcetype>" + POINTERS)];
      if (depth !== "0") out.push(response(BOOK, bookProps(cards)));
      return davResponse(207, multistatus(out));
    }
    if (path === BOOK) {
      const out = [response(BOOK, bookProps(cards))];
      if (depth !== "0") cards.forEach((c) => out.push(response(BOOK + c.file, cardProps(c, false))));
      return davResponse(207, multistatus(out));
    }
    const one = path.indexOf(BOOK) === 0 && cards.find((c) => BOOK + c.file === path);
    return one ? davResponse(207, multistatus([response(path, cardProps(one, false))])) : new Response("Нет такого контакта", { status: 404 });
  }
  if (method === "REPORT") {
    if (path !== BOOK) return new Response("REPORT — только по книге", { status: 403 });
    const body = await request.text();
    const want = requestedFiles(body);
    const list = want.length ? cards.filter((c) => want.includes(c.file)) : cards;
    const out = list.map((c) => response(BOOK + c.file, cardProps(c, true)));
    // Запрошенный, но удалённый из CRM контакт — 404, чтобы телефон его стёр.
    want.filter((f) => !cards.some((c) => c.file === f)).forEach((f) => {
      out.push("<d:response><d:href>" + xmlEsc(BOOK + f) + "</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>");
    });
    return davResponse(207, multistatus(out));
  }
  if (method === "GET" || method === "HEAD") {
    const vcfHeaders = (etag) => ({ "Content-Type": "text/vcard; charset=utf-8", ETag: etag });
    if (path === BOOK) {   // вся книга одним файлом — можно и просто импортировать в контакты
      const all = cards.map((c) => c.vcard).join("");
      return new Response(method === "HEAD" ? null : all, { status: 200, headers: vcfHeaders('"' + textHash(all) + '"') });
    }
    const one = cards.find((c) => BOOK + c.file === path);
    if (!one) return new Response("Нет такого контакта", { status: 404 });
    return new Response(method === "HEAD" ? null : one.vcard, { status: 200, headers: vcfHeaders(one.etag) });
  }
  return new Response("Метод не поддерживается", { status: 405, headers: { Allow: "OPTIONS, GET, HEAD, PROPFIND, REPORT" } });
}
