#!/usr/bin/env node
// Вкладка «Спецификация»: четыре способа показать одно и то же (public/admin.js).
//
// Список, план, матрица и мастер пишут в ОДНО место — sh.rooms[roomId][group] и
// sh.global[group]. Здесь сторожится именно это: любой заход даёт тот же выбор и ту же
// цену. Плюс две вещи, которые тише всего ломаются: подпись «+64 200» на кнопке обязана
// совпадать с тем, что потом встанет в итог, а комплектация — собирать дом целиком.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_lipa', name: 'Липа вагонка', unitCost: 900, store: 'Белка', mode: 'm2' },
  { id: 'p_kedr', name: 'Кедр вагонка', unitCost: 2400, store: 'Белка', mode: 'm2' },
  { id: 'p_lam', name: 'Ламинат', unitCost: 800, store: 'Лемана', mode: 'm2' },
  { id: 'p_tile', name: 'Плитка', unitCost: 1500, store: 'Лемана', mode: 'm2' },
  { id: 'p_screw', name: 'Саморезы', unitCost: 300, store: 'Озон', mode: 'piece' },
  { id: 'p_sock', name: 'Розетка', unitCost: 250, store: 'Озон', mode: 'piece' },
]

const EST = [
  { id: 'e_base', kind: 'banya', name: 'Каркас и обвязка', stage: 1, lines: [{ pid: 'p_screw', qty: 4 }] },
  { id: 'e_sock', kind: 'banya', name: 'Розетка — монтаж', stage: 3, optPoint: 'sock', lines: [{ pid: 'p_sock', qty: 1 }] },
  { id: 'e_lipa', kind: 'banya', name: 'Стены липа', stage: 4, optScope: 'room', optGroup: 'Стены', optLabel: 'Липа', optSurface: 'wall',
    lines: [{ pid: 'p_lipa', qty: 1 }] },
  { id: 'e_kedr', kind: 'banya', name: 'Стены кедр', stage: 4, optScope: 'room', optGroup: 'Стены', optLabel: 'Кедр', optSurface: 'wall',
    lines: [{ pid: 'p_kedr', qty: 1 }] },
  { id: 'e_lam', kind: 'banya', name: 'Пол ламинат', stage: 4, optScope: 'room', optGroup: 'Пол', optLabel: 'Ламинат', optSurface: 'floor',
    lines: [{ pid: 'p_lam', qty: 1 }] },
  { id: 'e_tile', kind: 'banya', name: 'Пол плитка', stage: 4, optScope: 'room', optGroup: 'Пол', optLabel: 'Плитка', optSurface: 'floor',
    lines: [{ pid: 'p_tile', qty: 1 }] },
  { id: 'e_heat', kind: 'banya', name: 'Печь дровяная', stage: 3, optScope: 'global', optGroup: 'Печь', optLabel: 'Дровяная',
    lines: [{ pid: 'p_screw', qty: 10 }] },
]

const PLANS = [
  { id: 'pl1', name: 'Баня 4×6', cat: 'banya', specs: { height: 2.5, openings: [], rooms: [
    { id: 'r1', name: 'Парная', w: 2, l: 3, wallLen: 10, pts: { sock: 2 } },
    { id: 'r2', name: 'Комната отдыха', w: 3, l: 4, wallLen: 14, pts: { sock: 6 } },
  ] } },
]

function panel() {
  const p = boot()
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: PLANS,
    crmClients: [{ id: 'c1', name: 'Иванов И.И.' }],
    specSheets: [], objects: [], templates: [], contractDocs: [], purchases: [],
    issues: [], users: [], stock: [], settings: { specMarkup: 40 },
  })
  p.run('currentUser={id:"u1",name:"Менеджер",roles:["sales_mgr"],objs:[],c:"#000",av:"💼"};')
  return p
}

function create(p) {
  p.dom.field('spec-n-name', 'Баня Иванова')
  const tile = p.dom.node({ a: 'spec-n-plan-pick', id: 'pl1' })
  p.run('bind();')
  tile.onclick()
  const btn = p.dom.node({ a: 'spec-create' })
  p.run('bind();')
  btn.onclick()
  return p.q('specSheets')[0]
}

function click(p, dataset) {
  const el = p.dom.node(dataset)
  p.run('bind();')
  el.onclick()
  return el
}

