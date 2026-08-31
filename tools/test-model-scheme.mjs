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
  // Сумма цепочки обязана равняться расстоянию между её крайними отметками — иначе
  // подпись на чертеже врёт. У внешних цепочек это ещё и весь габарит; внутренние
  // (двери в перегородках) меряются от чистовых стен, и обшивка в них не входит.
  sc.dims.forEach((d) => {
    ok('«' + d.name + '» (' + d.side + ') сходится по своим отметкам',
      sum(d.segs) === d.ticks[d.ticks.length - 1] - d.ticks[0],
      sum(d.segs) + ' · ' + d.segs.join(' '))
    if (!d.inner) ok('«' + d.name + '» (' + d.side + ') покрывает габарит целиком',
      sum(d.segs) === d.span, sum(d.segs) + ' ≠ ' + d.span)
    else ok('«' + d.name + '» меряется от чистовых стен',
      sum(d.segs) === d.span - sc.finish * 2, sum(d.segs) + ' ≠ ' + (d.span - sc.finish * 2))
  })

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
  ok('все проёмы на месте, включая межкомнатные', sc.openings.length === 5, String(sc.openings.length))
  sc.openings.filter((o) => o.side !== 'part').forEach((o) => {
    const inBand = (o.side === 'n') ? (o.y === 0 && o.h === sc.finish)
      : (o.side === 's') ? (o.y + o.h === sc.w && o.h === sc.finish)
        : (o.side === 'w') ? (o.x === 0 && o.w === sc.finish)
          : (o.x + o.w === sc.l && o.w === sc.finish)
    ok('«' + o.name + '» в толще стены ' + o.side, inBand, JSON.stringify(o))
    ok('«' + o.name + '» не выходит за стену',
      (o.side === 'n' || o.side === 's') ? (o.x >= 0 && o.x + o.w <= sc.l) : (o.y >= 0 && o.y + o.h <= sc.w))
  })
  ok('дверей три: вход и две межкомнатные', sc.openings.filter((o) => o.kind === 'door').length === 3)

  // Проём в перегородке лежит в её толще, а не рядом.
  const inner = sc.openings.filter((o) => o.side === 'part')
  ok('две двери в перегородках', inner.length === 2)
  inner.forEach((o) => {
    const wall = sc.walls.find((w) => w.kind === 'part' && w.x === o.x && w.w === o.w)
    ok('«' + o.mark + '» в толще перегородки', !!wall, JSON.stringify(o))
    ok('«' + o.mark + '» не выходит за чистовые стены',
      o.y >= sc.finish && o.y + o.h <= sc.w - sc.finish, JSON.stringify(o))
  })
  // Створка: петли, откос и полотно — три точки, по которым панель рисует дугу.
  sc.openings.filter((o) => o.kind === 'door').forEach((o) => {
    const s2 = o.swing
    const len = Math.round(Math.hypot(s2.tip.x - s2.hinge.x, s2.tip.y - s2.hinge.y))
    ok('«' + o.mark + '»: полотно равно ширине проёма', len === o.width, len + ' ≠ ' + o.width)
    const jl = Math.round(Math.hypot(s2.jamb.x - s2.hinge.x, s2.jamb.y - s2.hinge.y))
    ok('«' + o.mark + '»: откосы на ширину проёма', jl === o.width, jl + ' ≠ ' + o.width)
  })
  ok('у окна створки нет', sc.openings.filter((o) => o.kind === 'win').every((o) => o.swing === null))
  ok('марки проставлены', sc.openings.map((o) => o.mark).join(' ') === 'О-1 Д-1 О-2 Д-2 Д-3',
    sc.openings.map((o) => o.mark).join(' '))

  // Цепочка двери в перегородке меряется от ЧИСТОВЫХ стен, как на чертеже.
  const d2 = sc.dims.find((d) => d.name === 'Д-2')
  ok('Д-2: 750 · 700 · 750', d2 && d2.segs.join(' ') === '750 700 750', d2 && d2.segs.join(' '))
  ok('Д-2 стоит у своей перегородки', d2 && d2.at === sc.walls.find((w) => w.kind === 'part').x)
  const d3 = sc.dims.find((d) => d.name === 'Д-3')
  ok('Д-3: 1450 · 700 · 50', d3 && d3.segs.join(' ') === '1450 700 50', d3 && d3.segs.join(' '))
  ok('обе цепочки внутренние', d2 && d3 && d2.inner === true && d3.inner === true)
  ok('высота и подоконник приехали из изделия',
    sc.openings.some((o) => o.height === 2200 && o.sill === 200), JSON.stringify(sc.openings.map((o) => [o.height, o.sill])))

  // Проём без изделия рисовать нечем — на схему он не попадает, а не встаёт нулевым.
  const broken = Object.assign({}, model, {
    openings: model.openings.concat([{ id: 'ghost', side: 'n', pos: 1000, typeId: 'нет такого' }]),
  })
  ok('проём без изделия на схему не попал', modelScheme(broken, winTypes).openings.length === 5)

  // Дверь в перегородке, которой больше нет (отсеки слили), рисовать не на чем.
  const orphan = Object.assign({}, model, {
    openings: model.openings.map((o) => (o.side === 'part' ? Object.assign({}, o, { after: 'нет отсека' }) : o)),
  })
  ok('дверь потерянной перегородки на схему не попала', modelScheme(orphan, winTypes).openings.length === 3)
}

// ── 4. Ничего лишнего ────────────────────────────────────────────────────────
{
  console.log('Чего на схеме нет')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)
  const flat = JSON.stringify(sc)
  ok('площадей нет', flat.indexOf('"area"') < 0 && flat.indexOf('"floorArea"') < 0)
  ok('раскладки (розетки, мебель) нет', flat.indexOf('"pts"') < 0)
  // Имена помещений НУЖНЫ: без них чертёж читают, водя пальцем по цепочкам.
  ok('имена помещений на месте',
    modelRooms(model).every((r) => sc.labels.some((x) => x.name === r.name)),
    JSON.stringify(sc.labels.map((x) => x.name)))
  ok('подпись стоит внутри своей комнаты',
    sc.labels.every((x) => x.x > 0 && x.x < sc.l && x.y > 0 && x.y < sc.w))
  ok('в схеме только стены, проёмы, подписи и размеры',
    Object.keys(sc).sort().join(' ') === 'dims finish l labels openings w wallThick walls',
    Object.keys(sc).sort().join(' '))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
