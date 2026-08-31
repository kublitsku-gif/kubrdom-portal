#!/usr/bin/env node
// Вкладка «Спецификация 2» и заготовки планировок (public/admin.js).
//
// Расчёт сторожат test-spec2 и test-model-preset. Здесь — то, что живёт только в
// панели и ломается тише всего: опытный лист обязан лечь в СВОЙ раздел (иначе
// эксперимент попадает в проданные спецификации), заготовка обязана приехать
// вместе с изделиями, а карточка одного раздела не должна открываться в другом.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [{ id: 'p_mdf', name: 'МДФ панель', unitCost: 700, store: 'Белка', mode: 'm2' }]
const EST = [
  { id: 'e_mdf', kind: 'house', name: 'Стены МДФ', stage: 2, optScope: 'room', optGroup: 'Стены', optLabel: 'МДФ', optSurface: 'wall',
    lines: [{ pid: 'p_mdf', qty: 1 }] },
]

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
function create(p, { two, preset }) {
  p.dom.field('spec-n-name', two ? 'Опыт' : 'Боевая')
  p.dom.field('spec-n-client', '')
  p.run('specNew=Object.assign({},specNew,{kind:"house"});')
  if (preset) {
    const tile = p.dom.node({ a: 'spec-n-preset', k: preset })
    p.run('bind();')
    tile.onclick()
  }
  const btn = p.dom.node({ a: 'spec-create', two: two ? '1' : '' })
  p.run('bind();')
  btn.onclick()
}

// ── 1. Опытный лист ложится в свой раздел ────────────────────────────────────
{
  t.section('Куда попадает новый лист')
  const p = panel()
  create(p, { two: true, preset: 'c12-san-liv-bed' })
  t.ok('в боевом разделе пусто', p.q('specSheets').length === 0, JSON.stringify(p.q('specSheets.length')))
  t.ok('лист в опытном разделе', p.q('specSheets2').length === 1)
  const sh = p.q('specSheets2')[0]
  t.ok('карточка открылась', p.q('specOpenId') === sh.id)
  t.ok('панель считает его опытным', p.q('specIs2(specSheets2[0])') === true)
  t.ok('и не считает опытным боевой', p.q('specIs2({id:"нет такого"})') === false)

  create(p, { two: false, preset: '' })
  t.ok('обычная спецификация — в боевой раздел', p.q('specSheets').length === 1 && p.q('specSheets2').length === 1)
}

// ── 2. Заготовка приезжает моделью и изделиями ───────────────────────────────
{
  t.section('Заготовка контейнера')
  const p = panel()
  create(p, { two: true, preset: 'c12-san-liv-bed' })
  const sh = p.q('specSheets2')[0]
  t.ok('модель собрана', !!sh.model && sh.model.rooms.length === 3, JSON.stringify((sh.model || {}).rooms || null))
  t.ok('проёмы на месте', (sh.model.openings || []).length === 3)
  t.ok('изделия заведены в справочник', p.q('winTypes').length === 3, String(p.q('winTypes').length))
  t.ok('у каждого проёма своё изделие',
    sh.model.openings.every((o) => p.q('winTypes').some((w) => w.id === o.typeId)))
  // Числа с чертежа доезжают до спецификации — из них считается смета и цена.
  const areas = (sh.specs.rooms || []).map((r) => Math.round(r.w * r.l * 100) / 100)
  t.ok('площади помещений 4,4 / 14,08 / 7,04', String(areas) === '4.4,14.08,7.04', String(areas))
  t.ok('высота 2,5 м', sh.specs.height === 2.5, String(sh.specs.height))

  // Пустая коробка — по-прежнему отдельный ответ на «откуда дом».
  const q = panel()
  q.run('specNew=Object.assign({},specNew,{kind:"house",model:"40hc",preset:""});')
  q.dom.field('spec-n-name', 'Пустая'); q.dom.field('spec-n-client', '')
  const b = q.dom.node({ a: 'spec-create', two: '1' }); q.run('bind();'); b.onclick()
  const empty = q.q('specSheets2')[0]
  t.ok('пустая коробка — одно помещение без проёмов',
    empty.model.rooms.length === 1 && !(empty.model.openings || []).length)
}

// ── 3. Заготовка в открытой карточке ─────────────────────────────────────────
{
  t.section('Заменить модель заготовкой')
  const p = panel()
  create(p, { two: true, preset: '' })
  p.run('specSheets2[0].rooms={r_old:{"Стены":"e_mdf"}};')
  const btn = p.dom.node({ a: 'model-preset', k: 'c12-san-liv-bed' })
  p.run('bind();')
  btn.onclick()
  const sh = p.q('specSheets2')[0]
  t.ok('модель встала', !!sh.model && sh.model.rooms.length === 3)
  // id помещений стали другими — выбор по старым комнатам повис бы в пустоте.
  t.ok('выбор по комнатам сброшен', Object.keys(sh.rooms || {}).length === 0, JSON.stringify(sh.rooms))
  t.ok('изделия не задвоились при повторном применении', (btn.onclick(), p.q('winTypes').length === 3),
    String(p.q('winTypes').length))
}