const J = (x) => JSON.stringify(x)
const cost = (p, id) => p.q(`specTot(specSheet(${J(id)})).cost`)
const sheet = (p, id) => p.q(`specSheet(${J(id)})`)

// ── 1. Новая спецификация открывается мастером ───────────────────────────────
{
  t.section('Мастер (01)')
  const p = panel()
  const sh = create(p)
  t.ok('после создания открыт мастер', p.q('specView') === 'steps', p.q('specView'))
  t.ok('размеры уже есть — начинаем со второго шага', p.q('specStep') === 2, String(p.q('specStep')))

  p.run('specStep=1;')
  const step1 = p.run('tSpec()')
  t.ok('первый шаг спрашивает одно: откуда дом', step1.indexOf('Откуда возьмём дом?') > 0 &&
    step1.indexOf('spec-geo-tab') > 0)
  t.ok('и не показывает отделку раньше времени', step1.indexOf('spec-pick-room') < 0,
    'один экран — один вопрос, иначе это та же простыня')

  click(p, { a: 'spec-step', n: '3' })
  const step3 = p.run('tSpec()')
  t.ok('третий шаг — отделка по помещениям', step3.indexOf('spec-pick-room') > 0 && step3.indexOf('Парная') > 0)
  t.ok('цена видна на каждом шаге', step3.indexOf('spec-print') > 0 && /₽/.test(step3))

  // Шаг помечается пройденным по делу, а не по факту «был на нём».
  t.ok('шаг «дом» пройден: помещения есть', p.q(`specStepDone(specSheet(${J(sh.id)}),1,[])`) === true)
  t.ok('шаг «отделка» не пройден: выбора нет',
    p.q(`specStepDone(specSheet(${J(sh.id)}),3,specGaps(specSheet(${J(sh.id)})))`) === false)

  click(p, { a: 'spec-view', v: 'sheet' })
  t.ok('из мастера выходим в список', p.q('specView') === 'sheet')
}

// ── 2. Собранная страница: аккордеоны, пропуски, дельты ──────────────────────
{
  t.section('Собранная страница (02)')
  const p = panel()
  const id = create(p).id
  p.run('specView="sheet";specAcc={rooms:false,global:false,base:false,stages:false};')
  const closed = p.run('tSpec()')
  t.ok('свёрнутый блок не рисует свои помещения', closed.indexOf('spec-pick-room') < 0)
  t.ok('но бейдж считает готовность', closed.indexOf('0 из 2') > 0, 'иначе «я закончил?» отвечают предупреждения')

  click(p, { a: 'spec-acc', k: 'rooms' })
  t.ok('блок раскрылся', p.q('specAcc').rooms === true && p.run('tSpec()').indexOf('spec-pick-room') > 0)

  // Кнопки «не принято решений» ведут к пропуску, а не просто сообщают о нём.
  const gaps = p.q(`specGaps(specSheet(${J(id)}))`)
  t.ok('пропуски собраны по помещениям и дому', gaps.length === 5, J(gaps.map((x) => x.t)))
  const card = p.run('tSpec()')
  t.ok('и показаны кнопками', card.indexOf('spec-jump') > 0)
  click(p, { a: 'spec-jump', rid: 'r1', g: 'Пол', gi: '1' })
  t.ok('переход подсвечивает именно этот пропуск', p.q('specHi') === 'room:r1:Пол', p.q('specHi'))
  t.ok('и раскрывает блок помещений', p.q('specAcc').rooms === true)

  // Подпись на кнопке — это ОБЕЩАНИЕ цены. Разойдись она с итогом, продавец назовёт
  // клиенту одну сумму, а в договор уйдёт другая.
  const before = cost(p, id)
  const promised = p.q(`optionCost(specSheet(${J(id)}), specEst("e_kedr"), specSheet(${J(id)}).specs.rooms[0], expProducts)`)
  click(p, { a: 'spec-pick-room', rid: 'r1', g: 'Стены', eid: 'e_kedr' })
  t.ok('цена варианта на кнопке равна прибавке к итогу', cost(p, id) - before === promised,
    `${cost(p, id) - before} ≠ ${promised}`)
  t.ok('выбор снял подсветку', p.q('specHi') === '')

  const withKedr = p.run('tSpec()')
  t.ok('у невыбранного варианта показана разница, а не полная цена',
    withKedr.indexOf('−') > 0 || withKedr.indexOf('+') > 0)

  // Липкая полоса: цена больше не живёт под тремя экранами прокрутки.
  t.ok('цена приклеена к низу', withKedr.indexOf('position:sticky;bottom:calc(76px') > 0)
  t.ok('себестоимость спрятана, пока её не попросят', withKedr.indexOf('Себестоимость') < 0)
  click(p, { a: 'spec-inner' })
  t.ok('«для своих» показывает себестоимость и наценку',
    p.run('tSpec()').indexOf('Себестоимость') > 0 && p.run('tSpec()').indexOf('spec-markup') > 0)
}

