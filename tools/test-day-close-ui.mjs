#!/usr/bin/env node
// Панельная половина закрытия дня: «Отчёт дня» на экране объекта, удержания в «Моей
// зарплате» и настройка во вкладке «Команда». Главное, что тут сторожится, — паритет с
// кроном: панель обязана называть день закрытым ровно тогда же, когда крон не штрафует
// (общий модуль src/dayclose.js). Разойдутся — человек видит галочку и теряет деньги.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const TODAY = new Date().toISOString().slice(0, 10)

function panel(extra) {
  const p = boot({})
  p.set(Object.assign({
    users: [
      { id: 'u1', name: 'Инна', roles: ['brigadier'], c: '#8e44ad', av: '👩', objs: [] },
      { id: 'u2', name: 'Валера', roles: ['brigadier'], c: '#e67e22', av: '👷', objs: [] },
    ],
    roles: [{ id: 'brigadier', n: 'Бригадир', c: '#e67e22' }, { id: 'admin', n: 'Админ', c: '#2980b9' }],
    objects: [{
      id: 'o1', icon: '🛁', name: 'Баня с хозблоком', dayReports: [],
      stages: [{ id: 's1', n: 'ЭТАП 2 — ЧЕРНОВЫЕ РАБОТЫ', c: '#2980b9', works: [
        { id: 'w1', n: 'Монтаж стен', cost: 6000, done: false, mats: [], timeLogs: [] },
      ] }],
    }],
    contractDocs: [{ id: 'c1', objId: 'o1', name: 'Договор №1', status: 'signed', amount: 900000,
      responsible: ['u1'], salaries: { u1: { plan: 100000 } }, extraWorksPlan: [] }],
    finTxns: [], issues: [], templates: [], crmClients: [], purchases: [], purchased: {}, arrived: {},
    receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {}, stock: [],
  }, extra || {}))
  // «Отчёт дня» на экране объекта — чип (OBJ_CHIP_KEYS): тело рисуется, только когда
  // чип раскрыт, поэтому раскрываем его руками.
  p.run('currentUser=users[0];tab="objects";openObject="o1";objWorkView="works";objSecOpen={"o1|dayreport":true};')
  return p
}
const card = (p) => p.run('tObjects()')
const plain = (h) => h.replace(/<[^>]*>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')

{
  t.section('Отчёт дня: пусто, под штрафом и закрытый день')
  const p = panel({ settings: { dayFine: { enabled: true, amount: 500, uids: ['u1'], from: '2026-01-01' } } })
  const c = plain(card(p))
  t.ok('день не закрыт — названа цена', /День не закрыт — утром 500 ₽/.test(c), c.slice(0, 500))
  // Свёрнутый чип — всё, что видно без тапа: там обязана быть цена незакрытого дня.
  t.ok('свёрнутый чип предупреждает с ценой', /не закрыт · 500 ₽/.test(c), c.slice(0, 400))
}
{
  t.section('Часы за день закрывают отчёт')
  const p = panel({ settings: { dayFine: { enabled: true, amount: 500, uids: ['u1'] } } })
  p.run('objects[0].stages[0].works[0].timeLogs=[{id:"t1",userId:"u1",date:"' + TODAY + '",hours:8}];')
  const c = plain(card(p))
  t.ok('есть записи за сегодня', /Есть записи за сегодня/.test(c), c.slice(0, 400))
  t.ok('про штраф больше не пишем', !/утром 500/.test(c), c.slice(0, 400))
}
{
  t.section('День закрыт на другом объекте — штрафа не будет, и панель это говорит')
  const p = panel({ settings: { dayFine: { enabled: true, amount: 500, uids: ['u1'] } } })
  p.run('objects.push({id:"o2",icon:"🏠",name:"Дом",dayReports:[],stages:[{id:"s2",n:"ЭТАП 1",c:"#27ae60",works:[{id:"w9",n:"Фундамент",done:false,mats:[],timeLogs:[{id:"t9",userId:"u1",date:"' + TODAY + '",hours:6}]}]}]});')
  const c = plain(card(p))
  t.ok('записи на другом объекте закрывают день', /День закрыт \(записи на другом объекте\)/.test(c), c.slice(0, 500))
}
{
  t.section('Выходной и отчёт текстом из бота видны в карточке')
  const p = panel({ settings: { dayFine: { enabled: true, amount: 500, uids: ['u1'] } } })
  p.run('objects[0].dayReports=[{id:"r1",userId:"u1",date:"' + TODAY + '",note:"возили доску, ждём кран"}];')
  const c = plain(card(p))
  t.ok('текст отчёта показан', /возили доску/.test(c), c.slice(0, 600))
  t.ok('день считается закрытым', !/День не закрыт/.test(c), c.slice(0, 600))
  p.run('objects[0].dayReports=[{id:"r1",userId:"u1",date:"' + TODAY + '",dayOff:true}];')
  t.ok('выходной показан', /Выходной/.test(plain(card(p))))
}
{
  t.section('Удержания уменьшают «осталось получить»')
  const p = panel({ finTxns: [
    { id: 'tx1', type: 'expense', category: '👷 Зарплата производства', amount: 40000, contractId: 'c1', objId: 'o1', userId: 'u1', date: TODAY },
    { id: 'tx2', type: 'expense', category: '⚠️ Штраф за незакрытый день', amount: 500, contractId: 'c1', objId: 'o1', userId: 'u1', date: TODAY, ref: 'dayfine:u1:' + TODAY },
  ] })
  const h = p.run('tFinanceMine(true)')
  const c = plain(h)
  // 100 000 плана − 40 000 выплат − 500 удержания = 59 500.
  t.ok('остаток посчитан за вычетом штрафа', /59 500/.test(c), c.slice(0, 900))
  t.ok('удержание названо отдельной строкой', /Удержано штрафов/.test(c) && /500/.test(c), c.slice(0, 900))
  t.ok('видно, что оно уже вычтено', /уже вычтено из «осталось получить»/.test(c), c.slice(0, 900))
}
{
  t.section('Настройка режима — во вкладке «Команда», только у админа')
  const p = panel({})
  p.run('currentUser=users[0];')
  t.ok('бригадир настройку не видит', p.run('tDayFine()') === '')
  p.run('currentUser=Object.assign({},users[0],{roles:["admin"]});settings={dayFine:{enabled:true,amount:500,uids:["u1"],softUntil:"2026-09-30"}};')
  const h = p.run('tDayFine()')
  t.ok('переключатель и расписание на месте', /Закрытие дня и штраф/.test(h) && /19:00/.test(h) && /09:00/.test(h), plain(h).slice(0, 400))
  t.ok('сумма и мягкий запуск редактируются', h.indexOf('data-a="dfine-amount"') >= 0 && h.indexOf('data-a="dfine-soft"') >= 0)
  t.ok('люди отмечаются галочками', h.indexOf('data-a="dfine-user"') >= 0 && /Инна/.test(h) && /Валера/.test(h))
  p.run('settings={};')
  t.ok('по умолчанию режим выключен и список скрыт', p.run('tDayFine()').indexOf('data-a="dfine-user"') < 0)
}

t.done()
