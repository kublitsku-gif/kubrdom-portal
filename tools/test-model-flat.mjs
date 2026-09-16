#!/usr/bin/env node
// Квартира как второй тип модели (src/model.js, type: "flat").
//
// Контейнер портал СТРОИТ и считает площади из геометрии; квартиру он ОТДЕЛЫВАЕТ,
// и площади в ней — замер дизайнера с листа экспликации. Сторожим здесь ровно то,
// ради чего заведён этот тип: подписанная на чертеже площадь доезжает до сметы
// НЕТРОНУТОЙ, а контейнерные проверки, которым в квартире не на что опереться,
// молчат вместо того, чтобы уверенно соврать.
import {
  emptyFlat, isFlat, flatRooms, FLAT_TYPE,
  modelRooms, modelAreas, modelToSpecs, modelTotals, modelIssues, modelScheme,
  openingRoom, openingCounts, emptyModel,
} from '../src/model.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}

const TYPES = [
  { id: 't_win', kind: 'win', n: 'Окно 1500×1200', w: 1500, h: 1200, cost: 18000 },
  { id: 't_door', kind: 'door', n: 'Дверь 700×2050', w: 700, h: 2050, cost: 9000 },
]

// Квартира на Кончаловского — тот самый чертёж, ради которого тип и заводился:
// экспликация 43,96 м², шесть помещений, спальня Г-образная.
function flat() {
  const m = emptyFlat()
  m.l = 7190
  m.w = 6410
  m.h = 2950
  m.partLen = 21.4
  m.rooms = [
    { id: 'r1', name: 'Прихожая', w: 2145, l: 2295, floor: 5.03, wallLen: 8.88 },
    { id: 'r2', name: 'Санузел', w: 2225, l: 2295, floor: 4.84, wallLen: 9.04 },
    { id: 'r3', name: 'Кухня', w: 3325, l: 4790, floor: 15.93, wallLen: 16.23 },
    { id: 'r4', name: 'Спальня', w: 0, l: 0, floor: 11.79, wallLen: 15.55 },
    { id: 'r5', name: 'Гардеробная 1', w: 1835, l: 1665, floor: 3.06, wallLen: 7.0 },
    { id: 'r6', name: 'Гардеробная 2', w: 1840, l: 1800, floor: 3.31, wallLen: 7.28 },
  ]
  return m
}

// ── 1. Это отдельный тип, а не контейнер ─────────────────────────────────────
{
  console.log('Тип модели')
  const m = flat()
  ok('квартира узнаётся', isFlat(m) && m.type === FLAT_TYPE)
  ok('контейнер квартирой не считается', !isFlat(emptyModel('40hc')))
  ok('пустая квартира без помещений', !emptyFlat().rooms.length)
}

// ── 2. Площадь с чертежа доезжает до сметы нетронутой ────────────────────────
{
  console.log('\nПлощади — это замер, а не расчёт')
  const m = flat()
  const rooms = modelRooms(m)
  ok('помещений шесть', rooms.length === 6, String(rooms.length))
  ok('порядок экспликации сохранён',
    rooms.map((r) => r.name).join(',') === 'Прихожая,Санузел,Кухня,Спальня,Гардеробная 1,Гардеробная 2',
    rooms.map((r) => r.name).join(','))

  const A = modelAreas(m, TYPES)
  // Главное число этого теста: сумма ровно та, что подписана в экспликации.
  ok('сумма площадей — 43,96 м², как в экспликации', A.total.floor === 43.96, String(A.total.floor))
  ok('потолок равен полу', A.total.ceil === 43.96, String(A.total.ceil))

  const kitchen = A.rooms.find((r) => r.name === 'Кухня')
  ok('кухня 15,93 м²', kitchen.floor === 15.93, String(kitchen.floor))
  // Стены = периметр × высота. Никакой геометрии: ровно то, что ввёл человек.
  ok('стены кухни = периметр × высота', kitchen.wallGross === 47.88, String(kitchen.wallGross))
  ok('высота пришла из модели', A.height === 2.95, String(A.height))

  // Площадь НЕ пересчитывается из ширины на длину: у Г-образной спальни этих
  // размеров нет, и перемножить их значило бы выставить счёт за метры, которых нет.
  const bed = A.rooms.find((r) => r.name === 'Спальня')
  ok('Г-образная спальня хранит площадь, а не габарит', bed.floor === 11.79 && bed.w === 0 && bed.l === 0,
    JSON.stringify({ floor: bed.floor, w: bed.w, l: bed.l }))
  ok('периметр Г-образной честный', bed.perimeter === 15.55, String(bed.perimeter))
}

// ── 3. Спецификация читает квартиру тем же кодом ─────────────────────────────
{
  console.log('\nСмета не знает, откуда метры')
  const m = flat()
  const s = modelToSpecs(m, TYPES)
  ok('высота в метрах', s.height === 2.95, String(s.height))
  ok('помещения доехали', s.rooms.length === 6)
  const kitchen = s.rooms.find((r) => r.name === 'Кухня')
  ok('площадь кухни в спецификации', kitchen.floor === 15.93, String(kitchen.floor))
  ok('периметр кухни в спецификации', kitchen.wallLen === 16.23, String(kitchen.wallLen))
}

