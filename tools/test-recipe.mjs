#!/usr/bin/env node
// Правила сборки (src/recipe.js): чертёж → работы без ручного выбора.
//
// Правило говорит только, К ЧЕМУ применяется смета из справочника, а считается
// позиция общей машинкой. Сторожим ровно это: что правило берёт числа из модели,
// что материалы остаются сметиными, что недонастроенное правило молчит и что
// список из справочника и список из правил складываются, а не подменяют друг друга.
import { presetModel, MODEL_PRESETS } from '../src/model.js'
import { sheetPositions } from '../src/spec.js'
import { rulePositions, allPositions, allPositionsRaw, ruleText, ruleReady, probeSheet,
  layerPositions, pieArea, pieCost, applyPicks, optLabelOf, optPrefixOf, applyRooms, roomKeyOf, posRoomOf, ROOM_HOUSE, applyMatEdits, matOrderOf, matKeyOf, matAddKey, matAddrPid, matAddrSwap, stampMatIx, migrateMatAddrs } from '../src/recipe.js'
import { modelAreas, modelTotals, applyLayers } from '../src/model.js'
import { gaps2 } from '../src/spec2.js'

const t = reporterOf()
function reporterOf() {
  let failed = 0
  return {
    section: (n) => console.log(n),
    ok: (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) },
    done: () => { console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли'); process.exit(failed ? 1 : 0) },
  }
}

let seq = 0
const gid = () => 'id' + (++seq)

