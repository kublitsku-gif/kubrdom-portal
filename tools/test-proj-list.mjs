#!/usr/bin/env node
// Список и шапка проектов: следующий шаг, итог в шапке, правки не в объекте,
// поиск/фильтр/копия, база норма-часа за вопросом и память посчитанного.
import { boot, reporter } from './harness/panel-vm.js'
import { projSteps, projFilterOk, projQueryOk, clientsMatching, projCopy } from '../src/proj-status.js'

const t = reporter()

// ── 1. Чистая логика ────────────────────────────────────────────────────────
{
  t.section('Шаги проекта')
  const s0 = projSteps({})
  t.ok('пустой проект — шаг 1, чертить', s0.next.n === 1 && s0.next.label === 'Начертить дом' && s0.next.band === 'plan')
  t.ok('у квартиры — внести помещения', projSteps({ isFlat: true }).next.label === 'Внести помещения')
  const s2 = projSteps({ floor: 30, count: 12 })
  t.ok('есть состав без цены — шаг 3', s2.next.n === 3 && s2.next.band === 'parts')
  const s4 = projSteps({ floor: 30, count: 12, price: 100 })
  t.ok('есть цена — создать объект на «Деньгах»', s4.next.label === 'Создать объект' && s4.next.band === 'money')
  const s5 = projSteps({ floor: 30, count: 12, price: 100, hasObj: true })
  t.ok('есть объект — завести договор', s5.next.label === 'Завести договор' && s5.doneN === 4)
  t.ok('всё сделано — следующего шага нет', projSteps({ floor: 1, count: 1, price: 1, hasObj: true, hasContract: true }).next === null)

  t.section('Фильтры и поиск')
  t.ok('без договора', projFilterOk({ hasContract: false }, 'nocontract') && !projFilterOk({ hasContract: true }, 'nocontract'))
  t.ok('цены отстали', projFilterOk({ priceState: 'stale' }, 'stale') && !projFilterOk({ priceState: 'ok' }, 'stale'))
  t.ok('правки не в объекте', projFilterOk({ diffN: 2 }, 'diff') && !projFilterOk({ diffN: 0 }, 'diff'))
  t.ok('в стройке', projFilterOk({ hasObj: true }, 'build') && !projFilterOk({}, 'build'))
  t.ok('ё = е', projQueryOk(['Дом Семёновых'], 'семенов'))
  t.ok('слова в любом порядке, клиент тоже ищется', projQueryOk(['Баня 6м', 'Петров'], 'петров баня'))
  t.ok('чужое не находится', !projQueryOk(['Дом Ивановых'], 'петров'))
  const cl = [{ id: 'a', name: 'Иванов' }, { id: 'b', name: 'Петров', phone: '+79001234567' }]
  t.ok('клиент ищется по телефону', clientsMatching(cl, '1234', '').map((c) => c.id).join() === 'b')
  t.ok('выбранный остаётся в списке', clientsMatching(cl, 'петр', 'a').length === 2)

  t.section('Копия проекта')
  const src = { id: 'p1', name: 'Дом', objId: 'o1', contractId: 'c1', clientId: 'k1', status: 'sold',
    markup: 25, model: { rooms: [{ id: 'r1' }] }, plans: [{ url: '/x' }] }
  const c = projCopy(src, { id: 'p2', at: '2026-09-24', by: 'u' })
  t.ok('новый id и имя с пометкой', c.id === 'p2' && c.name === 'Дом (копия)')
  t.ok('объект, договор и клиент — не переезжают', !c.objId && !c.contractId && !c.clientId && c.status === 'draft')
  t.ok('планировка прошлого заказчика — не переезжает', c.plans === undefined)
  t.ok('дом и наценка — те же', c.markup === 25 && c.model.rooms[0].id === 'r1')
  c.model.rooms[0].id = 'zz'
  t.ok('оригинал не задет', src.model.rooms[0].id === 'r1')
}

// ── 2. Экран ────────────────────────────────────────────────────────────────
const PRODUCTS = [{ id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'm2' }]
const EST = [{ id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2, lines: [{ pid: 'p_osb', qty: 1 }] }]
const RULES = [{ id: 'r_wall', kind: 'house', estId: 'e_osb', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 0 }]

function panel() {
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [],
    crmClients: [{ id: 'c1', name: 'Иванов' }, { id: 'c2', name: 'Семёнова' }],
    specSheets: [], specSheets2: [], projects: [], buildRules: RULES,
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30, hourRate: 800 },
  })
  return p
}
function click(p, dataset) {
  p.run('tProjects();')
  const n = p.dom.node(dataset)
  p.run('bind();')
  return n
}
function create(p, name, client) {
  p.run('tab="projects";projOpenId=null;')
  click(p, { a: 'proj-new' }).onclick()
  p.dom.field('proj-n-name', name)
  p.dom.field('proj-n-client', client || '')
  click(p, { a: 'proj-create' }).onclick()
  return p.q('projOpenId')
}

