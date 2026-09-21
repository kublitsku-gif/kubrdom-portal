#!/usr/bin/env node
// Диаграмма Ганта: готовность работ и приложенные фото/видео.
//
// Гант показывал только часы по дням: какие работы доведены до конца и к каким
// приложен фотоотчёт, из него было не видно — за этим шли в карточку объекта и
// искали работу в списке из сорока руками. Сторожим подпись работы (процент,
// полоска, счётчики медиа, выделение сотни) и переход по тапу.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const D = '2026-09-19'

function panel () {
  const p = boot({})
  p.set({
    users: [{ id: 'u1', name: 'Валера', roles: ['admin'], c: '#34495e', av: '🧑‍💼', objs: ['o1'] }],
    roles: [{ id: 'admin', n: 'Админ' }],
    objects: [{ id: 'o1', icon: '🛁', name: 'Баня Буханка', stages: [
      { id: 's1', n: 'ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЙ', c: '#e67e22', works: [
        // Процент назван человеком + фото и видео.
        { id: 'w1', n: 'Монтаж перегородок', cost: 10000, mats: [],
          timeLogs: [{ id: 'l1', userId: 'u1', date: D, hours: 7, pct: 40 }],
          photos: [{ id: 'p1', data: '/api/file/x' }, { id: 'p2', data: '/api/file/y' }],
          videos: [{ id: 'v1', messageId: 7, topicId: 5 }] },
        // Процент никто не называл — оценка по часам.
        { id: 'w2', n: 'Укладка лаг', cost: 8000, planHours: 10, mats: [],
          timeLogs: [{ id: 'l2', userId: 'u1', date: D, hours: 3 }] },
        // Закрыта — сотня.
        { id: 'w3', n: 'Аренда площадки', cost: 1000, done: true, doneBy: 'u1', doneAt: D + ' 12:00', mats: [],
          timeLogs: [{ id: 'l3', userId: 'u1', date: D, hours: 1 }] },
        // Ничего не делали — пусто, без нулей и полосок-обманок.
        { id: 'w4', n: 'Двери и окна', cost: 5000, mats: [], timeLogs: [] },
      ] },
    ] }],
    issues: [], templates: [], contractDocs: [], crmClients: [], purchases: [], purchased: {}, arrived: {},
    finTxns: [], receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {}, stock: [],
  })
  p.run('currentUser=users[0];tab="analysis";analysisObj="o1";')
  return p
}
const gantt = (p) => p.run('tBuildAnalysis()')
// Подпись одной работы: от её data-wid до конца ячейки.
const cell = (html, wid) => {
  const i = html.indexOf('data-wid="' + wid + '"')
  if (i < 0) return ''
  const start = html.lastIndexOf('<div', i)
  return html.slice(start, html.indexOf('</div></div>', i) + 12)
}

t.section('Готовность видна прямо в подписи')
{
  const h = gantt(panel())
  t.ok('названный процент — числом', cell(h, 'w1').indexOf('>40%<') >= 0, cell(h, 'w1'))
  t.ok('оценка по часам помечена «~»', cell(h, 'w2').indexOf('~30%') >= 0, cell(h, 'w2'))
  t.ok('у нетронутой работы ни процента, ни полоски', cell(h, 'w4').indexOf('%') < 0, cell(h, 'w4'))
  t.ok('часы остались на месте', cell(h, 'w1').indexOf('7 ч') >= 0)
}

t.section('Сотня выделяется')
{
  const h = gantt(panel())
  const done = cell(h, 'w3')
  t.ok('подпись говорит «✓ 100%»', done.indexOf('✓ 100%') >= 0, done)
  t.ok('строка подсвечена зелёным', done.indexOf('#27ae60') >= 0)
  t.ok('у незакрытой работы такой подписи нет', cell(h, 'w1').indexOf('✓ 100%') < 0)
  // Белая клетка дня закрашивала бы подсветку обратно.
  t.ok('клетки дней не забивают фон белым', h.indexOf(':"#fff")') < 0)
}

t.section('Видно, где есть фотоотчёт')
{
  const h = gantt(panel())
  t.ok('счётчик фото', cell(h, 'w1').indexOf('📷2') >= 0, cell(h, 'w1'))
  t.ok('счётчик видео', cell(h, 'w1').indexOf('🎬1') >= 0)
  t.ok('без медиа значков нет', cell(h, 'w2').indexOf('📷') < 0 && cell(h, 'w2').indexOf('🎬') < 0)
}

