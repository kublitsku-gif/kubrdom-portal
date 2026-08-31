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

  // Инструмент «проём» показывает каталог изделий — окна ставятся из него.
  click(p, { a: 'model-tool', k: 'op' })
  const ops = p.run('modelFullOverlay()')
  t.ok('каталог изделий предлагается', ops.indexOf('data-a="model-place-type"') >= 0)
  t.ok('в нём есть окно с чертежа', /Окно 1500×2100/.test(ops))

  // Двинули перегородку — площади в панели поехали следом.
  const before = p.q('modelAreas(specSheets[0].model, winTypes).rooms[0].floor')
  p.run('specSheets[0].model=moveBoundary(specSheets[0].model,0,500);')
  const after = p.q('modelAreas(specSheets[0].model, winTypes).rooms[0].floor')
  t.ok('перенос границы меняет площадь', after > before, before + ' -> ' + after)
  t.ok('и панель показывает новое число', p.run('modelFullOverlay()').indexOf(String(after).replace('.', ',')) >= 0,
    String(after))
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
  click(p, { a: 'model-split', id: bays[1] })
  t.ok('отсек разделился', p.q('specSheets[0].model.rooms.length') === n0 + 1)
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
  canvas.onclick({ clientX: 500, clientY: 140 })
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
  click(p, { a: 'model-tool', k: 'op' })
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
  t.ok('и на чертеже она появилась',
    (p.run('modelPlanSvg(specSheets[0], true)').match(/data-side="part"/g) || []).length === 1)
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

t.done()
