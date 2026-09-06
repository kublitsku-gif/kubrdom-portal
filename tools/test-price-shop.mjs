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

// ── 8. Кнопка сверки видна всегда ───────────────────────────────────────────
// Показать «не сверялось» и не показать, чем сверять, — это тупик: человек видит
// задачу и не видит кнопки. Кнопка есть всегда; нет расширения — она объясняет,
// как его поставить, а не прячется.
{
  t.section('Чем сверять — видно сразу')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()

  const html = p.run('tSpec2()')
  t.ok('кнопка сверки на месте без расширения', html.indexOf('data-a="price-ext-run"') >= 0)
  t.ok('и мастер рядом', html.indexOf('data-a="price-wiz-open"') >= 0)
  t.ok('состояние расширения подписано', /расширение/i.test(html), 'нет упоминания расширения')

  // С расширением подпись меняется на действие.
  p.run('priceExtReady=true;')
  const html2 = p.run('tSpec2()')
  t.ok('с расширением зовёт сверить всё', /сверить вс|обойти/i.test(html2), 'нет призыва к действию')
}

// ── 9. «Цены сверены» — только про магазины ────────────────────────────────
// Сверка строк с каталогом — не сверка цен: каталог сам может быть вчерашним.
// Поэтому отметка этапа не ставится кнопкой, а СЧИТАЕТСЯ по карточкам: зелено
// становится тогда, когда каждая карточка этапа проверена в магазине.
{
  t.section('Отметка этапа следует за магазинами')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')

  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) })
  p.run('bind();'); btn.onclick()
  const afterClick = p.run('tSpec2()')
  t.ok('кнопка сама зелёной отметки не даёт', !/цены сверены/i.test(afterClick), 'отметка появилась без магазинов')

  // Проверили в магазине один товар из двух — этап ещё не сверен.
  p.run('applyPriceReports([{ id:"p_kab", ok:true, price:5100, inStock:true }])')
  t.ok('половина — ещё не отметка', !/цены сверены/i.test(p.run('tSpec2()')))

  // Проверили второй — вот теперь этап сверен, и дата берётся из карточек.
  p.run('applyPriceReports([{ id:"p_br", ok:true, price:107.67, inStock:true }])')
  const done = p.run('tSpec2()')
  t.ok('оба проверены — этап сверен', /цены сверены/i.test(done), 'отметки нет, хотя всё проверено')
  t.ok('дата настоящая', /6 сен/.test(done), 'нет даты сверки')

  // Прошло время — отметка гаснет сама: цена, проверенная месяц назад, не свежая.
  p.run('expProducts.forEach(function(x){ x.priceOkAt="2026-06-01"; });')
  t.ok('давняя сверка отметку снимает', !/цены сверены/i.test(p.run('tSpec2()')), 'старая отметка держится')
}

