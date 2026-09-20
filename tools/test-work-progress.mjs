#!/usr/bin/env node
// Готовность работы в процентах (src/progress.js + панель).
//
// Готовность была булевой: день, в котором бригадир сдвинул восемь работ по чуть-чуть,
// выглядел в портале как ноль. Гибрид: процент считается сам из часов, человек одним
// тапом перебивает оценку. Сторожим сам расчёт, вес по деньгам (а не по числу работ)
// и три места, где процент вводят: панель учёта времени, шторка работы и мастер.
import { workPct, isAutoPct, objPct, lastPctLog, PCT_PRESETS, AUTO_PCT_CAP } from '../src/progress.js'
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

t.section('Расчёт готовности')
{
  t.ok('без часов и плана — ноль', workPct({}) === 0)
  t.ok('оценка по часам: 3 из 10 = 30%', workPct({ planHours: 10, timeLogs: [{ hours: 3 }] }) === 30)
  t.ok('оценка не доходит до 100', workPct({ planHours: 1, timeLogs: [{ hours: 99 }] }) === AUTO_PCT_CAP)
  t.ok('«Готово» — всегда 100', workPct({ done: true, planHours: 10, timeLogs: [] }) === 100)
  t.ok('без плановых часов оценки нет', workPct({ timeLogs: [{ hours: 7 }] }) === 0)
  t.ok('названный процент бьёт оценку', workPct({ planHours: 10, timeLogs: [{ hours: 9 }, { date: '2026-09-19', pct: 20 }] }) === 20)
  t.ok('0% — это значение, а не «не указано»', workPct({ planHours: 10, timeLogs: [{ hours: 9, pct: 0 }] }) === 0)
  t.ok('шаг пресетов 10', PCT_PRESETS.length === 11 && PCT_PRESETS[1] === 10 && PCT_PRESETS[10] === 100)
}

t.section('Какой процент считается последним')
{
  const logs = [{ date: '2026-09-20', pct: 60 }, { date: '2026-09-18', pct: 10 }]
  t.ok('поздняя дата, а не поздняя запись', lastPctLog(logs).pct === 60)
  const same = [{ date: '2026-09-20', pct: 30 }, { date: '2026-09-20', pct: 55 }]
  t.ok('в один день — внесённый позже', lastPctLog(same).pct === 55)
  t.ok('записи без процента не мешают', lastPctLog([{ date: '2026-09-21', hours: 8 }, { date: '2026-09-20', pct: 40 }]).pct === 40)
  t.ok('процентов нет — null', lastPctLog([{ hours: 5 }]) === null)
}

t.section('Готовность объекта взвешена по деньгам')
{
  // «Монтаж перегородок» за 50 000 не равен «повесить крючок» за 500.
  const obj = { stages: [{ works: [
    { cost: 50000, done: true },
    { cost: 500, timeLogs: [] },
  ] }] }
  t.ok('дорогая работа тянет больше', objPct(obj) === 99, String(objPct(obj)))
  const half = { stages: [{ works: [{ cost: 1000, timeLogs: [{ date: '2026-09-20', pct: 50 }] }] }] }
  t.ok('частичная готовность считается', objPct(half) === 50)
  const free = { stages: [{ works: [{ done: true }, {}] }] }
  t.ok('смета без цен — поровну', objPct(free) === 50)
  t.ok('пустой объект — ноль', objPct({ stages: [] }) === 0)
  t.ok('автооценка тоже идёт в зачёт', objPct({ stages: [{ works: [{ cost: 100, planHours: 10, timeLogs: [{ hours: 4 }] }] }] }) === 40)
}

// ── Панель ──────────────────────────────────────────────────────────────────
function panel () {
  const p = boot({})
  p.set({
    users: [{ id: 'u1', name: 'Валера', roles: ['brigadier'], c: '#8e44ad', av: '👷', objs: ['o1'] }],
    roles: [{ id: 'brigadier', n: 'Бригадир' }],
    objects: [{
      id: 'o1', icon: '🛁', name: 'Баня Буханка', stages: [
        { id: 's1', n: 'ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЙ', c: '#e67e22', works: [
          { id: 'w1', n: 'Монтаж перегородок', cost: 10000, planHours: 10, done: false, mats: [], timeLogs: [{ id: 'l0', userId: 'u1', date: '2026-09-19', hours: 2 }] },
          { id: 'w2', n: 'Укладка лаг', cost: 10000, done: false, mats: [], timeLogs: [{ id: 'l1', userId: 'u1', date: '2026-09-19', hours: 4, pct: 40 }] },
        ] },
      ],
    }],
    issues: [], templates: [], contractDocs: [], crmClients: [], purchases: [], purchased: {}, arrived: {},
    finTxns: [], receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {}, stock: [],
  })
  p.run('currentUser=users[0];')
  return p
}
const objView = (p) => { p.run('tab="objects";openObject="o1";objWorkView="receive";'); return p.run('tObjects()') }
const click = (p, dataset) => { const n = p.dom.node(dataset); p.run('bind();'); n.onclick && n.onclick({ stopPropagation () {}, preventDefault () {}, target: {} }); return n }
const logsOf = (p, wi) => p.q(`objects[0].stages[0].works[${wi}].timeLogs`)

