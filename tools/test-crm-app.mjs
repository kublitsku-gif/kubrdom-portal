#!/usr/bin/env node
// CRM отдельным приложением (/crm): src/crm-app.js, src/webpush.js, src/push.js, экран панели.
//
// Сторожим: пуш шифруется так, что браузер его расшифрует (RFC 8291) и подписан VAPID,
// который проверит push-сервис (RFC 8292); подписки на чужие адреса не принимаются;
// мёртвые подписки удаляются, уволенным пуши не уходят; лента чатов считает «не отвечено»
// честно (черновик ИИ — не ответ); /crm показывает только CRM со своей нижней панелью,
// а ссылка из пуша открывает нужный диалог.
import { webcrypto as crypto } from 'node:crypto'
import fs from 'node:fs'
import { boot, reporter } from './harness/panel-vm.js'
import { b64u, unb64u, cleanSubscription, encryptPayload, vapidHeader, sendPush } from '../src/webpush.js'
import { isCrmPath, chatDeepLink, chatFeed, feedTime, draftKinds, hasIncoming, dupHidden, avitoHistory, mergeAvitoHistory, dupTelegram, draftForButton, filterFeed, waitSince, waitLabel, waitReminders, dueReminders, todayReminders, safeImageUrl, avitoImageUrl, avitoChatInfo, quickReplies, QUICK_REPLIES_DEFAULT, salesSummary, clientDeepLink } from '../src/crm-app.js'
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
  // Область портала не должна накрывать /crm: иначе Android считает CRM «уже установленной»
  // (это и есть иконка портала) и вторую иконку не ставит — так было со scope "/".
  const man = (f) => JSON.parse(fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8'))
  const portal = man('manifest.webmanifest'), crm = man('crm.webmanifest')
  const inScope = (scope, path) => path === scope || path.startsWith(scope.endsWith('/') ? scope : scope + '/') || path.startsWith(scope + '?') || path.startsWith(scope + '.')
  t.ok('/crm вне области портала, /admin вне области CRM', !inScope(portal.scope, '/crm') && !inScope(crm.scope, '/admin') && portal.id !== crm.id)
  t.ok('у каждого приложения старт внутри своей области', inScope(portal.scope, portal.start_url) && inScope(crm.scope, crm.start_url))
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
  const D = (text, extra) => Object.assign({ role: 'assistant', text, status: 'draft' }, extra || {})
  const S = (role, text) => ({ role, text, status: 'sent' })
  t.ok('черновики: свежий — один, последний; старые — бледные', draftKinds([S('user', 'а'), D('x'), D('y')]).join() === ',stale,pending')
  t.ok('черновик, после которого клиент ответил, — уже не свежий', draftKinds([D('x'), S('user', 'б')]).join() === 'stale,')
  t.ok('ушедший тем же текстом черновик не рисуем', draftKinds([D('Да, по области.'), S('assistant', 'Да, по области.')]).join() === 'used,')
  t.ok('ваш ответ, который Авито не принял, — отдельно', draftKinds([S('user', 'а'), D('мой', { manual: true })]).join() === ',failed')
  t.ok('повтор вебхука Авито узнаём по id сообщения', hasIncoming([{ role: 'user', text: 'а', avitoMsgId: 'm1' }], 'm1') && !hasIncoming([{ role: 'user', text: 'а', avitoMsgId: 'm1' }], 'm2') && !hasIncoming([{ role: 'user', text: 'а' }], ''))
  const U = (text, extra) => Object.assign({ role: 'user', text, status: 'in' }, extra || {})
  const dupRun = [U('ТЗ пришлю'), D('x1'), U('ТЗ пришлю'), D('x2'), U('ТЗ пришлю'), D('x3')]
  t.ok('старые повторы вебхука прячем: одна реплика клиента и последний черновик', dupHidden(dupRun).join() === 'false,true,true,true,true,false', dupHidden(dupRun).join())
  t.ok('после нашего ответа тот же текст клиента — не повтор', dupHidden([U('да'), S('assistant', 'ок'), U('да')]).join() === 'false,false,false')
  t.ok('разные id Авито — клиент сам написал то же дважды, показываем оба', dupHidden([U('да', { avitoMsgId: 'a' }), U('да', { avitoMsgId: 'b' })]).join() === 'false,false')
  t.ok('другой текст между повторами — не повтор', dupHidden([U('а'), U('б'), U('а')]).join() === 'false,false,false')
  const AV = [
    { id: 'm3', direction: 'out', author_id: 1, created: 300, type: 'text', content: { text: 'Пришлю расчёт вечером' } },
    { id: 'm2', direction: 'out', author_id: 1, created: 200, type: 'text', content: { text: 'Здравствуйте!' } },
    { id: 's1', direction: 'in', author_id: 0, created: 150, type: 'system', content: { text: 'Покупатель смотрит' } },
    { id: 'm1', direction: 'in', author_id: 9, created: 100, type: 'text', content: { text: 'ТЗ пришлю' } },
    { id: 'm4', direction: 'in', author_id: 9, created: 400, type: 'image', content: { image: { sizes: { '140x105': 'https://img.avito.st/s.jpg', '1280x960': 'https://img.avito.st/b.jpg' } } } },
  ]
  const hist = avitoHistory({ messages: AV }, 1)
  t.ok('история Авито: по времени, системные без, наше — ответ, фото крупное', hist.map((m) => m.avitoMsgId + ':' + m.role).join() === 'm1:user,m2:assistant,m3:assistant,m4:user' && hist[0].ts === 100000 && hist[3].image === 'https://img.avito.st/b.jpg', hist.map((m) => m.avitoMsgId).join())
  t.ok('история Авито приходит и голым массивом', avitoHistory(AV, 1).length === 4)
  const local = [U('ТЗ пришлю', { ts: 100500 }), D('x1', { tgMsgId: 11 }), U('ТЗ пришлю', { ts: 160000 }), D('x2', { tgMsgId: 13 }), { role: 'assistant', text: 'Здравствуйте!', status: 'sent', auto: true, ts: 200500 }]
  const mg = mergeAvitoHistory(local, hist)
  t.ok('сверка: повторы ушли, свои реплики узнаны по тексту и получили id', mg.removed === 2 && mg.messages[0].avitoMsgId === 'm1' && mg.messages.find((m) => m.text === 'Здравствуйте!').avitoMsgId === 'm2' && mg.messages.find((m) => m.text === 'Здравствуйте!').auto, JSON.stringify(mg))
  t.ok('сверка: ответ, набранный прямо в Авито, и фото встали по времени', mg.added === 2 && mg.messages.map((m) => m.text).join('|') === 'ТЗ пришлю|x2|Здравствуйте!|Пришлю расчёт вечером|📷 Фото', mg.messages.map((m) => m.text).join('|'))
  t.ok('сверка без Авито (не ответил) — только убирает повторы', mergeAvitoHistory(local, []).messages.length === 3)
  t.ok('повторная сверка ничего не меняет', mergeAvitoHistory(mg.messages, hist).added === 0 && mergeAvitoHistory(mg.messages, hist).removed === 0)
  const tg = dupTelegram([U('ТЗ пришлю'), D('x1', { tgMsgId: 11 }), U('ТЗ пришлю'), D('x2', { tgMsgId: 13 })])
  t.ok('Telegram: черновик-повтор удаляем по id, пост клиента ищем перед следующим черновиком', tg.drafts.join() === '11' && tg.posts.length === 1 && tg.posts[0].before === 13 && tg.posts[0].text === '👤 Клиент:\nТЗ пришлю', JSON.stringify(tg))
  const btn = [U('а'), D('x1', { tgMsgId: 11 }), S('assistant', 'ок'), D('x2', { tgMsgId: 13 })]
  t.ok('кнопка Telegram находит свой черновик по сообщению, а не по номеру', draftForButton(btn, 13, 1) === 3 && draftForButton(btn, 11, 3) === 1)
  t.ok('кнопка на сдвинутый номер без своего черновика — ничего не шлёт', draftForButton(btn, 99, 2) === -1 && draftForButton(btn, 99, 3) === -1 && draftForButton(btn, 99, 0) === -1)
  t.ok('время: сегодня — часы, раньше — дата', feedTime(new Date(2026, 9, 28, 9, 5).getTime(), now) === '09:05' && feedTime(new Date(2026, 9, 3, 9, 5).getTime(), now) === '03.10')
}

