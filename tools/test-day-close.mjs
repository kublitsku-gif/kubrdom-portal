#!/usr/bin/env node
// Закрытие дня и штраф за незакрытый (src/dayclose.js + крон в src/reminders.js).
// Сторожим то, за что платят деньги: кого дёргаем вечером, кому и сколько удерживаем
// утром, и главное — что удержание НЕ повторяется и НЕ прилетает тому, кто день закрыл.
// D1 и Telegram — моки: база по подстроке SQL, fetch по методу Bot API.
import { dayCloseState, dayFineCfg, fineSum, hasDayFine, markDayOff, setDayNote, DAY_FINE_CAT } from '../src/dayclose.js'
import { runReminders } from '../src/reminders.js'
import { dayCallback, dayText } from '../src/botday.js'

let fails = 0
function check(name, ok, got) {
  if (ok) { console.log('  OK  ' + name); return }
  fails++; console.log('ФЕЙЛ  ' + name + (got !== undefined ? '  << ' + JSON.stringify(got) : ''))
}

// ─── 1. Правило «день закрыт» ────────────────────────────────────────────────
console.log('── Правило «день закрыт» (общее с панелью)')
const D = '2026-09-15'
const objWith = (works, reports) => [{ id: 'o1', name: 'Баня', stages: [{ id: 's1', works: works }], dayReports: reports || [] }]

check('пустой день не закрыт', !dayCloseState(objWith([{ id: 'w1', n: 'Работа' }]), 'u1', D).closed)
check('часы закрывают день', dayCloseState(objWith([{ id: 'w1', timeLogs: [{ userId: 'u1', date: D, hours: 4 }] }]), 'u1', D).closed)
check('чужие часы день не закрывают', !dayCloseState(objWith([{ id: 'w1', timeLogs: [{ userId: 'u2', date: D, hours: 4 }] }]), 'u1', D).closed)
check('часы за другой день не считаются', !dayCloseState(objWith([{ id: 'w1', timeLogs: [{ userId: 'u1', date: '2026-09-14', hours: 8 }] }]), 'u1', D).closed)
check('отметка работы закрывает день', dayCloseState(objWith([{ id: 'w1', done: true, doneBy: 'u1', doneAt: D + ' 18:30' }]), 'u1', D).closed)
check('выходной закрывает день', dayCloseState(objWith([{ id: 'w1' }], [{ userId: 'u1', date: D, dayOff: true }]), 'u1', D).closed)
check('отчёт текстом закрывает день', dayCloseState(objWith([{ id: 'w1' }], [{ userId: 'u1', date: D, note: 'ставили стропила' }]), 'u1', D).closed)
{
  // День личный: человек весь день был на втором объекте — штрафовать не за что.
  const two = [{ id: 'o1', name: 'Баня', stages: [], dayReports: [] },
    { id: 'o2', name: 'Дом', stages: [{ id: 's', works: [{ id: 'w', timeLogs: [{ userId: 'u1', date: D, hours: 8 }] }] }], dayReports: [] }]
  check('часы на другом объекте закрывают день', dayCloseState(two, 'u1', D).closed, dayCloseState(two, 'u1', D))
}
{
  const objs = [{ id: 'o1', stages: [], dayReports: [] }, { id: 'o2', stages: [], dayReports: [] }]
  const off = markDayOff(objs, 'u1', D, ['o1', 'o2'], () => 'r1')
  check('выходной пишется во все активные объекты', off.every(o => o.dayReports.some(r => r.userId === 'u1' && r.dayOff)), off)
  const note = setDayNote(objs, 'u1', D, 'o1', 'заливали пол', () => 'r2')
  check('отчёт текстом пишется в один объект', note[0].dayReports[0].note === 'заливали пол' && !note[1].dayReports.length)
}
{
  const txns = [{ type: 'expense', userId: 'u1', contractId: 'c1', category: DAY_FINE_CAT, amount: 500 },
    { type: 'expense', userId: 'u1', contractId: 'c1', category: '⚠️ Штраф просрочка', amount: 2000 },
    { type: 'expense', userId: 'u2', contractId: 'c1', category: DAY_FINE_CAT, amount: 500 },
    { type: 'expense', userId: 'u1', contractId: 'c1', category: '👷 Зарплата производства', amount: 10000 }]
  check('удержания считаются по человеку, а не по всем', fineSum(txns, 'u1') === 2500, fineSum(txns, 'u1'))
  check('зарплата в удержания не попадает', fineSum(txns, 'u2') === 500)
  check('настройка по умолчанию выключена', dayFineCfg({}).enabled === false && dayFineCfg({}).amount === 500)
}

