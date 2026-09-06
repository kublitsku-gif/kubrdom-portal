#!/usr/bin/env node
// Сверка цен этапа ПО МАГАЗИНАМ (public/admin.js).
//
// Сверка с каталогом отвечает на вопрос «строка отстала от карточки?». Но цена
// в самой карточке — вчерашняя: магазин мог поднять ценник или товар кончился.
// Узнать это можно только сходив по ссылке, а магазины (Ozon, Лемана) роботов
// не пускают — 401 и редирект на антибот. Поэтому ходит человек, а портал берёт
// на себя всё остальное: собрать список ссылок этапа, принять новую цену,
// записать историю и пересчитать проект.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_kab', name: 'Кабель ВВГ 3х1,5 100 м', unitCost: 5100, store: 'Озон',
    url: 'https://www.ozon.ru/product/kabel-1/', mode: 'piece' },
  { id: 'p_br', name: 'Брусок строганый 40x50x3000', unitCost: 107.67, store: 'Лемана',
    url: 'https://lemanapro.ru/product/brusok-2/', mode: 'mp', lenPer: 3 },
]
const EST = [{ id: 'e_el', kind: 'house', name: 'Разводка электрики', stage: 2,
  lines: [{ id: 'l1', pid: 'p_kab', qty: 1 }, { id: 'l2', pid: 'p_br', qty: 4 }] }]
// Позиция рождается по правилу — как в реальной смете по чертежу.
const RULES = [{ id: 'r_el', kind: 'house', estId: 'e_el', what: 'surface', k: 'wall', scope: 'house', qty: 1, stage: 2 }]

function panel() {
  const p = boot({ confirm: true })
  p.set({
    expProducts: JSON.parse(JSON.stringify(PRODUCTS)), estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [], contractDocs: [],
    purchases: [], issues: [], users: [], stock: [], settings: {}, buildRules: RULES,
    currentUser: { id: 'u1', name: 'Юрий', roles: ['admin'], objs: [], c: '#000', av: '👤' },
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  return p
}

// ── 1. Кнопка раскрывает список ссылок ──────────────────────────────────────
{
  t.section('Сверка открывает магазины этапа')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  t.ok('пока не жали — панели нет', p.run('tSpec2()').indexOf('data-a="price-shop-set"') < 0)

  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) })
  p.run('bind();'); btn.onclick()
  const html = p.run('tSpec2()')
  t.ok('панель сверки открылась', html.indexOf('data-a="price-shop-set"') >= 0)
  // Ссылка — это главное: по ней и идут смотреть цену.
  t.ok('ссылка на Ozon есть', /https:\/\/www\.ozon\.ru\/product\/kabel-1\//.test(html))
  t.ok('ссылка на Леману есть', /https:\/\/lemanapro\.ru\/product\/brusok-2\//.test(html))
  t.ok('открывается в новой вкладке', /target="_blank"/.test(html))
  // Товар в списке ОДИН раз, даже если он в нескольких строках этапа.
  t.ok('каждый товар по одному разу',
    (html.match(/data-a="price-shop-set"/g) || []).length === 2,
    'полей: ' + (html.match(/data-a="price-shop-set"/g) || []).length)
  t.ok('видно нынешнюю цену', /5 100/.test(html.replace(/[  ]/g, ' ')))
}

// ── 2. Новая цена уходит в каталог и в историю ──────────────────────────────
{
  t.section('Новая цена из магазина')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()

  const inp = p.dom.node({ a: 'price-shop-set', p: 'p_kab' })
  p.run('bind();'); inp.value = '5600'; inp.onchange()

  t.ok('цена в каталоге обновилась', p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost') === 5600)
  // История — ради вопроса «почему подорожало»: прежняя цифра должна остаться.
  const hist = p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].hist||[]')
  t.ok('прежняя цена записана в историю', hist.some((h) => Number(h.c) === 5100), JSON.stringify(hist))
  t.ok('и новая тоже', hist.some((h) => Number(h.c) === 5600), JSON.stringify(hist))
  t.ok('отмечено, кто сверял', hist.every((h) => !!h.by), JSON.stringify(hist))
  t.ok('стоит дата проверки', !!p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].priceCheckedAt'))
  // Смета считается по каталогу — значит проект дорожает сразу.
  t.ok('проект пересчитался',
    p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).mats') >= 5600,
    'материалы: ' + p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).mats'))
  // Второй товар не тронут: сверяли один.
  t.ok('соседний товар не изменился', p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].unitCost') === 107.67)
}