{
  t.section('Лента: фильтры, таймер, напоминания')
  const M = 60000
  const chats = {
    'avito:a': { source: 'avito', name: 'А', messages: [{ role: 'assistant', text: 'Здравствуйте', status: 'sent', ts: 0 }, { role: 'user', text: 'Цена бани 6 м?', ts: 1000 * M }, { role: 'user', text: 'и доставка', ts: 1001 * M }, { role: 'assistant', text: 'черн', status: 'draft', ts: 1002 * M }] },
    'avito:b': { source: 'avito', name: 'Б', archived: true, messages: [{ role: 'user', text: 'привет', ts: 900 * M }] },
    'avito:c': { source: 'avito', name: 'В', spam: true, messages: [{ role: 'user', text: 'спам', ts: 950 * M }] },
    'avito:d': { source: 'avito', name: 'Г', messages: [{ role: 'user', text: 'тел 8 916 111-22-33', ts: 10 * M }, { role: 'assistant', text: 'ок', status: 'sent', ts: 20 * M }] },
  }
  const feed = chatFeed(chats, [{ id: 'cd', name: 'Гена', stage: 'kp', avitoKey: 'avito:d', phone: '+7 916 111-22-33' }])
  t.ok('ждёт с первой реплики клиента после нашего ответа, черновик не в счёт', waitSince(chats['avito:a'].messages) === 1000 * M && waitSince(chats['avito:d'].messages) === 0)
  t.ok('«Все» прячут архив и спам, «Архив» показывает их', filterFeed(feed, {}).map((f) => f.key).sort().join() === 'avito:a,avito:d' && filterFeed(feed, { mode: 'archive' }).map((f) => f.key).sort().join() === 'avito:b,avito:c')
  t.ok('«Ждут ответа» и «С черновиком»', filterFeed(feed, { mode: 'wait' }).map((f) => f.key).join() === 'avito:a' && filterFeed(feed, { mode: 'draft' }).map((f) => f.key).join() === 'avito:a')
  t.ok('поиск по тексту, по цифрам телефона и стадия', filterFeed(feed, { q: 'доставка' }).length === 1 && filterFeed(feed, { q: '916 111' })[0].key === 'avito:d' && filterFeed(feed, { stage: 'kp' }).map((f) => f.key).join() === 'avito:d')
  t.ok('таймер словами', waitLabel(30 * 1000) === 'только что' && waitLabel(14 * M) === '14 мин' && waitLabel(135 * M) === '2 ч 15 мин' && waitLabel(3 * 24 * 60 * M) === '3 дн')
  const now = 1020 * M
  t.ok('повторный пуш: ждёт ≥15 мин, днём, один раз на реплику, без архива/спама', waitReminders(chats, {}, now, 12).map((w) => w.key).join() === 'avito:a' && waitReminders(chats, { 'avito:a': 1000 * M }, now, 12).length === 0)
  t.ok('ночью и раньше 15 мин — не будим', waitReminders(chats, {}, now, 23).length === 0 && waitReminders(chats, {}, 1010 * M, 12).length === 0)
  t.ok('ждущих дольше суток не напоминаем (не засыпать пушами после выката)', waitReminders(chats, {}, 1000 * M + 25 * 60 * M * 60, 12).length === 0)
  const cl = [{ id: 'x', remindAt: 500 }, { id: 'y', remindAt: 5000 }, { id: 'z' }]
  t.ok('напоминание «перезвонить»: пришло время и ещё не слали', dueReminders(cl, {}, 1000).map((c) => c.id).join() === 'x' && dueReminders(cl, { 'r:x': 500 }, 1000).length === 0)
  const day = new Date(2026, 9, 29, 12).getTime()
  t.ok('«Сегодня»: просроченные и до конца дня, по времени', todayReminders([{ id: 'late', remindAt: day - 86400000 }, { id: 'eve', remindAt: day + 6 * 3600000 }, { id: 'tmr', remindAt: day + 30 * 3600000 }], day).map((c) => c.id).join() === 'late,eve')
  t.ok('ссылка пуша-напоминания открывает карточку', clientDeepLink('c 1') === '/crm?go=client%3Dc%201')
}

