#!/usr/bin/env node
// Расчёт спецификации дома (src/spec.js).
//
// Это цена, которую продавец называет клиенту и которая уходит в договор, поэтому
// сторожим не «функция что-то вернула», а решения: площади берутся из комнат, фасовки
// пересчитываются, выбор варианта меняет сумму, а недособранная спека честно об этом говорит.
import { roomArea, matQtyForArea, optionGroups, baseEstimates, sheetPositions, sheetTotals, sheetIssues } from '../src/spec.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}

const PRODUCTS = [
  { id: 'p_gkl', name: 'ГКЛ 12,5 мм', unitCost: 400, store: 'Лемана', mode: 'sheet', packBase: 'м²', packPer: 3 },
  { id: 'p_mdf', name: 'МДФ панель', unitCost: 700, store: 'Белка', mode: 'm2' },
  { id: 'p_ppu3', name: 'ППУ 3 см', unitCost: 500, store: 'Белка', mode: 'm2' },
  { id: 'p_ppu8', name: 'ППУ 8 см', unitCost: 1100, store: 'Белка', mode: 'm2' },
  { id: 'p_tile', name: 'Плитка', unitCost: 1200, store: 'Лемана', mode: 'm2' },
  { id: 'p_lam', name: 'Ламинат', unitCost: 800, store: 'Лемана', mode: 'm2' },
  { id: 'p_screw', name: 'Саморезы', unitCost: 300, store: 'Озон', mode: 'piece' },
]

const EST = [
  // Обязательная позиция — входит всегда.
  { id: 'e_base', kind: 'banya', name: 'Каркас и обвязка', stage: 1, lines: [{ pid: 'p_screw', qty: 4 }] },
  // Стены комнаты: ГКЛ или МДФ.
  { id: 'e_gkl', kind: 'banya', name: 'Стены ГКЛ', stage: 2, optScope: 'room', optGroup: 'Стены', optLabel: 'ГКЛ', optSurface: 'wall',
    lines: [{ pid: 'p_gkl', qty: 1 }, { pid: 'p_screw', qty: 1 }] },
  { id: 'e_mdf', kind: 'banya', name: 'Стены МДФ', stage: 2, optScope: 'room', optGroup: 'Стены', optLabel: 'МДФ', optSurface: 'wall',
    lines: [{ pid: 'p_mdf', qty: 1 }] },
  // Пол комнаты.
  { id: 'e_tile', kind: 'banya', name: 'Пол плитка', stage: 3, optScope: 'room', optGroup: 'Пол', optLabel: 'Плитка', optSurface: 'floor',
    lines: [{ pid: 'p_tile', qty: 1 }] },
  { id: 'e_lam', kind: 'banya', name: 'Пол ламинат', stage: 3, optScope: 'room', optGroup: 'Пол', optLabel: 'Ламинат', optSurface: 'floor',
    lines: [{ pid: 'p_lam', qty: 1 }] },
  // Общедомовая опция — утепление контура по площади стен всего дома.
  { id: 'e_ppu3', kind: 'banya', name: 'Утепление ППУ 3 см', stage: 1, optScope: 'global', optGroup: 'Утепление', optLabel: '3 см', optSurface: 'wall',
    lines: [{ pid: 'p_ppu3', qty: 1 }] },
  { id: 'e_ppu8', kind: 'banya', name: 'Утепление ППУ 8 см', stage: 1, optScope: 'global', optGroup: 'Утепление', optLabel: '8 см', optSurface: 'wall',
    lines: [{ pid: 'p_ppu8', qty: 1 }] },
  // Чужой вид — в баню попадать не должен.
  { id: 'e_house', kind: 'house', name: 'Крыльцо дома', stage: 1, lines: [{ pid: 'p_screw', qty: 1 }] },
]

