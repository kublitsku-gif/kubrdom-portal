#!/usr/bin/env node
// Сдвиг готовности за день: отчёт дня, «Мой день» и вечерняя сводка.
//
// «Часов отмечено: 7» не отвечает на вопрос, что за день сделано: семь часов могли
// уйти в одну работу или в восемь по чуть-чуть. Сторожим сам расчёт сдвига (он общий
// для панели и Worker'а), личность отчёта дня и то, что молчание при отмеченных
// часах тоже названо — это и есть «пишет часы, а процент стоит».
import { dayPctShifts, shiftLabel, workPctAsOf, shiftsDigest, SHIFT_DIGEST_MAX } from '../src/progress.js'
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const D0 = '2026-09-19'
const D1 = '2026-09-20'

const OBJ = () => ({
  id: 'o1', icon: '🛁', name: 'Баня Буханка', stages: [{ id: 's1', n: 'ЭТАП 1', c: '#e67e22', works: [
    // Оценка по часам: 2 ч вчера + 3 ч сегодня из 10 плановых → 20% → 50%.
    { id: 'w1', n: 'Монтаж перегородок', cost: 10000, planHours: 10, mats: [], timeLogs: [
      { id: 'l1', userId: 'u1', date: D0, hours: 2 }, { id: 'l2', userId: 'u1', date: D1, hours: 3 }] },
    // Названный процент: 10% → 40%.
    { id: 'w2', n: 'Укладка лаг', cost: 10000, mats: [], timeLogs: [
      { id: 'l3', userId: 'u1', date: D0, hours: 2, pct: 10 }, { id: 'l4', userId: 'u1', date: D1, hours: 4, pct: 40 }] },
    // Закрыта сегодня — сдвиг до 100.
    { id: 'w3', n: 'Повесить крючок', cost: 500, done: true, doneBy: 'u1', doneAt: D1 + ' 15:00', mats: [], timeLogs: [
      { id: 'l5', userId: 'u1', date: D1, hours: 1 }] },
    // Работали вчера — сегодня не двигалась.
    { id: 'w4', n: 'Вынос мусора', cost: 1000, planHours: 5, mats: [], timeLogs: [
      { id: 'l6', userId: 'u1', date: D0, hours: 5 }] },
    // Часы есть, а плана нет и процент не назвали — сдвига не будет.
    { id: 'w5', n: 'Уборка', cost: 300, mats: [], timeLogs: [{ id: 'l7', userId: 'u2', date: D1, hours: 2 }] },
  ] }],
})

t.section('Что считается сдвигом')
{
  const shifts = dayPctShifts([OBJ()], D1)
  const byName = Object.fromEntries(shifts.map((s) => [s.wname, s]))
  t.ok('оценка по часам двигает готовность', byName['Монтаж перегородок'].from === 20 && byName['Монтаж перегородок'].to === 50)
  t.ok('названный процент тоже', byName['Укладка лаг'].delta === 30)
  t.ok('закрытая сегодня работа — до 100', byName['Повесить крючок'].to === 100 && byName['Повесить крючок'].done === true)
  t.ok('вчерашняя работа сегодня не всплывает', !byName['Вынос мусора'])
  t.ok('часы без плана и без процента сдвигом не считаются', !byName['Уборка'])
  t.ok('крупные впереди', shifts[0].wname === 'Повесить крючок', shifts.map((s) => s.wname) + '')
  t.ok('подпись читаемая', shiftLabel(byName['Укладка лаг']) === 'Укладка лаг 10 → 40%')
}

t.section('Отчёт дня личный')
{
  const mine = dayPctShifts([OBJ()], D1, 'u1')
  t.ok('чужие работы не в моём отчёте', mine.length === 3 && !mine.some((s) => s.wname === 'Уборка'))
  t.ok('у коллеги свой список', dayPctShifts([OBJ()], D1, 'u2').length === 0)
  t.ok('без даты — пусто, а не весь объект', dayPctShifts([OBJ()], '').length === 0)
}

t.section('Готовность «на конец дня» не заглядывает вперёд')
{
  const w = OBJ().stages[0].works[1]
  t.ok('вчера было 10%', workPctAsOf(w, D0) === 10)
  t.ok('сегодня 40%', workPctAsOf(w, D1) === 40)
  const noDate = { done: true, planHours: 10, timeLogs: [{ date: D1, hours: 1 }] }
  t.ok('«Готово» без даты закрытия не задним числом', workPctAsOf(noDate, D0) === 0 && workPctAsOf(noDate, null) === 100)
}

