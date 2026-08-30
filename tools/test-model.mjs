#!/usr/bin/env node
// Модель контейнера (src/model.js).
//
// Из неё считаются площади, а из площадей — смета, которую называют клиенту.
// Поэтому сторожим не «функция вернула объект», а то, на чём такая модель ломается:
// сумма помещений не должна разъезжаться с контейнером, перегородка не должна
// съедать помещение до нуля, а id помещений обязаны переживать правки — на них
// висит раскладка и выбранная отделка.
import { CONTAINERS, MIN_ROOM, FINISH_THICK, containerMeta, emptyModel, applyContainer, modelRooms,
  modelBays, sideLength, totalLength, openingRoom, moveBoundary, splitRoom, mergeRoom,
  splitLengthwise, mergeLengthwise, moveLengthwise, elevation,
  openingCounts, modelToSpecs, modelTotals, modelIssues } from '../src/model.js'
import { SPEC_POINTS } from '../src/spec.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}

const TYPES = [
  { id: 't_win', kind: 'win', n: 'Окно 1300×1150', w: 1300, h: 1150, cost: 14555 },
  { id: 't_door', kind: 'door', n: 'Дверь 1000×2100', w: 1000, h: 2100, cost: 27150 },
]

// Дом 12 м: контейнер 40 футов HC, три помещения.
function house() {
  let m = emptyModel('40hc')
  m.rooms[0].id = 'zal'
  m = splitRoom(m, 'zal', 'spal')
  m = splitRoom(m, 'spal', 'san')
  return m
}

// ── 1. Коробка ───────────────────────────────────────────────────────────────
{
  console.log('Типоразмер')
  const m = emptyModel('40hc')
  ok('40 футов HC — 12,03 м и высота 2,7', m.l === 12032 && m.h === 2698, JSON.stringify({ l: m.l, h: m.h }))
  ok('одно помещение на всю длину', m.rooms.length === 1 && m.rooms[0].len === m.l)
  ok('сумма помещений равна контейнеру', totalLength(m) === m.l, String(totalLength(m)))

  const small = applyContainer(m, '20')
  ok('смена типоразмера ужимает помещения', totalLength(small) === containerMeta('20').l,
    String(totalLength(small)) + ' vs ' + containerMeta('20').l)
  ok('и не теряет их', small.rooms.length === m.rooms.length)
}

// ── 2. Перегородки ───────────────────────────────────────────────────────────
{
  console.log('Перегородки')
  const m = house()
  ok('три помещения', m.rooms.length === 3, JSON.stringify(m.rooms.map((r) => r.len)))
  ok('id помещений сохранились', m.rooms.map((r) => r.id).join(',') === 'zal,spal,san',
    'на id висит раскладка и выбранная отделка — потеряй их, и выбор клиента слетит')
  ok('длина сходится с контейнером', totalLength(m) === m.l, String(totalLength(m)))

  const moved = moveBoundary(m, 0, 1000)
  ok('перенос границы забирает у соседа', moved.rooms[0].len === m.rooms[0].len + 1000 &&
    moved.rooms[1].len === m.rooms[1].len - 1000, JSON.stringify(moved.rooms.map((r) => r.len)))
  ok('и не растягивает контейнер', totalLength(moved) === m.l, String(totalLength(moved)))

  const squashed = moveBoundary(m, 0, 99999)
  ok('соседа нельзя съесть до нуля', squashed.rooms[1].len === MIN_ROOM, String(squashed.rooms[1].len))
  ok('контейнер всё ещё сходится', totalLength(squashed) === m.l)
}

// ── 3. Слияние ───────────────────────────────────────────────────────────────
{
  console.log('Убрать перегородку')
  const m = house()
  m.rooms[0].pts = { sock: 6 }
  m.rooms[1].pts = { sock: 3, lamp: 2 }
  const merged = mergeRoom(m, 'zal')
  ok('помещений стало меньше', merged.rooms.length === 2)
  ok('длина перегородки вернулась в дом', totalLength(merged) === m.l, String(totalLength(merged)))
  ok('раскладка соседа переехала, а не пропала',
    merged.rooms[0].pts.sock === 9 && merged.rooms[0].pts.lamp === 2,
    JSON.stringify(merged.rooms[0].pts) + ' — розетки никуда не делись, их всё равно монтировать')
}