t.section('Тап по работе уводит к её фото')
{
  const p = panel()
  const h = gantt(p)
  t.ok('подпись кликабельна', /data-a="gantt-work-open"[^>]*data-wid="w1"/.test(h))
  const n = p.dom.node({ a: 'gantt-work-open', oid: 'o1', sid: 's1', wid: 'w3' })
  p.run('bind();')
  n.onclick({ stopPropagation () {}, preventDefault () {} })
  t.ok('перешли на объекты', p.q('tab') === 'assign' && p.q('openObject') === 'o1')
  t.ok('режим приёмки — там живут фото', p.q('objWorkView') === 'receive')
  t.ok('блок фото раскрыт на нужной работе', p.q('openPhotoWid') === 'w3')
  t.ok('этап развёрнут', p.q('objStageOpen.s1') === true)
  t.ok('и «сделанные» тоже — иначе сотня спрятана', p.q('objDoneOpen.s1') === true)
  t.ok('есть куда прокрутить', p.run('tObjects()').indexOf('id="work-w3"') >= 0)
}

t.section('Выбор объекта свёрнут')
{
  const p = panel()
  p.run('objects.push({id:"o2",icon:"\u{1F3E0}",name:"Дом СВО",stages:[]});')
  const h = gantt(p)
  t.ok('вместо ряда чипов — одна строка', h.indexOf('analysis-objs-toggle') >= 0)
  t.ok('в ней виден выбранный объект', h.indexOf('Баня Буханка') >= 0)
  t.ok('и сколько всего объектов', h.indexOf('сменить · 2') >= 0)
  t.ok('чипов пока нет', h.indexOf('data-a="analysis-obj"') < 0)
  const n = p.dom.node({ a: 'analysis-objs-toggle' })
  p.run('bind();')
  n.onclick({ stopPropagation () {}, preventDefault () {} })
  t.ok('раскрылось', p.q('analysisObjsOpen') === true)
  const open = gantt(p)
  t.ok('появились все объекты', (open.match(/data-a="analysis-obj"/g) || []).length === 2)
  t.ok('и кнопка предлагает свернуть', open.indexOf('свернуть') >= 0)
  const pick = p.dom.node({ a: 'analysis-obj', oid: 'o2' })
  p.run('bind();')
  pick.onclick({ stopPropagation () {}, preventDefault () {} })
  t.ok('выбор объекта сам сворачивает список', p.q('analysisObjsOpen') === false && p.q('analysisObjId') === 'o2')
}

t.section('Работа закрыта позже последних часов — ✓ и фото в день закрытия')
{
  // Живой случай (21.09): час на «Разводку электрики» записали 14-го, а закрыли
  // её с семью фото 21-го без часов. Гант ставил ✓ на 14-е, фото — только
  // счётчиком в подписи, и в колонке «сегодня» работы не было вовсе.
  const p = panel()
  p.run('objects[0].stages[0].works.push({id:"w5",n:"Разводка электрики",cost:1000,mats:[],done:true,doneBy:"u1",doneAt:"2026-09-21 13:30",' +
    'timeLogs:[{id:"l5",userId:"u1",date:"2026-09-14",hours:1}],' +
    'photos:[{id:"p5",data:"/api/file/a",date:"2026-09-21 13:26"},{id:"p6",data:"/api/file/b",date:"2026-09-21 13:27"}],' +
    'videos:[{id:"v5",messageId:9,topicId:5,date:"2026-09-18 12:00"}]});')
  const h = gantt(p)
  const row = h.slice(h.indexOf('data-wid="w5"'), h.indexOf('data-wid="w5"') + 20000)
  const day = (d) => { const i = row.indexOf('data-day="' + d + '"'); return i < 0 ? '' : row.slice(i, row.indexOf('data-day=', i + 10)) }
  t.ok('✓ стоит в день закрытия', day('2026-09-21').indexOf('✓') >= 0, day('2026-09-21'))
  t.ok('а не в день часов', day('2026-09-14').indexOf('✓') < 0, day('2026-09-14'))
  t.ok('часы остались в своём дне', day('2026-09-14').indexOf('>1<') >= 0, day('2026-09-14'))
  t.ok('фото видны в день съёмки', day('2026-09-21').indexOf('📷2') >= 0, day('2026-09-21'))
  t.ok('кнопка фото открывает галерею с первого фото дня', /data-a="media-open"[^>]*data-wid="w5"[^>]*data-i="0"/.test(day('2026-09-21')))
  t.ok('видео — в свой день, индекс после фото', day('2026-09-18').indexOf('🎬1') >= 0 && day('2026-09-18').indexOf('data-i="2"') >= 0, day('2026-09-18'))
}

t.section('Один объект — никакого переключателя')
{
  const h = gantt(panel())
  t.ok('лишней строки нет', h.indexOf('analysis-objs-toggle') < 0)
}

t.done()
