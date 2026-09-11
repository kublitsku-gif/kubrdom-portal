#!/usr/bin/env node
// Карточка договора на экране (public/admin.js): привязка объекта в один-два тапа.
//
// Логику шагов, порядка и шаблонов сторожит test-contract-card.mjs. Здесь — то, что
// видит и нажимает человек: плашка «без объекта», выбор объекта с поиском, объект из
// договора, защита второго основного, шаги статуса, свёрнутый PIN и архив в «⋯»,
// одна сумма без доп. работ, «ещё» у длинного примечания, договоры в карточке
// объекта и в CRM. И что «Сохранить изменения» больше не отвязывает объект.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const LONG_NOTE = 'Дом 12 м на базе морского контейнера. Комфорт-комплектация 1 590 000 + опции = 1 752 000 ₽. Заказчик: Кутьин Алексей Владимирович, отделка по дизайн-проекту №7640467: зал 14.08 м², спальня.'

function panel(opts) {
  const p = boot(opts || {})
  p.set({
    crmClients: [{ id: 'k1', name: 'Кутьин Алексей Владимирович', phone: '+79495603538', stage: 'contract', source: 'Авито', notes: '', msg: '' }],
    templates: [
      { id: 'tb', icon: '🛁', name: 'Баня 6 м', kind: 'banya', stages: [{ id: 's1', n: 'Сруб', c: '#000', works: [{ id: 'w1', n: 'Сборка', mats: [] }] }], specs: { rooms: [], openings: [] } },
      { id: 'th', icon: '🏠', name: 'Дом 40 футов', kind: 'house', stages: [
        { id: 's1', n: 'Каркас', c: '#000', works: [{ id: 'w1', n: 'Утепление', mats: [] }] },
        { id: 's2', n: 'Отделка', c: '#000', works: [{ id: 'w2', n: 'Стены', mats: [] }] }], specs: { rooms: [], openings: [] } },
    ],
    objects: [
      { id: 'oBusy', icon: '🏠', name: 'Дом 40 футов Олег', stages: [] },
      { id: 'oFree', icon: '🛁', name: 'Баня 6 м Сергей', stages: [] },
    ],
    contractDocs: [
      { id: 'cK', name: 'Договор подряда № 2108-1/26', type: 'main', status: 'signed', amount: 1752000, signDate: '2026-08-21',
        deadlineDate: '2026-12-07', client: 'Кутьин Алексей Владимирович', crmClientId: 'k1', objId: '', note: LONG_NOTE,
        responsible: [], salaries: {}, extraWorks: [], files: [] },
      { id: 'cO', name: 'Договор подряда № 1906-1/26', type: 'main', status: 'signed', amount: 1500000, signDate: '2026-06-19',
        client: 'Олег', objId: 'oBusy', note: '', responsible: [], salaries: {}, extraWorks: [], files: [] },
    ],
    users: [], roles: [], finTxns: [], receipts: [], issues: [], purchases: [], estimates: [], expProducts: [],
    specSheets: [], specSheets2: [], projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {},
  })
  p.run('tab="contracts";ctSubTab="list";contractView="cK";')
  return p
}
const view = (p) => p.run('tContractDetail("cK")')
const plain = (h) => h.replace(/<[^>]*>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')
const click = (p, dataset) => { const n = p.dom.node(dataset); p.run('bind();'); n.onclick && n.onclick({ stopPropagation() {}, target: {} }); return n }

{
  t.section('Без объекта — видно сразу и есть что нажать')
  const p = panel()
  const h = view(p)
  const top = h.slice(0, h.indexOf('ОТВЕТСТВЕННЫЕ'))
  t.ok('плашка «без объекта» у подписанного', /без объекта/i.test(plain(top)), plain(top).slice(0, 300))
  t.ok('в ней «＋ Создать объект»', top.indexOf('data-a="ct-mkobj-open" data-cid="cK"') >= 0)
  t.ok('и «📎 Привязать»', top.indexOf('data-a="ct-objpick-open" data-cid="cK"') >= 0)
  // Плашка стоит ДО PIN, CRM и деталей: это первое, что нужно сделать с договором.
  t.ok('плашка выше карточки клиента', top.indexOf('ct-mkobj-open') < (top.indexOf('ct-goto-crm') < 0 ? Infinity : top.indexOf('ct-goto-crm')))
}

{
  t.section('Сводка сверху: сумма, объект, даты по-русски')
  const p = panel()
  const txt = plain(view(p))
  t.ok('ИТОГО в сводке', /1 752 000 ₽/.test(txt))
  t.ok('подписание по-русски', /21 авг 2026/.test(txt) && !/2026-08-21/.test(txt), txt.slice(0, 400))
  t.ok('дедлайн по-русски', /7 дек 2026/.test(txt))
  t.ok('сумма без доп. работ — одной строкой', !/Основной договор/.test(txt), 'строка «Основной договор» осталась')
}

{
  t.section('Шаги статуса и чего не хватает')
  const p = panel()
  const h = view(p)
  const txt = plain(h)
  t.ok('четыре шага', /Черновик/.test(txt) && /Подписан/.test(txt) && /В работе/.test(txt) && /Закрыт/.test(txt))
  t.ok('«В работе» не кнопка — ставится сам', h.indexOf('data-s="work"') < 0)
  t.ok('подсказка — не хватает объекта', /не хватает[^.]*объект/i.test(txt), txt.slice(txt.indexOf('Черновик'), txt.indexOf('Черновик') + 300))

  // Подписать черновик без объекта нельзя — но вместо тупика открывается выбор объекта.
  p.run('contractDocs=contractDocs.map(function(c){return c.id==="cK"?Object.assign({},c,{status:"draft"}):c;});')
  click(p, { a: 'ct-status', cid: 'cK', s: 'signed' })
  t.ok('статус не сменился без объекта', p.q('contractDocs[0].status') === 'draft')
  t.ok('зато открылся выбор объекта', p.q('ctObjPick') === 'cK')
}

{
  t.section('PIN свёрнут, архив в «⋯»')
  const p = panel()
  const h = view(p)
  t.ok('поле PIN не на виду', h.indexOf('data-a="ct-clientpin-save"') < 0)
  t.ok('строка PIN есть и раскрывается', h.indexOf('data-a="ct-pin-open" data-cid="cK"') >= 0)
  click(p, { a: 'ct-pin-open', cid: 'cK' })
  t.ok('раскрыли — поле на месте', view(p).indexOf('data-a="ct-clientpin-save"') >= 0)
  t.ok('архива в теле карточки нет', h.indexOf('data-a="ct-archive-toggle"') < 0)
  t.ok('кнопка «⋯» есть', h.indexOf('data-a="ct-menu" data-cid="cK"') >= 0)
  click(p, { a: 'ct-menu', cid: 'cK' })
  t.ok('в меню — архив', view(p).indexOf('data-a="ct-archive-toggle"') >= 0)
}

{
  t.section('Длинное примечание — «ещё»')
  const p = panel()
  const h = view(p)
  t.ok('свёрнуто, есть «ещё»', h.indexOf('data-a="ct-note-open" data-cid="cK"') >= 0 && plain(h).indexOf('дизайн-проекту') < 0)
  click(p, { a: 'ct-note-open', cid: 'cK' })
  t.ok('раскрыли — текст целиком', plain(view(p)).indexOf('дизайн-проекту №7640467') >= 0)
}

{
  t.section('Выбор объекта тапом — с поиском и порядком')
  const p = panel()
  click(p, { a: 'ct-objpick-open', cid: 'cK' })
  let h = view(p)
  t.ok('выбор открылся', h.indexOf('data-a="ct-objpick-do"') >= 0 && h.indexOf('id="ct-objpick-q"') >= 0)
  const order = [...h.matchAll(/data-a="ct-objpick-do" data-cid="cK" data-oid="([^"]*)"/g)].map((m) => m[1])
  t.ok('свободный выше занятого', order.indexOf('oFree') >= 0 && order.indexOf('oFree') < order.indexOf('oBusy'), order.join(','))
  t.ok('у занятого — чей он', /у договора[^<]*1906-1\/26/.test(plain(h)))
  // Поиск.
  p.run('ctObjPickQ="баня";')
  h = view(p)
  t.ok('поиск оставляет подходящие', h.indexOf('data-oid="oFree"') >= 0 && h.indexOf('data-oid="oBusy"') < 0)
  p.run('ctObjPickQ="";')
  click(p, { a: 'ct-objpick-do', cid: 'cK', oid: 'oFree' })
  t.ok('тап привязал объект', p.q('contractDocs[0].objId') === 'oFree')
  t.ok('выбор закрылся', !p.q('ctObjPick'))
  t.ok('плашка ушла', !/без объекта/i.test(plain(view(p).slice(0, view(p).indexOf('ОТВЕТСТВЕННЫЕ')))))

  // «Сохранить изменения» объект больше не трогает: выбор живёт не в форме.
  click(p, { a: 'ct-edit-toggle', cid: 'cK' })
  t.ok('в форме правки выбора объекта нет', view(p).indexOf('id="ct-edit-obj"') < 0)
  click(p, { a: 'ct-edit-save', cid: 'cK' })
  t.ok('сохранение формы не отвязало объект', p.q('contractDocs[0].objId') === 'oFree')
}

{
  t.section('Второй основной договор на объект')
  const no = panel({ confirm: false })
  click(no, { a: 'ct-objpick-do', cid: 'cK', oid: 'oBusy' })
  t.ok('отказались — не привязан', no.q('contractDocs[0].objId') === '')
  const yes = panel({ confirm: true })
  click(yes, { a: 'ct-objpick-do', cid: 'cK', oid: 'oBusy' })
  t.ok('согласились — привязан', yes.q('contractDocs[0].objId') === 'oBusy')
  t.ok('и стал доп. работами', yes.q('contractDocs[0].type') === 'extra')
}

{
  t.section('Объект из договора')
  const p = panel()
  click(p, { a: 'ct-mkobj-open', cid: 'cK' })
  const draft = p.q('ctMkObj')
  t.ok('имя предложено из договора', draft && draft.name === 'Дом 12 м · Кутьин', JSON.stringify(draft))
  t.ok('шаблон — дом', draft && draft.tid === 'th')
  const h = view(p)
  t.ok('панель с именем и шаблонами', h.indexOf('id="ct-mkobj-name"') >= 0 && h.indexOf('data-a="ct-mkobj-tpl" data-cid="cK" data-tid="th"') >= 0)
  p.dom.field('ct-mkobj-name', 'Дом 12 м · Кутьин')
  const before = p.q('objects.length')
  click(p, { a: 'ct-mkobj-do', cid: 'cK' })
  const o = p.q('objects[objects.length-1]')
  t.ok('объект создан', p.q('objects.length') === before + 1 && o.name === 'Дом 12 м · Кутьин', JSON.stringify(o && o.name))
  t.ok('с этапами шаблона', (o.stages || []).length === 2 && o.templateId === 'th')
  t.ok('помнит клиента', o.crmClientId === 'k1')
  t.ok('и сразу привязан к договору', p.q('contractDocs[0].objId') === o.id)
}

{
  t.section('Прогресс стройки в сводке')
  const p = panel()
  p.run('objects=objects.concat([{id:"oW",icon:"🏠",name:"Дом 12 м · Кутьин",stages:[' +
    '{id:"a",n:"Каркас",works:[{id:"x",n:"x",done:true,doneAt:"2026-08-30"}]},' +
    '{id:"b",n:"Отделка",planEnd:"2020-01-01",works:[{id:"y",n:"y",timeLogs:[{date:"2026-09-02",h:4}]}]}]}]);' +
    'contractDocs=contractDocs.map(function(c){return c.id==="cK"?Object.assign({},c,{objId:"oW"}):c;});')
  const txt = plain(view(p))
  t.ok('этап N из M', /Этап 2 из 2/.test(txt), txt.slice(0, 500))
  t.ok('отставание видно', /отставание/i.test(txt))
  t.ok('шаг «В работе» — текущий', /В работе/.test(txt))
}

{
  t.section('Договоры в карточке объекта')
  const p = panel()
  p.run('objPrevExpanded={oBusy:true,oFree:true};')
  const card = p.run('renderObjCard(objects.find(function(o){return o.id==="oBusy";}), true)')
  t.ok('в объекте виден его договор', card.indexOf('data-a="obj-ct-open" data-cid="cO"') >= 0 && /1906-1\/26/.test(plain(card)), plain(card).slice(0, 300))
  const free = p.run('renderObjCard(objects.find(function(o){return o.id==="oFree";}), true)')
  t.ok('у объекта без договора — «привязать договор»', free.indexOf('data-a="obj-ct-pick" data-oid="oFree"') >= 0)
  click(p, { a: 'obj-ct-pick', oid: 'oFree' })
  const list = p.run('renderObjCard(objects.find(function(o){return o.id==="oFree";}), true)')
  t.ok('в списке — договор без объекта', list.indexOf('data-a="obj-ct-link" data-oid="oFree" data-cid="cK"') >= 0)
  t.ok('занятого договора в списке нет', list.indexOf('data-cid="cO"') < 0)
  click(p, { a: 'obj-ct-link', oid: 'oFree', cid: 'cK' })
  t.ok('привязали со стороны объекта', p.q('contractDocs[0].objId') === 'oFree')
  click(p, { a: 'obj-ct-open', cid: 'cK' })
  t.ok('тап по договору открывает его', p.q('tab') === 'contracts' && p.q('contractView') === 'cK')
}

{
  t.section('Договор и объект в CRM')
  const p = panel()
  const h = p.run('tCRMClient("k1")')
  t.ok('у клиента виден договор', /2108-1\/26/.test(plain(h)) && h.indexOf('data-a="obj-ct-open" data-cid="cK"') >= 0, plain(h).slice(0, 400))
  t.ok('и что объекта нет', /без объекта/i.test(plain(h)))
}

{
  t.section('Метка в списке открывает выбор объекта')
  const p = panel()
  p.run('contractView=null;')
  click(p, { a: 'ct-link-obj', cid: 'cK' })
  t.ok('открыт договор', p.q('contractView') === 'cK')
  t.ok('и сразу выбор объекта', p.q('ctObjPick') === 'cK')
}

t.done()
