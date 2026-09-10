#!/usr/bin/env node
// Перенос работы в другой этап пальцем (public/admin.js: dragRow, dropZoneOk).
//
// Жалоба с площадки: «не могу перетянуть работу в другой этап». Бросок засчитывался
// только над ВЕРХНЕЙ строкой шапки этапа — полоской в 28 px, — а свёрнутая
// карточка этапа высотой в сто с лишним: деньги, «цены», «+», полоска доли.
// Строку бросают на карточку, мимо полоски, и жест тихо становился перестановкой
// внутри своего этапа (в тулбаре появлялось «отменить перестановку работы»).
// Вторая дыра: строка, одна в своём блоке, не бралась вовсе — ручка есть, а
// перенос не начинался, потому что переставляться ей не с кем, и шапки для неё
// тоже не проверялись.
//
// Прежние проверки звали estPosDropZone() напрямую и самого жеста не видели.
// Здесь — и решение «куда можно бросить», и сам жест на подставном DOM.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'm2' },
  { id: 'p_sock', name: 'Розетка', unitCost: 300, store: 'Белка', mode: 'piece' },
]
const EST = [
  { id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2, lines: [{ pid: 'p_osb', qty: 1 }] },
  { id: 'e_win', kind: 'house', name: 'Монтаж окна', stage: 2, optPoint: 'win', lines: [{ pid: 'p_sock', qty: 1 }] },
]