t.section('Процент виден в строке работы')
{
  const p = panel()
  const m = objView(p)
  t.ok('оценка по часам помечена «~»', /~20%/.test(m), m.slice(m.indexOf('Монтаж перегородок'), m.indexOf('Монтаж перегородок') + 1400).match(/~?\d+%/g) + '')
  t.ok('названный процент — без «~»', m.indexOf('>40%<') >= 0 || /[^~]40%/.test(m))
  t.ok('шапка объекта считает по деньгам', m.indexOf('>30%</b>') >= 0, (m.match(/>\d+%<\/b>/g) || []) + '')
}

t.section('Панель учёта времени пишет процент в запись')
{
  const p = panel()
  p.run('openTimeWid="w1";')
  const m = objView(p)
  t.ok('строка готовности есть', m.indexOf('ГОТОВ-') >= 0)
  t.ok('чипов 11, шаг 10', (m.match(/data-a="obj-tl-pct"/g) || []).length >= 11)
  p.dom.field('tl-date-w1', '2026-09-20')
  p.run('newTimeLog={hours:2,date:"2026-09-20",userId:"u1",pct:30};')
  click(p, { a: 'obj-tl-save', oid: 'o1', sid: 's1', wid: 'w1' })
  const logs = logsOf(p, 0)
  t.ok('запись сохранена с процентом', logs.length === 2 && logs[1].pct === 30, JSON.stringify(logs))
  t.ok('готовность работы стала 30%', p.q('workPct(objects[0].stages[0].works[0])') === 30)
  t.ok('следующая запись начинается с «не менять»', p.q('newTimeLog.pct') === null)
}

t.section('Без выбора процент не трогаем')
{
  const p = panel()
  p.dom.field('tl-date-w1', '2026-09-20')
  p.run('newTimeLog={hours:2,date:"2026-09-20",userId:"u1",pct:null};')
  click(p, { a: 'obj-tl-save', oid: 'o1', sid: 's1', wid: 'w1' })
  const last = logsOf(p, 0)[1]
  t.ok('в записи нет поля pct', last && last.pct === undefined, JSON.stringify(last))
  t.ok('оценка по часам продолжает считать', p.q('workPct(objects[0].stages[0].works[0])') === 40)
}

t.section('Шторка работы: готовность выбирается до часов')
{
  const p = panel()
  p.run('workSheet={oid:"o1",sid:"s1",wid:"w1",date:"today",otherDate:"",uid:"u1",pct:null};')
  const sheet = p.run('workSheetModal()')
  t.ok('строка готовности в шторке', sheet.indexOf('ГОТОВНОСТЬ ПОСЛЕ ЭТОГО') >= 0)
  t.ok('чипы кликабельны', (sheet.match(/data-a="ws-pct"/g) || []).length >= 11)
  click(p, { a: 'ws-pct', p: '70' })
  t.ok('выбор запомнен', p.q('workSheet.pct') === 70)
  click(p, { a: 'ws-hours', h: '3', uid: 'u1', wn: 'Монтаж перегородок' })
  const logs = logsOf(p, 0)
  t.ok('часы записаны вместе с процентом', logs.length === 2 && logs[1].hours === 3 && logs[1].pct === 70, JSON.stringify(logs))
  t.ok('шторка закрылась', p.q('workSheet') === null)
}

t.section('Мастер записи правит свою запись, а не чужую')
{
  const p = panel()
  p.run('tlWizard={step:"photo",oid:"o1",sid:"s1",wid:"w1",wname:"Монтаж перегородок",uid:"u1",hours:3,savedLid:"l0",photoCount:0};')
  const wiz = p.run('tlWizardModal()')
  t.ok('готовность спрашивают после часов', wiz.indexOf('ГОТОВНОСТЬ РАБОТЫ') >= 0)
  click(p, { a: 'tl-wiz-pct', p: '60' })
  const logs = logsOf(p, 0)
  t.ok('процент лёг в созданную мастером запись', logs[0].id === 'l0' && logs[0].pct === 60, JSON.stringify(logs))
  t.ok('соседняя работа не тронута', logsOf(p, 1)[0].pct === 40)
}

t.done()
