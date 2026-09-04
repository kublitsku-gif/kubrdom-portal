#!/usr/bin/env node
// Смета по чертежу — вкладка «🧾 Смета» опытного раздела (src/spec2.js + панель).
//
// Смысл шага: количество в смете берётся из МОДЕЛИ, а не вписывается руками, и у
// каждой строки видно, откуда это количество взялось. Поэтому здесь сторожим три
// вещи: что числа действительно приезжают из чертежа, что расчёт не расходится с
// боевым (иначе объект соберётся не по той смете, которую показали) и что дом
// честно говорит, чего он не досчитал.
import { presetModel, MODEL_PRESETS } from '../src/model.js'
import { sheetPositions } from '../src/spec.js'
import { works2, gaps2, positionWhy, modelFacts, probeSheet } from '../src/spec2.js'
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

let seq = 0
const gid = () => 'id' + (++seq)

const PRODUCTS = [
  { id: 'p_win', name: 'Монтажный комплект окна', unitCost: 1500, store: 'Белка', mode: 'piece' },
  { id: 'p_dr', name: 'Наличник', unitCost: 800, store: 'Белка', mode: 'piece' },
  { id: 'p_osb', name: 'ОСП 9 мм', unitCost: 900, store: 'Лемана', mode: 'sheet', packBase: 'м²', packPer: 2.9 },
]
const EST = [
  // Считается по раскладке: сколько окон нарисовано, столько и монтажей.
  { id: 'e_win', kind: 'house', name: 'Монтаж окна', stage: 2, optPoint: 'win', lines: [{ pid: 'p_win', qty: 1 }] },
  { id: 'e_dr', kind: 'house', name: 'Монтаж двери', stage: 3, optPoint: 'door', lines: [{ pid: 'p_dr', qty: 2 }] },
  // Вариант отделки — в опытном листе его никто не выбирал, и в смету он не попадёт.
  { id: 'e_wall', kind: 'house', name: 'Стены ОСП', stage: 2, optScope: 'room', optGroup: 'Стены', optLabel: 'ОСП', optSurface: 'wall', lines: [{ pid: 'p_osb', qty: 1 }] },
]
const STAGES = [
  { n: 1, label: 'Подготовительный', short: 'Этап 1', color: '#e67e22' },
  { n: 2, label: 'Черновые работы', short: 'Этап 2', color: '#2980b9' },
  { n: 3, label: 'Чистовые работы', short: 'Этап 3', color: '#16a085' },
]

const built = presetModel(MODEL_PRESETS[0], [], gid)
// Заготовка заводит изделия с нулевой ценой — её вписывает человек. Здесь она
// нужна: без цены нечего и говорить, что стоимость окон в смету не попадает.
const TYPES = built.winTypes.map((x) => Object.assign({}, x, { cost: x.cost || 12000 }))
const SHEET = {
  id: 'lab1', name: 'Опытный дом', kind: 'house', markup: 30, model: built.model,
  specs: { height: 2.5, rooms: [], openings: [] }, rooms: {}, global: {}, qty: {},
}

// ── 1. Числа приезжают из чертежа ────────────────────────────────────────────
{
  t.section('Смета считается по модели')
  const w = works2(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES, stages: STAGES })
  const f = modelFacts(SHEET, TYPES)
  const wins = f.points.find((p) => p.k === 'win')
  const doors = f.points.find((p) => p.k === 'door')
  t.ok('дом посчитал окна', wins && wins.count > 0)
  t.ok('и двери', doors && doors.count > 0)
  t.ok('площади пола есть', f.total.floor > 20)

  const pw = w.positions.find((p) => p.estId === 'e_win')
  t.ok('монтаж окна попал в смету', !!pw)
  t.ok('количество — по числу окон', pw.count === wins.count, 'получили: ' + pw.count)
  t.ok('и деньги считаются от него', pw.cost === 1500 * wins.count, 'получили: ' + pw.cost)
  t.ok('откуда число — сказано', pw.why === 'Окно ' + wins.count + ' шт', 'получили: ' + pw.why)

  const pd = w.positions.find((p) => p.estId === 'e_dr')
  t.ok('у двери свой множитель', pd.cost === 800 * 2 * doors.count, 'получили: ' + pd.cost)
  t.ok('невыбранная отделка в смету не лезет', !w.positions.some((p) => p.estId === 'e_wall'))
}

