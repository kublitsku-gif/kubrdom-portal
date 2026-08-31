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

t.done()
