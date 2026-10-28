#!/usr/bin/env node
// CRM отдельным приложением (/crm): src/crm-app.js, src/webpush.js, src/push.js, экран панели.
//
// Сторожим: пуш шифруется так, что браузер его расшифрует (RFC 8291) и подписан VAPID,
// который проверит push-сервис (RFC 8292); подписки на чужие адреса не принимаются;
// мёртвые подписки удаляются, уволенным пуши не уходят; лента чатов считает «не отвечено»
// честно (черновик ИИ — не ответ); /crm показывает только CRM со своей нижней панелью,
// а ссылка из пуша открывает нужный диалог.
import { webcrypto as crypto } from 'node:crypto'
import { boot, reporter } from './harness/panel-vm.js'
import { b64u, unb64u, cleanSubscription, encryptPayload, vapidHeader, sendPush } from '../src/webpush.js'
import { isCrmPath, chatDeepLink, chatFeed, feedTime } from '../src/crm-app.js'
import { pushSubscribe, pushToAll, avitoPushData, PUSH_STORAGE_KEY } from '../src/push.js'
import { routeAllowed } from '../src/access.js'

const t = reporter()
const subtle = crypto.subtle
const enc = new TextEncoder()
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; a.forEach((x) => { o.set(x, i); i += x.length }); return o }
const hkdf = async (salt, ikm, info, n) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info },
  await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8))

// «Браузер»: ключи подписки, как их выдаёт pushManager.subscribe.
async function browserKeys() {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { kp, keys: { p256dh: b64u(pub), auth: b64u(auth) } }
}
// Расшифровка на стороне браузера по RFC 8291 — независимо от кода шифрования.
async function browserDecrypt(ua, body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen)
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.kp.privateKey, 256))
  const uaPub = unb64u(ua.keys.p256dh)
  const ikm = await hkdf(unb64u(ua.keys.auth), shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher))
  return { text: new TextDecoder().decode(plain.slice(0, -1)), delim: plain[plain.length - 1], rs: new DataView(body.buffer, body.byteOffset).getUint32(16) }
}
async function vapidKeys() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await subtle.exportKey('jwk', kp.privateKey)
  return { kp, vapid: { publicKey: b64u(new Uint8Array(await subtle.exportKey('raw', kp.publicKey))), privateKey: jwk.d, subject: 'https://portal.kubrdom.ru' } }
}

{
  t.section('Шифрование пуша (aes128gcm)')
  const ua = await browserKeys()
  const msg = JSON.stringify({ title: '💬 Иван', body: 'Сколько стоит баня 6 м?' })
  const out = await browserDecrypt(ua, await encryptPayload(ua.keys, msg))
  t.ok('браузер расшифровывает ровно отправленное (с кириллицей и эмодзи)', out.text === msg, out.text)
  t.ok('одна последняя запись: разделитель 0x02, rs=4096', out.delim === 2 && out.rs === 4096)
  const other = await browserKeys()
  let failed = false
  try { await browserDecrypt(other, await encryptPayload(ua.keys, msg)) } catch (e) { failed = true }
  t.ok('чужими ключами не расшифровать', failed)
}

{
  t.section('VAPID')
  const { kp, vapid } = await vapidKeys()
  const ep = 'https://fcm.googleapis.com/fcm/send/abc'
  const h = await vapidHeader(ep, vapid)
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)
  t.ok('заголовок вида «vapid t=<jwt>, k=<ключ>»', !!m && m[4] === vapid.publicKey, h.slice(0, 80))
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])))
  t.ok('aud — origin push-сервиса, exp в пределах суток, sub задан', claims.aud === 'https://fcm.googleapis.com' && claims.exp > Date.now() / 1000 && claims.exp - Date.now() / 1000 <= 24 * 3600 && claims.sub === vapid.subject)
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, unb64u(m[3]), enc.encode(m[1] + '.' + m[2]))
  t.ok('подпись ES256 проверяется публичным ключом', ok)
}

