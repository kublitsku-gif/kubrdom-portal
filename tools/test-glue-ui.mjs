#!/usr/bin/env node
// Клей под обшивку стен — в строке сметы проекта (public/admin.js).
//
// Формулу сторожит test-glue.mjs. Здесь — то, что видит и нажимает человек: у
// Tytan в «Стенах спальни» с фанерой стоит «клей: нужно N шт», тап ставит число;
// в строке, где клея нет, — кнопка «＋ Tytan Classic Fix» с Леманы сразу нужным
// количеством. И что ручное количество материала после выноса в общий хелпер
// правится как прежде.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const LEMANA_URL = 'https://lemanapro.ru/product/kley-montazhnyy-tytan-classic-fix-prozrachnyy-310-ml-89453236/'
const PRODUCTS = [
  { id: 'p_ply', name: 'Фанера 4 мм ФК шлифованная 1525×1525 мм', unitCost: 488, store: 'Лемана ПРО', mode: 'sheet', packBase: 'м²', packPer: 2.325 },
  { id: 'p_tyt', name: 'Клея монтажный Classic Fix TYTAN упаковка 12 шт', unitCost: 533, store: 'Озон', mode: 'piece' },
  { id: 'p_lem', name: 'Клей монтажный Tytan Classic Fix прозрачный 310 мл', unitCost: 557, store: 'Лемана ПРО', mode: 'piece', url: LEMANA_URL },
]
const EST = [
  { id: 'e_bed', kind: 'house', name: 'Стены спальня', stage: 2, lines: [{ pid: 'p_tyt', qty: 1 }, { pid: 'p_ply', qty: 1 }] },
  { id: 'e_hall', kind: 'house', name: 'Стены зал', stage: 2, lines: [{ pid: 'p_ply', qty: 1 }] },
]
const RULES = [
  { id: 'r_bed', kind: 'house', estId: 'e_bed', what: 'surface', k: 'wall', scope: 'house', qty: 1, stage: 0 },
  { id: 'r_hall', kind: 'house', estId: 'e_hall', what: 'surface', k: 'wall', scope: 'house', qty: 1, stage: 0 },
]

