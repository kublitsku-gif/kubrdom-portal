#!/usr/bin/env node
// Правила сборки (src/recipe.js): чертёж → работы без ручного выбора.
//
// Правило говорит только, К ЧЕМУ применяется смета из справочника, а считается
// позиция общей машинкой. Сторожим ровно это: что правило берёт числа из модели,
// что материалы остаются сметиными, что недонастроенное правило молчит и что
// список из справочника и список из правил складываются, а не подменяют друг друга.
import { presetModel, MODEL_PRESETS } from '../src/model.js'
import { sheetPositions, matNeedForArea, matNeedOk, matNeedMatch } from '../src/spec.js'
import { guessVolume, carryRuleEdits } from '../src/recipe.js'
import { rulePositions, allPositions, allPositionsRaw, ruleText, ruleReady, ruleAreas, probeSheet, positionSplit,
  layerPositions, pieArea, pieCost, applyPicks, optLabelOf, optPrefixOf, applyRooms, roomKeyOf, posRoomOf, ROOM_HOUSE, applyMatEdits, matOrderOf, matKeyOf, matAddKey, matAddrs, matLegacyKey, matAddrPid, matAddrSwap, stampMatIx, migrateMatAddrs } from '../src/recipe.js'
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

  // Стены и потолок красят одним заходом и по одной цене за квадрат: это одна
  // поверхность, а не две работы, которые человек потом складывает в голове.
  const wc = run([R({ estId: 'e_osb', k: 'wallceil', scope: 'house' })])
  const walls = run([R({ estId: 'e_osb', k: 'wall', scope: 'house' })])
  const ceils = run([R({ estId: 'e_osb', k: 'ceil', scope: 'house' })])
  t.ok('«стены + потолок» — одна строка', wc.length === 1)
  t.ok('и площадь равна сумме двух',
    Math.abs(wc[0].area - (walls[0].area + ceils[0].area)) < 0.05,
    wc[0].area + ' vs ' + (walls[0].area + ceils[0].area))
  t.ok('материал считается по этой же площади', wc[0].mats[0].qty === wc[0].area)
  t.ok('и правило считается настроенным', ruleReady(R({ estId: 'e_osb', k: 'wallceil' })) === '')
  t.ok('в объяснении сказано, чем меряли', /стены и потолок [\d,]+ м²/.test(wc[0].why))
  t.ok('и в подписи правила тоже', /стены и потолок/.test(ruleText(R({ estId: 'e_osb', k: 'wallceil', scope: 'house' }))))
}

// ── Стены без проёмов ───────────────────────────────────────────────────────
// Полная стена и стена за вычетом окон — два разных расчёта: по первой считают
// обрешётку и утеплитель (они идут и за окном), по второй красят и обшивают.
{
  t.section('Стены без проёмов')
  const gross = run([R({ estId: 'e_osb', k: 'wall', scope: 'house' })])[0]
  const net = run([R({ estId: 'e_osb', k: 'wallnet', scope: 'house' })])[0]
  const areas = modelAreas(model, TYPES)
  t.ok('проёмы в доме есть', areas.total.openings > 0, 'проёмов: ' + areas.total.openings)
  t.ok('чистая стена меньше полной', net.area < gross.area, gross.area + ' → ' + net.area)
  t.ok('и ровно на площадь проёмов',
    Math.abs(gross.area - net.area - areas.total.openings) < 0.2,
    'разница ' + (gross.area - net.area) + ' против ' + areas.total.openings)
  t.ok('сходится с числом из справки «откуда числа»',
    Math.abs(net.area - areas.total.wallNet) < 0.2, net.area + ' vs ' + areas.total.wallNet)
  const nc = run([R({ estId: 'e_osb', k: 'wallnetceil', scope: 'house' })])[0]
  const ceil = run([R({ estId: 'e_osb', k: 'ceil', scope: 'house' })])[0]
  t.ok('«без проёмов + потолок» — сумма двух',
    Math.abs(nc.area - (net.area + ceil.area)) < 0.05, nc.area + ' vs ' + (net.area + ceil.area))
  t.ok('и объяснение называет поверхность', /стены без проёмов [\d,]+ м²/.test(net.why), net.why)

  // Лист, заполненный руками: площади проёмов там нет, и «без проёмов» не должно
  // молча уменьшать стену на ноль-которого-нет.
  const hand = { id: 'h', kind: 'house', markup: 0,
    specs: { height: 2.5, rooms: [{ id: 'r1', name: 'Комната', w: 3, l: 4, wallLen: 14 }], openings: [] },
    rooms: {}, global: {}, qty: {} }
  const hp = rulePositions(hand, [R({ estId: 'e_osb', k: 'wallnet', scope: 'house' })], EST, PRODUCTS, TYPES)
  t.ok('без модели чистая стена равна полной', hp.length === 1 && hp[0].area === 14 * 2.5, JSON.stringify(hp.map((x) => x.area)))
}

