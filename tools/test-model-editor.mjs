#!/usr/bin/env node
// Редактор модели: вкладка «Перегородки» (public/admin.js).
//
// Дверь в перегородке нельзя описать так же, как окно в стене коробки: у неё есть
// СВОЯ перегородка, сторона открывания и откос с петлями. Здесь сторожим то, что
// иначе ломается тихо: дверь встаёт на выбранную перегородку, а не в первую
// попавшуюся, список показывает только её проёмы, а развёртка не пытается
// нарисовать стену, которой на ней нет.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

function panel() {
  const p = boot({})
  p.set({
    expProducts: [], estimates: [], dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], winTypes: [], objects: [], templates: [],
    contractDocs: [], purchases: [], issues: [], users: [], stock: [], settings: {},
  })
  // Заготовка даёт готовый контейнер: две перегородки и две двери в них.
  p.run('specShowNew=true;specNew=Object.assign({},specNew,{kind:"house",preset:"c12-san-liv-bed"});')
  p.dom.field('spec-n-name', 'Редактор'); p.dom.field('spec-n-client', '')
  const b = p.dom.node({ a: 'spec-create' }); p.run('bind();'); b.onclick()
  p.run('specOpenId=specSheets[0].id;')
  return p
}
const click = (p, dataset) => { const el = p.dom.node(dataset); p.run('bind();'); el.onclick(); return el }
// Лист опытного раздела «Спецификация 2»: те же перегородки и проёмы, но окна и
// двери разведены по своим инструментам. Боевые листы этой обкатки не видят.
function lab() {
  const p = panel()
  click(p, { a: 'spec2-edit' })
  return p
}
const doors = (p) => p.q('specSheets[0].model.openings.filter(function(o){return o.side==="part";})')

// ── 1. Вкладка есть и показывает свою перегородку ────────────────────────────
{
  t.section('Вкладка «Перегородки»')
  const p = panel()
  const card = p.run('specModelHtml(specSheets[0])')
  t.ok('вкладка предлагается', card.indexOf('data-a="model-side" data-s="part"') >= 0)

  click(p, { a: 'model-side', s: 'part' })
  const view = p.run('specModelHtml(specSheets[0])')
  t.ok('перегородки перечислены с соседями', /Перегородка 1/.test(view) && /Санузел \/ Кухня-гостиная/.test(view))
  t.ok('вторая тоже', /Перегородка 2/.test(view) && /Кухня-гостиная \/ Спальня/.test(view))
  // В списке — только двери выбранной перегородки, а не все подряд.
  const first = p.q('modelPart')
  t.ok('выбрана первая перегородка', first === p.q('specSheets[0].model.rooms[0].id'))
  t.ok('в списке одна дверь', (view.match(/data-a="model-op-del"/g) || []).length === 1,
    String((view.match(/data-a="model-op-del"/g) || []).length))
  t.ok('подоконника у неё нет', view.indexOf('data-a="model-op-sill"') < 0)
  t.ok('зато есть створка и петли',
    view.indexOf('data-a="model-op-into"') >= 0 && view.indexOf('data-a="model-op-hinge"') >= 0)
}

// ── 2. Створка и петли переключаются ─────────────────────────────────────────
{
  t.section('Куда открывается')
  const p = panel()
  click(p, { a: 'model-side', s: 'part' })
  const id = doors(p)[0].id
  t.ok('по умолчанию — в сторону конца, петли на первом откосе',
    doors(p)[0].into === 1 && doors(p)[0].hinge === 'start')
  click(p, { a: 'model-op-into', id: id })
  t.ok('створка развернулась', doors(p)[0].into === -1, String(doors(p)[0].into))
  click(p, { a: 'model-op-hinge', id: id })
  t.ok('петли перешли на другой откос', doors(p)[0].hinge === 'end', String(doors(p)[0].hinge))
  // Чертёж обязан поехать следом — иначе бригада смотрит на старую створку.
  const sc = p.q('modelScheme(specSheets[0].model, winTypes).openings.filter(function(o){return o.id===' + JSON.stringify(id) + ';})[0]')
  t.ok('схема нарисует створку в другую сторону', sc.swing.tip.x < sc.x, JSON.stringify(sc.swing))
}

// ── 3. Добавление и удаление ─────────────────────────────────────────────────
{
  t.section('Добавить и убрать')
  const p = panel()
  click(p, { a: 'model-side', s: 'part' })
  // Переключаемся на ВТОРУЮ перегородку и ставим дверь туда.
  const second = p.q('specSheets[0].model.rooms[1].id')
  click(p, { a: 'model-part', id: second })
  const doorType = p.q('winTypes.filter(function(t){return t.kind==="door"&&t.w===700;})[0].id')
  click(p, { a: 'model-op-add', t: doorType })
  const onSecond = doors(p).filter((o) => o.after === second)
  t.ok('дверь встала на выбранную перегородку, а не в первую', onSecond.length === 2, String(onSecond.length))
  t.ok('и знает сторону открывания', onSecond[1].into === 1 && onSecond[1].hinge === 'start')
  t.ok('подоконник ей не приписан', !('sill' in onSecond[1]), JSON.stringify(onSecond[1]))

  const del = onSecond[1].id
  click(p, { a: 'model-op-del', id: del })
  t.ok('удаляется', !doors(p).some((o) => o.id === del))
  t.ok('соседние двери целы', doors(p).length === 2, String(doors(p).length))
}

// ── 4. Развёртка перегородку не рисует ───────────────────────────────────────
{
  t.section('Развёртка')
  const p = panel()
  p.run('modelView="elev";')
  click(p, { a: 'model-side', s: 'part' })
  // Развёртка — вид на стену коробки изнутри, перегородка стоит поперёк и в него
  // не попадает. Молча показать чужую стену было бы хуже, чем вернуть план.
  t.ok('вид вернулся к плану', p.q('modelView') === 'plan', p.q('modelView'))
  t.ok('в выборе стен развёртки перегородок нет',
    p.q('MODEL_SIDES.map(function(x){return x[0];}).join(" ")') === 'n s w e')
  t.ok('а в выборе проёмов — есть',
    p.q('MODEL_OP_SIDES.map(function(x){return x[0];}).join(" ")') === 'n s w e part')
}

// ── 5. Модель без перегородок ────────────────────────────────────────────────
{
  t.section('Когда перегородок нет')
  const p = panel()
  p.run('specSheets[0].model=emptyModel("40hc");specSheets[0].model.rooms[0].id="one";modelSide="part";')
  const view = p.run('specModelHtml(specSheets[0])')
  t.ok('честно говорим, что ставить некуда', /Перегородок в модели нет/.test(view))
  t.ok('кнопок «добавить проём» не показываем', view.indexOf('data-a="model-op-add"') < 0)
}