{
  t.section('Авито: фото, объявление, быстрые ответы, сводка')
  t.ok('картинки: только https и свои файлы', safeImageUrl('https://img.avito.st/x.jpg') && safeImageUrl('/api/file/plans/a.jpg') && safeImageUrl('/plans/kd29-1.jpg') && !safeImageUrl('javascript:alert(1)') && !safeImageUrl('https://x/"onerror=') && !safeImageUrl('http://x/a.jpg'))
  t.ok('фото из вебхука — самый крупный размер', avitoImageUrl({ image: { sizes: { '140x105': 'https://a/s.jpg', '1280x960': 'https://a/b.jpg', '640x480': 'https://a/m.jpg' } } }) === 'https://a/b.jpg' && avitoImageUrl({}) === '')
  const info = avitoChatInfo({ context: { value: { id: 7, title: 'Баня 6 м', price_string: '890 000 ₽', url: 'https://www.avito.ru/moskva/doma/banya_7', images: { main: { '140x105': 'https://img.avito.st/1.jpg' } } } }, users: [{ id: 1, name: 'Мы' }, { id: 2, name: 'Пётр' }] }, '1')
  t.ok('объявление и имя клиента (не наше) из карточки чата', info.item.title === 'Баня 6 м' && info.item.price === '890 000 ₽' && info.item.img === 'https://img.avito.st/1.jpg' && info.userName === 'Пётр')
  t.ok('ссылка объявления — только на avito.ru', avitoChatInfo({ context: { value: { title: 'x', url: 'https://evil.ru/a' } } }, '1').item.url === '')
  t.ok('быстрые ответы: свои из настроек, иначе по умолчанию', quickReplies({ crmQuickReplies: [' Привет ', ''] }).join() === 'Привет' && quickReplies({}).length === QUICK_REPLIES_DEFAULT.length && quickReplies({ crmQuickReplies: [] }).length === QUICK_REPLIES_DEFAULT.length)
  const H = 3600000, now = Date.now()
  const sm = salesSummary({
    'avito:1': { source: 'avito', item: { title: 'Баня' }, messages: [{ role: 'user', text: 'а', ts: now - 5 * H }, { role: 'assistant', text: 'б', status: 'sent', ts: now - 5 * H + 10 * 60000 }] },
    'avito:2': { source: 'avito', item: { title: 'Баня' }, messages: [{ role: 'user', text: 'а', ts: now - 3 * H }, { role: 'assistant', text: 'черн', status: 'draft', ts: now - 3 * H + 60000 }, { role: 'assistant', text: 'б', status: 'sent', ts: now - H }] },
    'avito:3': { source: 'avito', messages: [{ role: 'user', text: 'а', ts: now - H }] },
  }, [{ id: 'c1', avitoKey: 'avito:1', stage: 'contract', date: new Date(now).toISOString().slice(0, 10) }, { id: 'c2', avitoKey: 'avito:2', stage: 'kp', date: '2020-01-01' }],
  ['new', 'qualified', 'kp', 'meeting', 'contract', 'montaj'], now)
  t.ok('сводка: время ответа считается до отправленного, не до черновика', sm.responses === 2 && sm.fastShare === 50 && sm.waitingNow === 1)
  t.ok('сводка: воронка «дошли до стадии» и объявления', sm.funnel[0].reached === 2 && sm.funnel[3].reached === 1 && sm.listings[0].title === 'Баня' && sm.listings[0].dialogs === 2 && sm.listings[0].contracts === 1 && sm.leadsWeek === 1)
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
  t.ok('диалог: черновик — карточка «не отправлено» с «Отправить» и «Править»', chat.indexOf('НЕ ОТПРАВЛЕНО') >= 0 && chat.indexOf('data-a="crm-draft-send" data-i="1"') >= 0 && chat.indexOf('data-a="crm-draft-use" data-i="1"') >= 0)
  const card = p.run('crmMsgsHtml(crmChats["avito:2"].messages,true,false)')
  t.ok('в карточке клиента черновик тоже выделен, но без кнопок отправки', card.indexOf('НЕ ОТПРАВЛЕНО') >= 0 && card.indexOf('crm-draft-send') < 0)
  const dupHtml = p.run('crmMsgsHtml([{role:"user",text:"ТЗ пришлю",ts:1},{role:"assistant",text:"черн-1",status:"draft",ts:2},{role:"user",text:"ТЗ пришлю",ts:3},{role:"assistant",text:"черн-2",status:"draft",ts:4}],true,true)')
  t.ok('повтор вебхука в диалоге не дублируется, черновик — последний', (dupHtml.match(/ТЗ пришлю/g) || []).length === 1 && dupHtml.indexOf('черн-1') < 0 && dupHtml.indexOf('черн-2') >= 0 && dupHtml.indexOf('data-i="3"') >= 0)
  const staleHtml = p.run('crmMsgsHtml([{role:"user",text:"а",ts:1},{role:"assistant",text:"старый-черн",status:"draft",ts:2},{role:"user",text:"б",ts:3}],true,true)')
  t.ok('неотправленный старый черновик в переписке не показываем', staleHtml.indexOf('старый-черн') < 0 && staleHtml.indexOf('черновик') < 0)
  t.ok('ответ уходит в Авито тем же обработчиком', chat.indexOf('data-a="crm-send-avito" data-key="avito:2" data-cid="chat"') >= 0 && chat.indexOf('id="crm-reply-chat"') >= 0)
  t.ok('диалог: быстрые ответы, фото, планировка и «переписать» у черновика', chat.indexOf('data-a="crm-quick"') >= 0 && chat.indexOf('data-a="crm-photo-pick"') >= 0 && chat.indexOf('data-a="crm-plan-toggle"') >= 0 && chat.indexOf('data-a="crm-redraft" data-i="1"') >= 0)
  p.run('crmRedraftIdx=1;crmPlanPicker=true')
  const chat2 = p.run('tCRM()')
  t.ok('«переписать» даёт подсказки, выбор планировки — картинки', chat2.indexOf('data-a="crm-redraft-go"') >= 0 && chat2.indexOf('data-a="crm-plan-send" data-v="kd29-1"') >= 0)
  p.run('crmRedraftIdx=null;crmPlanPicker=false')
  p.run('crmChatKey="avito:3"')
  const chat3 = p.run('tCRM()')
  t.ok('у привязанного — переход в карточку клиента', chat3.indexOf('data-a="crm-chat-card" data-cid="c3"') >= 0)
  p.run('crmChats["avito:3"].messages.push({role:"user",text:"📷 Фото",image:"https://img.avito.st/p.jpg",ts:2100});crmChats["avito:3"].item={title:"Баня 6 м",price:"890 000 ₽",url:"https://www.avito.ru/x",img:""}')
  const chat4 = p.run('tCRM()')
  t.ok('фото клиента видно в диалоге, объявление — в шапке', chat4.indexOf('<img src="https://img.avito.st/p.jpg"') >= 0 && chat4.indexOf('ПИШЕТ ПО ОБЪЯВЛЕНИЮ') >= 0 && chat4.indexOf('Баня 6 м') >= 0)
  p.run('crmChats["avito:3"].messages.push({role:"user",text:"мой номер +7 926 555-44-33",ts:2200})')
  const withPhone = p.run('tCRM()')
  t.ok('телефон из переписки — звонок, WhatsApp, Telegram и Max', withPhone.indexOf('href="tel:+79265554433"') >= 0 && withPhone.indexOf('href="https://wa.me/79265554433"') >= 0 && withPhone.indexOf('href="https://t.me/+79265554433"') >= 0 && withPhone.indexOf('href="https://max.ru/79265554433"') >= 0)

  p.run('crmView="chats";crmFeedMode="wait"')
  const waitFeed = p.run('tCRM()')
  t.ok('лента: фильтры, поиск, таймер ожидания, действия ⋯', waitFeed.indexOf('id="crm-feed-q"') >= 0 && waitFeed.indexOf('data-a="crm-feed-mode" data-v="archive"') >= 0 && waitFeed.indexOf('⏳ ждёт') >= 0 && waitFeed.indexOf('data-a="crm-swipe"') >= 0)
  p.run('crmSwipeKey="avito:3"')
  const sw = p.run('tCRM()')
  t.ok('свайп открывает архив, спам и стадию', sw.indexOf('data-a="crm-chat-flag" data-key="avito:3" data-v="archive"') >= 0 && sw.indexOf('data-v="spam"') >= 0 && sw.indexOf('data-a="crm-swipe-stage"') >= 0)
  p.run('crmSwipeKey=null;crmFeedMode="all";crmClients=crmClients.map(function(c){return Object.assign({},c,{remindAt:Date.now()-60000,remindNote:"перезвонить"});})')
  t.ok('«Сегодня» в ленте и в воронке', p.run('tCRM()').indexOf('📅 СЕГОДНЯ') >= 0 && p.run('crmView="funnel";tCRM()').indexOf('📅 СЕГОДНЯ') >= 0)
  t.ok('карточка: напоминание стоит, можно отметить сделанным', p.run('crmView="client";crmOpenId="c3";tCRM()').indexOf('data-a="crm-remind-done" data-cid="c3"') >= 0)
  p.run('crmView="summary"')
  const sum = p.run('tCRM()')
  t.ok('сводка продаж и вкладка внизу', sum.indexOf('СВОДКА ПРОДАЖ') >= 0 && sum.indexOf('КАКИЕ ОБЪЯВЛЕНИЯ') >= 0 && p.run('page()').indexOf('data-a="crm-app-nav" data-v="summary"') >= 0)
  p.run('crmView="chats"')

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
