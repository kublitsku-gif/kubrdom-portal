#!/usr/bin/env node
// Модель контейнера (src/model.js).
//
// Из неё считаются площади, а из площадей — смета, которую называют клиенту.
// Поэтому сторожим не «функция вернула объект», а то, на чём такая модель ломается:
// сумма помещений не должна разъезжаться с контейнером, перегородка не должна
// съедать помещение до нуля, а id помещений обязаны переживать правки — на них
// висит раскладка и выбранная отделка.
import { CONTAINERS, MIN_ROOM, FINISH_THICK, addWall, modelScheme, alignHeads, headHeight, containerMeta, emptyModel, applyContainer, modelRooms,
  modelBays, sideLength, totalLength, openingRoom, moveBoundary, splitRoom, mergeRoom,
  splitLengthwise, mergeLengthwise, moveLengthwise, elevation,
  bayAt, splitAt, splitLengthwiseAt, nearestSide, opPosAt,
  openingCounts, modelToSpecs, modelTotals, modelIssues, modelAreas } from '../src/model.js'
// Смета — сосед по деньгам: проверяем, что площадь непрямоугольной комнаты доходит
// до расчёта, а не теряется по дороге.
import { roomArea } from '../src/spec.js'
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
  // Помещение теперь меряется по ЧИСТОВОМУ полю: `len` — это и есть длина комнаты,
  // а длина отсека по коробке живёт в modelBays. У торцевого отсека обшивка съедает
  // ещё и торец, у среднего — нет.
  const bays = modelBays(m)
  ok('у торцевого помещения ушла и внешняя стена', rooms[0].finL === bays[0].len - FINISH_THICK,
    String(rooms[0].finL) + ' при отсеке ' + bays[0].len)
  ok('у среднего помещения торцов нет', rooms[1].finL === bays[1].len)

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

// ── 5д. Рисование: стена и проём появляются там, где их поставили ────────────
{
  console.log('Рисование на плане')
  const m = emptyModel('40hc')
  m.rooms[0].id = 'a'
  const at4 = splitAt(m, 4000, 'b')
  ok('стена встала ровно там, где нарисовали', at4.rooms[0].len === 4000,
    String(at4.rooms[0].len) + ' — деление пополам тут было бы враньём про жест')
  ok('и контейнер сошёлся', totalLength(at4) === m.l, String(totalLength(at4)))
  ok('отсек находится по координате', bayAt(at4, 5000).id === 'b' && bayAt(at4, 100).id === 'a')

  ok('у самого края стену не ставим', splitAt(m, 200, 'x').rooms.length === 1,
    'иначе получилось бы помещение меньше минимума')

  const lw = splitLengthwiseAt(m, 'a', 1200, 'wc')
  ok('продольная стена — на своей отметке', lw.rooms[0].sub.at === 1200, String(lw.rooms[0].sub.at))
  // Минимум — про КОМНАТУ, в которой можно стоять, поэтому отметка отсчитывается от
  // чистовой стены: 900 мм просвета плюс обшивка, а не 900 мм вместе с ней.
  ok('и не ближе минимума к стене',
    splitLengthwiseAt(m, 'a', 50, 'wc').rooms[0].sub.at === FINISH_THICK + MIN_ROOM,
    String(splitLengthwiseAt(m, 'a', 50, 'wc').rooms[0].sub.at))

  // Проём ставят тапом рядом со стеной: сторона определяется тем, к какой ближе.
  ok('верх — северная стена', nearestSide(m, 6000, 100) === 'n')
  ok('низ — южная', nearestSide(m, 6000, m.w - 100) === 's')
  ok('левый край — торец начала', nearestSide(m, 100, 1200) === 'w')
  ok('правый край — торец конца', nearestSide(m, totalLength(m) - 100, 1200) === 'e')

  ok('проём центрируется по точке тапа', opPosAt(m, 'n', 6000, 50, 1300) === 6000 - 650,
    String(opPosAt(m, 'n', 6000, 50, 1300)))
  ok('и не вылезает за стену', opPosAt(m, 'n', totalLength(m), 50, 1300) === totalLength(m) - 1300)
  ok('и не уходит в минус', opPosAt(m, 'n', 0, 50, 1300) === 0)
}

