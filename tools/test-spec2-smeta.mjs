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

// ── 3б. Итог сметы двумя карманами ──────────────────────────────────────────
// Этапные подытоги отвечают «сколько по этому этапу», а закупщику и бригадиру
// нужен ответ по стройке целиком: сколько всего закупать и сколько всего платить.
// Складывать этапы глазами по экрану — как раз тот счёт, который делает машина.
{
  t.section('Итого по всем этапам')
  const w = works2(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES, stages: STAGES })
  t.ok('итог материалов посчитан', typeof w.mats === 'number', 'получили: ' + w.mats)
  t.ok('итог работы посчитан', typeof w.labor === 'number', 'получили: ' + w.labor)
  t.ok('материалы = сумма по этапам',
    w.mats === w.stages.reduce((a, s) => a + s.mats, 0), 'получили: ' + w.mats)
  t.ok('работа = сумма по этапам',
    w.labor === w.stages.reduce((a, s) => a + s.labor, 0), 'получили: ' + w.labor)
  // Два кармана обязаны давать ту же себестоимость, что стоит в шапке: иначе
  // один из трёх итогов на экране врёт, и непонятно который.
  t.ok('два кармана дают себестоимость', Math.abs(w.mats + w.labor - w.cost) <= 1,
    'получили: ' + (w.mats + w.labor) + ' против ' + w.cost)
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

  const est = p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2()')
  t.ok('смета показана', /СЕБЕСТОИМОСТЬ ПО ЧЕРТЕЖУ/.test(est))
  // Справка «откуда числа» свёрнута: в шапке главные площади, подробности — по тапу.
  t.ok('справка есть, но свёрнута', /ОТКУДА ЧИСЛА/.test(est) && !/РАСКЛАДКА/.test(est))
  t.ok('и в шапке видно главные числа', /пол [\d,]+ · стены [\d,]+ м²/.test(est))
  const factsHead = p.dom.node({ a: 'est-facts-open' }); p.run('bind();'); factsHead.onclick()
  const estOpen = p.run('tSpec2()')
  t.ok('факты рядом с ней', /ОТКУДА ЧИСЛА/.test(estOpen) && /РАСКЛАДКА/.test(estOpen))
  t.ok('изделия проёмов перечислены', /ИЗДЕЛИЯ В ПРО/.test(estOpen))
  t.ok('откуда число — на строке', /Окно \d+ шт/.test(est))
  t.ok('этап подписан', /Этап 2/.test(est))
  // Справка «посчитано, но в смету не попало» свёрнута, как и остальные: в шапке
  // счёт, перечень — когда садятся писать правила.
  t.ok('пробелы показаны', /В СМЕТУ НЕ ПОПАЛО/.test(est))
  t.ok('и свёрнуты', !/правило, которого пока нет/.test(est))
  const gapsHead = p.dom.node({ a: 'est-gaps-open' }); p.run('bind();'); gapsHead.onclick()
  t.ok('раскрываются по тапу', /правило, которого пока нет/.test(p.run('tSpec2()')))
  p.run('bind();'); gapsHead.onclick()
  // Заготовка нигде не сохранена — заводить из неё объект не из чего.
  t.ok('объекта из заготовки нет', est.indexOf('data-a="spec-to-object"') < 0)
  t.ok('и договора тоже', est.indexOf('data-a="spec-to-contract"') < 0)
  t.ok('чертёж на этой вкладке не рисуется', est.indexOf('<svg') < 0)

  // Лист заведён — кнопки появились.
  p.run('spec2Tab="scheme";')
  const edit = p.dom.node({ a: 'spec2-edit' })
  p.run('bind();')
  edit.onclick()
  const est2 = p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2()')
  t.ok('по заведённому листу объект собирается', est2.indexOf('data-a="spec-to-object"') >= 0)
  t.ok('и договор заводится', est2.indexOf('data-a="spec-to-contract"') >= 0)

  // Порядок внутри этапа: взял строку — указал место. У заготовки листа нет, и
  // записывать порядок некуда, поэтому там строку и не берут.
  t.ok('у заготовки строку не берут', est.indexOf('data-a="est-pos-grab"') < 0)
  // Переставлять есть что, когда в этапе не одна работа.
  p.run('estimates=estimates.concat([{id:"e_more",kind:"house",name:"Обшивка ОСП",stage:2,lines:[{pid:"p_osb",qty:1}]}]);')
  t.ok('а у листа берут', p.run('tSpec2()').indexOf('data-a="est-pos-grab"') >= 0)
  const stKeys = () => p.q('(works2(specSheets2[0], Object.assign(specCtx(specSheets2[0]),{winTypes:winTypes})).stages.filter(function(s){return s.n===2;})[0]||{positions:[]}).positions.map(function(x){return x.key;})')
  const was = stKeys()
  if (was.length > 1) {
    const grab = p.dom.node({ a: 'est-pos-grab', k: was[0] })
    p.run('bind();'); grab.onclick()
    const held = p.run('tSpec2()')
    t.ok('места «сюда» раскрылись', held.indexOf('data-a="est-pos-drop"') >= 0)
    t.ok('и видно, какую строку несём', /ПЕРЕНОШУ/.test(held))
    // Шаг на одну строку — той же взятой строкой: стрелки живут только у неё.
    t.ok('у взятой строки есть стрелки', (held.match(/data-a="est-pos-step"/g) || []).length === 2)
    const step = p.dom.node({ a: 'est-pos-step', k: was[0], d: '1' })
    p.run('bind();'); step.onclick()
    t.ok('шаг вниз сработал', stKeys()[0] === was[1], stKeys().join(','))
    t.ok('и строка осталась взятой', p.q('estMoveKey') === was[0])
    const stepUp = p.dom.node({ a: 'est-pos-step', k: was[0], d: '-1' })
    p.run('bind();'); stepUp.onclick()
    t.ok('шаг вверх вернул как было', stKeys().join(',') === was.join(','))

    const slot = p.dom.node({ a: 'est-pos-drop', k: was[0], i: String(was.length) })
    p.run('bind();'); slot.onclick()
    t.ok('работа встала на указанное место', stKeys().join(',') === was.slice(1).concat([was[0]]).join(','),
      was.join(',') + ' → ' + stKeys().join(','))
    t.ok('порядок записан в опытный лист', !!p.q('specSheets2[0].posOrder'))
    t.ok('справочник не тронут', p.q('estimates.length') === 4)
    t.ok('строку отпустили', p.q('estMoveKey') === '')
  } else {
    t.ok('в этапе есть что переставлять', false, 'строк: ' + was.length)
  }
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

  const est = p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2()')
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

  const est = p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2()')
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
  const lopen = p.dom.node({ a: 'est-mat-open', k: lkey }); p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();bind();'); lopen.onclick()
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
  const est0 = p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2()')
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

  // Порядок материалов внутри строки — тот же жест: взял и указал место.
  {
    const mkeys = () => p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0].mats.map(function(m){return m.pid||m.id;})')
    const before = mkeys()
    t.ok('в строке несколько материалов', before.length >= 2, before.join(','))
    const mk = q2.key + '|' + before[before.length - 1]
    t.ok('у материала есть ↕', p.run('tSpec2()').indexOf('data-a="est-mat-grab"') >= 0)
    const grabM = p.dom.node({ a: 'est-mat-grab', k: mk }); p.run('bind();'); grabM.onclick()
    t.ok('места «сюда» раскрылись', p.run('tSpec2()').indexOf('data-a="est-mat-drop"') >= 0)
    const slotM = p.dom.node({ a: 'est-mat-drop', k: mk, i: '0' }); p.run('bind();'); slotM.onclick()
    t.ok('материал встал первым', mkeys()[0] === before[before.length - 1], mkeys().join(','))
    t.ok('порядок записан в опытный лист', !!p.q('spec2Sheet().matOrder'))
    const g2M = p.dom.node({ a: 'est-mat-grab', k: mk }); p.run('bind();'); g2M.onclick()
    const backM = p.dom.node({ a: 'est-mat-drop', k: mk, i: String(before.length) }); p.run('bind();'); backM.onclick()
    t.ok('и возвращается на место', mkeys().join(',') === before.join(','), mkeys().join(','))
  }

  // Материал можно и убрать: смета описывает типовой дом, а на этом гофру ведут
  // в готовом кабель-канале. Справочник при этом общий — правка живёт на листе.
  const wasCost = q2.cost
  const okey = q2.key + '|p_dr'
  t.ok('крестик есть у каждого материала', p.run('tSpec2()').indexOf('data-a="est-mat-off"') >= 0)
  const drop = p.dom.node({ a: 'est-mat-off', k: okey }); p.run('bind();'); drop.onclick()
  const d1 = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0]')
  t.ok('материала в строке нет', !d1.mats.some((m) => m.pid === 'p_dr'))
  t.ok('и цена строки упала на него', d1.cost === wasCost - 800 * 50, 'строка ' + d1.cost)
  t.ok('убранное лежит на листе', p.q('spec2Sheet().matOff[' + JSON.stringify(q2.key) + '].join(",")') === 'p_dr')
  t.ok('справочник не тронут', p.q('estimates.find(function(e){return e.id==="e_el";}).lines.length') === 2)
  const shownOff = p.run('tSpec2()')
  t.ok('в строке видно, что убрано', /УБРАНО ИЗ ЭТОГО ДОМА/.test(shownOff))
  t.ok('и названо по имени', /Наличник ⟲/.test(shownOff))
  // Смотрим ИМЕННО эту работу: тот же товар честно стоит и в монтаже двери.
  const built2 = p.q('specBuildStages(spec2Sheet()).reduce(function(a,s){return a.concat(s.works);},[])')
    .filter((w) => w.estId === 'e_el')
  t.ok('работа на стройке есть', built2.length === 1, 'работ: ' + built2.length)
  t.ok('на стройку убранное не уезжает', !(built2[0].mats || []).some((m) => m.pid === 'p_dr'))

  // Возвращается тем же тапом: «нет в этом доме» — решение, а не удаление.
  const back2 = p.dom.node({ a: 'est-mat-on', k: okey }); p.run('bind();'); back2.onclick()
  const d2 = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0]')
  t.ok('материал вернулся', d2.mats.some((m) => m.pid === 'p_dr'))
  t.ok('и цена прежняя', d2.cost === wasCost, 'строка ' + d2.cost)
  t.ok('лист чист', !p.q('spec2Sheet().matOff'))

  // Убрали всё — список всё равно показан: иначе вернуть было бы нечем.
  const o1 = p.dom.node({ a: 'est-mat-off', k: okey }); p.run('bind();'); o1.onclick()
  const o2 = p.dom.node({ a: 'est-mat-off', k: q2.key + '|p_win' }); p.run('bind();'); o2.onclick()
  const empty = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_el";})[0]')
  t.ok('в строке не осталось материалов', empty.mats.length === 0)
  t.ok('и она ничего не стоит', empty.cost === 0)
  t.ok('но вернуть можно оба', (p.run('tSpec2()').match(/data-a="est-mat-on"/g) || []).length === 2)
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
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";')

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

