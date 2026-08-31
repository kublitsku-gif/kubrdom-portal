#!/usr/bin/env node
// «Спецификация 2» — опытный раздел (src/spec2.js).
//
// Смысл раздела — пробовать другие правила, не задевая продаж. Поэтому сторожим
// две вещи, на которых такой опыт и ломается: деньги обязаны совпадать с боевым
// расчётом (иначе клиенту назовут одну цену, а в договор уйдёт другая), а
// «готово» обязано считаться по-своему — тут дом начинается с модели контейнера.
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
  return { id: 's2', kind: 'house', name: 'Опыт', markup: 30, model, specs, rooms, global: {}, qty: {} }
}

// ── 1. Деньги общие с боевым разделом ────────────────────────────────────────
{
  console.log('Цена')
  const sh = sheet2()
  const a = totals2(sh, EST, PRODUCTS), b = sheetTotals(sh, EST, PRODUCTS)
  ok('себестоимость совпадает', a.cost === b.cost && a.cost > 0, a.cost + ' / ' + b.cost)
  ok('цена клиенту совпадает', a.price === b.price, a.price + ' / ' + b.price)
  ok('разбивка по этапам совпадает', JSON.stringify(a.byStage) === JSON.stringify(b.byStage))
  ok('позиции те же', a.count === b.count && a.count > 0, String(a.count))
  ok('наценка применена', a.price === Math.round(a.cost * 1.3), a.price + ' ≠ ' + Math.round(a.cost * 1.3))
}

// ── 2. Готовность считается по-своему ────────────────────────────────────────
{
  console.log('Что мешает продавать')
  const noModel = { id: 's0', kind: 'house', specs: { height: 2.5, rooms: [] }, rooms: {}, global: {}, qty: {} }
  const iss = issues2(noModel, EST, PRODUCTS)
  ok('без модели раздел говорит об этом первым', /модель контейнера/i.test(iss[0]), JSON.stringify(iss))
  ok('и не повторяет «нет помещений» второй строкой', !iss.some((x) => /^Нет помещений/.test(x)), JSON.stringify(iss))
  ok('боевой раздел при этом говорит про помещения',
    sheetIssues(noModel, EST, PRODUCTS).some((x) => /^Нет помещений/.test(x)))

  const one = sheet2()
  one.model = Object.assign({}, one.model, { rooms: one.model.rooms.slice(0, 1) })
  ok('одно помещение — перегородок ещё нет',
    issues2(one, EST, PRODUCTS).some((x) => /перегородок/i.test(x)), JSON.stringify(issues2(one, EST, PRODUCTS)))

  const done = sheet2()
  const left = issues2(done, EST, PRODUCTS)
  ok('собранный лист претензий не вызывает', left.length === 0, JSON.stringify(left))
  ok('и боевой расчёт тоже молчит', sheetIssues(done, EST, PRODUCTS).length === 0,
    JSON.stringify(sheetIssues(done, EST, PRODUCTS)))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
