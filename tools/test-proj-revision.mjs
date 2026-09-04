#!/usr/bin/env node
// «В проекте изменилось» — версия проекта вместо копии (src/projrev.js + панель).
//
// Объект собран из проекта и обязан от него отличаться: на стройке появляются
// часы, фото и докупка. Поэтому сравниваем через третьего участника — слепок
// состава на момент сборки. Сторожим главное: что правка проекта доезжает до
// стройки, что след работы бригады при этом не стирается и что спорную правку
// портал не применяет молча.
import { projDiff, projBaseline, sigOf, workTouched } from '../src/projrev.js'
import { positionWork } from '../src/recipe.js'
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана', mode: 'm2' },
  { id: 'p_sock', name: 'Розетка', unitCost: 300, store: 'Белка', mode: 'piece' },
]
const EST = [
  { id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2, lines: [{ pid: 'p_osb', qty: 1 }] },
  { id: 'e_win', kind: 'house', name: 'Монтаж окна', stage: 2, optPoint: 'win', lines: [{ pid: 'p_sock', qty: 1 }] },
]
const RULES = [{ id: 'r_wall', kind: 'house', estId: 'e_osb', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 0 }]

const POS = (key, name, qty) => ({ key: key, estId: 'e_osb', name: name, room: '', stage: 2,
  mats: [{ pid: 'p_osb', n: 'ОСП 9 мм', mode: 'm2', cost: 1000, qty: qty }] })
const objOf = (positions, base) => ({
  id: 'o1', projBase: base,
  stages: [{ id: 's1', n: 'ЭТАП 2', works: positions.map(function (p, i) {
    return Object.assign(positionWork(p), { id: 'w' + i, timeLogs: [] })
  }) }],
})

// ── 1. Три стороны сравнения ────────────────────────────────────────────────
{
  t.section('Трёхстороннее сравнение')
  const was = [POS('a', 'Стены', 10), POS('b', 'Пол', 5)]
  const base = projBaseline(was, '2026-09-01')
  t.ok('слепок — подписи, а не содержимое', Object.keys(base.sig).join(',') === 'a,b' && base.sig.a.length <= 8)

  // Ничего не менялось.
  t.ok('тишина, когда всё совпадает', projDiff(was, objOf(was, base)).items.length === 0)

  // Правил только проект.
  const now = [POS('a', 'Стены', 12), POS('b', 'Пол', 5)]
  const d = projDiff(now, objOf(was, base))
  t.ok('одна правка', d.items.length === 1 && d.items[0].key === 'a')
  t.ok('это изменение', d.items[0].kind === 'changed')
  t.ok('и она безопасна', d.items[0].safe === true)
  t.ok('видно новую цену', d.items[0].proj.w.cost === 12000)

  // Правили с двух сторон — решает человек.
  const objChanged = objOf(was, base)
  objChanged.stages[0].works[0].cost = 7000
  const d2 = projDiff(now, objChanged)
  t.ok('спорная правка помечена', d2.items[0].safe === false)
  t.ok('и в счётчик безопасных не попала', d2.safe === 0 && d2.total === 1)
}

// ── 2. Появилось и исчезло ──────────────────────────────────────────────────
{
  t.section('Позиция появилась или исчезла')
  const was = [POS('a', 'Стены', 10)]
  const base = projBaseline(was, '2026-09-01')

  const added = projDiff(was.concat([POS('c', 'Потолок', 4)]), objOf(was, base))
  t.ok('новая позиция видна', added.items.length === 1 && added.items[0].kind === 'added')
  t.ok('и принять её можно молча', added.items[0].safe === true)

  const removed = projDiff([], objOf(was, base))
  t.ok('исчезнувшая видна', removed.items.length === 1 && removed.items[0].kind === 'removed')
  t.ok('и убрать её можно', removed.items[0].safe === true)

  // След работы бригады убирать нельзя, даже если в проекте позиции больше нет.
  const worked = objOf(was, base)
  worked.stages[0].works[0].timeLogs = [{ h: 6, by: 'u1' }]
  const stuck = projDiff([], worked)
  t.ok('работа с часами не убирается молча', stuck.items[0].safe === false)
  t.ok('и портал знает почему', workTouched(worked.stages[0].works[0]) === true)

  // Работу, удалённую из объекта руками, проект не воскрешает.
  const dropped = objOf([], base)
  t.ok('удалённую в объекте не воскрешаем', projDiff([POS('a', 'Стены', 12)], dropped).items.length === 0)
}

// ── 3. Без слепка ───────────────────────────────────────────────────────────
{
  t.section('Объект без слепка')
  const d = projDiff([POS('a', 'Стены', 10)], { id: 'o', stages: [] })
  t.ok('сравнивать не с чем — и об этом сказано', d.noBase === true && d.items.length === 0)
  t.ok('подпись не зависит от часов и фото',
    sigOf({ n: 'Стены', cost: 100, mats: [] }) === sigOf({ n: 'Стены', cost: 100, mats: [], doneAt: '2026-01-01', timeLogs: [1] }))
}