// ── 12. Этап читается блоками по помещениям ─────────────────────────────────
// Экран сметы у опытного раздела и у проекта ОДИН, и правка делается сразу в
// обоих: здесь сторожим ту же группировку со стороны «Спецификации 2».
{
  t.section('Блоки по помещениям')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [
      { id: 'r_w', kind: 'house', estId: 'e_wall', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 3 },
      { id: 'r_f', kind: 'house', estId: 'e_dr', what: 'surface', k: 'floor', scope: 'room', qty: 1, stage: 3 },
    ],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  const est = p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2()')
  const st = () => p.q('works2(spec2Sheet(), Object.assign(specCtx(spec2Sheet()),{winTypes:winTypes})).stages.filter(function(s){return s.n===3;})[0]')
  const blocks = st().blocks
  t.ok('этап разложен по комнатам', blocks.length >= 2, 'блоков: ' + blocks.length)
  t.ok('в блоке работы одной комнаты',
    blocks[0].positions.every((x) => x.room === blocks[0].room), JSON.stringify(blocks[0].room))
  t.ok('сумма блоков равна сумме этапа',
    blocks.reduce((a, b) => a + b.cost, 0) === Math.round(st().cost))
  t.ok('заголовки блоков на экране', (est.match(/data-a="est-block-open"/g) || []).length === blocks.length)

  // Блоки помещений различаются цветом. Этап из четырёх комнат одинаковыми серыми
  // шапками читается как один длинный список: глаз не цепляется за границу, и
  // работу ищут прокруткой. Цвет берём из справочника комнат — тот же, что на
  // остальных экранах, иначе санузел был бы бирюзовым в шаблоне и серым в смете.
  const heads = est.split('data-a="est-block-open"').slice(1).map((x) => x.slice(0, 500))
  const colOf = (x) => ((x.match(/color:(#[0-9a-f]{6})/i) || [])[1] || '').toLowerCase()
  const cols = heads.map(colOf)
  t.ok('у каждого блока свой цвет', cols.every(Boolean) && new Set(cols).size === cols.length,
    'цвета: ' + JSON.stringify(cols))
  // Общий блок есть не в каждой смете: здесь все работы разложены по комнатам.
  const common = heads.find((x) => /Общее по дому/.test(x))
  if (common) t.ok('«общее по дому» — нейтральное серо-синее', colOf(common) === '#7a9aaa', colOf(common))
  // Имя комнаты сверяем со справочником по смыслу, а не по написанию: на чертеже
  // пишут «Санузел», в справочнике — «Сан узел».
  const known = { 'зал': '#8e44ad', 'спальня': '#2980b9', 'санузел': '#16a085', 'коридор': '#e67e22' }
  const named = heads.filter((x) => !/Общее по дому/.test(x))
  named.forEach((x) => {
    const nm = ((x.match(/>[▸▾] ([^<·]+)/) || [])[1] || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[^а-я]/g, '')
    if (!known[nm]) return
    t.ok('цвет «' + nm + '» — как в справочнике комнат', colOf(x) === known[nm], 'получили: ' + colOf(x))
  })

  const head = p.dom.node({ a: 'est-block-open', b: '3|' + blocks[0].key })
  p.run('bind();'); head.onclick()
  t.ok('блок сворачивается',
    (p.run('tSpec2()').match(/data-a="est-block-open"/g) || []).length === blocks.length)
  t.ok('и в листе от этого ничего не записалось', !p.q('spec2Sheet().blockShut'))
  p.run('bind();'); head.onclick()

  // Блоки правятся и здесь: экран сметы у двух разделов один.
  const st2 = () => p.q('works2(spec2Sheet(), Object.assign(specCtx(spec2Sheet()),{winTypes:winTypes})).stages.filter(function(s){return s.n===3;})[0]')
  const key = blocks[0].positions[0].key
  const to = p.q('works2(spec2Sheet(), Object.assign(specCtx(spec2Sheet()),{winTypes:winTypes})).rooms')
    .filter((r) => r.id !== blocks[0].key)[0]
  const grab = p.dom.node({ a: 'est-pos-grab', k: key }); p.run('bind();'); grab.onclick()
  t.ok('комнаты предложены', /ПЕРЕНЕСТИ В/.test(p.run('tSpec2()')))
  const chip = p.dom.node({ a: 'est-pos-room', k: key, r: to.id }); p.run('bind();'); chip.onclick()
  t.ok('работа переехала в другую комнату',
    st2().blocks.filter((b) => b.key === to.id)[0].positions.some((x) => x.key === key),
    st2().blocks.map((b) => (b.room || 'ДОМ') + ':' + b.positions.length).join(' | '))
  t.ok('приписка лежит в опытном листе', p.q('spec2Sheet().posRoom[' + JSON.stringify(key) + ']') === to.id)

  // Имя помещения правится над его работами и живёт в модели.
  p.run('window.prompt=function(){return "Мойка"};')
  const ren = p.dom.node({ a: 'est-room-name', r: to.id }); p.run('bind();'); ren.onclick()
  t.ok('помещение переименовано', st2().blocks.some((b) => b.room === 'Мойка'),
    st2().blocks.map((b) => b.room).join(','))
  t.ok('и имя взято из модели',
    p.q('modelRooms(spec2Sheet().model).filter(function(r){return r.id===' + JSON.stringify(to.id) + ';})[0].name') === 'Мойка')
}

// ── 13. Своя работа и её цена ───────────────────────────────────────────────
// Экран сметы у двух разделов один: здесь сторожим ту же строку со стороны
// «Спецификации 2» — у работы, вписанной руками, крестик удаляет её саму.
{
  t.section('Своя работа в опытном разделе')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  const open = p.dom.node({ a: 'est-pos-add-open', k: p.q('spec2Sheet().id') })
  p.run('bind();'); open.onclick()
  p.dom.field('pad-n', 'Сборка стеллажей'); p.dom.field('pad-cost', '500'); p.dom.field('pad-stage', '1')
  p.run('tSpec2();')
  const go = p.dom.node({ a: 'est-pos-add-do', k: p.q('spec2Sheet().id') })
  p.run('bind();'); go.onclick()
  const own = () => p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.name==="Сборка стеллажей";})[0]')
  t.ok('работа появилась', !!own() && own().cost === 500)
  const key = own().key
  p.run('matsOpen[' + JSON.stringify(key) + ']=1;')
  const html = p.run('tSpec2()')
  t.ok('фантомной строки материала нет', html.indexOf('data-a="est-mat-off" data-k="' + key + '|"') < 0)
  t.ok('крестик работы на месте', html.indexOf('data-a="est-pos-del" data-k="' + key + '"') >= 0)
  const del = p.dom.node({ a: 'est-pos-del', k: key }); p.run('bind();'); del.onclick()
  t.ok('и удаляет её', !own())
}

// ── 14. Две цифры в строке: материалы и работа ──────────────────────────────
// Экран сметы у двух разделов один — сторожим ту же раскладку здесь.
{
  t.section('Материалы и работа порознь')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  const plain = () => p.run('tSpec2()').replace(/<[^>]*>/g, '').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('раскладка есть в каждой строке', /материалы [\d ]+ ₽ · работа [\d ]+ ₽/.test(plain()), 'нет раскладки')

  const key = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions[0].key')
  const fieldHtml = () => (p.run('tSpec2()').match(/data-a="est-pos-cost"[^>]*/) || [''])[0]
  t.ok('поле цены пустое и подписано «работа»',
    /value=""/.test(fieldHtml()) && /placeholder="работа"/.test(fieldHtml()), fieldHtml().slice(0, 120))
  const inp = p.dom.node({ a: 'est-pos-cost', k: key })
  p.run('bind();'); inp.value = '7000'; inp.onchange()
  t.ok('цена бригаде видна отдельно', /· работа 7 000 ₽/.test(plain()))

  const st = p.q('works2(spec2Sheet(), Object.assign(specCtx(spec2Sheet()),{winTypes:winTypes})).stages.filter(function(s){return s.positions.some(function(x){return x.key===' + JSON.stringify(key) + ';});})[0]')
  t.ok('этап делит свою сумму так же', st.mats + st.labor === Math.round(st.cost), st.mats + ' + ' + st.labor + ' vs ' + st.cost)
  t.ok('и подытоги видны в шапке этапа', /материалы [\d ]+ ₽ · работа [\d ]+ ₽/.test(plain()))
  // Итог по стройке целиком — последняя строка списка этапов: складывать этапы
  // глазами приходилось при каждом разговоре с закупщиком.
  const tot = p.q('(function(){var w=works2(spec2Sheet(), Object.assign(specCtx(spec2Sheet()),{winTypes:winTypes}));return {m:w.mats,l:w.labor,c:w.cost};})()')
  const ru = (n) => n.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ')
  const totBlock = plain().split('ИТОГО ПО ВСЕМ ЭТАПАМ')[1] || ''
  t.ok('итог стоит под этапами', totBlock.length > 0, 'блока нет')
  t.ok('в итоге общая сумма', totBlock.indexOf(ru(tot.c)) >= 0, totBlock.slice(0, 140))
  t.ok('и те же два кармана',
    totBlock.indexOf('материалы ' + ru(tot.m) + ' ₽ · работа ' + ru(tot.l) + ' ₽') >= 0, totBlock.slice(0, 180))
  // Те же пять правок строки — экран сметы у двух разделов один.
  const html2 = p.run('tSpec2()')
  t.ok('итог строки виден в шапке',
    /font-size:13px;font-weight:800[^>]*white-space:nowrap">[\d\s\u00a0]+ ₽/.test(html2))
  t.ok('«работа» в раскладке ведёт в поле цены', html2.indexOf('data-a="est-pos-cost-focus"') >= 0)
  t.ok('чип режима стоит всегда', html2.indexOf('data-a="est-pos-cost-mode"') >= 0)
  // Строка читается сверху вниз: имя и итог — чипы — управление.
  t.ok('имя не длиннее двух строк', /-webkit-line-clamp:2/.test(html2))
  t.ok('этап спрятан за кнопкой', html2.indexOf('data-a="est-pos-stage-pick"') >= 0)
  t.ok('строки разделяет воздух', /padding:12px 0/.test(html2))
  p.run('matsOpen[' + JSON.stringify(key) + ']=1;')
  const marks2 = p.run('tSpec2()')
  t.ok('✕ материала приглушён', /data-a="est-mat-off"[^>]*color:#9aabbf/.test(marks2))
  t.ok('✕ работы красный', /data-a="est-pos-del"[^>]*color:#e74c3c/.test(marks2))
}

// ── 9. План в человеко-часах ────────────────────────────────────────────────
// Сколько денег бригаде — уже видно, а сколько это времени — нет. План ставит
// хозяин, и живёт он в ЛИСТЕ дома: справочник смет общий на все объекты, и часы
// одного дома не должны становиться часами всех.
{
  t.section('План работ в человеко-часах')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')

  const key = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions[0].key')
  const html = p.run('tSpec2()')
  t.ok('у работы есть поле часов', html.indexOf('data-a="est-pos-hours"') >= 0)
  t.ok('и оно подписано часами', /placeholder="ч"/.test(html) || /план, ч/.test(html), 'нет подписи')

  const inp = p.dom.node({ a: 'est-pos-hours', k: key })
  p.run('bind();'); inp.value = '8'; inp.onchange()
  t.ok('план записан в лист дома', p.q('spec2Sheet().posHours[' + JSON.stringify(key) + ']') === 8,
    'получили: ' + p.q('spec2Sheet().posHours[' + JSON.stringify(key) + ']'))
  t.ok('справочник смет не тронут', p.q('estimates.every(function(e){return e.hours==null;})'))

  const w = () => p.q('(function(){var x=works2(spec2Sheet(), Object.assign(specCtx(spec2Sheet()),{winTypes:winTypes}));return {h:x.hours,ph:x.positions.filter(function(q){return q.key===' + JSON.stringify(key) + ';})[0].hours,sh:x.stages.map(function(s){return s.hours;})};})()')
  t.ok('позиция знает свой план', w().ph === 8, 'получили: ' + w().ph)
  t.ok('часы сложились по смете', w().h === 8, 'получили: ' + w().h)
  t.ok('и по этапу', w().sh.reduce((a, b) => a + b, 0) === 8, 'получили: ' + JSON.stringify(w().sh))

  const plain = () => p.run('tSpec2()').replace(/<[^>]*>/g, '').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('план виден в итоге', /план 8 ч/.test(plain()), 'нет строки плана')

  // Пустое поле — это «плана нет», а не «ноль часов»: иначе лист копил бы нули по
  // каждой строке, которую человек просто потрогал.
  p.run('bind();'); inp.value = ''; inp.onchange()
  t.ok('пустое поле убирает план', p.q('spec2Sheet().posHours[' + JSON.stringify(key) + ']') == null)
  t.ok('и часы из итога уходят', p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).hours') === 0)
}

// ── 10. Часы вводятся тапом, а не набором ───────────────────────────────────
// Набирать «6» на телефоне в поле шириной в палец — там же, где рядом стоит поле
// цены, — способ поставить план не туда. Готовый ряд 1..10 закрывает почти все
// случаи, дробные (0,5 ч) остаются в поле.
{
  t.section('Быстрый выбор часов')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  const key = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions[0].key')

  t.ok('пока не тапнули — ряда нет', p.run('tSpec2()').indexOf('data-a="est-pos-hours-set"') < 0)

  const inp = p.dom.node({ a: 'est-pos-hours', k: key })
  p.run('bind();'); inp.onclick()
  const opened = p.run('tSpec2()')
  const chips = opened.match(/data-a="est-pos-hours-set"/g) || []
  t.ok('по тапу открывается ряд часов', chips.length >= 10, 'кнопок: ' + chips.length)
  t.ok('есть и 1, и 10', /data-h="1"/.test(opened) && /data-h="10"/.test(opened))
  t.ok('и полчаса для мелких работ', /data-h="0.5"/.test(opened))
  t.ok('поле для ручного ввода осталось', opened.indexOf('data-a="est-pos-hours"') >= 0)

  const chip = p.dom.node({ a: 'est-pos-hours-set', k: key, h: '6' })
  p.run('bind();'); chip.onclick()
  t.ok('тап по «6» ставит план', p.q('spec2Sheet().posHours[' + JSON.stringify(key) + ']') === 6,
    'получили: ' + p.q('spec2Sheet().posHours[' + JSON.stringify(key) + ']'))
  t.ok('и ряд закрывается', p.run('tSpec2()').indexOf('data-a="est-pos-hours-set"') < 0)
}

// ── 11. Комнаты — только на чистовом этапе ──────────────────────────────────
// Подготовительные и черновые работы делают по всему дому разом: утепление,
// обрешётка, электрика. Дробить их на «санузел/зал/спальню» — придумывать
// границы, которых на стройке нет, и превращать короткий этап в три коротких
// блока. Комната имеет смысл там, где по ней и работают, — на чистовом этапе
// (его же спрашивают у сметы в карточке: «КОМНАТА (для чистового этапа)»).
{
  t.section('Разбивка по комнатам только на чистовом этапе')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [
      // Одна и та же работа по комнатам, но на РАЗНЫХ этапах: чистовой делится,
      // черновой — нет.
      { id: 'r_f2', kind: 'house', estId: 'e_dr', what: 'surface', k: 'floor', scope: 'room', qty: 1, stage: 2 },
      { id: 'r_w3', kind: 'house', estId: 'e_wall', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 3 },
    ],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')

  const stg = (n) => p.q('works2(spec2Sheet(), Object.assign(specCtx(spec2Sheet()),{winTypes:winTypes})).stages.filter(function(s){return s.n===' + n + ';})[0]')
  const s2 = stg(2), s3 = stg(3)
  t.ok('на черновом работы по комнатам есть', s2 && s2.positions.length >= 2, 'позиций: ' + (s2 && s2.positions.length))
  t.ok('но блоков он не заводит', s2 && s2.blocks.length === 0, 'блоков: ' + (s2 && s2.blocks.length))
  t.ok('чистовой по-прежнему делится', s3 && s3.blocks.length >= 2, 'блоков: ' + (s3 && s3.blocks.length))
  // Строки при этом никуда не деваются — пропасть работам нельзя.
  const html = p.run('tSpec2()')
  t.ok('работы чернового видны', (html.match(/data-a="est-pos-del"/g) || []).length >=
    (s2.positions.length + s3.positions.length), 'строк меньше, чем позиций')
  t.ok('сумма этапа сходится со строками',
    s2.cost === s2.positions.reduce((a, x) => a + x.cost, 0))
  // Комната у самой работы остаётся: она нужна и для чипа в строке, и для переноса.
  t.ok('комната у позиции сохранена', s2.positions.some((x) => !!x.room), 'ни у одной нет комнаты')
}

// ── Цены материалов по каталогу ─────────────────────────────────────────
// Экран сметы у двух разделов ОДИН: то же самое сторожит test-projects. Здесь
// проверяем вторую половину — что правка доехала и до опытного листа.
{
  t.section('Цены материалов по каталогу')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  const key = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_win";})[0].key')
  const posOf = () => p.q('allPositions(spec2Sheet(), specCtx(spec2Sheet())).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  p.run('matsOpen[' + JSON.stringify(key) + ']=1;tSpec2();')

  // Дописываем товар ИЗ БАЗЫ, но по своей цене: 300 ₽ против 800 ₽ в каталоге.
  const addOpen = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); addOpen.onclick()
  p.dom.field('mad-n', 'Наличник'); p.dom.field('mad-qty', '2'); p.dom.field('mad-cost', '300')
  const addDo = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); addDo.onclick()
  const mid = p.q('spec2Sheet().matAdd[' + JSON.stringify(key) + '][0].id')

  const html = p.run('tSpec2()').replace(/[  ]/g, ' ')
  t.ok('строка говорит, что в базе дороже', /в базе 800 ₽/.test(html), 'нет пометки о каталоге')
  t.ok('и обновление — одним тапом',
    html.indexOf('data-a="est-mat-price" data-k="' + key + '|+' + mid + '"') >= 0, 'нет кнопки у материала')
  const stN = p.q('works2(spec2Sheet(), Object.assign(specCtx(spec2Sheet()),{winTypes:winTypes})).stages.filter(function(s){return (s.positions||[]).some(function(x){return x.key===' + JSON.stringify(key) + ';});})[0].n')
  t.ok('и кнопка этапа зажглась',
    new RegExp('data-a="est-stage-prices" data-n="' + stN + '"(?! disabled)').test(html), 'кнопка выключена')

  const cost0 = posOf().cost
  const one = p.dom.node({ a: 'est-mat-price', k: key + '|+' + mid }); p.run('bind();'); one.onclick()
  const posA = posOf()
  t.ok('цена материала стала каталожной',
    (posA.mats || []).filter((m) => m.added)[0].cost === 800,
    JSON.stringify((posA.mats || []).filter((m) => m.added).map((m) => m.cost)))
  t.ok('и строка подорожала на разницу', posA.cost === cost0 + 1000, cost0 + ' → ' + posA.cost)
  t.ok('правка легла в опытный лист',
    p.q('spec2Sheet().matAdd[' + JSON.stringify(key) + '][0].cost') === 800)
  t.ok('справочник товаров не тронут',
    p.q('expProducts.filter(function(x){return x.id==="p_dr";})[0].unitCost') === 800)
  t.ok('кнопка этапа погасла',
    new RegExp('data-a="est-stage-prices" data-n="' + stN + '" disabled').test(p.run('tSpec2()')),
    'кнопка всё ещё горит')

  // И тот же материал — кнопкой этапа, оптом.
  p.run('spec2Sheet().matAdd[' + JSON.stringify(key) + '][0].cost=300;tSpec2();')
  const stage = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); stage.onclick()
  t.ok('этап обновил копию', p.q('spec2Sheet().matAdd[' + JSON.stringify(key) + '][0].cost') === 800,
    String(p.q('spec2Sheet().matAdd[' + JSON.stringify(key) + '][0].cost')))

  // История цены товара: строка отвечает на «почему подорожало» сама.
  p.run('expProducts.filter(function(x){return x.id==="p_win";})[0].hist=[{at:"2026-01-10T00:00:00Z",c:1200,by:"Иван"},{at:"2026-03-01T00:00:00Z",c:1500,by:"Иван"}];')
  const withHist = p.run('tSpec2()').replace(/[  ]/g, ' ')
  t.ok('в строке видно прежнюю цену', /было 1 200 ₽/.test(withHist), 'истории нет в строке')
  t.ok('и когда её правили', withHist.indexOf('цена до 10.01.26') >= 0, 'нет даты правки')
}

// ── Дописан тот же товар, что в расчёте ─────────────────────────────────────
// Экран сметы у двух разделов ОДИН: то же самое сторожит test-projects. Адрес
// материала был «его товар», и дописанная вторая фасовка жила по одному адресу с
// расчётной строкой — количество, порядок и «убрать» доставались обеим сразу.
{
  t.section('Дописан тот же товар, что в расчёте')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
    buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  const key = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_win";})[0].key')
  const posOf = () => p.q('allPositions(spec2Sheet(), specCtx(spec2Sheet())).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  p.run('matsOpen[' + JSON.stringify(key) + ']=1;tSpec2();')
  const base = (posOf().mats || []).filter((m) => m.pid === 'p_win')[0]
  t.ok('в строке уже есть этот товар', !!base)

  const addOpen = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); addOpen.onclick()
  p.dom.field('mad-n', 'Монтажный комплект окна'); p.dom.field('mad-qty', '1'); p.dom.field('mad-cost', '1500')
  const addDo = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); addDo.onclick()
  const mid = p.q('spec2Sheet().matAdd[' + JSON.stringify(key) + '][0].id')
  t.ok('в строке две записи товара',
    (posOf().mats || []).filter((m) => m.pid === 'p_win').length === 2)

  const qty = p.dom.node({ a: 'est-mat-qty', k: key + '|+' + mid })
  qty.value = '5'; p.run('bind();'); qty.onchange()
  const now = posOf()
  const added = (now.mats || []).filter((m) => m.added)[0]
  const calc = (now.mats || []).filter((m) => !m.added && m.pid === 'p_win')[0]
  t.ok('количество досталось дописанному', added && added.qty === 5, JSON.stringify(added && added.qty))
  t.ok('а расчётный остался как был', calc && calc.qty === base.qty && !calc.qtySet,
    JSON.stringify(calc && [calc.qty, !!calc.qtySet]))
  t.ok('правка адресована своим ключом',
    p.q('spec2Sheet().matQty[' + JSON.stringify(key) + '][' + JSON.stringify('+' + mid) + ']') === 5)

  const drop = p.dom.node({ a: 'est-mat-off', k: key + '|p_win' }); p.run('bind();'); drop.onclick()
  const left = posOf()
  t.ok('убрался только расчётный',
    (left.mats || []).filter((m) => m.pid === 'p_win').length === 1
    && (left.mats || []).filter((m) => m.pid === 'p_win')[0].added === true,
    JSON.stringify((left.mats || []).map((m) => [m.pid, !!m.added])))
}

// ── Один товар дважды в самой смете ─────────────────────────────────────────
// Экран сметы у двух разделов ОДИН: то же самое сторожит test-projects. Адресом
// обеих строк был один товар, поэтому замена меняла товар в обеих, а ручное
// количество доставалось обеим.
{
  t.section('Один товар дважды в смете')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS.concat([{ id: 'p_ply', name: 'Фанера 4 мм', unitCost: 700, store: 'Лемана', mode: 'piece' }]),
    estimates: [{ id: 'e_win', kind: 'house', name: 'Монтаж окна', stage: 2, optPoint: 'win',
      lines: [{ pid: 'p_win', qty: 1 }, { pid: 'p_win', qty: 2 }] }],
    dbPlans: [], crmClients: [], specSheets: [], specSheets2: [], winTypes: [], objects: [],
    templates: [], contractDocs: [], purchases: [], issues: [], users: [], stock: [],
    settings: { specMarkup: 30 }, buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  const key = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions.filter(function(x){return x.estId==="e_win";})[0].key')
  const posOf = () => p.q('allPositions(spec2Sheet(), specCtx(spec2Sheet())).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  p.run('matsOpen[' + JSON.stringify(key) + ']=1;tSpec2();')
  t.ok('в строке две записи товара', posOf().mats.length === 2,
    JSON.stringify(posOf().mats.map((m) => [m.pid, m.qty])))

  const html = p.run('tSpec2()')
  t.ok('у первой прежний адрес', html.indexOf('data-a="est-mat-qty" data-k="' + key + '|p_win"') >= 0)
  t.ok('у повтора свой', html.indexOf('data-a="est-mat-qty" data-k="' + key + '|p_win#2"') >= 0,
    'адрес повтора не проставлен')

  const open = p.dom.node({ a: 'est-mat-open', k: key + '|p_win' }); p.run('bind();'); open.onclick()
  p.run('tSpec2();')
  p.dom.field('msw-input', 'Фанера 4 мм')
  const doIt = p.dom.node({ a: 'est-mat-do', k: key + '|p_win' }); p.run('bind();'); doIt.onclick()
  const after = posOf().mats
  t.ok('заменилась одна строка', after.filter((m) => m.pid === 'p_ply').length === 1,
    JSON.stringify(after.map((m) => m.pid)))
  t.ok('и это первая', after[0].pid === 'p_ply' && after[1].pid === 'p_win',
    JSON.stringify(after.map((m) => m.pid)))

  const qty = p.dom.node({ a: 'est-mat-qty', k: key + '|p_win#2' })
  qty.value = '9'; p.run('bind();'); qty.onchange()
  const now = posOf().mats
  t.ok('количество досталось повтору', now[1].qty === 9, JSON.stringify(now.map((m) => m.qty)))
  t.ok('а первая строка своё сохранила', !now[0].qtySet, JSON.stringify([now[0].qty, !!now[0].qtySet]))
}

t.done()

