#!/usr/bin/env node
// Экран закупки (public/admin.js + src/supply.js):
// одна вывеска магазина, чипы с суммой, сводка одной карточкой, виды «Закупка / Этапы /
// Работы», липкие шапки, пачка «куплено» с возвратом, «заказано → привезут», фактическая
// цена, список текстом, корзина магазина, меню «⋯», «это работа» в форме правки.
//
//   node tools/test-supply-ux.mjs
import { boot, reporter } from './harness/panel-vm.js'
import { supplyStep, factPrice, factTotals, needStatus, isOrdered } from '../src/supply.js'

const t = reporter()
const nb = (x) => String(x).replace(/[  ]/g, ' ')

// Объект с тем, что было на скриншоте: «Ozon» и «Озон» вперемешку, три магазина, два этапа.
function seed(p) {
  p.set({
    expProducts: [],
    objects: [
      { id: 'o1', name: 'Дом СВО', icon: '🏠', stages: [
        { id: 's1', n: 'ЭТАП 1', c: '#e67e22', works: [
          { id: 'w1', n: 'Разводка электрики', cost: 0, mats: [
            { id: 'm1', n: 'Разъём 32А', cost: 319, qty: 1, store: 'Ozon', mode: 'piece', url: 'https://www.ozon.ru/product/1' },
            { id: 'm2', n: 'Кабель ВВГ', cost: 100, qty: 50, store: 'Озон', mode: 'piece' },
          ] },
          { id: 'w2', n: 'Каркас', cost: 0, mats: [
            { id: 'm3', n: 'Брус 50×100', cost: 800, qty: 30, store: 'Лемана ПРО', mode: 'piece', url: 'https://lemanapro.ru/p/1' },
          ] },
        ] },
        { id: 's2', n: 'ЭТАП 2', c: '#2980b9', works: [
          { id: 'w3', n: 'Утепление', cost: 0, mats: [
            { id: 'm4', n: 'Минвата', cost: 1500, qty: 10, store: 'Белка', mode: 'piece' },
          ] },
        ] },
      ] },
    ],
    purchased: {}, arrived: {}, purchases: [],
    templates: [], contractDocs: [], users: [], finTxns: [], stock: [], issues: [],
  })
  p.run('window._supplySelected={o1:true};supplySearch="";supplyStoreFilter="";supplyHideDone=false;' +
    'supplyPickMode=false;supplyMoreOpen=false;supplyGroupOpen={};supplyCostOpen=false;supplyEditMid=null;supplyEditIds=[];')
}
const view = (p, sort) => nb(p.run(`tSupplyDetail({o1:true},${JSON.stringify(sort)})`))
// В тесте нет экрана: тост перехватываем, чтобы нажать «Отменить» самим.
const catchUndo = (p) => p.run('window._undo=null;_undoToast=function(msg,fn){window._undo={msg:msg,fn:fn};};')
const click = (p, dataset) => { const el = p.dom.node(dataset); p.run('bind();'); el.onclick({ stopPropagation() {} }); return el }
const change = (p, dataset, value) => { const el = p.dom.node(dataset); el.value = value; p.run('bind();'); el.onchange(); return el }
const count = (s, sub) => s.split(sub).length - 1

// ── 1. Одна вывеска магазина ────────────────────────────────────────────────
{
  t.section('Одна вывеска магазина')
  const p = boot(); seed(p)
  t.ok('«Ozon» → «Озон»', p.run('normStore("Ozon")') === 'Озон')
  t.ok('домен тоже', p.run('normStore("ozon.ru")') === 'Озон')
  t.ok('«Яндекс.Маркет» → «Яндекс Маркет»', p.run('normStore("Яндекс.Маркет")') === 'Яндекс Маркет')
  t.ok('незнакомый магазин не трогаем', p.run('normStore("Белка")') === 'Белка')

  const html = view(p, 'merge')
  t.ok('чип «Ozon» не появился', !html.includes('data-store="Ozon"'))
  t.ok('один чип «Озон» с двумя позициями и суммой', count(html, 'data-store="Озон"') === 1 && html.includes('2 · 5 319 ₽'),
    (html.match(/data-store="Озон"[\s\S]{0,400}/) || [''])[0].replace(/<[^>]*>/g, ' '))
  t.ok('одна группа «Озон» в «Закупке»', html.includes('data-k="store|Озон"') && !html.includes('store|Ozon'))
  t.ok('чипы по убыванию суммы', html.indexOf('data-store="Лемана ПРО"') < html.indexOf('data-store="Белка"')
    && html.indexOf('data-store="Белка"') < html.indexOf('data-store="Озон"'))
  t.ok('чип «Все» с общей суммой', html.includes('data-store=""') && html.includes('4 · 44 тыс ₽'))
}