// ── 6. Полный экран: площади рядом с планом ─────────────────────────────────
{
  t.section('Редактор на весь экран')
  const p = panel()
  click(p, { a: 'model-full' })
  t.ok('оверлей открыт', p.q('modelFull') === true)
  const ov = p.run('modelFullOverlay()')
  t.ok('план на месте', ov.indexOf('model-svg-full') >= 0)
  t.ok('инструменты на месте',
    ov.indexOf('data-a="model-tool"') >= 0 && ov.indexOf('data-a="model-zoom"') >= 0)
  t.ok('панель площадей рядом', /ПОМЕЩЕНИЯ И ПЛОЩАДИ/.test(ov) && /ВСЕГО ПО ДОМУ/.test(ov))
  t.ok('пол, потолок и стены показаны', /ПОЛ/.test(ov) && /ПОТОЛОК/.test(ov) && /СТЕНЫ/.test(ov))
  t.ok('имя помещения правится прямо там', ov.indexOf('data-a="model-room-name"') >= 0)
  t.ok('числа настоящие', /25,52/.test(ov), 'нет общей площади пола')

  // Боевой редактор остался прежним: один инструмент «Проём» и общий ряд изделий.
  t.ok('у боевого листа инструмент один', /data-a="model-tool" data-k="op"/.test(ov))
  t.ok('и окон с дверями врозь в нём нет',
    ov.indexOf('data-a="model-tool" data-k="win"') < 0 && ov.indexOf('data-a="model-tool" data-k="door"') < 0)
  click(p, { a: 'model-tool', k: 'op' })
  const ops = p.run('modelFullOverlay()')
  t.ok('изделия предлагаются одним рядом', ops.indexOf('data-a="model-place-type"') >= 0)
  t.ok('в нём есть окно с чертежа', /Окно 1500×2100/.test(ops))
  t.ok('и дверь тоже — список общий', /Дверь входная 1000×2100/.test(ops))
  t.ok('вкладок «Мои изделия / Каталог» в боевом нет', ops.indexOf('data-a="model-place-tab"') < 0)

  // Двинули перегородку — площади в панели поехали следом.
  const before = p.q('modelAreas(specSheets[0].model, winTypes).rooms[0].floor')
  p.run('specSheets[0].model=moveBoundary(specSheets[0].model,0,500);')
  const after = p.q('modelAreas(specSheets[0].model, winTypes).rooms[0].floor')
  t.ok('перенос границы меняет площадь', after > before, before + ' -> ' + after)
  t.ok('и панель показывает новое число', p.run('modelFullOverlay()').indexOf(String(after).replace('.', ',')) >= 0,
    String(after))
}

// ── 6б. Опытный раздел: окна и двери врозь, со своим каталогом ───────────────
// «Спецификация 2» обкатывает разделение на своих листах: у окна и двери разные
// списки изделий, разные стены и свой каталог поставщика с мини-картинками.
{
  t.section('Опытный редактор: окна и двери')
  const p = lab()
  const ov = p.run('modelFullOverlay()')
  t.ok('инструментов два', /data-a="model-tool" data-k="win"/.test(ov) && /data-a="model-tool" data-k="door"/.test(ov))
  t.ok('и общего «Проёма» больше нет', ov.indexOf('data-a="model-tool" data-k="op"') < 0)

  click(p, { a: 'model-tool', k: 'win' })
  const wins = p.run('modelFullOverlay()')
  t.ok('свои изделия предлагаются', wins.indexOf('data-a="model-place-type"') >= 0)
  t.ok('в нём есть окно с чертежа', /Окно 1500×2100/.test(wins))
  t.ok('а входной двери в окнах нет', wins.indexOf('Дверь входная 1000×2100') < 0)
  t.ok('вид переключился на окна', p.q('modelKind') === 'win')

  // Вторая вкладка — каталог поставщика, с картинкой у каждого изделия.
  click(p, { a: 'model-place-tab', v: 'cat' })
  const cat = p.run('modelFullOverlay()')
  t.ok('каталог предлагается', cat.indexOf('data-a="wt-cat-add"') >= 0)
  t.ok('с ценой поставщика', /14.555 ₽/.test(cat) && /Витраж 2160×2390/.test(cat))
  t.ok('и с мини-картинкой', (cat.match(/<svg viewBox="0 0 1300 1150"/g) || []).length === 1)
  t.ok('дверей в каталоге окон нет', cat.indexOf('Дверь входная 1000×2100') < 0)

  // У дверей каталог свой, и межкомнатное полотно лежит в нём же.
  click(p, { a: 'model-tool', k: 'door' })
  const dcat = p.run('modelFullOverlay()')
  t.ok('в дверях — двери', /Дверь входная 1000×2100/.test(dcat) && /Дверь межкомнатная 700×2050/.test(dcat))
  t.ok('и ни одного окна', dcat.indexOf('Витраж 2160×2390') < 0)

  // Карточка листа следует за инструментом: вид первой вкладкой, перегородки
  // только у дверей, счётчики врозь.
  const card = p.run('specModelHtml(specSheet(specOpenId))')
  t.ok('вид — первая вкладка', /data-a="model-kind" data-k="win"/.test(card) && /data-a="model-kind" data-k="door"/.test(card))
  t.ok('у дверей есть перегородки', card.indexOf('data-a="model-side" data-s="part"') >= 0)
  click(p, { a: 'model-kind', k: 'win' })
  const wcard = p.run('specModelHtml(specSheet(specOpenId))')
  t.ok('у окон перегородок нет', wcard.indexOf('data-a="model-side" data-s="part"') < 0)
  t.ok('и счётчик разведён по видам', /ОКОН/.test(wcard) && /ДВЕРЕЙ/.test(wcard) && wcard.indexOf('ПРОЁМОВ') < 0)

  // А боевая карточка этих вкладок не знает.
  const live = p.run('specModelHtml(specSheets[0])')
  t.ok('боевая карточка прежняя',
    live.indexOf('data-a="model-kind"') < 0 && /ПРОЁМОВ/.test(live) && /ОКНА И ДВЕРИ/.test(live))
}