// ── 4. Проёмы привязаны к комнате именем, а не координатой ───────────────────
{
  console.log('\nПроёмы')
  const m = flat()
  m.openings = [
    { id: 'o1', roomId: 'r3', typeId: 't_win' },
    { id: 'o2', roomId: 'r4', typeId: 't_win' },
    { id: 'o3', roomId: 'r1', roomId2: 'r2', typeId: 't_door' },
  ]
  ok('окно кухни знает свою комнату', (openingRoom(m, m.openings[0]) || {}).name === 'Кухня')
  ok('дверь считается за одну комнату', (openingRoom(m, m.openings[2]) || {}).id === 'r1')

  const counts = openingCounts(m, TYPES)
  ok('в кухне одно окно', counts.r3 && counts.r3.win === 1, JSON.stringify(counts.r3))
  ok('дверь попала только в прихожую', counts.r1 && counts.r1.door === 1 && !counts.r2,
    JSON.stringify({ r1: counts.r1, r2: counts.r2 }))

  const A = modelAreas(m, TYPES)
  const kitchen = A.rooms.find((r) => r.id === 'r3')
  ok('окно вычтено из стен кухни', kitchen.wallNet === Math.round((47.88 - 1.8) * 100) / 100,
    String(kitchen.wallNet))
  // Плинтус прерывает дверь с ОБЕИХ сторон — обе комнаты названы прямо.
  const hall = A.rooms.find((r) => r.id === 'r1')
  const bath = A.rooms.find((r) => r.id === 'r2')
  ok('плинтус прерван в прихожей', hall.plinthDoors === 0.7, String(hall.plinthDoors))
  ok('и в санузле — по второй стороне двери', bath.plinthDoors === 0.7, String(bath.plinthDoors))
  ok('потолочный плинтус идёт по всему периметру', hall.plinthCeil === 8.88, String(hall.plinthCeil))
}

// ── 5. Итоги: перегородки метрами, изделия деньгами ──────────────────────────
{
  console.log('\nИтоги')
  const m = flat()
  m.openings = [{ id: 'o1', roomId: 'r3', typeId: 't_win' }, { id: 'o2', roomId: 'r1', typeId: 't_door' }]
  const t = modelTotals(m, TYPES)
  ok('изделия посчитаны деньгами', t.openingsCost === 27000, String(t.openingsCost))
  ok('перегородки — погонными метрами', t.partitionLen === 21.4, String(t.partitionLen))
  ok('и площадью по высоте', t.partitionArea === Math.round(21.4 * 2.95 * 100) / 100, String(t.partitionArea))
  ok('штук перегородок квартира не выдумывает', t.partitions === 0, String(t.partitions))
  ok('пол — сумма экспликации', t.floorArea === 43.96, String(t.floorArea))
}

// ── 6. Замечания: свои вместо контейнерных ───────────────────────────────────
{
  console.log('\nЗамечания')
  const clean = flat()
  clean.openings = [{ id: 'o1', roomId: 'r3', typeId: 't_win' }]
  ok('на полной квартире замечаний нет', modelIssues(clean, TYPES).length === 0,
    JSON.stringify(modelIssues(clean, TYPES)))

  // Контейнерные проверки в квартире молчат: «ни одного окна» — это про дом,
  // который строят, а в квартире окна уже стоят и в модель могут не попасть.
  ok('пустой список проёмов замечанием не считается', modelIssues(flat(), TYPES).length === 0,
    JSON.stringify(modelIssues(flat(), TYPES)))

  const noArea = flat()
  noArea.rooms[2].floor = 0
  ok('помещение без площади названо',
    modelIssues(noArea, TYPES).some((s) => /Кухня.*площадь/.test(s)),
    JSON.stringify(modelIssues(noArea, TYPES)))

  const noPerim = flat()
  noPerim.rooms[2].wallLen = 0
  ok('помещение без периметра названо',
    modelIssues(noPerim, TYPES).some((s) => /Кухня.*периметр/.test(s)),
    JSON.stringify(modelIssues(noPerim, TYPES)))

  const noH = flat()
  noH.h = 0
  ok('высота ноль названа', modelIssues(noH, TYPES).some((s) => /высота/i.test(s)))

  const lost = flat()
  lost.openings = [{ id: 'o1', roomId: 'нет-такой', typeId: 't_win' }]
  ok('проём без своей комнаты названо',
    modelIssues(lost, TYPES).some((s) => /не привязан к помещению/.test(s)),
    JSON.stringify(modelIssues(lost, TYPES)))

  // Единицы — самая дорогая ошибка ввода: метры вместо миллиметров в габарите.
  const tiny = flat()
  tiny.l = 719
  tiny.w = 641
  ok('площади больше габарита — сказано вслух',
    modelIssues(tiny, TYPES).some((s) => /больше габарита/.test(s)),
    JSON.stringify(modelIssues(tiny, TYPES)))
}

// ── 7. Чертежа у квартиры нет — и портал его не выдумывает ───────────────────
{
  console.log('\nЧертёж')
  const s = modelScheme(flat(), TYPES)
  ok('схема помечена как квартирная', s.flat === true)
  ok('стен не нарисовано', !s.walls.length && !s.outline.length)
  ok('размерных цепочек нет', !s.dims.length)
  ok('габарит всё же отдан — для подписи', s.l === 7190 && s.w === 6410)
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