// ── 4. Проёмы ────────────────────────────────────────────────────────────────
{
  console.log('Окна и двери')
  const m = house()
  const rooms = modelRooms(m)
  m.openings = [
    { id: 'o1', side: 'n', pos: 500, typeId: 't_win' },
    { id: 'o2', side: 'n', pos: rooms[1].x0 + 200, typeId: 't_win' },
    { id: 'o3', side: 'w', pos: 600, typeId: 't_door' },
  ]
  ok('проём знает своё помещение', openingRoom(m, m.openings[0]).id === 'zal' &&
    openingRoom(m, m.openings[1]).id === 'spal', 'иначе окно спальни считается в зале')
  ok('торец принадлежит крайнему помещению', openingRoom(m, m.openings[2]).id === 'zal')
  ok('длинная стена меряется по контейнеру', sideLength(m, 'n') === totalLength(m))
  ok('торец — по ширине', sideLength(m, 'w') === m.w)

  const counts = openingCounts(m, TYPES)
  ok('окна и двери попали в раскладку', counts.zal.win === 1 && counts.zal.door === 1 && counts.spal.win === 1,
    JSON.stringify(counts) + ' — «монтаж окна ×N» считается той же машинкой, что розетки')

  const tot = modelTotals(m, TYPES)
  ok('стоимость изделий сложилась', tot.openingsCost === 14555 * 2 + 27150, String(tot.openingsCost))
  ok('перегородок посчитано две', tot.partitions === 2, String(tot.partitions))
}

// ── 5. Модель → характеристики спецификации ──────────────────────────────────
{
  console.log('Модель кормит спецификацию')
  const m = house()
  m.rooms[0].name = 'ЗАЛ'
  m.rooms[0].pts = { sock: 10 }
  m.openings = [{ id: 'o1', side: 'n', pos: 500, typeId: 't_win' }]
  const specs = modelToSpecs(m, TYPES)
  ok('высота в метрах', specs.height === 2.7, String(specs.height))
  // Ширина ЧИСТОВАЯ: обшивка съедает по стене, иначе модель даёт лишний квадрат
  // на комнату — а это материалы и деньги. В проекте №7640467 при контейнере 2352
  // помещения ровно 2200.
  ok('ширина считается по чистовой отделке', specs.rooms[0].w === 2.2, String(specs.rooms[0].w))
  ok('имя и id сохранены', specs.rooms[0].id === 'zal' && specs.rooms[0].name === 'ЗАЛ')
  ok('раскладка объединена с проёмами', specs.rooms[0].pts.sock === 10 && specs.rooms[0].pts.win === 1,
    JSON.stringify(specs.rooms[0].pts))

  const sum = specs.rooms.reduce((a, r) => a + r.w * r.l, 0)
  const tot = modelTotals(m, TYPES)
  ok('площадь пола сходится с моделью', Math.abs(sum - tot.floorArea) < 0.05,
    sum.toFixed(2) + ' vs ' + tot.floorArea)

  // Двигаем перегородку — площади обязаны поехать, иначе смета не пересчитается.
  const wide = modelToSpecs(moveBoundary(m, 0, 2000), TYPES)
  ok('перенос границы меняет площади', wide.rooms[0].l > specs.rooms[0].l && wide.rooms[1].l < specs.rooms[1].l,
    JSON.stringify([wide.rooms[0].l, wide.rooms[1].l]))
}

// ── 5б. Чистовые размеры ─────────────────────────────────────────────────────
{
  console.log('Отделка съедает миллиметры')
  const m = house()
  const rooms = modelRooms(m)
  ok('ширина уменьшилась на две обшивки', rooms[0].finW === m.w - FINISH_THICK * 2,
    String(rooms[0].finW) + ' при контейнере ' + m.w)
  ok('у торцевого помещения ушла и внешняя стена', rooms[0].finL === rooms[0].len - FINISH_THICK,
    String(rooms[0].finL) + ' / ' + rooms[0].len)
  ok('у среднего помещения торцов нет', rooms[1].finL === rooms[1].len)

  const bare = modelRooms(Object.assign({}, m, { finish: 0 }))
  ok('без отделки считаем по железу', bare[0].finW === m.w && bare[0].area > rooms[0].area,
    bare[0].area + ' vs ' + rooms[0].area)
}

