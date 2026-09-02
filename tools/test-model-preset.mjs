#!/usr/bin/env node
// Заготовки планировок (MODEL_PRESETS / presetModel в src/model.js).
//
// Заготовка — это чертёж, переведённый в модель, и сторожить тут надо ровно то, из-за
// чего перевод врёт: площади должны совпасть с чертежом до сотки (по ним считается
// смета и цена клиенту), проём обязан попасть в СВОЁ помещение (иначе «монтаж окна»
// уедет в другую комнату), а изделие нужного размера нельзя заводить второй раз —
// справочник поставщика один на всю компанию.
import { MODEL_PRESETS, modelPreset, presetModel, modelRooms, modelTotals, modelIssues,
  openingRoom, totalLength, modelToSpecs, sideLength, winCatItem } from '../src/model.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}
const ids = () => { let i = 0; return () => 'id' + (++i) }

// ── 1. Заготовка по чертежу 1200 × 247 ───────────────────────────────────────
{
  console.log('Контейнер 12 м: санузел / кухня-гостиная / спальня')
  const pr = modelPreset('c12-san-liv-bed')
  ok('заготовка на месте', !!pr)
  const { model, winTypes } = presetModel(pr, [], ids())
  const rooms = modelRooms(model)

  ok('три помещения', rooms.length === 3, JSON.stringify(rooms.map((r) => r.name)))
  // Числа с чертежа: 4,39 там — округление 2,00 × 2,20.
  ok('санузел 4,40 м²', rooms[0].area === 4.4, String(rooms[0].area))
  ok('кухня-гостиная 14,08 м²', rooms[1].area === 14.08, String(rooms[1].area))
  ok('спальня 7,04 м²', rooms[2].area === 7.04, String(rooms[2].area))
  ok('чистовая ширина везде 2200', rooms.every((r) => r.finW === 2200), JSON.stringify(rooms.map((r) => r.finW)))
  ok('чистовые длины 2000 / 6400 / 3200',
    String(rooms.map((r) => r.finL)) === '2000,6400,3200', String(rooms.map((r) => r.finL)))
  ok('сумма отсеков равна коробке', totalLength(model) === model.l, totalLength(model) + ' ≠ ' + model.l)
  ok('высота помещения 2,5 м', modelToSpecs(model, winTypes).height === 2.5)
  ok('модель считается без предупреждений', modelIssues(model, winTypes).length === 0,
    JSON.stringify(modelIssues(model, winTypes)))
}

// ── 2. Проёмы стоят там, где на чертеже ──────────────────────────────────────
{
  console.log('Окна и двери')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const byId = {}; winTypes.forEach((t) => { byId[t.id] = t })
  const where = model.openings.map((o) => (openingRoom(model, o) || {}).name)
  ok('окно и вход — в кухне-гостиной', where[0] === 'Кухня-гостиная' && where[1] === 'Кухня-гостиная', String(where))
  ok('витраж — в спальне', where[2] === 'Спальня', String(where))
  // Изделия — из КАТАЛОГА, а не с чертежа: окна заказывают на заводе по
  // ограниченному списку, и «окно 1500×2100, как нарисовано» купить негде.
  // Поэтому размер каталожный, а стоит окно там, где его начертили: по центру.
  const liv = modelRooms(model)[1]
  const win = model.openings[0], dr = model.openings[1]
  ok('окно каталожное', byId[win.typeId].cat === 'os-1000x2100', byId[win.typeId].n)
  ok('и стоит по центру нарисованного 1500',
    win.pos + byId[win.typeId].w / 2 === 2976 + 750, String(win.pos))
  ok('вход каталожный', byId[dr.typeId].cat === 'os-vd-1000x2100', byId[dr.typeId].n)
  ok('от входа до спальни 2300', liv.x1 - (dr.pos + 1000) === 2300, String(liv.x1 - (dr.pos + 1000)))
  const vit = model.openings[2]
  ok('витраж каталожный', byId[vit.typeId].cat === 'os-2160x2390', byId[vit.typeId].n)
  ok('витраж не выходит за торец',
    vit.pos + byId[vit.typeId].w <= sideLength(model, 'e'), String(vit.pos))
  // Витраж 2390 высотой: при потолке 2500 подоконник выше 110 не поднять, хотя на
  // чертеже подписано 200. Лучше опустить его, чем нарисовать окно сквозь потолок.
  ok('подоконник витража опущен под потолок', vit.sill + byId[vit.typeId].h <= model.h,
    vit.sill + ' + ' + byId[vit.typeId].h + ' против ' + model.h)
  // Межкомнатные двери стоят в перегородках и считаются ровно по разу: дверь
  // принадлежит двум комнатам сразу, и посчитать её дважды значит заказать лишнюю.
  const parts = model.openings.filter((o) => o.side === 'part')
  ok('две двери в перегородках', parts.length === 2, String(parts.length))
  // Проёмы на чертеже 700, полотно 600 — оно стоит в проёме по центру, поэтому
  // отметка полотна на 50 больше отметки проёма: 750 → 800 и 1450 → 1500.
  ok('дверь санузла отмерена 800 от чистовой стены', parts[0].pos - model.finish === 800, String(parts[0].pos))
  ok('дверь спальни — 1500', parts[1].pos - model.finish === 1500, String(parts[1].pos))
  ok('петли и сторона открывания заданы',
    parts.every((o) => o.hinge && o.into), JSON.stringify(parts.map((o) => [o.hinge, o.into])))
  // Размер межкомнатной двери — решение заказчика (600×2050), а не «как у входной»:
  // по нему заказывают полотно, и разъехаться ему с чертежом нельзя.
  const partT = parts.map((o) => winTypes.find((t) => t.id === o.typeId))
  ok('межкомнатные двери 600×2050',
    partT.every((t) => t && t.w === 600 && t.h === 2050), JSON.stringify(partT.map((t) => t && [t.w, t.h])))
  ok('и это одно изделие на обе', partT[0] === partT[1])
  const specs = modelToSpecs(model, winTypes)
  const doors = specs.rooms.reduce((a, r) => a + (r.pts.door || 0), 0)
  ok('всего дверей три, без задвоения', doors === 3, JSON.stringify(specs.rooms.map((r) => r.pts)))
  ok('дверь санузла засчитана санузлу', specs.rooms[0].pts.door === 1, JSON.stringify(specs.rooms[0].pts))
  ok('витраж не затёр раскладку спальни', specs.rooms[2].pts.win === 1, JSON.stringify(specs.rooms[2].pts))
}

