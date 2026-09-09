#!/usr/bin/env node
// Плитки заготовок планировок (public/admin.js): «С ЧЕГО НАЧАТЬ».
//
// Заготовки различаются не именем, а чертежом: у всех «санузел / зал / спальня», а
// отличаются они тем, где вход и куда смотрит окно. Поэтому сторожим ровно то, из-за
// чего выбор снова стал бы гаданием по имени: у КАЖДОЙ заготовки своя миниатюра,
// нарисованная по её собственной модели; лупа открывает ЕЁ чертёж, а не первый
// попавшийся; и тап по лупе не считается выбором заготовки.
import { boot, reporter } from './harness/panel-vm.js'
import { MODEL_PRESETS } from '../src/model.js'

const t = reporter()

function panel() {
  const p = boot({})
  p.set({
    expProducts: [], estimates: [], dbPlans: [], crmClients: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [],
    purchases: [], issues: [], users: [], stock: [], settings: {},
    projNew: { name: '', preset: MODEL_PRESETS[0].k, clientId: '' }, specNew: null,
  })
  return p
}

// ── 1. У каждой заготовки свой чертёж и своя лупа ────────────────────────────
{
  t.section('Плитки')
  const p = panel()
  const h = p.run('modelPresetTiles("proj-n-preset","","#16a085")')
  t.ok('плитка на каждую заготовку',
    MODEL_PRESETS.every((pr) => h.includes('data-a="proj-n-preset" data-k="' + pr.k + '"')),
    String((h.match(/data-a="proj-n-preset"/g) || []).length))
  // Заготовка без картинки — это ровно тот список имён, из-за которого всё и затевалось.
  t.ok('и миниатюра на каждую',
    (h.match(/<svg/g) || []).length === MODEL_PRESETS.length,
    String((h.match(/<svg/g) || []).length) + ' из ' + MODEL_PRESETS.length)
  t.ok('и лупа на каждую',
    MODEL_PRESETS.every((pr) => h.includes('data-a="preset-peek" data-k="' + pr.k + '"')))
  // Выбранная должна быть видна: без этого непонятно, с чего создастся проект.
  const sel = p.run('modelPresetTiles("proj-n-preset",' + JSON.stringify(MODEL_PRESETS[1].k) + ',"#16a085")')
  t.ok('выбранная плитка отмечена', sel.includes('#16a085') && sel !== h)
}

// ── 2. Миниатюра — по МОДЕЛИ заготовки, а не картинкой и не по справочнику дома ──
{
  t.section('Миниатюра')
  const p = panel()
  const a = p.run('presetThumbSvg(' + JSON.stringify(MODEL_PRESETS[0].k) + ',"plain")')
  const b = p.run('presetThumbSvg(' + JSON.stringify(MODEL_PRESETS[1].k) + ',"plain")')
  t.ok('у разных заготовок разные чертежи', a !== b && a.length > 200 && b.length > 200)
  t.ok('это svg, а не картинка', a.startsWith('<svg') && !a.includes('<img'))
  // Высота ограничена: без потолка плитки в ряду встают разной высоты.
  t.ok('высота миниатюры ограничена', a.includes('max-height:'), a.slice(0, 120))
  // Справочник изделий панели в миниатюру не подмешивается: у заготовки нет дома,
  // и чужое окно 3000×3000 не должно раздвигать её проём.
  p.run('winTypes=[{id:"mine",kind:"win",n:"Чужое",w:3000,h:3000,cost:1}];presetThumbCache={};presetBuiltCache={};')
  t.ok('справочник дома миниатюру не меняет',
    p.run('presetThumbSvg(' + JSON.stringify(MODEL_PRESETS[0].k) + ',"plain")') === a)
}

// ── 3. Лупа открывает СВОЙ чертёж и не считается выбором ─────────────────────
{
  t.section('Лупа')
  const p = panel()
  const k1 = MODEL_PRESETS[1].k, k2 = MODEL_PRESETS[2].k
  const peek = p.dom.node({ a: 'preset-peek', k: k1 })
  p.run('bind();')
  let stopped = false
  peek.onclick({ stopPropagation: () => { stopped = true } })
  // Тап по плитке означает «беру эту заготовку». Всплыви событие — человек метил бы
  // в чертёж, а менял бы выбор, с которого соберётся дом.
  t.ok('событие до плитки не всплывает', stopped)
  t.ok('открылась именно эта заготовка', p.q('presetPeek') === k1)
  t.ok('и выбор не тронут', p.q('projNew.preset') === MODEL_PRESETS[0].k)
  t.ok('кратность сброшена на 1×', p.q('presetPeekZoom') === 1)

  const o1 = p.run('modelPresetOverlay()')
  t.ok('в оверлее имя этой заготовки', o1.includes(MODEL_PRESETS[1].n.slice(0, 12)))
  const o2 = p.run('presetPeek=' + JSON.stringify(k2) + ';modelPresetOverlay()')
  t.ok('у другой заготовки — другой чертёж', o1 !== o2)
  t.ok('чужой ключ — пусто, а не чужой дом', p.run('presetPeek="нет такой";modelPresetOverlay()') === '')
}

// ── 4. Набранное в форме переживает и лупу, и выбор ──────────────────────────
{
  t.section('Форма нового проекта')
  const p = panel()
  p.dom.field('proj-n-name', 'Дом Ивановых')
  p.dom.field('proj-n-client', 'c1')
  const pick = p.dom.node({ a: 'proj-n-preset', k: MODEL_PRESETS[2].k })
  p.run('bind();')
  pick.onclick()
  // Название живёт в самом поле, а выбор заготовки перерисовывает форму целиком:
  // не забрать его — и набранное пропадает от тапа по соседней плитке.
  t.ok('имя пережило выбор заготовки', p.q('projNew.name') === 'Дом Ивановых', String(p.q('projNew.name')))
  t.ok('и клиент тоже', p.q('projNew.clientId') === 'c1', String(p.q('projNew.clientId')))
  t.ok('заготовка при этом сменилась', p.q('projNew.preset') === MODEL_PRESETS[2].k)

  const peek = p.dom.node({ a: 'preset-peek', k: MODEL_PRESETS[0].k })
  p.run('bind();')
  peek.onclick({ stopPropagation: () => {} })
  t.ok('и лупу имя переживает тоже', p.q('projNew.name') === 'Дом Ивановых')
}

t.done()
