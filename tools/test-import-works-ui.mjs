#!/usr/bin/env node
// «📋 Из проекта» на экране сметы (public/admin.js): кнопка, выбор источника,
// отметки, «взять» и «отменить». Сам перенос сторожит test-import-works.mjs —
// здесь то, что человек видит и нажимает.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'm2' },
  { id: 'p_pipe', name: 'Труба PP 20', unitCost: 55, store: 'Лемана ПРО', mode: 'mp', lenPer: 2 },
]
const EST = [
  { id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2, lines: [{ pid: 'p_osb', qty: 1 }] },
]
const WATER = 'Водоснабжение — полипропилен'

function panel() {
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
    specSheets: [], specSheets2: [], projects: [], buildRules: [],
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30 },
  })
  return p
}
// Создание так, как это делает человек: имя → заготовка → «Создать».
function create(p, name) {
  p.run('tab="projects";projOpenId=null;tProjects();')
  const btn = p.dom.node({ a: 'proj-new' })
  p.run('bind();')
  btn.onclick()
  p.dom.field('proj-n-name', name)
  p.dom.field('proj-n-client', 'c1')
  p.run('tProjects();')
  const go = p.dom.node({ a: 'proj-create' })
  p.run('bind();')
  go.onclick()
  p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};')
}
const byName = (name) => 'projects.filter(function(x){return x.name===' + JSON.stringify(name) + ';})[0]'
const click = (p, attrs) => { const n = p.dom.node(attrs); p.run('bind();'); n.onclick() }

// Источник — дом, где к своей работе уже подобраны трубы (так «Водоснабжение»
// живёт в боевом «Мордвес 1»), и новый дом, открытый на экране.
function setup() {
  const p = panel()
  create(p, 'Источник')
  p.run('var s=' + byName('Источник') + ';' +
    's.posAdd=[{id:"w1",name:' + JSON.stringify(WATER) + ',cost:15000,stage:3}];' +
    's.matAdd={"add:w1":[{id:"m1",pid:"p_pipe",n:"Труба PP 20",store:"Лемана ПРО",mode:"mp",cost:55,qty:13,unitCost:55,lenPer:2}]};' +
    's.posHours={"add:w1":8};')
  create(p, 'Новый дом')
  p.run('projBand="parts";')
  return { p, srcId: p.q(byName('Источник') + '.id'), newId: p.q(byName('Новый дом') + '.id') }
}

// ── 1. Взять из тулбара ─────────────────────────────────────────────────────
{
  t.section('Взять работы из проекта')
  const { p, srcId, newId } = setup()
  t.ok('кнопка «📋 Из проекта» есть', p.run('tProjects()').indexOf('data-a="est-import-open"') >= 0)
  click(p, { a: 'est-import-open' })
  let html = p.run('tProjects()')
  t.ok('панель открылась', /ВЗЯТЬ РАБОТЫ ИЗ ДРУГОГО ПРОЕКТА/.test(html))
  t.ok('источник в списке', html.indexOf('data-a="est-import-src" data-id="' + srcId + '"') >= 0)
  t.ok('открытого дома в списке нет', html.indexOf('data-a="est-import-src" data-id="' + newId + '"') < 0)

  click(p, { a: 'est-import-src', id: srcId })
  html = p.run('tProjects()')
  t.ok('работы источника показаны', html.indexOf(WATER) >= 0)
  t.ok('обшивка помечена «уже есть»', /эта работа справочника в доме уже есть/.test(html))
  t.ok('новое отмечено само, «уже есть» — нет', /Взять 1 работу/.test(html), (html.match(/Взять[^<]*/) || [''])[0])

  click(p, { a: 'est-import-do' })
  const took = p.q('(' + byName('Новый дом') + '.posAdd||[]).filter(function(r){return r.name===' + JSON.stringify(WATER) + ';})')
  t.ok('работа встала в новый дом', took.length === 1, JSON.stringify(took))
  t.ok('и помнит источник', took[0] && took[0].from && took[0].from.p === srcId)
  const cost = p.q('(function(){var s=' + byName('Новый дом') + ';var w=works2(s,Object.assign(specCtx(s),{winTypes:winTypes}));' +
    'var r=w.positions.filter(function(x){return x.name===' + JSON.stringify(WATER) + ';})[0];return r?r.cost:-1;})()')
  t.ok('со своими деньгами: работа + трубы', cost === 15000 + 55 * 13, String(cost))
  html = p.run('tProjects()')
  t.ok('панель закрылась', !/ВЗЯТЬ РАБОТЫ ИЗ ДРУГОГО ПРОЕКТА/.test(html))
  t.ok('перенос можно отменить одним нажатием', /Отменить работы из «Источник»/.test(html))
  t.ok('источник не тронут', p.q(byName('Источник') + '.matAdd["add:w1"][0].id') === 'm1')

  click(p, { a: 'est-undo' })
  t.ok('отмена убрала взятую работу', p.q('(' + byName('Новый дом') + '.posAdd||[]).length') === 0)
  t.ok('и её материалы тоже', p.q('Object.keys(' + byName('Новый дом') + '.matAdd||{}).length') === 0)
  t.ok('и её часы', p.q('Object.keys(' + byName('Новый дом') + '.posHours||{}).length') === 0)
}

