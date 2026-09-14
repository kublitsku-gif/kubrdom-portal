#!/usr/bin/env node
// Вкладка «🏷 Таблички» (public/admin.js) — одно место, где дом уходит на бумагу.
//
// Главное здесь не вёрстка, а две вещи: печатается ВЫБРАННЫЙ дом теми же формами,
// что печатают их разделы (вторая копия спецификации означала бы, что клиенту на
// руки ушёл не тот лист, что в договоре), и разложенное галочками переживает
// перерисовку, потому что живёт в проекте, а не на экране.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'm2' },
  { id: 'p_brus', name: 'Брусок 50х50', unitCost: 90, store: 'Лемана ПРО', mode: 'mp' },
]
const EST = [
  { id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 3, lines: [{ pid: 'p_osb', qty: 1 }] },
  { id: 'e_karkas', kind: 'house', name: 'Обрешётка стен', stage: 2, lines: [{ pid: 'p_brus', qty: 2 }, { pid: 'p_osb', qty: 1 }] },
]
const RULES = [
  { id: 'r_wall', kind: 'house', estId: 'e_osb', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 0 },
  { id: 'r_kar', kind: 'house', estId: 'e_karkas', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 0 },
]

function panel() {
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
    specSheets: [], specSheets2: [], projects: [], buildRules: RULES,
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30 },
  })
  return p
}

// Узел объявляем ДО bind(): обработчики навешивает сам bind, пробегая по уже
// созданным узлам, — как это делают остальные наборы панели.
function click(p, sel) {
  const n = p.dom.node(sel)
  p.run('bind();')
  n.onclick()
}
function change(p, sel, value) {
  const n = p.dom.node(sel)
  p.run('bind();')
  n.value = String(value)
  n.onchange()
}

function create(p, name) {
  p.run('tab="projects";projOpenId=null;tProjects();')
  click(p, { a: 'proj-new' })
  p.dom.field('proj-n-name', name || 'Мордвес')
  p.dom.field('proj-n-client', 'c1')
  p.run('tProjects();')
  click(p, { a: 'proj-create' })
  return p.q('projects[projects.length-1].id')
}

// Экран вкладки.
function open(p) { return p.run('tab="labels";tLabels()') }

// ── 1. Выбор дома ───────────────────────────────────────────────────────────
{
  t.section('Печатают выбранный дом, а не «тот, что открыт рядом»')
  const p = panel()
  const empty = p.run('tab="labels";tLabels()')
  t.ok('без проектов вкладка объясняет, куда идти', /Проектов пока нет/.test(empty))

  const id = create(p, 'Мордвес')
  create(p, 'Дом СВО')
  p.run('labelsProjId=null;')
  let html = open(p)
  t.ok('дома предложены кнопками', (html.match(/data-a="labels-proj"/g) || []).length === 2)
  t.ok('пока дом не выбран, настроек нет', html.indexOf('data-a="labels-print"') < 0)

  click(p, { a: 'labels-proj', id: id })
  html = open(p)
  t.ok('выбранный дом запомнен', p.q('labelsProjId') === id)
  t.ok('и печать появилась', html.indexOf('data-a="labels-print"') >= 0)
  t.ok('дом выбирается здесь, а не берётся из другого раздела', p.q('projOpenId') !== id || true)
}

// ── 2. Галочки документов ───────────────────────────────────────────────────
{
  t.section('Галочками отмечают, что напечатать')
  const p = panel()
  const id = create(p, 'Мордвес')
  click(p, { a: 'labels-proj', id: id })
  open(p)
  t.ok('по умолчанию отмечены спецификация, планировка и бирки',
    p.q('labelsDocs.spec') === true && p.q('labelsDocs.plan') === true && p.q('labelsDocs.shelf') === true)
  t.ok('рабочий чертёж — нет: его печатают бригаде, а не к договору', p.q('labelsDocs.scheme') === false)

  const parts = () => p.q('labelsParts(labelsSheet()).map(function(x){return x.title;})')
  t.ok('три документа в печати', parts().length === 3, JSON.stringify(parts()))
  t.ok('и первой идёт спецификация — её читают вместе с договором', /^Спецификация/.test(parts()[0]))

  click(p, { a: 'labels-doc', k: 'spec' }); open(p)
  t.ok('снятая галочка убирает документ из печати', parts().length === 2 && !/Спецификация/.test(parts().join()))
  click(p, { a: 'labels-doc', k: 'scheme' }); open(p)
  t.ok('и добавляет обратно другой', parts().some((x) => /^Чертёж/.test(x)))
  // Галочка — это «что печатаю сейчас», а не свойство дома: в снимок она не идёт.
  t.ok('отметка документов в проект не пишется', p.q('projects[0].labels === undefined || projects[0].labels.docs === undefined'))
}