// ── 4. Панель: чертёж поехал — стройка узнала ───────────────────────────────
{
  t.section('Правка чертежа доезжает до стройки')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], projects: [], buildRules: RULES,
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30 },
  })
  // Проект → объект.
  p.run('tab="projects";tProjects();')
  const nb = p.dom.node({ a: 'proj-new' }); p.run('bind();'); nb.onclick()
  p.dom.field('proj-n-name', 'Дом'); p.dom.field('proj-n-client', '')
  p.run('tProjects();')
  const cb = p.dom.node({ a: 'proj-create' }); p.run('bind();'); cb.onclick()
  const pid = p.q('projects[0].id')
  p.run('projBand="money";tProjects();')
  const ob = p.dom.node({ a: 'spec-to-object', id: pid }); p.run('bind();'); ob.onclick()
  t.ok('объект собран', p.q('objects.length') === 1)
  t.ok('слепок записан', p.q('!!(objects[0].projBase&&objects[0].projBase.sig)') === true)
  t.ok('у работ есть адрес позиции', p.q('objects[0].stages[0].works.every(function(w){return !!w.posKey;})') === true)
  t.ok('сразу после сборки расхождений нет', p.q('objProjDiff(objects[0]).items.length') === 0)

  // Двигаем перегородку — площади поехали, а стройка идёт по старым числам.
  p.run('var pr=projects[0]; pr.model=moveBoundary(pr.model,0,600,winTypes); modelSync(pr);')
  const n = p.q('objProjDiff(objects[0]).items.length')
  t.ok('стройка увидела расхождение', n > 0, 'позиций: ' + n)
  t.ok('и все правки безопасны', p.q('objProjDiff(objects[0]).safe') === n)
  const band = p.run('tab="projects";projOpenId=projects[0].id;projBand="build";tProjects()')
  t.ok('видно в полосе «Стройка»', /В ПРОЕКТЕ ИЗМЕНИЛОСЬ/.test(band))
  t.ok('и есть чем принять', band.indexOf('data-a="obj-proj-apply-safe"') >= 0)

  // Принимаем безопасные — план переехал, слепок сдвинулся.
  // Перенос границы отдаёт метры соседу: сумма по дому может и не измениться,
  // а вот работы по каждому помещению — обязаны.
  const byWork = () => p.q('objects[0].stages[0].works.map(function(w){return Math.round(Number(w.cost)||0);}).join(",")')
  const before = byWork()
  const btn = p.dom.node({ a: 'obj-proj-apply-safe', oid: p.q('objects[0].id') })
  p.run('bind();'); btn.onclick()
  t.ok('работы поехали за чертежом', byWork() !== before, before + ' → ' + byWork())
  t.ok('расхождений не осталось', p.q('objProjDiff(objects[0]).items.length') === 0)
  const costAfter = p.q('objects[0].stages.reduce(function(a,s){return a+s.works.reduce(function(b,w){return b+Math.round(Number(w.cost)||0);},0);},0)')
  t.ok('и объект стоит ровно как проект',
    costAfter === p.q('works2(projects[0], specCtx(projects[0])).cost'), 'объект ' + costAfter)

  // Часы бригады принятая правка не стирает.
  p.run('objects[0].stages[0].works[0].timeLogs=[{h:6,by:"u1"}];objects[0].stages[0].works[0].doneAt="2026-09-01T12:00";')
  p.run('var pr=projects[0]; pr.model=moveBoundary(pr.model,0,-400,winTypes); modelSync(pr);')
  t.ok('расхождение снова видно', p.q('objProjDiff(objects[0]).items.length') > 0)
  const btn2 = p.dom.node({ a: 'obj-proj-apply-safe', oid: p.q('objects[0].id') })
  p.run('bind();'); btn2.onclick()
  t.ok('часы на месте', p.q('objects[0].stages[0].works[0].timeLogs.length') === 1)
  t.ok('отметка «выполнено» на месте', p.q('!!objects[0].stages[0].works[0].doneAt') === true)
  t.ok('id работы не менялся', p.q('objects[0].stages[0].works[0].id.length') > 0)

  // Объект из боевой спецификации баннера не получает: там своя цепочка.
  p.run('specSheets=[{id:"war",name:"Боевая",kind:"house",markup:30,specs:{height:2.5,rooms:[]},rooms:{},global:{},qty:{}}];objects=objects.concat([{id:"o2",name:"Боевой",specId:"war",stages:[]}]);')
  t.ok('у боевой спецификации баннера нет', p.q('objProjDiff(objects.find(function(o){return o.id==="o2";}))') === null)
}

