#!/usr/bin/env node
// Клей под обшивку стен (src/glue.js).
//
// Фанеру и плитку на стены санузла, зала, спальни сажают на монтажный клей Tytan.
// Сколько его брать, раньше считал в уме тот, кто читал смету: в «Стенах спальни»
// стоял один картридж на 26,87 м². Портал считает сам: 100 г на квадрат (норма
// Юрия), в картридже Tytan Classic Fix 310 мл — 0,28 кг нетто (карточка Леманы).
// Сторожим формулу, то, какая строка вообще получает подсказку, и какой товар
// считается клеем, а какой — облицовкой.
import { GLUE_G_PER_M2, GLUE_G_PER_TUBE, glueTubes, isGlueMat, isGluedFacing, isWallRow, glueForRow, glueProductOf, glueRateOf, glueRateParse } from '../src/glue.js'

const t = reporterOf()
function reporterOf() {
  let failed = 0
  return {
    section: (n) => console.log(n),
    ok: (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) },
    done: () => { console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли'); process.exit(failed ? 1 : 0) },
  }
}

const PLY = { id: 'm1', n: 'Фанера 4 мм ФК шлифованная 1525×1525 мм сорт 3/4', mode: 'sheet', packBase: 'м²', packPer: 2.325, qty: 12 }
const TILE = { id: 'm2', n: 'Плитка Керамин Студио 60x30 см матовая коричневый дерево', mode: 'm2', qty: 10 }
const GLUE = { id: 'm3', n: 'Клея монтажный Classic Fix TYTAN упаковка 12 шт', mode: 'piece', qty: 1 }
const wallRow = (extra) => Object.assign({ key: 'rule:r1:room1', name: 'Стены спальня', surface: 'wall', area: 26.87, mats: [GLUE, PLY] }, extra || {})

{
  t.section('Сколько картриджей')
  t.ok('норма — 100 г на м²', GLUE_G_PER_M2 === 100)
  t.ok('в картридже Classic Fix — 280 г нетто', GLUE_G_PER_TUBE === 280)
  // 26,87 × 100 = 2687 г; 2687 / 280 = 9,6 — покупают целыми, значит 10.
  t.ok('стены спальни 26,87 м² — 10 шт', glueTubes(26.87) === 10, String(glueTubes(26.87)))
  // Ровно в картридж (2,8 м² = 280 г) и ровно в пять (14 м²): лишнего не докидываем,
  // даже если плавающая точка даст хвост после запятой.
  t.ok('ровно в картридж — без лишнего', glueTubes(2.8) === 1, String(glueTubes(2.8)))
  t.ok('14 м² — ровно 5', glueTubes(14) === 5, String(glueTubes(14)))
  t.ok('1,4 м² — полкартриджа, берут один', glueTubes(1.4) === 1, String(glueTubes(1.4)))
  t.ok('42,91 м² зала — 16 шт', glueTubes(42.91) === 16, String(glueTubes(42.91)))
  t.ok('нет площади — нечего считать', glueTubes(0) === 0 && glueTubes(-3) === 0 && glueTubes('') === 0)
}

{
  t.section('Что клей, а что облицовка')
  t.ok('Tytan латиницей — клей', isGlueMat('Клей монтажный Tytan Classic Fix прозрачный 310 мл'))
  t.ok('TYTAN капсом — клей', isGlueMat(GLUE.n))
  t.ok('«Титан» по-русски — клей', isGlueMat('Жидкие гвозди Титан'))
  t.ok('фанера — не клей', !isGlueMat(PLY.n))

  t.ok('фанера — облицовка', isGluedFacing(PLY.n))
  t.ok('плитка — облицовка', isGluedFacing(TILE.n))
  t.ok('керамогранит — облицовка', isGluedFacing('Керамогранит Маттоне дерево 19.8×60.3 матовый'))
  t.ok('кафель — облицовка', isGluedFacing('Кафель белый 20×30'))
  // В имени есть «плитк», но это не то, что клеят на стену.
  t.ok('клей для плитки — не облицовка', !isGluedFacing('Клей для плитки Церезит CM 17 Super Flex 25 кг'))
  t.ok('тёплый пол под плитку — не облицовка', !isGluedFacing('Теплый пол 9 м² электрический мат под плитку 150 вт'))
  t.ok('затирка для плитки — не облицовка', !isGluedFacing('Затирка для плитки Ceresit CE 40'))
  t.ok('ГКЛ — не облицовка под клей', !isGluedFacing('Гипсокартон Knauf 12,5 мм'))
}

