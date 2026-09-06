#!/usr/bin/env node
// Мастер сверки цен (public/admin.js).
//
// Список из семнадцати карточек с мелкими полями — это не работа, а прицеливание:
// на телефоне промахиваешься мимо поля, теряешь место, забываешь, где был. Мастер
// показывает ОДНУ карточку крупно, кнопки в палец шириной, и сам ведёт по списку:
// принял цену — следующая. Работа сводится к «смотрю в магазин → тап».
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_kab', name: 'Кабель ВВГ 3х1,5 100 м', unitCost: 5100, store: 'Озон',
    url: 'https://www.ozon.ru/product/kabel/', mode: 'piece' },
  { id: 'p_br', name: 'Брусок строганый 40x50x3000', unitCost: 107.67, store: 'Лемана',
    url: 'https://lemanapro.ru/product/brusok/', mode: 'mp', lenPer: 3 },
  { id: 'p_pv', name: 'Подвес прямой 60x27', unitCost: 8, store: 'Лемана',
    url: 'https://lemanapro.ru/product/podves/', mode: 'piece' },
]
const EST = [{ id: 'e_el', kind: 'house', name: 'Разводка электрики', stage: 2,
  lines: [{ id: 'l1', pid: 'p_kab', qty: 1 }, { id: 'l2', pid: 'p_br', qty: 4 }, { id: 'l3', pid: 'p_pv', qty: 40 }] }]
const RULES = [{ id: 'r_el', kind: 'house', estId: 'e_el', what: 'surface', k: 'wall', scope: 'house', qty: 1, stage: 2 }]

function panel() {
  const p = boot({ confirm: true })
  p.set({
    expProducts: JSON.parse(JSON.stringify(PRODUCTS)), estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [], contractDocs: [],
    purchases: [], issues: [], users: [], stock: [], settings: {}, buildRules: RULES,
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  return p
}
const stageOf = (p) => p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).stages[0].n')

// ── 1. Открытие и навигация ─────────────────────────────────────────────────
{
  t.section('Мастер ведёт по карточкам')
  const p = panel()
  const stN = stageOf(p)
  const open = p.dom.node({ a: 'price-wiz-open', n: String(stN) })
  p.run('bind();'); open.onclick()

  const html = p.run('tSpec2()')
  t.ok('мастер открылся', html.indexOf('data-a="price-wiz-ok"') >= 0)
  t.ok('показывает первую карточку', /Кабель ВВГ 3х1,5 100 м/.test(html))
  t.ok('и только её', !/Брусок строганый/.test(html), 'на экране больше одной карточки')
  t.ok('видно, сколько пройдено', /1 из 3/.test(html), 'нет счётчика шагов')
  t.ok('есть ссылка в магазин', /https:\/\/www\.ozon\.ru\/product\/kabel\//.test(html))
  t.ok('видно нынешнюю цену', /5 100/.test(html.replace(/[  ]/g, ' ')))

  // «Цена верна» — самый частый случай: ничего не изменилось, идём дальше.
  const ok = p.dom.node({ a: 'price-wiz-ok' }); p.run('bind();'); ok.onclick()
  const html2 = p.run('tSpec2()')
  t.ok('карточка подтверждена', !!p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].priceOkAt'))
  t.ok('мастер сам перешёл к следующей', /Брусок строганый/.test(html2), 'остался на прежней')
  t.ok('счётчик поехал', /2 из 3/.test(html2))
}

// ── 2. Новая цена и «кончился» ──────────────────────────────────────────────
{
  t.section('Правки прямо в мастере')
  const p = panel()
  const stN = stageOf(p)
  const open = p.dom.node({ a: 'price-wiz-open', n: String(stN) }); p.run('bind();'); open.onclick()

  const inp = p.dom.node({ a: 'price-wiz-price' })
  p.run('bind();'); inp.value = '5600'; inp.onchange()
  t.ok('цена ушла в каталог', p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].unitCost') === 5600)
  t.ok('история записана', (p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].hist') || []).length > 0)
  t.ok('и сразу следующая карточка', /Брусок строганый/.test(p.run('tSpec2()')))

  const oos = p.dom.node({ a: 'price-wiz-oos' }); p.run('bind();'); oos.onclick()
  t.ok('брусок помечен «кончился»', !!p.q('expProducts.filter(function(x){return x.id==="p_br";})[0].oosAt'))
  t.ok('перешли к третьей', /Подвес прямой/.test(p.run('tSpec2()')))
}

// ── 3. Пропуск и финиш ──────────────────────────────────────────────────────
{
  t.section('Пропуск и конец списка')
  const p = panel()
  const stN = stageOf(p)
  const open = p.dom.node({ a: 'price-wiz-open', n: String(stN) }); p.run('bind();'); open.onclick()

  // Пропустили — статус не тронут: «не смотрел» и «смотрел, всё то же» это разное.
  const skip = p.dom.node({ a: 'price-wiz-skip' }); p.run('bind();'); skip.onclick()
  t.ok('пропущенная осталась несверенной', !p.q('expProducts.filter(function(x){return x.id==="p_kab";})[0].priceOkAt'))
  t.ok('но мастер пошёл дальше', /Брусок строганый/.test(p.run('tSpec2()')))

  const tap = () => { const b = p.dom.node({ a: 'price-wiz-skip' }); p.run('bind();'); b.onclick() }
  tap(); tap()
  const done = p.run('tSpec2()')
  t.ok('после последней мастер закрылся', done.indexOf('data-a="price-wiz-ok"') < 0, 'мастер не закрылся')
  // Закрыли — и снова видно смету, а не пустой экран.
  t.ok('смета на месте', /ЭТАП/.test(done))
}

// ── Динамика цены в карточке мастера ────────────────────────────────────────
// В мастере человек стоит перед решением «цена верна или нет» и первым делом
// должен видеть, куда она уже двигалась. Тот же чип, что в списке сверки, —
// экран один и тот же вопрос.
{
  t.section('Динамика цены в мастере')
  const p = panel()
  const stN = stageOf(p)
  // Товар уже дорожал: так это и лежит в каталоге после прошлой сверки.
  p.run('(function(){var x=expProducts.filter(function(y){return y.id==="p_kab";})[0];'
    + 'x.hist=[{at:"2026-08-01T00:00:00Z",c:4600,by:"Юрий"},{at:"2026-09-01T00:00:00Z",c:5100,by:"Юрий"}];})();')
  const open = p.dom.node({ a: 'price-wiz-open', n: String(stN) }); p.run('bind();'); open.onclick()
  const html = p.run('tSpec2()').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('в карточке видно рост', /▲ \+500 ₽/.test(html), 'нет динамики в мастере')
  t.ok('и в процентах', /▲ \+500 ₽ · 11%/.test(html), 'нет процента')
  t.ok('чип ведёт в карточку товара', html.indexOf('data-a="price-hist" data-p="p_kab"') >= 0)
  t.ok('в подсказке прежняя цена', html.indexOf('title="Было 4 600 ₽') >= 0, 'нет «было»')
  // У товара без истории чипа нет: сравнивать не с чем, а «0 ₽» читалось бы как
  // «цена не менялась», чего мы не знаем.
  const next = p.dom.node({ a: 'price-wiz-skip' }); p.run('bind();'); next.onclick()
  t.ok('у товара без истории чипа нет',
    p.run('tSpec2()').indexOf('data-a="price-hist"') < 0, 'чип нарисован без истории')
}

t.done()