const PRODUCTS = [
  { id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана', mode: 'm2' },
  { id: 'p_tile', name: 'Плитка', unitCost: 2000, store: 'Лемана', mode: 'm2' },
  { id: 'p_sock', name: 'Розетка', unitCost: 300, store: 'Белка', mode: 'piece' },
  { id: 'p_wall', name: 'Брус 50', unitCost: 500, store: 'Белка', mode: 'piece' },
]
const EST = [
  { id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2, lines: [{ pid: 'p_osb', qty: 1 }] },
  { id: 'e_tile', kind: 'house', name: 'Плитка на пол', stage: 3, lines: [{ pid: 'p_tile', qty: 1 }] },
  { id: 'e_sock', kind: 'house', name: 'Монтаж розетки', stage: 2, lines: [{ pid: 'p_sock', qty: 1 }] },
  { id: 'e_part', kind: 'house', name: 'Каркас перегородки', stage: 1, lines: [{ pid: 'p_wall', qty: 10 }] },
  { id: 'e_banya', kind: 'banya', name: 'Чужой вид', stage: 1, lines: [{ pid: 'p_osb', qty: 1 }] },
]

const built = presetModel(MODEL_PRESETS[0], [], gid)
const TYPES = built.winTypes
// Раскладку задаём руками: заготовка знает проёмы, но розетки на ней никто не расставлял.
const model = JSON.parse(JSON.stringify(built.model))
model.rooms[1].pts = Object.assign({}, model.rooms[1].pts, { sock: 6 })
model.rooms[2].pts = Object.assign({}, model.rooms[2].pts, { sock: 4 })
model.rooms[0].name = 'Санузел'

const SHEET = {
  id: 'lab', name: 'Опытный', kind: 'house', markup: 0, model: model,
  specs: { height: 2.5, rooms: [], openings: [] }, rooms: {}, global: {}, qty: {},
}
const rooms = probeSheet(SHEET, TYPES).specs.rooms
const run = (rules) => rulePositions(SHEET, rules, EST, PRODUCTS, TYPES)
const R = (o) => Object.assign({ id: 'r1', kind: 'house', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 0 }, o)

// ── 1. Площади ──────────────────────────────────────────────────────────────
{
  t.section('Правило по площади')
  const byRoom = run([R({ estId: 'e_osb' })])
  t.ok('строка на каждое помещение', byRoom.length === rooms.length)
  t.ok('площадь взята у своего помещения',
    byRoom.every((p) => p.area > 0) && byRoom.some((p) => p.room === 'Санузел'))
  t.ok('материал считается по площади',
    byRoom[0].mats[0].qty === byRoom[0].area)
  t.ok('деньги — площадь × цена', byRoom[0].cost === Math.round(byRoom[0].area * 1000))
  t.ok('откуда число — сказано', /стены [\d,]+ м²/.test(byRoom[0].why))
  t.ok('и помечено правилом', byRoom.every((p) => p.from === 'rule' && p.ruleId === 'r1'))

  const whole = run([R({ estId: 'e_osb', scope: 'house' })])
  t.ok('на весь дом — одна строка', whole.length === 1)
  t.ok('и площадь суммарная',
    Math.abs(whole[0].area - byRoom.reduce((a, p) => a + p.area, 0)) < 0.05)

  const floor = run([R({ estId: 'e_tile', k: 'floor', scope: 'house' })])
  t.ok('пол меряется полом', floor[0].area === rooms.reduce((a, r) => a + r.floor, 0))
  t.ok('этап берётся из сметы', floor[0].stage === 3)
}

// ── 2. Точки раскладки ──────────────────────────────────────────────────────
{
  t.section('Правило по точкам')
  const byRoom = run([R({ estId: 'e_sock', what: 'point', k: 'sock' })])
  t.ok('только там, где точки есть', byRoom.length === 2)
  t.ok('количество — по своему помещению', byRoom.map((p) => p.count).sort().join(',') === '4,6')
  t.ok('деньги от числа точек', byRoom.reduce((a, p) => a + p.cost, 0) === 10 * 300)

  const whole = run([R({ estId: 'e_sock', what: 'point', k: 'sock', scope: 'house' })])
  t.ok('на дом — одна строка на все точки', whole.length === 1 && whole[0].count === 10)
  t.ok('и объяснение про штуки', whole[0].why === 'Розетка 10 шт')

  // Проёмы модель кладёт в раскладку сама — правило по окнам ничего не знает
  // о проёмах, оно знает про точки.
  const wins = run([R({ estId: 'e_sock', what: 'point', k: 'win', scope: 'house' })])
  t.ok('окна считаются той же машинкой', wins.length === 1 && wins[0].count > 0)
  t.ok('точки, которой нет, не дают строки',
    run([R({ estId: 'e_sock', what: 'point', k: 'rad' })]).length === 0)
}

// ── 3. Фильтр помещений и множитель ─────────────────────────────────────────
{
  t.section('Где применяется и сколько раз')
  const only = run([R({ estId: 'e_tile', k: 'floor', room: 'санузел' })])
  t.ok('фильтр по части имени', only.length === 1 && only[0].room === 'Санузел')
  t.ok('регистр не важен', run([R({ estId: 'e_tile', k: 'floor', room: 'САНУЗЕЛ' })]).length === 1)
  t.ok('чужого имени нет — нет и строк', run([R({ estId: 'e_tile', k: 'floor', room: 'терраса' })]).length === 0)

  const one = run([R({ estId: 'e_tile', k: 'floor', room: 'санузел' })])[0]
  const twice = run([R({ estId: 'e_tile', k: 'floor', room: 'санузел', qty: 2 })])[0]
  t.ok('множитель удваивает сумму', twice.cost === one.cost * 2)

  const each = run([R({ estId: 'e_part', what: 'room' })])
  t.ok('на каждое помещение — по строке', each.length === rooms.length)
  t.ok('и количество из сметы', each[0].mats[0].qty === 10)

  const part = run([R({ estId: 'e_part', what: 'part' })])
  t.ok('перегородки посчитаны', part.length === 1 && part[0].count === rooms.length - 1)

  const once = run([R({ estId: 'e_part', what: 'house' })])
  t.ok('один раз на дом — одна строка', once.length === 1 && once[0].count === 0)
}

// ── 4. Недонастроенное правило молчит ───────────────────────────────────────
{
  t.section('Правило, которого не хватает')
  t.ok('без сметы', run([R({ estId: '' })]).length === 0 && ruleReady(R({ estId: '' })) === 'не выбрана смета')
  t.ok('без поверхности', run([R({ estId: 'e_osb', k: '' })]).length === 0)
  t.ok('без точки', run([R({ estId: 'e_sock', what: 'point', k: '' })]).length === 0)
  t.ok('выключенное', run([R({ estId: 'e_osb', off: true })]).length === 0)
  t.ok('чужого вида', run([R({ estId: 'e_banya', kind: 'banya' })]).length === 0)
  t.ok('со сметой, которой нет', run([R({ estId: 'нет' })]).length === 0)
  t.ok('готовое правило претензий не вызывает', ruleReady(R({ estId: 'e_osb' })) === '')
  t.ok('и читается словами', ruleText(R({ estId: 'e_osb' })) === 'стены каждого помещения')
  t.ok('фильтр виден в тексте', /Санузел/.test(ruleText(R({ estId: 'e_osb', room: 'Санузел' }))))
}

// ── 5. Правила складываются со справочником, а не подменяют его ─────────────
{
  t.section('Справочник и правила вместе')
  const rules = [R({ estId: 'e_osb' })]
  const base = sheetPositions(probeSheet(SHEET, TYPES), EST, PRODUCTS)
  const all = allPositions(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES, rules: rules })
  // Правило для сметы ЗАМЕНЯЕТ её обязательную строку: «на весь дом» и «по стенам
  // каждого помещения» — это одна позиция, посчитанная по-разному.
  const dropped = base.filter((p) => String(p.key).indexOf('base:') === 0 && p.estId === 'e_osb').length
  t.ok('обе половины на месте', all.length === base.length - dropped + run(rules).length)
  t.ok('обязательная строка не задвоилась',
    all.filter((p) => p.estId === 'e_osb' && p.from === 'est').length === 0)
  t.ok('а без правила она на месте',
    allPositions(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES, rules: [] })
      .filter((p) => p.estId === 'e_osb' && p.from === 'est').length === dropped)
  // Выбор человека правило не подменяет: там решение принято руками.
  t.ok('позиции выбора правило не трогает',
    allPositions(Object.assign({}, SHEET, { rooms: { [rooms[0].id]: { Стены: 'e_osb' } } }),
      { estimates: EST, products: PRODUCTS, winTypes: TYPES, rules: rules })
      .some((p) => p.from === 'est' && p.estId === 'e_osb'))
  t.ok('происхождение видно у каждой', all.every((p) => p.from === 'est' || p.from === 'rule'))
  t.ok('без правил — ровно справочник',
    allPositions(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES, rules: [] }).length === base.length)

  // Ради этого списка правила и написаны: настроил — пробел закрылся.
  const ctx = { estimates: EST, products: PRODUCTS, winTypes: TYPES }
  const before = gaps2(SHEET, ctx).filter((g) => g.k === 'wall').length
  const after = gaps2(SHEET, Object.assign({ rules: rules }, ctx)).filter((g) => g.k === 'wall').length
  t.ok('стены были пробелом', before === 1)
  t.ok('правило его закрыло', after === 0)
}