// ── 3. Комплектации ──────────────────────────────────────────────────────────
{
  t.section('Комплектации (05)')
  const p = panel()
  const id = create(p).id
  p.run('specView="sheet";')
  click(p, { a: 'spec-pick-room', rid: 'r1', g: 'Стены', eid: 'e_lipa' })
  click(p, { a: 'spec-pick-room', rid: 'r1', g: 'Пол', eid: 'e_tile' })
  click(p, { a: 'spec-pick-room', rid: 'r2', g: 'Стены', eid: 'e_lipa' })
  click(p, { a: 'spec-pick-room', rid: 'r2', g: 'Пол', eid: 'e_lam' })
  click(p, { a: 'spec-pick-global', g: 'Печь', eid: 'e_heat' })
  const full = cost(p, id)

  p.run('window.prompt=function(){return "Комфорт";};')
  click(p, { a: 'spec-preset-save' })
  const presets = p.q('settings.specPresets')
  t.ok('комплектация сохранилась в настройках', presets.length === 1 && presets[0].name === 'Комфорт', J(presets))
  t.ok('в ней вариант по каждой группе', presets[0].rooms.Стены === 'e_lipa' && presets[0].global['Печь'] === 'e_heat',
    J(presets[0]))
  t.ok('по группе взят самый частый вариант комнат', presets[0].rooms['Пол'] === 'e_tile' || presets[0].rooms['Пол'] === 'e_lam',
    'иначе комплектация собиралась бы из случайной комнаты')

  // Новая спецификация того же вида собирается одним тапом.
  const p2 = panel()
  p2.set({ settings: { specMarkup: 40, specPresets: presets } })
  const id2 = create(p2).id
  p2.run('specView="sheet";window.confirm=function(){return true;};')
  t.ok('до комплектации цена нулевая', cost(p2, id2) === p2.q(`specTot(specSheet(${J(id2)})).positions`)
    .filter((x) => x.key.indexOf('base:') === 0 || x.key.indexOf('room:') !== 0).reduce((a, x) => a + x.cost, 0))
  click(p2, { a: 'spec-preset', id: presets[0].id })
  const sh2 = sheet(p2, id2)
  t.ok('один тап собрал все помещения', Object.keys(sh2.rooms.r1).length === 2 && Object.keys(sh2.rooms.r2).length === 2,
    J(sh2.rooms))
  t.ok('и общедомовые опции', sh2.global['Печь'] === 'e_heat')
  t.ok('комплектация запомнилась на спецификации', sh2.presetId === presets[0].id)
  t.ok('цена комплектации на плитке = цене на экране',
    p2.q(`specPresetPrice(specSheet(${J(id2)}), settings.specPresets[0])`) === p2.q(`specTot(specSheet(${J(id2)})).price`),
    'иначе плитка обещает одно, а итог показывает другое')

  t.ok('замен пока нет', p2.q(`specPresetDiff(specSheet(${J(id2)}))`) === 0)
  click(p2, { a: 'spec-pick-room', rid: 'r1', g: 'Стены', eid: 'e_kedr' })
  t.ok('точечная замена считается заменой, а не новой комплектацией',
    p2.q(`specPresetDiff(specSheet(${J(id2)}))`) === 1 && sheet(p2, id2).presetId === presets[0].id)

  p2.run('window.confirm=function(){return false;};')
  const beforeCancel = J(sheet(p2, id2).rooms)
  click(p2, { a: 'spec-preset', id: presets[0].id })
  t.ok('отказ от подтверждения не трогает выбор', J(sheet(p2, id2).rooms) === beforeCancel,
    'комплектация переписывает все комнаты — молча этого делать нельзя')

  // Удаление комплектации не должно менять уже проданное.
  p2.run('window.confirm=function(){return true;};')
  const soldCost = cost(p2, id2)
  click(p2, { a: 'spec-preset-del', id: presets[0].id })
  t.ok('комплектация удалена', (p2.q('settings.specPresets') || []).length === 0)
  t.ok('а собранная спецификация осталась прежней', cost(p2, id2) === soldCost,
    'комплектация — способ собрать, а не ссылка на состав')
  void full
}