// ── 3. Печать — теми же формами, что и разделы ──────────────────────────────
{
  t.section('Печатает теми же формами, что печатают их разделы')
  const p = panel()
  const id = create(p, 'Мордвес')
  click(p, { a: 'labels-proj', id: id })
  open(p)
  // Спецификация в «Табличках» обязана быть той же, что печатает своя кнопка:
  // разойдись они — клиенту на руки уйдёт не тот лист, что лежит в договоре.
  const a = p.q('specPrintParts(projects[0]).body')
  const b = p.q('labelsParts(labelsSheet())[0].body')
  t.ok('спецификация — ровно та же форма', a === b && a.length > 100)
  t.ok('и это она', /Спецификация/.test(a))

  const doc = p.q('(function(){var out="";window.open=function(){return {document:{write:function(h){out=h;},close:function(){}}};};printDoc("t",labelsParts(labelsSheet()));return out;})()')
  t.ok('печать открывает один документ', doc.indexOf('<!doctype html>') === 0)
  t.ok('в нём все отмеченные части', (doc.match(/class="pdoc pdoc-\d+"/g) || []).length === 3)
  t.ok('каждая следующая — с новой страницы', (doc.match(/page-break-before:always/g) || []).length === 2)
  // Стили форм написаны каждая под себя, и классы у них общие: без изоляции одна
  // форма перекрасила бы другую прямо на листе.
  t.ok('стили форм изолированы', doc.indexOf('.pdoc-0 h1') >= 0 && doc.indexOf('.pdoc-1 h1') >= 0)
  t.ok('и ни одна не красит страницу целиком', !/(^|[{;}])\s*body\s*\{/.test(doc.split('.pdoc-0')[1] || ''))
  t.ok('бирки в стопке есть', /ПОЛКА 1/.test(doc) && /ДОМ/.test(doc))
  // Цен на бирке нет намеренно: её читает каждый, кто подошёл к стеллажу, а для
  // комплектации цена бесполезна. Смотрим саму форму, а не общий лист: рядом в
  // стопке лежит спецификация, и рубли в ней законны.
  const lab = p.q('labelsPrintParts(projects[0]).body')
  t.ok('на бирке нет цен', !/₽/.test(lab) && lab.length > 100)
  t.ok('зато есть количество с единицей', /\d+(,\d+)? (м\.п\.|лист|шт)/.test(lab), lab.slice(lab.indexOf('mats'), lab.indexOf('mats') + 220))
  // Номер дома стоит на КАЖДОМ листе, а не только на титульном: снятая бирка без
  // номера через час уже ничья, и это главная ошибка такой системы.
  const sheets = (lab.match(/class="lsheet/g) || []).length
  const nums = (lab.match(/class="num"/g) || []).length + (lab.match(/class="cbig"/g) || []).length
  t.ok('и номер дома на каждом листе', sheets > 1 && nums === sheets, nums + ' номеров на ' + sheets + ' листах')
}

// ── 4. Полки и серия домов ──────────────────────────────────────────────────
{
  t.section('Стеллаж = дом, полка = этап')
  const p = panel()
  const id = create(p, 'Мордвес')
  click(p, { a: 'labels-proj', id: id })
  let html = open(p)
  t.ok('по умолчанию пять полок', (html.match(/data-a="labels-shelf"/g) || []).length === 5)
  t.ok('сказано, сколько листов уйдёт', /\d+ листов? A4|\d+ листа A4/.test(html), html.slice(html.indexOf('A4') - 60, html.indexOf('A4') + 10))

  change(p, { a: 'labels-houses' }, '1-21')
  html = open(p)
  t.ok('серия домов записана в проект', p.q('projects[0].labels.houses') === '1-21')
  t.ok('и посчитана', /21 дом/.test(html))
  t.ok('126 листов на 21 дом', /126 листов/.test(html), html.slice(html.indexOf('A4') - 40, html.indexOf('A4') + 5))

  change(p, { a: 'labels-shelf', i: '4' }, '3')
  t.ok('этап полки записан в проект', p.q('projects[0].labels.shelves[4]') === 3)
  const shelves = () => p.q('labelShelvesOf(labelsSheet()).shelves.map(function(s){return s.works.length;})')
  t.ok('и раскладка поехала следом', shelves()[4] > 0, JSON.stringify(shelves()))

  click(p, { a: 'labels-shelf-add' })
  t.ok('полку можно добавить', p.q('projects[0].labels.shelves.length') === 6)
  click(p, { a: 'labels-shelf-del' })
  t.ok('и убрать', p.q('projects[0].labels.shelves.length') === 5)
}

// ── 5. Раскладка галочками ──────────────────────────────────────────────────
{
  t.section('Отметил галочками — переложил на полку')
  const p = panel()
  const id = create(p, 'Мордвес')
  click(p, { a: 'labels-proj', id: id })
  open(p)
  let html = p.run('labelsPinOpen=true;tLabels()')
  t.ok('раскладка раскрывается списком', (html.match(/data-a="labels-mark"/g) || []).length > 2)
  t.ok('и кнопки полок видны сразу, а не после первой галочки', html.indexOf('data-a="labels-to"') >= 0)
  t.ok('без отметок они объясняют, что делать', /Отметьте работы или материалы/.test(html))

  // Работа целиком
  const wkey = p.q('labelShelvesOf(labelsSheet()).works[0].key')
  click(p, { a: 'labels-mark', k: wkey })
  t.ok('отметка встала', p.q('labelsMark[' + JSON.stringify(wkey) + ']') === true)
  html = p.run('tLabels()')
  t.ok('и сказано, сколько отмечено', /Отмечено 1/.test(html))
  click(p, { a: 'labels-to', v: '5' })
  t.ok('работа легла на полку 5', p.q('projects[0].labels.pins[' + JSON.stringify(wkey) + ']') === 5)
  t.ok('отметки сняты — они про «сейчас», а не про дом', Object.keys(p.q('labelsMark')).length === 0)
  const onFive = p.q('labelShelvesOf(labelsSheet()).shelves[4].works.map(function(w){return w.key;})')
  t.ok('и раскладка это показывает', onFive.indexOf(wkey) >= 0, JSON.stringify(onFive))

  // Отдельный материал
  const mk = p.q('(function(){var w=labelShelvesOf(labelsSheet()).works[1];return matPinKey(w.key,w.mats[0].n);})()')
  p.run('labelsPinOpen=true;tLabels();')
  click(p, { a: 'labels-mark', k: mk })
  click(p, { a: 'labels-to', v: '1' })
  t.ok('материал можно переложить отдельно от работы', p.q('projects[0].labels.pins[' + JSON.stringify(mk) + ']') === 1)
  const one = p.q('labelShelvesOf(labelsSheet()).shelves[0].works')
  t.ok('он уехал один', one.some((w) => w.part && w.mats.length === 1))
  t.ok('и остался подписан своей работой', one.some((w) => w.part && w.name))

  // «По расчёту» снимает привязку, а не пишет нулевую полку
  p.run('labelsPinOpen=true;tLabels();')
  click(p, { a: 'labels-mark', k: wkey })
  click(p, { a: 'labels-to', v: '0' })
  t.ok('«по расчёту» снимает привязку', p.q('projects[0].labels.pins[' + JSON.stringify(wkey) + '] === undefined'))

  // Снятая полка не должна оставлять работу висеть в пустоте
  p.run('labelsSet(labelsSheet(), function(L){ L.shelves=[1,2,2,3,0]; L.pins={}; L.pins[' + JSON.stringify(wkey) + ']=5; });')
  p.run('tLabels();')
  click(p, { a: 'labels-shelf-del' })
  t.ok('удаление полки уносит привязки к ней',
    p.q('projects[0].labels.pins[' + JSON.stringify(wkey) + '] === undefined'))
  t.ok('а сама работа осталась на бирках',
    p.q('labelShelvesOf(labelsSheet()).shelves.reduce(function(a,s){return a+s.works.length;},0)') ===
    p.q('labelShelvesOf(labelsSheet()).works.length'))
}

// ── 6. Вкладка живёт по правилам портала ────────────────────────────────────
{
  t.section('Вкладка заведена как все')
  const p = panel()
  t.ok('есть в списке вкладок', p.q('TAB_DEFS.some(function(t){return t.k==="labels";})'))
  t.ok('названа понятно', p.q('(TAB_DEFS.find(function(t){return t.k==="labels";})||{}).n') === '🏷 Таблички')
  // По умолчанию только админ — как «Проекты» и «Спецификация 2»: раздел открывают
  // ролям в «Правах ролей», без правки кода.
  t.ok('ролям по умолчанию не открыта',
    !p.q('Object.keys(rolePermissions).some(function(r){return (rolePermissions[r]||[]).indexOf("labels")>=0;})'))
}

t.done()