{
  t.section('Какие подписки принимаем')
  const { keys } = await browserKeys()
  t.ok('FCM (Android Chrome) — да', !!cleanSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys }))
  t.ok('Mozilla и Apple — да', !!cleanSubscription({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x', keys }) && !!cleanSubscription({ endpoint: 'https://web.push.apple.com/x', keys }))
  t.ok('чужой хост — нет (Worker не стучится куда скажут)', !cleanSubscription({ endpoint: 'https://evil.example/fcm.googleapis.com', keys }) && !cleanSubscription({ endpoint: 'https://fcm.googleapis.com.evil.example/x', keys }))
  t.ok('http и внутренние адреса — нет', !cleanSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys }) && !cleanSubscription({ endpoint: 'https://127.0.0.1/x', keys }))
  t.ok('битые ключи — нет', !cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'abc', auth: keys.auth } }))
}

// D1 в памяти: ровно те запросы, что делает src/push.js.
function fakeDB() {
  const rows = new Map()
  return {
    rows,
    prepare(sql) {
      return { bind(...a) {
        return {
          run: async () => {
            if (/^INSERT/.test(sql)) rows.set(a[0] + '|' + a[1], a[2])
            else if (/^DELETE/.test(sql)) rows.delete(a[0] + '|' + a[1])
          },
          all: async () => ({ results: [...rows].filter(([k]) => k.startsWith(a[0] + '|')).map(([k, data]) => ({ work_id: k.split('|')[1], data })) }),
        }
      } }
    },
  }
}

{
  t.section('Подписки и рассылка')
  const { vapid } = await vapidKeys()
  const env = { DB: fakeDB(), VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }
  const a = await browserKeys(), b = await browserKeys(), c = await browserKeys()
  const sub = (k, id) => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/' + id, keys: k.keys })
  t.ok('без VAPID на сервере подписка не принимается', !(await pushSubscribe({ DB: fakeDB() }, { subscription: sub(a, 'a') }, { uid: 'u1' })).success)
  t.ok('чужой адрес подписки отклонён', !(await pushSubscribe(env, { subscription: { endpoint: 'https://evil.example/x', keys: a.keys } }, { uid: 'u1' })).success)
  await pushSubscribe(env, { subscription: sub(a, 'a') }, { uid: 'u1' })
  await pushSubscribe(env, { subscription: sub(a, 'a') }, { uid: 'u1' })
  await pushSubscribe(env, { subscription: sub(b, 'b') }, { uid: 'fired' })
  await pushSubscribe(env, { subscription: sub(c, 'gone') }, { uid: 'u1' })
  t.ok('повторная подписка того же телефона — одна строка', env.DB.rows.size === 3 && [...env.DB.rows.keys()].every((k) => k.startsWith(PUSH_STORAGE_KEY + '|')))
  const hits = []
  const fetchFn = async (url, init) => { hits.push({ url, init }); return { status: url.endsWith('/gone') ? 410 : 201 } }
  const out = await pushToAll(env, { title: 'x', body: 'y' }, async (uid) => uid !== 'fired', fetchFn)
  t.ok('уволенному не ушло, живому ушло', hits.length === 2 && !hits.some((h) => h.url.endsWith('/b')) && out.sent === 1, JSON.stringify(out))
  t.ok('умершая подписка (410) удалена', out.dropped === 1 && env.DB.rows.size === 2)
  const h = hits.find((x) => x.url.endsWith('/a')).init.headers
  t.ok('заголовки Web Push: aes128gcm, TTL, VAPID', h['Content-Encoding'] === 'aes128gcm' && +h.TTL > 0 && /^vapid t=/.test(h.Authorization))
  const body = hits.find((x) => x.url.endsWith('/a')).init.body
  t.ok('тело расшифровывается телефоном', JSON.parse((await browserDecrypt(a, body)).text).body === 'y')
  let threw = false
  try { await sendPush(sub(a, 'a'), { t: 1 }, vapid, async () => ({ status: 201 })) } catch (e) { threw = true }
  t.ok('sendPush отдаёт статус push-сервиса', !threw)
}