// ── 2. Первый экран ─────────────────────────────────────────────────────────
{
  t.section('Сводка одной карточкой, редкое — в меню')
  const p = boot(); seed(p)
  const html = view(p, 'stage')
  t.ok('в сводке «всего» до рубля', html.includes('всего 44 319 ₽'))
  t.ok('в сводке три ячейки', html.includes('КУПЛЕНО') && html.includes('НА СКЛАДЕ') && html.includes('ОСТАЛОСЬ'))
  t.ok('склад в той же карточке', html.includes('0 / 4'))
  t.ok('отдельного «Прогресса закупки» больше нет', !html.includes('Прогресс закупки'))
  t.ok('большой кнопки PDF на первом экране нет', !html.includes('Скачать список для передачи'))
  t.ok('«платит заказчик?» не висит на первом экране', !html.includes('data-a="supply-refund-on"'))
  t.ok('в шапке «отправить» и «⋯»', html.includes('data-a="supply-share"') && html.includes('data-a="supply-more"'))

  click(p, { a: 'supply-more' })
  t.ok('меню открывается', p.q('supplyMoreOpen') === true)
  const menu = view(p, 'stage')
  t.ok('в меню PDF и оплата заказчиком', menu.includes('data-a="supply-list"') && menu.includes('data-a="supply-refund-on" data-oid="o1"'))
}

// ── 3. Виды и липкие шапки ──────────────────────────────────────────────────
{
  t.section('Виды списка')
  const p = boot(); seed(p)
  const stage = view(p, 'stage')
  t.ok('шапка группы липкая под шапкой приложения', stage.includes('position:sticky;top:var(--hdr'))
  t.ok('этап считает позиции и деньги', stage.includes('0/3 · 29 319 ₽') && stage.includes('осталось 29 319 ₽'))

  const work = view(p, 'work')
  t.ok('вид «Работы» группирует по работе', work.includes('data-k="work|ЭТАП 1|Разводка электрики"') && work.includes('🔨 Разводка электрики'))
  t.ok('кнопка вида «Работы» есть', work.includes('data-s="work"'))
  t.ok('старый вид «Магазины» ведёт в «Закупку»', view(p, 'store').includes('data-k="store|'))
}

// ── 4. Пачка с возвратом ────────────────────────────────────────────────────
{
  t.section('«Отметить всё» — сразу и с возвратом')
  const p = boot(); seed(p); catchUndo(p)
  click(p, { a: 'supply-stage-check', bulk: '1', ids: 'm1,m2,m3', done: '0' })
  t.ok('пачка отмечена без вопросов', ['m1', 'm2', 'm3'].every((id) => p.q('purchased')[id] === true))
  t.ok('тост называет число позиций', p.q('window._undo') && /3 поз/.test(p.q('window._undo.msg')))
  p.run('window._undo.fn()')
  t.ok('«Отменить» возвращает как было', Object.keys(p.q('purchased')).length === 0)

  p.set({ purchased: { m3: true } }); catchUndo(p)
  click(p, { a: 'supply-stage-check', bulk: '1', ids: 'm1,m3', done: '0' })
  p.run('window._undo.fn()')
  t.ok('возврат не снимает то, что было куплено раньше', p.q('purchased').m3 === true && !p.q('purchased').m1)

  catchUndo(p)
  click(p, { a: 'supply-stage-check', ids: 'm4', done: '0' })
  t.ok('строка отмечается тапом', p.q('purchased').m4 === true)
  t.ok('и без тоста — повторный тап сам отмена', p.q('window._undo') === null)
}

// ── 5. Заказано → привезут ──────────────────────────────────────────────────
{
  t.section('Заказано и срок доставки')
  const p = boot(); seed(p)
  t.ok('лента статуса в строке', view(p, 'stage').includes('заказано') && view(p, 'stage').includes('data-a="supply-order" data-ids="m3"'))
  click(p, { a: 'supply-order', ids: 'm3' })
  t.ok('заказ пишется на материал', /^\d{4}-\d{2}-\d{2}$/.test(p.mat('m3').ordAt || ''))
  t.ok('появилось поле «привезут»', view(p, 'stage').includes('data-a="supply-eta" data-ids="m3"'))
  change(p, { a: 'supply-eta', ids: 'm3' }, '2026-09-14')
  t.ok('срок записан', p.mat('m3').eta === '2026-09-14')
  t.ok('срок виден на ленте', view(p, 'stage').includes('заказано · до 14.09'))
  t.ok('и мастеру в приёмке', nb(p.run('tReceive({o1:true})')).includes('🚚 привезут 14.09'))
  change(p, { a: 'supply-eta', ids: 'm3' }, 'мусор')
  t.ok('кривая дата срок стирает, а не пишет мусор', p.mat('m3').eta == null)
  click(p, { a: 'supply-order', ids: 'm3' })
  t.ok('повторный тап снимает заказ', p.mat('m3').ordAt == null)
}

