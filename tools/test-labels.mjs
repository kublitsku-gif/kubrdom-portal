#!/usr/bin/env node
// Раскладка бирок на стеллаж (src/labels.js).
//
// Стеллаж — дом, полка — этап. Сторожим здесь не вёрстку листа, а то, из-за чего
// на складе недокомплект: работа не должна ни потеряться, ни задвоиться, а
// разложенное человеком руками обязано быть сильнее автомата.
import { SHELVES_DEFAULT, labelUnits, labelWorks, shelfLayout, shelfPages, houseNums,
  labelSheetCount, matPinKey } from '../src/labels.js'

let failed = 0
const ok = (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) }
const section = (n) => console.log(n)

const W = (key, stage, name, mats) => ({ key, stage, name, mats: mats.map((n) => ({ n, qty: 1, unit: 'шт' })) })
const WORKS = [
  W('a', 1, 'Опоры', ['Опора']),
  W('b', 2, 'Обрешётка', ['Брусок', 'Подвес', 'Саморез']),
  W('c', 2, 'Электрика', ['Кабель', 'Гофра']),
  W('d', 2, 'Вода', ['Труба']),
  W('e', 3, 'Обшивка', ['ОСП', 'Саморез 35']),
]
const names = (sh) => sh.map((s) => s.works.map((w) => w.name + (w.part ? '*' : '')).join(','))
const allMats = (sh) => sh.reduce((a, s) => a + s.works.reduce((b, w) => b + w.mats.length, 0), 0)

// ── 1. Позиция сметы → строка бирки ─────────────────────────────────────────
{
  section('Строка бирки — это позиция сметы, без цен')
  const pos = [
    { key: 'k1', name: 'Обшивка', stage: 3, cost: 40000,
      mats: [{ n: 'ОСП', qty: 30.004, mode: 'sheet' }, { n: 'Пустой', qty: 0 }, { n: '  ', qty: 5 }] },
    { key: 'k2', name: 'Выключено', stage: 3, off: true, mats: [{ n: 'Х', qty: 1 }] },
  ]
  const w = labelWorks(pos, (m) => (m.mode === 'sheet' ? 'лист' : 'шт'))
  ok('выключенная строка на бирку не едет', w.length === 1)
  ok('материал без количества отброшен', w[0].mats.length === 1)
  ok('количество округлено до сотых', w[0].mats[0].qty === 30, String(w[0].mats[0].qty))
  ok('единица берётся снаружи — та же, что в смете', w[0].mats[0].unit === 'лист')
  ok('цены на бирке нет', JSON.stringify(w[0]).indexOf('40000') < 0)
  ok('длина строки = работа + её материалы', labelUnits(w[0]) === 2)
}

// ── 2. Полки ────────────────────────────────────────────────────────────────
{
  section('Полка = этап, лишние полки разгружают самый объёмный')
  const sh = shelfLayout(WORKS, SHELVES_DEFAULT, {})
  ok('полок пять', sh.length === 5)
  ok('этап 1 на первой', names(sh)[0] === 'Опоры')
  ok('этап 3 на четвёртой', names(sh)[3] === 'Обшивка')
  ok('этап 2 поделён между двумя полками', sh[1].works.length > 0 && sh[2].works.length > 0, names(sh).join(' | '))
  ok('полка «прочее» сама ничего не забирает', sh[4].works.length === 0)
  const total = sh.reduce((a, s) => a + s.works.length, 0)
  ok('ни одна работа не потеряна и не задвоена', total === WORKS.length, String(total))

  // Этап, которому полки не назначили, — самая дорогая ошибка: молча исчезнувший
  // материал на складе не отличить от невыданного.
  const one = shelfLayout(WORKS, [1, 0], {})
  ok('этап без своей полки уезжает на свободную, а не пропадает',
    one.reduce((a, s) => a + s.works.length, 0) === WORKS.length, names(one).join(' | '))
  const noFree = shelfLayout(WORKS, [1], {})
  ok('и даже когда свободных полок нет', noFree[0].works.length === WORKS.length)
}

