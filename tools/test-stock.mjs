#!/usr/bin/env node
// Склад остатков между объектами (public/admin.js).
//
// Излишки закрытого объекта раньше выпадали из учёта и покупались заново. Проверяем
// то, на чём такая механика обычно и ломается: деньги не должны посчитаться дважды,
// а «взять со склада» не должно вывозить на объект больше, чем ему нужно.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

// Один объект уже отстроен с перекупом, второй только начинается и просит то же самое.
function panel() {
  const p = boot()
  const mat = (id, qty, extra = {}) => ({ id, pid: 'p_osb', n: 'ОСП 30 м²', cost: 710, qty, store: 'Белка', mode: 'piece', ...extra })
  p.set({
    expProducts: [{ id: 'p_osb', name: 'ОСП 30 м²', unitCost: 710, store: 'Белка', mode: 'piece' }],
    objects: [
      { id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [{ id: 's1', n: 'ЭТАП 2', works: [
        { id: 'w1', n: 'Пол', cost: 710 * 20, mats: [mat('m1', 20)] },
      ] }] },
      { id: 'o2', name: 'Дом на Дмитровке', icon: '🏠', stages: [{ id: 's2', n: 'ЭТАП 2', works: [
        { id: 'w2', n: 'Стены', cost: 710 * 12, mats: [mat('m2', 12)] },
      ] }] },
    ],
    // На первом объекте купили 26 листов при потребности 20 — шесть в остатке.
    purchases: [{ id: 'b1', date: '2026-09-01', store: 'Белка', objId: 'o1', items: [
      { id: 'pi1', needId: 'm1', name: 'ОСП 30 м²', qty: 26, price: 710, gotQty: 26 },
    ] }],
    stock: [], purchased: {}, arrived: {}, templates: [], contractDocs: [], issues: [], users: [], finTxns: [],
  })
  p.run('currentUser={id:"u1",name:"Снабженец",roles:["supply"],objs:[],c:"#000",av:"📦"};')
  return p
}

// ── 1. Что вообще считается остатком ─────────────────────────────────────────
{
  t.section('Излишек закупки')
  const p = panel()
  const cand = p.q('objStockCandidates(objects[0]).map(x=>({n:x.m.n,qty:x.qty}))')
  t.ok('перекуп найден и посчитан', cand.length === 1 && cand[0].qty === 6, JSON.stringify(cand))
  const none = p.q('objStockCandidates(objects[1]).length')
  t.ok('там, где не покупали, излишков нет', none === 0, String(none))
}

// ── 2. Оприходование ─────────────────────────────────────────────────────────
{
  t.section('Оприходование на склад')
  const p = panel()
  p.run('objStockCandidates(objects[0]).forEach(x=>stockAdd(x.m,x.qty,objects[0]));')
  const st = p.q('stock')
  t.ok('строка одна', st.length === 1, JSON.stringify(st))
  t.ok('количество — только излишек', st[0].qty === 6, String(st[0].qty))
  t.ok('запомнили, откуда', st[0].srcObjName === 'Баня на Киевке' && st[0].pid === 'p_osb')
  p.run('stockAdd(objects[0].stages[0].works[0].mats[0],4,objects[0]);')
  const st2 = p.q('stock')
  t.ok('такой же материал складывается в ту же строку', st2.length === 1 && st2[0].qty === 10,
    JSON.stringify(st2) + ' — десять записей по два листа это не склад, а лента событий')
}

// ── 3. Взять со склада под потребность ───────────────────────────────────────
{
  t.section('Выдача со склада')
  const p = panel()
  p.run('stockAdd(objects[0].stages[0].works[0].mats[0],6,objects[0]);')
  t.ok('видно, сколько закроет потребность', p.q('stockAvailableFor(["m2"])') === 6, String(p.q('stockAvailableFor(["m2"])')))

  const taken = p.q('stockCoverNeeds(["m2"])')
  t.ok('взяли столько, сколько было', taken === 6, String(taken))
  t.ok('склад опустел', p.q('stock').length === 0, JSON.stringify(p.q('stock')))

  const st = p.q('matStatus(supplyFindMat("m2"))')
  t.ok('потребность закрыта на 6 из 12', st.bought === 6 && st.want === 12, JSON.stringify(st))
  t.ok('приёмку не подделали — материал ещё надо довезти', st.got === 0, JSON.stringify(st))

  const batch = p.q('purchases.find(x=>x.fromStock)')
  t.ok('партия помечена складской', !!batch && batch.fromStock === true, JSON.stringify(batch))
  t.ok('цена перенесена из остатка', batch.items[0].price === 710 && batch.items[0].qty === 6)
  t.ok('партия привязана к объекту-получателю', batch.objId === 'o2', batch.objId)
}

// ── 4. Не вывозим лишнее ─────────────────────────────────────────────────────
{
  t.section('Берём не больше нужного')
  const p = panel()
  p.run('stockAdd(objects[0].stages[0].works[0].mats[0],100,objects[0]);')
  const taken = p.q('stockCoverNeeds(["m2"])')
  t.ok('взяли ровно потребность, а не весь склад', taken === 12, String(taken))
  t.ok('остальное осталось лежать', p.q('stock')[0].qty === 88, String(p.q('stock')[0].qty))

  const again = p.q('stockCoverNeeds(["m2"])')
  t.ok('повторный вызов ничего не берёт — потребность закрыта', again === 0, String(again))
  t.ok('плашка «на складе» пропала', p.q('stockAvailableFor(["m2"])') === 0)
}

// ── 5. Деньги не считаются дважды ────────────────────────────────────────────
{
  t.section('Двойного расхода нет')
  const p = panel()
  p.run('stockAdd(objects[0].stages[0].works[0].mats[0],6,objects[0]);stockCoverNeeds(["m2"]);')
  const notPosted = p.q('purchases.filter(x=>!x.txnId&&!x.fromStock).length')
  t.ok('складская партия не висит в «не проведено по кассе»', notPosted === 1,
    'иначе финансист вечно видит долг, который закрывать нечем')
  const head = p.run('tBatches()')
  // В наборе две партии: обычная (её «не проведено» законно) и складская.
  t.ok('в списке партий складская помечена складской, а не «не проведена»',
    head.includes('со склада') && (head.match(/не проведено/g) || []).length === 1,
    'иначе заголовок вводит финансиста в заблуждение')
  p.run('window._batchOpen=purchases.find(x=>x.fromStock).id;')
  const open = p.run('tBatches()')
  t.ok('внутри объяснено, почему по кассе не проводим', open.includes('деньги за этот материал потрачены на прошлом объекте'))
}

// ── 6. Чужой материал со склада не берём ─────────────────────────────────────
{
  t.section('Сопоставление по каталогу')
  const p = panel()
  p.run('stock=[{id:"e1",pid:"p_gvl",n:"ГВЛВ 10 мм",mode:"piece",cost:900,qty:50}];')
  t.ok('другой товар потребность не закрывает', p.q('stockAvailableFor(["m2"])') === 0,
    'сопоставляем по ссылке на каталог, а не по тому, что «тоже листы»')
  p.run('stock=[{id:"e2",n:"ОСП 30 м²",mode:"piece",cost:710,qty:5}];')
  t.ok('историческая строка без pid ловится по имени', p.q('stockAvailableFor(["m2"])') === 5)
}

t.done()
