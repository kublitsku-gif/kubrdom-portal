#!/usr/bin/env node
// План часов из сметы ↔ факт часов у мастера.
//
// Смысл шага: план хозяин ставит в смете по чертежу, факт бригада отмечает в
// объекте (timeLogs). Пока эти два числа живут порознь, никто не видит, попали
// в план или нет. Связь идёт по posKey — ключу позиции, который объект уже
// хранит у каждой работы с момента сборки. Второй учёт времени не заводим:
// факт остаётся там, где его ведут, смета просто умеет его прочитать.
import { presetModel, MODEL_PRESETS } from '../src/model.js'
import { positionWork } from '../src/recipe.js'
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

let seq = 0
const gid = () => 'id' + (++seq)

const PRODUCTS = [{ id: 'p_win', name: 'Монтажный комплект окна', unitCost: 1500, store: 'Белка', mode: 'piece' }]
const EST = [{ id: 'e_win', kind: 'house', name: 'Монтаж окна', stage: 2, optPoint: 'win', lines: [{ pid: 'p_win', qty: 1 }] }]
const built = presetModel(MODEL_PRESETS[0], [], gid)

// ── 1. План уезжает в объект вместе с работой ───────────────────────────────
{
  t.section('План едет в стройку')
  const w = positionWork({ key: 'k1', name: 'Монтаж окна', hours: 8, cost: 3000, mats: [] })
  t.ok('ключ позиции сохранён', w.posKey === 'k1', w.posKey)
  t.ok('план часов уехал с работой', w.planHours === 8, 'получили: ' + w.planHours)
  const w0 = positionWork({ key: 'k2', name: 'Без плана', cost: 100, mats: [] })
  t.ok('без плана — ноль, а не мусор', w0.planHours === 0, 'получили: ' + w0.planHours)
}

// ── 2. Факт читается из объекта по ключу позиции ────────────────────────────
{
  t.section('Факт находится по ключу позиции')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [], specSheets: [], specSheets2: [],
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: {}, buildRules: [],
  })
  // Объект со стройки: две смены на одной работе — 6 и 5 часов.
  p.run('objects=[{id:"o1",name:"Дом",specId:"s1",stages:[{id:"st1",n:"ЭТАП 2",works:[' +
    '{id:"w1",posKey:"kA",n:"Монтаж окна",planHours:8,timeLogs:[{id:"l1",userId:"u1",date:"2026-09-01",hours:6},{id:"l2",userId:"u1",date:"2026-09-02",hours:5}]},' +
    '{id:"w2",posKey:"kB",n:"Монтаж двери",planHours:2,timeLogs:[]}]}]}];')

  t.ok('часы одной работы сложены', p.q('objWorkFact(objects[0].stages[0].works[0])') === 11,
    'получили: ' + p.q('objWorkFact(objects[0].stages[0].works[0])'))
  t.ok('без отметок — ноль', p.q('objWorkFact(objects[0].stages[0].works[1])') === 0)

  const map = p.q('factHoursOf({id:"s1",objId:"o1"})')
  t.ok('факт разложен по ключам позиций', map.kA === 11 && map.kB === 0, JSON.stringify(map))
  // Лист без объекта — просто пустая карта, а не падение: смету смотрят и до стройки.
  t.ok('лист без объекта не ломается', JSON.stringify(p.q('factHoursOf({id:"s9"})')) === '{}')
  // Объект находится и по specId: связь ставится с обеих сторон, и лист может
  // не знать про objId, если объект собрали раньше.
  t.ok('объект находится и по specId', p.q('factHoursOf({id:"s1"}).kA') === 11)
}

// ── 3. Смета показывает план и факт рядом ───────────────────────────────────
{
  t.section('В смете видно и план, и факт')
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [], specSheets: [], specSheets2: [],
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: {}, buildRules: [],
  })
  p.run('spec2Tab="scheme";tSpec2();')
  const edit = p.dom.node({ a: 'spec2-edit' }); p.run('bind();'); edit.onclick()
  p.run('modelFull=false;stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};spec2Tab="est";tSpec2();')
  const key = p.q('works2(spec2Sheet(), specCtx(spec2Sheet())).positions[0].key')

  // Хозяин поставил план 8 ч, бригада отметила 11 ч на этой же работе.
  p.run('spec2Sheet().posHours={' + JSON.stringify(key) + ':8};')
  p.run('var sh=spec2Sheet(); sh.objId="o1"; objects=[{id:"o1",name:"Дом",specId:sh.id,stages:[{id:"st1",n:"ЭТАП",works:[' +
    '{id:"w1",posKey:' + JSON.stringify(key) + ',n:"Монтаж окна",planHours:8,timeLogs:[{id:"l1",userId:"u1",date:"2026-09-01",hours:11}]}]}]}];')

  const plain = p.run('tSpec2()').replace(/<[^>]*>/g, '').replace(/[  ]/g, ' ')
  t.ok('факт виден в строке работы', /факт 11 ч/.test(plain), 'нет факта в строке')
  t.ok('итог показывает оба числа', /план 8 ч · факт 11 ч/.test(plain), 'нет пары план/факт в итоге')
  // Перерасход надо ВИДЕТЬ, а не вычислять глазами: 11 против 8 — это разговор
  // с бригадиром, и он должен начинаться в смете, а не в конце стройки.
  t.ok('перерасход помечен', /\+3 ч/.test(plain), 'нет отметки перерасхода')
}

t.done()