// ── 2. Из формы «+ работа» — сразу нужный этап ──────────────────────────────
{
  t.section('Из формы «+ работа»')
  const { p, srcId, newId } = setup()
  click(p, { a: 'est-pos-add-open', k: newId + '@2|' })
  let html = p.run('tProjects()')
  t.ok('в форме есть «взять из проекта» с этапом формы', html.indexOf('data-a="est-import-open" data-st="2"') >= 0)
  click(p, { a: 'est-import-open', st: '2' })
  click(p, { a: 'est-import-src', id: srcId })
  html = p.run('tProjects()')
  t.ok('форма «+ работа» закрылась', html.indexOf('data-a="est-pos-add-do"') < 0)
  t.ok('водоснабжение этапа 3 не показано', html.indexOf('data-a="est-import-pick" data-k="add:w1"') < 0)
  t.ok('на этапе 2 новых нет — брать нечего', /Отметьте работы/.test(html))
  click(p, { a: 'est-import-stage', n: '' })
  html = p.run('tProjects()')
  t.ok('«все этапы» показывают и его', html.indexOf('data-a="est-import-pick" data-k="add:w1"') >= 0)
  t.ok('и отмечают заново', /Взять 1 работу/.test(html))
  click(p, { a: 'est-import-close' })
  t.ok('✕ закрывает панель', !/ВЗЯТЬ РАБОТЫ ИЗ ДРУГОГО ПРОЕКТА/.test(p.run('tProjects()')))
  t.ok('и ничего не пишет', p.q('(' + byName('Новый дом') + '.posAdd||[]).length') === 0)
}

// ── 3. Отметки ──────────────────────────────────────────────────────────────
{
  t.section('Отметки')
  const { p, srcId } = setup()
  click(p, { a: 'est-import-open' })
  click(p, { a: 'est-import-src', id: srcId })
  click(p, { a: 'est-import-pick', k: 'add:w1' })
  t.ok('снятая отметка — брать нечего', /Отметьте работы/.test(p.run('tProjects()')))
  click(p, { a: 'est-import-do' })
  t.ok('пустое «взять» ничего не пишет', p.q('(' + byName('Новый дом') + '.posAdd||[]).length') === 0)
  click(p, { a: 'est-import-all' })
  t.ok('«отметить новые» отмечает', /Взять 1 работу/.test(p.run('tProjects()')))
  click(p, { a: 'est-import-all' })
  t.ok('второе нажатие снимает', /Отметьте работы/.test(p.run('tProjects()')))
}

t.done()
