#!/usr/bin/env node
// Порядок работ в этапе без блоков помещений (src/recipe.js: applyRooms;
// public/admin.js: группа переноса строки, data-pos-grp).
//
// Жалоба: «монтаж подвесов не могу переместить выше». Подвесы считаются по
// комнатам («стены · Санузел»), а строки над ними — «на весь дом». Этап 1 на
// экране — плоский список: блоки по помещениям рисуются только у чистового
// этапа. Но перенос держал строку в невидимой группе «этап|комната», а
// applyRooms после ручного порядка снова собирал КАЖДЫЙ этап кучками по
// комнатам — и строка возвращалась ниже всех «на весь дом».
// Сторожим: в этапе без блоков порядок — человека, группа переноса — весь
// этап, объект собирается тем же порядком; чистовой этап читается комнатами.
import { boot, reporter } from './harness/panel-vm.js'
import { applyRooms } from '../src/recipe.js'

const t = reporter()

// ── 1. Кучки по комнатам — только там, где комнаты показаны блоками ────────
{
  t.section('Кучки по комнатам — только в чистовом')
  const L = [
    { key: 'a', stage: 1, room: '', roomId: '' },
    { key: 'b', stage: 1, room: 'Санузел', roomId: 'r1' },
    { key: 'c', stage: 1, room: '', roomId: '' },
    { key: 'd', stage: 3, room: 'Санузел', roomId: 'r1' },
    { key: 'e', stage: 3, room: '', roomId: '' },
    { key: 'f', stage: 3, room: 'Санузел', roomId: 'r1' },
  ]
  const keys = (r) => r.positions.map((p) => p.key).join(',')
  const got = keys(applyRooms({ positions: L }, {}, [], [{ n: 1 }, { n: 3, finish: true }]))
  t.ok('черновой — как расставлено, чистовой — комнатами', got === 'a,b,c,d,f,e', got)
  const old = keys(applyRooms({ positions: L }))
  t.ok('без сведений об этапах — комнатами везде, как раньше', old === 'a,c,b,d,f,e', old)
}

// ── 2. Дом: подвесы по комнатам среди работ «на весь дом» ──────────────────
const PRODUCTS = [{ id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'm2' }]
const EST = [
  { id: 'e_a', kind: 'house', name: 'Утепление пола', stage: 2, lines: [{ pid: 'p_osb', qty: 1 }] },
  { id: 'e_b', kind: 'house', name: 'Разводка электрики', stage: 2, lines: [{ pid: 'p_osb', qty: 2 }] },
  { id: 'e_hang', kind: 'house', name: 'Монтаж подвесов', stage: 2, lines: [{ pid: 'p_osb', qty: 1 }] },
]
const RULES = [{ id: 'r_hang', kind: 'house', estId: 'e_hang', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 2 }]

function panel() {
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
    specSheets: [], specSheets2: [], projects: [], buildRules: RULES,
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30 },
  })
  return p
}
function create(p, name) {
  p.run('tab="projects";projOpenId=null;tProjects();')
  const btn = p.dom.node({ a: 'proj-new' }); p.run('bind();'); btn.onclick()
  p.dom.field('proj-n-name', name); p.dom.field('proj-n-client', 'c1'); p.run('tProjects();')
  const go = p.dom.node({ a: 'proj-create' }); p.run('bind();'); go.onclick()
  p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};projBand="parts";')
}
{
  t.section('Подвесы встают выше')
  const p = panel()
  create(p, 'Дом с подвесами')
  const W = () => p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.filter(function(s){return s.n===2;})[0]')
  const st = W()
  const house = st.positions.filter((x) => !x.roomId).map((x) => x.key)
  const room = st.positions.filter((x) => x.roomId).map((x) => x.key)
  t.ok('в этапе две работы на весь дом и подвесы по комнатам', house.length === 2 && room.length >= 2,
    'дом ' + house.length + ', комнаты ' + room.length)
  t.ok('блоков у чернового этапа нет', st.blocks.length === 0)

  const html = p.run('tProjects()')
  const grps = [...html.matchAll(/data-pos-grp="([^"]*)"/g)].map((m) => m[1]).filter((g) => g.indexOf('2|') === 0)
  t.ok('у всех строк этапа одна группа переноса', grps.length === st.positions.length && new Set(grps).size === 1,
    JSON.stringify([...new Set(grps)]))

  t.ok('перестановка принята',
    p.q('estPosPutBefore(' + JSON.stringify(room[0]) + ',' + JSON.stringify(house[1]) + ')') === true)
  const after = W().positions.map((x) => x.key)
  t.ok('подвесы встали между работами «на весь дом»',
    after.indexOf(house[0]) < after.indexOf(room[0]) && after.indexOf(room[0]) < after.indexOf(house[1]),
    after.join(' , '))

  // Объект собирается ТЕМ ЖЕ порядком: иначе в смете одно, на стройке другое.
  const obj = p.q('specBuildStages(projects[0]).reduce(function(a,s){return a.concat(s.works||[]);},[]).map(function(w){return w.posKey||"";})')
    .filter((k) => after.indexOf(k) >= 0)
  t.ok('объект собирается тем же порядком', obj.join(',') === after.join(','), obj.join(' , '))
}

t.done()
