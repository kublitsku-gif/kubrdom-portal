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
  t.ok('есть кнопка «цена верна»', html0.indexOf('data-a="price-shop-ok"') >= 0)

  // Подтвердили цену как есть — карточка зеленеет с датой.
  const ok = p.dom.node({ a: 'price-shop-ok', p: 'p_kab', o: '' })
  p.run('bind();'); ok.onclick()
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

t.done()
