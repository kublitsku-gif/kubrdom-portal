#!/usr/bin/env node
// «В шаблоне изменилось» (public/admin.js): трёхстороннее сравнение объекта с шаблоном.
//
// Объект — копия шаблона, и отличаться он ОБЯЗАН: он живёт своей сметой. Поэтому диффом
// «объект против шаблона» тут не обойтись, нужен слепок на момент создания. Сторожим
// именно это: что портал отличает правку шаблона от правки объекта и не затирает стройку.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const mat = (id, n, cost, qty) => ({ id, pid: 'p_' + n, n, cost, qty, mode: 'piece' })
const tplWork = (estId, n, cost, mats) => ({ id: 'tw_' + estId, estId, n, cost, mats })

function panel() {
  const p = boot()
  p.set({
    templates: [{ id: 't1', name: 'Баня 6×4', icon: '🛁', stages: [
      { id: 'ts1', n: 'ЭТАП 1', works: [
        tplWork('e1', 'Пол', 20000, [mat('tm1', 'ОСП', 710, 20)]),
        tplWork('e2', 'Стены', 30000, [mat('tm2', 'ГВЛ', 900, 10)]),
      ] },
    ] }],
    objects: [], expProducts: [], estimates: [], contractDocs: [], issues: [], users: [],
    purchased: {}, arrived: {}, purchases: [], stock: [],
  })
  p.run('currentUser={id:"u1",name:"Админ",roles:["admin"],objs:[],c:"#000",av:"⚙️"};')
  // Объект из шаблона — тем же кодом, что и кнопка «создать объект».
  p.run(`objects=[{id:"o1",name:"Баня на Киевке",icon:"🛁",templateId:"t1",
    stages:reidStages(templates[0].stages),tplBase:tplBaseline(templates[0])}];`)
  return p
}

// ── 1. Свежий объект ничем не отличается ─────────────────────────────────────
{
  t.section('Сразу после создания')
  const p = panel()
  const d = p.q('(()=>{const d=objTplDiff(objects[0]);return {n:d.items.length,noBase:!!d.noBase};})()')
  t.ok('правок нет', d.n === 0 && !d.noBase, JSON.stringify(d))
  const html = p.run('buildTplDiffSection(objects[0])')
  t.ok('секция не показывается', html === '', 'баннер без новостей быстро становится фоном')
}

// ── 2. Правка шаблона видна, правка объекта — нет ────────────────────────────
{
  t.section('Кто именно менял')
  const p = panel()
  p.run('objects[0].stages[0].works[1].cost=31000;')          // правка ОБЪЕКТА
  t.ok('своя правка объекта диффом не считается', p.q('objTplDiff(objects[0]).items.length') === 0,
    'объект и должен отличаться — он живёт своей сметой')

  p.run('templates[0].stages[0].works[0].mats[0].qty=24;')    // правка ШАБЛОНА
  const items = p.q('objTplDiff(objects[0]).items.map(x=>({k:x.kind,key:x.key,safe:x.safe}))')
  t.ok('правка шаблона поймана', items.length === 1 && items[0].key === 'e1' && items[0].k === 'changed', JSON.stringify(items))
  t.ok('и она безопасная — в объекте эту работу не трогали', items[0].safe === true)

  p.run('templates[0].stages[0].works[1].cost=35000;')        // шаблон правит ТУ ЖЕ работу
  const items2 = p.q('objTplDiff(objects[0]).items.map(x=>({key:x.key,safe:x.safe}))')
  const e2 = items2.find((x) => x.key === 'e2')
  t.ok('правка с двух сторон помечена спорной', e2 && e2.safe === false, JSON.stringify(items2))
}

// ── 3. Добавление и удаление работы в шаблоне ────────────────────────────────
{
  t.section('Добавили и убрали работу')
  const p = panel()
  p.run(`templates[0].stages[0].works.push({id:"tw3",estId:"e3",n:"Потолок",cost:12000,mats:[]});`)
  p.run('templates[0].stages[0].works=templates[0].stages[0].works.filter(w=>w.estId!=="e2");')
  const items = p.q('objTplDiff(objects[0]).items.map(x=>({k:x.kind,key:x.key}))')
  t.ok('новая работа предложена к добавлению', items.some((x) => x.k === 'added' && x.key === 'e3'), JSON.stringify(items))
  t.ok('исчезнувшая — к удалению', items.some((x) => x.k === 'removed' && x.key === 'e2'), JSON.stringify(items))
}