const p = boot({})
p.set({
  expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
  specSheets: [], specSheets2: [], projects: [], buildRules: RULES,
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
const rowOf = (estId) => p.q(`(function(){ const x=${POS}.filter(function(r){ return r.estId===${JSON.stringify(estId)}; })[0];
  return x?{ key:x.key, glue:glueForRow(x, glueRateOf(settings)), mats:x.mats.map(function(m){ return { k:matSwapKey(x,m), pid:m.pid, n:m.n, qty:m.qty, added:!!m.added }; }) }:null; })()`)
const listHtml = (key) => p.run(`matsOpen[${JSON.stringify(key)}]=true; tProjects()`)
const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')

{
  t.section('Tytan в строке — подсказка и тап')
  t.ok('проект с чертежом заведён', p.q('projects.length') === 1)
  const bed = rowOf('e_bed')
  t.ok('строка «Стены спальня» считает клей', !!bed && !!bed.glue && bed.glue.tubes > 0, JSON.stringify(bed && bed.glue))
  const tytan = bed.mats.find((m) => m.pid === 'p_tyt')
  const html = listHtml(bed.key)
  const need = 'клей: нужно ' + bed.glue.tubes + ' шт'
  t.ok('у Tytan стоит «' + need + '»', plain(html).indexOf(need) >= 0, plain(html).slice(0, 400))
  t.ok('кнопка несёт число и адрес материала',
    html.indexOf('data-a="est-mat-qty-to" data-k="' + tytan.k + '" data-q="' + bed.glue.tubes + '"') >= 0)
  t.ok('клей в строке есть — «＋ Tytan» не предлагаем', html.indexOf('data-a="est-glue-add" data-k="' + bed.key + '"') < 0)

  const tap = p.dom.node({ a: 'est-mat-qty-to', k: tytan.k, q: String(bed.glue.tubes) }); p.run('bind();'); tap.onclick()
  const after = rowOf('e_bed').mats.find((m) => m.pid === 'p_tyt')
  t.ok('тап ставит количество клея', after.qty === bed.glue.tubes, String(after.qty))
  t.ok('строка отмечена галочкой', plain(listHtml(bed.key)).indexOf('✓ клей ' + bed.glue.tubes + ' шт') >= 0)
}

{
  t.section('Клея нет — «＋ Tytan Classic Fix» с Леманы')
  const hall = rowOf('e_hall')
  t.ok('строка «Стены зал» считает клей', !!hall && !!hall.glue, JSON.stringify(hall && hall.glue))
  const html = listHtml(hall.key)
  t.ok('предлагает товар с Леманы с числом',
    plain(html).indexOf('＋ Клей монтажный Tytan Classic Fix прозрачный 310 мл · ' + hall.glue.tubes + ' шт') >= 0, plain(html).slice(0, 400))

  const add = p.dom.node({ a: 'est-glue-add', k: hall.key, q: String(hall.glue.tubes) }); p.run('bind();'); add.onclick()
  const row = rowOf('e_hall')
  const glue = row.mats.find((m) => m.pid === 'p_lem')
  t.ok('клей дописан в строку', !!glue && glue.added, JSON.stringify(row.mats))
  t.ok('сразу нужным числом', glue && glue.qty === hall.glue.tubes, String(glue && glue.qty))
  t.ok('с ценой и магазином из базы', p.q(`projects[0].matAdd[${JSON.stringify(hall.key)}][0].cost`) === 557
    && p.q(`projects[0].matAdd[${JSON.stringify(hall.key)}][0].store`) === 'Лемана ПРО')
  const html2 = listHtml(hall.key)
  t.ok('кнопка «＋» ушла', html2.indexOf('data-a="est-glue-add" data-k="' + hall.key + '"') < 0)
  t.ok('и стоит галочка', plain(html2).indexOf('✓ клей ' + hall.glue.tubes + ' шт') >= 0)
}

{
  // Норма расхода правится в самой подсказке и одна на портал (settings.glueGPerM2).
  t.section('Норма расхода — «⚙ 100 г/м²» у подсказки')
  const bed = rowOf('e_bed')
  const html = listHtml(bed.key)
  t.ok('по умолчанию 100 г/м²', bed.glue.rate === 100 && plain(html).indexOf('⚙ 100 г/м²') >= 0, plain(html).slice(0, 300))
  t.ok('кнопка нормы есть', html.indexOf('data-a="glue-rate"') >= 0)

  p.run('prompt=function(){ return "200"; };')
  const rate = p.dom.node({ a: 'glue-rate' }); p.run('bind();'); rate.onclick()
  t.ok('норма записана в настройки', p.q('settings.glueGPerM2') === 200, String(p.q('settings.glueGPerM2')))
  const bed2 = rowOf('e_bed')
  t.ok('строка пересчитала клей', bed2.glue.rate === 200 && bed2.glue.tubes === Math.ceil(bed2.glue.area * 200 / 280 - 1e-9),
    JSON.stringify(bed2.glue))
  t.ok('подсказка показывает новое число', plain(listHtml(bed.key)).indexOf('⚙ 200 г/м²') >= 0)

  p.run('prompt=function(){ return "много"; };'); rate.onclick()
  t.ok('не число — норма прежняя', p.q('settings.glueGPerM2') === 200)
  p.run('prompt=function(){ return null; };'); rate.onclick()
  t.ok('отмена — норма прежняя', p.q('settings.glueGPerM2') === 200)
  p.run('prompt=function(){ return "120,5"; };'); rate.onclick()
  t.ok('дробная через запятую', p.q('settings.glueGPerM2') === 120.5)
}

{
  t.section('Ручное количество правится как прежде')
  const bed = rowOf('e_bed')
  const ply = bed.mats.find((m) => m.pid === 'p_ply')
  const inp = p.dom.node({ a: 'est-mat-qty', k: ply.k }); inp.value = '7'
  p.run('bind();'); inp.onchange()
  t.ok('число вписано', rowOf('e_bed').mats.find((m) => m.pid === 'p_ply').qty === 7)
  inp.value = ''; inp.onchange()
  t.ok('пустое число снимает правку', rowOf('e_bed').mats.find((m) => m.pid === 'p_ply').qty === ply.qty)
}

t.done()