// ── 5.5 Двери в перегородках при правке отсеков ──────────────────────────────
{
  console.log('Двери в перегородках')
  // Перегородка названа отсеком ПЕРЕД ней, поэтому деление и слияние её
  // переименовывают. Дверь обязана остаться на своей физической стене — иначе
  // бригада получит чертёж, на котором проём уехал в соседнюю комнату.
  const base = () => {
    const m = house()
    m.openings = [{ id: 'd1', side: 'part', after: 'zal', pos: 800, into: 1, hinge: 'start', typeId: 't_door' }]
    return m
  }
  const door = (m) => (m.openings || []).find((o) => o.side === 'part')

  const split = splitAt(base(), 2000, 'zal2')
  ok('после деления дверь осталась на своей стене', door(split).after === 'zal2', door(split).after)
  ok('и не потеряла сторону створки', door(split).into === 1 && door(split).hinge === 'start')
  const bays = modelBays(split).map((b) => b.id)
  ok('её перегородка действительно существует', bays.indexOf(door(split).after) >= 0 &&
    bays.indexOf(door(split).after) < bays.length - 1, bays.join(','))

  const split2 = splitRoom(base(), 'zal', 'zal2')
  ok('деление пополам — тот же перенос', door(split2).after === 'zal2', door(split2).after)

  const merged = mergeRoom(base(), 'zal')
  ok('перегородки не стало — дверь ушла с ней', !door(merged), JSON.stringify(merged.openings))

  // Соседнюю перегородку слияние не трогает.
  const two = base()
  two.openings = two.openings.concat([{ id: 'd2', side: 'part', after: 'spal', pos: 800, typeId: 't_door' }])
  const m2 = mergeRoom(two, 'zal')
  ok('чужая дверь на месте', (m2.openings || []).length === 1 && m2.openings[0].id === 'd2',
    JSON.stringify(m2.openings))
}