{
  t.section('Список: следующий шаг вместо серых чипов')
  const p = panel()
  const id = create(p, 'Дом Ивановых', 'c1')
  p.run('projOpenId=null;')
  const html = p.run('tProjects()')
  t.ok('кнопка следующего шага', /data-a="proj-step"/.test(html) && /Шаг 4 из 5 · Создать объект/.test(html), html.slice(0, 400))
  t.ok('серых «объекта нет · договора нет» больше нет', !/объекта нет/.test(html) && !/договора нет/.test(html))
  let stopped = false
  click(p, { a: 'proj-step', id, band: 'money' }).onclick({ stopPropagation: () => { stopped = true } })
  t.ok('шаг открывает нужную полосу', p.q('projOpenId') === id && p.q('projBand') === 'money')
  t.ok('и не даёт карточке открыть «Состав»', stopped)

  t.section('Шапка карточки: итог и следующий шаг')
  const card = p.run('tProjects()')
  const price = p.q(`Math.round(specTot(proj(${JSON.stringify(id)})).price)`)
  t.ok('цена клиенту в шапке', price > 0 && card.indexOf(price.toLocaleString('ru-RU') + ' ₽') >= 0)
  t.ok('подсказка «Дальше»', /Дальше: Создать объект/.test(card))
  t.ok('шапка липкая', /position:sticky;top:var\(--hdr\);z-index:3/.test(card))

  t.section('Правки не в объекте — видны снаружи «Стройки»')
  p.run(`objects=[{id:"o1",name:"Объект",stages:[]}];proj(${JSON.stringify(id)}).objId="o1";`)
  p.run('objProjDiff=function(){ return { items:[1,2,3] }; };')
  const card2 = p.run('tProjects()')
  t.ok('в шапке', /3 правки не в объекте/.test(card2))
  p.run('projOpenId=null;')
  t.ok('в списке', /3 правки не в объекте/.test(p.run('tProjects()')))
  p.run('projFilter="diff";')
  t.ok('и фильтром', /Дом Ивановых/.test(p.run('tProjects()')))
}

{
  t.section('Поиск, фильтр, имя по клиенту')
  const p = panel()
  create(p, '', 'c2')
  create(p, 'Баня Петрова', '')
  create(p, 'Дом Ивановых', 'c1')
  p.run('projOpenId=null;')
  t.ok('без названия проект зовётся по клиенту', p.q('projects.map(function(x){return x.name;})').indexOf('Дом Семёнова') >= 0)
  const all = p.run('tProjects()')
  t.ok('поиск появляется с трёх проектов', /id="proj-q"/.test(all))
  p.run('projQ="семенова";')
  const found = p.run('tProjects()')
  t.ok('поиск по клиенту без «ё»', /Дом Семёнова/.test(found) && !/Баня Петрова/.test(found))
  p.run('projQ="";projFilter="build";')
  const none = p.run('tProjects()')
  t.ok('пустой отбор объясняет и сбрасывается', /Под этот отбор проектов нет/.test(none) && /proj-find-reset/.test(none))
  click(p, { a: 'proj-find-reset' }).onclick()
  t.ok('сброс возвращает всё', p.q('projFilter') === 'all' && p.q('projQ') === '')
}

{
  t.section('«Такой же»')
  const p = panel()
  const id = create(p, 'Дом Ивановых', 'c1')
  p.run(`proj(${JSON.stringify(id)}).objId="o1";proj(${JSON.stringify(id)}).markup=42;`)
  click(p, { a: 'proj-copy', id }).onclick()
  const c = p.q('projects[1]')
  t.ok('копия заведена и открыта', p.q('projects.length') === 2 && p.q('projOpenId') === c.id && c.id !== id)
  t.ok('без объекта и клиента, с той же наценкой', !c.objId && !c.clientId && c.markup === 42)
  t.ok('оригинал сохранил объект', p.q('projects[0].objId') === 'o1')
}

{
  t.section('Базовая норма-час — не полем в чужом доме')
  const p = panel()
  create(p, 'Дом', '')
  p.run('projBand="money";')
  const html = p.run('tProjects()')
  t.ok('поля базы нет', !/data-a="hour-rate-base"/.test(html))
  t.ok('есть кнопка с текущей базой', /data-a="hour-rate-base-edit"/.test(html) && /база портала: 800/.test(html))
  p.run('prompt=function(){return "950";};confirm=function(){return false;};')
  click(p, { a: 'hour-rate-base-edit' }).onclick()
  t.ok('отказ в подтверждении — база та же', p.q('settings.hourRate') === 800)
  p.run('confirm=function(m){ lastConfirm=m; return true; };')
  click(p, { a: 'hour-rate-base-edit' }).onclick()
  t.ok('подтвердил — база новая', p.q('settings.hourRate') === 950)
  t.ok('вопрос называет, сколько домов пересчитается', /в 1 проекте без своей ставки/.test(p.q('lastConfirm')))
}

{
  t.section('Память посчитанного: только для экранной перерисовки')
  const p = panel()
  const id = create(p, 'Дом', '')
  p.run('projOpenId=null;tProjects();')
  p.run(`__calls=0; const __tot=projTot; projTot=function(x){ __calls++; return __tot(x); };`)
  p.run('projMemoHold=true;tProjects();projMemoHold=false;')
  t.ok('экранная перерисовка смету не пересобирает', p.q('__calls') === 0)
  p.run('tProjects();')
  t.ok('обычная — пересобирает', p.q('__calls') === 1)
  p.run(`proj(${JSON.stringify(id)}).markup=0;`)
  p.run('applyState([]);')
  t.ok('чужой снимок память сбрасывает', Object.keys(p.q('projMemo')).length === 0)
}

t.done()
