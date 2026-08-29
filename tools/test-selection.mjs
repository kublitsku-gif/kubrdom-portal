#!/usr/bin/env node
// Позиции «выбор клиента» с бюджетом (public/admin.js + src/supply.js).
//
// Плитку, печь и двери клиент меняет почти всегда, и до сих пор каждая такая замена шла
// как исключение. Сторожим главное: бюджет решает, нужна ли бумага, а не общий порог.
import { boot, reporter } from './harness/panel-vm.js'
import { pendingSelections } from '../src/supply.js'

const t = reporter()

const TODAY = '2026-09-10'

function panel() {
  const p = boot()
  p.set({
    expProducts: [
      { id: 'p_tile', name: 'Плитка базовая', unitCost: 1000, store: 'Лемана', mode: 'piece' },
      { id: 'p_cheap', name: 'Плитка эконом', unitCost: 800, store: 'Лемана', mode: 'piece' },
      { id: 'p_lux', name: 'Плитка премиум', unitCost: 1400, store: 'Лемана', mode: 'piece' },
    ],
    objects: [{ id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [{ id: 's1', n: 'ЭТАП 3', works: [
      { id: 'w1', n: 'Санузел', cost: 20000, mats: [
        { id: 'm1', pid: 'p_tile', n: 'Плитка базовая', cost: 1000, qty: 20, mode: 'piece', store: 'Лемана', sel: true, selDue: '2026-09-05' },
        { id: 'm2', pid: 'p_tile', n: 'Клей', cost: 500, qty: 4, mode: 'piece', store: 'Лемана' },
      ] },
    ] }] }],
    contractDocs: [{ id: 'c1', objId: 'o1', status: 'signed', client: 'Любовь' }],
    users: [], issues: [], purchased: {}, arrived: {}, purchases: [], stock: [], settings: {},
  })
  p.run('currentUser={id:"u1",name:"Снабженец",roles:["supply"],objs:[],c:"#000",av:"📦"};')
  return p
}

// ── 1. Бюджет и просрочка ────────────────────────────────────────────────────
{
  t.section('Бюджет выбора')
  const p = panel()
  t.ok('бюджет — это сумма позиции в смете', p.q('matSelBudget(objects[0].stages[0].works[0].mats[0])') === 20000)
  t.ok('обычная позиция выбором не считается', p.q('matIsSel(objects[0].stages[0].works[0].mats[1])') === false)
  const pend = p.q('objSelPending(objects[0]).map(x=>x.mat.id)')
  t.ok('невыбранная позиция в списке ожидания', pend.join(',') === 'm1', JSON.stringify(pend))
  p.run('objects[0].stages[0].works[0].mats[0].selDone="2026-09-09";')
  t.ok('после выбора из ожидания уходит', p.q('objSelPending(objects[0]).length') === 0)
}

// ── 2. Сортировка и просрочка — общий модуль ─────────────────────────────────
{
  t.section('Общий предикат (src/supply.js)')
  const objs = [{ id: 'o', name: 'O', stages: [{ id: 's', n: 'E', works: [{ id: 'w', n: 'W', mats: [
    { id: 'a', n: 'Печь', sel: true, selDue: '2026-09-20' },
    { id: 'b', n: 'Плитка', sel: true, selDue: '2026-09-01' },
    { id: 'c', n: 'Двери', sel: true, selDone: '2026-09-02', selDue: '2026-08-20' },
    { id: 'd', n: 'Клей' },
  ] }] }] }]
  const pend = pendingSelections(objs, TODAY)
  t.ok('выбранное и обычное отсеяны', pend.map((x) => x.mat.id).join(',') === 'b,a', pend.map((x) => x.mat.id).join(','))
  t.ok('просроченное впереди', pend[0].overdue === true && pend[1].overdue === false)
}

// ── 3. Замена в пределах бюджета — без бумаг ─────────────────────────────────
{
  t.section('Замена внутри бюджета')
  const p = panel()
  p.run('supplyEditIds=[];supplyEditMid="m1";')
  const fill = (name, cost) => {
    p.dom.field('sem-n', name); p.dom.field('sem-mode', 'piece'); p.dom.field('sem-cost', String(cost))
    p.dom.field('sem-store', 'Лемана'); p.dom.field('sem-note', ''); p.dom.field('sem-qty', '20')
    p.dom.field('sem-reason', ''); p.dom.field('sem-payer', 'company')
    p.dom.field('sem-sel-due', '2026-09-05')
    p.dom.field('sem-sel', 'on')      // в модалке чекбокс отражает текущее состояние позиции
  }
  fill('Плитка эконом', 800)
  t.ok('дешевле бюджета — согласование не нужно', p.q('supplyNeedsApproval(supplyEditForm())') === false)
  fill('Плитка базовая', 1000)
  t.ok('вровень с бюджетом — тоже', p.q('supplyNeedsApproval(supplyEditForm())') === false)
}