// ── 2. Расчёт общий с боевым ────────────────────────────────────────────────
// Своя копия формул означала бы, что на экране одна смета, а в объекте другая, и
// находится это в лучшем случае на приёмке этапа.
{
  t.section('Расчёт не свой, а общий')
  const w = works2(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES, stages: STAGES })
  const base = sheetPositions(probeSheet(SHEET, TYPES), EST, PRODUCTS)
  t.ok('позиции те же', w.positions.length === base.length, 'получили: ' + w.positions.length)
  t.ok('сумма та же', w.cost === base.reduce((a, p) => a + p.cost, 0), 'получили: ' + w.cost)
  t.ok('цена клиенту — с наценкой листа', w.price === Math.round(w.cost * 1.3), 'получили: ' + w.price)
  t.ok('лист расчётом не переписан', (SHEET.specs.rooms || []).length === 0)
}

// ── 3. Этапы ────────────────────────────────────────────────────────────────
{
  t.section('Смета читается этапами')
  const w = works2(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES, stages: STAGES })
  t.ok('этапов два', w.stages.length === 2, 'получили: ' + w.stages.length)
  t.ok('и они по порядку', w.stages.map((s) => s.n).join(',') === '2,3')
  t.ok('подпись из справочника этапов', w.stages[0].label === 'Этап 2 — Черновые работы', 'получили: ' + w.stages[0].label)
  t.ok('цвет оттуда же', w.stages[1].color === '#16a085', 'получили: ' + w.stages[1].color)
  t.ok('сумма этапа = сумма его строк',
    w.stages[0].cost === w.positions.filter((p) => p.stage === 2).reduce((a, p) => a + p.cost, 0))
  t.ok('итог = сумма этапов', w.cost === w.stages.reduce((a, s) => a + s.cost, 0), 'получили: ' + w.cost)
}

// ── 4. Чего дом не досчитал ─────────────────────────────────────────────────
// Этот список — не украшение экрана, а задание на правила сборки.
{
  t.section('Посчитано, но в смету не попало')
  const g = gaps2(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES })
  const surf = g.filter((x) => x.kind === 'surface').map((x) => x.k)
  t.ok('пол в пробелах', surf.indexOf('floor') >= 0)
  t.ok('стены тоже', surf.indexOf('wall') >= 0)
  t.ok('изделия проёмов отдельной строкой', g.some((x) => x.kind === 'goods'))
  t.ok('окна в пробелы не попали — их считает позиция', !g.some((x) => x.k === 'win'))

  // Точку, которой в доме нет, никто не считает и в пробелы не пишет.
  t.ok('несуществующих точек в списке нет', !g.some((x) => x.k === 'sock'))
}

// ── 5. Пустой дом ───────────────────────────────────────────────────────────
{
  t.section('Без модели считать нечего')
  const w = works2({ id: 'x', kind: 'house', specs: { height: 2.5, rooms: [] }, rooms: {}, global: {}, qty: {} }, { estimates: EST, products: PRODUCTS, winTypes: TYPES, stages: STAGES })
  t.ok('позиций нет', w.positions.length === 0, 'получили: ' + w.positions.length)
  t.ok('денег нет', w.cost === 0, 'получили: ' + w.cost)
  t.ok('пробелов нет', w.gaps.length === 0, 'получили: ' + w.gaps.length)
  t.ok('и фактов нет', w.facts.rooms.length === 0, 'получили: ' + w.facts.rooms.length)
}