// ─── 2. Крон: вечер, последнее предупреждение, утреннее удержание ────────────
const TODAY = '2026-09-15'          // вторник
const TOMORROW = '2026-09-16'
let NOW = new Date(TODAY + 'T12:00:00Z').getTime() - 3 * 3600 * 1000
Date.now = () => NOW

const baseState = () => ({
  objects: [{
    id: 'o1', name: 'Баня с хозблоком', dayReports: [],
    stages: [{ id: 's1', n: 'ЭТАП 2', works: [
      { id: 'w1', n: 'Обрешётка', timeLogs: [{ id: 'tl1', userId: 'u_valera', date: TODAY, hours: 8 }] },
      { id: 'w2', n: 'Стены', timeLogs: [] },
    ] }],
  }],
  users: [
    { id: 'u_valera', name: 'Валера', roles: ['brigadier'] },
    { id: 'u_inna', name: 'Инна', roles: ['brigadier'] },
    { id: 'u_petya', name: 'Петя', roles: ['worker'] },      // не в списке отчитывающихся
    { id: 'u_admin', name: 'Юрий', roles: ['admin'] },
  ],
  contractDocs: [{ id: 'c1', objId: 'o1', status: 'signed', amount: 0, responsible: ['u_valera', 'u_inna', 'u_petya'], salaries: {} }],
  settings: { dayFine: { enabled: true, amount: 500, uids: ['u_valera', 'u_inna'], from: '2026-09-01' } },
  purchased: {}, arrived: {}, finTxns: [], issues: [],
})

let store, sent
function reset(mut) {
  store = {
    work_states: baseState(),
    tg_links: [
      { uid: 'u_valera', chat_id: '111' },
      { uid: 'u_inna', chat_id: '222' },
      { uid: 'u_admin', chat_id: '333' },
    ],
    notify_log: new Set(), tg_kb: {}, dialog: {},
  }
  if (mut) mut(store)
  sent = []
}
function stmt(sql) {
  let args = []
  const api = {
    bind(...a) { args = a; return api },
    async all() {
      if (sql.includes('FROM work_states')) {
        return { results: args.filter(k => store.work_states[k] !== undefined)
          .map(k => ({ work_id: k, data: JSON.stringify(store.work_states[k]) })) }
      }
      if (sql.includes('FROM tg_links')) {
        return { results: store.tg_links.map(l => ({ uid: l.uid, chat_id: l.chat_id, prefs: null })) }
      }
      return { results: [] }
    },
    async first() {
      if (sql.includes('FROM tg_kb')) return store.tg_kb[args[0]] ? { ver: store.tg_kb[args[0]] } : null
      if (sql.includes('FROM tg_dialog')) return store.dialog[args[0]] ? { state: store.dialog[args[0]] } : null
      return null
    },
    async run() {
      if (sql.includes('INSERT INTO tg_kb')) { store.tg_kb[args[0]] = args[1]; return { meta: { changes: 1 } } }
      if (sql.includes('INSERT INTO tg_dialog')) { store.dialog[args[0]] = args[1]; return { meta: { changes: 1 } } }
      if (sql.includes('DELETE FROM tg_dialog')) { delete store.dialog[args[0]]; return { meta: { changes: 1 } } }
      if (sql.includes('INSERT OR IGNORE INTO notify_log')) {
        const k = args.slice(0, 3).join('|')
        const fresh = !store.notify_log.has(k)
        store.notify_log.add(k)
        return { meta: { changes: fresh ? 1 : 0 } }
      }
      if (sql.includes('DELETE FROM notify_log')) { store.notify_log.delete(args.join('|')); return { meta: { changes: 1 } } }
      if (sql.includes("INSERT INTO work_states")) {
        const m = /'admin_panel','([a-zA-Z]+)'/.exec(sql)
        if (m) store.work_states[m[1]] = JSON.parse(args[0])
        return { meta: { changes: 1 } }
      }
      return { meta: { changes: 1 } }
    },
  }
  return api
}
const env = { TG_BOT_TOKEN: 'T', DB: { prepare: stmt, batch: async (xs) => xs } }
globalThis.fetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {}
  if (String(url).includes('/sendMessage')) sent.push({ chat: body.chat_id, text: body.text, kb: body.reply_markup })
  return { json: async () => ({ ok: true }) }
}
const to = (chat) => sent.filter(m => m.chat === chat).map(m => m.text)
const anyMatch = (chat, re) => to(chat).some(t => re.test(t))
const fines = () => (store.work_states.finTxns || []).filter(t => t.category === DAY_FINE_CAT)

