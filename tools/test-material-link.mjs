#!/usr/bin/env node
// Смоук-тест связи материала с карточкой каталога (public/admin.js).
//
//   npm run test:mats
//
// Материал работы раньше был снимком по имени: смета ссылалась на товар базы (pid),
// а при переносе в шаблон и объект ссылка терялась. Теперь pid едет по всей цепочке
// смета → шаблон → объект → закупка, и по нему собирается «где используется».
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_osb', name: 'ОСП 30 м²', unitCost: 710, store: 'Белка', mode: 'piece', sheetM2: 3.12 },
  { id: 'p_gvl', name: 'ГВЛВ 10 мм', unitCost: 900, store: 'Лемана', mode: 'piece' },
  { id: 'p_dup', name: 'Саморез', unitCost: 3, store: 'Лемана', mode: 'piece' },
  { id: 'p_dup2', name: 'Саморез', unitCost: 4, store: 'Озон', mode: 'piece' },   // тёзка: угадывать нельзя
]

// ── 1. Смета → работа: pid не теряется ───────────────────────────────────────
{
  t.section('Смета → работа')
  const p = boot()
  p.set({ expProducts: PRODUCTS, objects: [], templates: [] })
  const w = p.q('_tplEstWork({id:"e1",name:"Обрешётка",stage:2,lines:[{pid:"p_osb",qty:25}]})')
  t.ok('материал работы ссылается на товар каталога', w.mats[0].pid === 'p_osb',
    'без pid связь рвалась ровно здесь — дальше по цепочке шёл снимок по имени')
  t.ok('снимок цены и имени по-прежнему на месте', w.mats[0].n === 'ОСП 30 м²' && w.mats[0].cost === 710)
  t.ok('стоимость работы = сумма материалов', w.cost === 710 * 25)
}

// ── 2. Разовая доводка старых данных ─────────────────────────────────────────
{
  t.section('Доводка исторических данных (ensureMatPids)')
  const p = boot()
  p.set({
    expProducts: PRODUCTS,
    templates: [{ id: 't1', name: 'Баня 6×4', icon: '🛁', stages: [
      { id: 'ts1', n: 'ЭТАП 2', works: [{ id: 'tw1', n: 'Обрешётка', cost: 0, mats: [
        { id: 'tm1', n: 'ОСП 30 м²', cost: 710, qty: 20 },      // старая позиция без pid
        { id: 'tm2', n: 'Саморез', cost: 3, qty: 500 },          // имя неуникально
        { id: 'tm3', n: 'Что-то своё', cost: 100, qty: 1 },      // не из каталога
      ] }] },
    ] }],
    objects: [{ id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [
      { id: 's1', n: 'ЭТАП 2', works: [{ id: 'w1', n: 'Потолок', cost: 0, mats: [
        { id: 'm1', n: 'ГВЛВ 10 мм', cost: 900, qty: 8 },
        { id: 'm2', pid: 'p_osb', n: 'ОСП 30 м²', cost: 710, qty: 5 },   // ссылка уже есть
      ] }] },
    ] }],
  })
  const n = p.q('ensureMatPids()')
  t.ok('привязано ровно то, что можно привязать однозначно', n === 2, 'привязано: ' + n)
  t.ok('шаблон получил ссылку', p.q('templates[0].stages[0].works[0].mats[0]').pid === 'p_osb')
  t.ok('объект получил ссылку', p.q('objects[0].stages[0].works[0].mats[0]').pid === 'p_gvl')
  t.ok('тёзка оставлена без ссылки', p.q('templates[0].stages[0].works[0].mats[1]').pid === undefined,
    'в каталоге два «Саморез» — привязка к чужой карточке потом меняла бы не тот товар')
  t.ok('внекаталожная позиция не тронута', p.q('templates[0].stages[0].works[0].mats[2]').pid === undefined)
  t.ok('повторный прогон ничего не меняет', p.q('ensureMatPids()') === 0)
}

