#!/usr/bin/env node
// История цен товара (src/prices.js).
//
// Цена в каталоге живая: её правят, когда магазин поднял ценник. Смета, собранная
// месяц назад, считалась по прежней цифре, и вопрос «почему подорожало» упирается
// в то, что прежней цены больше нет нигде. Сторожим ровно это: что история пишет
// состоявшиеся изменения, а не каждый ввод; что «было» показывает ПРЕЖНЮЮ цену, а
// не нынешнюю; и что обновление по каталогу трогает только отставшие строки и
// честно считает, на сколько подорожало.
import { HIST_MAX, priceHist, priceWas, pricePush, priceStale, refreshPrices } from '../src/prices.js'

let failed = 0
const ok = (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) }
const section = (n) => console.log(n)

section('История цены')
{
  const p = { id: 'p1', unitCost: 900 }
  ok('пустая история — ничего не было', priceHist(p).length === 0 && priceWas(p) === null)

  ok('первая запись появилась', pricePush(p, 900, '2026-01-10T00:00:00Z', 'Иван') === true)
  ok('та же цифра подряд историей не является', pricePush(p, 900, '2026-01-11T00:00:00Z', 'Иван') === false)
  ok('в истории одна запись', priceHist(p).length === 1, String(priceHist(p).length))

  p.unitCost = 1200
  pricePush(p, 1200, '2026-02-01T00:00:00Z', 'Пётр')
  const was = priceWas(p)
  ok('«было» — прежняя цена, а не нынешняя', was && was.c === 900, JSON.stringify(was))
  ok('и помнит, кто правил', was && was.by === 'Иван')

  // Ещё одна правка на ту же цифру: «было» обязано перешагнуть её и показать 900,
  // иначе строка обещает «было 1 200 ₽» при цене 1 200 ₽.
  p.unitCost = 1200
  ok('повтор нынешней цены «было» не подменяет', priceWas(p).c === 900, String(priceWas(p).c))
}

section('Длина истории')
{
  const p = { id: 'p2', unitCost: 0 }
  for (let i = 1; i <= HIST_MAX + 8; i++) pricePush(p, i * 10, '2026-01-01T00:00:00Z', '')
  ok('история подрезана', priceHist(p).length === HIST_MAX, String(priceHist(p).length))
  ok('свежие записи сохранены', priceHist(p)[HIST_MAX - 1].c === (HIST_MAX + 8) * 10)
  ok('чужой объект не ломает', pricePush(null, 100, '', '') === false)
}

section('Цена отстала от каталога')
{
  const prod = { id: 'p_osb', unitCost: 1200 }
  ok('копия отстала', priceStale({ pid: 'p_osb', cost: 900 }, prod) === true)
  ok('копия свежая', priceStale({ pid: 'p_osb', cost: 1200 }, prod) === false)
  // Без ссылки на каталог сравнивать не с чем: вписанный руками товар — своя цена.
  ok('материал без товара не отстаёт', priceStale({ pid: '', cost: 1 }, prod) === false)
  ok('без карточки не отстаёт', priceStale({ pid: 'p_osb', cost: 1 }, null) === false)
}

section('Обновление по каталогу')
{
  const byId = { p_osb: { id: 'p_osb', unitCost: 1200 }, p_tile: { id: 'p_tile', unitCost: 2000 } }
  const mats = [
    { pid: 'p_osb', n: 'ОСП', cost: 900, unitCost: 900, qty: 10 },
    { pid: 'p_tile', n: 'Плитка', cost: 2000, unitCost: 2000, qty: 5 },
    { pid: '', n: 'Свой', cost: 100, qty: 1 },
  ]
  const r = refreshPrices(mats, byId)
  ok('обновилась одна строка', r.n === 1, String(r.n))
  ok('дельта считается по количеству', r.diff === (1200 - 900) * 10, String(r.diff))
  ok('цена в строке новая', mats[0].cost === 1200 && mats[0].unitCost === 1200)
  ok('свежая строка не тронута', mats[1].cost === 2000)
  ok('материал без товара не тронут', mats[2].cost === 100)

  // Повторный прогон ничего не находит: «готово» обязано отличаться от «нечего делать».
  ok('повтор ничего не меняет', refreshPrices(mats, byId).n === 0)
  ok('подешевевший товар даёт минус',
    refreshPrices([{ pid: 'p_osb', cost: 1500, qty: 2 }], byId).diff === (1200 - 1500) * 2)
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
