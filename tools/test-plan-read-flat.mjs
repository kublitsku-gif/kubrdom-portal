#!/usr/bin/env node
// Чтение планировки КВАРТИРЫ (src/plan-read.js, flat_read).
//
// Ответ модели здесь выдуман, но выдуман по настоящему листу: дизайн-проект
// квартиры на Кончаловского, экспликация 43,96 м², шесть помещений, спальня
// Г-образная. Сторожим главное правило этого читателя: подписанная в экспликации
// площадь доезжает до модели НЕТРОНУТОЙ, а прочитанные размеры идут не в неё, а
// в проверку — сошлись или нет.
import { FLAT_SCHEMA, FLAT_SYSTEM, FLAT_TOOL, flatRequest, flatFromResponse, flatNormalize, flatToModel }
  from '../src/plan-read.js'
import { isFlat, modelAreas, modelIssues } from '../src/model.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}

const TYPES = []
let n = 0
const gen = () => 'g' + (++n)

// Что вернула бы модель по листу «Планировочное решение. Итоговый вариант».
function answer() {
  return {
    length: 7190, width: 6410, height: 2950, partitions_len: 21.4,
    rooms: [
      { name: 'Прихожая', area: 5.03, perimeter: 8.88, w: 2145, l: 2295 },
      { name: 'Санузел', area: 4.84, perimeter: 9.04, w: 2225, l: 2295 },
      { name: 'Кухня', area: 15.93, perimeter: 16.23, w: 3325, l: 4790 },
      { name: 'Спальня', area: 11.79, perimeter: 15.55, w: null, l: null },
      { name: 'Гардеробная 1', area: 3.06, perimeter: 7.0, w: 1835, l: 1665 },
      { name: 'Гардеробная 2', area: 3.31, perimeter: 7.28, w: 1840, l: 1800 },
    ],
    openings: [
      { kind: 'win', room: 'Кухня', room2: '', width: 1500, height: 1200, sill: 800, label: 'окно кухни' },
      { kind: 'door', room: 'Прихожая', room2: 'Санузел', width: 700, height: 2050, sill: 0, label: 'дверь СУ' },
    ],
    notes: '',
  }
}

// ── 1. Запрос ────────────────────────────────────────────────────────────────
{
  console.log('Запрос')
  const req = flatRequest([{ name: 'plan.pdf', type: 'application/pdf', b64: 'AAA' }], {})
  ok('инструмент — квартирный', req.tools[0].name === 'flat_read' && req.tool_choice.name === 'flat_read')
  ok('правила чтения квартирные', req.system === FLAT_SYSTEM)
  ok('PDF ушёл документом', req.messages[0].content.some((b) => b.type === 'document'))
  ok('схема строгая', FLAT_TOOL.strict === true && FLAT_SCHEMA.additionalProperties === false)
  // Экспликация — то, ради чего читатель заведён: без неё квартиры нет.
  ok('экспликация обязательна в схеме', FLAT_SCHEMA.required.includes('rooms'))
  ok('перегородки спрашиваются метрами', FLAT_SCHEMA.required.includes('partitions_len'))

  const bad = { content: [{ type: 'text', text: 'это фасад, а не план' }] }
  let threw = ''
  try { flatFromResponse(bad) } catch (e) { threw = e.message }
  ok('отказ модели объяснён словами', /фасад/.test(threw), threw)
}

