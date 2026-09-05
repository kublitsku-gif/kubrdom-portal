#!/usr/bin/env node
// Смоук-тест заявки на замену материала (public/admin.js).
//
//   npm run test:change
//
// Замена по ходу стройки — это деньги: снабженец видит разницу до сохранения, дорогая
// замена уходит заявкой тому, кто отвечает за деньги, и уже оттуда попадает в доп работы.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_osb', name: 'ОСП 30 м²', unitCost: 710, store: 'Белка', mode: 'piece', sheetM2: 3.12 },
  { id: 'p_gvl', name: 'ГВЛВ 10 мм', unitCost: 1200, store: 'Лемана', mode: 'piece' },
  { id: 'p_cheap', name: 'ОСП эконом', unitCost: 600, store: 'Лемана', mode: 'piece' },
]

// Снабженец: согласовывать сам себе не может — именно для него порог и написан.
const SUPPLY_USER = '{id:"u_sup",name:"Снабженец",roles:["supply"],objs:[],c:"#000",av:"📦"}'

function seed(p, { role = SUPPLY_USER } = {}) {
  const mat = (id, qty) => ({ id, pid: 'p_osb', n: 'ОСП 30 м²', cost: 710, qty, store: 'Белка', mode: 'piece', sheetM2: 3.12 })
  p.set({
    expProducts: PRODUCTS,
    objects: [{ id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [
      { id: 's1', n: 'ЭТАП 2', c: '#2980b9', works: [
        { id: 'w1', n: 'Обрешётка', cost: 710 * 25, mats: [mat('m1', 25)] },
        { id: 'w2', n: 'Потолок', cost: 710 * 15, mats: [mat('m2', 15)] },
      ] },
    ] }],
    contractDocs: [{ id: 'c1', objId: 'o1', status: 'signed', client: 'Любовь', extraWorksPlan: [] }],
    issues: [], purchased: {}, arrived: {}, purchases: [], templates: [], users: [], finTxns: [], settings: {},
  })
  p.run(`currentUser=${role};`)
}

// Заполнить модалку так, как это сделал бы человек
function fill(p, { name, cost, qty = {}, reason = '', payer = 'company' }) {
  p.dom.field('sem-n', name); p.dom.field('sem-mode', 'piece'); p.dom.field('sem-cost', String(cost))
  p.dom.field('sem-store', ''); p.dom.field('sem-note', '')
  p.dom.field('sem-reason', reason); p.dom.field('sem-payer', payer)
  Object.entries(qty).forEach(([id, v]) => p.dom.field('sem-q-' + id, String(v)))
  p.dom.field('sem-delta', ''); p.dom.field('sem-hint', ''); p.dom.field('sem-save', '')
}

// ── 1. Разница считается до сохранения ───────────────────────────────────────
{
  t.section('Разница со сметой')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1","m2"];supplyEditMid="m1";')
  fill(p, { name: 'ГВЛВ 10 мм', cost: 1200, qty: { m1: 25, m2: 15 } })
  const chg = p.q('supplyEditForm()')
  t.ok('форма собрала все позиции', chg.ids.join(',') === 'm1,m2')
  t.ok('ссылка на товар каталога определена по названию', chg.pid === 'p_gvl')
  t.ok('разница = 40 × (1200 − 710)', p.q('matChangeDelta(supplyEditForm())') === 40 * 490)
  fill(p, { name: 'ОСП эконом', cost: 600, qty: { m1: 25, m2: 15 } })
  t.ok('удешевление даёт минус', p.q('matChangeDelta(supplyEditForm())') === -40 * 110)
  fill(p, { name: 'ОСП 30 м²', cost: 710, qty: { m1: 25, m2: 15 } })
  t.ok('без правки разницы нет', p.q('matChangeDelta(supplyEditForm())') === 0)
}

// ── 2. Дорогая замена уходит заявкой, а не в объект ──────────────────────────
{
  t.section('Заявка вместо тихой правки')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1","m2"];supplyEditMid="m1";')
  fill(p, { name: 'ГВЛВ 10 мм', cost: 1200, qty: { m1: 25, m2: 15 } })
  t.ok('порог сработал', p.q('supplyNeedsApproval(supplyEditForm())') === true, 'разница 19 600 ₽ выше порога в 10 000')

  // без причины заявку не принимаем
  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  t.ok('без причины заявка не создаётся', p.q('issues').length === 0)

  fill(p, { name: 'ГВЛВ 10 мм', cost: 1200, qty: { m1: 25, m2: 15 }, reason: 'нет в наличии', payer: 'client' })
  save.onclick()
  const iss = p.q('issues')
  t.ok('заявка создана', iss.length === 1 && iss[0].kind === 'matchg')
  t.ok('заявка ждёт решения', iss[0].status === 'hold' && iss[0].to === 'financier')
  t.ok('в заявке сумма разницы', iss[0].amount === 40 * 490)
  t.ok('в заявке лежит сама правка', (iss[0].mat.ids || []).join(',') === 'm1,m2' && iss[0].mat.pid === 'p_gvl')
  t.ok('текст заявки читаем', /ОСП 30 м² → ГВЛВ 10 мм · 2 поз/.test(iss[0].text), iss[0].text)
  t.ok('материал в объекте ПОКА не тронут', p.mat('m1').n === 'ОСП 30 м²' && p.q('objects[0].stages[0].works[0].cost') === 710 * 25,
    'до утверждения правка не должна доезжать до стройки')
  t.ok('модалка закрыта', p.q('supplyEditMid') === null)

  const html = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('в списке видно, что замена на согласовании', html.includes('замена на согласовании'))
}