{
  t.section('Текст пуша о сообщении с Авито')
  const d = avitoPushData('avito:7', 'Avito · 123', 'Здравствуйте,\n  сколько   стоит?', [{ id: 'c1', name: 'Иван Петров', avitoKey: 'avito:7' }])
  t.ok('имя из карточки CRM, пробелы схлопнуты', d.title === '💬 Иван Петров' && d.body === 'Здравствуйте, сколько стоит?', JSON.stringify(d))
  t.ok('tag по диалогу (новое заменяет старое), ссылка на диалог', d.tag === 'avito:7' && d.url === chatDeepLink('avito:7'))
  const long = avitoPushData('avito:8', 'Avito · 8', 'а'.repeat(500), [])
  t.ok('без карточки — имя чата; длинный текст обрезан', long.title === '💬 Avito · 8' && long.body.length === 160 && long.body.endsWith('…'))
}

{
  t.section('Адрес и ссылки приложения')
  t.ok('/crm, /crm/, /crm.html — приложение', isCrmPath('/crm') && isCrmPath('/crm/') && isCrmPath('/crm.html'))
  t.ok('/admin, /crmx, / — нет', !isCrmPath('/admin') && !isCrmPath('/crmx') && !isCrmPath('/'))
  const u = new URL('https://portal.kubrdom.ru' + chatDeepLink('avito:u2i-AbC_1'))
  t.ok('ссылка из пуша несёт ключ диалога целиком', u.pathname === '/crm' && u.searchParams.get('go') === 'chat=avito:u2i-AbC_1')
  t.ok('доступ к /api/push — как к CRM', routeAllowed({ permissions: ['crm'] }, '/api/push/subscribe') && routeAllowed({ permissions: ['marketing'] }, '/api/push/key') && !routeAllowed({ permissions: ['supply'] }, '/api/push/subscribe'))
}

const CHATS = {
  'avito:1': { source: 'avito', name: 'Avito · 1', updatedAt: 1000, messages: [{ role: 'user', text: 'Цена?', ts: 1000 }, { role: 'assistant', text: 'От 900 тыс.', status: 'sent', ts: 1100 }] },
  'avito:2': { source: 'avito', name: 'Avito · 2', messages: [{ role: 'user', text: 'Есть доставка?', ts: 3000 }, { role: 'assistant', text: 'Да, по области.', status: 'draft', ts: 3050 }] },
  'avito:3': { source: 'avito', name: 'Avito · 3', messages: [{ role: 'user', text: 'Хочу баню', ts: 2000 }] },
  'manual:x': { source: 'manual', name: 'Симулятор', messages: [{ role: 'user', text: 'тест', ts: 9000 }] },
}
const CLIENTS = [{ id: 'c3', name: 'Мария', stage: 'qualified', avitoKey: 'avito:3', phone: '', source: 'Авито', msg: '', notes: '', date: '2026-10-27' }]

{
  t.section('Лента чатов')
  const f = chatFeed(CHATS, CLIENTS)
  t.ok('только Авито, свежие сверху', f.map((x) => x.key).join() === 'avito:2,avito:3,avito:1', f.map((x) => x.key).join())
  t.ok('черновик ИИ — не ответ: диалог ждёт ответа, в превью реплика клиента', f[0].unanswered && f[0].draft && f[0].text === 'Есть доставка?')
  t.ok('отвеченный — не ждёт', !f[2].unanswered && f[2].text === 'От 900 тыс.')
  t.ok('имя и стадия из привязанной карточки', f[1].name === 'Мария' && f[1].stage === 'qualified' && f[1].clientId === 'c3')
  const now = new Date(2026, 9, 28, 15, 0).getTime()
  t.ok('время: сегодня — часы, раньше — дата', feedTime(new Date(2026, 9, 28, 9, 5).getTime(), now) === '09:05' && feedTime(new Date(2026, 9, 3, 9, 5).getTime(), now) === '03.10')
}

