#!/usr/bin/env node
// Карточка договора короче (public/admin.js): 18 блоков подряд и 3 092 px — это 4,5
// экрана телефона. Сторожим новую раскладку: разделы в закреплённой шапке, оплату и
// дедлайны в сводке, клиента одной строкой, один блок выплат и один блок файлов,
// пустое — строкой, ответственных — только назначенных, «удалить» — в меню. И то,
// что черновик на объекте больше не перебивает подписанный договор.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

function panel(opts) {
  const p = boot(opts || {})
  p.set({
    users: [
      { id: 'u1', name: 'Инна', roles: ['brigadier'], c: '#8e44ad', av: '👩', objs: [] },
      { id: 'u2', name: 'Александр', roles: ['sales_head'], c: '#7f8c8d', av: '👷', objs: [] },
      { id: 'u3', name: 'Юрий', roles: ['admin'], c: '#2980b9', av: '👨', objs: [] },
    ],
    roles: [{ id: 'brigadier', n: 'Бригадир' }, { id: 'sales_head', n: 'РОП' }, { id: 'admin', n: 'Админ' }],
    crmClients: [{ id: 'k1', name: 'Кутьин Алексей Владимирович', phone: '+79495603538', stage: 'contract', source: 'Авито', notes: '', msg: '' }],
    templates: [],
    objects: [
      { id: 'oSVO', icon: '🏠', name: 'Дом СВО', stages: [{ id: 's1', n: 'Этап 1', works: [{ id: 'w1', n: 'Работа', mats: [] }] }] },
      { id: 'oFree', icon: '🏠', name: 'Свободный', stages: [] },
    ],
    contractDocs: [
      { id: 'cK', name: 'Договор подряда № 2108-1/26', type: 'extra', status: 'signed', amount: 1752000, signDate: '2026-08-21',
        deadlineDate: '2026-12-07', client: 'Кутьин Алексей Владимирович', crmClientId: 'k1', objId: 'oSVO', note: 'Дом 12 м',
        responsible: ['u1', 'u2'], salaries: {}, extraWorks: [], extraWorksPlan: [],
        deadlines: { u1: { startDate: '2026-09-01', deadline: '2099-10-20' } },
        tranches: [{ id: 't1', title: 'Аванс', amount: 1050000, paidAt: '2026-08-22' }],
        files: [
          { id: 'f1', kind: 'contract', name: 'Договор.pdf', data: 'https://x/f1.pdf', mime: 'application/pdf' },
          { id: 'f2', kind: 'plan', name: 'План.png', data: 'https://x/p.png', mime: 'image/png' },
        ] },
      { id: 'c59', name: 'Договор №59 — Дом СВО', type: 'main', status: 'draft', amount: 1039684, objId: 'oSVO',
        client: '', responsible: [], salaries: {}, extraWorks: [], files: [] },
      { id: 'cNew', name: 'Договор № 3009-1/26', type: 'main', status: 'signed', amount: 900000, objId: '',
        client: 'Петров', responsible: [], salaries: {}, extraWorks: [], files: [] },
    ],
    finTxns: [], receipts: [], issues: [], purchases: [], estimates: [], expProducts: [],
    specSheets: [], specSheets2: [], projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {},
  })
  p.run('tab="contracts";ctSubTab="list";contractView="cK";')
  return p
}
const view = (p, cid) => p.run('tContractDetail(' + JSON.stringify(cid || 'cK') + ')')
const plain = (h) => h.replace(/<[^>]*>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')
const click = (p, dataset) => { const n = p.dom.node(dataset); p.run('bind();'); n.onclick && n.onclick({ stopPropagation() {}, target: {} }); return n }
const sec = (p, s) => click(p, { a: 'ct-sec', cid: 'cK', sec: s })

{
  t.section('Разделы и закреплённая шапка')
  const p = panel()
  const h = view(p)
  t.ok('четыре раздела', ['main', 'money', 'people', 'files'].every((s) => h.indexOf('data-a="ct-sec" data-cid="cK" data-sec="' + s + '"') >= 0))
  t.ok('шапка закреплена', /position:sticky/.test(h.slice(0, h.indexOf('data-sec="files"') + 200)))
  const head = plain(h.slice(0, h.indexOf('data-sec="main"')))
  t.ok('в шапке сумма и статус', /1 752 000/.test(head) && /Подписан/.test(head), head)
  const txt = plain(h)
  t.ok('«Главное» не тянет за собой деньги, людей и файлы',
    !/ГРАФИК ПЛАТЕЖЕЙ/.test(txt) && !/ВЫПЛАТЫ/.test(txt) && !/ОТВЕТСТВЕННЫЕ/.test(txt) && !/ФАЙЛЫ/.test(txt), txt.slice(0, 500))
  t.ok('удалить договор — не в теле карточки', h.indexOf('data-a="ct-delete"') < 0)
  click(p, { a: 'ct-menu', cid: 'cK' })
  t.ok('а в меню «⋯»', view(p).indexOf('data-a="ct-delete" data-cid="cK"') >= 0)
}

{
  t.section('Сводка: оплата клиента и дедлайны бригадиров')
  const p = panel()
  const txt = plain(view(p))
  t.ok('оплачено из суммы', /Оплачено 1 050 000 из 1 752 000/.test(txt), txt.slice(0, 700))
  t.ok('и сколько не расписано', /не расписано 702 000/.test(txt))
  t.ok('кнопка к графику ведёт в «Деньги»', view(p).indexOf('data-a="ct-sec" data-cid="cK" data-sec="money"') >= 0)
  t.ok('дедлайн бригадира строкой', /Инна[^·]*осталось/i.test(txt), txt.slice(0, 900))
}

{
  t.section('Клиент — одной строкой')
  const p = panel()
  const h = view(p)
  const txt = plain(h)
  t.ok('имя, CRM и PIN — в карточке', /Кутьин Алексей Владимирович/.test(txt) && h.indexOf('data-a="ct-goto-crm"') >= 0 && h.indexOf('data-a="ct-pin-open" data-cid="cK"') >= 0)
  t.ok('строки «Клиент» в деталях больше нет', !/Клиент\s+Кутьин/.test(txt))
  t.ok('поле PIN — только по тапу', h.indexOf('data-a="ct-clientpin-save"') < 0)
}

{
  t.section('Деньги: график и один блок выплат')
  const p = panel()
  sec(p, 'money')
  const h = view(p)
  const txt = plain(h)
  t.ok('график платежей здесь', /ГРАФИК ПЛАТЕЖЕЙ/.test(txt))
  t.ok('выплаты — одним блоком', /ВЫПЛАТЫ/.test(txt) && !/ЗАРПЛАТА ПРОИЗВОДСТВУ/.test(txt) && !/ЗАРПЛАТА РОПа/.test(txt), txt.slice(0, 600))
  t.ok('по строке на человека', h.indexOf('data-a="ct-pay-open" data-k="cK:u1"') >= 0 && h.indexOf('data-a="ct-pay-open" data-k="cK:u2"') >= 0)
  t.ok('поля плана — только по тапу', h.indexOf('id="ctsal-plan-cK-u1"') < 0)
  click(p, { a: 'ct-pay-open', k: 'cK:u1' })
  t.ok('раскрыли Инну — поле плана на месте', view(p).indexOf('id="ctsal-plan-cK-u1"') >= 0)
  t.ok('пустые доп. работы — не карточка', !/Нет дополнительных работ|Нет работ\. Нажмите/.test(txt))
  t.ok('но добавить можно', h.indexOf('data-a="ct-extra-add" data-cid="cK"') >= 0)
}

{
  t.section('Люди: только назначенные')
  const p = panel()
  sec(p, 'people')
  const h = view(p)
  const txt = plain(h)
  t.ok('назначенные видны', /ОТВЕТСТВЕННЫЕ/.test(txt) && /Инна/.test(txt) && /Александр/.test(txt))
  t.ok('неназначенных не видно', !/Юрий/.test(txt))
  t.ok('случайно снять нельзя — переключатели по кнопке', h.indexOf('data-a="ct-resp-toggle"') < 0 && h.indexOf('data-a="ct-resp-edit" data-cid="cK"') >= 0)
  click(p, { a: 'ct-resp-edit', cid: 'cK' })
  t.ok('в правке — все сотрудники', view(p).indexOf('data-a="ct-resp-toggle" data-cid="cK" data-uid="u3"') >= 0)
  t.ok('дедлайны бригадиров здесь', /ДЕДЛАЙНЫ БРИГАДИРОВ/.test(txt))
}

{
  t.section('Файлы: один блок, пустое — строкой')
  const p = panel()
  sec(p, 'files')
  const h = view(p)
  const txt = plain(h)
  t.ok('один блок со счётом', /ФАЙЛЫ · 2/.test(txt), txt.slice(0, 400))
  t.ok('без отдельных карточек по типам', !/ФАЙЛ ДОГОВОРА/.test(txt) && !/Нет файлов\. Нажмите/.test(txt))
  t.ok('добавить можно любой тип', ['contract', 'plan', 'spec', 'act', 'wind'].every((k) => h.indexOf('data-a="ct-file-label" data-cid="cK" data-kind="' + k + '"') >= 0))
  t.ok('и планировку из базы', h.indexOf('data-a="ct-plan-pick" data-cid="cK"') >= 0)
  t.ok('файл открывается', h.indexOf('https://x/f1.pdf') >= 0)
}

{
  t.section('Черновик на объекте не перебивает подписанный')
  const p = panel()
  const h = view(p)
  const txt = plain(h)
  t.ok('в сводке — кто ещё на объекте', /на объекте ещё/i.test(txt) && /№59/.test(txt) && /черновик/i.test(txt), txt.slice(0, 900))
  t.ok('и «сделать основным»', h.indexOf('data-a="ct-make-main" data-cid="cK"') >= 0)
  click(p, { a: 'ct-make-main', cid: 'cK' })
  t.ok('этот стал основным', p.q('contractDocs.find(function(c){return c.id==="cK";}).type') === 'main')
  t.ok('черновик — доп. работами', p.q('contractDocs.find(function(c){return c.id==="c59";}).type') === 'extra')

  const yes = panel({ confirm: true })
  click(yes, { a: 'ct-objpick-do', cid: 'cNew', oid: 'oSVO' })
  t.ok('подписанный к объекту с черновиком — привязан основным', yes.q('contractDocs.find(function(c){return c.id==="cNew";}).objId') === 'oSVO'
    && yes.q('contractDocs.find(function(c){return c.id==="cNew";}).type') === 'main')
  t.ok('а черновик стал доп. работами', yes.q('contractDocs.find(function(c){return c.id==="c59";}).type') === 'extra')
  const no = panel({ confirm: false })
  click(no, { a: 'ct-objpick-do', cid: 'cNew', oid: 'oSVO' })
  t.ok('отказались — ничего не поменялось', no.q('contractDocs.find(function(c){return c.id==="cNew";}).objId') === ''
    && no.q('contractDocs.find(function(c){return c.id==="c59";}).type') === 'main')
}

t.done()
