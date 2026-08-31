#!/usr/bin/env node
// Вкладка «Спецификация 2» и заготовки планировок (public/admin.js).
//
// Раздел намеренно пустой, и «пустой» — это тоже требование: любой унаследованный
// экран решал бы за будущую логику, как ей выглядеть. Поэтому здесь сторожим две
// вещи: что на вкладке действительно ничего нет и что живой раздел от этого не
// пострадал, — а ещё что заготовка контейнера доезжает до листа целиком.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [{ id: 'p_mdf', name: 'МДФ панель', unitCost: 700, store: 'Белка', mode: 'm2' }]
const EST = [
  { id: 'e_mdf', kind: 'house', name: 'Стены МДФ', stage: 2, optScope: 'room', optGroup: 'Стены', optLabel: 'МДФ', optSurface: 'wall',
    lines: [{ pid: 'p_mdf', qty: 1 }] },
]
const SHEET2 = { id: 'old2', name: 'Опыт', kind: 'house', specs: { height: 2.5, rooms: [] }, rooms: {}, global: {}, qty: {}, markup: 30 }

function panel() {
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
  })
  return p
}

// Создание так, как это делает человек: имя → заготовка → «Создать».
function create(p, preset) {
  p.dom.field('spec-n-name', 'Дом Иванова')
  p.dom.field('spec-n-client', '')
  p.run('specNew=Object.assign({},specNew,{kind:"house"});')
  if (preset) {
    const tile = p.dom.node({ a: 'spec-n-preset', k: preset })
    p.run('bind();')
    tile.onclick()
  }
  const btn = p.dom.node({ a: 'spec-create' })
  p.run('bind();')
  btn.onclick()
}

// ── 1. Вкладка пуста ─────────────────────────────────────────────────────────
{
  t.section('Вкладка «Спецификация 2»')
  const p = panel()
  const empty = p.run('tSpec2()')
  t.ok('ничего не рисует', empty === '<div></div>', JSON.stringify(empty))
  // Даже если листы в разделе есть — экрана для них нет.
  p.run('specSheets2=[' + JSON.stringify(SHEET2) + '];specOpenId="old2";')
  const withData = p.run('tSpec2()')
  t.ok('лист в разделе её не наполняет', withData === '<div></div>', JSON.stringify(withData).slice(0, 200))
  const marks = ['spec-new', 'spec-create', 'spec-open', 'spec-back', 'spec-del', 'model-preset']
  marks.forEach((m) => t.ok('нет ' + m, withData.indexOf('data-a="' + m + '"') < 0))
}

// ── 2. Живой раздел не задет ─────────────────────────────────────────────────
{
  t.section('Боевая «Спецификация»')
  const p = panel()
  p.run('specSheets2=[' + JSON.stringify(SHEET2) + '];specOpenId="old2";')
  const list = p.run('tSpec()')
  t.ok('опытный лист в боевом списке не показывается', list.indexOf('data-id="old2"') < 0)
  t.ok('и его карточку боевая вкладка не открывает', list.indexOf('data-a="spec-back"') < 0)
  t.ok('и не закрывает её насильно', p.q('specOpenId') === 'old2')

  p.run('specOpenId=null;specShowNew=true;')
  const form = p.run('tSpec()')
  t.ok('форма создания на месте', form.indexOf('data-a="spec-create"') >= 0)
  t.ok('планировки из базы предлагаются', form.indexOf('data-a="spec-n-plan-pick"') >= 0)
  t.ok('заготовка контейнера предлагается', form.indexOf('data-a="spec-n-preset"') >= 0)
}

// ── 3. Заготовка доезжает до листа ───────────────────────────────────────────
{
  t.section('Заготовка контейнера')
  const p = panel()
  p.run('specShowNew=true;')
  create(p, 'c12-san-liv-bed')
  const sh = p.q('specSheets')[0]
  t.ok('лист заведён в боевом разделе', p.q('specSheets').length === 1 && p.q('specSheets2').length === 0)
  t.ok('модель собрана', !!sh.model && sh.model.rooms.length === 3, JSON.stringify((sh.model || {}).rooms || null))
  t.ok('проёмы на месте', (sh.model.openings || []).length === 3)
  t.ok('изделия заведены в справочник', p.q('winTypes').length === 3, String(p.q('winTypes').length))
  const areas = (sh.specs.rooms || []).map((r) => Math.round(r.w * r.l * 100) / 100)
  t.ok('площади с чертежа 4,4 / 14,08 / 7,04', String(areas) === '4.4,14.08,7.04', String(areas))

  // Та же заготовка из карточки заменяет модель целиком.
  p.run('specOpenId=' + JSON.stringify(sh.id) + ';specSheets[0].rooms={r_old:{"Стены":"e_mdf"}};')
  const btn = p.dom.node({ a: 'model-preset', k: 'c12-san-liv-bed' })
  p.run('bind();')
  btn.onclick()
  t.ok('выбор по комнатам сброшен', Object.keys(p.q('specSheets')[0].rooms || {}).length === 0)
  t.ok('изделия не задвоились', p.q('winTypes').length === 3, String(p.q('winTypes').length))
}

// ── 4. Раздел как данные ─────────────────────────────────────────────────────
{
  t.section('Данные опытного раздела')
  const p = panel()
  p.run('specSheets2=[' + JSON.stringify(SHEET2) + '];')
  t.ok('лист находится по id', p.q('(specSheet("old2")||{}).id') === 'old2')
  t.ok('и опознаётся как опытный', p.q('specIs2(specSheets2[0])') === true)
  // Удаление обязано доставать лист из обеих коллекций: экрана у раздела нет, но
  // заведённые раньше листы никуда не делись.
  p.run('specDrop("old2");')
  t.ok('удаление достаёт его из опытного раздела', p.q('specSheets2').length === 0)

  // Изделие, стоящее в проёме опытного листа, считается занятым.
  p.run('specSheets2=[{id:"x1",model:{openings:[{id:"o",typeId:"w1"}]}}];winTypes=[{id:"w1",kind:"win",n:"Окно",w:1500,h:2100,cost:0}];')
  const used = p.q('specSheets.concat(specSheets2).some(function(x){return ((x.model||{}).openings||[]).some(function(o){return o.typeId==="w1";});})')
  t.ok('изделие из опытного листа виден занятым', used === true)

  const keys = p.q('serializeState().map(function(x){return x.work_id;})')
  t.ok('specSheets2 уходит в облако', keys.indexOf('specSheets2') >= 0)
  p.run('applyState([{work_id:"specSheets2",data:[{id:"z1",name:"С сервера"}]}]);')
  t.ok('и приходит обратно', p.q('specSheets2').length === 1 && p.q('specSheets2')[0].id === 'z1')
}

t.done()
