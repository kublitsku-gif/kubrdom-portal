#!/usr/bin/env node
// Компенсация заказчиком: материалы покупаем МЫ, деньги он возвращает.
//
// Смысл шага: пометка ничего в закупке не меняет — позиция целиком остаётся в
// прогрессе, в «куплено / осталось», в подытоге этапа и в приёмке. Она отвечает на
// другой вопрос: чьи это в итоге деньги. По пометкам собирается счёт.
//
// Сторожим три вещи: признак не трогает закупку, кнопки нет в объектах, где
// компенсация не включена, и в счёт уходит ровно то, что показано на экране.
import { clientPays, objClientPays, refundMats, refundTotals, isLabour, buyMats, looksLikeLabour } from '../src/supply.js'
import { positionWork } from '../src/recipe.js'
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const MATS = [
  { id: 'm1', cost: 229, qty: 20 },
  { id: 'm2', cost: 500, qty: 2 },
  { id: 'm3', cost: 1200, qty: 30, client: true },
]

// ── 1. Общий модуль ─────────────────────────────────────────────────────────
{
  t.section('Кто вернёт деньги — считает общий модуль')
  t.ok('признак читается с материала', clientPays(MATS[2]) && !clientPays(MATS[0]))
  t.ok('договорённость — свойство объекта',
    objClientPays({ clientPays: true }) && !objClientPays({}) && !objClientPays(null))

  const ref = refundMats(MATS, {})
  t.ok('в счёт идёт помеченное', ref.length === 1 && ref[0].id === 'm3')

  // «Уже потрачено» — то, что мы оплатили: просить компенсацию за непотраченное рано.
  const t0 = refundTotals(ref, {})
  t.ok('сумма счёта — цена × количество', t0.sum === 1200 * 30, String(t0.sum))
  t.ok('пока не купили — потрачено ноль', t0.bought === 0)
  const t1 = refundTotals(ref, { m3: true })
  t.ok('после покупки попадает в потраченное', t1.bought === 1200 * 30)

  // Разовый добор складывается с постоянной пометкой, а не заменяет её.
  const both = refundMats(MATS, { m1: true })
  t.ok('разовый добор прибавляется', both.map((m) => m.id).join(',') === 'm1,m3')
  t.ok('и попадает в сумму', refundTotals(both, {}).sum === 229 * 20 + 1200 * 30)
  t.ok('пустой список — пустой итог', refundTotals([], {}).count === 0 && refundTotals([], {}).sum === 0)
}

// Объект: две позиции, одну заказчик компенсирует. Компенсация включена.
function seed(p, on) {
  p.set({
    expProducts: [],
    objects: [
      { id: 'o1', name: 'Мордвес 1', icon: '🏠', clientPays: on === false ? undefined : true, stages: [
        { id: 's1', n: 'ЭТАП 1', c: '#e67e22', works: [
          { id: 'w1', n: 'Каркас', cost: 5007, mats: [
            { id: 'm1', n: 'Брусок 50×50', cost: 229, qty: 20, store: 'Белка', mode: 'piece', client: true },
            { id: 'm2', n: 'Гвозди 30 мм', cost: 427, qty: 1, store: 'Озон', mode: 'piece' },
          ] },
        ] },
      ] },
    ],
    purchased: {}, arrived: {}, purchases: [],
    templates: [], contractDocs: [], users: [], finTxns: [], stock: [], issues: [],
  })
  p.run('window._supplySelected={o1:true};supplyHandoff={};supplyPickMode=false;supplyLabourOpen=false;')
}
const nb = (x) => x.replace(/[\u00a0\u202f]/g, ' ')