function panel() {
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
    specSheets: [], specSheets2: [], projects: [], buildRules: [],
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
const q = (p, expr) => { try { return p.q(expr) } catch (e) { return 'ERR: ' + e.message } }

// ── 1. Куда можно бросить ───────────────────────────────────────────────────
// Группа строки — «этап|помещение»; у общего блока дома помещение «-».
{
  t.section('Куда можно бросить')
  const p = panel()
  t.ok('карточка другого этапа — да', q(p, 'dropZoneOk({dropStage:"2"}, "1|-")') === true)
  t.ok('карточка своего этапа — нет, это перестановка', q(p, 'dropZoneOk({dropStage:"1"}, "1|-")') === false)
  t.ok('другое помещение своего этапа — да', q(p, 'dropZoneOk({dropStage:"1",dropRoom:"r1"}, "1|-")') === true)
  t.ok('своё помещение — нет', q(p, 'dropZoneOk({dropStage:"1",dropRoom:"r1"}, "1|r1")') === false)
  t.ok('общий блок дома — это «-», свой', q(p, 'dropZoneOk({dropStage:"1",dropRoom:""}, "1|-")') === false)
  t.ok('то же помещение в другом этапе — да', q(p, 'dropZoneOk({dropStage:"2",dropRoom:"r1"}, "1|r1")') === true)
  t.ok('не адрес — нет', q(p, 'dropZoneOk({}, "1|-")') === false)
  t.ok('пусто — нет', q(p, 'dropZoneOk(null, "1|-")') === false)
}

// ── 2. Цель — вся карточка этапа ────────────────────────────────────────────
{
  t.section('Цель — вся карточка этапа')
  const p = panel()
  create(p, 'Дом с этапами')
  const html = p.run('tProjects()')
  t.ok('карточка этапа сама — адрес броска',
    /<div data-drop-stage="2" style="background:#fff;border:1px solid #dde6f0;border-radius:13px/.test(html))
  t.ok('и шапка по-прежнему адрес', /data-a="est-stage-open" data-n="2" data-drop-stage="2"/.test(html))
}

// ── 3. Одинокая строка ──────────────────────────────────────────────────────
// Две работы, разведённые по двум этапам: в каждом этапе по одной строке.
// Переставлять их внутри этапа не с чем, но перенести в соседний этап — можно.
{
  t.section('Одинокая строка')
  const p = panel()
  create(p, 'Дом по строке в этапе')
  const keys = q(p, 'allPositions(projects[0], specCtx(projects[0])).map(function(x){return x.key;})')
  t.ok('в доме две работы', keys.length === 2, JSON.stringify(keys))
  p.run('var o={}; o[' + JSON.stringify(keys[0]) + ']=3; projects[0].posStage=o;')
  const html = p.run('tProjects()')
  const handles = (html.match(/data-a="est-pos-drag"/g) || []).length
  t.ok('у каждой строки есть ручка — есть куда перенести', handles === 2, String(handles))
}

// ── 4. Сам жест ─────────────────────────────────────────────────────────────
// Подставной DOM: строки знают соседей и место на экране, elementFromPoint
// отвечает тем узлом, что под пальцем. «Внутри карточки» — строка денег или
// кнопок этапа: не шапка, но часть карточки.
function gesture(p, opts) {
  p.run(`
    var __L={}, __log=[];
    document.addEventListener=function(t,f){ __L[t]=f; };
    document.removeEventListener=function(t){ delete __L[t]; };
    var __mk=function(ds, top){ return { dataset:ds, style:{}, up:null, parentNode:null, nextSibling:null,
      getBoundingClientRect:function(){ return { top:top, height:40 }; },
      closest:function(sel){ var m=/data-([a-z-]+)/.exec(sel); var k=m?m[1].replace(/-([a-z])/g,function(_,c){return c.toUpperCase();}):"";
        var x=this; while(x){ if(x.dataset&&x.dataset[k]!==undefined)return x; x=x.up; } return null; } }; };
    var __par={ children:[], insertBefore:function(){}, removeChild:function(){} };
    var __row=__mk({posRow:"k1",posGrp:"1|-"}, 100); __row.parentNode=__par;
    var __kids=[__row];
    ${opts.lone ? '' : 'var __sib=__mk({posRow:"k2",posGrp:"1|-"}, 200); __sib.parentNode=__par; __kids.push(__sib);'}
    __par.children=__kids;
    var __h=__mk({}, 100); __h.parentNode=__row; __h.setPointerCapture=function(){};
    var __card1=__mk({dropStage:"1"}, 0), __in1=__mk({}, 250); __in1.up=__card1;
    var __card2=__mk({dropStage:"2"}, 400), __in2=__mk({}, 420); __in2.up=__card2;
    var __at={ none:null, own:__in1, other:__in2 }[${JSON.stringify(opts.over)}];
    document.elementFromPoint=function(){ return __at; };
    dragRow(__h, { preventDefault:function(){}, pointerId:1 }, "posRow", "posGrp",
      function(b){ __log.push("done:"+b); }, function(z){ __log.push("zone:"+z.dropStage); });
    if(__L.pointermove)__L.pointermove({ clientX:10, clientY:${opts.y} });
    if(__L.pointerup)__L.pointerup({});
  `)
  return JSON.stringify(p.q('__log'))
}
{
  t.section('Жест: одинокая строка')
  const p = panel()
  const a = gesture(p, { lone: true, over: 'other', y: 420 })
  t.ok('брошена на карточку другого этапа — уезжает туда', a === '["zone:2"]', a)
  const b = gesture(p, { lone: true, over: 'none', y: 600 })
  t.ok('отпущена мимо — ничего не происходит', b === '[]', b)
}
{
  t.section('Жест: строка среди соседей')
  const p = panel()
  const a = gesture(p, { lone: false, over: 'own', y: 250 })
  t.ok('над своим этапом — перестановка, а не перенос', a === '["done:"]', a)
  const b = gesture(p, { lone: false, over: 'other', y: 420 })
  t.ok('над чужой карточкой мимо шапки — уезжает туда', b === '["zone:2"]', b)
}

// ── 5. Шапка помещения НИЖЕ строки: рамка «сюда» не должна прыгать ─────────
// Жалоба: «стены санузла не могу опустить в санузел». Пока строку ведут, под
// пальцем едет рамка «сюда» высотой в строку. Над адресом рамку прятали ЦЕЛИКОМ
// (display:none) — и всё, что ниже, подпрыгивало на её высоту: шапка «Санузел»
// (34 px) уезжала из-под пальца, на следующем движении адрес гас, рамка
// возвращалась, шапка падала обратно. Адрес мигал, и где он окажется в момент
// отпускания — случайно; чаще выходила перестановка. Цель ВЫШЕ рамки (бросок в
// предыдущий этап) этого не замечала: прятание рамки её не двигало.
function gestureShift(p) {
  p.run(`
    var __L={}, __log=[], __slot=null;
    var __mkEl=document.createElement;
    document.createElement=function(t){ var el=__mkEl.call(document,t); if(t==="div")__slot=el; return el; };
    document.addEventListener=function(t,f){ __L[t]=f; };
    document.removeEventListener=function(t){ delete __L[t]; };
    var __mk=function(ds, top, h){ return { dataset:ds, style:{}, up:null, parentNode:null, nextSibling:null,
      getBoundingClientRect:function(){ return { top:top, height:h||40 }; },
      closest:function(sel){ var m=/data-([a-z-]+)/.exec(sel); var k=m?m[1].replace(/-([a-z])/g,function(_,c){return c.toUpperCase();}):"";
        var x=this; while(x){ if(x.dataset&&x.dataset[k]!==undefined)return x; x=x.up; } return null; } }; };
    var __par={ children:[], insertBefore:function(){}, removeChild:function(){} };
    var __card=__mk({dropStage:"3"}, 0, 600);
    var __sib=__mk({posRow:"k0",posGrp:"3|"}, 20, 77); __sib.parentNode=__par; __sib.up=__card;
    var __row=__mk({posRow:"k1",posGrp:"3|"}, 100, 77); __row.parentNode=__par; __row.up=__card;
    __par.children=[__sib, __row];
    var __h=__mk({}, 100); __h.parentNode=__row; __h.setPointerCapture=function(){};
    var __head=__mk({dropStage:"3", dropRoom:"r1"}, 0, 34); __head.up=__card;
    var __below=__mk({}, 0); __below.up=__card;
    // Раскладка: шапка «Санузел» на 200 px, пока рамка «сюда» занимает место.
    // Рамку убрали из потока — всё ниже поднимается на её высоту, 77 px.
    document.elementFromPoint=function(x, y){
      var gone=!!(__slot&&__slot.style.display==="none");
      var top=gone?123:200;
      return (y>=top&&y<top+34)?__head:__below;
    };
    dragRow(__h, { preventDefault:function(){}, pointerId:1 }, "posRow", "posGrp",
      function(b){ __log.push("done:"+b); }, function(z){ __log.push("zone:"+z.dropStage+"|"+z.dropRoom); });
    __L.pointermove({ clientX:10, clientY:210 }); __log.push(__head.style.outline?"горит":"погасла");
    __L.pointermove({ clientX:10, clientY:212 }); __log.push(__head.style.outline?"горит":"погасла");
    __L.pointerup({});
    document.createElement=__mkEl;
  `)
  return JSON.stringify(p.q('__log'))
}
{
  t.section('Шапка помещения ниже строки')
  const p = panel()
  const a = gestureShift(p)
  t.ok('адрес под пальцем не мигает, строка уезжает в санузел', a === '["горит","горит","zone:3|r1"]', a)
}

t.done()