// ── Панель ──────────────────────────────────────────────────────────────────
function panel (works) {
  const p = boot({})
  const obj = OBJ()
  if (works) obj.stages[0].works = works
  p.set({
    users: [
      { id: 'u1', name: 'Валера', roles: ['brigadier'], c: '#8e44ad', av: '👷', objs: ['o1'] },
      { id: 'u2', name: 'Пётр', roles: ['worker'], c: '#2980b9', av: '🧑', objs: ['o1'] },
    ],
    roles: [{ id: 'brigadier', n: 'Бригадир' }, { id: 'worker', n: 'Рабочий' }],
    objects: [obj],
    contractDocs: [{ id: 'c1', objId: 'o1', status: 'signed', responsible: ['u1'], name: 'Договор' }],
    issues: [], templates: [], crmClients: [], purchases: [], purchased: {}, arrived: {},
    finTxns: [], receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {}, stock: [],
  })
  // «Сегодня» у панели берётся из системной даты — подменяем, чтобы стенд не зависел от дня прогона.
  p.run(`todayISO=function(){return ${JSON.stringify(D1)};};currentUser=users[0];`)
  return p
}

t.section('Отчёт дня в карточке объекта')
{
  const p = panel()
  p.run('tab="objects";openObject="o1";objSecOpen={"o1|dayreport":true};')
  const m = p.run('tObjects()')
  const i = m.indexOf('СДВИГ ЗА ДЕНЬ')
  t.ok('блок сдвига есть', i > 0)
  const sec = m.slice(i, i + 1800)
  t.ok('считает только мои работы', sec.indexOf('СДВИГ ЗА ДЕНЬ · 3') >= 0, sec.slice(0, 120))
  t.ok('видно откуда и куда', sec.indexOf('20 → 50%') >= 0)
  t.ok('дельта со знаком', sec.indexOf('+30') >= 0)
  t.ok('закрытая работа помечена', sec.indexOf('✅ Повесить крючок') >= 0)
}

t.section('Часы есть, а сдвига нет — так и говорим')
{
  const p = panel([{ id: 'wq', n: 'Что-то делал', cost: 1000, mats: [], timeLogs: [{ id: 'lq', userId: 'u1', date: D1, hours: 7 }] }])
  p.run('tab="objects";openObject="o1";objSecOpen={"o1|dayreport":true};')
  const m = p.run('tObjects()')
  t.ok('предупреждение вместо пустоты', m.indexOf('готовность работ не сдвинулась') >= 0)
  t.ok('блока сдвига при этом нет', m.indexOf('СДВИГ ЗА ДЕНЬ') < 0)
}

t.section('«Мой день»: сдвиг в карточке работы')
{
  const p = panel()
  p.run('tab="myday";mdDate="";mdObj="o1";')
  const m = p.run('tMyDay()')
  t.ok('готовность названа', m.indexOf('📈 готовность') >= 0)
  t.ok('переход за этот день', m.indexOf('20 → 50%') >= 0, (m.match(/\d+ → \d+%/g) || []) + '')
}

t.section('Вечерняя сводка в Telegram')
{
  const shifts = dayPctShifts([OBJ()], D1)
  const d = shiftsDigest(shifts, 6, (x) => x)
  t.ok('называет число сдвинувшихся', d.indexOf('Сдвинулось работ: <b>3</b>') >= 0, d)
  t.ok('перечисляет работы', d.indexOf('Укладка лаг 10 → 40% (+30)') >= 0, d)
  t.ok('закрытую помечает', d.indexOf('Повесить крючок 0 → 100% ✅') >= 0)
  t.ok('заканчивается переводом строки', d.endsWith('\n'))
  const many = Array.from({ length: 9 }, (_, i) => ({ wname: 'Р' + i, from: 0, to: 10, delta: 10 }))
  const dm = shiftsDigest(many, 8, (x) => x)
  t.ok('длинный список подрезан', (dm.match(/•/g) || []).length === SHIFT_DIGEST_MAX + 1 && dm.indexOf('и ещё 4') >= 0, dm)
  t.ok('часы без сдвига — отдельная строка', shiftsDigest([], 7, (x) => x).indexOf('не сдвинулась') >= 0)
  t.ok('пустой день сводку не засоряет', shiftsDigest([], 0, (x) => x) === '')
  t.ok('имя работы экранируется', shiftsDigest([{ wname: '<b>x', from: 0, to: 5, delta: 5 }], 1, (x) => x.replace('<', '&lt;')).indexOf('&lt;b>x') >= 0)
}

t.done()