// ── 6. Дом как конструкция: пирог считает себя сам ──────────────────────────
// Пирог уже описывает, из чего стена. Дай слою товар — и он посчитает себя тем
// же `matQtyForArea`, что и вся остальная смета.
{
  t.section('Пироги стен')
  const PIE_PROD = PRODUCTS.concat([
    { id: 'p_ppu', name: 'ППУ 50 мм', unitCost: 600, store: 'Белка', mode: 'm2' },
    { id: 'p_sheet', name: 'Фанера 4 мм', unitCost: 1400, store: 'Лемана', mode: 'sheet', packBase: 'м²', packPer: 3 },
  ])
  const withPie = JSON.parse(JSON.stringify(SHEET))
  withPie.model = applyLayers(withPie.model, 'skin', [
    { id: 'l1', n: 'Металл контейнера', mm: 2 },
    { id: 'l2', n: 'ППУ', mm: 50, pid: 'p_ppu' },
    { id: 'l3', n: 'Фанера', mm: 4, pid: 'p_sheet', stage: 3 },
  ])
  const A = modelAreas(withPie.model, TYPES)
  const pos = layerPositions(withPie, EST, PIE_PROD, TYPES)

  t.ok('слой без товара молчит', pos.length === 2)
  t.ok('меряется ЧИСТОЙ площадью стен', pos[0].area === A.total.wallNet)
  t.ok('и об этом сказано в строке', /наружная стена [\d,]+ м²/.test(pos[0].why))
  t.ok('м² идут как есть', pos[0].mats[0].qty === A.total.wallNet)
  t.ok('деньги — площадь × цена', pos[0].cost === Math.round(A.total.wallNet * 600))
  // Листовой материал считается фасовкой, как везде в смете.
  t.ok('листы — через фасовку', pos[1].mats[0].qty === Math.ceil(A.total.wallNet / 3 * 100) / 100)
  t.ok('этап слоя уважается', pos[1].stage === 3 && pos[0].stage === 2)
  t.ok('строка помечена пирогом', pos.every((p) => p.from === 'layer' && p.pie === 'skin'))

  // Перегородки меряются своей площадью, а не площадью стен коробки.
  const withPart = JSON.parse(JSON.stringify(withPie))
  withPart.model = applyLayers(withPart.model, 'layers', [{ id: 'q1', n: 'Брус', mm: 50, pid: 'p_ppu' }])
  const parts = layerPositions(withPart, EST, PIE_PROD, TYPES).filter((p) => p.pie === 'layers')
  t.ok('перегородка посчитана', parts.length === 1)
  t.ok('по площади перегородок', parts[0].area === modelTotals(withPart.model, TYPES).partitionArea)
  t.ok('и это не площадь стен', parts[0].area !== A.total.wallNet)

  // Продольная перегородка короче поперечной — считать их одинаково значит
  // выставить счёт за метры, которых нет.
  t.ok('площадь перегородок положительная', pieArea(withPart.model, 'layers', TYPES) > 0)

  const money = pieCost(withPie.model, 'skin', PIE_PROD, TYPES)
  t.ok('узел знает свою стоимость', money.total === pos.reduce((a, p) => a + p.cost, 0))
  t.ok('и цену квадрата', money.perM2 === Math.round(money.total / money.area))
  t.ok('и сколько слоёв без товара', money.layers === 3 && money.priced === 2)

  // Правка толщины не сбрасывает товар: слой — это не только миллиметры.
  const again = applyLayers(withPie.model, 'skin', withPie.model.skin.map((l) => Object.assign({}, l, { mm: (l.mm || 0) + 1 })))
  t.ok('товар слоя переживает правку', (again.skin[1] || {}).pid === 'p_ppu')
  t.ok('и этап тоже', (again.skin[2] || {}).stage === 3)

  // Пироги включаются тем же ключом, что и правила: боевые спецификации их не видят.
  const ctx = { estimates: EST, products: PIE_PROD, winTypes: TYPES, rules: [] }
  t.ok('без ключа пирогов строк нет',
    allPositions(withPie, ctx).every((p) => p.from !== 'layer'))
  t.ok('с ключом — есть',
    allPositions(withPie, Object.assign({ pies: true }, ctx)).filter((p) => p.from === 'layer').length === 2)
}