// ── 2. Закупка идёт как обычно ──────────────────────────────────────────────
// Главное отличие от прежней логики: помеченная позиция НЕ выходит из закупки.
// Покупаем мы, значит она в общем счёте и растёт в «куплено» вместе со всеми.
{
  t.section('Помеченная позиция остаётся нашей закупкой')
  const p = boot(); seed(p)

  const html = nb(p.run('tSupplyDetail({o1:true},"stage")'))
  t.ok('вся смета в счёте', html.indexOf('из 5 007 ₽') >= 0, 'позицию вычли из закупки')
  t.ok('этап считает обе позиции', html.indexOf('0/2 · 5 007 ₽') >= 0, 'подытог этапа урезан')
  t.ok('строка помечена чипом', html.indexOf('💰 платит заказчик') >= 0)
  t.ok('но не выглядит закрытой', html.indexOf('✓ Покупает заказчик') < 0,
    'позиция закрылась сама — покупать-то нам')

  // Отмечаем куплено обычной галочкой — деньги растут нарастающе.
  const row = p.dom.node({ a: 'supply-check', mid: 'm1' }) || p.dom.node({ a: 'supply-stage-check', mid: 'm1' })
  p.run('bind();'); row.onclick({ stopPropagation() {} })
  const after = nb(p.run('tSupplyDetail({o1:true},"stage")'))
  t.ok('куплено выросло на всю позицию', after.indexOf('4 580 ₽') >= 0, 'деньги не попали в «куплено»')
  t.ok('и осталось только наше остальное', after.indexOf('427 ₽') >= 0)

  // Приёмка: обычная позиция без особых пометок — купили и везём мы.
  const rec = nb(p.run('tReceive({o1:true})'))
  t.ok('позиция в приёмке', rec.indexOf('Брусок 50×50') >= 0)
  t.ok('и без пометок про заказчика', rec.indexOf('везёт заказчик') < 0,
    'кто вернёт деньги — не вопрос склада')
}

// ── 3. Кнопка только там, где договорились ──────────────────────────────────
{
  t.section('Кнопка только в своём объекте')
  const p = boot(); seed(p, false)

  const off = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('пилюли в строках нет', off.indexOf('data-a="supply-client"') < 0,
    'значок висит в объекте, где компенсации нет')
  t.ok('панели тоже нет', off.indexOf('Оплата заказчиком') < 0)
  t.ok('но включить предлагают', off.indexOf('data-a="supply-refund-on"') >= 0)

  const on = p.dom.node({ a: 'supply-refund-on', oid: 'o1' })
  p.run('bind();'); on.onclick({ stopPropagation() {} })
  t.ok('включилось у объекта', p.q('objects[0].clientPays') === true)

  const shown = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('пилюля появилась', shown.indexOf('data-a="supply-client"') >= 0)
  t.ok('и панель тоже', shown.indexOf('Оплата заказчиком') >= 0)

  const offBtn = p.dom.node({ a: 'supply-refund-off', oid: 'o1' })
  p.run('bind();'); offBtn.onclick({ stopPropagation() {} })
  t.ok('выключается обратно', !p.q('objects[0].clientPays'))
}

// ── 3b. Разовый добор ───────────────────────────────────────────────────────
{
  t.section('Разовый добор живёт на экране')
  const p = boot(); seed(p)
  const modeBtn = p.dom.node({ a: 'supply-pick-mode' })
  p.run('bind();'); modeBtn.onclick()
  t.ok('режим включился', p.q('supplyPickMode') === true)

  const row = p.dom.node({ a: 'supply-pick', mid: 'm2' })
  p.run('bind();'); row.onclick()
  t.ok('позиция добрана', p.q('supplyHandoff.m2') === true)
  t.ok('и «куплено» при этом не поставилось', !p.q('purchased.m2'),
    'разовый выбор не должен трогать закупку')
  t.ok('в объект добор не записан', !p.q('objects[0].stages[0].works[0].mats[1].client'),
    'разовое решение не место в снимке')

  const withPick = nb(p.run('tSupplyDetail({o1:true},"stage")'))
  t.ok('счёт вырос на добранное', withPick.indexOf('2 поз. · 5 007 ₽') >= 0, 'нет счётчика добора')

  const clr = p.dom.node({ a: 'supply-pick-clear' })
  p.run('bind();'); clr.onclick()
  t.ok('«снять разовые» очищает выбор', Object.keys(p.q('supplyHandoff') || {}).length === 0)
}

