#!/usr/bin/env node
// Ответственные за договор назначаются ЧЕЛОВЕКОМ, а не «первым попавшимся».
//
// Живой случай 19.09.2026: ctDefaultResponsible доклеивал в новый договор первого по
// списку sales_head и первого worker/brigadier. «Первый бригадир» — всегда один и тот
// же человек (Валера), поэтому он оказывался ответственным по КАЖДОМУ договору: в его
// «Финансах» висели «Квартира на Кончаловского» и «Дом СВО» (объект Инны) с планом
// 200 000 ₽ по умолчанию, а getUserObjects открывал ему эти объекты.
//
// Сторожим: по умолчанию — только менеджеры по договорам; бригадир видит договор и
// объект ТОЛЬКО после того, как его назначили руками.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const USERS = [
  { id: 'yuriy', name: 'Юрий', av: '👨‍💼', c: '#c0392b', roles: ['admin', 'financier'], objs: [] },
  { id: 'valera', name: 'Валера', av: '👷', c: '#e67e22', roles: ['brigadier'], objs: [] },
  { id: 'inna', name: 'Инна', av: '👩‍💼', c: '#9b59b6', roles: ['brigadier'], objs: [] },
  { id: 'azis', name: 'Азис', av: '🧑‍🔧', c: '#2980b9', roles: ['worker'], objs: [] },
  { id: 'rop', name: 'Роман', av: '🧑‍💼', c: '#16a085', roles: ['sales_head'], objs: [] },
  { id: 'alexandr', name: 'Александр', av: '👨‍🔧', c: '#7f8c8d', roles: ['contract_mgr'], objs: [] },
]

function panel(contractDocs) {
  const p = boot({})
  p.set({
    users: USERS,
    roles: [{ id: 'brigadier', n: 'Бригадир' }, { id: 'worker', n: 'Рабочий' },
      { id: 'sales_head', n: 'РОП' }, { id: 'contract_mgr', n: 'Менеджер по договорам' },
      { id: 'admin', n: 'Админ' }, { id: 'financier', n: 'Финансист' }],
    objects: [
      { id: 'oFlat', icon: '🧾', name: 'Квартира на Кончаловского', stages: [] },
      { id: 'oSVO', icon: '🏠', name: 'Дом СВО', stages: [] },
    ],
    contractDocs: contractDocs || [],
    crmClients: [], templates: [], estimates: [], expProducts: [], projects: [],
    specSheets: [], specSheets2: [], buildRules: [], winTypes: [], dbPlans: [],
    finTxns: [], receipts: [], issues: [], purchases: [], settings: {},
  })
  return p
}
const asUser = (p, uid) => p.run('currentUser=users.find(function(u){return u.id===' + JSON.stringify(uid) + ';});')
const click = (p, dataset) => { const n = p.dom.node(dataset); p.run('bind();'); n.onclick && n.onclick({ stopPropagation() {}, target: {} }); return n }
const plain = (h) => h.replace(/<[^>]*>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')

{
  t.section('По умолчанию ответственные — только менеджеры по договорам')
  const p = panel()
  const def = p.q('ctDefaultResponsible()')
  t.ok('менеджер по договорам — есть', def.indexOf('alexandr') >= 0, JSON.stringify(def))
  t.ok('бригадира не подставляем', def.indexOf('valera') < 0 && def.indexOf('inna') < 0, JSON.stringify(def))
  t.ok('рабочего не подставляем', def.indexOf('azis') < 0, JSON.stringify(def))
  t.ok('РОПа не подставляем', def.indexOf('rop') < 0, JSON.stringify(def))
}

{
  t.section('Договор из формы «＋ Договор» заводится без бригадира')
  const p = panel()
  p.run('contractNew=Object.assign({},contractNew,{objId:"oFlat",type:"main",client:"Гринин Павел"});contractAddForm=true;')
  p.dom.field('ct-name', 'Договор подряда — квартира Кончаловского')
  p.dom.field('ct-amount', '1 200 000')
  p.dom.field('ct-date', '2026-09-19')
  click(p, { a: 'ct-save' })
  const docs = p.q('contractDocs')
  t.ok('договор создан', docs.length === 1, JSON.stringify(docs.map((d) => d.name)))
  const resp = (docs[0] || {}).responsible || []
  t.ok('в ответственных нет бригадиров', !resp.some((id) => ['valera', 'inna', 'azis'].indexOf(id) >= 0), JSON.stringify(resp))
  t.ok('менеджер по договорам остался', resp.indexOf('alexandr') >= 0, JSON.stringify(resp))
}

{
  t.section('Чужой договор не попадает бригадиру ни в деньги, ни в объекты')
  const p = panel([
    { id: 'cFlat', objId: 'oFlat', type: 'main', status: 'signed', amount: 1200000, name: 'Договор подряда — квартира Кончаловского',
      client: 'Гринин Павел', responsible: ['alexandr'], salaries: {}, extraWorks: [], files: [] },
    { id: 'cSVO', objId: 'oSVO', type: 'main', status: 'signed', amount: 1752000, name: 'Договор подряда № 2108-1/26',
      client: 'Кутьин Алексей', responsible: ['alexandr', 'inna'], salaries: {}, extraWorks: [], files: [] },
  ])
  asUser(p, 'valera')
  t.ok('своих договоров нет', p.q('myFinContracts().length') === 0)
  const txt = plain(p.run('tFinanceMine(true)'))
  t.ok('экран денег пуст, а не 200 000 по чужому объекту', /Договоров пока нет/.test(txt) && !/Кончаловского/.test(txt) && !/СВО/.test(txt), txt.slice(0, 300))
  t.ok('объекты не открыты', p.q('getUserObjects(currentUser)').length === 0, JSON.stringify(p.q('getUserObjects(currentUser)')))

  asUser(p, 'inna')
  t.ok('у Инны «Дом СВО» свой', p.q('myFinContracts().map(function(c){return c.id;})').join() === 'cSVO')
  t.ok('и объект открыт', p.q('getUserObjects(currentUser)').join() === 'oSVO')
}

{
  t.section('Назначили руками — договор и объект появились')
  const p = panel([
    { id: 'cSVO', objId: 'oSVO', type: 'main', status: 'signed', amount: 1752000, name: 'Договор подряда № 2108-1/26',
      client: 'Кутьин Алексей', responsible: ['alexandr'], salaries: {}, extraWorks: [], files: [] },
  ])
  p.run('tab="contracts";contractView="cSVO";ctRespEdit={cSVO:true};')
  click(p, { a: 'ct-resp-toggle', cid: 'cSVO', uid: 'inna' })
  t.ok('Инна в ответственных', (p.q('contractDocs[0].responsible') || []).indexOf('inna') >= 0, JSON.stringify(p.q('contractDocs[0].responsible')))
  asUser(p, 'inna')
  t.ok('договор виден в деньгах', p.q('myFinContracts().length') === 1)
  t.ok('объект открылся', p.q('getUserObjects(currentUser)').join() === 'oSVO')
  // И снимается тем же тумблером — иначе ошибку назначения нечем исправить.
  p.run('currentUser=users.find(function(u){return u.id==="yuriy";});')
  click(p, { a: 'ct-resp-toggle', cid: 'cSVO', uid: 'inna' })
  t.ok('тумблер снимает назначение', (p.q('contractDocs[0].responsible') || []).indexOf('inna') < 0, JSON.stringify(p.q('contractDocs[0].responsible')))
}

t.done()