// ── 3. Мелкая правка идёт напрямую ───────────────────────────────────────────
{
  t.section('Мелкая правка без заявки')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1"];supplyEditMid="m1";')
  fill(p, { name: 'ОСП 30 м²', cost: 730, qty: { m1: 25 } })   // +500 ₽
  t.ok('порог не сработал', p.q('supplyNeedsApproval(supplyEditForm())') === false)
  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  t.ok('заявка не заводилась', p.q('issues').length === 0)
  t.ok('правка применена сразу', p.mat('m1').cost === 730)
}

// ── 4. Тот, кто отвечает за деньги, правит без заявки ────────────────────────
{
  t.section('Согласующий правит сам')
  const p = boot(); seed(p, { role: '{id:"u_a",name:"Админ",roles:["admin"],objs:[],c:"#000",av:"⚙️"}' })
  p.run('supplyEditIds=["m1","m2"];supplyEditMid="m1";')
  fill(p, { name: 'ГВЛВ 10 мм', cost: 1200, qty: { m1: 25, m2: 15 } })
  t.ok('заявка ему не нужна', p.q('supplyNeedsApproval(supplyEditForm())') === false, 'админ согласовывает сам')
  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  t.ok('правка применена напрямую', p.mat('m1').n === 'ГВЛВ 10 мм' && p.q('issues').length === 0)
}

// ── 5. Утверждение заявки применяет правку и рождает доп работу ──────────────
{
  t.section('Утверждение заявки')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1","m2"];supplyEditMid="m1";')
  fill(p, { name: 'ГВЛВ 10 мм', cost: 1200, qty: { m1: 25, m2: 15 }, reason: 'изменение проекта', payer: 'client' })
  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  const iid = p.q('issues')[0].id

  // применяет уже согласующий
  p.run('currentUser={id:"u_a",name:"Админ",roles:["admin"],objs:[],c:"#000",av:"⚙️"};')
  const card = p.run(`buildIssuesSection(objects[0])`)
  t.ok('в карточке видно «было → стало»', card.includes('ОСП 30 м²') && card.includes('ГВЛВ 10 мм'))
  t.ok('в карточке видна разница', card.includes('+' + (40 * 490).toLocaleString('ru-RU') + ' ₽'), 'сумма должна читаться без открытия заявки')
  t.ok('есть кнопка применения', card.includes('data-a="iss-mat-apply" data-iid="' + iid + '"'))

  const apply = p.dom.node({ a: 'iss-mat-apply', iid })
  p.run('bind();')
  apply.onclick()

  t.ok('материал заменён в обеих работах', p.mat('m1').n === 'ГВЛВ 10 мм' && p.mat('m2').n === 'ГВЛВ 10 мм')
  t.ok('ссылка на каталог переехала', p.mat('m1').pid === 'p_gvl')
  t.ok('стоимость работ пересчитана', p.q('objects[0].stages[0].works[0].cost') === 1200 * 25)
  const done = p.q('issues')[0]
  t.ok('заявка закрыта с ответом', done.status === 'done' && /применена в 2 поз/.test(done.answer), done.answer)
  const plan = p.q('contractDocs')[0].extraWorksPlan
  t.ok('разница за счёт клиента ушла в план доп работ', plan.length === 1 && plan[0].amount === 40 * 490, JSON.stringify(plan))
  t.ok('в названии доп работы виден новый материал', /ГВЛВ 10 мм/.test(plan[0].title), plan[0].title)
}

// ── 6. За счёт компании доп работу не заводим ────────────────────────────────
{
  t.section('Разница за счёт компании')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1","m2"];supplyEditMid="m1";')
  fill(p, { name: 'ГВЛВ 10 мм', cost: 1200, qty: { m1: 25, m2: 15 }, reason: 'наш просчёт', payer: 'company' })
  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  p.run('currentUser={id:"u_a",name:"Админ",roles:["admin"],objs:[],c:"#000",av:"⚙️"};')
  const apply = p.dom.node({ a: 'iss-mat-apply', iid: p.q('issues')[0].id })
  p.run('bind();')
  apply.onclick()
  t.ok('правка применена', p.mat('m1').n === 'ГВЛВ 10 мм')
  t.ok('счёт клиенту не выставлен', p.q('contractDocs')[0].extraWorksPlan.length === 0,
    'разница за наш счёт — это убыток компании, а не доп работа')
}