// ── 3c. Соседний объект пилюли не получает ──────────────────────────────────
// Договорённость про компенсацию — свойство ОДНОЙ стройки. Проверяем на двух
// объектах сразу: в чужом ни кнопки, ни чипа быть не должно, даже когда оба
// выбраны в снабжении и строки идут вперемешку.
{
  t.section('Компенсация не протекает в чужой объект')
  const p = boot()
  const obj = (id, name, on) => ({
    id, name, icon: '🏠', clientPays: on || undefined, stages: [
      { id: 's_' + id, n: 'ЭТАП 1', c: '#e67e22', works: [
        { id: 'w_' + id, n: 'Каркас', cost: 1000, mats: [
          { id: 'm_' + id, n: 'Брусок ' + name, cost: 100, qty: 10, store: 'Белка', mode: 'piece' },
        ] },
      ] },
    ],
  })
  p.set({
    expProducts: [], objects: [obj('o1', 'Мордвес 1', true), obj('o2', 'Мордвес 2', false)],
    purchased: {}, arrived: {}, purchases: [],
    templates: [], contractDocs: [], users: [], finTxns: [], stock: [], issues: [],
  })

  // Свой объект — кнопка есть.
  p.run('window._supplySelected={o1:true};supplyHandoff={};supplyPickMode=false;supplyLabourOpen=false;')
  const own = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('в своём объекте пилюля есть', own.indexOf('data-a="supply-client" data-ids="m_o1"') >= 0)

  // Соседний — ни кнопки, ни панели, ни чипа.
  p.run('window._supplySelected={o2:true};')
  const other = p.run('tSupplyDetail({o2:true},"stage")')
  t.ok('в чужом объекте пилюли нет', other.indexOf('data-a="supply-client"') < 0,
    'кнопка протекла в объект, где компенсации нет')
  t.ok('и панели компенсации нет', other.indexOf('💰 Оплата заказчиком') < 0)
  t.ok('но включить предлагают и там', other.indexOf('data-a="supply-refund-on" data-oid="o2"') >= 0)

  // Оба объекта разом: пилюля только у строк своего.
  p.run('window._supplySelected={o1:true,o2:true};')
  const both = p.run('tSupplyDetail({o1:true,o2:true},"stage")')
  t.ok('при двух объектах пилюля только у своего',
    both.indexOf('data-a="supply-client" data-ids="m_o1"') >= 0
    && both.indexOf('data-a="supply-client" data-ids="m_o2"') < 0,
    'пилюля появилась у чужой строки')
  t.ok('переключателя объекта при двух не показываем', both.indexOf('data-a="supply-refund-on"') < 0,
    'непонятно, для какого объекта кнопка')
}

