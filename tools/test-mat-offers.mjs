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
  p.run('matOfferAddNew(expProducts[0], { store:"Лемана ПРО", url:"https://lemanapro.ru/product/x/", unitCost:3836 });')

  const prod = p.q('expProducts[0]')
  t.ok('магазинов стало два', (prod.offers || []).length === 2, JSON.stringify(prod.offers))
  // Нынешняя цена не потерялась: она стала первым предложением, к ней можно вернуться.
  t.ok('прежний магазин сохранён',
    (prod.offers || []).some((o) => o.store === 'Яндекс Маркет' && o.unitCost === 3460),
    JSON.stringify(prod.offers))
  // Добавили — им и покупаем: цена товара стала ценой нового магазина.
  t.ok('активна цена нового магазина', prod.unitCost === 3836 && prod.store === 'Лемана ПРО',
    prod.store + ' ' + prod.unitCost)
  t.ok('и ссылка его же', /lemanapro/.test(prod.url), prod.url)
  // На экране видно оба и отмечен активный.
  const both = p.run('expEditorHtml(expProducts[0])')
  t.ok('оба магазина в карточке', /Лемана ПРО/.test(both) && /Яндекс Маркет/.test(both))
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
    'expProducts[0].offers=expProducts[0].offers.concat([{id:"o2",store:"Лемана ПРО",url:"https://lemanapro.ru/x/",unitCost:3836}]);')
  const first = p.q('expProducts[0].offers[0].id')
  p.run('matOfferPick(expProducts[0], "o2");')
  t.ok('выбрали Леману', p.q('expProducts[0].unitCost') === 3836 && p.q('expProducts[0].store') === 'Лемана ПРО')
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
  p.run('matOfferAddNew(expProducts[0], { store:"Лемана ПРО", url:"https://lemanapro.ru/x/", unitCost:3836 });')
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