// ── 7. Варианты: один из нескольких ─────────────────────────────────────────
// Три «Утепления» подряд — это не три работы, а одно решение с тремя ответами.
{
  t.section('Варианты одной группы')
  const P = (key, est, name, cost) => ({ key: key, estId: est, name: name, cost: cost, mats: [], stage: 2, from: 'est' })
  const list = [
    P('base:a', 'a', 'Утепление стен и потолка — ППУ 3 см', 62000),
    P('base:b', 'b', 'Утепление стен и потолка — ППУ 5 см', 102000),
    P('base:c', 'c', 'Утепление стен и потолка — ППУ 8 см', 111500),
    P('base:z', 'z', 'Контейнер 40 фут', 175000),
  ]
  t.ok('метка варианта — то, чем он отличается', optLabelOf(list[1].name) === 'ППУ 5 см')
  t.ok('общая часть имени — группа', optPrefixOf(list[1].name) === 'Утепление стен и потолка')
  t.ok('без тире имя целиком', optPrefixOf('Контейнер 40 фут') === 'Контейнер 40 фут')
  // Тире в справочнике набирают руками: длинное, среднее, обычный дефис, лишние
  // и неразрывные пробелы. Требовать ровно « — » значит не узнать половину
  // вариантов — ровно на этом ППУ и не собирался, когда ЭППС собирался.
  ;[['Утепление стен – ППУ 5 см', 'ППУ 5 см'],
    ['Утепление стен - ППУ 8 см', 'ППУ 8 см'],
    ['Утепление стен  —  ППУ 3 см', 'ППУ 3 см'],
    ['Утепление стен\u00a0— ППУ 3 см', 'ППУ 3 см']].forEach(function (pair) {
    t.ok('тире распознано: ' + JSON.stringify(pair[0]),
      optLabelOf(pair[0]) === pair[1] && optPrefixOf(pair[0]) === 'Утепление стен',
      optPrefixOf(pair[0]) + ' / ' + optLabelOf(pair[0]))
  })
  t.ok('режем по последнему тире', optLabelOf('Дом — баня — ППУ 5') === 'ППУ 5')

  const sheet = { optOf: { a: 'Утепление', b: 'Утепление', c: 'Утепление' }, optPick: { 'Утепление': 'b' } }
  const r = applyPicks(list, sheet)
  t.ok('в состав идёт один вариант', r.positions.length === 2)
  t.ok('и это выбранный', r.positions.some((p) => p.estId === 'b') && !r.positions.some((p) => p.estId === 'a'))
  t.ok('остальные строки не тронуты', r.positions.some((p) => p.estId === 'z'))
  t.ok('экран знает, из чего выбирали', r.groups.length === 1 && r.groups[0].variants.length === 3)
  t.ok('и почём каждый', r.groups[0].variants.find((v) => v.estId === 'c').cost === 111500)
  t.ok('выбранный помечен', r.groups[0].variants.filter((v) => v.on).length === 1)

  // Выбор не сделан — берём первый: молча обнулить дом хуже, чем показать вариант.
  const noPick = applyPicks(list, { optOf: sheet.optOf })
  t.ok('без выбора в доме первый вариант', noPick.positions.some((p) => p.estId === 'a'))
  t.ok('и он один', noPick.positions.length === 2)

  // Правило даёт по строке на помещение — в цене варианта они складываются.
  const perRoom = [
    P('rule:r:1', 'a', 'Стены — ОСП', 1000),
    P('rule:r:2', 'a', 'Стены — ОСП', 2000),
    P('rule:q:1', 'b', 'Стены — МДФ', 9000),
  ]
  const rr = applyPicks(perRoom, { optOf: { a: 'Стены', b: 'Стены' }, optPick: { 'Стены': 'a' } })
  t.ok('обе строки выбранного варианта на месте', rr.positions.length === 2)
  t.ok('цена варианта — сумма его строк', rr.groups[0].variants.find((v) => v.estId === 'a').cost === 3000)

  // Без разметки ничего не меняется: механизм включает человек.
  t.ok('без групп список прежний', applyPicks(list, {}).positions.length === 4)
}