// ── 7. Панель — это ещё и управление ────────────────────────────────────────
{
  t.section('Править, не выходя из полного экрана')
  const p = panel()
  click(p, { a: 'model-full' })
  const ov = p.run('modelFullOverlay()')
  t.ok('длина отсека правится числом', ov.indexOf('data-a="model-room-len"') >= 0)
  // Поле type="number" значение с запятой не принимает и показывает пустое поле —
  // длина выглядела незаполненной и в панели, и в карточке.
  const lens = (ov.match(/data-a="model-room-len"[^>]*value="([^"]*)"/g) || [])
    .map((x) => x.match(/value="([^"]*)"/)[1])
  t.ok('и поле не пустое', lens.length === 3 && lens.every((v) => v !== ''), JSON.stringify(lens))
  t.ok('значение с точкой, а не с запятой', lens.every((v) => v.indexOf(',') < 0 && isFinite(Number(v))),
    JSON.stringify(lens))
  t.ok('и это настоящая длина', lens[0] === '2.08', lens[0])
  const cardLens = (p.run('specModelHtml(specSheets[0])').match(/data-a="model-room-len"[^>]*value="([^"]*)"/g) || [])
    .map((x) => x.match(/value="([^"]*)"/)[1])
  t.ok('в карточке то же самое', cardLens.join(' ') === lens.join(' '), JSON.stringify(cardLens))
  t.ok('есть деление поперёк', ov.indexOf('data-a="model-split"') >= 0)
  t.ok('есть продольная перегородка', ov.indexOf('data-a="model-split-w"') >= 0)
  t.ok('есть снятие перегородки', ov.indexOf('data-a="model-merge"') >= 0)
  // У последнего отсека перегородки справа нет — и кнопки быть не должно.
  const bays = p.q('modelBays(specSheets[0].model).map(function(b){return b.id;})')
  const last = bays[bays.length - 1]
  t.ok('у последнего отсека «убрать» не предлагается',
    ov.indexOf('data-a="model-merge" data-id="' + last + '"') < 0)

  // Длина отсека — это перенос миллиметров у соседа: сумма с контейнером не расходится.
  const before = p.q('totalLength(specSheets[0].model)')
  const el = p.dom.node({ a: 'model-room-len', id: bays[0] })
  el.value = '2,41'
  p.run('bind();')
  el.onchange()
  t.ok('длина применилась', Math.abs(p.q('modelBays(specSheets[0].model)[0].len') - 2410) < 10,
    String(p.q('modelBays(specSheets[0].model)[0].len')))
  t.ok('габарит контейнера не поехал', p.q('totalLength(specSheets[0].model)') === before)
  t.ok('площади пересчитались', /2,33|2,34/.test(p.run('modelFullOverlay()')) ||
    p.q('modelAreas(specSheets[0].model, winTypes).rooms[0].l') > 2.3)

  // Деление прямо из панели.
  const n0 = p.q('specSheets[0].model.rooms.length')
  // Кухню посередине делить нельзя: там ровно входная дверь — стене не на что встать.
  click(p, { a: 'model-split', id: bays[1] })
  t.ok('через дверь отсек не делится', p.q('specSheets[0].model.rooms.length') === n0,
    String(p.q('specSheets[0].model.rooms.length')))
  click(p, { a: 'model-split', id: bays[0] })
  t.ok('отсек без проёмов разделился', p.q('specSheets[0].model.rooms.length') === n0 + 1)
}

// ── 8. После стены снова можно двигать ──────────────────────────────────────
{
  t.section('Инструмент возвращается в «Двигать»')
  const p = panel()
  click(p, { a: 'model-full' })
  click(p, { a: 'model-tool', k: 'wall' })
  t.ok('режим рисования включён', p.q('modelTool') === 'wall')
  t.ok('в нём ручек нет', p.run('modelPlanSvg(specSheets[0], true)').indexOf('data-a="model-drag"') < 0)
  // Ставим стену тем же путём, что и палец: через холст.
  const canvas = p.dom.node({ a: 'model-canvas', vb: '-700 -700 13352 3752' })
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 281 })
  p.run('bind();')
  // Сначала целимся ровно в окно: перегородке там не на что встать.
  const onWin = (2916 + 4536) / 2
  canvas.onclick({ clientX: (onWin + 700) / 13352 * 1000, clientY: 140 })
  t.ok('в проём стена не встаёт', p.q('specSheets[0].model.rooms.length') === 3,
    String(p.q('specSheets[0].model.rooms.length')))
  t.ok('и инструмент остался включённым', p.q('modelTool') === 'wall')
  // А в свободное место — встаёт.
  canvas.onclick({ clientX: (7400 + 700) / 13352 * 1000, clientY: 140 })
  t.ok('стена поставлена', p.q('specSheets[0].model.rooms.length') === 4,
    String(p.q('specSheets[0].model.rooms.length')))
  // Стену ставят по одной: остаться в режиме рисования значит спрятать ручки и
  // оставить человека думать, что двигать вообще нельзя.
  t.ok('и режим вернулся к «Двигать»', p.q('modelTool') === 'sel', p.q('modelTool'))
  t.ok('ручки снова на месте', p.run('modelPlanSvg(specSheets[0], true)').indexOf('data-a="model-drag"') >= 0)
}

// ── 7. Имя второй комнаты в отсеке ──────────────────────────────────────────
{
  t.section('Санузел в углу')
  const p = panel()
  // Продольная перегородка даёт вторую комнату в том же отсеке; её имя тоже правится.
  const bay = p.q('specSheets[0].model.rooms[0].id')
  p.run('specSheets[0].model=splitLengthwiseAt(specSheets[0].model,' + JSON.stringify(bay) + ',1100,"sub1");')
  const el = p.dom.node({ a: 'model-room-name', id: 'sub1' })
  el.value = 'Душевая'
  p.run('bind();')
  el.oninput()
  const sub = p.q('specSheets[0].model.rooms[0].sub')
  t.ok('имя второй комнаты сохранилось', sub && sub.name === 'Душевая', JSON.stringify(sub))
  t.ok('она попала в площади',
    p.q('modelAreas(specSheets[0].model, winTypes).rooms.filter(function(r){return r.name==="Душевая";}).length') === 1)
}