// ── 4. Выход за бюджет согласуется всегда ────────────────────────────────────
{
  t.section('Выход за бюджет')
  const p = panel()
  p.run('supplyEditIds=[];supplyEditMid="m1";')
  p.dom.field('sem-n', 'Плитка премиум'); p.dom.field('sem-mode', 'piece'); p.dom.field('sem-cost', '1400')
  p.dom.field('sem-store', 'Лемана'); p.dom.field('sem-note', ''); p.dom.field('sem-qty', '20')
  p.dom.field('sem-reason', 'клиент выбрал другую')
  p.dom.field('sem-sel-due', '2026-09-05'); p.dom.field('sem-sel', 'on')
  // Форма для позиции выбора открывается с «за счёт клиента» — берём то же значение.
  p.dom.field('sem-payer', 'client')

  const d = p.q('matChangeDelta(supplyEditForm())')
  t.ok('разница посчитана', d === 8000, String(d))
  t.ok('порог тут ни при чём — согласование обязательно',
    p.q('supplyNeedsApproval(supplyEditForm())') === true,
    'разница 8 000 ₽ ниже порога в 10 000, но это бюджет выбора клиента')

  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  const iss = p.q('issues')
  t.ok('заявка заведена', iss.length === 1 && iss[0].kind === 'matchg', JSON.stringify(iss.map((x) => x.kind)))
  t.ok('в заявке — за счёт клиента', iss[0].payer === 'client')
  // Сам дефолт живёт в форме, а не в подмене на отправке: человек его видит и может сменить.
  p.run('supplyEditIds=[];supplyEditMid="m1";')
  const modal = p.run('tSupplyDetail({o1:true},"stage")')
  t.ok('форма открывается с «за счёт клиента»', /<option value="client" selected>/.test(modal),
    'позицию выбрал клиент — согласующий не должен вспоминать это сам')
  t.ok('материал пока прежний', p.mat('m1').n === 'Плитка базовая')
}

// ── 5. Состоявшийся выбор закрывает ожидание ─────────────────────────────────
{
  t.section('Выбор состоялся')
  const p = panel()
  p.run('currentUser={id:"u2",name:"Админ",roles:["admin"],objs:[],c:"#000",av:"⚙️"};')
  p.run('supplyEditIds=[];supplyEditMid="m1";')
  p.dom.field('sem-n', 'Плитка премиум'); p.dom.field('sem-mode', 'piece'); p.dom.field('sem-cost', '1400')
  p.dom.field('sem-store', 'Лемана'); p.dom.field('sem-note', ''); p.dom.field('sem-qty', '20')
  p.dom.field('sem-reason', ''); p.dom.field('sem-payer', 'client')
  p.dom.field('sem-sel-due', '2026-09-05'); p.dom.field('sem-sel', 'on')
  const save = p.dom.node({ a: 'supply-mat-save' })
  p.run('bind();')
  save.onclick()
  t.ok('замена применена (админ согласует сам)', p.mat('m1').n === 'Плитка премиум')
  t.ok('позиция помечена выбранной', !!p.mat('m1').selDone, JSON.stringify(p.mat('m1')))
  t.ok('и ушла из ожидания', p.q('objSelPending(objects[0]).length') === 0)
  t.ok('метка «выбор клиента» осталась', p.mat('m1').sel === true,
    'по ней видно, чья это была позиция и сколько закладывали')
}

// ── 6. Что видит клиент ──────────────────────────────────────────────────────
{
  t.section('Кабинет клиента')
  const p = panel()
  const html = p.run('clientProjectContent(contractDocs[0],"objects")')
  t.ok('позиция показана клиенту', html.includes('ЖДЁМ ВАШЕГО ВЫБОРА') && html.includes('Плитка базовая'))
  t.ok('назван бюджет, а не «доплатите»', html.includes((20000).toLocaleString('ru-RU')) && html.includes('заложено'))
  t.ok('срок виден', html.includes('05.09'))
}

t.done()