// ── Норма-час ───────────────────────────────────────────────────────────────
// Цену работы вбивали руками в каждой строке каждого дома. Норма-час считает её
// сам: норма × объём × коэффициент = часы, часы × ставка = деньги. Сторожим, что
// расчёт идёт от ТЕХ ЖЕ объёмов, что и материалы, и что руками вписанное главнее.
{
  t.section('Норма-час')
  const EST_H = EST.map((e) => (e.id === 'e_osb' ? Object.assign({}, e, { hourNorm: 0.4 }) : e))
  const ctx = (extra) => Object.assign({ estimates: EST_H, products: PRODUCTS, winTypes: TYPES, rules: [], pies: false }, extra || {})
  const rule = [R({ estId: 'e_osb', k: 'wall', scope: 'house' })]
  const pos = (sheet, extra) => allPositionsRaw(sheet, ctx(Object.assign({ rules: rule }, extra || {})))
    .positions.filter((p) => p.estId === 'e_osb')[0]

  const noRate = pos(SHEET)
  t.ok('часы посчитались от объёма', noRate.hours === Math.round(noRate.area * 0.4 * 10) / 10,
    noRate.area + ' м² → ' + noRate.hours + ' ч')
  t.ok('и видно, из чего', noRate.norm === 0.4 && noRate.normUnits === noRate.area && noRate.hoursNorm === true)
  t.ok('без ставки денег за работу нет', !noRate.laborCalc && !(noRate.labor > 0))

  const paid = pos(SHEET, { hourRate: 1200 })
  t.ok('деньги — часы × ставка', paid.labor === Math.round(paid.hours * 1200), paid.hours + ' ч → ' + paid.labor)
  t.ok('и они попали в итог строки', paid.cost === Math.round(paid.cost - paid.labor) + paid.labor)
  t.ok('раскладка знает про них', positionSplit(paid).labor === paid.labor)

  // Коэффициент: у работы в справочнике — на всех домах, у строки в листе — здесь.
  const EST_K = EST_H.map((e) => (e.id === 'e_osb' ? Object.assign({}, e, { hourK: 1.5 }) : e))
  const withK = allPositionsRaw(SHEET, ctx({ rules: rule, estimates: EST_K, hourRate: 1200 }))
    .positions.filter((p) => p.estId === 'e_osb')[0]
  t.ok('коэффициент справочника поднял часы',
    Math.abs(withK.hours - Math.round(noRate.hours * 1.5 * 10) / 10) < 0.11, noRate.hours + ' → ' + withK.hours)
  t.ok('и деньги вместе с ними', withK.labor === Math.round(withK.hours * 1200))

  const houseK = Object.assign({}, SHEET, { posK: { [paid.key]: 2 } })
  const withHouseK = allPositionsRaw(houseK, ctx({ rules: rule, estimates: EST_K, hourRate: 1200 }))
    .positions.filter((p) => p.estId === 'e_osb')[0]
  t.ok('коэффициент дома перебивает справочный', withHouseK.hourK === 2,
    'вышло ×' + withHouseK.hourK)
  t.ok('и часы посчитаны по нему',
    Math.abs(withHouseK.hours - Math.round(noRate.hours * 2 * 10) / 10) < 0.11, withHouseK.hours)

  // Ставка дома важнее портальной: другая бригада, дальняя логистика, сроки.
  const ownRate = Object.assign({}, SHEET, { hourRate: 2000 })
  const byOwn = allPositionsRaw(ownRate, ctx({ rules: rule, hourRate: 1200 }))
    .positions.filter((p) => p.estId === 'e_osb')[0]
  t.ok('ставка дома главнее базовой', byOwn.labor === Math.round(byOwn.hours * 2000), byOwn.labor)

  // Руками вписанное главнее расчёта — как и везде в портале.
  const byHand = Object.assign({}, SHEET, { posHours: { [paid.key]: 3 } })
  const handHours = allPositionsRaw(byHand, ctx({ rules: rule, hourRate: 1200 }))
    .positions.filter((p) => p.estId === 'e_osb')[0]
  t.ok('свои часы перебивают норму', handHours.hours === 3 && !handHours.hoursNorm)
  t.ok('и деньги считаются по ним', handHours.labor === 3600, String(handHours.labor))

  const byPrice = Object.assign({}, SHEET, { posCost: { [paid.key]: 9000 }, posCostMode: { [paid.key]: 'labor' } })
  const handPrice = allPositionsRaw(byPrice, ctx({ rules: rule, hourRate: 1200 }))
    .positions.filter((p) => p.estId === 'e_osb')[0]
  t.ok('своя цена перебивает и ставку', handPrice.labor === 9000 && handPrice.costSet === true)
  t.ok('а часы при этом остаются планом', handPrice.hours === paid.hours, String(handPrice.hours))

  // Работа без нормы живёт как раньше: ни часов, ни денег за работу.
  const plain = allPositionsRaw(SHEET, ctx({ rules: [R({ estId: 'e_tile', k: 'floor', scope: 'house' })], hourRate: 1200 }))
    .positions.filter((p) => p.estId === 'e_tile')[0]
  t.ok('без нормы работа не считается', !(plain.hours > 0) && !plain.laborCalc)
}