// ── 3d. Счёт на серию домов ─────────────────────────────────────────────────
// Смета считается на ОДИН дом, а закупают на партию. Множитель живёт у объекта:
// серия — свойство этой стройки, а не портала. Один дом — колонок серии нет вовсе.
{
  t.section('Счёт умножается на серию')
  const p = boot()
  const grab = () => {
    p.run('globalThis.window.open=function(){return {document:{open(){},write(h){globalThis.__cap=h;},close(){}},focus(){}};};')
    p.run('buildHandoffList();')
    return nb(p.q('__cap') || '')
  }
  p.set({
    expProducts: [],
    objects: [
      { id: 'o1', name: 'Мордвес 1', icon: '🏠', clientPays: true, stages: [
        { id: 's1', n: 'ЭТАП 1', c: '#e67e22', works: [
          { id: 'w1', n: 'Каркас', cost: 4580, mats: [
            { id: 'm1', n: 'Брусок 50×50', cost: 229, qty: 20, store: 'Белка', mode: 'piece', client: true, url: 'https://shop/1' },
          ] },
        ] },
      ] },
    ],
    purchased: { m1: true }, arrived: {}, purchases: [],
    templates: [], contractDocs: [], users: [], finTxns: [], stock: [], issues: [],
  })
  p.run('window._supplySelected={o1:true};supplyHandoff={};supplyPickMode=false;supplyLabourOpen=false;')

  // Серия не задана — таблица прежняя, лишних столбцов нет.
  const one = grab()
  t.ok('без серии колонок серии нет', one.indexOf('домов</th>') < 0 && one.indexOf('На 1 дом') < 0,
    'пустая пара столбцов «×1» только занимает ширину')
  t.ok('но сумма на дом на месте', one.indexOf('4 580 ₽') >= 0)

  // Задаём серию тем же полем, что и человек.
  const inp = p.dom.node({ a: 'supply-series', oid: 'o1' })
  t.ok('поле серии есть в панели', !!inp)
  p.run('bind();'); inp.value = '19'; inp.onchange()
  t.ok('число записано у объекта', p.q('objects[0].seriesQty') === 19)

  const many = grab()
  t.ok('шапка называет обе колонки', many.indexOf('На 1 дом') >= 0 && many.indexOf('На 19 домов') >= 0)
  t.ok('количество умножено', /380 шт/.test(many), 'нет 20 × 19 = 380')
  t.ok('сумма умножена', many.indexOf('87 020 ₽') >= 0, 'нет 4 580 × 19')
  t.ok('итоги обе строки', many.indexOf('Итого на 1 дом: 4 580 ₽') >= 0
    && many.indexOf('Итого на 19 домов: 87 020 ₽') >= 0)
  t.ok('серия названа в шапке листа', many.indexOf('серия 19 домов') >= 0)

  // Единица берётся тем же пересчётом, что и в колонке одного дома.
  t.ok('оплаченное считается по одному дому', many.indexOf('уже закуплено 4 580 ₽') >= 0,
    'оплатили один дом, а не серию')

  // Единица — обратно, серия снята.
  p.run('bind();')
  const inp2 = p.dom.node({ a: 'supply-series', oid: 'o1' })
  inp2.value = '1'; p.run('bind();'); inp2.onchange()
  t.ok('единица убирает серию из объекта', !p.q('objects[0].seriesQty'))
}

