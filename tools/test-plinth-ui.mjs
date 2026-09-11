#!/usr/bin/env node
// Плинтус в строке сметы проекта (public/admin.js).
//
// Формулу сторожит test-plinth.mjs. Здесь — то, что видит и нажимает человек: у
// плинтуса в «Монтаже плинтусов, откосов» стоят варианты «пол … м → N шт», тап
// ставит число — расчётному материалу ручным количеством строки, дописанному — в
// сам лист; совпавшее число помечено галочкой.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PINE_N = 'Плинтус деревянный Сосна АА сращенный / фигурный (13 * 43 * 3000 мм)'
const PRODUCTS = [
  { id: 'p_pine', name: PINE_N, unitCost: 144, store: 'Белка', mode: 'piece' },
]
const EST = [
  { id: 'e_pl', kind: 'house', name: 'Монтаж плинтусов, откосов', stage: 3, lines: [{ pid: 'p_pine', qty: 1 }] },
]

const p = boot({})
p.set({
  expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
  specSheets: [], specSheets2: [], projects: [], buildRules: [],
  winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
  users: [], stock: [], settings: { specMarkup: 30 },
})
// Создание так, как это делает человек: имя → заготовка → «Создать» (как в test-projects).
p.run('tab="projects";projOpenId=null;tProjects();')
const newBtn = p.dom.node({ a: 'proj-new' }); p.run('bind();'); newBtn.onclick()
p.dom.field('proj-n-name', 'Дом Ивановых')
p.dom.field('proj-n-client', 'c1')
p.run('tProjects();')
const createBtn = p.dom.node({ a: 'proj-create' }); p.run('bind();'); createBtn.onclick()
p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};')

const POS = 'allPositions(projects[0], specCtx(projects[0]))'
// Строка, её плинтус и варианты — тем же plinthOptions, что и экран: своя
// арифметика в тесте разошлась бы с подсказкой.
const rowOf = (pred) => p.q(`(function(){
  const x=${POS}.filter(function(r){ return r.estId==="e_pl"; })[0]; if(!x)return null;
  const m=x.mats.filter(function(mm){ return ${pred}; })[0]; if(!m)return null;
  const opts=plinthOptions(x, m, modelAreas(projects[0].model, winTypes));
  return { key:x.key, k:matSwapKey(x,m), id:m.id, qty:m.qty, added:!!m.added,
    opts:opts.map(function(o){ return { k:o.k, need:o.need, txt:o.n+" "+numRu(o.len)+" м → "+numRu(o.need)+" шт" }; }) };
})()`)
const listHtml = (key) => p.run(`matsOpen[${JSON.stringify(key)}]=true; tProjects()`)
const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')

{
  t.section('Плинтус из справочника — варианты и тап')
  t.ok('проект с чертежом заведён', p.q('projects.length') === 1)
  const row = rowOf('!mm.added')
  t.ok('у плинтуса есть варианты: пол, потолок, оба',
    !!row && row.opts.map((o) => o.k).join(',') === 'floor,ceil,both', JSON.stringify(row && row.opts))
  const html = listHtml(row.key)
  const floor = row.opts[0]
  t.ok('в строке стоит «' + floor.txt + '»', plain(html).indexOf(floor.txt) >= 0, plain(html).slice(0, 500))
  t.ok('кнопка несёт число и адрес материала',
    html.indexOf('data-a="est-mat-qty-to" data-k="' + row.k + '" data-q="' + floor.need + '"') >= 0)

  const tap = p.dom.node({ a: 'est-mat-qty-to', k: row.k, q: String(floor.need) }); p.run('bind();'); tap.onclick()
  const after = rowOf('!mm.added')
  t.ok('тап ставит количество плинтуса', after.qty === floor.need, String(after.qty))
  const html2 = plain(listHtml(row.key))
  t.ok('совпавшее помечено галочкой', html2.indexOf('✓ плинтус ' + floor.need + ' шт') >= 0, html2.slice(0, 500))
}

{
  t.section('Дописанный руками плинтус — число в сам лист')
  const key = rowOf('!mm.added').key
  p.run(`projects[0].matAdd=Object.assign({}, projects[0].matAdd||{}, { [${JSON.stringify(key)}]: [
    { id:"pl2", pid:"p_pine", n:${JSON.stringify(PINE_N)}, store:"Белка", mode:"piece", cost:144, qty:1 } ] });`)
  const row = rowOf('mm.added')
  t.ok('дописанный плинтус в строке', !!row && row.added, JSON.stringify(row))
  const ceil = row.opts.find((o) => o.k === 'ceil')
  const html = listHtml(row.key)
  t.ok('кнопка «потолок» пишет в дописанный материал',
    html.indexOf('data-a="est-mat-need" data-k="' + row.key + '" data-m="pl2" data-q="' + ceil.need + '"') >= 0)
  const tap = p.dom.node({ a: 'est-mat-need', k: row.key, m: 'pl2', q: String(ceil.need) }); p.run('bind();'); tap.onclick()
  t.ok('число легло в лист', p.q(`projects[0].matAdd[${JSON.stringify(key)}][0].qty`) === ceil.need,
    String(p.q(`projects[0].matAdd[${JSON.stringify(key)}][0].qty`)))
}

t.done()
