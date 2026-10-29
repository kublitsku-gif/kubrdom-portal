#!/usr/bin/env node
// Telegram Business: переписка из личного Telegram в CRM (src/tg-business.js + aiWebhook/aiSend в worker.js).
// Вебхук и ответ гоняем настоящим worker.fetch на SQL, Telegram API подменён.
import worker from '../src/worker.js'
import { sqliteDB } from './harness/sqlite-db.js'
import { boot } from './harness/panel-vm.js'
import { tgText, tgReply, applyBusinessUpdate, connectionRecord } from '../src/tg-business.js'
import { chatFeed } from '../src/crm-app.js'

let failed = 0
const ok = (name, cond, detail) => { if (cond) console.log('  ✓ ' + name); else { failed++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')) } }

const OWNER = 111, CLIENT = 222
const chat = { id: CLIENT, type: 'private', first_name: 'Ольга', last_name: 'Петрова', username: 'olga' }
const msg = (id, from, extra) => ({ message_id: id, business_connection_id: 'bc1', chat, from: { id: from }, date: 1790000000 + id, ...extra })

{
  console.log('Разбор сообщений')
  ok('текст, подпись к фото, голосовое, контакт', tgText({ text: 'Здравствуйте' }) === 'Здравствуйте' && tgText({ photo: [{}], caption: 'вот план' }) === '📷 Фото: вот план' &&
    tgText({ voice: {} }) === '🎤 Голосовое' && tgText({ contact: { first_name: 'Иван', phone_number: '+79001112233' } }) === '👤 Контакт: Иван +79001112233')
  ok('от владельца — наш ответ, от клиента — клиент', tgReply(msg(1, OWNER, { text: 'а' }), OWNER).role === 'assistant' && tgReply(msg(1, OWNER, { text: 'а' }), OWNER).manual && tgReply(msg(2, CLIENT, { text: 'б' }), OWNER).role === 'user')
  const conn = { userId: OWNER }
  const c1 = applyBusinessUpdate(null, { business_message: msg(1, CLIENT, { text: 'Сколько стоит баня?' }) }, conn)
  ok('новый чат: имя, id чата, подключение', c1.source === 'telegram' && c1.name === 'Ольга Петрова' && c1.tgChatId === CLIENT && c1.bcId === 'bc1' && c1.messages.length === 1)
  ok('повтор того же сообщения не дублирует', applyBusinessUpdate(c1, { business_message: msg(1, CLIENT, { text: 'Сколько стоит баня?' }) }, conn) === null)
  const c2 = applyBusinessUpdate(c1, { edited_business_message: msg(1, CLIENT, { text: 'Сколько стоит дом?' }) }, conn)
  ok('правка сообщения в Telegram меняет текст', c2.messages[0].text === 'Сколько стоит дом?' && c2.messages[0].edited)
  const c3 = applyBusinessUpdate(c2, { deleted_business_messages: { business_connection_id: 'bc1', chat, message_ids: [1] } }, conn)
  ok('удалённое в Telegram уходит и из CRM', c3.messages.length === 0)
  ok('«не клиент» — новые сообщения не храним', applyBusinessUpdate({ ...c1, spam: true }, { business_message: msg(5, CLIENT, { text: 'привет' }) }, conn) === null)
  ok('права подключения: can_reply из rights', connectionRecord({ id: 'bc1', user: { id: OWNER, first_name: 'Юрий' }, rights: { can_reply: true }, is_enabled: true }).canReply === true)
}

{
  console.log('Лента')
  const chats = { 'tg:1': { source: 'telegram', name: 'Друг', messages: [{ role: 'user', text: 'го на рыбалку', ts: 5 }] }, 'tg:2': { source: 'telegram', name: 'Ольга', messages: [{ role: 'user', text: 'цена?', ts: 6 }] } }
  const feed = chatFeed(chats, [{ id: 'k1', name: 'Ольга Петрова', tgKey: 'tg:2', stage: 'new' }])
  const friend = feed.find((f) => f.key === 'tg:1'), olga = feed.find((f) => f.key === 'tg:2')
  ok('Telegram-чаты в ленте с каналом', friend.channel === 'telegram' && olga.channel === 'telegram')
  ok('непривязанный личный чат не «ждёт ответа», клиентский — ждёт', !friend.unanswered && olga.unanswered && olga.clientId === 'k1' && olga.name === 'Ольга Петрова')
}

// ── Вебхук и ответ через Worker ─────────────────────────────────────────────
const real = sqliteDB({ users: [{ id: 'yuriy', name: 'Юрий', roles: ['admin'] }] })
const ENV = { DB: real.db, ADMIN_TOKEN: 'master', WEBHOOK_SECRET: 'hook', TG_SALES_BOT_TOKEN: 'T', TG_SALES_CHAT_ID: '-100' }
const tgCalls = []
let canReply = true
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.telegram.org/')) {
    const method = String(url).split('/').pop(), body = JSON.parse(init.body || '{}')
    tgCalls.push({ method, body })
    if (method === 'getBusinessConnection') return new Response(JSON.stringify({ ok: true, result: { id: body.business_connection_id, user: { id: OWNER, first_name: 'Юрий' }, rights: { can_reply: canReply }, is_enabled: true } }))
    if (method === 'sendMessage') return new Response(JSON.stringify({ ok: true, result: { message_id: 900 } }))
    return new Response(JSON.stringify({ ok: true, result: true }))
  }
  return realFetch(url, init)
}
const hook = (upd) => worker.fetch(new Request('https://portal.kubrdom.ru/api/ai/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'hook', 'Content-Type': 'application/json' }, body: JSON.stringify(upd) }), ENV, { waitUntil() {} })
const api = (path, body) => worker.fetch(new Request('https://portal.kubrdom.ru' + path, { method: 'POST', headers: { 'X-Admin-Token': 'master', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ENV, { waitUntil() {} })
const chatsNow = () => (real.get('aiChats') || {}).data || {}

{
  console.log('Вебхук и ответ')
  await hook({ business_connection: { id: 'bc1', user: { id: OWNER, first_name: 'Юрий' }, rights: { can_reply: true }, is_enabled: true } })
  const row = await real.db.prepare("SELECT data FROM work_states WHERE storage_key='tg_business' AND work_id='bc1'").first()
  ok('подключение бота записано с правом отвечать', row && JSON.parse(row.data).canReply === true && JSON.parse(row.data).userId === OWNER)
  await hook({ business_message: msg(10, CLIENT, { text: 'Хочу баню 6 м' }) })
  await hook({ business_message: msg(11, OWNER, { text: 'Добрый день! Пришлю расчёт' }) })
  const c = chatsNow()['tg:' + CLIENT]
  ok('клиент и наш ответ из Telegram записаны в диалог', c && c.messages.length === 2 && c.messages[0].role === 'user' && c.messages[1].role === 'assistant' && c.messages[1].manual, JSON.stringify(c))
  const sent = await (await api('/api/ai/send', { clientKey: 'tg:' + CLIENT, text: 'Расчёт готов' })).json()
  const call = tgCalls.find((x) => x.method === 'sendMessage')
  ok('ответ из CRM уходит в Telegram от вашего имени', sent.success && call && call.body.business_connection_id === 'bc1' && call.body.chat_id === CLIENT && call.body.text === 'Расчёт готов', JSON.stringify(sent))
  ok('ответ записан в диалог с id сообщения', chatsNow()['tg:' + CLIENT].messages.slice(-1)[0].tgMid === 900)
  await hook({ business_connection: { id: 'bc1', user: { id: OWNER }, rights: {}, is_enabled: true } })
  const denied = await api('/api/ai/send', { clientKey: 'tg:' + CLIENT, text: 'ещё' })
  ok('без права «отвечать» — понятная ошибка, а не тишина', denied.status === 409 && /Отвечать на сообщения/.test((await denied.json()).error))
  await api('/api/ai/chat-flag', { clientKey: 'tg:' + CLIENT, spam: true })
  ok('«не клиент» стирает переписку чата', chatsNow()['tg:' + CLIENT].messages.length === 0)
  await hook({ business_message: msg(12, CLIENT, { text: 'ау' }) })
  ok('и новые сообщения из него не сохраняются', chatsNow()['tg:' + CLIENT].messages.length === 0)
  const before = tgCalls.length
  const cb = await hook({ business_message: { ...msg(20, 333, { text: 'новый' }), business_connection_id: 'bc-unknown', chat: { id: 333, type: 'private', first_name: 'Пётр' } } })
  ok('неизвестное подключение уточняем у Telegram', cb.status === 200 && tgCalls.slice(before).some((x) => x.method === 'getBusinessConnection') && chatsNow()['tg:333'])
}
globalThis.fetch = realFetch

{
  console.log('Экран CRM')
  const p = boot()
  p.run('tab="crm";currentUser={id:"t",name:"Т",roles:["admin"],objs:[],c:"#000",av:"🧪"};_hydrated=true;')
  p.run('crmChats={"tg:5":{source:"telegram",name:"Ольга",tgChatId:5,messages:[{role:"user",text:"Сколько стоит баня? мой +7 926 555-44-33",ts:1}]}};crmClients=[];')
  p.run('crmView="chats"')
  const feed = p.run('tCRM()')
  ok('в ленте — Telegram-чат с пометкой «не в CRM»', feed.indexOf('✈️ Telegram · не в CRM') >= 0)
  p.run('crmChatKey="tg:5";crmView="chat"')
  const dlg = p.run('tCRM()')
  ok('в диалоге — «Сделать клиентом» и «Не клиент», ответ уходит в Telegram', dlg.indexOf('data-a="crm-tg-new"') >= 0 && dlg.indexOf('data-a="crm-tg-ignore"') >= 0 && dlg.indexOf('Отправить в Telegram') >= 0 && dlg.indexOf('crm-plan-toggle') < 0)
  p.run('crmClients=[{id:"k1",name:"Ольга П",phone:"+7 926 555-44-33",stage:"new",source:"Авито",msg:"",notes:"",date:"2026-10-29"}];crmAutoLinkAvito()')
  ok('чат с номером клиента сам привязался к карточке', p.q('crmClients[0].tgKey') === 'tg:5')
  p.run('crmView="client";crmOpenId="k1"')
  const card = p.run('tCRM()')
  ok('в карточке клиента — блок Telegram с ответом', card.indexOf('✈️ TELEGRAM') >= 0 && card.indexOf('data-key="tg:5"') >= 0, card.slice(0, 200))
}

if (failed) { console.log('\n✘ провалено проверок: ' + failed); process.exit(1) }
console.log('\n✓ все проверки прошли')
