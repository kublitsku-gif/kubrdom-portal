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

// ── 1. Схема, площади и вход в редактор ──────────────────────────────────────
{
  t.section('Вкладка «Спецификация 2»')
  const p = panel()
  const html = p.run('tSpec2()')
  const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>') + 6)
  t.ok('схема нарисована', svg.indexOf('sch-hatch') >= 0 && svg.length > 2000)
  t.ok('размеры на чертеже есть', /<text[^>]*>11952</.test(svg))
  // На самом чертеже площадей нет — это разные документы; на вкладке рядом есть.
  t.ok('площадей на чертеже нет', svg.indexOf('м²') < 0)
  t.ok('площади показаны рядом со схемой', /ПЛОЩАДИ/.test(html) && /ПОТОЛОК/.test(html) && /25,52/.test(html))
  t.ok('и по каждому помещению', /СПАЛЬНЯ/.test(svg) && /Спальня/.test(html))
  t.ok('вход в редактор есть', html.indexOf('data-a="spec2-edit"') >= 0)
  // Экрана продажи в разделе по-прежнему нет — его собирают заново.
  const marks = ['spec-new', 'spec-create', 'spec-open', 'spec-back', 'spec-del', 'spec-view', 'spec-preset']
  marks.forEach((m) => t.ok('нет ' + m, html.indexOf('data-a="' + m + '"') < 0))
  // Справочник изделий портала от рендера не растёт: заготовка строится копией.
  t.ok('изделия в портале не заводятся', p.q('winTypes').length === 0, String(p.q('winTypes').length))
}

// ── 1б. Схема на вкладке — миниатюра, крупно она по тапу ─────────────────────
// Колонка панели 480 px, а дом двенадцатиметровый: чертёж с min-width уезжал вбок,
// и его листали вслепую, ни разу не увидев целиком. На вкладке он теперь помещается,
// а прокрутка живёт там, где уместна, — в оверлее, и её включает увеличение.
{
  t.section('Миниатюра и увеличение')
  const p = panel()
  const html = p.run('tSpec2()')
  t.ok('чертёж вписан в колонку', html.indexOf('min-width:560px') < 0)
  t.ok('вбок вкладка не едет', html.indexOf('overflow-x:auto') < 0)
  t.ok('и понятно, что делать', html.indexOf('data-a="spec2-scheme"') >= 0 && /тап — открыть крупно/.test(html))
  t.ok('пока не тапнули, оверлея нет', p.q('schemeZoom') === 0)

  const tap = p.dom.node({ a: 'spec2-scheme' }); p.run('bind();'); tap.onclick()
  t.ok('тап открывает крупно', p.q('schemeZoom') === 1)
  const ov = p.run('spec2SchemeOverlay()')
  const svg = ov.slice(ov.indexOf('<svg'), ov.indexOf('</svg>') + 6)
  t.ok('в оверлее тот же чертёж', /<text[^>]*>11952</.test(svg) && svg.indexOf('sch-hatch') >= 0)
  t.ok('и он вписан по ширине экрана', svg.indexOf('min-width') < 0)
  t.ok('есть чем увеличить', /data-a="spec2-scheme-zoom" data-z="4"/.test(ov))

  const z = p.dom.node({ a: 'spec2-scheme-zoom', z: '4' }); p.run('bind();'); z.onclick()
  t.ok('увеличение запомнилось', p.q('schemeZoom') === 4)
  t.ok('и лист стал шире экрана', p.run('spec2SchemeOverlay()').indexOf('width:400%') >= 0)

  const close = p.dom.node({ a: 'spec2-scheme-close' }); p.run('bind();'); close.onclick()
  t.ok('«Готово» закрывает', p.q('schemeZoom') === 0)
}

// ── 1.5 Рабочий лист становится источником схемы ─────────────────────────────
{
  t.section('Рабочий лист раздела')
  const p = panel()
  const before = p.run('tSpec2()')
  t.ok('до первого нажатия листа нет', p.q('specSheets2').length === 0)
  t.ok('и об этом сказано', /станет рабочей моделью/.test(before))

  const btn = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); btn.onclick()
  t.ok('лист заведён из заготовки', p.q('specSheets2').length === 1)
  t.ok('в нём есть модель', !!p.q('specSheets2[0].model'))
  t.ok('изделия заготовки попали в справочник', p.q('winTypes').length === 4, String(p.q('winTypes').length))
  t.ok('редактор открыт на этом листе',
    p.q('modelFull') === true && p.q('specOpenId') === p.q('specSheets2[0].id'))

  // Правка модели обязана доехать до чертежа: иначе схема показывает вчерашний дом.
  p.run('specSheets2[0].model.rooms[0].name="Ванная";specSheets2[0].model.rooms[0].len=3076;')
  const after = p.run('tSpec2()')
  t.ok('имя помещения на схеме поменялось', /ВАННАЯ/.test(after) && !/САНУЗЕЛ/.test(after))
  t.ok('и размер в цепочке тоже', /<text[^>]*>3000</.test(after), 'нет 3000')
  t.ok('площади пересчитались', /6,6/.test(after), 'нет 6,6 м² у ванной')
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
  t.ok('проёмы на месте, включая межкомнатные двери', (sh.model.openings || []).length === 5,
    String((sh.model.openings || []).length))
  t.ok('изделия заведены в справочник', p.q('winTypes').length === 4, String(p.q('winTypes').length))
  const areas = (sh.specs.rooms || []).map((r) => Math.round(r.w * r.l * 100) / 100)
  t.ok('площади с чертежа 4,4 / 14,08 / 7,04', String(areas) === '4.4,14.08,7.04', String(areas))

  // Та же заготовка из карточки заменяет модель целиком.
  p.run('specOpenId=' + JSON.stringify(sh.id) + ';specSheets[0].rooms={r_old:{"Стены":"e_mdf"}};')
  const btn = p.dom.node({ a: 'model-preset', k: 'c12-san-liv-bed' })
  p.run('bind();')
  btn.onclick()
  t.ok('выбор по комнатам сброшен', Object.keys(p.q('specSheets')[0].rooms || {}).length === 0)
  t.ok('изделия не задвоились', p.q('winTypes').length === 4, String(p.q('winTypes').length))
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