// ── 5.7 Площади: пол, потолок, стены ─────────────────────────────────────────
{
  console.log('Площади помещений')
  const m = house()
  const A = modelAreas(m, TYPES)
  ok('по помещению на комнату', A.rooms.length === modelRooms(m).length)
  ok('потолок равен полу — это одна плоскость', A.rooms.every((r) => r.ceil === r.floor))
  // Высоту берём из модели в миллиметрах, а не из округлённой до сантиметров:
  // 2698 мм и 2,70 м дают разные копейки на каждой стене.
  ok('стены = периметр × высоту',
    A.rooms.every((r) => Math.abs(r.wallGross - r.perimeter * m.h / 1000) < 0.01),
    JSON.stringify(A.rooms.map((r) => [r.perimeter, r.wallGross])))
  ok('без проёмов чистая площадь стен равна полной',
    A.rooms.every((r) => r.wallNet === r.wallGross))
  ok('итог — сумма помещений',
    A.total.floor === Math.round(A.rooms.reduce((a, r) => a + r.floor, 0) * 100) / 100,
    String(A.total.floor))

  // Проём съедает площадь стены ровно один раз и только в СВОЁм помещении.
  const rooms = modelRooms(m)
  const m2 = Object.assign({}, m, {
    openings: [{ id: 'w1', side: 'n', pos: rooms[0].x0 + 200, typeId: 't_win' }],
  })
  const B = modelAreas(m2, TYPES)
  const winM2 = Math.round(1300 * 1150 / 1000000 * 100) / 100
  ok('окно вычтено из стен своей комнаты',
    B.rooms[0].wallNet === Math.round((B.rooms[0].wallGross - winM2) * 100) / 100,
    JSON.stringify([B.rooms[0].wallGross, B.rooms[0].openings, B.rooms[0].wallNet]))
  ok('у соседей стены не тронуты', B.rooms[1].wallNet === B.rooms[1].wallGross)
  ok('полная площадь стен от проёма не изменилась', B.rooms[0].wallGross === A.rooms[0].wallGross)
  ok('пол и потолок проёмом не режутся', B.rooms[0].floor === A.rooms[0].floor)

  // Двинули перегородку — площади поехали следом. Ради этого редактор и открывают.
  const moved = modelAreas(moveBoundary(m, 0, 1000), TYPES)
  ok('перенос границы сразу меняет площади',
    moved.rooms[0].floor > A.rooms[0].floor && moved.rooms[1].floor < A.rooms[1].floor,
    JSON.stringify([A.rooms[0].floor, moved.rooms[0].floor]))
  ok('а общая площадь дома — нет', moved.total.floor === A.total.floor,
    moved.total.floor + ' ≠ ' + A.total.floor)
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

// ── Нестандартное помещение ──────────────────────────────────────────────────
// Стена, не дошедшая до соседней, помещение НЕ делит: комната становится
// Г-образной. Ширины и длины у неё нет, а деньги считаются по площади и периметру —
// поэтому в смету уходит площадь напрямую, а ширина с длиной остаются нулями.
// Перемножить габарит значило бы выставить счёт за метры, которых нет.
{
  console.log('Нестандартное помещение')
  const m = emptyModel('40hc')
  m.rooms[0].id = 'r1'
  const plain = modelRooms(m)[0]
  m.walls = [{ id: 'w1', x: 4000, y: FINISH_THICK, w: 100, h: 1200 }]
  const r = modelRooms(m)[0]

  ok('стена-огрызок помещение не разделила', modelRooms(m).length === 1, String(modelRooms(m).length))
  ok('комната опознана непрямоугольной', r.rect === false)
  ok('площадь уменьшилась на стену',
    Math.abs(r.area - (plain.area - 100 * 1200 / 1e6)) < 0.011, plain.area + ' → ' + r.area)
  ok('периметр вырос на обе стороны огрызка',
    Math.abs(r.wallLen - (plain.wallLen + 2 * 1.2)) < 0.011, plain.wallLen + ' → ' + r.wallLen)

  const specs = modelToSpecs(m, [])
  ok('в смету ушла площадь, а не габарит', specs.rooms[0].floor === r.area && specs.rooms[0].w === 0,
    JSON.stringify(specs.rooms[0]))
  ok('и смета считает по ней пол', roomArea(specs.rooms[0], specs.height, 'floor') === r.area)
  ok('а стены — по периметру',
    roomArea(specs.rooms[0], specs.height, 'wall') === Math.round(r.wallLen * specs.height * 100) / 100)

  // Замкнутая выгородка — уже отдельное помещение, и метры у него свои.
  m.walls = [
    { id: 'a', x: 4000, y: FINISH_THICK, w: 100, h: 1200 },
    { id: 'b', x: 5500, y: FINISH_THICK, w: 100, h: 1200 },
    { id: 'c', x: 4000, y: FINISH_THICK + 1100, w: 1600, h: 100 },
  ]
  const two = modelRooms(m)
  ok('замкнутая кладовка стала помещением', two.length === 2, String(two.length))
  ok('её площадь честная', two.some((x) => x.rect && Math.abs(x.area - 1400 * 1100 / 1e6) < 0.011),
    JSON.stringify(two.map((x) => [x.rect, x.area])))
  ok('сумма площадей не потерялась',
    Math.abs(two.reduce((a, x) => a + x.area, 0) - modelTotals(m, []).floorArea) < 0.011)
}

// ── Стены встают как у чертёжника ────────────────────────────────────────────
// Рука не попадает в грань соседней стены — попадает код. Щель в миллиметр это не
// «почти закрыто», а проход: комната останется одной, и кладовка молча не
// замкнётся. Хвост, перелезший через встреченную стену, — тоже промах руки.
{
  console.log('Прилипание и углы')
  const m0 = emptyModel('40hc')
  m0.rooms[0].id = 'r1'

  // Кривой прямоугольник: концы мимо на десятки миллиметров, хвосты торчат.
  let m = addWall(m0, { x: 5200, y: 10, w: 100, h: 1290 }, 'a')
  m = addWall(m, { x: 7000, y: 30, w: 100, h: 1310 }, 'b')
  m = addWall(m, { x: 5150, y: 1200, w: 1990, h: 100 }, 'c')
  const [a, b, c] = m.walls

  ok('ось прилипла к грани коробки', a.y === 0 && b.y === 0, JSON.stringify([a.y, b.y]))
  ok('поперечная стена дотянулась до дальней грани стойки',
    c.x + c.w === b.x + b.w, (c.x + c.w) + ' против ' + (b.x + b.w))
  ok('и начинается ровно на первой', c.x === a.x, c.x + ' против ' + a.x)
  ok('хвосты стоек подрезаны по поперечной',
    a.y + a.h === c.y + c.h && b.y + b.h === c.y + c.h,
    JSON.stringify([a.y + a.h, b.y + b.h, c.y + c.h]))

  // Ради чего всё: угол сошёлся — значит кладовка замкнулась.
  const rooms = modelRooms(m)
  ok('комнат стало две', rooms.length === 2, JSON.stringify(rooms.map((r) => r.area)))
  ok('кладовка отдельная и прямоугольная', rooms.some((r) => r.rect && r.area < 3),
    JSON.stringify(rooms.map((r) => [r.rect, r.area])))
  ok('а большая комната — Г-образная', rooms.some((r) => !r.rect))
  // Имя стоит на полу своей комнаты, а не на стене и не в вырезанном углу.
  rooms.forEach((r) => ok('«' + r.name + '»: подпись внутри комнаты',
    r.cells.some((cl) => r.label.x > cl.x && r.label.x < cl.x + cl.w &&
      r.label.y > cl.y && r.label.y < cl.y + cl.h), JSON.stringify(r.label)))

  // Тап без длины стеной не становится.
  ok('тап стену не ставит', addWall(m, { x: 3000, y: 1000, w: 0, h: 100 }, 'z') === m)
}

// ── Верх проёмов на одной линии ──────────────────────────────────────────────
// Окна и двери стоят под ОДНОЙ перемычкой: на фасаде разнобой по верху читается
// как ошибка монтажа даже теми, кто чертежей не знает. Поэтому подоконник не
// задают — задают верх, а низ из него вычитается.
{
  console.log('Верх проёмов')
  const types = [
    { id: 'w15', kind: 'win', n: 'Окно 1500×1500', w: 1500, h: 1500, cost: 0 },
    { id: 'w21', kind: 'win', n: 'Окно 1500×2100', w: 1500, h: 2100, cost: 0 },
    { id: 'd20', kind: 'door', n: 'Дверь 900×2000', w: 900, h: 2000, cost: 0 },
    { id: 'big', kind: 'win', n: 'Витраж 2000×2600', w: 2000, h: 2600, cost: 0 },
  ]
  const m = Object.assign(emptyModel('40hc'), { h: 2500 })
  m.rooms[0].id = 'r1'
  m.openings = [
    { id: 'o1', side: 's', pos: 1000, typeId: 'w15' },
    { id: 'o2', side: 's', pos: 4000, typeId: 'w21' },
    { id: 'o3', side: 's', pos: 7000, typeId: 'd20' },
    { id: 'o4', side: 's', pos: 9000, typeId: 'big' },
    { id: 'o5', side: 'n', pos: 1000, sill: 1800, typeId: 'w15' },   // задан руками
  ]
  const by = {}
  modelScheme(m, types).openings.forEach((o) => { by[o.id] = o })

  ok('окна выровнены по верху', by.o1.sill + by.o1.height === by.o2.sill + by.o2.height,
    (by.o1.sill + by.o1.height) + ' и ' + (by.o2.sill + by.o2.height))
  ok('верх — перемычка 2100', by.o1.sill + by.o1.height === 2100, String(by.o1.sill + by.o1.height))
  ok('дверь стоит на полу', by.o3.sill === 0, String(by.o3.sill))
  // Изделие выше перемычки вниз уже не опустить: оно встаёт от пола, и его верх
  // выше линии — это не сбой, а физика.
  ok('витраж выше перемычки встаёт от пола', by.o4.sill === 0 && by.o4.height === 2600)
  // Заданный руками подоконник уважаем, но сквозь потолок не пускаем: окно,
  // торчащее в крышу, — то, из-за чего этот расчёт и переписан.
  ok('заданный подоконник прижат под потолок', by.o5.sill === 2500 - 1500, String(by.o5.sill))
  // Выравнивание одной кнопкой: подоконники, записанные руками (или прежним
  // умолчанием в 900), пересчитываются по перемычке. Отдельным действием, а не
  // молча: высокое окно в санузле ставят осознанно.
  const aligned = alignHeads(m, types)
  const tops = {}
  modelScheme(aligned, types).openings.forEach((o) => { tops[o.id] = o.sill + o.height })
  ok('после выравнивания окна под одной перемычкой', tops.o1 === tops.o2 && tops.o1 === 2100,
    JSON.stringify(tops))
  ok('и заданный руками подоконник тоже выровнен', tops.o5 === 2100, String(tops.o5))
  ok('дверь осталась на полу', modelScheme(aligned, types).openings.find((o) => o.id === 'o3').sill === 0)
  ok('перемычку задаёт самая высокая дверь',
    headHeight(Object.assign({}, m, { openings: [{ id: 'd', side: 's', pos: 0, typeId: 'd20' }] }), types) === 2100)

  ok('ни один проём не выше потолка',
    modelScheme(m, types).openings.every((o) => o.sill + o.height <= 2600),
    JSON.stringify(modelScheme(m, types).openings.map((o) => o.sill + o.height)))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