// ── 9. Дверь в перегородку ставится тапом по ней ─────────────────────────────
// Межкомнатную дверь показывают стеной, в которой она стоит. Раньше тап по
// перегородке уезжал на ближайшую НАРУЖНУЮ стену: на плане межкомнатную дверь
// поставить было нечем вообще, и в редакторе их «не было видно».
{
  t.section('Дверь тапом по перегородке')
  const p = panel()
  p.run('specSheets[0].model.openings=specSheets[0].model.openings.filter(function(o){return o.side!=="part";});modelSync(specSheets[0]);')
  const outer0 = p.q('specSheets[0].model.openings.length')
  click(p, { a: 'model-full' })
  const doorType = p.q('winTypes.find(function(x){return x.kind==="door";}).id')
  click(p, { a: 'model-tool', k: 'door' })
  click(p, { a: 'model-place-type', t: doorType })

  // Тап ровно по оси первой перегородки, как пальцем по плану.
  const plan = p.run('modelPlanSvg(specSheets[0], true)')
  const vb = /viewBox="([-\d]+) ([-\d]+) (\d+) (\d+)"/.exec(plan).slice(1).map(Number)
  const PX = 1200
  const canvas = p.dom.node({ a: 'model-canvas', vb: vb.join(' ') })
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: PX, height: PX * vb[3] / vb[2] })
  p.run('bind();')
  const xmm = p.q('modelBays(specSheets[0].model)[0].x1') + p.q('specSheets[0].model.wallThick') / 2
  canvas.onclick({ clientX: (xmm - vb[0]) / vb[2] * PX, clientY: (1200 - vb[1]) / vb[2] * PX })

  const d = doors(p)
  t.ok('дверь встала в перегородку', d.length === 1, JSON.stringify(d))
  t.ok('и именно в ту, по которой тапнули',
    d.length === 1 && d[0].after === p.q('specSheets[0].model.rooms[0].id'), JSON.stringify(d[0]))
  t.ok('на наружную стену ничего не уехало',
    p.q('specSheets[0].model.openings.filter(function(o){return o.side!=="part";}).length') === outer0)
  t.ok('створку есть чем нарисовать', d[0].into === 1 && d[0].hinge === 'start')
  // И она сразу выбрана: петли со створкой правят тут же, не переключая инструмент.
  t.ok('и она сразу выбрана', p.q('modelOpSel') === d[0].id)
  t.ok('и на чертеже она появилась',
    (p.run('modelPlanSvg(specSheets[0], true)').match(/data-side="part"/g) || []).length === 1)
}

// ── 9б. Тап по проёму в режиме установки — это выбор, а не второй проём ──────
// Ручки перетаскивания в режиме установки скрыты (иначе они перехватывают тап по
// стене), и поставленную дверь стало нечем настроить: петли, сторону створки и
// положение числом правят у ВЫБРАННОГО проёма. Уходить за ними в «Двигать» никто
// не догадывается, а тап по двери инструментом «Двери» клал вторую поверх первой.
{
  t.section('Настроить поставленную дверь')
  const p = lab()
  // Двери берём у ОТКРЫТОГО листа: боевой рядом, и его проёмы здесь ни при чём.
  const open = () => p.q('specSheet(specOpenId).model.openings.filter(function(o){return o.side==="part";})')
  click(p, { a: 'model-tool', k: 'door' })
  const door = open()[0]
  const before = p.q('specSheet(specOpenId).model.openings.length')

  click(p, { a: 'model-op-hit', id: door.id })
  t.ok('дверь выбрана', p.q('modelOpSel') === door.id)
  t.ok('второй двери не появилось',
    p.q('specSheet(specOpenId).model.openings.length') === before, String(before))

  const bar = p.run('modelFullOverlay()')
  t.ok('петли и створка под рукой',
    bar.indexOf('data-a="model-op-hinge"') >= 0 && bar.indexOf('data-a="model-op-into"') >= 0)
  t.ok('и положение числом', bar.indexOf('data-a="model-op-posn"') >= 0)

  // Число — то же, что на чертеже: дверь в перегородке меряется от ЧИСТОВОЙ стены,
  // поэтому 1 м на экране это 1076 по коробке (обшивка 76).
  const inp = p.dom.node({ a: 'model-op-posn', id: door.id })
  p.run('bind();')
  inp.value = '1'; inp.onchange()
  t.ok('размер вводится числом', open()[0].pos === 1076, String(open()[0].pos))

  click(p, { a: 'model-op-hinge', id: door.id })
  click(p, { a: 'model-op-into', id: door.id })
  t.ok('петли и створка переключились', open()[0].hinge === 'end' && open()[0].into === -1)

  // Повторный тап снимает выбор, а в «Убрать» тап по-прежнему удаляет.
  click(p, { a: 'model-op-hit', id: door.id })
  t.ok('повторный тап снимает выбор', p.q('modelOpSel') === null)
  click(p, { a: 'model-tool', k: 'del' })
  click(p, { a: 'model-op-hit', id: door.id })
  t.ok('в «Убрать» тап удаляет', !open().some((o) => o.id === door.id))
}

// ── 9в. Стена не заезжает на окно, а усиление снимается кнопкой ──────────────
// Перегородка, доехавшая до окна, упирается в стеклопакет: на чертеже это дыра в
// наружной стене, а не планировка. Жест при этом не отменяется — стена просто
// встаёт у проёма, как встаёт у соседней комнаты короче MIN_ROOM.
{
  t.section('Стена, окно и усиление')
  const p = lab()
  const at = () => p.q('modelBays(specSheet(specOpenId).model).map(function(b){return b.x1;})')
  const was = at()[0]

  const el = p.dom.node({ a: 'model-drag', i: '0' })
  el.ownerSVGElement = { dataset: { vbw: '13352' }, getBoundingClientRect: () => ({ width: 1000, height: 300 }) }
  p.run('bind();')
  // Тянем на окно: 1200 мм вправо — это 90 px при таком масштабе.
  el.onpointerdown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} })
  el.onpointermove({ clientX: 1200 / 13352 * 1000, clientY: 0 })
  el.onpointerup()
  const win = p.q('specSheet(specOpenId).model.openings.filter(function(o){return o.side==="s";})[0]')
  t.ok('граница поехала', at()[0] > was, was + ' -> ' + at()[0])
  t.ok('но встала перед окном с усилением', at()[0] + p.q('specSheet(specOpenId).model.wallThick') <= win.pos - 60,
    at()[0] + ' при окне с ' + win.pos)

  // Усиление у выбранного проёма снимается и возвращается кнопкой: у глухого
  // витража его нет, а что стоит в этом проёме, знает человек, а не чертёж.
  p.run('modelOpSel=' + JSON.stringify(win.id) + ';')
  const bar = p.run('modelFullOverlay()')
  t.ok('кнопка усиления предлагается', /data-a="model-op-frame"/.test(bar) && /усиление 40×40/.test(bar))
  click(p, { a: 'model-op-frame', id: win.id })
  t.ok('усиление снято', p.q('specSheet(specOpenId).model.openings.filter(function(o){return o.id===' + JSON.stringify(win.id) + ';})[0].frame') === false)
  t.ok('и с чертежа тоже',
    (p.run('modelSchemeSvg(specSheet(specOpenId).model, winTypes, 0, "dim")').match(/<rect[^>]*fill="#2f4a63"/g) || []).length === 2)
  t.ok('кнопка это показывает', /без усиления/.test(p.run('modelFullOverlay()')))
  click(p, { a: 'model-op-frame', id: win.id })
  t.ok('и возвращается', p.q('specSheet(specOpenId).model.openings.filter(function(o){return o.id===' + JSON.stringify(win.id) + ';})[0].frame') === true)
}