// ── 6. Вкладка в панели ─────────────────────────────────────────────────────
{
  t.section('Вкладка «Смета»')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  const scheme = p.run('spec2Tab="scheme";tSpec2()')
  t.ok('вкладки есть на обоих видах', scheme.indexOf('data-a="spec2-tab"') >= 0)
  t.ok('на схеме смета не печатается', scheme.indexOf('ОТКУДА ЧИСЛА') < 0)

  const est = p.run('spec2Tab="est";tSpec2()')
  t.ok('смета показана', /СЕБЕСТОИМОСТЬ ПО ЧЕРТЕЖУ/.test(est))
  t.ok('факты рядом с ней', /ОТКУДА ЧИСЛА/.test(est) && /РАСКЛАДКА/.test(est))
  t.ok('изделия проёмов перечислены', /ИЗДЕЛИЯ В ПРО/.test(est))
  t.ok('откуда число — на строке', /Окно \d+ шт/.test(est))
  t.ok('этап подписан', /Этап 2/.test(est))
  t.ok('пробелы показаны', /В СМЕТУ НЕ ПОПАЛО/.test(est))
  // Заготовка нигде не сохранена — заводить из неё объект не из чего.
  t.ok('объекта из заготовки нет', est.indexOf('data-a="spec-to-object"') < 0)
  t.ok('и договора тоже', est.indexOf('data-a="spec-to-contract"') < 0)
  t.ok('чертёж на этой вкладке не рисуется', est.indexOf('<svg') < 0)

  // Лист заведён — кнопки появились.
  p.run('spec2Tab="scheme";')
  const edit = p.dom.node({ a: 'spec2-edit' })
  p.run('bind();')
  edit.onclick()
  const est2 = p.run('modelFull=false;spec2Tab="est";tSpec2()')
  t.ok('по заведённому листу объект собирается', est2.indexOf('data-a="spec-to-object"') >= 0)
  t.ok('и договор заводится', est2.indexOf('data-a="spec-to-contract"') >= 0)
}

// ── 7. Правила в панели ─────────────────────────────────────────────────────
// Правила меняют смету и состав объекта, поэтому здесь сторожим главное: что
// боевые спецификации они не трогают, а объект собирается тем же списком, что
// показан на экране.
{
  t.section('Правила сборки на экране')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  const rules = p.run('spec2Tab="rules";tSpec2()')
  t.ok('вкладка правил есть', rules.indexOf('data-a="rule-add"') >= 0)
  t.ok('и объясняет, что это', /ПРАВИЛА СБОРКИ/.test(rules))

  // Заводим лист и правило руками, как это делает человек.
  p.run('spec2Tab="scheme";')
  const edit = p.dom.node({ a: 'spec2-edit' })
  p.run('bind();')
  edit.onclick()
  p.run('modelFull=false;spec2Tab="rules";tSpec2();')
  const add = p.dom.node({ a: 'rule-add' })
  p.run('bind();')
  add.onclick()
  t.ok('правило завелось', p.q('buildRules.length') === 1)
  const rid = p.q('buildRules[0].id')
  p.run('ruleSet(' + JSON.stringify(rid) + ', function(r){ r.estId="e_wall"; r.what="surface"; r.k="wall"; r.scope="room"; });')

  const shown = p.run('tSpec2()')
  t.ok('правило показано словами', /каждого помещения/.test(shown))
  t.ok('и сколько строк даёт', /строк на/.test(shown))

  const est = p.run('spec2Tab="est";tSpec2()')
  t.ok('строки правила попали в смету', /ОСП/.test(est))
  t.ok('стены больше не пробел', est.indexOf('стены') < 0 || !/В СМЕТУ НЕ ПОПАЛО[\s\S]{0,400}стены/.test(est))

  // Объект собирается ТЕМ ЖЕ списком: иначе продали одно, а строят другое.
  const nWorks = p.q('specBuildStages(spec2Sheet()).reduce(function(a,s){return a+s.works.length;},0)')
  const nPos = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.length')
  t.ok('в объекте столько же работ, сколько в смете', nWorks === nPos, 'объект ' + nWorks + ', смета ' + nPos)

  // Боевая спецификация правил не видит — по ней заведены договора и транши.
  p.run('specSheets=[{id:"war",name:"Боевая",kind:"house",markup:30,specs:{height:2.5,rooms:[{id:"r1",name:"Зал",w:3,l:4,wallLen:14,pts:{}}]},rooms:{},global:{},qty:{}}];')
  const warRules = p.q('specCtx(specSheet("war")).rules.length')
  const labRules = p.q('specCtx(spec2Sheet()).rules.length')
  t.ok('у боевого листа правил нет', warRules === 0)
  t.ok('у опытного — есть', labRules === 1)
}

