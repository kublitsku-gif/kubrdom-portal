#!/usr/bin/env node
// Карточка сообщения клиента в ветке Telegram (src/sales-dialog.js + tgCard* в worker.js):
// одно сообщение на реплику, статус «✅ Отправлено» вместо новых сообщений, кнопки
// переписать / планировки / архив, ответ текстом и голосовым в ветке, тема без переименований.
import worker from '../src/worker.js'
import { sqliteDB } from './harness/sqlite-db.js'
import { dialogLabel, dialogCardText, dialogKeyboard, planKeyboard, sentStatus, redraftHint } from '../src/sales-dialog.js'
import { topicName, topicShouldClose } from '../src/sales-workspace.js'

let failed = 0
const ok = (name, cond, detail) => { if (cond) console.log('  ✓ ' + name); else { failed++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')) } }
const flat = (kb) => kb.inline_keyboard.flat()

{
  console.log('Карточка: текст и кнопки')
  ok('метка: Авито, объявление, код, стадия', dialogLabel({ source: 'avito', itemTitle: 'Баня 6 м', stage: 'kp', code: 57 }) === '📢 Авито · Баня 6 м · КД-057 · Отправлено КП')
  const t = dialogCardText({ label: 'L', name: 'Маргарита', clientText: 'ТЗ пришлю', draft: 'Жду ТЗ', tag: '🟢 можно авто', status: '✅ Отправлено 17:50' })
  ok('одно сообщение: метка, клиент, черновик, статус', t === 'L\n\n👤 Маргарита:\nТЗ пришлю\n\n🤖 Черновик (🟢 можно авто):\nЖду ТЗ\n\n✅ Отправлено 17:50', t)
  ok('длинный текст режется под лимит Telegram', dialogCardText({ clientText: 'х'.repeat(5000) }).length < 4096)
  const kb = flat(dialogKeyboard({ idx: 3, crmUrl: 'https://portal.kubrdom.ru/crm?go=chat%3Davito%3A1' }))
  ok('кнопки: отправить, изменить, переписать ×3, планировки, архив, спам, CRM', ['send:3', 'edit:3', 'rd:3:s', 'rd:3:w', 'rd:3:p', 'pl:3', 'arc:3', 'spm:3'].every((d) => kb.some((b) => b.callback_data === d)) && kb.some((b) => b.url && b.url.includes('/crm?go=chat')))
  ok('с планировкой — «С планировкой» и «Только текст»', flat(dialogKeyboard({ idx: 1, plans: ['kd29-1'] })).some((b) => b.callback_data === 'sendp:1'))
  ok('надиктованное: отправить, «Пусть ИИ напишет», не отправлять', flat(dialogKeyboard({ idx: 2, dictated: true })).map((b) => b.callback_data).filter(Boolean).join() === 'send:2,rv:2,drop:2')
  ok('callback_data не длиннее 64 байт', flat(planKeyboard(12, { 'kd29-1': { title: 'КД-29.1 — отдельная спальня' } })).every((b) => Buffer.byteLength(b.callback_data) <= 64))
  ok('ответили своим текстом — статус показывает, каким', sentStatus({ how: 'из CRM', ts: Date.UTC(2026, 9, 29, 14, 50), text: 'Свой ответ', draft: 'Черновик' }) === '✅ Отправлено 17:50 · из CRM\n🙋 Вы: Свой ответ')
  ok('ушёл черновик как есть — без повтора текста', sentStatus({ ts: 0, text: 'Черновик', draft: 'Черновик' }).indexOf('🙋') < 0)
  ok('подсказки «переписать» по коду кнопки', redraftHint('s') === 'Короче' && redraftHint('x') === '')
  ok('тема — только имя, без значка статуса', topicName({ name: 'Илья', status: 'new' }) === 'Илья' && topicName({ name: 'Илья', status: 'waiting' }) === 'Илья')
  ok('тема закрывается в архиве и после отказа, но не после договора', topicShouldClose({ archived: true }) && topicShouldClose({ status: 'refused' }) && !topicShouldClose({ status: 'contract' }) && !topicShouldClose({ status: 'new' }))
}

// ── Worker: кнопки, ответ из CRM, ответ и голос в ветке ──────────────────────
const CHAT = '-100777', TOPIC = 50, CARD = 700
const seedChats = () => ({
  'avito:ch1': { source: 'avito', name: 'Маргарита', avitoChatId: 'ch1', chatId: CHAT, topicId: TOPIC, messages: [
    { role: 'user', text: 'ТЗ пришлю', status: 'in', ts: 1 },
    { role: 'assistant', text: 'Жду ТЗ', status: 'draft', needsApproval: false, plans: [], ts: 2, tgMsgId: CARD, card: { label: '📢 Авито', name: 'Маргарита', clientText: 'ТЗ пришлю' } },
  ] },
})
const real = sqliteDB({ users: [{ id: 'yuriy', name: 'Юрий', roles: ['admin'] }], aiChats: seedChats() })
const ENV = { DB: real.db, ADMIN_TOKEN: 'master', WEBHOOK_SECRET: 'hook', TG_SALES_BOT_TOKEN: 'SALES', TG_SALES_CHAT_ID: CHAT, AVITO_CLIENT_ID: 'id', AVITO_CLIENT_SECRET: 's', AVITO_USER_ID: '9', YANDEX_API_KEY: 'y', YANDEX_FOLDER_ID: 'f', PUBLIC_BASE_URL: 'https://portal.kubrdom.ru' }
const tg = [], avito = []
let fileBot = ''
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  url = String(url)
  if (url.startsWith('https://api.telegram.org/file/bot')) { fileBot = url.split('/file/bot')[1].split('/')[0]; return new Response(new Uint8Array([1, 2, 3])) }
  if (url.startsWith('https://api.telegram.org/')) {
    const method = url.split('/').pop().split('?')[0]
    const body = init.body ? JSON.parse(init.body) : {}
    tg.push({ method, body })
    if (method === 'getFile') return Response.json({ ok: true, result: { file_path: 'voice/a.oga' } })
    return Response.json({ ok: true, result: { message_id: 900 + tg.length } })
  }
  if (url === 'https://api.avito.ru/token') return Response.json({ access_token: 't', expires_in: 3600 })
  if (url.startsWith('https://api.avito.ru/')) { avito.push({ url, body: init.body }); return Response.json({ id: 'av' + avito.length }) }
  if (url.startsWith('https://stt.api.cloud.yandex.net/')) return Response.json({ result: 'Скажите что дом стоит миллион' })
  return realFetch(url, init)
}
const hook = (upd) => worker.fetch(new Request('https://portal.kubrdom.ru/api/ai/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'hook', 'Content-Type': 'application/json' }, body: JSON.stringify(upd) }), ENV, { waitUntil() {} })
const api = (path, body) => worker.fetch(new Request('https://portal.kubrdom.ru' + path, { method: 'POST', headers: { 'X-Admin-Token': 'master', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ENV, { waitUntil() {} })
const press = (data, mid = CARD) => hook({ callback_query: { id: 'q', from: { id: 1 }, data, message: { message_id: mid, message_thread_id: TOPIC, chat: { id: Number(CHAT) } } } })
const chat = () => real.get('aiChats').data['avito:ch1']
const edits = (mid) => tg.filter((x) => x.method === 'editMessageText' && x.body.message_id === mid)
const reset = () => { real.set('aiChats', seedChats()); tg.length = 0; avito.length = 0 }

{
  console.log('Кнопка «Отправить»')
  await press('send:1')
  const e = edits(CARD).at(-1)
  ok('черновик ушёл в Авито', avito.some((a) => a.url.includes('/chats/ch1/messages')) && chat().messages[1].status === 'sent')
  ok('карточка правится: «✅ Отправлено», кнопки сняты', e && /✅ Отправлено \d\d:\d\d · кнопкой/.test(e.body.text) && e.body.reply_markup.inline_keyboard.length === 0, e && e.body.text)
  ok('отдельного «✅ Ответ отправлен» больше нет', !tg.some((x) => x.method === 'sendMessage'))
  tg.length = 0
  await press('send:1')
  ok('повторное нажатие ничего не шлёт', avito.length === 1 && !tg.some((x) => x.method === 'sendMessage'))
}
{
  console.log('Ответ из CRM и из Авито')
  reset()
  const r = await (await api('/api/ai/send', { clientKey: 'avito:ch1', text: 'Свой ответ из CRM' })).json()
  const e = edits(CARD).at(-1)
  ok('ответ из CRM закрывает карточку «· из CRM» с текстом ответа', r.success && e && e.body.text.includes('· из CRM') && e.body.text.includes('🙋 Вы: Свой ответ из CRM') && e.body.reply_markup.inline_keyboard.length === 0, e && e.body.text)
  ok('«✅ Ответ из CRM отправлен клиенту» отдельным сообщением больше нет', !tg.some((x) => x.method === 'sendMessage'))
  tg.length = 0
  await worker.fetch(new Request('https://portal.kubrdom.ru/api/avito/webhook?s=hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { type: 'message', value: { id: 'x1', chat_id: 'ch1', author_id: 9, created: 1790000000, type: 'text', content: { text: 'Набрал прямо в Авито' } } } }) }), ENV, { waitUntil() {} })
  const quiet = tg.find((x) => x.method === 'sendMessage')
  ok('ответ, набранный в Авито, без карточки — короткой строкой «🙋 Вы · в Авито» без звука', quiet && quiet.body.text.startsWith('🙋 Вы · в Авито') && quiet.body.disable_notification === true, quiet && JSON.stringify(quiet.body))
}
{
  console.log('Ответ текстом в ветке')
  reset()
  await hook({ message: { message_id: 801, message_thread_id: TOPIC, chat: { id: Number(CHAT) }, from: { id: 5 }, text: 'Привет, пишу сам' } })
  ok('ушло клиенту и подтверждено реакцией 👌, без лишнего сообщения', avito.length === 1 && tg.some((x) => x.method === 'setMessageReaction' && x.body.message_id === 801) && !tg.some((x) => x.method === 'sendMessage'))
  const e = edits(CARD).at(-1)
  ok('карточка закрыта «ответ в Telegram» без повтора текста', e && e.body.text.includes('ответ в Telegram') && e.body.text.indexOf('🙋 Вы:') < 0, e && e.body.text)
}
{
  console.log('Планировки и архив')
  reset()
  await press('pl:1')
  const plk = tg.find((x) => x.method === 'editMessageReplyMarkup')
  ok('«🖼 Планировки» показывает выбор на месте кнопок', plk && flat(plk.body.reply_markup).some((b) => b.callback_data === 'pls:1:kd29-1'))
  await press('arc:1')
  const e = edits(CARD).at(-1)
  ok('«🗄 Архив» — диалог в архиве, карточка без кнопок', chat().archived === true && e && e.body.text.includes('🗄 Диалог в архиве') && e.body.reply_markup.inline_keyboard.length === 0)
}
{
  console.log('Голосовое в ветке')
  reset()
  await hook({ message: { message_id: 802, message_thread_id: TOPIC, chat: { id: Number(CHAT) }, from: { id: 5 }, voice: { file_id: 'v1', duration: 4 } } })
  const card = tg.find((x) => x.method === 'sendMessage')
  ok('голосовое скачано ботом продаж и расшифровано', fileBot === 'SALES')
  ok('карточка «🎤 Вы надиктовали» с кнопками', card && card.body.text.includes('🎤 Вы надиктовали:\nСкажите что дом стоит миллион') && flat(card.body.reply_markup).some((b) => b.callback_data && b.callback_data.startsWith('rv:')), card && card.body.text)
  const d = chat().messages.at(-1)
  ok('в диалоге — надиктованный черновик, прежняя карточка устарела', d.dictated && d.status === 'draft' && chat().messages[1].cardDone === true)
  await press('drop:' + (chat().messages.length - 1), d.tgMsgId)
  ok('«Не отправлять» убирает черновик и карточку', !chat().messages.some((m) => m.dictated) && tg.some((x) => x.method === 'deleteMessage' && x.body.message_id === d.tgMsgId))
}
globalThis.fetch = realFetch

if (failed) { console.log('\n✘ провалено проверок: ' + failed); process.exit(1) }
console.log('\n✓ все проверки прошли')