// ── 8. Работы этапа идут блоками по помещениям ──────────────────────────────
// Правило по помещениям даёт строку на каждую комнату, и этап без группировки
// читается перечислением поверхностей: «стены санузел, стены зал, стены спальня,
// пол санузел…». Бригада работает комнатой — в санузел заходят один раз.
{
  t.section('Блоки по помещениям')
  const list = allPositions(SHEET, {
    estimates: EST, products: PRODUCTS, winTypes: TYPES,
    rules: [R({ id: 'r_w', estId: 'e_osb', k: 'wall', stage: 3 }),
      R({ id: 'r_f', estId: 'e_tile', k: 'floor', stage: 3 })],
  })
  const st3 = list.filter((p) => Number(p.stage) === 3)
  t.ok('строк в этапе больше одной комнаты', st3.length >= 4, 'строк: ' + st3.length)
  // Соседние строки одной комнаты идут подряд: комната не может встретиться дважды.
  const seen = {}
  let broken = ''
  let prev = null
  st3.forEach((p) => {
    const k = roomKeyOf(p)
    if (k !== prev && seen[k]) broken = p.room
    seen[k] = 1; prev = k
  })
  t.ok('комната идёт одним куском', !broken, 'разорвана: ' + broken)
  t.ok('и в куске разные работы',
    st3.filter((p) => p.room === 'Санузел').map((x) => x.estId).join(',') === 'e_osb,e_tile',
    st3.filter((p) => p.room === 'Санузел').map((x) => x.estId).join(','))

  // Группировка НЕ переносит работы между этапами: этап — это сроки и приёмка.
  const stages = list.map((p) => Number(p.stage) || 0)
  t.ok('этапы остались при своих строках',
    stages.join(',') === applyRooms({ positions: list }).positions.map((p) => Number(p.stage) || 0).join(','))

  // Порядок внутри комнаты — тот, что назначил человек: группировка стабильна.
  const keys = st3.filter((p) => p.room === 'Санузел').map((p) => p.key)
  const withOrder = allPositions(Object.assign({}, SHEET, { posOrder: { [keys[1]]: 0, [keys[0]]: 1 } }), {
    estimates: EST, products: PRODUCTS, winTypes: TYPES,
    rules: [R({ id: 'r_w', estId: 'e_osb', k: 'wall', stage: 3 }),
      R({ id: 'r_f', estId: 'e_tile', k: 'floor', stage: 3 })],
  })
  const san = withOrder.filter((p) => p.room === 'Санузел').map((p) => p.key)
  t.ok('ручная перестановка внутри комнаты сохраняется', san.join(',') === [keys[1], keys[0]].join(','), san.join(','))

  // Дом без комнат в позициях остаётся одним куском — блоков там нет вовсе.
  const plain = allPositions(SHEET, { estimates: EST, products: PRODUCTS, winTypes: TYPES, rules: [] })
  t.ok('обязательные строки не разъехались', plain.every((p) => roomKeyOf(p) === ''))

  // Работу приписывают к комнате руками: расчёт знает помещение только там, где
  // по нему считал, а обязательную «уборку» делают всё равно в санузле.
  const bath = rooms[0]
  const houseKey = plain[0].key
  const moved = allPositions(Object.assign({}, SHEET, { posRoom: { [houseKey]: bath.id } }), {
    estimates: EST, products: PRODUCTS, winTypes: TYPES, rules: [],
  })
  const got = moved.find((p) => p.key === houseKey)
  t.ok('работа уехала в комнату', roomKeyOf(got) === bath.id, roomKeyOf(got))
  t.ok('и подписана её именем', got.room === bath.name, got.room)
  t.ok('помечена как приписанная руками', got.roomSet === true)
  // «Откуда число» не врёт: считали её на весь дом, комнату выбрал человек.
  t.ok('объяснение количества не изменилось',
    got.why === plain.find((p) => p.key === houseKey).why, got.why)
  t.ok('цена не поехала', got.cost === plain.find((p) => p.key === houseKey).cost)

  // «Общее по дому» — тоже выбор, и у него свой ключ: пустая строка означала бы
  // «человек ничего не решал», и расчёт утащил бы работу обратно в свою комнату.
  const ruled = allPositions(SHEET, {
    estimates: EST, products: PRODUCTS, winTypes: TYPES,
    rules: [R({ id: 'r_w', estId: 'e_osb', k: 'wall', stage: 3 })],
  }).filter((p) => p.room === bath.name)
  const back = allPositions(Object.assign({}, SHEET, { posRoom: { [ruled[0].key]: ROOM_HOUSE } }), {
    estimates: EST, products: PRODUCTS, winTypes: TYPES,
    rules: [R({ id: 'r_w', estId: 'e_osb', k: 'wall', stage: 3 })],
  }).find((p) => p.key === ruled[0].key)
  t.ok('комнатную работу можно отдать дому', roomKeyOf(back) === '' && back.roomSet === true)
  t.ok('адрес приписки читается', posRoomOf({ posRoom: { a: 'x' } }, 'a') === 'x')
}

