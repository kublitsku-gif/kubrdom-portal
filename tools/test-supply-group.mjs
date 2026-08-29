#!/usr/bin/env node
// Смоук-тест групповой правки материала в снабжении (public/admin.js).
//
//   npm run test:supply
//
// Проверяет то, что руками в браузере проверяется долго и на боевых данных:
// объединённая строка закупки отдаёт все свои id, правка расходится по всем
// потребностям, замена товара снимает отметки закупки и НЕ стирает деньги партии.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

// Два объекта, один и тот же материал в трёх работах — ровно тот случай,
// ради которого правка стала групповой.
function seed(panel) {
  const mat = (id, qty) => ({ id, pid: 'p_osb', n: 'ОСП 30 м²', cost: 710, qty, store: 'Белка', mode: 'piece', sheetM2: 3.12 })
  panel.set({
    expProducts: [
      { id: 'p_osb', name: 'ОСП 30 м²', unitCost: 710, store: 'Белка', mode: 'piece', sheetM2: 3.12 },
      { id: 'p_gvl', name: 'ГВЛВ 10 мм', unitCost: 900, store: 'Лемана', mode: 'piece', url: 'https://lemana/gvl' },
    ],
    objects: [
      { id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [
        { id: 's1', n: 'ЭТАП 2', c: '#2980b9', works: [
          { id: 'w1', n: 'Обрешётка', cost: 710 * 25, mats: [mat('m1', 25)] },
          { id: 'w2', n: 'Потолок', cost: 710 * 15, mats: [mat('m2', 15)] },
        ] },
      ] },
      { id: 'o2', name: 'Дом на Дмитровке', icon: '🏠', stages: [
        { id: 's2', n: 'ЭТАП 2', c: '#2980b9', works: [
          { id: 'w3', n: 'Пол', cost: 710 * 10, mats: [mat('m3', 10)] },
        ] },
      ] },
    ],
    purchased: { m1: true },
    arrived: {},
    purchases: [{ id: 'b1', date: '2026-08-20', store: 'Белка', objId: 'o1', items: [
      { id: 'pi_m1', needId: 'm1', name: 'ОСП 30 м²', qty: 25, price: 710, gotQty: 0 },
    ] }],
    templates: [], contractDocs: [], users: [], finTxns: [],
  })
}

// ── 1. Слитая строка отдаёт все свои id и кнопку правки ──────────────────────
{
  t.section('Объединённая строка закупки')
  const p = boot(); seed(p)
  const html = p.run('tSupplyDetail({o1:true,o2:true},"merge")')
  t.ok('три потребности слиты в одну строку', html.includes('📦 3 позиций → 1'))
  t.ok('кнопка «изм.» есть и на слитой строке', html.includes('data-a="supply-edit-mat" data-mid="m1" data-ids="m1,m2,m3"'),
    'раньше кнопку показывали только при ids.length===1')
  t.ok('на кнопке видно, скольких позиций коснётся правка', html.includes('✏️ изм. (3)'))
}

// ── 2. Модалка групповой правки ──────────────────────────────────────────────
{
  t.section('Модалка групповой правки')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1","m2","m3"];supplyEditMid="m1";')
  const html = p.run('tSupplyDetail({o1:true,o2:true},"merge")')
  t.ok('заголовок называет число позиций', html.includes('✏️ Материал · 3 позиций'))
  t.ok('перечислены все работы, куда уедет правка', html.includes('Обрешётка') && html.includes('Потолок') && html.includes('Пол'))
  t.ok('у каждой потребности своё поле количества', ['m1', 'm2', 'm3'].every((id) => html.includes('id="sem-q-' + id + '"')))
  t.ok('сумма количеств показана вместо общего поля', html.includes('Σ 50') && !html.includes('id="sem-qty"'))
  t.ok('предупреждение об отмеченной закупке', html.includes('По 1 поз. уже отмечена закупка'))
}