// ── 2. Единицы ───────────────────────────────────────────────────────────────
{
  console.log('\nЕдиницы')
  const mm = flatNormalize(answer()).plan
  ok('миллиметры узнаются по высоте', mm.height === 2950 && mm.length === 7190)

  // Тот же чертёж, подписанный в сантиметрах.
  const cm = answer()
  cm.height = 295; cm.length = 719; cm.width = 641
  cm.rooms = cm.rooms.map((r) => ({ ...r, w: r.w ? r.w / 10 : null, l: r.l ? r.l / 10 : null }))
  cm.openings = cm.openings.map((o) => ({ ...o, width: o.width / 10, height: o.height / 10, sill: o.sill / 10 }))
  const got = flatNormalize(cm).plan
  ok('сантиметры переведены в миллиметры', got.height === 2950 && got.length === 7190, JSON.stringify({ h: got.height, l: got.length }))
  // Площадь и периметр множитель длины не трогает — иначе квартира станет
  // сорока четырьмя тысячами метров.
  ok('площадь осталась в м²', got.rooms[2].area === 15.93, String(got.rooms[2].area))
  ok('периметр остался в погонных метрах', got.rooms[2].perimeter === 16.23, String(got.rooms[2].perimeter))
  ok('перегородки остались метрами', got.partLen === 21.4, String(got.partLen))
}

// ── 3. Площадь из экспликации нетронута ──────────────────────────────────────
{
  console.log('\nПлощадь — замер, а не расчёт')
  const { plan } = flatNormalize(answer())
  const out = flatToModel(plan, TYPES, gen)
  ok('получилась квартира', isFlat(out.model))
  ok('высота с обмерного плана', out.model.h === 2950, String(out.model.h))
  ok('габарит с чертежа', out.model.l === 7190 && out.model.w === 6410)
  ok('перегородки доехали', out.model.partLen === 21.4, String(out.model.partLen))

  const A = modelAreas(out.model, out.winTypes)
  ok('сумма — 43,96 м², как в экспликации', A.total.floor === 43.96, String(A.total.floor))

  const bed = out.model.rooms.find((r) => r.name === 'Спальня')
  ok('Г-образная спальня взяла площадь из экспликации', bed.floor === 11.79, String(bed.floor))
  ok('и не выдумала себе размеры', bed.w === 0 && bed.l === 0)
  ok('но периметр у неё подписанный', bed.wallLen === 15.55, String(bed.wallLen))
  ok('на прочитанной квартире замечаний модели нет', modelIssues(out.model, out.winTypes).length === 0,
    JSON.stringify(modelIssues(out.model, out.winTypes)))
}

// ── 4. Размеры — это проверка чтения ─────────────────────────────────────────
{
  console.log('\nРазмеры проверяют сами себя')
  const a = answer()
  const out = flatToModel(flatNormalize(a).plan, TYPES, gen)
  const kitchen = out.areas.find((r) => r.name === 'Кухня')
  ok('в сверке видно обе цифры', kitchen.said === 15.93 && kitchen.got === 15.93,
    JSON.stringify(kitchen))
  ok('сошлось — молчим', !out.warnings.some((w) => /Кухня/.test(w)), JSON.stringify(out.warnings))

  // Цепочку прочитали неверно: 4790 стало 4090. Площадь обязана остаться
  // подписанной, а расхождение — прозвучать.
  const wrong = answer()
  wrong.rooms[2].l = 4090
  const bad = flatToModel(flatNormalize(wrong).plan, TYPES, gen)
  ok('площадь всё равно из экспликации',
    bad.model.rooms.find((r) => r.name === 'Кухня').floor === 15.93,
    String(bad.model.rooms.find((r) => r.name === 'Кухня').floor))
  ok('расхождение названо', bad.warnings.some((w) => /Кухня.*не тот размер/.test(w)),
    JSON.stringify(bad.warnings))
}