// ── 5. Цена бригаде переезжает на стройку вместе с планом ────────────────────
// Оплата работы — это договорённость с бригадой, а не следствие сметы. Принятая
// правка чертежа обязана перенести её вместе с ценой: `cost` без своей половины
// при следующей загрузке пересчитается по материалам и сотрёт согласованную цифру.
{
  t.section('Цена бригаде и правка чертежа')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], projects: [], buildRules: RULES,
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30 },
  })
  p.run('tab="projects";tProjects();')
  const nb = p.dom.node({ a: 'proj-new' }); p.run('bind();'); nb.onclick()
  p.dom.field('proj-n-name', 'Дом с бригадой'); p.dom.field('proj-n-client', '')
  p.run('tProjects();')
  const cb = p.dom.node({ a: 'proj-create' }); p.run('bind();'); cb.onclick()
  const pid = p.q('projects[0].id')

  // Цена назначается там же, где смета, — в полосе «Состав».
  p.run('projBand="parts";tProjects();')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const inp = p.dom.node({ a: 'est-pos-cost', k: key })
  p.run('bind();'); inp.value = '25000'; inp.onchange()
  t.ok('цена записана как оплата работы', p.q('projects[0].posCostMode[' + JSON.stringify(key) + ']') === 'labor')

  p.run('projBand="money";tProjects();')
  const ob = p.dom.node({ a: 'spec-to-object', id: pid }); p.run('bind();'); ob.onclick()
  const work = () => p.q('objects[0].stages.reduce(function(a,s){return a.concat(s.works||[]);},[]).filter(function(w){return w.posKey===' + JSON.stringify(key) + ';})[0]')
  const w0 = work()
  t.ok('на стройку уехала и оплата работы', w0 && Number(w0.labor) === 25000, JSON.stringify(w0 && w0.labor))
  const mats0 = (w0.mats || []).reduce((a, m) => a + (Number(m.cost) || 0) * (Number(m.qty) || 0), 0)
  t.ok('а цена работы — материалы плюс она', Math.round(w0.cost) === Math.round(mats0) + 25000, String(w0.cost))

  // Чертёж поехал — принимаем правку.
  p.run('var pr=projects[0]; pr.model=moveBoundary(pr.model,0,600,winTypes); modelSync(pr);')
  t.ok('стройка увидела расхождение', p.q('objProjDiff(objects[0]).items.length') > 0)
  const btn = p.dom.node({ a: 'obj-proj-apply-safe', oid: p.q('objects[0].id') })
  p.run('bind();'); btn.onclick()
  const w1 = work()
  t.ok('оплата работы пережила принятие', Number(w1.labor) === 25000, String(w1 && w1.labor))
  const mats1 = (w1.mats || []).reduce((a, m) => a + (Number(m.cost) || 0) * (Number(m.qty) || 0), 0)
  t.ok('и цена по-прежнему «материалы + работа»', Math.round(w1.cost) === Math.round(mats1) + 25000, String(w1.cost))

  // Загрузка пересчитывает цены — и обязана оставить договорённость в покое.
  const was = Math.round(w1.cost)
  p.run('normalizeWorkCosts();')
  t.ok('загрузка ничего не сбросила', Math.round(work().cost) === was, String(work().cost))
  t.ok('расхождений не осталось', p.q('objProjDiff(objects[0]).items.length') === 0)

  // Переторговались с бригадой — новая цена обязана доехать целиком. Возьми
  // объект только `cost`, и пересчёт при загрузке вернул бы старую цифру.
  p.run('projBand="parts";tProjects();')
  const inp2 = p.dom.node({ a: 'est-pos-cost', k: key })
  p.run('bind();'); inp2.value = '40000'; inp2.onchange()
  t.ok('стройка увидела новую цену', p.q('objProjDiff(objects[0]).items.length') > 0)
  const btn2 = p.dom.node({ a: 'obj-proj-apply-safe', oid: p.q('objects[0].id') })
  p.run('bind();'); btn2.onclick()
  t.ok('новая оплата работы на стройке', Number(work().labor) === 40000, String(work().labor))
  const mats2 = (work().mats || []).reduce((a, m) => a + (Number(m.cost) || 0) * (Number(m.qty) || 0), 0)
  p.run('normalizeWorkCosts();')
  t.ok('и загрузка её не откатила', Math.round(work().cost) === Math.round(mats2) + 40000, String(work().cost))

  // Подряд под ключ — второй смысл того же числа, и он тоже должен доехать.
  p.run('projBand="parts";tProjects();')
  const chip = p.dom.node({ a: 'est-pos-cost-mode', k: key })
  p.run('bind();'); chip.onclick()
  const btn3 = p.dom.node({ a: 'obj-proj-apply-safe', oid: p.q('objects[0].id') })
  p.run('bind();'); btn3.onclick()
  t.ok('на стройке работа под ключ', work().costAll === true)
  p.run('normalizeWorkCosts();')
  t.ok('и цена под ключ — ровно та, что назвали', Math.round(work().cost) === 40000, String(work().cost))
  t.ok('материалы при этом на месте', (work().mats || []).length > 0)
}

t.done()