// ── Своя работа по часам ────────────────────────────────────────────────────
// Своей работе (строке, дописанной в дом без справочника) цену вбивали прямо в
// строке — и в «Пол на весь дом» стоял 1 ₽ при пяти часах. Ставка живёт в
// «Деньгах», в строке остаются только часы и коэффициент сложности: работа =
// часы × коэффициент × ставка, так же, как у строк справочника.
{
  t.section('Своя работа по часам')
  const ctxOwn = (extra) => Object.assign({ estimates: EST, products: PRODUCTS, winTypes: TYPES, rules: [], pies: false }, extra || {})
  const ownOf = (sheet, extra) => allPositionsRaw(sheet, ctxOwn(extra)).positions.filter((p) => p.key === 'add:w1')[0]
  const ownMats = (p) => (p.mats || []).filter((m) => m.own)
  const base = Object.assign({}, SHEET, {
    posAdd: [{ id: 'w1', name: 'Пол на весь дом', cost: 1, stage: 2 }],
    posHours: { 'add:w1': 5 },
    matAdd: { 'add:w1': [{ id: 'm1', pid: '', n: 'Фанера', cost: 1000, qty: 3 }] },
  })

  const paid = ownOf(Object.assign({}, base, { hourRate: 1000 }))
  t.ok('работа — часы × ставка, а не вписанная сумма', positionSplit(paid).labor === 5000, JSON.stringify(positionSplit(paid)))
  t.ok('материалы строки остались своей цифрой', positionSplit(paid).mats === 3000 && paid.cost === 8000, String(paid.cost))
  // Стройка складывает `labor` с материалами (workTotal): деньги своей работы
  // обязаны жить только в её «материале», иначе объект посчитал бы их дважды.
  t.ok('деньги лежат в «материале» работы, а не в labor', !(Number(paid.labor) > 0) && ownMats(paid).length === 1 && ownMats(paid)[0].cost === 5000)

  const hard = ownOf(Object.assign({}, base, { hourRate: 1000, posK: { 'add:w1': 1.5 } }))
  t.ok('коэффициент поднимает часы', hard.hours === 7.5 && hard.hourK === 1.5, hard.hours + ' ч ×' + hard.hourK)
  t.ok('и деньги вместе с ними', positionSplit(hard).labor === 7500, String(positionSplit(hard).labor))

  const byBase = ownOf(base, { hourRate: 1200 })
  t.ok('без ставки дома — база портала', positionSplit(byBase).labor === 6000, String(positionSplit(byBase).labor))

  // Сумма, вписанная до нормы-часа, не пропадает молча: пока часов нет, она и есть работа.
  const legacy = ownOf(Object.assign({}, base, { posHours: {}, posAdd: [{ id: 'w1', name: 'Черновой пол', cost: 5000, stage: 2 }], hourRate: 1000 }))
  t.ok('без часов остаётся прежняя сумма', positionSplit(legacy).labor === 5000 && !legacy.laborCalc, String(positionSplit(legacy).labor))
  const noRate = ownOf(base)
  t.ok('без ставки — прежняя сумма, часы остаются планом', positionSplit(noRate).labor === 1 && noRate.hours === 5,
    positionSplit(noRate).labor + ' ₽, ' + noRate.hours + ' ч')

  // Новую свою работу заводят без суммы — одними часами.
  const fresh = ownOf(Object.assign({}, base, { posAdd: [{ id: 'w1', name: 'Пол', stage: 2 }], hourRate: 1000 }))
  t.ok('строка без суммы получает работу по часам', positionSplit(fresh).labor === 5000 && ownMats(fresh).length === 1,
    JSON.stringify(positionSplit(fresh)))
}