// ── 10. «Вернуть» отменяет удаление ──────────────────────────────────────────
// Удаление здесь необратимо по своей природе: перегородка уносит с собой помещение.
// Без отмены единственный способ вернуть промах — собирать планировку заново.
{
  t.section('Вернуть удалённое')
  const p = panel()
  click(p, { a: 'model-full' })
  t.ok('пока ничего не меняли, «Вернуть» неактивна',
    /data-a="model-undo" disabled/.test(p.run('modelFullOverlay()')))

  const rooms0 = p.q('specSheets[0].model.rooms.length')
  click(p, { a: 'model-tool', k: 'del' })
  click(p, { a: 'model-wall-hit', i: '0' })
  t.ok('перегородки не стало', p.q('specSheets[0].model.rooms.length') === rooms0 - 1,
    String(p.q('specSheets[0].model.rooms.length')))
  t.ok('и кнопка стала активной', !/data-a="model-undo" disabled/.test(p.run('modelFullOverlay()')))

  click(p, { a: 'model-undo' })
  t.ok('перегородка вернулась', p.q('specSheets[0].model.rooms.length') === rooms0,
    String(p.q('specSheets[0].model.rooms.length')))
  t.ok('и характеристики пересчитались обратно',
    p.q('specSheets[0].specs.rooms.length') === rooms0,
    String(p.q('specSheets[0].specs.rooms.length')))
  t.ok('второй раз возвращать нечего', /data-a="model-undo" disabled/.test(p.run('modelFullOverlay()')))

  // Имя комнаты пишется на каждую букву — отменять его посимвольно значит
  // похоронить в истории ту самую снесённую перегородку.
  const rid = p.q('specSheets[0].model.rooms[0].id')
  const inp = p.dom.node({ a: 'model-room-name', id: rid })
  p.run('bind();')
  inp.value = 'Санузе'; inp.oninput()
  inp.value = 'Санузел 2'; inp.oninput()
  t.ok('переименование историю не засоряет', /data-a="model-undo" disabled/.test(p.run('modelFullOverlay()')))
}

// ── 11. Полотно межкомнатной двери заводится из редактора ────────────────────
// Лист «из прошлого» такого изделия не знает: в ряду изделий его нет, и поставить
// дверь между комнатами нечем. Уходить за одной строкой справочника в карточку —
// это выйти из редактора посреди работы, поэтому полотно заводится кнопкой рядом.
{
  t.section('Завести межкомнатное полотно')
  const p = panel()
  p.run('specSheets[0].model.openings=specSheets[0].model.openings.filter(function(o){return o.side!=="part";});' +
    'winTypes=winTypes.filter(function(t){return !(t.kind==="door"&&t.w===700);});modelSync(specSheets[0]);')
  click(p, { a: 'model-full' })
  click(p, { a: 'model-tool', k: 'op' })
  const bar = p.run('modelFullOverlay()')
  t.ok('кнопка «завести полотно» предлагается', /data-a="wt-cat-add" data-k="inner-700x2050"/.test(bar))

  click(p, { a: 'wt-cat-add', k: 'inner-700x2050' })
  const d = p.q('winTypes.filter(function(t){return t.kind==="door"&&t.w===700;})')
  t.ok('полотно заведено 700×2050', d.length === 1 && d[0].h === 2050, JSON.stringify(d))
  t.ok('цена нулевая — её ставит человек', d[0].cost === 0, String(d[0].cost))
  t.ok('и оно сразу выбрано для установки', p.q('modelPlaceType') === d[0].id)
  t.ok('инструмент — «Проём»', p.q('modelTool') === 'op')

  // Второй тап дубля не заводит: то же изделие двумя строками развело бы по двум
  // ценам один и тот же заказ, поэтому кнопка и пропадает.
  t.ok('второй раз кнопка не предлагается',
    p.run('modelFullOverlay()').indexOf('data-k="inner-700x2050"') < 0)
  click(p, { a: 'wt-new' })
  click(p, { a: 'wt-cat-add', k: 'inner-700x2050' })
  t.ok('и повтором дубля не завести',
    p.q('winTypes.filter(function(t){return t.kind==="door"&&t.w===700;}).length') === 1)

  // И этим полотном дверь ставится тапом по перегородке.
  const plan = p.run('modelPlanSvg(specSheets[0], true)')
  const vb = /viewBox="([-\d]+) ([-\d]+) (\d+) (\d+)"/.exec(plan).slice(1).map(Number)
  const PX = 1200
  const canvas = p.dom.node({ a: 'model-canvas', vb: vb.join(' ') })
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: PX, height: PX * vb[3] / vb[2] })
  p.run('bind();')
  const xmm = p.q('modelBays(specSheets[0].model)[0].x1') + p.q('specSheets[0].model.wallThick') / 2
  canvas.onclick({ clientX: (xmm - vb[0]) / vb[2] * PX, clientY: (1200 - vb[1]) / vb[2] * PX })
  t.ok('дверь встала в перегородку', doors(p).length === 1, JSON.stringify(doors(p)))
}