// ── 3. Где используется ──────────────────────────────────────────────────────
{
  t.section('Где используется')
  const p = boot()
  p.set({
    expProducts: PRODUCTS,
    templates: [{ id: 't1', name: 'Баня 6×4', icon: '🛁', stages: [
      { id: 'ts1', n: 'ЭТАП 2', works: [{ id: 'tw1', n: 'Обрешётка', cost: 0, mats: [
        { id: 'tm1', pid: 'p_osb', n: 'ОСП 30 м²', cost: 710, qty: 20 },
      ] }] },
    ] }],
    objects: [
      { id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [
        { id: 's1', n: 'ЭТАП 2', works: [
          { id: 'w1', n: 'Потолок', cost: 0, mats: [{ id: 'm1', pid: 'p_osb', n: 'ОСП 30 м²', cost: 710, qty: 15 }] },
          { id: 'w2', n: 'Пол', cost: 0, mats: [{ id: 'm2', n: 'ОСП 30 м²', cost: 650, qty: 10 }] },  // без pid, старая цена
        ] },
      ] },
      { id: 'o2', name: 'Дом на Дмитровке', icon: '🏠', stages: [
        { id: 's2', n: 'ЭТАП 3', works: [{ id: 'w3', n: 'Стены', cost: 0, mats: [{ id: 'm3', pid: 'p_gvl', n: 'ГВЛВ 10 мм', cost: 900, qty: 4 }] }] },
      ] },
    ],
  })
  const u = p.q('matUses("p_osb")')
  t.ok('шаблон найден', u.templates.length === 1 && u.templates[0].id === 't1')
  t.ok('объект найден один — второй на другом товаре', u.objects.length === 1 && u.objects[0].id === 'o1')
  t.ok('позиция без ссылки добрана по имени', u.objects[0].rows.length === 2,
    'иначе на карточке старого материала «где используется» пустовало бы')
  t.ok('посчитаны позиции и количество', u.mats === 3 && u.qty === 45, JSON.stringify([u.mats, u.qty]))
  t.ok('видно расхождение цены с базой', u.priceOff === 1)
  t.ok('названы работы, а не только объекты', u.objects[0].rows.map((r) => r.work).join(',') === 'Потолок,Пол')

  const html = p.run('expUsesHtml(expProducts[0])')
  t.ok('карточка показывает шаблоны и объекты', html.includes('ШАБЛОНЫ') && html.includes('ОБЪЕКТЫ'))
  t.ok('есть переход к объекту', html.includes('data-mat-goto="obj:o1"') && html.includes('data-mat-goto="tpl:t1"'))
  t.ok('предложено обновить цену по областям', html.includes('exp-uses-sync-obj') && !html.includes('exp-uses-sync-tpl'),
    'в шаблоне цена совпадает с базой — обновлять там нечего')
  t.ok('неиспользуемый товар говорит об этом прямо', p.run('expUsesHtml(expProducts[2])').includes('пока никуда не входит'))
}

// ── 4. Ручная синхронизация цены ─────────────────────────────────────────────
{
  t.section('Синхронизация цены с каталогом')
  const p = boot()
  p.set({
    expProducts: PRODUCTS,
    templates: [{ id: 't1', name: 'Баня', icon: '🛁', stages: [
      { id: 'ts1', n: 'ЭТАП 2', works: [{ id: 'tw1', n: 'Обрешётка', cost: 650 * 20, mats: [
        { id: 'tm1', pid: 'p_osb', n: 'ОСП 30 м²', cost: 650, qty: 20 },
      ] }] },
    ] }],
    objects: [{ id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [
      { id: 's1', n: 'ЭТАП 2', works: [{ id: 'w1', n: 'Потолок', cost: 650 * 15, mats: [
        { id: 'm1', pid: 'p_osb', n: 'ОСП 30 м²', cost: 650, qty: 15 },
      ] }] },
    ] }],
  })
  const n = p.q('matApplyCatalogPrice("p_osb","objects")')
  t.ok('обновлены только объекты', n === 1 && p.q('objects[0].stages[0].works[0].mats[0]').cost === 710)
  t.ok('стоимость работы пересчитана', p.q('objects[0].stages[0].works[0].cost') === 710 * 15)
  t.ok('шаблон не тронут — область выбирает человек', p.q('templates[0].stages[0].works[0].mats[0]').cost === 650)
  t.ok('повторный вызов ничего не меняет', p.q('matApplyCatalogPrice("p_osb","objects")') === 0)
  t.ok('шаблоны обновляются отдельной командой', p.q('matApplyCatalogPrice("p_osb","templates")') === 1
    && p.q('templates[0].stages[0].works[0].cost') === 710 * 20)
}

// ── 5. Добавление из каталога и объект из шаблона ────────────────────────────
{
  t.section('Добавление из каталога')
  const p = boot()
  p.set({
    expProducts: PRODUCTS,
    templates: [{ id: 't1', name: 'Баня', icon: '🛁', stages: [
      { id: 'ts1', n: 'ЭТАП 2', works: [{ id: 'tw1', n: 'Обрешётка', cost: 0, mats: [
        { id: 'tm1', pid: 'p_osb', n: 'ОСП 30 м²', cost: 710, qty: 20 },
      ] }] },
    ] }],
    objects: [{ id: 'o1', name: 'Баня на Киевке', icon: '🛁', templateId: 't1', stages: [
      { id: 's1', n: 'ЭТАП 2', works: [] },
    ] }],
  })
  p.q('supplyAddFromCatalog("o1","s1","p_gvl")')
  const mats = p.q('objects[0].stages[0].works[0].mats')
  t.ok('докупка снабженца ссылается на каталог', mats.length === 1 && mats[0].pid === 'p_gvl')
  p.q('supplyAddFromCatalog("o1","s1","p_gvl")')
  t.ok('повторное добавление увеличивает количество, а не плодит строки',
    p.q('objects[0].stages[0].works[0].mats').length === 1 && p.q('objects[0].stages[0].works[0].mats')[0].qty === 2)

  // Объект из шаблона — глубокая копия со свежими id материалов, но с той же ссылкой.
  const copied = p.q('reidStages(templates[0].stages)')
  const m = copied[0].works[0].mats[0]
  t.ok('копия получила новый id позиции', m.id !== 'tm1')
  t.ok('копия сохранила ссылку на каталог', m.pid === 'p_osb')
}

t.done()