// ── 8. Правило меняется тапом по чипу «откуда число» ────────────────────────
// Чип под строкой и есть правило, по которому она посчитана. Читать его тут, а
// править в другой вкладке — значит каждый раз искать нужное среди чужих.
{
  t.section('Правило по тапу в строке сметы')
  const EST2 = EST.concat([
    { id: 'e_box', kind: 'house', name: 'Пол листами', stage: 1, lines: [{ pid: 'p_osb', qty: 1 }] },
  ])
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST2, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()

  const est = p.run('modelFull=false;spec2Tab="est";tSpec2()')
  t.ok('чип «откуда число» — кнопка', est.indexOf('data-a="est-why"') >= 0)
  t.ok('и он у обязательной строки тоже', /data-a="est-why" data-est="e_box"/.test(est))
  t.ok('редактор закрыт, пока не тапнули', est.indexOf('ЧЕМ МЕРЯЕТСЯ') < 0)

  const chip = p.dom.node({ a: 'est-why', est: 'e_box' }); p.run('bind();'); chip.onclick()
  const open = p.run('tSpec2()')
  t.ok('тап раскрыл редактор', /ЧЕМ МЕРЯЕТСЯ ЭТА СТРОКА/.test(open))
  t.ok('и предлагает, чем мерять', /по площади поверхности/.test(open) && /по точкам раскладки/.test(open))
  t.ok('правило от одного открытия не завелось', p.q('buildRules.length') === 0)

  // Меняем счёт: «на весь дом» → «по площади пола каждого помещения».
  const costBefore = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_box";})[0].cost')
  const pick = p.dom.node({ a: 'est-rule-set', est: 'e_box', f: 'what', v: 'surface' }); p.run('bind();'); pick.onclick()
  const floor = p.dom.node({ a: 'est-rule-set', est: 'e_box', f: 'k', v: 'floor' }); p.run('bind();'); floor.onclick()
  t.ok('правило завелось по первой правке', p.q('buildRules.length') === 1)
  t.ok('и привязано к этой смете', p.q('buildRules[0].estId') === 'e_box')
  const rows = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_box";})')
  t.ok('строка стала считаться по помещениям', rows.length > 1, 'строк: ' + rows.length)
  t.ok('и это уже строки правила', rows.every((x) => x.from === 'rule'))
  t.ok('обязательная строка не осталась второй', rows.every((x) => String(x.key).indexOf('base:') !== 0))
  // Штучный материал от площади не считают, а листовой — считают: у этой строки
  // материал листовой, поэтому и цена обязана поехать.
  t.ok('цена пересчиталась', rows[0].cost !== costBefore, costBefore + ' → ' + rows[0].cost)
  t.ok('и сумма по строке выросла на весь дом',
    rows.reduce((a, x) => a + x.cost, 0) > costBefore)
  t.ok('и в строке видно, откуда число', /пол [\d,]+ м²/.test(p.run('tSpec2()')))

  // Убрали правило — вернулся счёт «как в справочнике».
  const del = p.dom.node({ a: 'est-rule-del', est: 'e_box' }); p.run('bind();'); del.onclick()
  t.ok('правило убрано', p.q('buildRules.length') === 0)
  const back = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_box";})')
  t.ok('строка снова одна', back.length === 1 && back[0].from === 'est')
  t.ok('и цена прежняя', back[0].cost === costBefore)
}