// ── 4. Разделы не открывают карточки друг друга ──────────────────────────────
{
  t.section('Границы разделов')
  const p = panel()
  create(p, { two: true, preset: 'c12-san-liv-bed' })
  const openId = p.q('specOpenId')
  const inSpec = p.run('tSpec()')
  t.ok('боевая вкладка показывает список, а не чужую карточку', inSpec.indexOf('data-a="spec-back"') < 0)
  t.ok('и не закрывает её', p.q('specOpenId') === openId)
  const inSpec2 = p.run('tSpec2()')
  t.ok('опытная вкладка показывает карточку', inSpec2.indexOf('data-a="spec-back"') >= 0)

  // Удаление ищет лист в обоих разделах — иначе «удалил», а он остался.
  p.run('specOpenId=null;specDrop(' + JSON.stringify(openId) + ');')
  t.ok('удалённый лист исчез из опытного раздела', p.q('specSheets2').length === 0)
}

// ── 5. Карточка опытного раздела вычищена ────────────────────────────────────
{
  t.section('Что осталось в карточке')
  const p = panel()
  create(p, { two: true, preset: 'c12-san-liv-bed' })
  const card = p.run('tSpec2()')
  // Экрана продажи здесь нет — он остался в боевой «Спецификации».
  // Боевая карточка того же вида — контроль: маркеры ниже там действительно есть,
  // иначе проверка «нет такого» ничего не сторожит.
  p.run('settings=Object.assign({},settings,{specPresets:[{id:"pr1",kind:"house",name:"Комфорт",rooms:{},global:{}}]});')
  p.run('specView="sheet";specAcc={rooms:true,global:true,base:true,stages:true};')
  p.run('specSheets=[{id:"a1",name:"Дом",kind:"house",specs:{height:2.5,rooms:[{id:"r1",name:"Зал",w:2,l:3,wallLen:10}]},rooms:{},global:{},qty:{},markup:30}];')
  const live = p.run('tSpecCard(specSheets[0])')

  const gone = [
    ['вкладки Список/План/Матрица/Мастер', 'data-a="spec-view"'],
    ['комплектации', 'data-a="spec-preset"'],
    ['раскрывающиеся блоки', 'data-a="spec-acc"'],
    ['выбор отделки по комнате', 'data-a="spec-pick-room"'],
    ['печать клиенту', 'data-a="spec-print"'],
    ['в договор и в объект', 'data-a="spec-to-contract"'],
  ]
  gone.forEach(([name, mark]) => {
    t.ok('в боевой карточке есть ' + name, live.indexOf(mark) >= 0, mark)
    t.ok('в опытной убрано: ' + name, card.indexOf(mark) < 0, mark)
  })
  // А без чего лист не существует — осталось.
  const kept = [
    ['имя листа', 'data-a="spec-name"'],
    ['клиент', 'data-a="spec-client"'],
    ['модель контейнера', 'data-a="model-full"'],
    ['удаление', 'data-a="spec-del"'],
  ]
  kept.forEach(([name, mark]) => t.ok('осталось: ' + name, card.indexOf(mark) >= 0, mark))

  // В списке опытного раздела вместо цены — сам дом.
  p.run('specOpenId=null;')
  const list = p.run('tSpec2()')
  t.ok('в списке площадь, а не цена', /25,52 м²/.test(list) && list.indexOf('₽') < 0, list.slice(list.indexOf('spec-open'), list.indexOf('spec-open') + 400))
}

// ── 6. Раздел уходит в облако ────────────────────────────────────────────────
{
  t.section('Синхронизация')
  const p = panel()
  create(p, { two: true, preset: 'c12-san-liv-bed' })
  const keys = p.q('serializeState().map(function(x){return x.work_id;})')
  t.ok('specSheets2 есть в снимке', keys.indexOf('specSheets2') >= 0, JSON.stringify(keys))
  t.ok('боевой раздел на месте', keys.indexOf('specSheets') >= 0)
  // Пришедший с сервера раздел применяется, а не игнорируется.
  p.run('applyState([{work_id:"specSheets2",data:[{id:"z1",name:"С сервера"}]}]);')
  t.ok('снимок с сервера применён', p.q('specSheets2').length === 1 && p.q('specSheets2')[0].id === 'z1')
}

t.done()
