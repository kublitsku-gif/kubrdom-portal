#!/usr/bin/env node
// Плинтус в смете (src/plinth.js).
//
// Плинтус дописывают в строку штуками («Плинтус деревянный Сосна АА … 3000 мм»,
// 144 ₽/шт) или метражом, а сколько его брать, считал в уме тот, кто читал смету.
// Портал уже знает погонные метры (modelAreas): напольный — периметр минус двери,
// потолочный — весь периметр, по комнатам и на дом. Сторожим, какой товар —
// погонный плинтус, какой длины его штука, сколько штук на метры и какие варианты
// объёма получает строка.
import { isPlinthMat, plinthPieceLen, plinthNeed, plinthKindOf, plinthOptions } from '../src/plinth.js'

const t = reporterOf()
function reporterOf() {
  let failed = 0
  return {
    section: (n) => console.log(n),
    ok: (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) },
    done: () => { console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли'); process.exit(failed ? 1 : 0) },
  }
}

const PINE = { id: 'm1', n: 'Плинтус деревянный Сосна АА сращенный / фигурный (13 * 43 * 3000 мм)', mode: 'piece', cost: 144, qty: 1 }
const METAL = { id: 'm2', n: 'Плинтус металлический', mode: 'mp', lenPer: 2.5, qty: 30 }
const LIPA = { id: 'm3', n: 'Плинтус 15×42 мм липа экстра', mode: 'piece', qty: 60 }
// Числа боевого «Дом СВО»: modelAreas отдаёт их миллиметровой точностью.
const FACTS = {
  rooms: [
    { id: 'san', name: 'Санузел', plinthFloor: 7.746, plinthCeil: 8.346 },
    { id: 'zal', name: 'Зал', plinthFloor: 14.964, plinthCeil: 17.164 },
  ],
  total: { plinthFloor: 32.86, plinthCeil: 36.26 },
}

{
  t.section('Что считать плинтусом')
  t.ok('деревянный плинтус — плинтус', isPlinthMat(PINE.n))
  t.ok('металлический тоже', isPlinthMat(METAL.n))
  // Комплект фасонины, уголки и заглушки покупают штуками к углам, а не на метры.
  t.ok('комплект фасонины — не погонаж', !isPlinthMat('Плинтус фасонина комплект'))
  t.ok('уголок и заглушка к плинтусу — не погонаж',
    !isPlinthMat('Уголок внутренний для плинтуса') && !isPlinthMat('Заглушка плинтуса левая'))
  t.ok('ламинат — не плинтус', !isPlinthMat('SPC плитка Дуб Берн класс 43'))
}

{
  t.section('Длина одной штуки')
  t.ok('из размеров в названии: 13 * 43 * 3000 мм → 3 м', plinthPieceLen(PINE) === 3, String(plinthPieceLen(PINE)))
  t.ok('из карточки метража (lenPer)', plinthPieceLen(METAL) === 2.5, String(plinthPieceLen(METAL)))
  t.ok('«2,5 м» в названии', plinthPieceLen({ n: 'Плинтус МДФ белый 2,5 м', mode: 'piece' }) === 2.5)
  t.ok('«2500 мм» отдельным числом', plinthPieceLen({ n: 'Плинтус потолочный 2500 мм', mode: 'piece' }) === 2.5)
  // Сечение — не длина: выдумать длину штуки нельзя, лучше промолчать.
  t.ok('сечение 15×42 мм — не длина', plinthPieceLen(LIPA) === 0, String(plinthPieceLen(LIPA)))
}

{
  t.section('Сколько брать на метры')
  t.ok('32,86 м по 3 м — 11 шт', plinthNeed(PINE, 32.86) === 11, String(plinthNeed(PINE, 32.86)))
  // 33 / 3 в плавающей точке бывает чуть больше 11 — и штука лишняя.
  t.ok('ровно 33 м по 3 м — 11 шт, не 12', plinthNeed(PINE, 33) === 11, String(plinthNeed(PINE, 33)))
  t.ok('метраж — самими метрами, вверх до 0,1', plinthNeed(METAL, 32.86) === 32.9, String(plinthNeed(METAL, 32.86)))
  t.ok('длина штуки неизвестна — считать нечего', plinthNeed(LIPA, 32.86) === 0)
  t.ok('метров нет — нечего', plinthNeed(PINE, 0) === 0)
}

{
  t.section('Напольный или потолочный')
  t.ok('«потолочный» в названии', plinthKindOf('Плинтус потолочный полиуретан') === 'ceil')
  t.ok('«напольный» в названии', plinthKindOf('Плинтус напольный МДФ') === 'floor')
  t.ok('строка «Пол на весь дом» — пол', plinthKindOf('Пол на весь дом') === 'floor')
  t.ok('«Потолок зал» — потолок', plinthKindOf('Потолок зал') === 'ceil')
  // «полиуретан», «полотно» — не пол.
  t.ok('«полиуретан» — не пол', plinthKindOf('Плинтус полиуретан белый') === '')
  t.ok('«Монтаж плинтусов, откосов» — не сказано', plinthKindOf('Монтаж плинтусов, откосов') === '')
}

{
  t.section('Варианты объёма у строки')
  const house = plinthOptions({ name: 'Монтаж плинтусов, откосов', room: '' }, PINE, FACTS)
  t.ok('не сказано какой — пол, потолок и оба', house.map((o) => o.k).join(',') === 'floor,ceil,both', JSON.stringify(house))
  t.ok('на весь дом — метры дома',
    house.length === 3 && house[0].len === 32.86 && house[1].len === 36.26 && Math.abs(house[2].len - 69.12) < 0.001,
    JSON.stringify(house.map((o) => o.len)))
  t.ok('и штуки к каждому', house.length === 3 && house[0].need === 11 && house[1].need === 13 && house[2].need === 24,
    JSON.stringify(house.map((o) => o.need)))
  t.ok('подписано «весь дом»', house.length > 0 && house[0].where === 'весь дом')

  const floorRow = plinthOptions({ name: 'Пол на весь дом', room: '' }, PINE, FACTS)
  t.ok('строка пола — только напольный', floorRow.length === 1 && floorRow[0].k === 'floor', JSON.stringify(floorRow))

  // Что написано на товаре, главнее названия строки.
  const ceilMat = plinthOptions({ name: 'Пол на весь дом', room: '' }, { n: 'Плинтус потолочный 2 м', mode: 'piece' }, FACTS)
  t.ok('товар «потолочный» главнее строки', ceilMat.length === 1 && ceilMat[0].k === 'ceil' && ceilMat[0].need === 19,
    JSON.stringify(ceilMat))

  const zal = plinthOptions({ name: 'Монтаж плинтусов, откосов', room: 'Зал', roomId: 'zal' }, PINE, FACTS)
  t.ok('строка комнаты — метры этой комнаты', zal.length === 3 && zal[0].len === 14.964 && zal[0].where === 'Зал' && zal[0].need === 5,
    JSON.stringify(zal))

  t.ok('не плинтус — вариантов нет', plinthOptions({ name: 'Пол зал', room: '' }, { n: 'SPC плитка', mode: 'pack' }, FACTS).length === 0)
  t.ok('без длины штуки — вариантов нет', plinthOptions({ name: 'Монтаж плинтусов', room: '' }, LIPA, FACTS).length === 0)
  t.ok('без чертежа — вариантов нет', plinthOptions({ name: 'Монтаж плинтусов', room: '' }, PINE, null).length === 0)
}

t.done()