// ── Наличие живёт у ПРЕДЛОЖЕНИЯ, а не у товара ─────────────────────────────
// Один и тот же кабель продают несколько продавцов — на Ozon это разные карточки.
// У одного он кончился, у второго лежит. Пометка «нет в наличии» на товаре целиком
// врёт: покупать есть где. Поэтому наличие — свойство предложения, а товар считается
// отсутствующим, только когда кончились ВСЕ.
{
  t.section('Кончился у одного продавца')
  const p = boot({})
  p.set({
    expProducts: [{ id: 'p1', emoji: '📦', name: 'Кабель ВВГ 3х1,5 100 м',
      store: 'Озон', url: 'https://www.ozon.ru/product/a/', mode: 'piece', unitCost: 5100, qty: 1 }],
    estimates: [], dbPlans: [], crmClients: [], specSheets: [], specSheets2: [], projects: [],
    buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [],
    issues: [], users: [], stock: [], settings: {},
  })
  // Второй продавец на том же Ozon — дороже, третий магазин — ещё дороже.
  p.run('matOfferAddNew(expProducts[0], { store:"Озон", seller:"Кабель-Опт", url:"https://www.ozon.ru/product/b/", unitCost:5350 });')
  p.run('matOfferAddNew(expProducts[0], { store:"Лемана ПРО", url:"https://lemanapro.ru/product/c/", unitCost:5600 });')
  p.run('matOfferPick(expProducts[0], expProducts[0].offers[0].id);')
  t.ok('три предложения', p.q('expProducts[0].offers.length') === 3)
  t.ok('продавец подписан', p.q('expProducts[0].offers[1].seller') === 'Кабель-Опт')

  // У первого продавца кончилось.
  const oid = p.q('expProducts[0].offers[0].id')
  p.run('matOfferOos(expProducts[0], ' + JSON.stringify(oid) + ');')
  t.ok('помечено предложение', !!p.q('expProducts[0].offers[0].oosAt'))
  t.ok('товар в целом НЕ отсутствует', !p.q('expProducts[0].oosAt'), 'товар помечен зря')
  // Активным должно стать доступное и самое дешёвое из оставшихся.
  t.ok('переключились на живого продавца', p.q('expProducts[0].offer') === p.q('expProducts[0].offers[1].id'))
  t.ok('цена карточки поехала за ним', p.q('expProducts[0].unitCost') === 5350, 'цена: ' + p.q('expProducts[0].unitCost'))
  t.ok('и ссылка тоже', /product\/b\//.test(p.q('expProducts[0].url')))

  // Кончилось у всех — вот теперь товара нет.
  p.run('matOfferOos(expProducts[0], expProducts[0].offers[1].id);')
  p.run('matOfferOos(expProducts[0], expProducts[0].offers[2].id);')
  t.ok('товар отсутствует, когда кончился у всех', !!p.q('expProducts[0].oosAt'))
  // Цену не теряем: смета не должна дешеветь из-за отсутствия на складе.
  t.ok('цена сохранилась', p.q('expProducts[0].unitCost') > 0)

  // Завоз: снимаем пометку у одного — товар снова есть.
  p.run('matOfferOos(expProducts[0], expProducts[0].offers[0].id);')
  t.ok('вернулся — пометка товара снята', !p.q('expProducts[0].oosAt'))
  t.ok('активным стал вернувшийся', p.q('expProducts[0].offer') === p.q('expProducts[0].offers[0].id'))
  t.ok('цена вернулась к его цене', p.q('expProducts[0].unitCost') === 5100)
}

// ── Цена правится у того продавца, у кого смотрели ─────────────────────────
{
  t.section('Новая цена — конкретному продавцу')
  const p = boot({})
  p.set({
    expProducts: [{ id: 'p1', emoji: '📦', name: 'Кабель ВВГ 3х1,5 100 м',
      store: 'Озон', url: 'https://www.ozon.ru/product/a/', mode: 'piece', unitCost: 5100, qty: 1 }],
    estimates: [], dbPlans: [], crmClients: [], specSheets: [], specSheets2: [], projects: [],
    buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [],
    issues: [], users: [], stock: [], settings: {},
  })
  p.run('matOfferAddNew(expProducts[0], { store:"Озон", seller:"Кабель-Опт", url:"https://www.ozon.ru/product/b/", unitCost:5350 });')
  p.run('matOfferPick(expProducts[0], expProducts[0].offers[0].id);')   // активен первый, 5100
  const second = p.q('expProducts[0].offers[1].id')

  const inp = p.dom.node({ a: 'price-shop-set', p: 'p1', o: second })
  p.run('bind();'); inp.value = '4900'; inp.onchange()
  t.ok('цена ушла второму продавцу', p.q('expProducts[0].offers[1].unitCost') === 4900)
  t.ok('первый не изменился', p.q('expProducts[0].offers[0].unitCost') === 5100)
  // Подешевел настолько, что стал выгоднее активного — портал переходит на него:
  // держать дорогую карточку активной, когда рядом дешевле, незачем.
  t.ok('активным стал выгодный', p.q('expProducts[0].offer') === second)
  t.ok('карточка показывает его цену', p.q('expProducts[0].unitCost') === 4900)
  t.ok('и его ссылку', /product\/b\//.test(p.q('expProducts[0].url')))
  t.ok('история записана', (p.q('expProducts[0].hist')||[]).length > 0)
}

// ── Опт — это предложение со своей упаковкой ───────────────────────────────
// Тот же герметик Озон продаёт штукой и упаковкой по 20. Две карточки на один
// товар — две правды (см. выше), поэтому опт — ещё одно предложение той же
// карточки: ценник упаковки делится на `per`, в смету идёт цена за штуку, а в
// «где купить» видно, что это опт и сколько стоит вся упаковка.
{
  t.section('Опт упаковкой — в той же карточке')
  const p = boot({})
  p.set({
    expProducts: [{ id: 'p1', emoji: '📦', name: 'Герметик полиуретановый 780 г',
      store: 'Озон', url: 'https://www.ozon.ru/product/638233495/', mode: 'piece', unitCost: 520, qty: 1 }],
    estimates: [], dbPlans: [], crmClients: [], specSheets: [], specSheets2: [], projects: [],
    buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [],
    issues: [], users: [], stock: [], settings: {},
  })
  p.run('tab="db";dbTab="exp";expOpenId="p1";')
  p.run('matOfferAddShelf(expProducts[0], { store:"Озон", url:"https://www.ozon.ru/product/679829577/", price:7354, per:20 });')
  const prod = p.q('expProducts[0]')
  const opt = (prod.offers || [])[1] || {}
  t.ok('опт стал вторым предложением той же карточки', (prod.offers || []).length === 2, JSON.stringify(prod.offers))
  t.ok('упаковка запомнена у предложения', opt.per === 20, JSON.stringify(opt))
  t.ok('цена за штуку — ценник, делённый на упаковку', opt.unitCost === 367.7, String(opt.unitCost))
  t.ok('розница осталась со своей ценой', prod.offers[0].unitCost === 520 && !prod.offers[0].per, JSON.stringify(prod.offers[0]))
  t.ok('в смету идёт цена за штуку', prod.unitCost === 367.7, String(prod.unitCost))

  const card = p.run('expEditorHtml(expProducts[0])')
  const where = card.slice(card.indexOf('ГДЕ КУПИТЬ'), card.indexOf('ГДЕ КУПИТЬ') + 2500)
  t.ok('в «где купить» опт подписан', /опт ×20/.test(where), where.replace(/<[^>]*>/g, ' ').slice(0, 400))
  t.ok('и видна цена всей упаковки', /7[\s  ]354 ₽/.test(where))
  t.ok('розница без пометки опта', (where.match(/опт ×/g) || []).length === 1)
  // Сверка цен делит ценник упаковки тем же `per` — цена упаковки не уезжает в цену штуки.
  t.ok('сверка делит ценник упаковки', p.q('priceToOurUnit(expProducts[0], 7354, expProducts[0].offers[1])') === 367.7)

  // Форма «＋ магазин» спрашивает, сколько штук в покупке.
  p.run('matOfferAdd="p1";')
  t.ok('в форме магазина есть «шт в покупке»', p.run('expEditorHtml(expProducts[0])').indexOf('id="mof-per"') >= 0)

  // Упаковку не указали — обычная покупка поштучно.
  p.run('matOfferAddShelf(expProducts[0], { store:"Лемана ПРО", url:"https://lemanapro.ru/product/x/", price:610 });')
  const third = p.q('expProducts[0].offers[2]')
  t.ok('без упаковки — цена как на ценнике и без per', third.unitCost === 610 && !third.per, JSON.stringify(third))
}

t.done()