// ── 3. Руками сильнее автомата ──────────────────────────────────────────────
{
  section('Разложенное руками сильнее автомата')
  const pins = { c: 5 }
  const sh = shelfLayout(WORKS, SHELVES_DEFAULT, pins)
  ok('прибитая работа лежит на своей полке', names(sh)[4] === 'Электрика')
  ok('и больше нигде', names(sh).join(' ').match(/Электрика/g).length === 1)
  ok('остальные не потерялись', sh.reduce((a, s) => a + s.works.length, 0) === WORKS.length)

  // Материал отдельно от работы: длинный брусок кладут вниз.
  const mp = {}; mp[matPinKey('b', 'Брусок')] = 5
  const sh2 = shelfLayout(WORKS, SHELVES_DEFAULT, mp)
  const away = sh2[4].works[0]
  ok('материал уехал на указанную полку', !!away && away.mats.length === 1 && away.mats[0].n === 'Брусок')
  ok('и остался подписан своей работой', !!away && away.name === 'Обрешётка' && away.part === true)
  const home = sh2.flatMap((s) => s.works).filter((w) => w.name === 'Обрешётка' && !w.part)[0]
  ok('на своей полке работа осталась без него', !!home && home.mats.length === 2)
  ok('материалы в сумме не задвоились', allMats(sh2) === allMats(shelfLayout(WORKS, SHELVES_DEFAULT, {})))

  // Работа, у которой уехали ВСЕ материалы, пустой строкой не висит.
  const all = {}
  WORKS[2].mats.forEach((m) => { all[matPinKey('c', m.n)] = 5 })
  const sh3 = shelfLayout(WORKS, SHELVES_DEFAULT, all)
  ok('работа без единого материала на своей полке не остаётся',
    sh3.flatMap((s) => s.works).filter((w) => w.name === 'Электрика' && !w.part).length === 0)
  ok('а её материалы на месте', allMats(sh3) === allMats(shelfLayout(WORKS, SHELVES_DEFAULT, {})))

  // Привязка за пределы стеллажа — это стёртая полка, и она не должна уносить работу.
  const bad = shelfLayout(WORKS, SHELVES_DEFAULT, { a: 99, b: 0 })
  ok('привязка к несуществующей полке не теряет работу',
    bad.reduce((a, s) => a + s.works.length, 0) === WORKS.length, names(bad).join(' | '))
}

// ── 4. Листы ────────────────────────────────────────────────────────────────
{
  section('Полка, не влезшая на лист, продолжается вторым')
  const big = Array.from({ length: 20 }, (_, i) => W('w' + i, 2, 'Р' + i, ['м1', 'м2']))
  const pages = shelfPages(big, 26)
  ok('60 строк при 26 на лист → три листа', pages.length === 3, String(pages.length))
  ok('при резке ни одна работа не пропала', pages.flat().length === 20)
  ok('пустая полка — всё равно один лист', shelfPages([], 26).length === 1)
  // Работа длиннее листа не должна давать пустой первый лист.
  const huge = shelfPages([W('h', 2, 'Огромная', Array.from({ length: 40 }, (_, i) => 'м' + i))], 26)
  ok('работа длиннее листа печатается, а не теряется', huge.flat().length === 1)
}

// ── 5. Номера домов и счёт листов ───────────────────────────────────────────
{
  section('Серия домов задаётся строкой')
  ok('«1-21» → 21 дом', houseNums('1-21').length === 21)
  ok('и это номера, а не индексы', houseNums('1-21')[20] === '21')
  ok('перечисление', JSON.stringify(houseNums('1,3,7')) === '["1","3","7"]')
  ok('смесь диапазона и перечисления', houseNums('1-3, 9').join(',') === '1,2,3,9')
  ok('обратный диапазон разворачивается', houseNums('5-3').join(',') === '3,4,5')
  ok('пустое поле — один дом, а не ноль', houseNums('').length === 1)

  const sh = shelfLayout(WORKS, SHELVES_DEFAULT, {})
  ok('21 дом по 5 полок с титульным = 126 листов',
    labelSheetCount(sh, houseNums('1-21'), 26, true, true) === 126,
    String(labelSheetCount(sh, houseNums('1-21'), 26, true, true)))
  ok('без титульных — 105', labelSheetCount(sh, houseNums('1-21'), 26, false, true) === 105)
  ok('только титульные — по листу на дом', labelSheetCount(sh, houseNums('1-21'), 26, true, false) === 21)
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