// ── 3. Товар кончился ───────────────────────────────────────────────────────
{
  t.section('Товара нет в наличии')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()

  const oos = p.dom.node({ a: 'price-shop-oos', p: 'p_br' })
  p.run('bind();'); oos.onclick()
  t.ok('товар помечен как отсутствующий', !!p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].oosAt'))
  // Пометка должна быть видна в САМОЙ смете, а не только в панели сверки: панель
  // закроют, а закупать по строке будут завтра.
  const btn2 = p.dom.node({ a: 'est-stage-prices', n: String(stN) })
  p.run('bind();'); btn2.onclick()          // закрываем панель
  p.run('(function(){var w=works2(spec2Sheet(), specCtx(spec2Sheet()));var m={};w.positions.forEach(function(x){m[x.key]=1;});matsOpen=m;})()')
  const html = p.run('tSpec2()')
  t.ok('панель закрыта', html.indexOf('data-a="price-shop-set"') < 0)
  t.ok('в строке материала видно «нет в наличии»', /нет в наличии/i.test(html), 'пометки не видно')
  // Цену при этом не обнуляем: товар вернётся, а смета не должна «подешеветь».
  t.ok('цена осталась прежней', p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].unitCost') === 107.67)

  p.run('bind();'); oos.onclick()
  t.ok('повторный тап снимает пометку', !p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].oosAt'))
}

// ── 4. Видно, что подтверждено, а что нет ───────────────────────────────────
// Сверка идёт по шестнадцати позициям, и через пять карточек уже не помнишь, где
// ты был. Поэтому у каждой карточки — свой статус: сверено сегодня, давно, не
// сверялось, кончился. Без этого сверка превращается в «кажется, всё проверил».
{
  t.section('Статус каждой карточки')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()

  const html0 = p.run('tSpec2()')
  t.ok('пока не сверяли — так и написано', /не сверял/i.test(html0), 'нет метки «не сверялось»')
  t.ok('счётчик показывает ноль из двух', /сверено 0 из 2/i.test(html0), 'нет счётчика')
  t.ok('ручных отметок в списке нет', html0.indexOf('data-a="price-shop-ok"') < 0)

  // Подтверждение приходит РЕЗУЛЬТАТОМ сверки, а не тапом по списку.
  p.run('applyPriceReports([{ id:"p_kab", ok:true, price:5100, inStock:true }])')
  t.ok('дата подтверждения записана', !!p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].priceOkAt'))
  const html1 = p.run('tSpec2()')
  t.ok('статус стал «сверено»', /сверено 6 сен|сверено сегодня/i.test(html1), 'нет свежего статуса')
  t.ok('счётчик поехал', /сверено 1 из 2/i.test(html1), 'счётчик не обновился')

  // Новая цена — тоже подтверждение: смотрели же в магазине.
  const inp = p.dom.node({ a: 'price-shop-set', p: 'p_br', o: '' })
  p.run('bind();'); inp.value = '120'; inp.onchange()
  t.ok('ввод цены подтверждает карточку', !!p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].priceOkAt'))
  t.ok('сверены обе', /сверено 2 из 2/i.test(p.run('tSpec2()')))

  // Давняя сверка — не то же самое, что свежая: цену могли поднять неделю назад.
  p.run('expProducts.filter(function(x){return x.id==="p_kab";})[0].priceOkAt="2026-06-01";')
  t.ok('старая сверка помечена как давняя', /давно/i.test(p.run('tSpec2()')), 'нет метки «давно»')
}

// ── 5. Отчёт от расширения ──────────────────────────────────────────────────
// Расширение обходит карточки в браузере хозяина (там он уже авторизован, и
// защита магазинов к нему не придирается) и приносит цены пачкой. Панель должна
// разложить их по каталогу так же аккуратно, как если бы их вводили руками.
{
  t.section('Панель принимает отчёт расширения')
  const p = panel()
  const before = p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost')

  const sum = p.run('applyPriceReports([' +
    '{ id:"p_kab", ok:true, price:5600, inStock:true },' +      // подорожал
    '{ id:"p_br",  ok:true, price:107.67, inStock:false },' +   // цена та же, но кончился
    '{ id:"p_zzz", ok:true, price:10, inStock:true },' +        // товара нет в базе
    '{ id:"p_kab", ok:false, error:"страница не ответила" }' +  // не сверилось
  '])')
  t.ok('цена обновилась', p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost') === 5600,
    'было ' + before)
  t.ok('история записана', (p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].hist')||[]).length >= 2)
  t.ok('отсутствие проставлено', !!p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].oosAt'))
  t.ok('цена кончившегося не тронута', p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].unitCost') === 107.67)
  t.ok('оба помечены сверенными',
    !!p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].priceOkAt') &&
    !!p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].priceOkAt'))
  // Сводка нужна, чтобы сказать человеку, что произошло: молчаливое «готово»
  // не отличить от «ничего не нашлось».
  t.ok('сводка посчитана', sum && sum.checked === 2 && sum.changed === 1 && sum.oos === 1,
    JSON.stringify(sum))
  t.ok('неудачи посчитаны отдельно', sum.failed === 1, JSON.stringify(sum))
  t.ok('чужой товар не создаётся', p.q('expProducts.length') === 2, 'товаров: ' + p.q('expProducts.length'))
}