console.log('\n── Вечер 19:00: «закройте день»')
reset()
await runReminders(env, '0 16 * * *')
check('Инне ушло напоминание', anyMatch('222', /Закройте день 2026-09-15/), to('222'))
check('Валере (день закрыт часами) — тишина', !anyMatch('111', /Закройте день/), to('111'))
check('в напоминании названа цена дня', anyMatch('222', /500 ₽/), to('222'))
{
  const msg = sent.find(m => m.chat === '222' && /Закройте день/.test(m.text))
  const kb = (msg && msg.kb && msg.kb.inline_keyboard) || []
  check('кнопка часов открывает «Мой день» в Telegram', kb[0] && kb[0][0].web_app && /go=tab%3Dmyday/.test(kb[0][0].web_app.url), kb[0])
  check('выходной и отчёт — кнопками в чате', kb[1] && kb[1][0].callback_data === 'dc:off:' + TODAY && kb[2][0].callback_data === 'dc:note:' + TODAY, kb)
}
check('старое «часы не записаны» не дублирует напоминание', !anyMatch('222', /Часы за сегодня не записаны/), to('222'))

console.log('\n── 21:00: последнее предупреждение')
reset()
await runReminders(env, '0 18 * * *')
check('Инне ушло последнее', anyMatch('222', /ещё не закрыт/), to('222'))
check('названа сумма и срок', anyMatch('222', /до 09:00.*удержим <b>500 ₽/s), to('222'))
check('Валеру не трогаем', !anyMatch('111', /не закрыт/), to('111'))

console.log('\n── Утро 09:00: удержание за вчера')
reset()
NOW = new Date(TOMORROW + 'T09:00:00Z').getTime() - 3 * 3600 * 1000
await runReminders(env, '0 6 * * *')
check('штраф один — Инне', fines().length === 1 && fines()[0].userId === 'u_inna', fines())
check('сумма и дата вчерашние', fines()[0] && fines()[0].amount === 500 && fines()[0].date === TODAY, fines()[0])
check('привязан к объекту и договору', fines()[0] && fines()[0].objId === 'o1' && fines()[0].contractId === 'c1', fines()[0])
check('Инна узнала об удержании', anyMatch('222', /Удержано 500 ₽/), to('222'))
check('админу ушла сводка', anyMatch('333', /Удержания за 2026-09-15/), to('333'))
check('Валера ничего не получил', !anyMatch('111', /Удержано/), to('111'))
{
  const was = fines().length, msgs = sent.length
  await runReminders(env, '0 6 * * *')
  check('повторный прогон не удерживает дважды', fines().length === was, fines().length)
  check('и не пишет повторно', sent.length === msgs, sent.length - msgs)
}
check('метка ref защищает от второго списания', hasDayFine(store.work_states.finTxns, 'u_inna', TODAY))