// ── 12. Открывание двери правится тапом по ней на чертеже ────────────────────
// Створку правят там же, где на неё смотрят. Постоянного ряда кнопок нет: он был бы
// шумом у каждого проёма — панель показывается только у выбранной двери.
{
  t.section('Открывание двери на чертеже')
  const p = panel()
  click(p, { a: 'model-full' })
  const door = p.q('specSheets[0].model.openings.filter(function(o){return o.side==="part";})[0]')

  // Тап по двери — без сдвига: сдвиг двигает проём, тап выбирает.
  const hit = p.dom.node({ a: 'model-op-drag', id: door.id, side: 'part', span: '2352', w: '700' })
  hit.setAttribute = () => {}
  // querySelector — как в настоящем SVG: во время жеста редактор двигает группу проёма.
  hit.ownerSVGElement = { dataset: { vbw: '13352' }, getBoundingClientRect: () => ({ width: 1000, height: 300 }),
    querySelector: () => ({ setAttribute: () => {} }) }
  p.run('bind();')
  hit.onpointerdown({ clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} })
  hit.onpointerup()
  t.ok('дверь выбрана', p.q('modelOpSel') === door.id, String(p.q('modelOpSel')))

  // Тап с дрожанием руки — всё ещё тап. Порог считается в ПИКСЕЛЯХ экрана: в
  // миллиметрах он зависит от масштаба, и на плане 12 м два пикселя дрожания — это
  // 25 мм. Обычный клик уезжал перетаскиванием, и панель выбора не открывалась
  // вовсе — вместе с ней пропадали и петли, и точный размер.
  p.run('modelOpSel=null;')
  const was = p.q('specSheets[0].model.openings.filter(function(o){return o.side==="part";})[0].pos')
  hit.onpointerdown({ clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} })
  hit.onpointermove({ clientX: 101, clientY: 102 })
  hit.onpointerup()
  t.ok('дрожащий тап всё равно выбирает', p.q('modelOpSel') === door.id, String(p.q('modelOpSel')))
  t.ok('и проём не сдвинулся',
    p.q('specSheets[0].model.openings.filter(function(o){return o.side==="part";})[0].pos') === was,
    was + ' → ' + p.q('specSheets[0].model.openings.filter(function(o){return o.side==="part";})[0].pos'))

  // А настоящий жест по-прежнему двигает.
  hit.onpointerdown({ clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} })
  hit.onpointermove({ clientX: 100, clientY: 140 })
  hit.onpointerup()
  t.ok('жест на сорок пикселей двигает',
    p.q('specSheets[0].model.openings.filter(function(o){return o.side==="part";})[0].pos') !== was)
  p.run('modelOpSel=' + JSON.stringify(door.id) + ';')

  const bar = p.run('modelFullOverlay()')
  t.ok('панель открывания появилась',
    bar.indexOf('data-a="model-op-into"') >= 0 && bar.indexOf('data-a="model-op-hinge"') >= 0)

  const swing = () => p.q('modelScheme(specSheets[0].model, winTypes).openings.find(function(o){return o.id===' + JSON.stringify(door.id) + ';}).swing')
  const tip0 = JSON.stringify(swing().tip), hinge0 = JSON.stringify(swing().hinge)
  click(p, { a: 'model-op-into', id: door.id })
  t.ok('створка перекинулась в другую комнату', JSON.stringify(swing().tip) !== tip0,
    tip0 + ' → ' + JSON.stringify(swing().tip))
  click(p, { a: 'model-op-hinge', id: door.id })
  t.ok('петли переехали на другой откос', JSON.stringify(swing().hinge) !== hinge0,
    hinge0 + ' → ' + JSON.stringify(swing().hinge))

  click(p, { a: 'model-op-unsel' })
  t.ok('«Готово» снимает выбор', p.q('modelOpSel') === null)
  t.ok('и панель исчезла', p.run('modelFullOverlay()').indexOf('data-a="model-op-hinge"') < 0)

  // Дверь в наружной стене правится теми же кнопками — раньше их у неё не было.
  const wall = p.q('specSheets[0].model.openings.filter(function(o){return o.side==="s";})[1]')
  p.run('modelOpSel=' + JSON.stringify(wall.id) + ';')
  t.ok('у входной двери те же кнопки',
    p.run('modelFullOverlay()').indexOf('data-a="model-op-into"') >= 0)
  const wsw = () => p.q('modelScheme(specSheets[0].model, winTypes).openings.find(function(o){return o.id===' + JSON.stringify(wall.id) + ';}).swing')
  const wtip = JSON.stringify(wsw().tip)
  click(p, { a: 'model-op-into', id: wall.id })
  t.ok('и она открывается внутрь', JSON.stringify(wsw().tip) !== wtip, wtip + ' → ' + JSON.stringify(wsw().tip))
}

// ── 13. Окно и дверь двигаются пальцем ───────────────────────────────────────
// Жест обязан пережить сам себя: `render()` меняет innerHTML целиком, и элемент с
// захваченным указателем исчезает вместе с ним — проём отъезжал на пару пикселей и
// вставал. Поэтому во время жеста двигается РИСУНОК (transform), а модель считается
// один раз на отпускании. Сторожим и то, и другое.
{
  t.section('Двигать окна и двери')
  const p = panel()
  click(p, { a: 'model-full' })
  const win = p.q('specSheets[0].model.openings.filter(function(o){return o.side==="s";})[0]')
  const VBW = 13352, PX = 1000, DRAG = 60
  const marks = []
  const art = { setAttribute: (k, v) => marks.push(['art', k, v]) }
  const hit = p.dom.node({ a: 'model-op-drag', id: win.id, side: 's', span: '11952', w: '1500' })
  hit.setAttribute = (k, v) => marks.push(['hit', k, v])
  hit.ownerSVGElement = {
    dataset: { vbw: String(VBW) },
    getBoundingClientRect: () => ({ width: PX, height: 300 }),
    querySelector: (sel) => (sel.indexOf(win.id) >= 0 ? art : null),
  }
  p.run('bind();')
  hit.onpointerdown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} })
  hit.onpointermove({ clientX: DRAG, clientY: 0 })
  t.ok('рисунок едет за пальцем прямо во время жеста',
    marks.some((m) => m[0] === 'art' && m[1] === 'transform') &&
    marks.some((m) => m[0] === 'hit' && m[1] === 'transform'), JSON.stringify(marks))
  t.ok('модель во время жеста не трогаем',
    p.q('specSheets[0].model.openings.filter(function(o){return o.id===' + JSON.stringify(win.id) + ';})[0].pos') === win.pos)

  hit.onpointerup()
  const after = p.q('specSheets[0].model.openings.filter(function(o){return o.id===' + JSON.stringify(win.id) + ';})[0].pos')
  const want = win.pos + Math.round(DRAG * VBW / PX)
  t.ok('на отпускании проём встал ровно туда, куда вели', Math.abs(after - want) <= 1,
    after + ' вместо ' + want)
  t.ok('и характеристики пересчитались', p.q('specSheets[0].specs.rooms.length') > 0)

  // Проём не уезжает за край своей стены — иначе окно повиснет в воздухе.
  hit.onpointerdown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} })
  hit.onpointermove({ clientX: 100000, clientY: 0 })
  hit.onpointerup()
  const far = p.q('specSheets[0].model.openings.filter(function(o){return o.id===' + JSON.stringify(win.id) + ';})[0].pos')
  t.ok('за край стены не уходит', far === 11952 - 1500, String(far))
}

