#!/usr/bin/env node
// Клиенты CRM в телефонной книге: код «КД-057», vCard и CardDAV (src/crm-contacts.js, src/carddav.js).
// CardDAV гоняем настоящим worker.fetch на SQL: вход телефоном и паролем из CRM, книга только на чтение.
import worker from '../src/worker.js'
import { sqliteDB } from './harness/sqlite-db.js'
import { assignClientCodes, clientCode, contactName, contactPhone, clientVcard, contactCards } from '../src/crm-contacts.js'

let failed = 0
const ok = (name, cond, detail) => { if (cond) console.log('  ✓ ' + name); else { failed++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')) } }

{
  console.log('Код клиента и имя для экрана звонка')
  const list = [
    { id: 'b', name: 'Б', date: '2026-07-02' },
    { id: 'a', name: 'А', date: '2026-06-01' },
    { id: 'c', name: 'В', date: '2026-08-01', code: 7 },
  ]
  const coded = assignClientCodes(list)
  ok('номера по порядку заведения, после самого большого', coded.map((c) => c.code).join() === '9,8,7', coded.map((c) => c.code).join())
  ok('исходный массив не тронут', list[0].code === undefined)
  ok('всё с номерами — тот же массив (сохранять нечего)', assignClientCodes(coded) === coded)
  const dup = assignClientCodes([{ id: 'x', code: 3, date: '2026-01-01' }, { id: 'y', code: 3, date: '2026-02-01' }])
  ok('один номер у двоих (две вкладки) — позднему новый', dup[0].code === 3 && dup[1].code === 4)
  ok('КД-057 с ведущими нулями', clientCode(57) === 'КД-057' && clientCode(1234) === 'КД-1234' && clientCode(0) === '')
  ok('имя: номер, значок стадии, имя', contactName({ code: 57, stage: 'kp', name: 'Светлана Орлова' }) === 'КД-057 📄 Светлана Орлова')
  ok('телефон в международном виде', contactPhone('8 (903) 259-93-33') === '+79032599333' && contactPhone('+7 916 234-11-22') === '+79162341122' && contactPhone('9032599333') === '+79032599333' && contactPhone('') === '')
}

{
  console.log('vCard')
  const v = clientVcard({ id: 'c1', code: 5, stage: 'meeting', name: 'Иван; ООО «Рога, копыта»', phone: '89161112233', source: 'Авито', msg: 'строка1\nстрока2' }, 'https://portal.kubrdom.ru')
  ok('строки через CRLF, начало и конец', v.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n') && v.endsWith('END:VCARD\r\n'))
  ok('запятые, точки с запятой и переводы строк экранированы', v.includes('FN:КД-005 🏭 Иван\\; ООО «Рога\\, копыта»') && v.includes('NOTE:строка1\\nстрока2'), v)
  ok('телефон, организация со стадией, ссылка на карточку', v.includes('TEL;TYPE=CELL:+79161112233') && v.includes('ORG:КубрДом · Авито · Встреча на производстве') && v.includes('URL:https://portal.kubrdom.ru/crm?go=client%3Dc1'))
  const cards = contactCards([{ id: 'p1', name: 'С телефоном', phone: '+7 900 000-00-01' }, { id: 'p2', name: 'Без телефона', phone: '' }, { id: 'плохой id/../', name: 'X', phone: '+7 900 000-00-02' }])
  ok('в книге только клиенты с телефоном', cards.length === 2 && cards[0].file === 'p1.vcf')
  ok('опасный id не попадает в адрес карточки', /^h[0-9a-f]{8}\.vcf$/.test(cards[1].file), cards[1].file)
}

// ── CardDAV через настоящий Worker ──────────────────────────────────────────
const USERS = [
  { id: 'yuriy', name: 'Юрий', phone: '+7 (903) 259-93-33', pin: '4271', roles: ['admin'] },
  { id: 'valera', name: 'Валера', phone: '+7 926 111-22-33', pin: '1234', roles: ['brigadier'] },
]
const CLIENTS = [
  { id: 'c1', name: 'Светлана Орлова', phone: '+7 916 234-11-22', stage: 'kp', source: 'Авито', date: '2026-06-01' },
  { id: 'c2', name: 'Без номера', phone: '', stage: 'new', date: '2026-06-02' },
]
const real = sqliteDB({ users: USERS, rolePermissions: { brigadier: ['assign'] }, crmClients: CLIENTS })
const ENV = { DB: real.db, ADMIN_TOKEN: 'master-secret', PUBLIC_BASE_URL: 'https://portal.kubrdom.ru' }
const CTX = { waitUntil() {} }
const call = (path, init = {}) => worker.fetch(new Request('https://portal.kubrdom.ru' + path, init), ENV, CTX)
const basic = (u, p) => 'Basic ' + Buffer.from(u + ':' + p).toString('base64')
const login = async (phone, pin) => (await (await call('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, pin }) })).json()).token

{
  console.log('Пароль для телефона')
  const token = await login('+7 (903) 259-93-33', '4271')
  const st = await (await call('/api/crm/contacts-token', { headers: { 'X-Admin-Token': token } })).json()
  ok('сначала не подключено, логин — телефон', st.success && st.connected === false && st.login === '79032599333' && st.url === 'https://portal.kubrdom.ru/api/dav/', JSON.stringify(st))
  const mk = await (await call('/api/crm/contacts-token', { method: 'POST', headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' }, body: '{}' })).json()
  ok('выдан пароль вида xxxx-xxxx-xxxx-xxxx', mk.success && /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(mk.password), JSON.stringify(mk))
  const row = real.db.prepare("SELECT data FROM work_states WHERE storage_key='dav_tokens' AND work_id='yuriy'")
  const saved = (await row.first()) || {}
  ok('в базе только хэш, не пароль', saved.data && !saved.data.includes(mk.password) && !saved.data.includes(mk.password.replace(/-/g, '')))
  const master = await (await call('/api/crm/contacts-token', { method: 'POST', headers: { 'X-Admin-Token': 'master-secret', 'Content-Type': 'application/json' }, body: '{}' })).json()
  ok('под мастер-токеном пароль не выдаём (он не сотрудник)', master.success === false)
  const brig = await login('+7 926 111-22-33', '1234')
  const r403 = await call('/api/crm/contacts-token', { headers: { 'X-Admin-Token': brig } })
  ok('без права CRM — нет доступа', r403.status === 403)

  console.log('CardDAV')
  const auth = { Authorization: basic('79032599333', mk.password) }
  const opt = await call('/api/dav/', { method: 'OPTIONS' })
  ok('OPTIONS говорит «умею CardDAV», а не отвечает как CORS', /addressbook/.test(opt.headers.get('DAV') || ''), String(opt.headers.get('DAV')))
  ok('без входа — 401 с Basic', (await call('/api/dav/', { method: 'PROPFIND' })).headers.get('WWW-Authenticate').startsWith('Basic'))
  ok('чужой пароль — 401', (await call('/api/dav/', { method: 'PROPFIND', headers: { Authorization: basic('79032599333', 'aaaa-bbbb-cccc-dddd') } })).status === 401)
  ok('пароль без дефисов и заглавными тоже подходит', (await call('/api/dav/', { method: 'PROPFIND', headers: { Authorization: basic('+7 903 259 93 33', mk.password.replace(/-/g, '').toUpperCase()) } })).status === 207)
  const root = await call('/api/dav/', { method: 'PROPFIND', headers: { ...auth, Depth: '0' } })
  const rootXml = await root.text()
  ok('корень ведёт к принципалу и дому книг', root.status === 207 && rootXml.includes('<d:href>/api/dav/principal/</d:href>') && rootXml.includes('addressbook-home-set><d:href>/api/dav/books/'), rootXml.slice(0, 300))
  const home = await (await call('/api/dav/books/', { method: 'PROPFIND', headers: { ...auth, Depth: '1' } })).text()
  ok('в доме — книга «КубрДом CRM», только чтение', home.includes('<d:href>/api/dav/books/crm/</d:href>') && home.includes('КубрДом CRM') && home.includes('<card:addressbook/>') && !home.includes('<d:write'), home.slice(0, 400))
  const book = await (await call('/api/dav/books/crm/', { method: 'PROPFIND', headers: { ...auth, Depth: '1' } })).text()
  ok('в книге одна карточка (без телефона не берём) с ETag', (book.match(/\.vcf<\/d:href>/g) || []).length === 1 && book.includes('/api/dav/books/crm/c1.vcf') && book.includes('getetag'), book.slice(0, 500))
  const rep = await (await call('/api/dav/books/crm/', { method: 'REPORT', headers: { ...auth, Depth: '1', 'Content-Type': 'application/xml' }, body: '<card:addressbook-multiget xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop><d:href>/api/dav/books/crm/c1.vcf</d:href><d:href>/api/dav/books/crm/gone.vcf</d:href></card:addressbook-multiget>' })).text()
  ok('multiget отдаёт vCard с именем «КД-001 📄 …»', rep.includes('FN:КД-001 📄 Светлана Орлова') && rep.includes('TEL;TYPE=CELL:+79162341122'), rep.slice(0, 600))
  ok('удалённый из CRM контакт — 404, телефон его сотрёт', rep.includes('gone.vcf</d:href><d:status>HTTP/1.1 404'))
  const one = await call('/api/dav/books/crm/c1.vcf', { headers: auth })
  ok('GET карточки — text/vcard с ETag', one.status === 200 && one.headers.get('Content-Type').startsWith('text/vcard') && !!one.headers.get('ETag'))
  ok('правка из телефона не принимается', (await call('/api/dav/books/crm/c1.vcf', { method: 'PUT', headers: auth, body: 'BEGIN:VCARD' })).status === 403)

  real.set('users', USERS.map((u) => (u.id === 'yuriy' ? { ...u, roles: ['brigadier'] } : u)))
  ok('сняли право на CRM — книга перестаёт открываться', (await call('/api/dav/books/crm/', { method: 'PROPFIND', headers: { ...auth, Depth: '0' } })).status === 401)
  real.set('users', USERS)
  ok('право вернули — книга снова открывается', (await call('/api/dav/books/crm/', { method: 'PROPFIND', headers: { ...auth, Depth: '0' } })).status === 207)
  const token2 = await login('+7 (903) 259-93-33', '4271')   // смена ролей отзывает старый вход панели
  const off = await (await call('/api/crm/contacts-token', { method: 'POST', headers: { 'X-Admin-Token': token2, 'Content-Type': 'application/json' }, body: '{"revoke":true}' })).json()
  ok('«Отключить» ответил успехом', off.success === true && off.connected === false, JSON.stringify(off))
  ok('«Отключить» — старый пароль больше не подходит', (await call('/api/dav/', { method: 'PROPFIND', headers: auth })).status === 401)
}

if (failed) { console.log('\n✘ провалено проверок: ' + failed); process.exit(1) }
console.log('\n✓ все проверки прошли')