// ── 3. Замена товара во всей группе ──────────────────────────────────────────
{
  t.section('Замена товара во всей группе')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1","m2","m3"];supplyEditMid="m1";')
  p.dom.field('sem-n', 'ГВЛВ 10 мм')
  p.dom.field('sem-mode', 'piece')
  p.dom.field('sem-cost', '900')
  p.dom.field('sem-store', 'Лемана')
  p.dom.field('sem-note', 'замена по проекту')
  p.dom.field('sem-q-m1', '30'); p.dom.field('sem-q-m2', '15'); p.dom.field('sem-q-m3', '10')
  const btn = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  if (typeof btn.onclick !== 'function') t.ok('обработчик привязался', false)
  else btn.onclick()

  const m1 = p.mat('m1'), m2 = p.mat('m2'), m3 = p.mat('m3')
  t.ok('товар сменился во всех трёх работах', [m1, m2, m3].every((m) => m && m.n === 'ГВЛВ 10 мм'),
    JSON.stringify([m1 && m1.n, m2 && m2.n, m3 && m3.n]))
  t.ok('ссылка на карточку каталога переехала на новый товар', [m1, m2, m3].every((m) => m.pid === 'p_gvl'))
  t.ok('цена и магазин разошлись по всем', [m1, m2, m3].every((m) => m.cost === 900 && m.store === 'Лемана'))
  t.ok('количество у каждой своё', m1.qty === 30 && m2.qty === 15 && m3.qty === 10, JSON.stringify([m1.qty, m2.qty, m3.qty]))
  t.ok('фасовка предшественника снята', [m1, m2, m3].every((m) => m.sheetM2 == null))
  t.ok('ссылка нового товара подтянулась', [m1, m2, m3].every((m) => m.url === 'https://lemana/gvl'))
  t.ok('стоимость работ пересчитана', p.q('objects[0].stages[0].works[0].cost') === 900 * 30
    && p.q('objects[1].stages[0].works[0].cost') === 900 * 10, String(p.q('objects[0].stages[0].works[0].cost')))
  t.ok('отметка «куплено» снята — это уже другой товар', !p.q('purchased').m1)
  const items = p.q('purchases')[0].items
  t.ok('позиция партии отвязана, а не удалена', items.length === 1 && items[0].needId === null)
  t.ok('деньги партии на месте', p.q('batchSum(purchases[0])') === 25 * 710)
  t.ok('статус потребности обнулился', p.q('matStatus(supplyFindMat("m1"))').bought === 0)
}

// ── 4. Правка без смены товара отметки не трогает ────────────────────────────
{
  t.section('Правка без смены товара')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1","m2","m3"];supplyEditMid="m1";')
  p.dom.field('sem-n', 'ОСП 30 м²')       // имя то же
  p.dom.field('sem-mode', 'piece')
  p.dom.field('sem-cost', '750')          // подорожало
  p.dom.field('sem-store', 'Белка')
  p.dom.field('sem-note', '')
  p.dom.field('sem-q-m1', '25'); p.dom.field('sem-q-m2', '15'); p.dom.field('sem-q-m3', '10')
  const btn = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  btn.onclick()
  t.ok('новая цена во всех трёх', ['m1', 'm2', 'm3'].every((id) => p.mat(id).cost === 750))
  t.ok('отметка «куплено» сохранилась', p.q('purchased').m1 === true, 'смена цены — не замена товара')
  t.ok('позиция партии осталась привязанной', p.q('purchases')[0].items[0].needId === 'm1')
  t.ok('фасовка своя не потерялась', p.mat('m1').sheetM2 === 3.12)
}

// ── 5. Групповое удаление ────────────────────────────────────────────────────
{
  t.section('Групповое удаление')
  const p = boot(); seed(p)
  const btn = p.dom.node({ a: 'supply-mat-del', mid: 'm1', ids: 'm1,m2,m3' })
  p.run('bind();')
  btn.onclick()
  t.ok('все три потребности удалены', ['m1', 'm2', 'm3'].every((id) => p.mat(id) === null))
  t.ok('стоимость работ обнулилась', p.q('objects[0].stages[0].works[0].cost') === 0)
  t.ok('отметка закупки вычищена', !p.q('purchased').m1)
  t.ok('деньги партии остались', p.q('batchSum(purchases[0])') === 25 * 710)
}

// ── 6. Одиночная правка (кнопка в обычной строке) ────────────────────────────
{
  t.section('Одиночная правка')
  const p = boot(); seed(p)
  const open = p.dom.node({ a: 'supply-edit-mat', mid: 'm2' })   // data-ids нет — как в matRow
  p.run('bind();')
  open.onclick({ stopPropagation() {} })
  t.ok('групповой режим не включился', p.q('supplyEditIds').length === 0 && p.q('supplyEditMid') === 'm2')
  const html = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('поле количества одно', html.includes('id="sem-qty"') && !html.includes('id="sem-q-m2"'))

  p.dom.field('sem-n', 'ОСП 30 м²'); p.dom.field('sem-mode', 'piece'); p.dom.field('sem-cost', '710')
  p.dom.field('sem-store', 'Белка'); p.dom.field('sem-note', ''); p.dom.field('sem-qty', '18')
  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  t.ok('количество записалось только в свою позицию', p.mat('m2').qty === 18 && p.mat('m1').qty === 25)
}

t.done()
