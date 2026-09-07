#!/usr/bin/env node
// Передача материалов заказчику: он закупает сам, мы даём объём и ссылку.
//
// Смысл шага: пометка «закупает заказчик» — это не «куплено». Такая позиция
// остаётся в списке (её надо передать), но уходит из НАШЕЙ закупки: из прогресса,
// из «осталось» и из подытога этапа. Иначе снабженец каждый день видит долг,
// который ему нечем закрыть, а процент готовности врёт про чужие покупки.
//
// Сторожим три вещи: постоянный признак живёт на материале и переживает
// перерисовку, деньги считаются по нашей половине, а в лист заказчику уходит
// ровно то, что показано на экране (постоянные плюс добранные разово).
import { clientBuys, handoffMats, handoffTotals, ourMats } from '../src/supply.js'
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

// Этап из трёх позиций: две наши, одну заказчик берёт на себя.
function seed(p) {
  const mat = (id, n, cost, qty, extra) => Object.assign(
    { id, n, cost, qty, store: 'Лемана', mode: 'piece', url: 'https://lemanapro.ru/' + id }, extra || {})
  p.set({
    expProducts: [],
    objects: [
      { id: 'o1', name: 'Мордвес 1', icon: '🏠', stages: [
        { id: 's1', n: 'ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЙ', c: '#e67e22', works: [
          { id: 'w1', n: 'Каркас', cost: 0, mats: [
            mat('m1', 'Брусок 50×50', 229, 20),          // наша
            mat('m2', 'Гвозди 30 мм', 500, 2),           // наша
            mat('m3', 'Плитка керамогранит', 1200, 30),  // заказчика
          ] },
        ] },
      ] },
    ],
    purchased: {}, arrived: {}, purchases: [],
    templates: [], contractDocs: [], users: [], finTxns: [], stock: [], issues: [],
  })
  p.run('window._supplySelected={o1:true};supplyHandoff={};supplyPickMode=false;')
}

const MATS = [
  { id: 'm1', cost: 229, qty: 20 },
  { id: 'm2', cost: 500, qty: 2 },
  { id: 'm3', cost: 1200, qty: 30, client: true },
]

// ── 1. Общий модуль ─────────────────────────────────────────────────────────
{
  t.section('Кто что закупает — считает общий модуль')
  t.ok('признак читается с материала', clientBuys(MATS[2]) && !clientBuys(MATS[0]))
  t.ok('наша половина без позиций заказчика', ourMats(MATS).map((m) => m.id).join(',') === 'm1,m2')

  const ho = handoffMats(MATS, {})
  t.ok('в передачу идёт помеченное', ho.length === 1 && ho[0].id === 'm3')
  t.ok('сумма считается ценой × количеством', handoffTotals(ho).sum === 1200 * 30,
    String(handoffTotals(ho).sum))

  // Разовый добор складывается с постоянным признаком, а не заменяет его.
  const both = handoffMats(MATS, { m1: true })
  t.ok('разовый добор прибавляется', both.map((m) => m.id).join(',') === 'm1,m3')
  t.ok('и попадает в сумму', handoffTotals(both).sum === 229 * 20 + 1200 * 30)
  t.ok('пустой список — пустой итог', handoffTotals([]).count === 0 && handoffTotals([]).sum === 0)
}

// ── 2. Деньги заказчика — не наш долг ───────────────────────────────────────
{
  t.section('Позиция заказчика уходит из нашей закупки')
  const p = boot(); seed(p)

  const before = p.run('tSupplyDetail({o1:true},"stage")')
  const all = 229 * 20 + 500 * 2 + 1200 * 30
  t.ok('пока не помечено — в закупке весь этап', before.indexOf(all.toLocaleString('ru-RU')) >= 0,
    'нет суммы ' + all)

  // Помечаем плитку как закупку заказчика — так же, как это делает тап по пилюле.
  const pill = p.dom.node({ a: 'supply-client', ids: 'm3' })
  t.ok('пилюля есть в строке', !!pill)
  p.run('bind();'); pill.onclick({ stopPropagation() {} })

  t.ok('признак записан в материал', p.q('objects[0].stages[0].works[0].mats[2].client') === true)
  const after = p.run('tSupplyDetail({o1:true},"stage")')
  const ours = 229 * 20 + 500 * 2
  t.ok('в «осталось» осталась только наша половина', after.indexOf(ours.toLocaleString('ru-RU')) >= 0,
    'нет нашей суммы ' + ours)
  t.ok('позиция заказчика из списка НЕ пропала', after.indexOf('Плитка керамогранит') >= 0,
    'строку заказчика надо видеть — её же передавать')
  t.ok('плашка показывает, сколько берёт заказчик',
    after.indexOf('👤 Закупает заказчик') >= 0 && after.indexOf((1200 * 30).toLocaleString('ru-RU')) >= 0)

  // Повторный тап снимает признак — решение обратимо.
  const pill2 = p.dom.node({ a: 'supply-client', ids: 'm3' })
  p.run('bind();'); pill2.onclick({ stopPropagation() {} })
  t.ok('признак снимается тем же тапом', !p.q('objects[0].stages[0].works[0].mats[2].client'))
}

// ── 3. Разовый добор ────────────────────────────────────────────────────────
{
  t.section('Разовый добор живёт на экране')
  const p = boot(); seed(p)
  const modeBtn = p.dom.node({ a: 'supply-pick-mode' })
  p.run('bind();'); modeBtn.onclick()
  t.ok('режим включился', p.q('supplyPickMode') === true)

  const html = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('строка в режиме выделения не отмечает «куплено»',
    html.indexOf('data-a="supply-pick" data-mid="m1"') >= 0, 'строка осталась на supply-check')

  const row = p.dom.node({ a: 'supply-pick', mid: 'm1' })
  p.run('bind();'); row.onclick()
  t.ok('позиция добрана', p.q('supplyHandoff.m1') === true)
  t.ok('и «куплено» при этом не поставилось', !p.q('purchased.m1'),
    'разовый выбор не должен трогать закупку')
  t.ok('в объект добор не записан', !p.q('objects[0].stages[0].works[0].mats[0].client'),
    'разовое решение не место в снимке')

  const withPick = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('плашка посчитала добор', withPick.indexOf('1 поз. · ' + (229 * 20).toLocaleString('ru-RU')) >= 0,
    'нет счётчика добора')

  const clr = p.dom.node({ a: 'supply-pick-clear' })
  p.run('bind();'); clr.onclick()
  t.ok('«снять разовые» очищает выбор', Object.keys(p.q('supplyHandoff') || {}).length === 0)
}

t.done()