// ── 5. Чего нет на листе — того нет в модели ─────────────────────────────────
{
  console.log('\nПропущенное не выдумывается')
  const noPerim = answer()
  noPerim.rooms[3].perimeter = null            // у Г-образной спальни нет и размеров
  const out = flatToModel(flatNormalize(noPerim).plan, TYPES, gen)
  ok('периметр остался пустым', out.model.rooms.find((r) => r.name === 'Спальня').wallLen === 0)
  ok('и об этом сказано', out.warnings.some((w) => /Спальня.*периметр/.test(w)), JSON.stringify(out.warnings))

  // У прямоугольной комнаты периметр всё же считается по размерам: это не
  // догадка, а арифметика по прочитанной цепочке.
  const noPerim2 = answer()
  noPerim2.rooms[2].perimeter = null
  const out2 = flatToModel(flatNormalize(noPerim2).plan, TYPES, gen)
  ok('у прямоугольной комнаты периметр посчитан по размерам',
    out2.model.rooms.find((r) => r.name === 'Кухня').wallLen === 16.23,
    String(out2.model.rooms.find((r) => r.name === 'Кухня').wallLen))

  const noH = answer()
  noH.height = null
  const out3 = flatToModel(flatNormalize(noH).plan, TYPES, gen)
  ok('без высоты поставлена типовая и сказано', out3.model.h === 2700 && out3.warnings.some((w) => /Высота/.test(w)),
    JSON.stringify(out3.warnings))

  const noPart = answer()
  noPart.partitions_len = null
  const out4 = flatToModel(flatNormalize(noPart).plan, TYPES, gen)
  ok('без перегородок сказано вслух', out4.warnings.some((w) => /перегород/.test(w)), JSON.stringify(out4.warnings))

  const nameless = answer()
  nameless.rooms.push({ name: '', area: 4, perimeter: 8, w: null, l: null })
  ok('помещение без имени пропущено и названо',
    flatNormalize(nameless).warnings.some((w) => /без названия/.test(w)))
}

// ── 6. Проёмы привязаны к экспликации по имени ───────────────────────────────
{
  console.log('\nПроёмы')
  const out = flatToModel(flatNormalize(answer()).plan, TYPES, gen)
  const kitchen = out.model.rooms.find((r) => r.name === 'Кухня')
  const hall = out.model.rooms.find((r) => r.name === 'Прихожая')
  const bath = out.model.rooms.find((r) => r.name === 'Санузел')
  ok('окно ушло в кухню', out.model.openings[0].roomId === kitchen.id)
  ok('подписанный подоконник сохранён', out.model.openings[0].sill === 800, String(out.model.openings[0].sill))
  ok('дверь знает обе комнаты',
    out.model.openings[1].roomId === hall.id && out.model.openings[1].roomId2 === bath.id)
  // Изделие подобрано из каталога, и человек видит обе цифры в сверке.
  ok('подбор изделий показан построчно', out.picks.length === 2 && out.picks[0].name)

  const lost = answer()
  lost.openings[0].room = 'Веранда'
  const out2 = flatToModel(flatNormalize(lost).plan, TYPES, gen)
  ok('проём в несуществующую комнату пропущен и назван',
    out2.model.openings.length === 1 && out2.warnings.some((w) => /Веранда/.test(w)),
    JSON.stringify(out2.warnings))

  const noRoom = answer()
  noRoom.openings[0].room = ''
  ok('проём без комнаты отсеян на нормализации',
    flatNormalize(noRoom).warnings.some((w) => /в каком помещении/.test(w)))
}

// ── 7. Одинаковые имена в экспликации ────────────────────────────────────────
{
  console.log('\nОдинаковые имена')
  const twins = answer()
  twins.rooms[4].name = 'Гардеробная'
  twins.rooms[5].name = 'Гардеробная'
  const out = flatToModel(flatNormalize(twins).plan, TYPES, gen)
  // Оба помещения обязаны выжить: экспликация перечисляет их отдельно, и
  // склеить их значит потерять 3 м² пола.
  ok('оба помещения остались', out.model.rooms.filter((r) => r.name === 'Гардеробная').length === 2)
  ok('сумма площадей не пострадала', modelAreas(out.model, out.winTypes).total.floor === 43.96)
  ok('о двойном имени предупредили', out.warnings.some((w) => /таких помещений два/.test(w)),
    JSON.stringify(out.warnings))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
