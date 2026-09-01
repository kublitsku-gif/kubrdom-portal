#!/usr/bin/env node
// «Спецификация 2» — опытный раздел (src/spec2.js).
//
// Раздел намеренно пустой: экран отделки остался в боевой «Спецификации». Поэтому
// сторожим ровно две вещи. Деньги обязаны совпадать с боевым расчётом (иначе клиенту
// назовут одну цену, а в договор уйдёт другая), а «чего не хватает» обязано спрашивать
// МОДЕЛЬ, а не отделку: предупреждение про невыбранные стены здесь было бы про экран,
// которого в разделе нет.
import { sheetTotals, sheetIssues } from '../src/spec.js'
import { totals2, issues2 } from '../src/spec2.js'
import { presetModel, modelToSpecs } from '../src/model.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}

const PRODUCTS = [
  { id: 'p_mdf', name: 'МДФ панель', unitCost: 700, store: 'Белка', mode: 'm2' },
  { id: 'p_lam', name: 'Ламинат', unitCost: 800, store: 'Лемана', mode: 'm2' },
]
const EST = [
  { id: 'e_mdf', kind: 'house', name: 'Стены МДФ', stage: 2, optScope: 'room', optGroup: 'Стены', optLabel: 'МДФ', optSurface: 'wall',
    lines: [{ pid: 'p_mdf', qty: 1 }] },
  { id: 'e_lam', kind: 'house', name: 'Пол ламинат', stage: 3, optScope: 'room', optGroup: 'Пол', optLabel: 'Ламинат', optSurface: 'floor',
    lines: [{ pid: 'p_lam', qty: 1 }] },
]

// Лист опытного раздела: дом собран заготовкой контейнера, отделка выбрана везде.
function sheet2() {
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], (() => { let i = 0; return () => 'id' + (++i) })())
  const specs = modelToSpecs(model, winTypes)
  const rooms = {}
  specs.rooms.forEach((r) => { rooms[r.id] = { 'Стены': 'e_mdf', 'Пол': 'e_lam' } })
  return { id: 's2', kind: 'house', name: 'Опыт', markup: 30, model, specs, rooms, global: {}, qty: {}, winTypes }
}

// ── 1. Деньги общие с боевым разделом ────────────────────────────────────────
{
  console.log('Цена')
  const sh = sheet2()
  const a = totals2(sh, { estimates: EST, products: PRODUCTS }), b = sheetTotals(sh, EST, PRODUCTS)
  ok('себестоимость совпадает', a.cost === b.cost && a.cost > 0, a.cost + ' / ' + b.cost)
  ok('цена клиенту совпадает', a.price === b.price, a.price + ' / ' + b.price)
  ok('разбивка по этапам совпадает', JSON.stringify(a.byStage) === JSON.stringify(b.byStage))
  ok('позиции те же', a.count === b.count && a.count > 0, String(a.count))
  ok('наценка применена', a.price === Math.round(a.cost * 1.3), a.price + ' ≠ ' + Math.round(a.cost * 1.3))
}

// ── 2. Готовность спрашивают у модели ────────────────────────────────────────
{
  console.log('Что мешает считать')
  const empty = { id: 's0', kind: 'house', specs: { height: 2.5, rooms: [] }, rooms: {}, global: {}, qty: {} }
  const iss = issues2(empty, [])
  ok('без модели — одна строка про модель', iss.length === 1 && /модель контейнера/i.test(iss[0]), JSON.stringify(iss))
  ok('про отделку и себестоимость молчим', !iss.some((x) => /отделк|себестоимость|вариант/i.test(x)), JSON.stringify(iss))
  ok('боевой раздел при этом говорит своё',
    sheetIssues(empty, EST, PRODUCTS).some((x) => /^Нет помещений/.test(x)))

  const one = sheet2()
  one.model = Object.assign({}, one.model, { rooms: one.model.rooms.slice(0, 1) })
  ok('одно помещение — перегородок нет',
    issues2(one, []).some((x) => /перегородок/i.test(x)), JSON.stringify(issues2(one, [])))

  // Претензии самой модели раздел передаёт как есть: проём без изделия — это цена,
  // которая не посчитается, и молчать об этом нельзя.
  const broken = sheet2()
  broken.model = Object.assign({}, broken.model, {
    openings: broken.model.openings.map((o) => Object.assign({}, o, { typeId: 'нет такого' })),
  })
  ok('проём без изделия виден',
    issues2(broken, []).some((x) => /типового изделия/i.test(x)), JSON.stringify(issues2(broken, [])))

  const done = sheet2()
  ok('собранная модель претензий не вызывает', issues2(done, done.winTypes).length === 0,
    JSON.stringify(issues2(done, done.winTypes)))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