// ── 14. Проём в торце: жест и точное число ───────────────────────────────────
// В торце витраж 2000 стоит в стене 2352: ходу 352 мм — на экране три сантиметра.
// Жест там работает, но ставить проём в такой щели пальцем бессмысленно, поэтому
// у выбранного проёма есть поле «от края». Сторожим оба пути и упор в край стены.
{
  t.section('Проём в торцевой стене')
  const p = panel()
  click(p, { a: 'model-full' })
  const op = p.q('specSheets[0].model.openings.filter(function(o){return o.side==="e";})[0]')
  const pos = () => p.q('specSheets[0].model.openings.filter(function(o){return o.side==="e";})[0].pos')

  const VBW = 13352, PX = 1000
  const hit = p.dom.node({ a: 'model-op-drag', id: op.id, side: 'e', span: '2352', w: '2000' })
  hit.setAttribute = () => {}
  hit.ownerSVGElement = { dataset: { vbw: String(VBW) }, getBoundingClientRect: () => ({ width: PX, height: 300 }),
    querySelector: () => ({ setAttribute: () => {} }) }
  p.run('bind();')
  // Жест вертикальный — вдоль торца. Двигаем на 20 пикселей: меньше семи считается
  // дрожанием руки и остаётся тапом, иначе обычный клик уезжал бы перетаскиванием.
  hit.onpointerdown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} })
  hit.onpointermove({ clientX: 0, clientY: 20 })
  hit.onpointerup()
  t.ok('жестом по торцу проём едет', pos() !== op.pos, op.pos + ' → ' + pos())
  t.ok('и упирается в край стены', pos() <= 2352 - 2000, String(pos()))

  // Точное число — там, где жестом уже не попасть.
  p.run('modelOpSel=' + JSON.stringify(op.id) + ';')
  const bar = p.run('modelFullOverlay()')
  t.ok('поле «от края» показано', bar.indexOf('data-a="model-op-posn"') >= 0)
  t.ok('и рядом видно, сколько всего ходу', bar.indexOf('ход 0…0,35') >= 0, bar.indexOf('ход') >= 0 ? 'подпись есть, но другая' : 'подписи нет')
  const inp = p.dom.node({ a: 'model-op-posn', id: op.id })
  p.run('bind();')
  inp.value = '0,2'; inp.onchange()
  t.ok('число ставит проём точно', pos() === 200, String(pos()))
  inp.value = '9'; inp.onchange()
  t.ok('за край стены число не пускает', pos() === 352, String(pos()))
}

// ── 15. Число в поле — это число с чертежа ───────────────────────────────────
// Дверь в перегородке чертёж меряет от ЧИСТОВОЙ стены (обшивка 76 в размер не
// входит). Поле обязано говорить так же: иначе человек вводит 0,9, читает на
// чертеже 824 и не понимает, кто из двоих врёт. Одна арифметика на жест, поле и
// ползунок — три места, считающие «докуда можно», разъедутся в первый же день.
{
  t.section('Положение проёма — числом с чертежа')
  const p = panel()
  click(p, { a: 'model-full' })
  const door = p.q('specSheets[0].model.openings.filter(function(o){return o.side==="part";})[0]')
  const fin = p.q('specSheets[0].model.finish')
  p.run('modelOpSel=' + JSON.stringify(door.id) + ';')

  // Цепочка на чертеже: первый отрезок — от чистовой стены до двери.
  const seg = () => p.q('modelScheme(specSheets[0].model, winTypes).dims.filter(function(d){return d.side==="part"&&d.at===' +
    p.q('modelScheme(specSheets[0].model, winTypes).openings.find(function(o){return o.id===' + JSON.stringify(door.id) + ';}).x') +
    ';})[0].segs[0]')

  const inp = p.dom.node({ a: 'model-op-posn', id: door.id })
  p.run('bind();')
  inp.value = '0,9'; inp.onchange()
  t.ok('ввели 0,9 — на чертеже 900', seg() === 900, String(seg()))
  t.ok('в модели это 900 плюс обшивка',
    p.q('specSheets[0].model.openings.filter(function(o){return o.id===' + JSON.stringify(door.id) + ';})[0].pos') === 900 + fin)
  t.ok('и поле показывает то же, что чертёж',
    p.run('modelFullOverlay()').indexOf('value="0.9"') >= 0, 'иначе поле и чертёж говорят разными числами')
  t.ok('подпись поля — «от стены»', p.run('modelFullOverlay()').indexOf('от стены') >= 0)

  // В обшивку дверь не заезжает ни числом, ни жестом.
  inp.value = '-1'; inp.onchange()
  t.ok('к нулю прижимается по чистовой стене',
    p.q('specSheets[0].model.openings.filter(function(o){return o.id===' + JSON.stringify(door.id) + ';})[0].pos') === fin,
    String(p.q('specSheets[0].model.openings.filter(function(o){return o.id===' + JSON.stringify(door.id) + ';})[0].pos')))
  inp.value = '99'; inp.onchange()
  t.ok('и говорит, почему не приняло',
    p.run('modelFullOverlay()').indexOf('не влезает — максимум') >= 0,
    'молча подставленный максимум читается как «оно меня не поняло»')
  const w = p.q('specSheets[0].model.w'), dw = 700
  t.ok('и с другого края тоже',
    p.q('specSheets[0].model.openings.filter(function(o){return o.id===' + JSON.stringify(door.id) + ';})[0].pos') === w - fin - dw,
    String(p.q('specSheets[0].model.openings.filter(function(o){return o.id===' + JSON.stringify(door.id) + ';})[0].pos')))
}

// ── 16. Стена куском: нестандартное помещение ────────────────────────────────
// Стена, проведённая рукой, помещений не делит — она делает комнату Г-образной, а
// замкнутая тремя стенами кладовка становится своей комнатой. Сторожим и жест, и
// то, ради чего он нужен: площади. И прилипание — без него щель в миллиметр
// оставляет проход, и кладовка молча не замыкается.
{
  t.section('Стена куском')
  const p = panel()
  click(p, { a: 'model-full' })
  click(p, { a: 'model-tool', k: 'free' })
  t.ok('инструмент включён', p.q('modelTool') === 'free')

  const plan = p.run('modelPlanSvg(specSheets[0], true)')
  const vb = /viewBox="([-\d]+) ([-\d]+) (\d+) (\d+)"/.exec(plan).slice(1).map(Number)
  const PX = 1200
  const canvas = p.dom.node({ a: 'model-canvas', vb: vb.join(' ') })
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: PX, height: PX * vb[3] / vb[2] })
  canvas.appendChild = () => {}
  const at = (xmm, ymm) => ({ clientX: (xmm - vb[0]) / vb[2] * PX, clientY: (ymm - vb[1]) / vb[2] * PX })
  const draw = (x0, y0, x1, y1) => {
    p.run('bind();')
    canvas.onpointerdown(Object.assign({ pointerId: 1, preventDefault() {} }, at(x0, y0)))
    canvas.onpointermove(at(x1, y1))
    canvas.onpointerup()
  }

  const fin = p.q('specSheets[0].model.finish')
  const rooms0 = p.q('modelRooms(specSheets[0].model).length')
  draw(5200, 200, 5200, 1300)
  const walls = p.q('specSheets[0].model.walls')
  t.ok('стена появилась', walls.length === 1, JSON.stringify(walls))
  t.ok('и она вертикальная, толщиной перегородки',
    walls[0].w === p.q('specSheets[0].model.wallThick') && walls[0].h > 900, JSON.stringify(walls[0]))
  t.ok('верх прилип к чистовой стене', walls[0].y === fin, String(walls[0].y))
  t.ok('помещений не прибавилось', p.q('modelRooms(specSheets[0].model).length') === rooms0,
    'стена-огрызок комнату не делит')
  const cut = p.q('modelRooms(specSheets[0].model).find(function(r){return !r.rect;})')
  t.ok('комната стала Г-образной', !!cut, JSON.stringify(p.q('modelRooms(specSheets[0].model).map(function(r){return r.rect;})')))
  t.ok('инструмент вернулся к «Двигать»', p.q('modelTool') === 'sel', 'стену проводят по одной')

  // Замыкаем кладовку: ещё две стены, концы прилипают к уже нарисованным.
  click(p, { a: 'model-tool', k: 'free' }); draw(7000, 200, 7000, 1300)
  click(p, { a: 'model-tool', k: 'free' }); draw(5200, 1300, 7000, 1300)
  const rooms = p.q('modelRooms(specSheets[0].model)')
  t.ok('кладовка замкнулась в помещение', rooms.length === rooms0 + 1,
    JSON.stringify(rooms.map((r) => [r.name, r.area])))
  const nook = rooms.find((r) => r.area < 3)
  t.ok('её площадь посчитана', !!nook && nook.area > 1, JSON.stringify(nook && nook.area))
  t.ok('и она попала в панель площадей',
    p.run('modelAreasPanel(specSheets[0])').indexOf('ВЫГОРОЖЕНО СТЕНАМИ') > 0)

  // Имя вырезанной комнаты живёт в своей записи с якорем внутри неё.
  const inp = p.dom.node({ a: 'model-room-name', id: nook.id })
  p.run('bind();')
  inp.value = 'Кладовая'; inp.oninput()
  t.ok('имя сохранилось', p.q('specSheets[0].model.spots').length === 1, JSON.stringify(p.q('specSheets[0].model.spots')))
  t.ok('и держится на комнате',
    p.q('modelRooms(specSheets[0].model).some(function(r){return r.name==="Кладовая";})'))

  // Убрать стену — тапом в режиме «Убрать».
  click(p, { a: 'model-tool', k: 'del' })
  click(p, { a: 'model-free-hit', id: p.q('specSheets[0].model.walls')[2].id })
  t.ok('стена убрана', p.q('specSheets[0].model.walls').length === 2)
  t.ok('и кладовка снова стала частью комнаты',
    p.q('modelRooms(specSheets[0].model).length') === rooms0, String(p.q('modelRooms(specSheets[0].model).length')))
}