// ── Динамика цены рядом с ценой ─────────────────────────────────────────────
// Сверку затевают ради одного вопроса: что подорожало. Цифра «5 600 ₽» сама по
// себе не отвечает ни на что — рядом обязана стоять разница с прошлой ценой, а
// в шапке счёт, сколько товаров подросло.
{
  t.section('Динамика цены в сверке')
  const p = panel()
  const plain = () => p.run('tSpec2()').replace(/[\u00a0\u202f]/g, ' ')
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()
  t.ok('без истории чипа нет', plain().indexOf('data-a="price-hist"') < 0)

  // Кабель подорожал, брусок подешевел — как это и приходит из магазина.
  // Цена вводится в НАШЕЙ единице: в строке рядом стоит «₽/м.п.».
  const up = p.dom.node({ a: 'price-shop-set', p: 'p_kab' })
  p.run('bind();'); up.value = '5600'; up.onchange()
  // Цена пишется КАК НА ЦЕННИКЕ: хлыст 3 м за 240 ₽ — это 80 ₽/м.п.
  const down = p.dom.node({ a: 'price-shop-set', p: 'p_br' })
  p.run('bind();'); down.value = '240'; down.onchange()

  const html = plain()
  t.ok('у подорожавшего — рост', /▲ \+500 ₽/.test(html), 'нет роста в строке')
  t.ok('и в процентах', /▲ \+500 ₽ · 10%/.test(html), 'нет процента')
  t.ok('у подешевевшего — падение', /▼ −28 ₽/.test(html), 'нет падения в строке')
  t.ok('цвета разные',
    /#e74c3c55/.test(html) && /#27ae6055/.test(html), 'оба чипа одного цвета')
  t.ok('в подсказке прежняя цена', html.indexOf('title="Было 5 100 ₽') >= 0, 'нет «было» в подсказке')
  t.ok('и вся история', /История: /.test(html))

  // Шапка отвечает на «что вообще подорожало» одной строкой.
  t.ok('в шапке счёт подорожавших', /▲ подорожало 1/.test(html), 'нет счёта роста')
  t.ok('и подешевевших', /▼ подешевело 1/.test(html), 'нет счёта падения')
  t.ok('в подсказке названы товары', html.indexOf('Кабель ВВГ 3х1,5 100 м +500 ₽') >= 0,
    'товары не названы')

  // Чип ведёт в карточку товара — там перечислены последние правки.
  const chip = p.dom.node({ a: 'price-hist', p: 'p_kab' }); p.run('bind();'); chip.onclick()
  t.ok('открылась карточка товара', p.q('expOpenId') === 'p_kab' && p.q('dbSection') === 'mats')

  // Цена вернулась к прежней — динамики больше нет: «▲ +500» на товаре, который
  // стоит столько же, сколько раньше, это враньё.
  p.run('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost=5100;')
  t.ok('вернулась цена — ушёл и чип', !/▲ \+500 ₽/.test(plain()), 'чип остался')
}

// ── Цена с ценника: коробка, хлыст, упаковка ────────────────────────────────
// Магазин торгует тем, чем торгует: трубу отдаёт хлыстом по 3 м, клей-пену —
// коробкой по 12 баллонов. У нас в учёте метры и баллоны. Возьмёшь ценник как
// есть — товар подорожает ровно во столько раз, во сколько его кладут в коробку.
{
  t.section('Ценник магазина в нашу единицу')
  const p = panel()
  const plain = () => p.run('tSpec2()').replace(/[  ]/g, ' ')
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()

  // Хлыст: делитель у метража уже есть — 240 ₽ за 3 м это 80 ₽/м.п.
  const mp = p.dom.node({ a: 'price-shop-set', p: 'p_br' })
  p.run('bind();'); mp.value = '240'; mp.onchange()
  t.ok('метраж поделён по хлысту',
    p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].unitCost') === 80,
    String(p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].unitCost')))
  t.ok('и в строке видно, что покупают хлыстом', /× 3 м\.п\./.test(plain()), 'нет пометки об упаковке')

  // Штучный товар: своего делителя у него не было вовсе — коробка из 12 баллонов
  // уезжала в каталог как цена ОДНОГО баллона.
  p.run('expProducts.filter(function(x){return x.id==="p_kab";})[0].shopPer=12;')
  const box = p.dom.node({ a: 'price-shop-set', p: 'p_kab' })
  p.run('bind();'); box.value = '6843'; box.onchange()
  t.ok('коробка поделена на штуки',
    p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost') === 570.25,
    String(p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost')))
  const html = plain()
  t.ok('пометка о коробке в строке', /× 12 шт/.test(html), 'нет пометки о коробке')
  t.ok('и поле просит ценник', /placeholder="с ценника"/.test(html), 'поле не подсказывает')

  // Без упаковки правило прежнее: что написали, то и записали.
  p.run('expProducts.filter(function(x){return x.id==="p_kab";})[0].shopPer=0;')
  const one = p.dom.node({ a: 'price-shop-set', p: 'p_kab' })
  p.run('bind();'); one.value = '600'; one.onchange()
  t.ok('штучный товар не делится',
    p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost') === 600)
  t.ok('и пометки нет', !/× 12 шт/.test(plain()))
}

// ── Имя замены со страницы магазина ─────────────────────────────────────────
// Расширение берёт имя там же, где цену, а рядом с товаром лежат плашки акций.
// Товар с именем «10% БАЛЛАМИ» встанет в смету дома, и найти его потом нельзя
// ни поиском, ни глазами.
{
  t.section('Имя замены — не плашка акции')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()
  p.run('applyPriceReports([{ id:"p_br", ok:true, inStock:false, alt:{ name:"10% БАЛЛАМИ", store:"Лемана", url:"https://lemanapro.ru/product/alt/", price:120 } }])')

  const html = p.run('tSpec2()')
  t.ok('плашка в имя не пролезла',
    p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].alt.name') === '',
    JSON.stringify(p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].alt')))
  t.ok('цена и ссылка сохранены',
    p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].alt.price') === 120
    && /lemanapro/.test(p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].alt.url')))
  t.ok('замена всё равно показана', html.indexOf('data-a="price-alt-take"') >= 0)
  t.ok('и объясняет, что приехало', /плашка акции/.test(html), 'нет объяснения')
  t.ok('имя правится прямо здесь', html.indexOf('data-a="price-alt-name" data-p="p_br"') >= 0)

  // Без имени замену не принимаем: безымянный товар в смете хуже, чем его отсутствие.
  const take = p.dom.node({ a: 'price-alt-take', p: 'p_br' }); p.run('bind();'); take.onclick()
  t.ok('без имени не заводится', p.q('expProducts.length') === 2, 'товар всё-таки завели')

  // Вписали имя руками — и всё пошло как обычно.
  const inp = p.dom.node({ a: 'price-alt-name', p: 'p_br' })
  p.run('bind();'); inp.value = 'Брусок строганый 40x50x3000 Оптима'; inp.onchange()
  const take2 = p.dom.node({ a: 'price-alt-take', p: 'p_br' }); p.run('bind();'); take2.onclick()
  const added = p.q('expProducts.filter(function(x){return /Оптима/.test(x.name||"");})[0]')
  t.ok('с именем замена заводится', !!added && added.unitCost === 40, JSON.stringify(added && added.name))

  // Настоящее имя проверка пропускает — иначе она мешала бы работать.
  t.ok('обычное имя проходит', p.q('altNameOk("Грунтовка глубокого проникновения Bergauf TiefGrunt 10 л")') === true)
  t.ok('и «баллон» не путается с «баллами»', p.q('altNameOk("Клей-пена POLYNOR баллон 750 мл")') === true)
  t.ok('а «Скидка 30%» — нет', p.q('altNameOk("Скидка 30%")') === false)
}

// ── Три магазина у каждого товара ───────────────────────────────────────────
// Цену смотрят в трёх местах, и открывать их руками через поиск каждый раз —
// это ровно та работа, которую портал должен снимать.
{
  t.section('Сравнить в трёх магазинах')
  const p = panel()
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()
  const html = p.run('tSpec2()')

  t.ok('предложены все три', /Озон ↗/.test(html) && /Лемана ↗/.test(html) && /Я\.Маркет ↗/.test(html),
    'магазинов меньше трёх')
  // Где карточка у нас уже есть — ведём в неё, а не в поиск.
  t.ok('своя карточка Ozon — прямая ссылка',
    html.indexOf('href="https://www.ozon.ru/product/kabel-1/" target="_blank" rel="noopener" title="Наша карточка') >= 0,
    'своя ссылка не подставлена')
  t.ok('и помечена точкой', /● Озон ↗/.test(html))
  // Где карточки нет — поиск по имени товара.
  t.ok('в остальных — поиск по имени',
    html.indexOf('https://market.yandex.ru/search?text=' + encodeURIComponent('Кабель ВВГ 3х1,5 100 м')) >= 0,
    'поиска по имени нет')
  t.ok('и это видно из подсказки', /title="Найти этот товар в магазине"/.test(html))
}

// ── Копейки — не динамика ───────────────────────────────────────────────────
// «▼ −2 ₽» у стеллажа за 3 458 ₽ — это шум округления, а не новость. Чип на
// каждой карточке перестают читать, если он загорается от копеек.
{
  t.section('Мелкое движение цены не показываем')
  const p = panel()
  const plain = () => p.run('tSpec2()').replace(/[  ]/g, ' ')
  const stN = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')
  const btn = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); btn.onclick()

  // 5 100 → 5 098: два рубля из пяти тысяч.
  const inp = p.dom.node({ a: 'price-shop-set', p: 'p_kab' })
  p.run('bind();'); inp.value = '5098'; inp.onchange()
  t.ok('цена записана', p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost') === 5098)
  t.ok('но чипа нет', plain().indexOf('data-a="price-hist"') < 0, 'чип загорелся от двух рублей')
  t.ok('и в шапке никого не прибавилось', !/подорожало|подешевело/.test(plain()))

  // Процент набрался — чип появился.
  const up = p.dom.node({ a: 'price-shop-set', p: 'p_kab' })
  p.run('bind();'); up.value = '5300'; up.onchange()
  t.ok('заметное движение видно', /▲ \+202 ₽ · 4%/.test(plain()), 'нет чипа при 4%')
}

t.done()