{
  t.section('Какая строка — стены')
  t.ok('правило по стенам', isWallRow({ surface: 'wall' }))
  t.ok('стены без проёмов', isWallRow({ surface: 'wallnet' }))
  t.ok('стены с потолком', isWallRow({ surface: 'wallceil' }) && isWallRow({ surface: 'wallnetceil' }))
  t.ok('пол — не стены', !isWallRow({ surface: 'floor', name: 'Стены спальня' }))
  // Строка справочника без правила поверхности не знает — читаем её по названию.
  t.ok('без поверхности — по названию «Стены зал»', isWallRow({ name: 'Стены зал' }))
  t.ok('«Пол санузел» по названию — не стены', !isWallRow({ name: 'Пол санузел' }))
  t.ok('пустая строка — не стены', !isWallRow(null) && !isWallRow({}))
}

{
  t.section('Подсказка в строке')
  const g = glueForRow(wallRow())
  t.ok('стены спальни с фанерой — 10 шт на 26,87 м²', !!g && g.tubes === 10 && g.area === 26.87 && g.grams === 2687, JSON.stringify(g))
  t.ok('плитка на стенах санузла — тоже', !!glueForRow(wallRow({ name: 'Стены санузел', area: 14, mats: [TILE] })))
  // Множитель правила («×2») удваивает материалы — удваивает и клей.
  const twice = glueForRow(wallRow({ mult: 2 }))
  t.ok('множитель правила удваивает площадь', !!twice && twice.area === 53.74 && twice.tubes === 20, JSON.stringify(twice))
  t.ok('на стенах без фанеры и плитки — молчим', glueForRow(wallRow({ mats: [GLUE] })) === null)
  t.ok('фанера на полу — молчим', glueForRow(wallRow({ surface: 'floor', name: 'Пол спальня' })) === null)
  t.ok('строка без площади — молчим', glueForRow(wallRow({ area: 0 })) === null)
  t.ok('своя работа — молчим', glueForRow(wallRow({ own: true })) === null)
  // Деньги своей работы лежат «материалом» с own — облицовкой он не считается.
  t.ok('«материал» своей работы не облицовка', glueForRow(wallRow({ mats: [{ n: 'Обшивка фанерой', own: true }] })) === null)
}

{
  t.section('Товар клея в базе')
  const LEMANA = { id: 'x1', name: 'Клей монтажный Tytan Classic Fix прозрачный 310 мл', url: 'https://lemanapro.ru/product/kley-montazhnyy-tytan-classic-fix-prozrachnyy-310-ml-89453236/' }
  const OZON = { id: 'x2', name: GLUE.n, url: 'https://www.ozon.ru/product/upakovka-12-sht-kleya-montazhnyy-classic-fix-tytan-professional-310ml-2838837054/' }
  t.ok('находит Classic Fix с Леманы по артикулу', (glueProductOf([OZON, LEMANA]) || {}).id === 'x1')
  t.ok('карточка с метками в ссылке — тоже', (glueProductOf([Object.assign({}, LEMANA, { url: LEMANA.url + '?utm=1' })]) || {}).id === 'x1')
  t.ok('нет в базе — null', glueProductOf([OZON]) === null && glueProductOf(null) === null)
}

// Норма расхода правится в портале: на одном доме мажут гуще, и спорить с числом
// в коде незачем. Живёт в `settings.glueGPerM2`, по умолчанию — 100.
{
  t.section('Своя норма расхода')
  t.ok('200 г/м² на спальню — 20 шт', glueTubes(26.87, 200) === 20, String(glueTubes(26.87, 200)))
  t.ok('150 г/м² на спальню — 15 шт', glueTubes(26.87, 150) === 15, String(glueTubes(26.87, 150)))
  t.ok('норма не задана — по умолчанию 100', glueTubes(26.87) === 10)
  t.ok('испорченная норма — тоже по умолчанию', glueTubes(26.87, 0) === 10 && glueTubes(26.87, -5) === 10 && glueTubes(26.87, 'abc') === 10)

  t.ok('норма из настроек', glueRateOf({ glueGPerM2: 150 }) === 150)
  t.ok('настроек нет — 100', glueRateOf({}) === 100 && glueRateOf(null) === 100)
  t.ok('отрицательная или безумная — 100', glueRateOf({ glueGPerM2: -5 }) === 100 && glueRateOf({ glueGPerM2: 5000 }) === 100)

  t.ok('«150» — 150', glueRateParse('150') === 150)
  t.ok('«120,5» — с запятой', glueRateParse('120,5') === 120.5)
  t.ok('«180 г/м²» — с единицей', glueRateParse(' 180 г/м² ') === 180)
  t.ok('пусто, ноль, буквы — не норма', glueRateParse('') === null && glueRateParse('0') === null && glueRateParse('abc') === null && glueRateParse(null) === null)
  t.ok('«-50» — не норма', glueRateParse('-50') === null)
  t.ok('3 кг на квадрат — опечатка, не норма', glueRateParse('3000') === null)

  const g = glueForRow(wallRow(), 200)
  t.ok('строка считает по своей норме', !!g && g.rate === 200 && g.grams === 5374 && g.tubes === 20, JSON.stringify(g))
  t.ok('без нормы — по умолчанию', glueForRow(wallRow()).rate === 100)
}

t.done()