// ── 9. Пирог стены считает себя сам ─────────────────────────────────────────
// Узел — то место, где на пирог смотрят; там же ему и место для цены. Проверяем,
// что выбор товара в слое доезжает до сметы и до объекта.
{
  t.section('Дом как конструкция')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS.concat([{ id: 'p_ppu', name: 'ППУ 50 мм', unitCost: 600, store: 'Белка', mode: 'm2' }]),
    estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;')

  const node = p.run('spec2Tab="scheme";schemeView="dim";nodeTab="n3";tSpec2()')
  t.ok('в узле можно выбрать товар слоя', node.indexOf('data-a="model-layer-pid"') >= 0)
  t.ok('и видно, что слои без цены', /без товара/.test(node))

  const before = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.length')
  const sel = p.dom.node({ a: 'model-layer-pid', sh: p.q('spec2Sheet().id'), key: 'skin', i: '1' })
  sel.value = 'p_ppu'
  p.run('bind();'); sel.onchange()
  t.ok('товар записан в слой', p.q('spec2Sheet().model.skin[1].pid') === 'p_ppu')

  const pos = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.from==="layer";})')
  t.ok('слой стал строкой сметы', pos.length === 1)
  t.ok('и посчитан по площади стен', pos[0].area > 10 && pos[0].cost > 0)
  t.ok('всего строк стало больше', p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.length') === before + 1)

  const node2 = p.run('nodeTab="n3";tSpec2()')
  t.ok('узел показывает деньги пирога', /₽\/м²/.test(node2))

  // Толщину правим — товар остаётся: слой это не только миллиметры.
  const mm = p.dom.node({ a: 'model-layer-mm', sh: p.q('spec2Sheet().id'), key: 'skin', i: '1' })
  mm.value = '60'
  p.run('bind();'); mm.oninput ? mm.oninput() : (mm.onchange && mm.onchange())
  t.ok('товар пережил правку толщины', p.q('spec2Sheet().model.skin[1].pid') === 'p_ppu')

  // Замена материала в строке пирога правит САМ ПИРОГ: у стены один источник
  // правды о том, из чего она сделана.
  const lkey = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.from==="layer";})[0].key') + '|p_ppu'
  const lopen = p.dom.node({ a: 'est-mat-open', k: lkey }); p.run('spec2Tab="est";tSpec2();bind();'); lopen.onclick()
  p.dom.field('msw-input', 'Монтажный комплект окна')
  const ldo = p.dom.node({ a: 'est-mat-do', k: lkey }); p.run('bind();'); ldo.onclick()
  t.ok('замена слоя ушла в пирог', p.q('spec2Sheet().model.skin[1].pid') === 'p_win')
  t.ok('и лист заменами не оброс', p.q('Object.keys(spec2Sheet().mats||{}).length') === 0)

  // Объект собирается тем же списком — вместе со строками пирога.
  const shown = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.length')
  const nWorks = p.q('specBuildStages(spec2Sheet()).reduce(function(a,s){return a+s.works.length;},0)')
  t.ok('строки пирога уехали в объект', nWorks === shown, 'объект ' + nWorks + ', смета ' + shown)
}