// ── 7. Позиция исчезла, пока заявка ждала ────────────────────────────────────
{
  t.section('Позиции из заявки больше нет')
  const p = boot(); seed(p)
  p.run('supplyEditIds=["m1"];supplyEditMid="m1";')
  fill(p, { name: 'ГВЛВ 10 мм', cost: 1200, qty: { m1: 60 }, reason: 'нет в наличии' })
  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  t.ok('заявка создана', p.q('issues').length === 1)
  p.run('supplyRemoveMat("m1");')                       // материал убрали из объекта
  p.run('currentUser={id:"u_a",name:"Админ",roles:["admin"],objs:[],c:"#000",av:"⚙️"};')
  const apply = p.dom.node({ a: 'iss-mat-apply', iid: p.q('issues')[0].id })
  p.run('bind();')
  apply.onclick()
  const iss = p.q('issues')[0]
  t.ok('заявка отклонена, а не применена вслепую', iss.status === 'rejected' && /больше нет/.test(iss.answer), iss.answer)
}

// ── 8. Порог настраивается ───────────────────────────────────────────────────
{
  t.section('Порог согласования')
  const p = boot(); seed(p)
  t.ok('по умолчанию 10 000 ₽', p.q('matChangeLimit()') === 10000)
  p.run('settings={matChangeLimit:1000};')
  p.run('supplyEditIds=["m1"];supplyEditMid="m1";')
  fill(p, { name: 'ОСП 30 м²', cost: 760, qty: { m1: 25 } })   // +1 250 ₽
  t.ok('свой порог учитывается', p.q('supplyNeedsApproval(supplyEditForm())') === true)
  p.run('settings={matChangeLimit:0};')
  fill(p, { name: 'ОСП 30 м²', cost: 710, qty: { m1: 25 } })
  t.ok('правка без разницы проходит и при нулевом пороге', p.q('supplyNeedsApproval(supplyEditForm())') === false,
    'иначе на согласование ушло бы исправление опечатки в заметке')
}

// ── Цена в подсказках поиска ────────────────────────────────────────────────
// Выбирая материал по названию, человек выбирает и цену — а её в подсказках не
// было видно. «ОСП» в базе несколько, и какая из них за 710, а какая за 600,
// выяснялось уже после добавления строки.
{
  t.section('Подсказки материалов показывают цену')
  const p = boot({})
  p.set({
    expProducts: [
      { id: 'p1', name: 'ОСП 30 м²', unitCost: 710, store: 'Белка', mode: 'piece' },
      { id: 'p2', name: 'Труба профильная 60x40x2 мм 3 м', unitCost: 298.67, store: 'Лемана', mode: 'mp', lenPer: 3 },
      { id: 'p3', name: 'Плитка Маттоне', unitCost: 1086, store: 'Лемана', mode: 'pack', packPer: 0.96, packBase: 'м²' },
      { id: 'p4', name: 'Без цены', unitCost: 0, store: '', mode: 'piece' },
    ],
    estimates: [], dbPlans: [], crmClients: [], specSheets: [], specSheets2: [], winTypes: [],
    objects: [], templates: [], contractDocs: [], purchases: [], issues: [], users: [], stock: [],
    settings: {}, buildRules: [],
  })
  const html = p.run('matPickOptions()').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('название остаётся значением', /value="ОСП 30 м²"/.test(html), html.slice(0, 120))
  t.ok('цена за штуку видна', /label="710 ₽\/шт/.test(html), html)
  // Единица — та, в которой товар продают: труба в метрах, плитка в пачках.
  t.ok('метры погонные — своей единицей', /label="298,67 ₽\/м\.п\./.test(html), html)
  t.ok('пачка — своей', /label="1 086 ₽\/пачка/.test(html), html)
  t.ok('магазин подсказан рядом', /· Белка/.test(html) && /· Лемана/.test(html))
  // У товара без цены подсказка не врёт «0 ₽» — там просто нечего показать.
  t.ok('без цены — без ценника', !/label="0 ₽/.test(html), html)

  // Тот же список во всех местах, где ищут материал: смета, замена, объект, приёмка.
  const est = p.run('matAddOpen="k1";matAddHtml({key:"k1"})').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('в форме «+ материал» цена есть', /label="710 ₽/.test(est), 'нет цены в подсказках сметы')
}

t.done()