function panel(pathname) {
  const p = boot({})
  p.ctx.location.pathname = pathname
  p.set({
    users: [{ id: 'a1', name: 'Юрий', roles: ['admin'], c: '#c0392b', av: '👷', objs: [] }, { id: 's1', name: 'Снаб', roles: ['supply'], c: '#000', av: '📦', objs: [] }],
    roles: [{ id: 'admin', n: 'Админ' }, { id: 'supply', n: 'Снабженец' }],
    rolePermissions: { supply: ['supply'] },
    objects: [], issues: [], templates: [], contractDocs: [], crmClients: CLIENTS, purchases: [], purchased: {}, arrived: {},
    finTxns: [], receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [], projects: [], buildRules: [],
    winTypes: [], dbPlans: [], settings: {}, stock: [],
  })
  p.run('currentUser=users[0];crmChats=' + JSON.stringify(CHATS) + ';crmChatsLoading=false;')
  return p
}

{
  t.section('Экран /crm')
  const p = panel('/crm')
  p.run('_setInitialTab()')
  t.ok('стартовая вкладка — CRM', p.q('tab') === 'crm')
  p.run('tab="assign"')
  const html = p.run('page()')
  t.ok('вкладка принудительно CRM, ленты вкладок портала нет', p.q('tab') === 'crm' && html.indexOf('id="hdr-tabs"') < 0 && html.indexOf('data-a="more-open"') < 0)
  t.ok('снизу «Воронка» и «Чаты» со счётчиком неотвеченных', html.indexOf('data-a="crm-app-nav" data-v="funnel"') >= 0 && html.indexOf('data-a="crm-app-nav" data-v="chats"') >= 0 && p.q('crmUnansweredCount()') === 2)
  p.run('crmView="chats"')
  const chats = p.run('tCRM()')
  t.ok('лента: три диалога Авито, симулятора нет', (chats.match(/data-a="crm-chat-open"/g) || []).length === 3 && chats.indexOf('Симулятор') < 0)
  t.ok('в приложении — кнопка включения уведомлений', chats.indexOf('data-a="crm-push-on"') >= 0)
  p.run('crmChatKey="avito:2";crmView="chat"')
  const chat = p.run('tCRM()')
  t.ok('диалог: черновик помечен и его можно взять в ответ', chat.indexOf('Черновик ИИ') >= 0 && chat.indexOf('data-a="crm-draft-use"') >= 0)
  t.ok('ответ уходит в Авито тем же обработчиком', chat.indexOf('data-a="crm-send-avito" data-key="avito:2" data-cid="chat"') >= 0 && chat.indexOf('id="crm-reply-chat"') >= 0)
  p.run('crmChatKey="avito:3"')
  t.ok('у привязанного — переход в карточку клиента', p.run('tCRM()').indexOf('data-a="crm-chat-card" data-cid="c3"') >= 0)

  p.run('currentUser=users[1];')
  const denied = p.run('page()')
  t.ok('без права на CRM — «нет доступа», а не чужая вкладка', denied.indexOf('Нет доступа к CRM') >= 0 && denied.indexOf('data-a="crm-app-nav"') < 0)
}

{
  t.section('Полный портал и ссылка из пуша')
  const p = panel('/admin')
  p.run('tab="crm";crmView="funnel"')
  const html = p.run('page()')
  t.ok('в /admin лента вкладок на месте, нижней панели CRM нет', html.indexOf('id="hdr-tabs"') >= 0 && html.indexOf('data-v="funnel"') < 0)
  t.ok('в шапке воронки — вход в «Чаты»', p.run('tCRM()').indexOf('data-a="crm-app-nav" data-v="chats"') >= 0)
  p.run('crmView="chats"')
  t.ok('в портале вместо кнопки пушей — подсказка про /crm', p.run('tCRM()').indexOf('portal.kubrdom.ru/crm') >= 0)
  p.ctx.location.search = '?go=' + encodeURIComponent('chat=avito:3')
  p.run('crmView="funnel";applyDeepLink()')
  t.ok('?go=chat=… открывает диалог', p.q('tab') === 'crm' && p.q('crmView') === 'chat' && p.q('crmChatKey') === 'avito:3')
}

t.done()