// Планировка: парная 2×3 (периметр 10 м) и комната отдыха 3×4 (периметр 14 м), потолок 2,5.
const SHEET = () => ({
  id: 'sp1', kind: 'banya', name: 'Баня Иванова', markup: 40,
  specs: { height: 2.5, rooms: [
    { id: 'r1', name: 'Парная', w: 2, l: 3, wallLen: 10 },
    { id: 'r2', name: 'Комната отдыха', w: 3, l: 4, wallLen: 14 },
  ], openings: [] },
  rooms: {}, global: {}, qty: {},
})

// ── 1. Площади из размеров комнаты ───────────────────────────────────────────
{
  console.log('Площади помещения')
  const r = { id: 'r', name: 'Парная', w: 2, l: 3, wallLen: 10 }
  ok('пол = ширина × длина', roomArea(r, 2.5, 'floor') === 6)
  ok('потолок равен полу', roomArea(r, 2.5, 'ceil') === 6, 'это одна и та же плоскость, а не отдельный размер')
  ok('стены = периметр × высота', roomArea(r, 2.5, 'wall') === 25)
  ok('без высоты стены нулевые', roomArea(r, 0, 'wall') === 0)
}

// ── 2. Количество по фасовке ─────────────────────────────────────────────────
{
  console.log('Пересчёт количества под площадь')
  ok('м² идут как есть', matQtyForArea({ mode: 'm2' }, 25) === 25)
  ok('листы через фасовку и вверх', matQtyForArea({ mode: 'sheet', packBase: 'м²', packPer: 3 }, 25) === 8.34,
    String(matQtyForArea({ mode: 'sheet', packBase: 'м²', packPer: 3 }, 25)) + ' — 25 ÷ 3, округление вверх')
  ok('штучное не трогаем', matQtyForArea({ mode: 'piece', qty: 4 }, 25) === 4,
    'саморезы не считаются от площади — их кладут пачками')
}

// ── 3. Группы вариантов ──────────────────────────────────────────────────────
{
  console.log('Группы выбора')
  const rooms = optionGroups(EST, 'banya', 'room')
  ok('две группы по комнате', rooms.map((g) => g.group).sort().join(',') === 'Пол,Стены', JSON.stringify(rooms.map((g) => g.group)))
  ok('в группе «Стены» два варианта', rooms.find((g) => g.group === 'Стены').variants.length === 2)
  ok('у группы известна площадь-основание', rooms.find((g) => g.group === 'Стены').surface === 'wall')
  const glob = optionGroups(EST, 'banya', 'global')
  ok('общедомовая группа одна', glob.length === 1 && glob[0].group === 'Утепление')
  ok('чужой вид не попал', !optionGroups(EST, 'banya', '').some((g) => g.group === 'Крыльцо'))
  ok('обязательные позиции отобраны', baseEstimates(EST, 'banya').map((e) => e.id).join(',') === 'e_base')
}

// ── 4. Состав спецификации ───────────────────────────────────────────────────
{
  console.log('Состав спецификации')
  const s = SHEET()
  s.rooms = { r1: { 'Стены': 'e_gkl', 'Пол': 'e_tile' }, r2: { 'Стены': 'e_mdf', 'Пол': 'e_lam' } }
  s.global = { 'Утепление': 'e_ppu8' }
  const pos = sheetPositions(s, EST, PRODUCTS)
  ok('позиций: обязательная + 4 по комнатам + общедомовая', pos.length === 6, String(pos.length))

  const parWall = pos.find((p) => p.key === 'room:r1:Стены')
  ok('стены парной посчитаны от её площади', parWall.area === 25, String(parWall.area))
  ok('ГКЛ пересчитан в листы', parWall.mats.find((m) => m.pid === 'p_gkl').qty === 8.34)
  ok('саморезы в той же работе остались штучными', parWall.mats.find((m) => m.pid === 'p_screw').qty === 1,
    'от площади считается только то, что ею меряется')

  const koFloor = pos.find((p) => p.key === 'room:r2:Пол')
  ok('пол комнаты отдыха — 12 м² ламината', koFloor.area === 12 && koFloor.mats[0].qty === 12)
  ok('и стоит 12 × 800', koFloor.cost === 9600, String(koFloor.cost))

  const ins = pos.find((p) => p.key === 'global:Утепление')
  ok('утепление считается от стен ВСЕГО дома', ins.area === 60, String(ins.area) + ' — 25 + 35')
  ok('и по цене выбранной толщины', ins.cost === 60 * 1100, String(ins.cost))

  ok('позиция знает комнату и поверхность', parWall.roomId === 'r1' && parWall.room === 'Парная' && parWall.surface === 'wall')
  ok('и свою смету — по ней потом соберётся объект', parWall.estId === 'e_gkl')
}