// ── 6. Фактическая цена ─────────────────────────────────────────────────────
{
  t.section('Фактическая цена')
  const p = boot(); seed(p)
  p.set({ purchased: { m3: true } })
  t.ok('у купленной строки есть поле факта', view(p, 'stage').includes('data-a="supply-fact" data-ids="m3"'))
  change(p, { a: 'supply-fact', ids: 'm3' }, '850')
  t.ok('факт записан на материал', p.mat('m3').fact === 850)
  const html = view(p, 'stage')
  t.ok('в строке разница со сметой', html.includes('+1 500 ₽ дороже сметы'))
  t.ok('в сводке перерасход', html.includes('перерасход +1 500 ₽'))
  t.ok('«потрачено» считается по факту', p.q('matStatus(supplyFindMat("m3"))').spent === 850 * 30)

  p.run('window._alerts=[];alert=function(m){window._alerts.push(m);};')
  change(p, { a: 'supply-fact', ids: 'm3' }, 'abc')
  t.ok('не число — объясняем и не пишем', p.q('window._alerts').length === 1 && p.mat('m3').fact === 850)
  change(p, { a: 'supply-fact', ids: 'm3' }, '800')
  t.ok('факт, равный смете, не храним', p.mat('m3').fact == null)
}

// ── 7. Корзина магазина и список текстом ────────────────────────────────────
{
  t.section('Корзина магазина')
  const p = boot(); seed(p)
  p.run('supplyStoreFilter="Озон";')
  const html = view(p, 'merge')
  t.ok('корзина закреплена снизу', html.includes('position:sticky;bottom:calc(var(--botbar'))
  t.ok('в ней «куплено всё» на остаток', html.includes('✓ Куплено 2'))
  t.ok('соседние магазины остаются чипами', html.includes('data-store="Лемана ПРО"'))
  t.ok('ТЗ только у офлайн-поставщика', !html.includes('data-a="supply-tz" data-store="Озон"'))
  p.run('supplyStoreFilter="Белка";')
  t.ok('у Белки ТЗ в корзине', view(p, 'merge').includes('data-a="supply-tz" data-store="Белка"'))

  p.run('supplyStoreFilter="Озон";'); catchUndo(p)
  click(p, { a: 'supply-stage-check', bulk: '1', ids: 'm1,m2', done: '0' })
  t.ok('корзина закрывается одной кнопкой', p.q('purchased').m1 === true && p.q('purchased').m2 === true)

  p.set({ purchased: { m3: true } })
  const text = p.run('supplyListText(supplyFilter(supplyCollect(objects).mats,true),"Закупка")')
  t.ok('в тексте магазины под одной вывеской', text.includes('Озон — 2 поз.') && !text.includes('Ozon'))
  t.ok('ссылки на товар в тексте', text.includes('https://www.ozon.ru/product/1'))
  t.ok('купленного в тексте нет', !text.includes('Брус'))
}

// ── 8. «Это работа» — в форме правки ────────────────────────────────────────
{
  t.section('«Это работа» в форме правки')
  const p = boot(); seed(p)
  t.ok('в строках пилюли нет', !view(p, 'stage').includes('🔨 это работа'))
  p.run('supplyEditMid="m1";supplyEditIds=[];')
  t.ok('в форме правки есть', view(p, 'stage').includes('data-a="supply-labour" data-ids="m1"'))
  click(p, { a: 'supply-labour', ids: 'm1' })
  t.ok('материал ушёл в работы', p.mat('m1').own === true)
  t.ok('форма закрылась', p.q('supplyEditMid') === null)
}

// ── 9. Шапка приложения ─────────────────────────────────────────────────────
{
  t.section('Роли в шапке')
  const p = boot(); seed(p)
  p.run('roles=[{id:"admin",n:"Администратор"},{id:"supply",n:"Снабженец"},{id:"fin",n:"Финансист"}];')
  const short = p.run('userRolesShort({roles:["admin","supply","fin"]})')
  t.ok('первая роль и «+2»', short.includes('Администратор') && short.includes('+2') && !short.includes('>Снабженец'))
  t.ok('полный список в подсказке', short.includes('title="Администратор, Снабженец, Финансист"'))
}

// ── 10. Общий модуль ────────────────────────────────────────────────────────
{
  t.section('src/supply.js')
  const m = { id: 'x', cost: 100, qty: 2 }
  t.ok('шаг: нужно', supplyStep(m, {}, {}) === 'need')
  t.ok('шаг: заказано', supplyStep({ ...m, ordAt: '2026-09-11' }, {}, {}) === 'ordered' && isOrdered({ ordAt: '2026-09-11' }))
  t.ok('шаг: куплено', supplyStep(m, { x: true }, {}) === 'bought')
  t.ok('принятое на склад — старше «куплено»', supplyStep(m, {}, { x: true }) === 'got')
  t.ok('факт: пусто и ноль — нет факта', factPrice(m) === null && factPrice({ fact: 0 }) === null && factPrice({ fact: 120 }) === 120)
  const ft = factTotals([{ ...m, fact: 120 }, { id: 'y', cost: 50, qty: 1 }, { id: 'z', cost: 10, qty: 1, fact: 5 }], { x: true, y: true })
  t.ok('разница только по купленному с фактом', ft.count === 1 && ft.delta === 40, JSON.stringify(ft))
  t.ok('потрачено по факту в старой схеме', needStatus('x', { ...m, fact: 120 }, [], { x: true }, {}).spent === 240)
}

t.done()
