#!/usr/bin/env node
// Правила сборки (src/recipe.js): чертёж → работы без ручного выбора.
//
// Правило говорит только, К ЧЕМУ применяется смета из справочника, а считается
// позиция общей машинкой. Сторожим ровно это: что правило берёт числа из модели,
// что материалы остаются сметиными, что недонастроенное правило молчит и что
// список из справочника и список из правил складываются, а не подменяют друг друга.
import { presetModel, MODEL_PRESETS } from '../src/model.js'
import { sheetPositions } from '../src/spec.js'
import { rulePositions, allPositions, ruleText, ruleReady, probeSheet } from '../src/recipe.js'
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

t.done()