// ── 9. Порядок материалов внутри строки ─────────────────────────────────────
// Список материалов читают сверху вниз и по нему закупают: сначала лист, потом
// крепёж. В справочнике порядок общий на все дома, поэтому перестановка живёт на
// листе — как замена и ручное количество.
{
  t.section('Порядок материалов')
  const pos = [{ key: 'k', name: 'Обшивка', factor: 1, cost: 3,
    mats: [{ pid: 'a', n: 'A', cost: 1, qty: 1 }, { pid: 'b', n: 'B', cost: 1, qty: 1 }, { pid: 'c', n: 'C', cost: 1, qty: 1 }] }]
  const moved = applyMatEdits(pos, { matOrder: { k: { c: 0, a: 1, b: 2 } } }, [])
  t.ok('порядок применился', moved[0].mats.map((m) => m.pid).join(',') === 'c,a,b',
    moved[0].mats.map((m) => m.pid).join(','))
  t.ok('материалы не потерялись', moved[0].mats.length === 3)
  t.ok('и цена строки та же', moved[0].cost === 3, String(moved[0].cost))

  // Расставленные руками идут первыми, остальные — в порядке сметы: иначе
  // дописанный материал молча уезжал бы в начало списка.
  const half = applyMatEdits(pos, { matOrder: { k: { c: 0 } } }, [])
  t.ok('неразмеченные остаются в порядке сметы',
    half[0].mats.map((m) => m.pid).join(',') === 'c,a,b', half[0].mats.map((m) => m.pid).join(','))

  t.ok('без разметки список прежний',
    applyMatEdits(pos, {}, [])[0].mats.map((m) => m.pid).join(',') === 'a,b,c')
  t.ok('адрес порядка читается', matOrderOf({ matOrder: { k: { a: 1 } } }, 'k').a === 1)
}

