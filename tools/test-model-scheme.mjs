#!/usr/bin/env node
// Схема плана (modelScheme в src/model.js).
//
// Схема — чертёж, по которому строят, поэтому сторожим то, из-за чего чертёж врёт:
// размерная цепочка обязана сходиться в габарит (иначе на площадке замер не бьётся),
// проём обязан лежать в толще своей стены, а перегородки — стоять там же, где их
// видит расчёт площадей. И ничего лишнего: мебели, сантехники и площадей на схеме нет.
import { modelScheme, presetModel, emptyModel, splitAt, splitLengthwiseAt, totalLength,
  modelBays, modelRooms } from '../src/model.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}
const ids = () => { let i = 0; return () => 'id' + (++i) }
const sum = (a) => a.reduce((x, y) => x + y, 0)

// ── 1. Цепочки сходятся ──────────────────────────────────────────────────────
{
  console.log('Размерные цепочки')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)

  ok('габарит равен длине модели', sc.l === totalLength(model) && sc.w === model.w)
  sc.dims.forEach((d) => ok('«' + d.name + '» (' + d.side + ') сходится в габарит',
    sum(d.segs) === d.span, sum(d.segs) + ' ≠ ' + d.span + ' · ' + d.segs.join(' ')))

  const bay = sc.dims.find((d) => d.name === 'Помещения и перегородки')
  ok('цепочка помещений — обшивка, комнаты и перегородки',
    bay.segs.join(' ') === '76 2000 100 6400 100 3200 76', bay.segs.join(' '))
  const bot = sc.dims.find((d) => d.side === 'bottom')
  ok('цепочка проёмов длинной стены', bot.segs.join(' ') === '2976 1500 800 1000 5676', bot.segs.join(' '))
  const right = sc.dims.find((d) => d.side === 'right')
  ok('цепочка проёмов торца', right.segs.join(' ') === '176 2000 176', right.segs.join(' '))
  ok('ширина: обшивка и чистовой размер',
    sc.dims.find((d) => d.name === 'Ширина').segs.join(' ') === '76 2200 76')

  // Отметки цепочки идут по возрастанию и без дублей — иначе сегмент нулевой длины.
  sc.dims.forEach((d) => {
    const asc = d.ticks.every((v, i) => i === 0 || v > d.ticks[i - 1])
    ok('«' + d.name + '» (' + d.side + '): отметки без дублей и по порядку', asc, d.ticks.join(' '))
  })
}

// ── 2. Стены и перегородки ───────────────────────────────────────────────────
{
  console.log('Стены')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)
  const shell = sc.walls.filter((w) => w.kind === 'shell')
  const part = sc.walls.filter((w) => w.kind === 'part')
  ok('коробка обшита с четырёх сторон', shell.length === 4)
  ok('перегородок на одну меньше, чем отсеков', part.length === modelBays(model).length - 1, String(part.length))
  ok('перегородки стоят между отсеками',
    part.every((w) => modelBays(model).some((b) => b.x1 === w.x)), JSON.stringify(part.map((w) => w.x)))
  ok('перегородка не залезает в обшивку',
    part.every((w) => w.y === sc.finish && w.y + w.h === sc.w - sc.finish))
  ok('толщина перегородки из модели', part.every((w) => w.w === model.wallThick))

  // Продольная перегородка — санузел в углу.
  let m = emptyModel('40hc')
  m.rooms[0].id = 'b1'
  m = splitAt(m, 4000, 'b2')
  m = splitLengthwiseAt(m, 'b1', 1200, 'b1s')
  const sc2 = modelScheme(m, [])
  const lengthwise = sc2.walls.filter((w) => w.kind === 'part' && w.h === m.wallThick)
  ok('продольная перегородка нарисована', lengthwise.length === 1, JSON.stringify(sc2.walls))
  ok('она стоит на своей отметке по ширине', lengthwise[0] && lengthwise[0].y === 1200)
  ok('и не выходит за обшивку',
    lengthwise[0] && lengthwise[0].x >= sc2.finish && lengthwise[0].x + lengthwise[0].w <= sc2.l - sc2.finish)
}

// ── 3. Проёмы лежат в толще своей стены ──────────────────────────────────────
{
  console.log('Проёмы')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)
  ok('все проёмы на месте', sc.openings.length === 3)
  sc.openings.forEach((o) => {
    const inBand = (o.side === 'n') ? (o.y === 0 && o.h === sc.finish)
      : (o.side === 's') ? (o.y + o.h === sc.w && o.h === sc.finish)
        : (o.side === 'w') ? (o.x === 0 && o.w === sc.finish)
          : (o.x + o.w === sc.l && o.w === sc.finish)
    ok('«' + o.name + '» в толще стены ' + o.side, inBand, JSON.stringify(o))
    ok('«' + o.name + '» не выходит за стену',
      (o.side === 'n' || o.side === 's') ? (o.x >= 0 && o.x + o.w <= sc.l) : (o.y >= 0 && o.y + o.h <= sc.w))
  })
  ok('дверь опознана дверью', sc.openings.filter((o) => o.kind === 'door').length === 1)
  ok('высота и подоконник приехали из изделия',
    sc.openings.some((o) => o.height === 2200 && o.sill === 200), JSON.stringify(sc.openings.map((o) => [o.height, o.sill])))

  // Проём без изделия рисовать нечем — на схему он не попадает, а не встаёт нулевым.
  const broken = Object.assign({}, model, {
    openings: model.openings.concat([{ id: 'ghost', side: 'n', pos: 1000, typeId: 'нет такого' }]),
  })
  ok('проём без изделия на схему не попал', modelScheme(broken, winTypes).openings.length === 3)
}

// ── 4. Ничего лишнего ────────────────────────────────────────────────────────
{
  console.log('Чего на схеме нет')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)
  const flat = JSON.stringify(sc)
  ok('площадей нет', flat.indexOf('"area"') < 0 && flat.indexOf('"floorArea"') < 0)
  ok('раскладки (розетки, мебель) нет', flat.indexOf('"pts"') < 0)
  ok('имён помещений нет', modelRooms(model).every((r) => flat.indexOf('"' + r.name + '"') < 0),
    modelRooms(model).map((r) => r.name).join(', '))
  ok('в схеме только стены, проёмы и размеры',
    Object.keys(sc).sort().join(' ') === 'dims finish l openings w wallThick walls', Object.keys(sc).sort().join(' '))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