// ── 10. Материалы перечнем и с заменой ──────────────────────────────────────
// Состав строки — это и есть спецификация, и читают его глазами. Заменa живёт на
// листе: справочник общий, и правка в нём меняла бы состав всех будущих домов.
{
  t.section('Материалы строки')
  const PROD2 = PRODUCTS.concat([
    { id: 'p_alt', name: 'Гофра усиленная', unitCost: 90, store: 'Лемана', mode: 'piece' },
    { id: 'p_sheet2', name: 'ОСП 12 мм', unitCost: 1300, store: 'Лемана', mode: 'sheet', packBase: 'м²', packPer: 3 },
  ])
  const EST3 = EST.concat([
    { id: 'e_el', kind: 'house', name: 'Разводка электрики', stage: 1,
      lines: [{ pid: 'p_win', qty: 1 }, { pid: 'p_dr', qty: 50 }] },
  ])
  const p = boot({})
  p.set({
    expProducts: PROD2, estimates: EST3, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  const est0 = p.run('modelFull=false;spec2Tab="est";tSpec2()')
  // Список читают РАБОТАМИ: материалы свёрнуты за одну строку, пока в них не лезут.
  t.ok('материалы по умолчанию свёрнуты',
    est0.indexOf('data-a="est-mats-open"') >= 0 && est0.indexOf('data-a="est-mat-open"') < 0)
  p.run('(works2(spec2Sheet(), specCtx(spec2Sheet())).positions||[]).forEach(function(x){ matsOpen[x.key]=1; });')
  const est = p.run('tSpec2()')

  t.ok('материалы идут перечнем, а не строкой', (est.match(/data-a="est-mat-open"/g) || []).length >= 2)
  t.ok('у каждого своя цена', /₽\/шт ×/.test(est))
  t.ok('количество правится руками',
    est.indexOf('data-a="est-mat-qty"') >= 0 && /value="50"/.test(est))

  // Тап по ⇄ раскрывает выбор из базы.
  const key = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0].key') + '|p_dr'
  const open = p.dom.node({ a: 'est-mat-open', k: key }); p.run('bind();'); open.onclick()
  const shown = p.run('tSpec2()')
  t.ok('раскрылся выбор из базы', /ЗАМЕНИТЬ НА МАТЕРИАЛ ИЗ БАЗЫ/.test(shown))
  t.ok('и это список каталога', shown.indexOf('id="msw-cat2"') >= 0 && /Гофра усиленная/.test(shown))

  // Меняем товар.
  const before = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0].cost')
  p.dom.field('msw-input', 'Гофра усиленная')
  const go = p.dom.node({ a: 'est-mat-do', k: key }); p.run('bind();'); go.onclick()
  const pos = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0]')
  t.ok('материал заменён', pos.mats.some((m) => m.pid === 'p_alt' && m.n === 'Гофра усиленная'))
  t.ok('количество сохранено', pos.mats.find((m) => m.pid === 'p_alt').qty === 50)
  t.ok('цена строки пересчиталась', pos.cost !== before, before + ' → ' + pos.cost)
  t.ok('замена лежит на листе', p.q('Object.keys(spec2Sheet().mats).length') === 1)
  t.ok('справочник не тронут', p.q('estimates.find(function(e){return e.id==="e_el";}).lines[1].pid') === 'p_dr')
  t.ok('в строке видно, что материал заменён', /заменён/.test(p.run('tSpec2()')))

  // Материал можно дописать руками: смета описывает типовой дом, а на этом бывает
  // лишний уголок.
  t.ok('кнопка «+ материал» есть у строки', p.run('tSpec2()').indexOf('data-a="est-mat-add-open"') >= 0)
  const addOpen = p.dom.node({ a: 'est-mat-add-open', k: pos.key }); p.run('bind();'); addOpen.onclick()
  t.ok('форма раскрылась', /ДОБАВИТЬ МАТЕРИАЛ В ЭТУ СТРОКУ/.test(p.run('tSpec2()')))
  p.dom.field('mad-n', 'Гофра усиленная')
  p.dom.field('mad-qty', '7')
  p.dom.field('mad-cost', '')
  const addDo = p.dom.node({ a: 'est-mat-add-do', k: pos.key }); p.run('bind();'); addDo.onclick()
  const withAdd = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0]')
  const extra = withAdd.mats.filter((m) => m.added)
  t.ok('материал дописан', extra.length === 1 && extra[0].n === 'Гофра усиленная')
  t.ok('цена подтянулась из базы', extra[0].cost === 90)
  t.ok('количество своё', extra[0].qty === 7)
  t.ok('и сумма строки выросла', withAdd.cost === pos.cost + 90 * 7, withAdd.cost + ' против ' + pos.cost)
  t.ok('помечен как добавленный', /добавлен/.test(p.run('tSpec2()')))
  t.ok('справочник не тронут', p.q('estimates.find(function(e){return e.id==="e_el";}).lines.length') === 2)
  t.ok('уехал в объект',
    p.q('specBuildStages(spec2Sheet()).reduce(function(a,s){return a.concat(s.works);},[])')
      .some((w) => (w.mats || []).some((m) => m.n === 'Гофра усиленная' && m.qty === 7)))

  // Ручной материал без базы — с ценой из формы.
  const addOpen2 = p.dom.node({ a: 'est-mat-add-open', k: pos.key }); p.run('bind();'); addOpen2.onclick()
  p.dom.field('mad-n', 'Уголок монтажный')
  p.dom.field('mad-qty', '4')
  p.dom.field('mad-cost', '120')
  const addDo2 = p.dom.node({ a: 'est-mat-add-do', k: pos.key }); p.run('bind();'); addDo2.onclick()
  const hand = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0].mats').filter((m) => m.added)
  t.ok('материала не из базы тоже можно', hand.length === 2 && hand[1].n === 'Уголок монтажный')
  t.ok('и цена из формы', hand[1].cost === 120 && hand[1].pid === '')

  // Убрали дописанное.
  const del = p.dom.node({ a: 'est-mat-add-del', k: pos.key, m: hand[0].id }); p.run('bind();'); del.onclick()
  const del2 = p.dom.node({ a: 'est-mat-add-del', k: pos.key, m: hand[1].id }); p.run('bind();'); del2.onclick()
  t.ok('дописанное убирается', p.q('Object.keys(spec2Sheet().matAdd||{}).length') === 0)

  // Замена уезжает в объект вместе с составом.
  const works = p.q('specBuildStages(spec2Sheet()).reduce(function(a,s){return a.concat(s.works);},[])')
  t.ok('объект собран с новым материалом',
    works.some((w) => (w.mats || []).some((m) => m.pid === 'p_alt')))

  // Возврат к справочнику.
  const key2 = pos.key + '|p_alt'
  const open2 = p.dom.node({ a: 'est-mat-open', k: key2 }); p.run('bind();'); open2.onclick()
  const back = p.dom.node({ a: 'est-mat-reset', k: key2 }); p.run('bind();'); back.onclick()
  const after = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0]')
  t.ok('вернулся товар из справочника', after.mats.some((m) => m.pid === 'p_dr'))
  t.ok('и цена прежняя', after.cost === before)
  t.ok('замена с листа убрана', p.q('Object.keys(spec2Sheet().mats).length') === 0)

  // Количество правится руками — и это тоже правка дома, а не справочника.
  const qk = after.key + '|p_dr'
  const qi = p.dom.node({ a: 'est-mat-qty', k: qk })
  qi.value = '80'
  p.run('bind();'); qi.onchange()
  const q1 = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0]')
  t.ok('количество поставлено руками', q1.mats.find((m) => m.pid === 'p_dr').qty === 80)
  t.ok('и помечено как ручное', q1.mats.find((m) => m.pid === 'p_dr').qtySet === true)
  t.ok('цена пересчиталась по нему', q1.cost === 1500 + 800 * 80, 'строка ' + q1.cost)
  t.ok('справочник по-прежнему не тронут', p.q('estimates.find(function(e){return e.id==="e_el";}).lines[1].qty') === 50)
  t.ok('в объект уехало ручное число',
    p.q('specBuildStages(spec2Sheet()).reduce(function(a,s){return a.concat(s.works);},[])')
      .some((w) => (w.mats || []).some((m) => m.pid === 'p_dr' && m.qty === 80)))
  // Запятая — тоже число: браузер и человек пишут по-разному.
  qi.value = '12,5'
  p.run('bind();'); qi.onchange()
  t.ok('запятая понимается', p.q('spec2Sheet().matQty[' + JSON.stringify(after.key) + '].p_dr') === 12.5)

  const qr = p.dom.node({ a: 'est-mat-qty-reset', k: qk })
  p.run('tSpec2();bind();'); qr.onclick()
  const q2 = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0]')
  t.ok('расчётное количество вернулось', q2.mats.find((m) => m.pid === 'p_dr').qty === 50)
  t.ok('и лист чист', p.q('Object.keys(spec2Sheet().matQty||{}).length') === 0)
}