// ── 4. Принятие правки не сносит стройку ─────────────────────────────────────
{
  t.section('Принятие правки')
  const p = panel()
  p.run(`objects[0].stages[0].works[0].timeLogs=[{id:"l1",userId:"u2",date:"2026-09-08",hours:8}];
         objects[0].stages[0].works[0].done=true;objects[0].stages[0].works[0].doneAt="2026-09-08 17:00";
         objects[0].stages[0].works[0].photos=["/api/file/x"];`)
  const wid = p.q('objects[0].stages[0].works[0].id')
  p.run('templates[0].stages[0].works[0].mats[0].qty=24;templates[0].stages[0].works[0].cost=24000;')
  p.run('(()=>{const d=objTplDiff(objects[0]);objTplApply(objects[0],d.items[0]);})();')

  const w = p.q('objects[0].stages[0].works[0]')
  t.ok('состав и цена приехали из шаблона', w.cost === 24000 && w.mats[0].qty === 24, JSON.stringify([w.cost, w.mats[0].qty]))
  t.ok('id работы сохранён', w.id === wid, 'на него завязаны часы, фото и отметки закупки')
  t.ok('часы не потеряны', (w.timeLogs || []).length === 1)
  t.ok('отметка «выполнено» на месте', w.done === true && !!w.doneAt)
  t.ok('фото на месте', (w.photos || []).length === 1, 'принятая правка не должна обнулять бригаде день работы')
  t.ok('материалы получили свои id', w.mats[0].id !== 'tm1', w.mats[0].id + ' — общий id «протёк» бы отметками закупки между объектами')
}

// ── 5. Добавление и удаление применяются ─────────────────────────────────────
{
  t.section('Применение добавления и удаления')
  const p = panel()
  p.run(`templates[0].stages[0].works.push({id:"tw3",estId:"e3",n:"Потолок",cost:12000,mats:[],done:true,timeLogs:[{id:"x",hours:5}]});`)
  p.run('(()=>{const d=objTplDiff(objects[0]);objTplApply(objects[0],d.items.find(x=>x.kind==="added"));})();')
  const added = p.q('objects[0].stages[0].works.find(w=>w.estId==="e3")')
  t.ok('работа добавлена в объект', !!added, JSON.stringify(p.q('objects[0].stages[0].works.map(w=>w.estId)')))
  t.ok('чужая стройка с ней не приехала', !added.done && !added.timeLogs,
    'в шаблоне могли остаться следы — в объекте работа начинается с нуля')

  p.run('templates[0].stages[0].works=templates[0].stages[0].works.filter(w=>w.estId!=="e1");')
  p.run('(()=>{const d=objTplDiff(objects[0]);objTplApply(objects[0],d.items.find(x=>x.kind==="removed"));})();')
  t.ok('удалённая в шаблоне убрана из объекта', !p.q('objects[0].stages[0].works.some(w=>w.estId==="e1")'))
}

// ── 6. «Ничего не принимать» гасит баннер ────────────────────────────────────
{
  t.section('Отметка «просмотрено»')
  const p = panel()
  p.run('templates[0].stages[0].works[0].cost=99000;')
  t.ok('правка видна', p.q('objTplDiff(objects[0]).items.length') === 1)
  p.run('objTplAccept(objects[0]);')
  t.ok('после отметки баннер пуст', p.q('objTplDiff(objects[0]).items.length') === 0,
    'иначе отклонённая правка всплывает в каждом рендере и её перестают читать')
  t.ok('в объекте при этом ничего не поменялось', p.q('objects[0].stages[0].works[0].cost') === 20000)
}

// ── 7. Старый объект без слепка ──────────────────────────────────────────────
{
  t.section('Объект без базы сравнения')
  const p = panel()
  p.run('delete objects[0].tplBase;')
  const d = p.q('objTplDiff(objects[0])')
  t.ok('честно сказано, что сравнивать не с чем', d.noBase === true)
  const head = p.run('buildTplDiffSection(objects[0])')
  t.ok('в шапке честно: связь не настроена', head.includes('не настроена') && head.includes('СВЯЗЬ С ШАБЛОНОМ'),
    'молчать нельзя — человек ждал бы уведомлений, которых механизм дать не может')
  p.run('objSecOpen["o1|tpldiff"]=true;')
  const open = p.run('buildTplDiffSection(objects[0])')
  t.ok('внутри — кнопка принять текущий шаблон за базу', open.includes('obj-tpl-accept'))
  p.run('objTplAccept(objects[0]);')
  t.ok('после этого сравнение работает', p.q('!objTplDiff(objects[0]).noBase') === true)
}

// ── 8. Кому видно ────────────────────────────────────────────────────────────
{
  t.section('Права')
  const p = panel()
  p.run('templates[0].stages[0].works[0].cost=99000;')
  p.run('currentUser={id:"u3",name:"Рабочий",roles:["worker"],objs:[],c:"#000",av:"👷"};')
  t.ok('рабочему секцию не показываем', p.run('buildTplDiffSection(objects[0])') === '',
    'принять правку шаблона в идущую стройку — решение по деньгам и объёму')
  p.run('currentUser={id:"u4",name:"Прораб",roles:["prod_head"],objs:[],c:"#000",av:"🛠"};')
  t.ok('производству — показываем', p.run('buildTplDiffSection(objects[0])').length > 0)
}

t.done()
