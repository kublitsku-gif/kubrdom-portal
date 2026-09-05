#!/usr/bin/env node
// Один товар — несколько магазинов (public/admin.js).
//
// Тот же стеллаж лежит и в Лемане, и на Маркете, и цены у них разные. Две карточки
// на один товар — две правды: в смете он окажется дважды, а при обновлении цены
// разъедется. Поэтому карточка одна, магазины — её предложения, а ВЫБРАННОЕ
// зеркалится в поля товара: по ним считают смета, объекты и снабжение, и учить
// каждое из них про предложения значило бы переписать полпортала.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

function panel() {
  const p = boot({})
  p.set({
    expProducts: [{ id: 'p1', emoji: '📦', name: 'Стеллаж металлический 5 полок',
      store: 'Яндекс Маркет', url: 'https://market.yandex.ru/card/x', mode: 'piece', unitCost: 3460, qty: 1 }],
    estimates: [], dbPlans: [], crmClients: [], specSheets: [], specSheets2: [], projects: [],
    buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [],
    issues: [], users: [], stock: [], settings: {},
  })
  p.run('tab="db";dbTab="exp";expOpenId="p1";')
  return p
}

// ── 1. Первое предложение заводится из того, что уже в карточке ──────────────
{
  t.section('Второй магазин')
  const p = panel()
  const card = p.run('expEditorHtml(expProducts[0])')
  t.ok('в карточке есть «где купить»', /ГДЕ КУПИТЬ/.test(card))
  t.ok('и кнопка «＋ магазин»', card.indexOf('data-mat-offer-add') >= 0)

  // Добавляем Леману: 3 836 ₽.
  p.run('matOfferAddNew(expProducts[0], { store:"Лемана", url:"https://lemanapro.ru/product/x/", unitCost:3836 });')

  const prod = p.q('expProducts[0]')
  t.ok('магазинов стало два', (prod.offers || []).length === 2, JSON.stringify(prod.offers))
  // Нынешняя цена не потерялась: она стала первым предложением, к ней можно вернуться.
  t.ok('прежний магазин сохранён',
    (prod.offers || []).some((o) => o.store === 'Яндекс Маркет' && o.unitCost === 3460),
    JSON.stringify(prod.offers))
  // Добавили — им и покупаем: цена товара стала ценой нового магазина.
  t.ok('активна цена нового магазина', prod.unitCost === 3836 && prod.store === 'Лемана',
    prod.store + ' ' + prod.unitCost)
  t.ok('и ссылка его же', /lemanapro/.test(prod.url), prod.url)
  // На экране видно оба и отмечен активный.
  const both = p.run('expEditorHtml(expProducts[0])')
  t.ok('оба магазина в карточке', /Лемана/.test(both) && /Яндекс Маркет/.test(both))
  // Пробел в цене — узкий неразрывный из toLocaleString, поэтому ищем по цифрам.
  t.ok('и цены обоих', /3.836/.test(both) && /3.460/.test(both), 'нет цен')
}

// ── 2. Выбор магазина меняет цену товара ─────────────────────────────────────
// По этой цене считают сметы: если бы выбор жил отдельным полем, смета осталась
// бы на старом магазине, а карточка показывала новый.
{
  t.section('Переключение магазина')
  const p = panel()
  p.run('matOfferSeed(expProducts[0]);' +
    'expProducts[0].offers=expProducts[0].offers.concat([{id:"o2",store:"Лемана",url:"https://lemanapro.ru/x/",unitCost:3836}]);')
  const first = p.q('expProducts[0].offers[0].id')
  p.run('matOfferPick(expProducts[0], "o2");')
  t.ok('выбрали Леману', p.q('expProducts[0].unitCost') === 3836 && p.q('expProducts[0].store') === 'Лемана')
  p.run('matOfferPick(expProducts[0], ' + JSON.stringify(first) + ');')
  t.ok('вернулись на Маркет', p.q('expProducts[0].unitCost') === 3460 && p.q('expProducts[0].store') === 'Яндекс Маркет')
  t.ok('и ссылка вернулась', /market\.yandex/.test(p.q('expProducts[0].url')))

  // Убрать можно любой, кроме последнего: без магазина товар негде купить.
  p.run('(function(){var el=document.getElementById("' + 'x' + '");})();')
  p.run('expProducts[0].offers=[expProducts[0].offers[0]];')
  const one = p.run('expEditorHtml(expProducts[0])')
  t.ok('у единственного магазина нет крестика', one.indexOf('data-mat-offer-del') < 0)
}

// ── 3. Убрать магазин ────────────────────────────────────────────────────────
// Последний не убираем: товар без магазина негде купить, а цена в карточке
// останется от него же — получится предложение-призрак.
{
  t.section('Убрать магазин')
  const p = panel()
  p.run('matOfferAddNew(expProducts[0], { store:"Лемана", url:"https://lemanapro.ru/x/", unitCost:3836 });')
  const first = p.q('expProducts[0].offers[0].id')
  const second = p.q('expProducts[0].offers[1].id')
  t.ok('активен второй', p.q('expProducts[0].offer') === second)
  p.run('matOfferDrop(expProducts[0], ' + JSON.stringify(second) + ');')
  t.ok('магазин убран', p.q('expProducts[0].offers').length === 1)
  // Активный ушёл — встаём на оставшийся, и цена товара идёт за ним.
  t.ok('цена вернулась к оставшемуся',
    p.q('expProducts[0].unitCost') === 3460 && p.q('expProducts[0].store') === 'Яндекс Маркет',
    p.q('expProducts[0].store') + ' ' + p.q('expProducts[0].unitCost'))
  t.ok('последний магазин убрать нельзя',
    p.q('matOfferDrop(expProducts[0], ' + JSON.stringify(first) + ')') === false)
  t.ok('и он остался', p.q('expProducts[0].offers').length === 1)
}

t.done()