// ── Объёмы для кнопок выбора ────────────────────────────────────────────────
// Кнопка «пол · 25,26 м²» обязана обещать ровно то число, которое потом уедет в
// смету: считается оно тем же roomArea, что и позиции правила.
{
  t.section('Объёмы под кнопками')
  const A = ruleAreas(SHEET, R({ estId: 'e_osb' }), TYPES)
  t.ok('перечислены все помещения', A.rooms.length === rooms.length, 'помещений: ' + A.rooms.length)
  t.ok('пол сходится с расчётом', Math.abs(A.floor - rooms.reduce((a, r) => a + r.floor, 0)) < 0.05)
  t.ok('стены сходятся с правилом',
    Math.abs(A.wall - run([R({ estId: 'e_osb', scope: 'house' })])[0].area) < 0.05)
  t.ok('«стены + потолок» — сумма двух', Math.abs(A.wallceil - (A.wall + A.ceil)) < 0.05)
  t.ok('«без проёмов» тоже посчитано', A.wallnet > 0 && A.wallnet <= A.wall, A.wallnet + ' / ' + A.wall)
  t.ok('и «без проёмов + потолок» сходится', Math.abs(A.wallnetceil - (A.wallnet + A.ceil)) < 0.05)

  // Фильтр по помещению отбирает и числа: выбрали санузел — на кнопке его квадраты.
  const one = ruleAreas(SHEET, R({ estId: 'e_osb', room: 'Санузел' }), TYPES)
  const san = A.rooms.find((r) => r.name === 'Санузел')
  t.ok('фильтр оставил одно помещение', one.matched === 1, 'совпало: ' + one.matched)
  t.ok('и число на кнопке — его собственное', Math.abs(one.wall - san.wall) < 0.05)
  t.ok('у каждого помещения свои квадраты', A.rooms.every((r) => r.floor > 0 && r.ceil === r.floor))
  t.ok('и видно, какие попали под фильтр', one.rooms.filter((r) => r.match).length === 1)
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

// ── Адрес по строке справочника ─────────────────────────────────────────────
// Адресом расчётного материала был его товар, и это ломалось дважды: один товар
// может стоять в смете двумя строками, а замена меняет товар прямо в строке.
// Id строки справочника не зависит ни от того, ни от другого — и переживает
// перестановку строк, чего номер повтора не умел.
{
  t.section('Адрес по строке сметы')
  const EST_ID = [{ id: 'e_two', kind: 'house', name: 'Обшивка', stage: 2,
    lines: [{ id: 'L1', pid: 'p_osb', qty: 1 }, { id: 'L2', pid: 'p_osb', qty: 2 }] }]
  const pos = stampMatIx(sheetPositions(probeSheet(SHEET, TYPES), EST_ID, PRODUCTS))
    .filter((p) => p.estId === 'e_two')
  t.ok('строка посчиталась', pos.length === 1 && pos[0].mats.length === 2,
    JSON.stringify(pos.map((p) => (p.mats || []).length)))
  t.ok('id строки доехал до материала', pos[0].mats[0].lid === 'L1' && pos[0].mats[1].lid === 'L2')
  t.ok('адрес — по строке', matKeyOf(pos[0].mats[0]) === 'l:L1' && matKeyOf(pos[0].mats[1]) === 'l:L2',
    pos[0].mats.map(matKeyOf).join(','))

  // Правки адресуются строками и друг друга не задевают.
  const q = applyMatEdits(pos, { matQty: { 'base:e_two': { 'l:L2': 9 } } }, PRODUCTS)[0]
  t.ok('количество досталось своей строке', q.mats[1].qty === 9 && q.mats[0].qty === 1,
    JSON.stringify(q.mats.map((m) => m.qty)))
  const sw = applyMatEdits(pos, { mats: { 'base:e_two': { 'l:L2': 'p_tile' } } }, PRODUCTS)[0]
  t.ok('замена — тоже своей', sw.mats[0].pid === 'p_osb' && sw.mats[1].pid === 'p_tile',
    JSON.stringify(sw.mats.map((m) => m.pid)))
  t.ok('и адрес замену пережил', matKeyOf(sw.mats[1]) === 'l:L2', matKeyOf(sw.mats[1]))

  // ГЛАВНОЕ: строки переставили в справочнике — правка осталась на своей.
  const swapped = [{ id: 'e_two', kind: 'house', name: 'Обшивка', stage: 2,
    lines: [{ id: 'L2', pid: 'p_osb', qty: 2 }, { id: 'L1', pid: 'p_osb', qty: 1 }] }]
  const after = applyMatEdits(
    stampMatIx(sheetPositions(probeSheet(SHEET, TYPES), swapped, PRODUCTS)).filter((p) => p.estId === 'e_two'),
    { matQty: { 'base:e_two': { 'l:L2': 9 } } }, PRODUCTS)[0]
  const mine = after.mats.filter((m) => m.lid === 'L2')[0]
  t.ok('правка осталась на своей строке', mine.qty === 9, JSON.stringify(after.mats.map((m) => [m.lid, m.qty])))
  t.ok('а соседняя не тронута', after.mats.filter((m) => m.lid === 'L1')[0].qty === 1)
}

// ── Правки по прежним адресам ───────────────────────────────────────────────
// Под старыми адресами (по товару) лежат правки боевых листов. Переписывать их
// в снимке ради нового формата опаснее, чем прочитать оба: читаем новый, а не
// нашли — прежний.
{
  t.section('Прежние адреса читаются')
  const EST_ID = [{ id: 'e_one', kind: 'house', name: 'Обшивка', stage: 2,
    lines: [{ id: 'L1', pid: 'p_osb', qty: 1 }] }]
  const pos = stampMatIx(sheetPositions(probeSheet(SHEET, TYPES), EST_ID, PRODUCTS))
    .filter((p) => p.estId === 'e_one')
  t.ok('адреса перечислены новый-старый',
    matAddrs(pos[0].mats[0]).join(',') === 'l:L1,p_osb', matAddrs(pos[0].mats[0]).join(','))
  t.ok('прежний адрес считается', matLegacyKey(pos[0].mats[0]) === 'p_osb')

  const old = applyMatEdits(pos, { matQty: { 'base:e_one': { p_osb: 4 } } }, PRODUCTS)[0]
  t.ok('старое количество применилось', old.mats[0].qty === 4, String(old.mats[0].qty))
  const oldSwap = applyMatEdits(pos, { mats: { 'base:e_one': { p_osb: 'p_tile' } } }, PRODUCTS)[0]
  t.ok('старая замена применилась', oldSwap.mats[0].pid === 'p_tile')
  const oldOff = applyMatEdits(pos, { matOff: { 'base:e_one': ['p_osb'] } }, PRODUCTS)[0]
  t.ok('старое «убрать» применилось', oldOff.mats.length === 0, String(oldOff.mats.length))
  // Новый адрес главнее: человек правил уже в новом формате.
  const both = applyMatEdits(pos, { matQty: { 'base:e_one': { p_osb: 4, 'l:L1': 6 } } }, PRODUCTS)[0]
  t.ok('новый адрес перебивает прежний', both.mats[0].qty === 6, String(both.mats[0].qty))
}

// ── Сколько нужно на объём строки ────────────────────────────────────────────
// «Стены спальня · 26,87 м²» — фанеру дописали руками, и она встала «1 лист»:
// число из формы так и осталось числом. Портал подсказывает, сколько ЦЕЛЫХ
// покупок нужно на площадь строки (`matNeedForArea`), а решает человек.
{
  t.section('Сколько нужно на объём строки')
  const PLY = { mode: 'sheet', packBase: 'м²', packPer: 2.325 }

  t.ok('листов фанеры на 26,87 м² — 12', matNeedForArea(PLY, 26.87) === 12,
    String(matNeedForArea(PLY, 26.87)))
  t.ok('ровно в лист — без лишнего', matNeedForArea(PLY, 4.65) === 2, String(matNeedForArea(PLY, 4.65)))
  // Множитель правила («×2») умножает площадь, а не округлённые листы.
  t.ok('на удвоенную площадь — 24', matNeedForArea(PLY, 26.87 * 2) === 24)
  t.ok('м² — сама площадь', matNeedForArea({ mode: 'm2' }, 26.87) === 26.87)
  t.ok('штучный — подсказки нет', matNeedForArea({ mode: 'piece' }, 26.87) === 0)
  t.ok('лист без фасовки — делить не на что', matNeedForArea({ mode: 'sheet' }, 26.87) === 0)
  t.ok('строка без площади — считать не от чего', matNeedForArea(PLY, 0) === 0)

  // Совпадает ли количество с объёмом. Расчётный лист считается дробно (8,96
  // листа ГКЛ на 26,87 м²) — это те же 9 покупок, и подсказывать там нечего.
  const GKL = { mode: 'sheet', packBase: 'м²', packPer: 3 }
  t.ok('8,96 листа — это 9 покупок, совпадает', matNeedOk(GKL, 26.87, 8.96) === true)
  t.ok('ровно 9 — тоже', matNeedOk(GKL, 26.87, 9) === true)
  t.ok('5 листов на 26,87 м² — мало', matNeedOk(GKL, 26.87, 5) === false)
  t.ok('15 листов — лишнее', matNeedOk(GKL, 26.87, 15) === false)
  t.ok('м² — сверка по площади', matNeedOk({ mode: 'm2' }, 26.87, 26.87) === true
    && matNeedOk({ mode: 'm2' }, 26.87, 20) === false)
  t.ok('считать не от чего — и сверять нечего', matNeedOk({ mode: 'piece' }, 26.87, 1) === false)

  // Ручное число, которое не сходится с объёмом строки, может сходиться с другим
  // объёмом дома: звукоизоляция в «Монтаже стен из ОСП» идёт только в перегородки.
  const ACU = { mode: 'pack', packBase: 'м²', packPer: 6 }
  const VOLS = [{ n: 'стены дома', area: 90.65 }, { n: 'перегородки', area: 11.76 }]
  t.ok('2 пачки — это перегородки', (matNeedMatch(ACU, 2, VOLS) || {}).n === 'перегородки',
    JSON.stringify(matNeedMatch(ACU, 2, VOLS)))
  t.ok('16 пачек — стены дома', (matNeedMatch(ACU, 16, VOLS) || {}).n === 'стены дома')
  t.ok('5 пачек — ни с чем не сходится', matNeedMatch(ACU, 5, VOLS) === null)
  t.ok('штучный ни с чем не сверяется', matNeedMatch({ mode: 'piece' }, 2, VOLS) === null)
}

// ── Объём по названию работы ─────────────────────────────────────────────────
// Строка без объёма («Монтаж стен из ОСП») встаёт «на весь дом» числом из
// справочника, хотя по названию видно, чем она меряется. Портал предлагает объём —
// поверхность и, если названо, помещение, — а ставит его человек.
{
  t.section('Объём по названию работы')
  const ROOMS = ['Санузел', 'Зал', 'Спальня', '']
  const g = (n) => JSON.stringify(guessVolume(n, ROOMS))
  t.ok('стены из ОСП — стены всего дома', g('Монтаж стен из ОСП, и утеплителя') === '{"k":"wall","room":""}', g('Монтаж стен из ОСП, и утеплителя'))
  t.ok('стены зала — стены зала', g('Стены зал') === '{"k":"wall","room":"Зал"}', g('Стены зал'))
  t.ok('пол санузла — пол санузла, хоть и через пробел', g('Пол сан узел') === '{"k":"floor","room":"Санузел"}', g('Пол сан узел'))
  t.ok('стены и потолок — одна поверхность', g('Утепление стен и потолка — ППУ 5 см') === '{"k":"wallceil","room":""}', g('Утепление стен и потолка — ППУ 5 см'))
  t.ok('тёплый пол — пол', g('Монтаж тёплого пола с заливкой') === '{"k":"floor","room":""}', g('Монтаж тёплого пола с заливкой'))
  t.ok('потолок спальни', g('Потолок спальни') === '{"k":"ceil","room":"Спальня"}', g('Потолок спальни'))
  t.ok('полотенцесушитель — не пол', g('Элетрический полотенцесушитель') === 'null')
  t.ok('полиэтилен — не пол', g('Водоснабжение — сшитый полиэтилен') === 'null')
  // «Стены и пол» одной поверхностью портал не меряет — выдумывать её нельзя.
  t.ok('стены и пол — предложить нечего', g('Санузел — гидроизоляция стен и пола') === 'null')
  t.ok('унитаз — не поверхность', g('Монтаж унитаза') === 'null')
}

// ── Правки строки переезжают вместе с ней под правило ────────────────────────
// Правило ЗАМЕНЯЕТ обязательную строку, и ключ у неё новый: был `base:<смета>`,
// стал `rule:<правило>:<комната>`. Правки листа лежат по ключу — дописанная
// фанера, ручные 12 упаковок клея, часы, убранные материалы — и оставались под
// старым, невидимые. На «Доме СВО» и «Мордвесе» так уже пропали правки.
{
  t.section('Правки переезжают под правило')
  const A = { id: 'm1', pid: 'p_ply', n: 'Фанера', qty: 1 }
  const RP = [{ key: 'rule:r1:house', estId: 'e1', ruleId: 'r1' }]
  const sh = { matAdd: { 'base:e1': [A] }, matQty: { 'base:e1': { '+m1': 12 } }, posHours: { 'base:e1': 3, 'base:e2': 1 } }
  t.ok('перенос случился', carryRuleEdits(sh, RP) === true)
  t.ok('дописанный материал доехал', (sh.matAdd['rule:r1:house'] || [])[0] === A && !sh.matAdd['base:e1'],
    JSON.stringify(sh.matAdd))
  t.ok('ручное количество доехало', sh.matQty['rule:r1:house']['+m1'] === 12)
  t.ok('часы доехали', sh.posHours['rule:r1:house'] === 3 && sh.posHours['base:e1'] === undefined)
  t.ok('строку без правила не трогаем', sh.posHours['base:e2'] === 1)
  t.ok('повтор ничего не меняет', carryRuleEdits(sh, RP) === false)

  // Строку под правилом уже правили — человек работает с тем, что видит, и
  // старые правки поверх не воскрешаем: ни фанеру второй раз, ни давний этап.
  const B = { id: 'm2', pid: 'p_ply', n: 'Фанера', qty: 12 }
  const own = { matAdd: { 'base:e1': [A], 'rule:r1:house': [B] }, posStage: { 'base:e1': 3 } }
  t.ok('в тронутую строку ничего не везём', carryRuleEdits(own, RP) === false)
  t.ok('её фанера одна', own.matAdd['rule:r1:house'].length === 1 && own.matAdd['rule:r1:house'][0] === B)
  t.ok('и давний этап не приехал', own.posStage['rule:r1:house'] === undefined && own.posStage['base:e1'] === 3)

  // «Убрано из дома» прячет работу целиком — молча прятать то, что сейчас в
  // смете, нельзя. Остальное едет, а эта отметка остаётся на месте.
  const off = { posOff: { 'base:e1': 1 }, posHours: { 'base:e1': 2 } }
  carryRuleEdits(off, RP)
  t.ok('«убрано» не переезжает', off.posOff['base:e1'] === 1 && off.posOff['rule:r1:house'] === undefined)
  t.ok('а часы переезжают', off.posHours['rule:r1:house'] === 2)

  // Правило по каждой комнате даёт несколько строк: куда ехать, говорит комната,
  // к которой строку приписали. Не сказано — гадать нельзя, правки остаются.
  const RR = [{ key: 'rule:r1:kA', estId: 'e1', ruleId: 'r1', roomId: 'kA' }, { key: 'rule:r1:kB', estId: 'e1', ruleId: 'r1', roomId: 'kB' }]
  const byRoom = { posRoom: { 'base:e1': 'kB' }, posHours: { 'base:e1': 5 } }
  carryRuleEdits(byRoom, RR)
  t.ok('едет в строку своей комнаты', byRoom.posHours['rule:r1:kB'] === 5 && byRoom.posHours['rule:r1:kA'] === undefined,
    JSON.stringify(byRoom.posHours))
  const blind = { posHours: { 'base:e1': 5 } }
  t.ok('комната не названа — остаётся на месте', carryRuleEdits(blind, RR) === false && blind.posHours['base:e1'] === 5)

  // Правило сменило комнату («весь дом» → «Зал»): старый ключ того же правила.
  const moved = { posHours: { 'rule:r1:house': 4 } }
  carryRuleEdits(moved, [{ key: 'rule:r1:kA', estId: 'e1', ruleId: 'r1', roomId: 'kA' }])
  t.ok('правки старого ключа правила доезжают', moved.posHours['rule:r1:kA'] === 4 && moved.posHours['rule:r1:house'] === undefined)
}

t.done()