// ── 6. Цена с ценника пересчитывается в нашу единицу ────────────────────────
// Магазин показывает цену за то, чем торгует: трубу — за хлыст 3 м, лист — за лист.
// А у нас труба учитывается в метрах погонных. Если взять ценник как есть, труба
// «подорожает» втрое на ровном месте. Пересчёт делает панель: расширение приносит
// то, что написано на ценнике, и не обязано знать про наш учёт.
{
  t.section('Ценник магазина → наша единица')
  const p = boot({})
  p.set({
    expProducts: [
      { id: 'p_tr', name: 'Труба 60x40x2 3 м', unitCost: 298.67, mode: 'mp', lenPer: 3, store: 'Лемана', url: 'https://lemanapro.ru/product/t/' },
      { id: 'p_sh', name: 'ОСП 9 мм', unitCost: 710, mode: 'sheet', packPer: 3.125, packBase: 'м²', store: 'Лемана', url: 'https://lemanapro.ru/product/o/' },
      { id: 'p_m2', name: 'Ламинат', unitCost: 1200, mode: 'm2', sheetM2: 2.4, store: 'Лемана', url: 'https://lemanapro.ru/product/l/' },
    ],
    estimates: [], dbPlans: [], crmClients: [], specSheets: [], specSheets2: [], winTypes: [],
    objects: [], templates: [], contractDocs: [], purchases: [], issues: [], users: [], stock: [],
    settings: {}, buildRules: [],
  })
  // Труба: на ценнике 924 ₽ за хлыст 3 м → у нас 308 ₽ за метр.
  p.run('applyPriceReports([{ id:"p_tr", ok:true, price:924, inStock:true }])')
  t.ok('метр погонный пересчитан', p.q('expProducts[0].unitCost') === 308,
    'получили: ' + p.q('expProducts[0].unitCost'))

  // Лист: и магазин, и мы считаем за лист — делить не на что.
  p.run('applyPriceReports([{ id:"p_sh", ok:true, price:760, inStock:true }])')
  t.ok('лист берётся как есть', p.q('expProducts[1].unitCost') === 760, 'получили: ' + p.q('expProducts[1].unitCost'))

  // Квадратный метр: ценник за упаковку 2,4 м² → у нас за м².
  p.run('applyPriceReports([{ id:"p_m2", ok:true, price:3120, inStock:true }])')
  t.ok('квадратный метр пересчитан', p.q('expProducts[2].unitCost') === 1300, 'получили: ' + p.q('expProducts[2].unitCost'))

  // Совпадение после пересчёта — это «цена не менялась», а не новая правка.
  const histBefore = (p.q('expProducts[0].hist') || []).length
  p.run('applyPriceReports([{ id:"p_tr", ok:true, price:924, inStock:true }])')
  t.ok('повтор не плодит историю', (p.q('expProducts[0].hist') || []).length === histBefore)
}

// ── 7. Кончился — портал предлагает замену, человек только принимает ────────
// Отмечать «верна» и «кончился» руками — работа для того, кто ходил в магазин, а
// ходит теперь расширение. Хозяину остаётся единственное, что машина решать не
// вправе: чем заменить то, чего больше нет.
{
  t.section('Замена вместо ручных отметок')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()

  // Сверка прошла: кабель подтверждён, брусок кончился и найдена замена.
  p.run('applyPriceReports([{ id:"p_kab", ok:true, price:5100, inStock:true },{ id:"p_br", ok:true, inStock:false, alt:{ name:"Брусок строганый 40x50x3000 Оптима", store:"Лемана", url:"https://lemanapro.ru/product/alt/", price:120 } }])')

  const html = p.run('tSpec2()')
  t.ok('подтверждённое не требует действий', !/data-a="price-shop-ok"/.test(html), 'ручные кнопки остались')
  t.ok('видно, что товар кончился', /кончился|нет в наличии/i.test(html))
  t.ok('предложена замена', /Брусок строганый 40x50x3000 Оптима/.test(html), 'аналога не видно')
  t.ok('видна цена замены', /120/.test(html))
  t.ok('есть кнопка принять', html.indexOf('data-a="price-alt-take"') >= 0)
  t.ok('и отказаться', html.indexOf('data-a="price-alt-drop"') >= 0)

  // Приняли: замена появляется в каталоге и встаёт в смету вместо кончившегося.
  const take = p.dom.node({ a: 'price-alt-take', p: 'p_br' })
  p.run('bind();'); take.onclick()
  const added = p.q('expProducts.filter(function(x){return /Оптима/.test(x.name||"");})[0]')
  t.ok('замена заведена в каталог по нашей единице', !!added && added.unitCost === 40,
    'цена: ' + (added && added.unitCost))
  t.ok('со ссылкой и магазином', !!added && /lemanapro/.test(added.url) && added.store === 'Лемана')
  t.ok('единица учёта унаследована', added && added.mode === 'mp' && added.lenPer === 3,
    'режим: ' + (added && added.mode))
  t.ok('в смете теперь замена', /Оптима/.test(p.run('tSpec2()')), 'смета не подхватила')
  t.ok('старый товар остался в каталоге помеченным',
    !!p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].oosAt'))
  t.ok('предложение израсходовано', !p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].alt'))
}

t.done()