// ── 11. Варианты выбираются переключателем ──────────────────────────────────
// Три «Утепления» в смете — это одно решение с тремя ответами. Удаление лишних
// пришлось бы повторять на каждом доме, поэтому переключатель.
{
  t.section('Один вариант из нескольких')
  const EST4 = EST.concat([
    { id: 'e_p3', kind: 'house', name: 'Утепление стен и потолка — ППУ 3 см', stage: 1, lines: [{ pid: 'p_win', qty: 1 }] },
    { id: 'e_p5', kind: 'house', name: 'Утепление стен и потолка — ППУ 5 см', stage: 1, lines: [{ pid: 'p_win', qty: 2 }] },
    { id: 'e_p8', kind: 'house', name: 'Утепление стен и потолка — ППУ 8 см', stage: 1, lines: [{ pid: 'p_win', qty: 3 }] },
  ])
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST4, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;spec2Tab="est";')

  const three = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return /ППУ/.test(x.name);}).length')
  t.ok('до группировки в доме все три', three === 3)

  // Портал сам замечает, что это варианты одного и того же, и предлагает — иначе
  // кнопку, спрятанную в редакторе строки, никто не найдёт.
  const before = p.run('tSpec2()')
  t.ok('подсказка видна прямо в списке', /Похоже, это один выбор/.test(before))
  t.ok('и перечисляет варианты с ценой', /ППУ 3 см · /.test(before) && /ППУ 8 см · /.test(before))
  t.ok('одна подсказка на семейство', (before.match(/Похоже, это один выбор/g) || []).length === 1)
  t.ok('и она собирает группу', /data-a="est-opt-auto"[^>]*data-g="Утепление стен и потолка"/.test(before))
  // Одиночную строку вариантом не считаем: у неё не из чего выбирать.
  t.ok('обычные строки подсказки не получают', !/Похоже[\s\S]{0,200}Монтаж окна/.test(before))

  // Собираем в группу одним тапом — из строки, где это видно.
  const auto = p.dom.node({ a: 'est-opt-auto', e: 'e_p5', g: 'Утепление стен и потолка' })
  p.run('tSpec2();bind();'); auto.onclick()
  t.ok('все три размечены группой', p.q('Object.keys(spec2Sheet().optOf).length') === 3)
  const one = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return /ППУ/.test(x.name);})')
  t.ok('в доме остался один', one.length === 1)
  t.ok('и это тот, из строки которого группировали', one[0].estId === 'e_p5')

  const html = p.run('tSpec2()')
  t.ok('варианты показаны переключателем', (html.match(/data-a="est-opt-pick"/g) || []).length === 3)
  t.ok('подсказка больше не нужна', !/Похоже, это один выбор/.test(html))
  t.ok('у каждого своя цена', /ППУ 8 см/.test(html) && /4 500 ₽|4\u00a0500 ₽/.test(html))
  t.ok('группа подписана', /ВЫБОР · Утепление стен и потолка/.test(html))

  // Переключаем вариант.
  const pick = p.dom.node({ a: 'est-opt-pick', g: 'Утепление стен и потолка', e: 'e_p8' })
  p.run('bind();'); pick.onclick()
  const now = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return /ППУ/.test(x.name);})')
  t.ok('в доме теперь другой вариант', now.length === 1 && now[0].estId === 'e_p8')
  t.ok('цена дома поехала за выбором', now[0].cost === 1500 * 3)
  t.ok('в объект уходит только выбранный',
    p.q('specBuildStages(spec2Sheet()).reduce(function(a,s){return a.concat(s.works);},[])')
      .filter((w) => /ППУ/.test(w.n)).length === 1)
  t.ok('справочник не тронут', p.q('estimates.filter(function(e){return /ППУ/.test(e.name);}).length') === 3)

  // Убрали строку из группы — она снова отдельная работа, остальные остались выбором.
  p.run('estWhyOpen="e_p8";tSpec2();')
  const off = p.dom.node({ a: 'est-opt-off', e: 'e_p8' })
  p.run('bind();'); off.onclick()
  t.ok('в группе осталось двое', p.q('Object.keys(spec2Sheet().optOf||{}).length') === 2)
  const after2 = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return /ППУ/.test(x.name);})')
  t.ok('в доме вышедший и один из группы', after2.length === 2)
  t.ok('вышедший — снова отдельная работа', after2.some((x) => x.estId === 'e_p8'))
  // Выбор указывал на вышедшего — берём первый оставшийся, а не обнуляем группу.
  t.ok('группа выбрала оставшийся вариант', after2.some((x) => x.estId === 'e_p3'))

  // Второй выход распускает группу: выбор из одного — не выбор.
  p.run('estWhyOpen="e_p5";tSpec2();')
  const off2 = p.dom.node({ a: 'est-opt-off', e: 'e_p5' })
  p.run('bind();'); off2.onclick()
  t.ok('группа распалась', p.q('Object.keys(spec2Sheet().optOf||{}).length') === 0)
  t.ok('и в доме снова все три',
    p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return /ППУ/.test(x.name);}).length') === 3)
}

t.done()