// ── Адрес материала внутри строки ────────────────────────────────────────────
// Дописанный руками материал — отдельная строка, даже когда товар у него тот же,
// что уже посчитан в смете (вторая фасовка, лишняя коробка). Значит и адрес у
// него отдельный: по общему адресу ручное количество, порядок и «убрать»
// доставались обеим строкам сразу.
{
  t.section('Адрес материала')
  const pos = [{ key: 'k', name: 'Обшивка', factor: 1, cost: 1000,
    mats: [{ pid: 'p_osb', n: 'ОСП 9 мм', cost: 1000, qty: 1 }] }]
  const sheet = { matAdd: { k: [{ id: 'm1', pid: 'p_osb', n: 'ОСП 9 мм', cost: 1000, qty: 1 }] } }

  t.ok('адрес расчётного — его товар', matKeyOf({ pid: 'p_osb' }) === 'p_osb')
  t.ok('адрес дописанного — его id', matKeyOf({ added: true, id: 'm1', pid: 'p_osb' }) === '+m1',
    matKeyOf({ added: true, id: 'm1', pid: 'p_osb' }))
  t.ok('и он же считается по сырой записи', matAddKey({ id: 'm1', pid: 'p_osb' }) === '+m1')

  const both = applyMatEdits(pos, sheet, PRODUCTS)[0].mats
  t.ok('в строке две записи', both.length === 2, String(both.length))
  t.ok('и адреса у них разные', matKeyOf(both[0]) !== matKeyOf(both[1]),
    both.map(matKeyOf).join(','))

  // Ручное количество дописанного не трогает расчётный — ради этого адрес и разошёлся.
  const qty = applyMatEdits(pos, Object.assign({ matQty: { k: { '+m1': 5 } } }, sheet), PRODUCTS)[0]
  t.ok('количество досталось дописанному', qty.mats[1].qty === 5, String(qty.mats[1].qty))
  t.ok('а расчётный остался как был', qty.mats[0].qty === 1 && !qty.mats[0].qtySet,
    String(qty.mats[0].qty))
  t.ok('и деньги строки выросли только на него', qty.cost === 1000 + 5000, String(qty.cost))

  // «Убрать» — так же врозь.
  const off = applyMatEdits(pos, Object.assign({ matOff: { k: ['p_osb'] } }, sheet), PRODUCTS)[0]
  t.ok('убрался только расчётный', off.mats.length === 1 && off.mats[0].added === true,
    JSON.stringify(off.mats.map(matKeyOf)))
}

// ── Старые адреса переживают правку ─────────────────────────────────────────
// Правки по прежним адресам лежат в боевых листах: убранный материал вернулся бы
// на экран, ручное количество откатилось бы к расчётному. Поэтому старый адрес не
// переносится, а рядом с ним ДОПИСЫВАЕТСЯ новый — экран остаётся прежним.
{
  t.section('Миграция адресов')
  const sheet = {
    matAdd: { k: [{ id: 'm1', pid: 'p_osb', n: 'ОСП 9 мм', cost: 1000, qty: 1 }] },
    matQty: { k: { p_osb: 4 } }, matOrder: { k: { p_osb: 0 } }, matOff: { k: ['p_osb'] },
  }
  t.ok('миграция сработала', migrateMatAddrs(sheet) === true)
  t.ok('количество доехало', sheet.matQty.k['+m1'] === 4, JSON.stringify(sheet.matQty.k))
  t.ok('порядок доехал', sheet.matOrder.k['+m1'] === 0)
  t.ok('и «убрано» тоже', sheet.matOff.k.indexOf('+m1') >= 0, JSON.stringify(sheet.matOff.k))
  // Старый адрес остаётся: по нему живёт расчётный материал, и стереть его значит
  // вернуть в строку то, что человек убрал.
  t.ok('старый адрес не тронут', sheet.matQty.k.p_osb === 4 && sheet.matOff.k.indexOf('p_osb') >= 0)
  t.ok('повтор ничего не меняет', migrateMatAddrs(sheet) === false)

  // Правка по новому адресу миграцию не интересует: человек уже сказал своё число.
  const fresh = { matAdd: { k: [{ id: 'm2', pid: 'p_tile' }] }, matQty: { k: { p_tile: 2, '+m2': 9 } } }
  t.ok('своё число не перебивается', migrateMatAddrs(fresh) === false && fresh.matQty.k['+m2'] === 9)
  t.ok('лист без дописанных не трогается', migrateMatAddrs({}) === false)
}

