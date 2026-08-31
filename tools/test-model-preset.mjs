#!/usr/bin/env node
// Заготовки планировок (MODEL_PRESETS / presetModel в src/model.js).
//
// Заготовка — это чертёж, переведённый в модель, и сторожить тут надо ровно то, из-за
// чего перевод врёт: площади должны совпасть с чертежом до сотки (по ним считается
// смета и цена клиенту), проём обязан попасть в СВОЁ помещение (иначе «монтаж окна»
// уедет в другую комнату), а изделие нужного размера нельзя заводить второй раз —
// справочник поставщика один на всю компанию.
import { MODEL_PRESETS, modelPreset, presetModel, modelRooms, modelTotals, modelIssues,
  openingRoom, totalLength, modelToSpecs, sideLength } from '../src/model.js'

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
  // 800 от перегородки санузла до окна и 800 от окна до двери — это цепочка с чертежа.
  const liv = modelRooms(model)[1]
  const win = model.openings[0], dr = model.openings[1]
  ok('окно в 800 от стены санузла', win.pos - liv.x0 === 800, String(win.pos - liv.x0))
  ok('окно 1500 широкое', byId[win.typeId].w === 1500)
  ok('вход в 800 от окна', dr.pos - (win.pos + 1500) === 800, String(dr.pos - (win.pos + 1500)))
  ok('от входа до спальни 2300', liv.x1 - (dr.pos + 1000) === 2300, String(liv.x1 - (dr.pos + 1000)))
  // Витраж в торце: 100 чистового простенка с каждой стороны (10 см на чертеже).
  const vit = model.openings[2]
  ok('витраж 2000 с подоконником 200', byId[vit.typeId].w === 2000 && vit.sill === 200)
  ok('витраж не выходит за торец', vit.pos + 2000 <= sideLength(model, 'e'), String(vit.pos))
  ok('простенки торца по 100', vit.pos - model.finish === 100, String(vit.pos - model.finish))
  // Двери в перегородках проёмами не описываются — они в раскладке помещений.
  const specs = modelToSpecs(model, winTypes)
  ok('дверь санузла в раскладке', specs.rooms[0].pts.door === 1, JSON.stringify(specs.rooms[0].pts))
  ok('дверь спальни не затёрта витражом',
    specs.rooms[2].pts.door === 1 && specs.rooms[2].pts.win === 1, JSON.stringify(specs.rooms[2].pts))
}

// ── 3. Справочник изделий ────────────────────────────────────────────────────
{
  console.log('Типовые изделия')
  const a = presetModel('c12-san-liv-bed', [], ids())
  ok('трёх изделий не хватало — завели', a.winTypes.length === 3, String(a.winTypes.length))
  ok('цена не выдумана', a.winTypes.every((t) => t.cost === 0), JSON.stringify(a.winTypes.map((t) => t.cost)))

  // Своё изделие того же размера — берём его вместе с ценой, второй копии не заводим.
  const have = [{ id: 'mine', kind: 'door', n: 'Дверь входная (наша)', w: 1000, h: 2100, cost: 27150 }]
  const b = presetModel('c12-san-liv-bed', have, ids())
  ok('дубля по размеру нет', b.winTypes.length === 3, JSON.stringify(b.winTypes.map((t) => t.n)))
  ok('своя дверь осталась своей', b.winTypes[0].id === 'mine' && b.winTypes[0].cost === 27150)
  ok('проём ссылается на неё', b.model.openings[1].typeId === 'mine')
  ok('цена изделий пришла из справочника', modelTotals(b.model, b.winTypes).openingsCost === 27150,
    String(modelTotals(b.model, b.winTypes).openingsCost))

  // Заготовка не должна мутировать ни справочник, ни саму себя: её берут много раз.
  ok('чужой массив не тронут', have.length === 1)
  const c = presetModel('c12-san-liv-bed', [], ids())
  ok('вторая модель с новыми id', c.model.rooms[0].id !== a.model.rooms[0].id ||
    a.model.rooms[0].id !== MODEL_PRESETS[0].rooms[0].id)
  ok('заготовка в коде не изменилась', MODEL_PRESETS[0].rooms[0].pts.door === 1 &&
    !('id' in MODEL_PRESETS[0].rooms[0]))
}

// ── 4. Неизвестная заготовка ─────────────────────────────────────────────────
{
  console.log('Чего нет')
  ok('по чужому ключу — null, а не пустая модель', presetModel('нет такой', [], ids()) === null)
  ok('modelPreset тоже честен', modelPreset('нет такой') === null)
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
