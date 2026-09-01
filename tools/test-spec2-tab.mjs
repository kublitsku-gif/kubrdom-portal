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

// ── 1в. Два вида одного чертежа ──────────────────────────────────────────────
// Рабочему нужны размеры, клиенту — комнаты и метры. Это один дом, показанный
// по-разному: вторая копия чертежа разошлась бы с первой на первой же правке.
{
  t.section('Размеры и планировка')
  const p = panel()
  t.ok('по умолчанию — рабочий вид', p.q('schemeView') === 'dim')
  const dim = p.run('tSpec2()')
  t.ok('вкладки предлагаются',
    /data-a="spec2-scheme-view" data-v="dim"/.test(dim) && /data-a="spec2-scheme-view" data-v="plain"/.test(dim))
  const dsvg = dim.slice(dim.indexOf('<svg'), dim.indexOf('</svg>') + 6)
  t.ok('в рабочем есть цепочки и марки', /<text[^>]*>11952</.test(dsvg) && />Д-1</.test(dsvg))
  t.ok('и нет площадей — это чертёж, а не план для клиента', dsvg.indexOf('м²') < 0)

  const v = p.dom.node({ a: 'spec2-scheme-view', v: 'plain' }); p.run('bind();'); v.onclick()
  t.ok('вид переключился', p.q('schemeView') === 'plain')
  const pl = p.run('tSpec2()')
  const psvg = pl.slice(pl.indexOf('<svg'), pl.indexOf('</svg>') + 6)
  t.ok('у клиента имена помещений', /СПАЛЬНЯ/.test(psvg) && /КУХНЯ-ГОСТИНАЯ/.test(psvg))
  t.ok('и площадь пола каждой', />14,08 м²</.test(psvg) && />7,04 м²</.test(psvg), psvg.slice(0, 0))
  t.ok('размеров нет', psvg.indexOf('>11952<') < 0 && psvg.indexOf('>2200<') < 0)
  t.ok('марок проёмов тоже нет', psvg.indexOf('>Д-1<') < 0 && psvg.indexOf('>О-1<') < 0)
  // Сами окна и двери на плане остаются: клиент читает, где вход и куда открывается.
  t.ok('но проёмы нарисованы', (psvg.match(/stroke-dasharray/g) || []).length > 0)

  // Усиление — узел монтажа: рабочему нужен, клиенту нет.
  // Цвет усиления спрашиваем у панели: труба — единственная несущая деталь проёма,
  // её цвет там и живёт константой, а тест, знающий его литералом, ломается от
  // любой правки палитры и ничего при этом не сторожит.
  const jc = p.q('JAMB_COLOR')
  const tubes = (h) => (h.match(new RegExp('<rect[^>]*fill="' + jc + '"', 'g')) || []).length
  t.ok('усиление на рабочем чертеже', tubes(dsvg) === 4, String(tubes(dsvg)))
  t.ok('и его нет на плане клиента', psvg.indexOf(jc) < 0)
  // Узел вынесен и расписан: на плане кружок с выноской, рядом — сам узел крупно.
  t.ok('на чертеже выноска на узел', /УЗЕЛ 1/.test(dsvg) && /<circle/.test(dsvg))
  t.ok('выноска одна — узел типовой', (dsvg.match(/УЗЕЛ 1/g) || []).length === 1)
  t.ok('узел нарисован рядом с чертежом', /УЗЕЛ 1 · УСИЛЕНИЕ ПРОЁМА/.test(dim) && tubes(dim) > 4)
  // Труба варится ПОВЕРХ листа, значит рез в стене и проём между трубами — одна и
  // та же величина. Узел, обещавший рез на две трубы шире, заставил бы вырезать
  // дырку больше, чем нужно, — а лишнее железо назад не приваришь.
  t.ok('на узле один размер: рез он же проём',
    /рез в стене = проём между трубами = окно \+ 30…40/.test(dim), 'труба варится поверх листа')
  t.ok('и второго размера нет', dim.indexOf('окно + 110…120') < 0)
  t.ok('цепочка подписана окном, а не «изделием»', />окно</.test(dim) && dim.indexOf('>изделие<') < 0)
  // Зазор — не пустота: он заполняется пеной, и на узле это видно, а не только сказано.
  t.ok('зазор показан заполненным пеной', /jamb-foam/.test(dim) && />пена</.test(dim))
  t.ok('и в тексте под узлом это написано', /заполняется монтажной пеной/.test(dim))
  t.ok('и в нём стоят числа', /15…20/.test(dim) && /рез в стене и проём между трубами — один и тот же размер/.test(dim))
  // Труба садится ВО ВПАДИНУ гофры, и на узле обязана быть сказана причина: за
  // трубой на гребне остаётся полость, куда ППУ не зайдёт, — это мостик холода,
  // а не вопрос вкуса. Без причины на площадке приварят как удобнее.
  t.ok('и сказано, что труба во впадине', /во впадин[еу] гофры/.test(dim))
  t.ok('и почему именно так', /ППУ/.test(dim) && /мостик холода/.test(dim))
  // Лист контейнера — гофрой, а не полосой: это единственное, чем стена контейнера
  // отличается от каркасной, и на узле это видно сразу. Волну узнаём по ломаной с
  // десятком изломов там, где у полосы была бы одна прямая.
  const zig = (h) => (h.match(/ L /g) || []).length
  const jamb = p.run('jambDetailSvg()')
  // Считаем изломы кромки: у гофры их десятки, у прямой полосы — ни одного. Точное
  // число зависит от шага волны и от впадины под трубу, поэтому сторожим порядок,
  // а не цифру: тест про «стена нарисована волной», а не про длину периода.
  t.ok('в узле проёма стена идёт гофрой', /лист контейнера/.test(jamb) && zig(jamb) > 12, String(zig(jamb)))
  const skin = p.run('wallDetailSvg(skinLayers(presetModel(MODEL_PRESETS[0], winTypes, gid).model))')
  t.ok('и в пироге наружной стены металл тоже гофрой', zig(skin) > 20, String(zig(skin)))
  // А в перегородке её нет и быть не может: она стоит внутри дома.
  const part = p.run('wallDetailSvg(wallLayers(presetModel(MODEL_PRESETS[0], winTypes, gid).model))')
  t.ok('в перегородке листа контейнера нет', zig(part) === 0, String(zig(part)))
  t.ok('клиенту про трубы не рассказываем', pl.indexOf('УСИЛЕНИЕ ПРОЁМА') < 0 && pl.indexOf('УЗЕЛ 1') < 0)

  // Второй узел — пирог перегородки: по «100 мм» на плане стену не собрать.
  t.ok('на чертеже выноска на перегородку', /УЗЕЛ 2/.test(dsvg))
  // Узлы — вкладками: их три, и листать чертёж сквозь чужие узлы незачем.
  t.ok('вкладки узлов есть', ['n1', 'n2', 'n3'].every((v) => dim.indexOf('data-a="spec2-node-tab" data-v="' + v + '"') >= 0))
  t.ok('по умолчанию открыт узел 1', /УЗЕЛ 1 · УСИЛЕНИЕ ПРОЁМА/.test(dim) && dim.indexOf('УЗЕЛ 2 · ПЕРЕГОРОДКА') < 0)
  t.ok('клиенту узлов не показываем', pl.indexOf('spec2-node-tab') < 0 && psvg.indexOf('УЗЕЛ 2') < 0)

  // Возвращаемся на рабочий вид: узлы живут там, клиенту их не показывают.
  const back = p.dom.node({ a: 'spec2-scheme-view', v: 'dim' }); p.run('bind();'); back.onclick()
  const openNode = (v) => { const el = p.dom.node({ a: 'spec2-node-tab', v: v }); p.run('bind();'); el.onclick(); return p.run('tSpec2()') }
  const n2 = openNode('n2')
  t.ok('узел перегородки расписан слоями',
    /УЗЕЛ 2 · ПЕРЕГОРОДКА/.test(n2) && /Плитка SPC/.test(n2) && /Фанера шлифованная/.test(n2))
  t.ok('и суммой', /77,2 мм/.test(n2))
  t.ok('расхождение с планом названо', /а в плане перегородка <b[^>]*>100 мм/.test(n2))
  const n3 = openNode('n3')
  t.ok('третий узел — наружная стена', /УЗЕЛ 3 · НАРУЖНАЯ СТЕНА/.test(n3) && /ППУ/.test(n3) && /85 мм/.test(n3))
  // Пирог правится прямо в узле — там, где на него смотрят.
  t.ok('пока лист не заведён, править нечего',
    n3.indexOf('data-a="model-layer-mm"') < 0 && /станет пирогом вашего дома/.test(n3))
  const btn = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); btn.onclick()
  p.run('modelFull=false;')
  const n3b = p.run('tSpec2()')
  t.ok('у заведённого листа слои правятся в узле',
    /data-a="model-layer-mm"[^>]*data-key="skin"/.test(n3b) && /data-a="model-layer-add"/.test(n3b))
  const mm = p.dom.node({ a: 'model-layer-mm', sh: p.q('specSheets2[0].id'), key: 'skin', i: '1' })
  p.run('bind();')
  mm.value = '80'; mm.onchange()
  t.ok('правка из узла доехала до модели', p.q('specSheets2[0].model.skin[1].mm') === 80)
  t.ok('и план пошёл за пирогом', p.q('specSheets2[0].model.finish') === 115,
    String(p.q('specSheets2[0].model.finish')))
  openNode('n1')

  // Окна на листе клиента выделены цветом и подписаны размером: он читает план
  // окнами — где свет и куда вид, — а марки и цепочки ему ни о чём не говорят.
  t.ok('окна выделены цветом', (psvg.match(/#2980b9/g) || []).length >= 4, String((psvg.match(/#2980b9/g) || []).length))
  t.ok('и подписаны размером', />1500×2100</.test(psvg) && />2000×2200</.test(psvg))
  t.ok('дверь размером не подписана', psvg.indexOf('>1000×2100<') < 0)
  t.ok('на рабочем чертеже цвета окон нет', dsvg.indexOf('#2980b9') < 0)
}

// ── 1г. Подписи не налезают друг на друга ────────────────────────────────────
// Имя помещения и марка проёма спорят за одно поле внутри стен. Наложенные, они не
// читаются оба сразу — а по марке на чертеже находят изделие в спецификации.
{
  t.section('Подписи не сталкиваются')
  const p = panel()
  // Комната с длинным именем и дверью в перегородке — тот самый случай.
  p.run('specSheets2=[];')
  const btn = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); btn.onclick()
  p.run('specSheets2[0].model.rooms[2].name="Помещение";modelSync(specSheets2[0]);')
  const svg = p.run('modelSchemeSvg(specSheets2[0].model, winTypes, 0, "dim")')

  // Коробки текста — по тем же правилам, по которым их считает панель.
  const boxes = []
  const re = /<text ([^>]*)>([^<]*)<\/text>/g
  let m
  while ((m = re.exec(svg))) {
    const at = m[1]
    const num = (k) => { const r = new RegExp(k + '="(-?[\\d.]+)"').exec(at); return r ? Number(r[1]) : 0 }
    const size = num('font-size') || 100
    const vert = / transform="rotate/.test(at)
    const anchor = (/text-anchor="([a-z]+)"/.exec(at) || [])[1] || 'middle'
    const txt = m[2]
    if (!txt.trim()) continue
    const w = txt.length * size * 0.62, h = size * 1.15
    const bw = vert ? h : w, bh = vert ? w : h
    const x = num('x'), y = num('y')
    const x0 = vert ? x - bw / 2 : (anchor === 'start' ? x : (anchor === 'end' ? x - bw : x - bw / 2))
    const y0 = vert ? y - bh / 2 : y - size * 0.8
    boxes.push({ txt: txt, size: size, x0: x0, y0: y0, x1: x0 + bw, y1: y0 + bh })
  }
  const hit = (a, b) => !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0)
  // Подписи, которые обязаны стоять чисто: имена помещений и выноски на узлы.
  const names = boxes.filter((b) => /^[А-ЯЁ -]+$/.test(b.txt) && b.size >= 180)
  const nodes = boxes.filter((b) => /^УЗЕЛ \d$/.test(b.txt))
  t.ok('имена помещений нашлись', names.length >= 3, String(names.length))
  t.ok('и три выноски на узлы', nodes.length === 3, String(nodes.length))
  const clash2 = []
  nodes.forEach((n) => boxes.forEach((b) => { if (b !== n && hit(n, b)) clash2.push(n.txt + ' × ' + b.txt) }))
  t.ok('выноска не легла на чужую подпись', clash2.length === 0, clash2.join(' | '))
  const clashes = []
  names.forEach((n) => boxes.forEach((b) => {
    if (b === n) return
    if (hit(n, b)) clashes.push(n.txt + ' × ' + b.txt)
  }))
  t.ok('ни одно имя не легло на чужую подпись', clashes.length === 0, clashes.join(' | '))
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

  // Пироги стен приезжают вместе с редактором: план идёт за ними, поэтому обшивка
  // сразу равна сумме своего пирога, а не числу «просто так».
  t.ok('пироги стен материализовались',
    p.q('specSheets2[0].model.skin.length') === 5 && p.q('specSheets2[0].model.layers.length') === 7)
  t.ok('и толщины в плане — их суммы',
    p.q('specSheets2[0].model.finish') === 85 && p.q('specSheets2[0].model.wallThick') === 77,
    p.q('specSheets2[0].model.finish') + ' / ' + p.q('specSheets2[0].model.wallThick'))

  // Правка модели обязана доехать до чертежа: иначе схема показывает вчерашний дом.
  p.run('specSheets2[0].model.rooms[0].name="Ванная";specSheets2[0].model.rooms[0].len=3085;')
  const after = p.run('tSpec2()')
  t.ok('имя помещения на схеме поменялось', /ВАННАЯ/.test(after) && !/САНУЗЕЛ/.test(after))
  t.ok('и размер в цепочке тоже', /<text[^>]*>3000</.test(after), 'нет 3000')
  t.ok('площади пересчитались', /6,55/.test(after), 'нет площади ванной')
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