// ── 4. Труд — не товар ──────────────────────────────────────────────────────
// У СВОЕЙ работы «материал» — это она сама, её цена. Купить его нельзя: это
// оплата труда, а не позиция в магазине. Флаг `own` терялся в `positionWork`,
// и в снабжение работа приезжала обычной покупкой — «Сборку стеллажей»
// предлагали купить, она ждала приёмки на склад и висела в «осталось купить».
{
  t.section('Своя работа не попадает в закупку')

  const pos = {
    key: 'add:a1', name: 'Сборка стеллажей', stage: 1, cost: 1000, costSet: true,
    mats: [{ id: 'own:a1', pid: '', own: true, n: 'Сборка стеллажей', store: '', mode: 'piece', cost: 1000, qty: 1 }],
  }
  const w = positionWork(pos)
  t.ok('флаг own доезжает до объекта', w.mats[0].own === true,
    'без него снабжение не отличит труд от товара')
  t.ok('цена работы при этом сохранена', w.cost === 1000)

  t.ok('предикат читает труд', isLabour(w.mats[0]) && !isLabour({ n: 'ОСП', cost: 900 }))
  t.ok('в закупку такая строка не идёт', buyMats(w).length === 0)
  t.ok('а обычный материал идёт',
    buyMats({ mats: [{ id: 'x', n: 'ОСП', cost: 900, qty: 2 }, w.mats[0]] }).length === 1)

  // Экран снабжения: работа не показана и в деньги не входит.
  const p = boot()
  p.set({
    expProducts: [],
    objects: [
      { id: 'o1', name: 'Мордвес 1', icon: '🏠', stages: [
        { id: 's1', n: 'ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЙ', c: '#e67e22', works: [
          { id: 'w1', n: 'Каркас', cost: 4580, mats: [
            { id: 'm1', n: 'Брусок 50×50', cost: 229, qty: 20, store: 'Белка', mode: 'piece' },
          ] },
          { id: 'w2', n: 'Сборка стеллажей', cost: 1000, labor: 1000, mats: [
            Object.assign({ id: 'm9' }, w.mats[0]),
          ] },
        ] },
      ] },
    ],
    purchased: {}, arrived: {}, purchases: [],
    templates: [], contractDocs: [], users: [], finTxns: [], stock: [], issues: [],
  })
  p.run('window._supplySelected={o1:true};supplyHandoff={};supplyPickMode=false;')

  const html = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('работы в списке закупки нет', html.indexOf('Сборка стеллажей') < 0,
    'труд предлагают купить в магазине')
  t.ok('материал на месте', html.indexOf('Брусок 50×50') >= 0)
  t.ok('и деньги считаются без работы', html.indexOf((229 * 20).toLocaleString('ru-RU')) >= 0
    && html.indexOf((229 * 20 + 1000).toLocaleString('ru-RU')) < 0,
    'в сумму закупки затесалась оплата труда')

  // Связь материала с работой — её-то как раз и надо видеть: строка закупки без
  // работы это просто товар и число, а подо что он берётся — непонятно.
  t.ok('у материала видно, к какой работе он относится', html.indexOf('↳ Каркас') >= 0,
    'строка закупки не говорит, подо что берут')
}

// ── 5. Слитая строка называет все свои работы ───────────────────────────────
{
  t.section('Подо что берём — видно в строке')
  const p = boot()
  p.set({
    expProducts: [],
    objects: [
      { id: 'o1', name: 'Мордвес 1', icon: '🏠', stages: [
        { id: 's1', n: 'ЭТАП 1', c: '#e67e22', works: [
          { id: 'w1', n: 'Каркас', cost: 4580, mats: [{ id: 'm1', n: 'Брусок 50×50', cost: 229, qty: 20, store: 'Белка', mode: 'piece' }] },
          { id: 'w2', n: 'Обрешётка', cost: 2290, mats: [{ id: 'm2', n: 'Брусок 50×50', cost: 229, qty: 10, store: 'Белка', mode: 'piece' }] },
        ] },
      ] },
    ],
    purchased: {}, arrived: {}, purchases: [],
    templates: [], contractDocs: [], users: [], finTxns: [], stock: [], issues: [],
  })
  p.run('window._supplySelected={o1:true};supplyHandoff={};supplyPickMode=false;')

  // Одна позиция склеена из двух работ — обе должны быть названы, первая в строке,
  // остальные счётчиком и в подсказке.
  const html = p.run('tSupplyDetail({o1:true},"merge")')
  t.ok('строка слита', html.indexOf('📦 2 позиций → 1') >= 0)
  t.ok('первая работа названа', html.indexOf('↳ Каркас +1') >= 0, 'нет ссылки на работу')
  t.ok('остальные — в подсказке', html.indexOf('title="Каркас, Обрешётка"') >= 0,
    'полный список работ должен быть в title')

  // Во всех трёх видах — один и тот же ответ на вопрос «подо что».
  t.ok('вид «Этапы» тоже называет работу', p.run('tSupplyDetail({o1:true},"stage")').indexOf('↳ Каркас') >= 0)
  t.ok('вид «Магазины» тоже', p.run('tSupplyDetail({o1:true},"store")').indexOf('↳ Каркас') >= 0)
}