// ── 5в. Продольная перегородка: санузел в углу ───────────────────────────────
{
  console.log('Санузел в углу')
  const m0 = house()
  const m = splitLengthwise(m0, 'san', 'wc')
  const rooms = modelRooms(m)
  ok('в отсеке стало две комнаты', rooms.filter((r) => r.bayId === 'san').length === 2,
    JSON.stringify(rooms.map((r) => r.id)))
  const [a, b] = rooms.filter((r) => r.bayId === 'san')
  ok('они делят ширину, а не длину', a.y1 < b.y0 && a.x0 === b.x0 && a.x1 === b.x1,
    JSON.stringify([a.y0, a.y1, b.y0, b.y1]))
  ok('обе площади меньше исходной', a.area + b.area < modelRooms(m0).find((r) => r.id === 'san').area,
    'перегородка съедает свои сантиметры, и это должно быть видно')

  const wide = moveLengthwise(m, 'san', 400)
  const [wa, wb] = modelRooms(wide).filter((r) => r.bayId === 'san')
  ok('перенос вдоль забирает у соседа', wa.finW > a.finW && wb.finW < b.finW,
    JSON.stringify([wa.finW, wb.finW]))
  ok('уже минимума не сжимается', modelRooms(moveLengthwise(m, 'san', 99999))
    .filter((r) => r.bayId === 'san')[1].y1 - modelRooms(moveLengthwise(m, 'san', 99999))
    .filter((r) => r.bayId === 'san')[1].y0 === MIN_ROOM)

  // Стена принадлежит той комнате, которая её касается.
  const rr = modelRooms(m).filter((r) => r.bayId === 'san')
  const north = { id: 'x1', side: 'n', pos: rr[0].x0 + 300, typeId: 't_win' }
  const south = { id: 'x2', side: 's', pos: rr[0].x0 + 300, typeId: 't_win' }
  const mm = Object.assign({}, m, { openings: [north, south] })
  ok('северное окно — первой комнате', openingRoom(mm, north).id === 'san')
  ok('южное окно — второй', openingRoom(mm, south).id === 'wc',
    'иначе окно санузла считается в соседней комнате')

  const merged = mergeLengthwise(m, 'san')
  ok('перегородка убирается', modelRooms(merged).filter((r) => r.bayId === 'san').length === 1)

  // Поперечное деление отсека с продольной перегородкой сохраняет её.
  const both = splitRoom(m, 'san', 'san2', 'wc2')
  ok('обе половины сохранили продольную стену',
    modelRooms(both).filter((r) => r.bayId === 'san2').length === 2, JSON.stringify(modelRooms(both).map((r) => r.id)))
  ok('слияние разных отсеков не проходит',
    mergeRoom(both, 'spal').rooms.length === both.rooms.length,
    'П-образную комнату модель описать не умеет, а врать про площади нельзя')
}

// ── 5г. Развёртка стены ──────────────────────────────────────────────────────
{
  console.log('Развёртка стены')
  const m = house()
  m.rooms[0].name = 'ЗАЛ'
  m.rooms[0].pts = { sock: 3, sw: 1, spot: 1, lamp: 4 }
  m.openings = [
    { id: 'o1', side: 'n', pos: 2000, typeId: 't_win' },
    { id: 'o2', side: 'w', pos: 600, typeId: 't_door' },
  ]
  const E = elevation(m, 'n', TYPES, SPEC_POINTS)
  ok('стена длиной с контейнер', E.len === totalLength(m) && E.height === m.h)
  ok('на стене только её проёмы', E.openings.length === 1 && E.openings[0].id === 'o1')
  ok('окно на высоте подоконника', E.openings[0].y0 === 900 && E.openings[0].y1 === 900 + 1150,
    JSON.stringify(E.openings[0]))

  const kinds = E.marks.map((x) => x.k)
  ok('розетки, выключатель и спот на своих отметках',
    kinds.filter((k) => k === 'sock').length === 3 && kinds.includes('sw') && kinds.includes('spot'),
    JSON.stringify(kinds))
  ok('потолочный свет на развёртке не рисуем', !kinds.includes('lamp'),
    'светильник в потолке высоты на стене не имеет')
  const sock = E.marks.find((x) => x.k === 'sock')
  ok('высота взята из каталога точек', sock.h === 300, String(sock.h))
  ok('точки разнесены по своей комнате', new Set(E.marks.filter((x) => x.k === 'sock').map((x) => x.x)).size === 3)

  const doorWall = elevation(m, 'w', TYPES, SPEC_POINTS)
  ok('дверь у порога', doorWall.openings[0].y0 === 0, JSON.stringify(doorWall.openings[0]))
  ok('торец меряется по ширине', doorWall.len === m.w)
}

// ── 6. Что мешает считать ────────────────────────────────────────────────────
{
  console.log('Предупреждения')
  const m = house()
  ok('без проёмов честно говорим', modelIssues(m, TYPES).some((x) => /окна или двери/i.test(x)))
  m.openings = [{ id: 'o1', side: 'n', pos: 500, typeId: 'нет такого' }]
  ok('проём без изделия — предупреждение', modelIssues(m, TYPES).some((x) => /типового изделия/i.test(x)))
  m.openings = [{ id: 'o1', side: 'w', pos: 2000, typeId: 't_win' }]
  ok('проём за стеной — предупреждение', modelIssues(m, TYPES).some((x) => /за стену/i.test(x)),
    JSON.stringify(modelIssues(m, TYPES)))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