// ── 4. План и отделка ────────────────────────────────────────────────────────
{
  t.section('План и отделка (03)')
  const p = panel()
  const id = create(p).id
  p.run('specView="plan";')
  const plan = p.run('tSpec()')
  t.ok('комнаты доступны тапом', plan.indexOf('spec-room-pick') > 0)
  t.ok('и по умолчанию открыта первая', plan.indexOf('Парная') > 0 && plan.indexOf('spec-pick-room') > 0)

  click(p, { a: 'spec-room-pick', id: 'r2' })
  const second = p.run('tSpec()')
  t.ok('выбрана вторая комната', p.q('specRoomPick') === 'r2' &&
    second.indexOf('data-a="spec-pick-room" data-rid="r2"') > 0)
  t.ok('чужие группы на экран не лезут', second.indexOf('data-a="spec-pick-room" data-rid="r1"') < 0,
    'в этом режиме разговор идёт про одну комнату')

  // Выбор из режима плана пишется туда же, куда и из списка.
  click(p, { a: 'spec-pick-room', rid: 'r2', g: 'Стены', eid: 'e_lipa' })
  t.ok('выбор лёг в ту же ячейку', sheet(p, id).rooms.r2['Стены'] === 'e_lipa')

  // На модели комнаты рисуются планом, а не списком.
  p.run(`(function(){var sh=specSheet(${J(id)});sh.model=emptyModel("40");sh.model.rooms[0].id="r1";modelSync(sh);})();`)
  const svg = p.run('tSpec()')
  t.ok('с моделью появляется кликабельный план', svg.indexOf('<svg') > 0 && svg.indexOf('spec-room-pick') > 0)
}

// ── 5. Матрица ───────────────────────────────────────────────────────────────
{
  t.section('Матрица (04)')
  const p = panel()
  const id = create(p).id
  p.run('specView="matrix";')
  const mx = p.run('tSpec()')
  t.ok('строки — помещения, столбцы — группы', mx.indexOf('Парная') > 0 && mx.indexOf('Стены ⇊') > 0)
  t.ok('пустая ячейка видна без предупреждений', mx.indexOf('выбрать') > 0)

  // Столбец: типовая баня заполняется одним тапом на группу.
  click(p, { a: 'spec-cell', rid: '*', gi: '0' })
  t.ok('шапка столбца открыла выбор на все помещения', J(p.q('specCell')) === J({ rid: '*', gi: 0 }))
  click(p, { a: 'spec-cell-pick', eid: 'e_lipa' })
  const all = sheet(p, id)
  t.ok('вариант встал во все помещения', all.rooms.r1['Стены'] === 'e_lipa' && all.rooms.r2['Стены'] === 'e_lipa',
    J(all.rooms))
  t.ok('выбор закрылся после применения', p.q('specCell') === null)

  // Ячейка: точечная правка одной комнаты.
  click(p, { a: 'spec-cell', rid: 'r1', gi: '0' })
  click(p, { a: 'spec-cell-pick', eid: 'e_kedr' })
  const one = sheet(p, id)
  t.ok('одна комната поменялась', one.rooms.r1['Стены'] === 'e_kedr')
  t.ok('соседняя осталась прежней', one.rooms.r2['Стены'] === 'e_lipa')

  click(p, { a: 'spec-cell', rid: 'r1', gi: '0' })
  click(p, { a: 'spec-cell-pick', eid: '' })
  t.ok('выбор снимается', sheet(p, id).rooms.r1['Стены'] === undefined, J(sheet(p, id).rooms.r1))

  // Матрица и список показывают одни и те же деньги.
  p.run('specView="sheet";specAcc={rooms:true};')
  const listCost = cost(p, id)
  p.run('specView="matrix";')
  t.ok('цена не зависит от способа показа', cost(p, id) === listCost)
}

t.done()