// ── 6. Старые объекты: портал предлагает, решает человек ────────────────────
// Объект, собранный до появления флага `own`, его не несёт, и вручную помечать
// полсотни строк никто не будет. Схлопывать автоматически нельзя: ошибка здесь
// прячет из закупки настоящий материал — отказ хуже исходного. Поэтому подсказка,
// а убранное остаётся на виду с возвратом одним тапом.
{
  t.section('Работа в старом объекте: подсказка и возврат')

  t.ok('признаки работы: нет карточки, одна штука, имя = имя работы',
    looksLikeLabour({ n: 'Монтаж пола', wn: 'Монтаж пола', qty: 1, cost: 5000 }))
  t.ok('товар под подсказку не попадает',
    !looksLikeLabour({ n: 'Брусок', wn: 'Каркас', qty: 20, cost: 229 }))
  t.ok('товар из каталога — тем более',
    !looksLikeLabour({ n: 'ОСП', wn: 'ОСП', qty: 1, pid: 'p_osb', cost: 900 }))
  t.ok('уже помеченное не предлагаем второй раз',
    !looksLikeLabour({ n: 'Монтаж пола', wn: 'Монтаж пола', qty: 1, own: true }))

  const p = boot()
  p.set({
    expProducts: [],
    objects: [
      { id: 'o1', name: 'Мордвес 1', icon: '🏠', stages: [
        { id: 's1', n: 'ЭТАП 1', c: '#e67e22', works: [
          { id: 'w1', n: 'Каркас', cost: 4580, mats: [{ id: 'm1', n: 'Брусок 50×50', cost: 229, qty: 20, store: 'Белка', mode: 'piece' }] },
          { id: 'w2', n: 'Монтаж чернового пола', cost: 5000, mats: [{ id: 'm2', n: 'Монтаж чернового пола', cost: 5000, qty: 1, mode: 'piece' }] },
        ] },
      ] },
    ],
    purchased: {}, arrived: {}, purchases: [],
    templates: [], contractDocs: [], users: [], finTxns: [], stock: [], issues: [],
  })
  p.run('window._supplySelected={o1:true};supplyHandoff={};supplyPickMode=false;supplyLabourOpen=false;')
  p.run('globalThis.confirm=function(){return true;};')

  const before = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('портал предлагает убрать', before.indexOf('Похоже на работы') >= 0, 'нет подсказки')
  t.ok('но сам не убирает', before.indexOf('Монтаж чернового пола') >= 0,
    'схлопнул без спроса — так нельзя')

  const go = p.dom.node({ a: 'supply-labour-all', ids: 'm2' })
  p.run('bind();'); go.onclick({ stopPropagation() {} })
  t.ok('после согласия флаг записан', p.q('objects[0].stages[0].works[1].mats[0].own') === true)
  t.ok('товар не задет', !p.q('objects[0].stages[0].works[0].mats[0].own'))

  const after = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('подсказка ушла', after.indexOf('Похоже на работы') < 0)
  t.ok('убранное осталось на виду', after.indexOf('Не покупаем — это работы') >= 0,
    'исчезнувший материал не отличить от потерянного')

  p.run('supplyLabourOpen=true;')
  const opened = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('в списке видно, к какой работе относилось', opened.indexOf('↳ Монтаж чернового пола') >= 0)
  const back = p.dom.node({ a: 'supply-labour-back', ids: 'm2' })
  p.run('bind();'); back.onclick({ stopPropagation() {} })
  t.ok('возврат одним тапом', !p.q('objects[0].stages[0].works[1].mats[0].own'))

  // Пилюля в строке — тот же механизм для одной позиции.
  const pill = p.dom.node({ a: 'supply-labour', ids: 'm1' })
  t.ok('пилюля «это работа» есть в строке', !!pill)
  p.run('bind();'); pill.onclick({ stopPropagation() {} })
  t.ok('и помечает свою позицию', p.q('objects[0].stages[0].works[0].mats[0].own') === true)
}


t.done()
