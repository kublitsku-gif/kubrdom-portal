#!/usr/bin/env node
// Каталог изделий поставщика (src/model.js).
//
// Каталог обещает три вещи: размер, цену и раскладку створок. Раскладка — это
// картинка, которую видит продавец, и разойтись с изделием она не имеет права:
// глухая половина слева отличает окно от соседнего в списке вернее имени.
//
// Поэтому здесь сторожим то, что ломается тихо: сумма створок равна габариту
// (иначе рисование молча дотянет последнюю, и картинка покажет не то изделие),
// ключи уникальны (по ключу заводят изделие в справочник), а `winTypeFrom` отдаёт
// КОПИЮ — правка каталога не должна переписывать проданное.
import { WIN_CATALOG, winCatItem, winFace, winTypeFrom, INNER_DOOR } from '../src/model.js'
import { reporter } from './harness/panel-vm.js'

const t = reporter()

// ── 1. Раскладка сходится с габаритом ────────────────────────────────────────
{
  t.section('Раскладка равна изделию')
  WIN_CATALOG.forEach(function (it) {
    // Считаем по ЗАДАННЫМ числам, а не по тому, что вернул winFace: он последнюю
    // створку дотягивает до края, и опечатку в 100 мм так не поймать.
    const rows = it.face || []
    const hSet = rows.filter(function (r) { return r.h != null })
    const hSum = hSet.reduce(function (a, r) { return a + r.h }, 0)
    t.ok(it.k + ': ряды не выше изделия', hSum < it.h || rows.length === 1, hSum + ' / ' + it.h)
    rows.forEach(function (r, i) {
      const cells = r.cells || []
      const set = cells.filter(function (c) { return c.w != null })
      if (!set.length) return
      const sum = set.reduce(function (a, c) { return a + c.w }, 0)
      const full = (set.length === cells.length)
      t.ok(it.k + ': ряд ' + (i + 1) + ' — створки складываются в ширину',
        full ? sum === it.w : sum < it.w, sum + ' / ' + it.w)
    })
    // И то же самое после раскладки: картинка обязана закрывать изделие целиком.
    const f = winFace(it)
    t.ok(it.k + ': ряды закрывают высоту',
      f.rows.reduce(function (a, r) { return a + r.h }, 0) === it.h)
    f.rows.forEach(function (r, i) {
      t.ok(it.k + ': ряд ' + (i + 1) + ' закрывает ширину',
        r.cells.reduce(function (a, c) { return a + c.w }, 0) === it.w)
    })
  })
}

// ── 2. Изделия те самые, что в спецификации поставщика ───────────────────────
// Цена в каталоге за ОДНО изделие: в спецификации ZZ/204764 строка окна 500×500
// стоит на две штуки, и переписать её оттуда как есть значило бы удвоить смету.
{
  t.section('Спецификация ZZ/204764')
  const by = function (k) { return winCatItem(k) }
  t.ok('окно 1300×1150 — 14 555 ₽', by('os-1300x1150').cost === 14555)
  t.ok('окно 1500×1200 — 16 307 ₽', by('os-1500x1200').cost === 16307)
  // Двухчастное окно: в спецификации строка на две штуки, в каталоге — за одну.
  const two = by('os-1000x2100')
  t.ok('окно 1000×2100 — цена за штуку', two.cost === 17819, String(two.cost))
  t.ok('сверху створка, снизу глухая',
    two.face[0].cells[0].o === 'po' && two.face[0].h === 1050 && two.face[1].cells[0].o === undefined)
  t.ok('окно 500×500 — цена за штуку', by('os-500x500').cost === 6576)
  t.ok('витраж 2160×2390 — 22 282 ₽', by('os-2160x2390').cost === 22282)
  t.ok('входная дверь — 27 150 ₽', by('os-vd-1000x2100').cost === 27150)
  // Полотно межкомнатной двери — не от этого поставщика: цену ставит человек, а
  // выдуманная цена в смете хуже пустой.
  const inner = by('inner-600x2050')
  t.ok('межкомнатное полотно без цены', inner.cost === 0)
  t.ok('и того же размера, что в заготовках', inner.w === INNER_DOOR.w && inner.h === INNER_DOOR.h)

  t.ok('ключи уникальны',
    new Set(WIN_CATALOG.map(function (x) { return x.k })).size === WIN_CATALOG.length)
  t.ok('вид у каждого известен',
    WIN_CATALOG.every(function (x) { return x.kind === 'win' || x.kind === 'door' }))
  t.ok('окна и двери есть и там, и там',
    WIN_CATALOG.some(function (x) { return x.kind === 'win' }) &&
    WIN_CATALOG.filter(function (x) { return x.kind === 'door' }).length === 2)
}

// ── 3. Глухая створка не рисует открывание ───────────────────────────────────
{
  t.section('Створки')
  const w1 = winFace(winCatItem('os-1300x1150'))
  t.ok('слева глухая', w1.rows[0].cells[0].o === '')
  t.ok('справа поворотно-откидная на левых петлях',
    w1.rows[0].cells[1].o === 'po' && w1.rows[0].cells[1].hg === 'l')
  const v = winFace(winCatItem('os-2160x2390'))
  t.ok('витраж глухой весь', v.rows.every(function (r) {
    return r.cells.every(function (c) { return c.o === '' })
  }))
  t.ok('и у него фрамуга сверху', v.rows.length === 2 && v.rows[0].h === 500)

  // Изделие, заведённое руками, раскладки не знает — рисуем одну створку по виду.
  const hand = winFace({ kind: 'win', w: 900, h: 1400 })
  t.ok('своё окно — одна поворотно-откидная створка во всё изделие',
    hand.rows.length === 1 && hand.rows[0].cells.length === 1 &&
    hand.rows[0].cells[0].o === 'po' && hand.rows[0].cells[0].w === 900)
  const hd = winFace({ kind: 'door', w: 900, h: 2100 })
  t.ok('своя дверь — поворотная', hd.rows[0].cells[0].o === 'p')
  t.ok('пустое изделие ничего не рисует', winFace({}).w === 0)
}

// ── 4. В справочник портала уезжает КОПИЯ ────────────────────────────────────
// Каталог поставщика правят, а проданный дом обязан остаться таким, как продали:
// цена в объекте — согласованный бюджет, а не витрина.
{
  t.section('Копия, а не ссылка')
  const it = winCatItem('os-1300x1150')
  const t1 = winTypeFrom(it, 'wt1')
  t.ok('размер и цена приехали', t1.w === 1300 && t1.h === 1150 && t1.cost === 14555)
  t.ok('вид приехал', t1.kind === 'win')
  t.ok('и откуда пришло — помним', t1.cat === 'os-1300x1150')
  t.ok('id свой', t1.id === 'wt1')

  t1.cost = 1
  t1.n = 'Другое имя'
  t1.face[0].cells[0].o = 'po'
  t.ok('правка справочника каталог не трогает', it.cost === 14555 && it.n !== 'Другое имя')
  t.ok('и раскладку тоже не трогает', it.face[0].cells[0].o === undefined,
    JSON.stringify(it.face[0].cells[0]))

  const unknown = winCatItem('нет такого')
  t.ok('незнакомый ключ — не находка, а null', unknown === null)
}

t.done()
