#!/usr/bin/env node
// Дом в объёме (src/iso.js).
//
// Объёмный вид — не украшение: его показывают клиенту вместо чертежа, который он
// читать не обязан. Поэтому сторожим то, из-за чего картинка врёт: ближняя стена
// обязана исчезать (иначе виден глухой ящик), проём — быть настоящей дыркой в
// стене, а порядок граней — совпадать с тем, что видит глаз.
import { isoScene } from '../src/iso.js'
import { presetModel, emptyModel } from '../src/model.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}
const ids = () => { let i = 0; return () => 'id' + (++i) }
const kinds = (s) => s.faces.reduce((a, f) => Object.assign(a, { [f.kind]: (a[f.kind] || 0) + 1 }), {})

const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())

// ── 1. Сцена собирается ──────────────────────────────────────────────────────
{
  console.log('Сцена')
  const s = isoScene(model, winTypes, { yaw: 35, tilt: 55, walls: 'cut' })
  const k = kinds(s)
  ok('есть пол, коробка и перегородки', k.floor > 0 && k.shell > 0 && k.part > 0, JSON.stringify(k))
  ok('дом стоит на плите', k.slab > 0)
  ok('окно застеклено', k.glass > 0)
  ok('у проёмов есть откосы', k.reveal >= 4, String(k.reveal))
  ok('рамка охватывает рисунок', s.x1 > s.x0 && s.y1 > s.y0)
}

// ── 2. Ближняя стена снимается ───────────────────────────────────────────────
// «Кукольный дом»: без этого поворот показывает глухой ящик, и смотреть не на что.
{
  console.log('Кукольный дом')
  const a = isoScene(model, winTypes, { yaw: 35, tilt: 55, walls: 'cut' })
  const b = isoScene(model, winTypes, { yaw: 215, tilt: 55, walls: 'cut' })
  ok('часть коробки скрыта', kinds(a).shell < 4 * 5, String(kinds(a).shell))
  // Развернули дом на 180° — скрытыми стали ДРУГИЕ стены, а всего их столько же.
  ok('поворот меняет, какие стены сняты', kinds(a).shell === kinds(b).shell)
  // Проём снимается ВМЕСТЕ со своей стеной: иначе окно висело бы в воздухе там, где
  // стены уже нет. С двух противоположных сторон видно разные проёмы — это и
  // означает, что снимают именно ближние стены, а не какие попало.
  ok('с другой стороны видно другие проёмы', kinds(a).reveal !== kinds(b).reveal,
    kinds(a).reveal + ' и ' + kinds(b).reveal)

  // Прозрачные стены — обхождение по умолчанию: смотрят на дом чаще со стороны
  // фасада, и «окон не видно» — это про снятую вместе с ними стену.
  const ghost = isoScene(model, winTypes, { yaw: 215, tilt: 55 })
  ok('по умолчанию ближняя стена прозрачная, а не снятая', kinds(ghost).ghost > 0, JSON.stringify(kinds(ghost)))
  ok('и её окна видно', (kinds(ghost).glass || 0) > (kinds(b).glass || 0),
    kinds(ghost).glass + ' против ' + kinds(b).glass)
  ok('сквозь неё видно и комнаты', kinds(ghost).floor === kinds(b).floor)
}

// ── 3. Проём — дырка, а не наклейка ──────────────────────────────────────────
{
  console.log('Проёмы')
  const s = isoScene(model, winTypes, { yaw: 35, tilt: 55, walls: 'cut' })
  const holed = s.faces.filter((f) => f.holes && f.holes.length)
  ok('в стенах прорезаны дырки', holed.length > 0, String(holed.length))
  ok('дырка лежит внутри своей грани', holed.every((f) => {
    const bx = [Math.min.apply(null, f.pts.map((p) => p[0])), Math.max.apply(null, f.pts.map((p) => p[0]))]
    const by = [Math.min.apply(null, f.pts.map((p) => p[1])), Math.max.apply(null, f.pts.map((p) => p[1]))]
    return f.holes.every((h) => h.every((p) =>
      p[0] >= bx[0] - 1 && p[0] <= bx[1] + 1 && p[1] >= by[0] - 1 && p[1] <= by[1] + 1))
  }))
  // У двери стекла нет: сквозь неё видно комнату, и рисовать там плоскость — врать.
  const glass = s.faces.filter((f) => f.kind === 'glass')
  ok('стекло только у окон', glass.length === 1, String(glass.length))
}

// ── 4. Порядок рисования ─────────────────────────────────────────────────────
// Художник кладёт дальнее раньше ближнего, а пол — раньше всего: камера смотрит
// сверху, и никакая плоскость пола не может закрыть стену, которая на ней стоит.
{
  console.log('Порядок граней')
  const s = isoScene(model, winTypes, { yaw: 35, tilt: 55, walls: 'cut' })
  const iFloor = s.faces.map((f, i) => (f.kind === 'floor' || f.kind === 'slab') ? i : -1).filter((i) => i >= 0)
  const iWall = s.faces.map((f, i) => (f.kind === 'shell' || f.kind === 'part') ? i : -1).filter((i) => i >= 0)
  ok('пол и плита рисуются первыми', Math.max.apply(null, iFloor) < Math.min.apply(null, iWall),
    Math.max.apply(null, iFloor) + ' против ' + Math.min.apply(null, iWall))
  const walls = s.faces.filter((f) => f.kind === 'shell' || f.kind === 'part')
  ok('стены — от дальней к ближней',
    walls.every((f, i) => i === 0 || walls[i - 1].depth >= f.depth))
}

// ── 5. Пустая коробка не роняет сцену ────────────────────────────────────────
{
  console.log('Пустая коробка')
  const s = isoScene(emptyModel('20'), [], { yaw: 0, tilt: 60 })
  ok('сцена собралась', s.faces.length > 0, String(s.faces.length))
  ok('и рамка осмысленная', s.x1 > s.x0 && s.y1 > s.y0)
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