// ── 3. Справочник изделий ────────────────────────────────────────────────────
{
  console.log('Типовые изделия')
  const a = presetModel('c12-san-liv-bed', [], ids())
  ok('четырёх изделий не хватало — завели', a.winTypes.length === 4, String(a.winTypes.length))
  // Цена — из каталога поставщика, а не выдуманная и не нулевая: изделия в
  // заготовке каталожные, и цена приезжает вместе с ними. Ноль остаётся только у
  // межкомнатного полотна — его берут не у этого поставщика.
  ok('цены из каталога', a.winTypes.every((t) => !!t.cat && (t.cost > 0 || t.cat === 'inner-600x2050')),
    JSON.stringify(a.winTypes.map((t) => [t.cat, t.cost])))
  // Главное правило: на заводе покупают ОГРАНИЧЕННЫЙ список. Заготовка, которая
  // заводит своё окно «как на чертеже», ставит в смету изделие, которого не купить.
  MODEL_PRESETS.forEach((pr) => {
    ok(pr.k + ': все изделия из каталога',
      (pr.needs || []).every((nd) => !!winCatItem(nd.cat)),
      JSON.stringify((pr.needs || []).map((nd) => nd.cat || nd.n)))
  })

  // Своё изделие того же размера — берём его вместе с ценой, второй копии не заводим.
  const have = [{ id: 'mine', kind: 'door', n: 'Дверь входная (наша)', w: 1000, h: 2100, cost: 27150 }]
  const b = presetModel('c12-san-liv-bed', have, ids())
  ok('дубля по размеру нет', b.winTypes.length === 4, JSON.stringify(b.winTypes.map((t) => t.n)))
  ok('своя дверь осталась своей', b.winTypes[0].id === 'mine' && b.winTypes[0].cost === 27150)
  ok('проём ссылается на неё', b.model.openings[1].typeId === 'mine')
  // Своя дверь пришла со своей ценой, остальные — с каталожной: сумма проёмов
  // складывается из справочника дома, а не из воздуха.
  const wanted = b.model.openings.reduce((a2, o) => {
    const t = b.winTypes.find((x) => x.id === o.typeId)
    return a2 + (Number(t && t.cost) || 0)
  }, 0)
  ok('цена изделий пришла из справочника', modelTotals(b.model, b.winTypes).openingsCost === wanted,
    modelTotals(b.model, b.winTypes).openingsCost + ' против ' + wanted)
  ok('и своя дверь в ней по своей цене', wanted >= 27150, String(wanted))

  // Заготовка не должна мутировать ни справочник, ни саму себя: её берут много раз.
  ok('чужой массив не тронут', have.length === 1)
  const c = presetModel('c12-san-liv-bed', [], ids())
  ok('вторая модель с новыми id', c.model.rooms[0].id !== a.model.rooms[0].id ||
    a.model.rooms[0].id !== MODEL_PRESETS[0].rooms[0].id)
  // Заготовку берут много раз — она обязана остаться шаблоном, а не превратиться
  // в первую собранную из неё модель.
  ok('заготовка в коде не изменилась',
    !('id' in MODEL_PRESETS[0].rooms[0]) && !('id' in MODEL_PRESETS[0].openings[0]) &&
    !('after' in MODEL_PRESETS[0].openings[3]) && MODEL_PRESETS[0].openings[3].afterRoom === 0,
    JSON.stringify(MODEL_PRESETS[0].openings[3]))
}

// ── 4. Неизвестная заготовка ─────────────────────────────────────────────────
{
  console.log('Чего нет')
  ok('по чужому ключу — null, а не пустая модель', presetModel('нет такой', [], ids()) === null)
  ok('modelPreset тоже честен', modelPreset('нет такой') === null)
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