// ── Один товар дважды в самой смете ─────────────────────────────────────────
// «ОСП на пол» и «ОСП на стены» одной работой — это две строки, и правят их
// порознь. Адрес у обеих был один, поэтому замена меняла товар в обеих, ручное
// количество доставалось обеим, а «убрать» уносило сразу две.
{
  t.section('Один товар дважды в смете')
  const raw = [{ key: 'k', name: 'Обшивка', factor: 1, cost: 3000, area: 10, mats: [
    { pid: 'p_osb', n: 'ОСП 9 мм', cost: 1000, qty: 1 },
    { pid: 'p_tile', n: 'Плитка', cost: 1000, qty: 1 },
    { pid: 'p_osb', n: 'ОСП 9 мм', cost: 1000, qty: 1 },
  ] }]
  const pos = stampMatIx(raw)[0]
  t.ok('первая строка адреса не сменила', matKeyOf(pos.mats[0]) === 'p_osb', matKeyOf(pos.mats[0]))
  t.ok('одиночный товар тоже', matKeyOf(pos.mats[1]) === 'p_tile')
  t.ok('а повтор получил свой', matKeyOf(pos.mats[2]) === 'p_osb#2', matKeyOf(pos.mats[2]))
  t.ok('исходный список не тронут', raw[0].mats[2].mix === undefined)
  t.ok('строка без повторов остаётся собой',
    stampMatIx([{ key: 'k2', mats: [{ pid: 'a' }, { pid: 'b' }] }])[0].mats[0].mix === undefined)

  // Замена по адресу первой строки вторую не трогает.
  const one = applyMatEdits(stampMatIx(raw), { mats: { k: { p_osb: 'p_tile' } } }, PRODUCTS)[0]
  t.ok('заменилась одна строка', one.mats.filter((m) => m.pid === 'p_osb').length === 1,
    JSON.stringify(one.mats.map((m) => m.pid)))
  t.ok('и это первая', one.mats[0].pid === 'p_tile' && one.mats[2].pid === 'p_osb',
    JSON.stringify(one.mats.map((m) => m.pid)))
  // Заменить можно и вторую — по её собственному адресу.
  const two = applyMatEdits(stampMatIx(raw), { mats: { k: { 'p_osb#2': 'p_tile' } } }, PRODUCTS)[0]
  t.ok('вторая заменяется своим адресом', two.mats[0].pid === 'p_osb' && two.mats[2].pid === 'p_tile',
    JSON.stringify(two.mats.map((m) => m.pid)))
  t.ok('и номер повтора переезжает с ней', matKeyOf(two.mats[2]) === 'p_tile#2', matKeyOf(two.mats[2]))

  // Количество и «убрать» — так же врозь.
  const q = applyMatEdits(stampMatIx(raw), { matQty: { k: { 'p_osb#2': 7 } } }, PRODUCTS)[0]
  t.ok('количество досталось повтору', q.mats[2].qty === 7 && q.mats[0].qty === 1,
    JSON.stringify(q.mats.map((m) => m.qty)))
  const off = applyMatEdits(stampMatIx(raw), { matOff: { k: ['p_osb'] } }, PRODUCTS)[0]
  t.ok('убралась одна строка', off.mats.length === 2, String(off.mats.length))
  t.ok('и осталась вторая', matKeyOf(off.mats[1]) === 'p_osb#2', JSON.stringify(off.mats.map(matKeyOf)))

  t.ok('товар из адреса читается', matAddrPid('p_osb#2') === 'p_osb' && matAddrPid('p_osb') === 'p_osb')
  t.ok('и адрес после замены собирается',
    matAddrSwap('p_osb#2', 'p_ply') === 'p_ply#2' && matAddrSwap('p_osb', 'p_ply') === 'p_ply')
}

t.done()
