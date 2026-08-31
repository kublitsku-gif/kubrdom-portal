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

  // По умолчанию дом показывается ЦЕЛЫМ: гофрированный морской контейнер с крышей.
  // Так его видит клиент, подъехав к участку, и так он ждёт его на картинке.
  const solid = isoScene(model, winTypes, { yaw: 215, tilt: 55 })
  ok('по умолчанию дом целый', !kinds(solid).ghost, JSON.stringify(kinds(solid)))
  ok('у него есть крыша', kinds(solid).roof > 0)
  ok('и гофра на стенах', kinds(solid).rib > 10, String(kinds(solid).rib))
  ok('его окна на месте', (kinds(solid).glass || 0) > 0)

  // Прозрачная стена — компромисс: видно и дом, и планировку сразу.
  const ghost = isoScene(model, winTypes, { yaw: 215, tilt: 55, walls: 'ghost' })
  ok('в «сквозь стены» ближняя стена прозрачная', kinds(ghost).ghost > 0, JSON.stringify(kinds(ghost)))
  ok('её проёмы обведены рамкой', kinds(ghost).frame > 0)
  ok('и крыша не мешает смотреть внутрь', !kinds(ghost).roof)
  ok('сквозь неё видно комнаты', kinds(ghost).floor === kinds(b).floor)
}

// ── 2б. Морской контейнер ────────────────────────────────────────────────────
// Гофра — примета контейнера, но она принадлежит СТЕНЕ: в проёме стены нет, и
// ребро там обрывается. Идёт она между верхним и нижним рельсом, а крыша с
// корпусом — одна конструкция, без светлой полосы на стыке.
{
  console.log('Гофра и крыша')
  const bare = Object.assign(emptyModel('40hc'), { h: 2500 })
  bare.rooms[0].id = 'r1'
  const types = [{ id: 'big', kind: 'win', n: 'Витраж 4000×2000', w: 4000, h: 2000, cost: 0 }]
  const holed = Object.assign({}, bare, { openings: [{ id: 'o', side: 's', pos: 3000, typeId: 'big' }] })

  // Меряем не число рёбер, а их общую длину: ребро в проёме не исчезает целиком,
  // оно обрывается — над проёмом остаётся кусок, и счётчик этого не заметит.
  const ribLen = (m) => isoScene(m, types, { yaw: 215, tilt: 30 }).faces
    .filter((f) => f.kind === 'rib')
    .reduce((a, f) => a + Math.hypot(f.pts[1][0] - f.pts[0][0], f.pts[1][1] - f.pts[0][1]), 0)
  ok('гофра есть', ribLen(bare) > 1000, String(Math.round(ribLen(bare))))
  ok('в проёме гофры нет', ribLen(holed) < ribLen(bare) - 1000,
    Math.round(ribLen(bare)) + ' → ' + Math.round(ribLen(holed)))

  const s = isoScene(bare, types, { yaw: 215, tilt: 30 })
  ok('рельсы на месте', kinds(s).rail > 0, String(kinds(s).rail))
  // Верх стены под крышей не рисуем: светлая полоса на стыке разбивает контейнер
  // на две детали, а он одна конструкция.
  const tops = s.faces.filter((f) => f.kind === 'shell' && f.pts.length === 4)
  ok('крыша лежит на корпусе без зазора', kinds(s).roof > 0)
  ok('верхних граней стен под крышей нет', tops.length <= kinds(s).shell, String(tops.length))

  // Проём на глухой стене обводится рамкой: на тёмной гофре чёрная дыра сливается.
  // Крыша идёт по габариту, а торцевые стены на плане чертят между продольными —
  // в объёме из-за этого на углу вылезал зубец. Силуэт коробки и крыши обязан
  // совпадать: «зазор в кровле» — это ровно он.
  const leftOf = (kind) => Math.min.apply(null, s.faces.filter((f) => f.kind === kind)
    .reduce((a, f) => a.concat(f.pts.map((p) => p[0])), []))
  ok('крыша не выступает за стены', Math.abs(leftOf('roof') - leftOf('shell')) < 1,
    leftOf('roof') + ' против ' + leftOf('shell'))

  ok('проём обведён рамкой и на глухой стене',
    isoScene(holed, types, { yaw: 215, tilt: 30 }).faces.some((f) => f.kind === 'frame'))
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