// ── 17. Вкладка 3D ───────────────────────────────────────────────────────────
// Чертёж отвечает строителю, объём — клиенту: он не обязан уметь читать план.
// Сторожим то, из-за чего вкладка бесполезна: её должно быть видно, дом должен
// вращаться, а вращение — не трогать саму модель.
{
  t.section('Вкладка 3D')
  const p = panel()
  const card = p.run('specModelHtml(specSheets[0])')
  t.ok('вид предлагается в карточке', card.indexOf('data-a="model-view" data-v="iso"') >= 0)

  click(p, { a: 'model-view', v: 'iso' })
  t.ok('вид переключился', p.q('modelView') === 'iso')
  const svg = p.run('modelIsoSvg(specSheets[0])')
  t.ok('дом нарисован', svg.indexOf('data-a="model-iso"') >= 0 && svg.indexOf('<path') > 0)
  t.ok('и вписан в рамку', /viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+"/.test(svg))

  click(p, { a: 'model-full' })
  const ov = p.run('modelFullOverlay()')
  t.ok('на весь экран — тоже дом', ov.indexOf('model-iso-full') >= 0)
  t.ok('и без инструментов черчения', ov.indexOf('data-a="model-tool"') < 0,
    'в объёме нечего чертить — там смотрят')

  // Вращение: тянем по дому.
  const yaw0 = p.q('modelYaw')
  const before = JSON.stringify(p.q('specSheets[0].model'))
  const view = p.dom.node({ a: 'model-iso' }, 'model-iso-full')
  view.setAttribute = () => {}
  view.style = {}
  p.run('bind();')
  view.onpointerdown({ clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} })
  view.onpointermove({ clientX: 200, clientY: 100 })
  view.onpointerup()
  t.ok('дом повернулся', p.q('modelYaw') !== yaw0, yaw0 + ' → ' + p.q('modelYaw'))
  t.ok('а модель не тронута', JSON.stringify(p.q('specSheets[0].model')) === before,
    'камера — это взгляд на дом, а не его свойство')

  p.run('modelTilt=20;')
  click(p, { a: 'model-iso-reset' })
  t.ok('«как было» возвращает камеру', p.q('modelYaw') === 35 && p.q('modelTilt') === 55,
    p.q('modelYaw') + ' / ' + p.q('modelTilt'))
}

// ── 18. Створка не лезет на размеры ──────────────────────────────────────────
// Дуга открывания, перечёркивающая размерную линию, — та же каша, что дверь поверх
// габаритной цепочки, только внутри плана. Цепочка двери в перегородке обязана
// стоять ЗА размахом створки, если распахивается в ту же сторону.
{
  t.section('Цепочка и створка')
  const p = panel()
  const plan = () => p.run('modelSchemeSvg(specSheets[0].model, winTypes)')
  const doors = () => p.q('modelScheme(specSheets[0].model, winTypes).openings.filter(function(o){return o.side==="part"&&o.swing;})')
  // Вертикальные размерные линии внутри плана — те самые цепочки дверей.
  const chainXs = (svg) => [...svg.matchAll(/<line x1="([-\d.]+)" y1="[-\d.]+" x2="([-\d.]+)"[^>]*stroke-width="24"/g)]
    .filter((m) => m[1] === m[2]).map((m) => Number(m[1]))

  const crosses = (svg) => doors().some((d) => {
    const lo = Math.min(d.x, d.swing.tip.x), hi = Math.max(d.x + d.w, d.swing.tip.x)
    return chainXs(svg).some((x) => x > lo && x < hi)
  })
  t.ok('дверь есть и она распахнута', doors().length > 0, String(doors().length))
  t.ok('размерная линия не проходит сквозь створку', !crosses(plan()),
    JSON.stringify(chainXs(plan())) + ' против ' + JSON.stringify(doors().map((d) => [d.x, d.swing.tip.x])))

  // Разворачиваем створку в другую сторону — цепочка обязана уступить снова.
  const id = doors()[0].id
  click(p, { a: 'model-op-into', id: id })
  t.ok('после разворота створки — тоже не проходит', !crosses(plan()),
    JSON.stringify(chainXs(plan())) + ' против ' + JSON.stringify(doors().map((d) => [d.x, d.swing.tip.x])))

  // И уступает ПЕРЕСКОКОМ через стену, а не бегством за размах двери: размер,
  // убежавший на метр от того, что он меряет, читать невозможно.
  const near = doors().map((d) => Math.min.apply(null, chainXs(plan()).map((x) => Math.abs(x - d.x))))
  t.ok('цепочка держится у своей перегородки', near.every((v) => v < 700), JSON.stringify(near))
}

t.done()