console.log('\n── Кого не штрафуем')
{
  reset(s => { s.tg_links = s.tg_links.filter(l => l.uid !== 'u_inna') })
  await runReminders(env, '0 6 * * *')
  check('не привязан к боту — напоминаний не было, штрафа тоже', fines().length === 0, fines())
}
{
  // Все работы закрыты: объект сдан, закрывать нечего.
  reset(s => { s.work_states.objects[0].stages[0].works.forEach(w => { w.done = true }) })
  await runReminders(env, '0 6 * * *')
  check('нет объектов с открытыми работами — не штрафуем', fines().length === 0, fines())
}
{
  reset(s => { s.work_states.settings.dayFine.uids = ['u_valera'] })
  await runReminders(env, '0 6 * * *')
  check('кого нет в списке — не штрафуем', fines().length === 0, fines())
}
{
  reset(s => { s.work_states.settings.dayFine.from = '2026-09-20' })
  await runReminders(env, '0 6 * * *')
  check('до даты включения режима — не штрафуем', fines().length === 0, fines())
}
{
  reset(s => { s.work_states.settings.dayFine.enabled = false })
  await runReminders(env, '0 6 * * *')
  check('режим выключен — ни напоминаний, ни штрафа', fines().length === 0 && !anyMatch('222', /Удержано/), fines())
}
{
  reset(s => { s.work_states.objects[0].dayReports.push({ id: 'r1', userId: 'u_inna', date: TODAY, dayOff: true }) })
  await runReminders(env, '0 6 * * *')
  check('отметила выходной — штрафа нет', fines().length === 0, fines())
}
{
  reset(s => { s.work_states.objects[0].dayReports.push({ id: 'r2', userId: 'u_inna', date: TODAY, note: 'возили доску' }) })
  await runReminders(env, '0 6 * * *')
  check('написала отчёт текстом — штрафа нет', fines().length === 0, fines())
}

console.log('\n── Кнопки в чате: выходной и отчёт текстом')
{
  reset()
  NOW = new Date(TODAY + 'T20:00:00Z').getTime() - 3 * 3600 * 1000
  await dayCallback(env, 'u_inna', '222', 'dc:off:' + TODAY)
  const rep = store.work_states.objects[0].dayReports.find(r => r.userId === 'u_inna' && r.date === TODAY)
  check('выходной записан в снимок', !!(rep && rep.dayOff), store.work_states.objects[0].dayReports)
  check('бот подтвердил', anyMatch('222', /Выходной отмечен/), to('222'))
  NOW = new Date(TOMORROW + 'T09:00:00Z').getTime() - 3 * 3600 * 1000
  await runReminders(env, '0 6 * * *')
  check('после выходного утром не удержали', fines().length === 0, fines())
}
{
  reset()
  NOW = new Date(TODAY + 'T20:00:00Z').getTime() - 3 * 3600 * 1000
  await dayCallback(env, 'u_inna', '222', 'dc:note:' + TODAY)
  check('бот спросил, что делали', anyMatch('222', /Что делали/), to('222'))
  check('свободный текст без вопроса ботом не съедается', (await dayText(env, 'u_valera', '111', 'привет')) === false)
  check('нажатие кнопки меню не уходит в отчёт', (await dayText(env, 'u_inna', '222', '🏗 Объекты')) === false)
  await dayCallback(env, 'u_inna', '222', 'dc:note:' + TODAY)
  check('ответ записан отчётом дня', (await dayText(env, 'u_inna', '222', 'возили доску, ждём кран')) === true)
  const rep = store.work_states.objects[0].dayReports.find(r => r.userId === 'u_inna' && r.date === TODAY)
  check('текст лёг в отчёт дня', !!(rep && /возили доску/.test(rep.note || '')), rep)
  NOW = new Date(TOMORROW + 'T09:00:00Z').getTime() - 3 * 3600 * 1000
  await runReminders(env, '0 6 * * *')
  check('после отчёта текстом утром не удержали', fines().length === 0, fines())
}

console.log('\n── Мягкий запуск: предупреждаем, но не удерживаем')
reset(s => { s.work_states.settings.dayFine.softUntil = '2026-09-30' })
NOW = new Date(TOMORROW + 'T09:00:00Z').getTime() - 3 * 3600 * 1000
await runReminders(env, '0 6 * * *')
check('денег не списали', fines().length === 0, fines())
check('но предупредили честно', anyMatch('222', /мягкий запуск/i), to('222'))

process.exit(fails ? 1 : 0)