// ── 5. Выбор варианта меняет цену ────────────────────────────────────────────
{
  console.log('Смена варианта')
  const s = SHEET()
  s.rooms = { r1: { 'Стены': 'e_gkl' }, r2: { 'Стены': 'e_gkl' } }
  s.global = { 'Утепление': 'e_ppu3' }
  const cheap = sheetTotals(s, EST, PRODUCTS)

  s.global = { 'Утепление': 'e_ppu8' }
  const dear = sheetTotals(s, EST, PRODUCTS)
  ok('ППУ 8 см дороже ППУ 3 см ровно на разницу', dear.cost - cheap.cost === 60 * (1100 - 500),
    String(dear.cost - cheap.cost))

  s.rooms = { r1: { 'Стены': 'e_mdf' }, r2: { 'Стены': 'e_mdf' } }
  const mdf = sheetTotals(s, EST, PRODUCTS)
  ok('смена стен на МДФ тоже меняет итог', mdf.cost !== dear.cost)
  ok('наценка применяется к итогу', mdf.price === Math.round(mdf.cost * 1.4), String(mdf.price) + ' vs ' + mdf.cost)
  ok('разбивка по этапам есть', Object.keys(mdf.byStage).length >= 2, JSON.stringify(mdf.byStage))
}

// ── 6. Ручная правка количества ──────────────────────────────────────────────
{
  console.log('Ручная правка')
  const s = SHEET()
  s.rooms = { r1: { 'Пол': 'e_tile' } }
  const before = sheetTotals(s, EST, PRODUCTS).cost
  s.qty = { 'room:r1:Пол': 2 }
  const after = sheetTotals(s, EST, PRODUCTS).cost
  // Удваивается ИМЕННО правленая позиция (пол 6 м² × 1200), а не весь итог: обязательные
  // позиции к ней отношения не имеют.
  ok('коэффициент удваивает только свою позицию', after - before === 6 * 1200, before + ' → ' + after)
  ok('стройка всегда точнее калькулятора — правка возможна', sheetPositions(s, EST, PRODUCTS)[1].factor === 2)
}

// ── 7. Недособранная спецификация говорит об этом ────────────────────────────
{
  console.log('Проверка готовности')
  const empty = sheetIssues({ id: 'x', kind: 'banya', specs: { rooms: [] }, rooms: {}, global: {} }, EST, PRODUCTS)
  ok('нет планировки — сказано прямо', empty.some((x) => /планировка/i.test(x)), JSON.stringify(empty))
  ok('и что выбор не сделан', empty.some((x) => /Утепление/.test(x)), JSON.stringify(empty))

  const s = SHEET()
  s.rooms = { r1: { 'Стены': 'e_gkl', 'Пол': 'e_tile' }, r2: { 'Стены': 'e_mdf', 'Пол': 'e_lam' } }
  s.global = { 'Утепление': 'e_ppu8' }
  ok('собранная спецификация замечаний не даёт', sheetIssues(s, EST, PRODUCTS).length === 0,
    JSON.stringify(sheetIssues(s, EST, PRODUCTS)))

  const noH = SHEET(); noH.specs.height = 0
  noH.global = { 'Утепление': 'e_ppu8' }
  ok('без высоты потолка предупреждаем', sheetIssues(noH, EST, PRODUCTS).some((x) => /высота/i.test(x)))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
