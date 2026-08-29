#!/usr/bin/env node
// Смоук-тест групповой правки материала в снабжении (public/admin.js).
//
//   node tools/test-supply-group.mjs
//
// Проверяет то, что руками в браузере проверяется долго и на боевых данных:
// объединённая строка закупки отдаёт все свои id, правка расходится по всем
// потребностям, замена товара снимает отметки закупки и НЕ стирает деньги партии.
//
// Почему vm, а не jsdom: admin.js исполняется целиком (см. tools/render-harness.js),
// а из DOM тесту нужны только поля формы и элементы с data-a — их дешевле подделать.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createBrowserContext } from './harness/browser-stubs.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'tools', '.cache', 'admin.test.cjs')

let failed = 0
function ok(name, cond, extra) {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}

// ── DOM ровно в объёме теста: поля формы по id и кнопки по data-a ────────────
function makeDoc(base) {
  const fields = new Map()
  const actions = []
  return {
    doc: {
      ...base,
      getElementById: (id) => fields.get(id) || null,
      querySelectorAll: (sel) => {
        const m = /^\[data-a(?:='([^']+)')?\]$/.exec(sel)
        if (!m) return []
        return m[1] ? actions.filter((e) => e.dataset.a === m[1]) : actions.slice()
      },
    },
    field: (id, value) => fields.set(id, { id, value: String(value), dataset: {}, style: {} }),
    action: (dataset) => { const el = { dataset, style: {}, onclick: null, onchange: null }; actions.push(el); return el },
  }
}

function boot() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  execFileSync('npx', ['esbuild', path.join(ROOT, 'public', 'admin.js'), '--target=es2017', '--bundle',
    '--format=cjs', '--outfile=' + OUT, '--allow-overwrite'], { stdio: ['ignore', 'ignore', 'inherit'] })
  const base = createBrowserContext()
  const dom = makeDoc(base.document)
  base.document = dom.doc
  base.confirm = () => true            // подтверждаем замену: тест проверяет ветку «да»
  const ctx = vm.createContext(base)
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx
  vm.runInContext(fs.readFileSync(OUT, 'utf8'), ctx, { filename: 'admin.js' })
  vm.runInContext('render=function(){};scheduleSave=function(){};', ctx)   // тесту нужен стейт, не HTML
  return { ctx, dom }
}

// Два объекта, один и тот же материал в трёх работах — ровно тот случай,
// ради которого правка стала групповой.
function seed(ctx) {
  const mat = (id, qty) => ({ id, n: 'ОСП 30 м²', cost: 710, qty, store: 'Белка', mode: 'piece', sheetM2: 3.12 })
  const state = {
    expProducts: [
      { id: 'p_osb', name: 'ОСП 30 м²', unitCost: 710, store: 'Белка', mode: 'piece', sheetM2: 3.12 },
      { id: 'p_gvl', name: 'ГВЛВ 10 мм', unitCost: 900, store: 'Лемана', mode: 'piece', url: 'https://lemana/gvl' },
    ],
    objects: [
      { id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [
        { id: 's1', n: 'ЭТАП 2', c: '#2980b9', works: [
          { id: 'w1', n: 'Обрешётка', cost: 710 * 25, mats: [mat('m1', 25)] },
          { id: 'w2', n: 'Потолок', cost: 710 * 15, mats: [mat('m2', 15)] },
        ] },
      ] },
      { id: 'o2', name: 'Дом на Дмитровке', icon: '🏠', stages: [
        { id: 's2', n: 'ЭТАП 2', c: '#2980b9', works: [
          { id: 'w3', n: 'Пол', cost: 710 * 10, mats: [mat('m3', 10)] },
        ] },
      ] },
    ],
    purchased: { m1: true },
    arrived: {},
    purchases: [{ id: 'b1', date: '2026-08-20', store: 'Белка', objId: 'o1', items: [
      { id: 'pi_m1', needId: 'm1', name: 'ОСП 30 м²', qty: 25, price: 710, gotQty: 0 },
    ] }],
    templates: [], contractDocs: [], users: [], finTxns: [],
  }
  Object.entries(state).forEach(([k, v]) => vm.runInContext(`${k}=${JSON.stringify(v)};`, ctx))
  vm.runInContext('currentUser={id:"t",name:"Тест",roles:["admin"],objs:[],c:"#000",av:"🧪"};_hydrated=true;', ctx)
}

// Значение из контекста панели: через JSON, иначе наружу приезжают vm-объекты
const q = (ctx, expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx) ?? 'null')
const findMat = (ctx, id) => q(ctx, `supplyFindMat(${JSON.stringify(id)})||null`)

// ── 1. Слитая строка отдаёт все свои id и кнопку правки ──────────────────────
{
  console.log('Объединённая строка закупки')
  const { ctx } = boot()
  seed(ctx)
  const html = vm.runInContext('tSupplyDetail({o1:true,o2:true},"merge")', ctx)
  ok('три потребности слиты в одну строку', html.includes('📦 3 позиций → 1'))
  ok('кнопка «изм.» есть и на слитой строке', html.includes('data-a="supply-edit-mat" data-mid="m1" data-ids="m1,m2,m3"'),
    'раньше кнопку показывали только при ids.length===1')
  ok('на кнопке видно, скольких позиций коснётся правка', html.includes('✏️ изм. (3)'))
}

// ── 2. Модалка групповой правки ──────────────────────────────────────────────
{
  console.log('Модалка групповой правки')
  const { ctx } = boot()
  seed(ctx)
  vm.runInContext('supplyEditIds=["m1","m2","m3"];supplyEditMid="m1";', ctx)
  const html = vm.runInContext('tSupplyDetail({o1:true,o2:true},"merge")', ctx)
  ok('заголовок называет число позиций', html.includes('✏️ Материал · 3 позиций'))
  ok('перечислены все работы, куда уедет правка', html.includes('Обрешётка') && html.includes('Потолок') && html.includes('Пол'))
  ok('у каждой потребности своё поле количества',
    ['m1', 'm2', 'm3'].every((id) => html.includes('id="sem-q-' + id + '"')))
  ok('сумма количеств показана вместо общего поля', html.includes('Σ 50') && !html.includes('id="sem-qty"'))
  ok('предупреждение об отмеченной закупке', html.includes('По 1 поз. уже отмечена закупка'))
}

// ── 3. Замена товара во всей группе ──────────────────────────────────────────
{
  console.log('Замена товара во всей группе')
  const { ctx, dom } = boot()
  seed(ctx)
  vm.runInContext('supplyEditIds=["m1","m2","m3"];supplyEditMid="m1";', ctx)
  dom.field('sem-n', 'ГВЛВ 10 мм')
  dom.field('sem-mode', 'piece')
  dom.field('sem-cost', '900')
  dom.field('sem-store', 'Лемана')
  dom.field('sem-note', 'замена по проекту')
  dom.field('sem-q-m1', '30')
  dom.field('sem-q-m2', '15')
  dom.field('sem-q-m3', '10')
  const btn = dom.action({ a: 'supply-mat-save' })
  vm.runInContext('bind();', ctx)
  if (typeof btn.onclick !== 'function') { console.log('  ✗ обработчик не привязался'); failed++ }
  else btn.onclick()

  const m1 = q(ctx, 'supplyFindMat("m1")'), m2 = q(ctx, 'supplyFindMat("m2")'), m3 = q(ctx, 'supplyFindMat("m3")')
  ok('товар сменился во всех трёх работах', [m1, m2, m3].every((m) => m && m.n === 'ГВЛВ 10 мм'),
    JSON.stringify([m1 && m1.n, m2 && m2.n, m3 && m3.n]))
  ok('цена и магазин разошлись по всем', [m1, m2, m3].every((m) => m.cost === 900 && m.store === 'Лемана'))
  ok('количество у каждой своё', m1.qty === 30 && m2.qty === 15 && m3.qty === 10,
    JSON.stringify([m1.qty, m2.qty, m3.qty]))
  ok('фасовка предшественника снята', [m1, m2, m3].every((m) => m.sheetM2 == null))
  ok('ссылка нового товара подтянулась', [m1, m2, m3].every((m) => m.url === 'https://lemana/gvl'))
  ok('стоимость работ пересчитана', q(ctx, 'objects[0].stages[0].works[0].cost') === 900 * 30
    && q(ctx, 'objects[1].stages[0].works[0].cost') === 900 * 10,
    String(q(ctx, 'objects[0].stages[0].works[0].cost')))

  ok('отметка «куплено» снята — это уже другой товар', !q(ctx, 'purchased').m1)
  const items = q(ctx, 'purchases')[0].items
  ok('позиция партии отвязана, а не удалена', items.length === 1 && items[0].needId === null)
  ok('деньги партии на месте', q(ctx, 'batchSum(purchases[0])') === 25 * 710)
  ok('статус потребности обнулился', q(ctx, 'matStatus(supplyFindMat("m1"))').bought === 0)
}

// ── 4. Правка без смены товара отметки не трогает ────────────────────────────
{
  console.log('Правка без смены товара')
  const { ctx, dom } = boot()
  seed(ctx)
  vm.runInContext('supplyEditIds=["m1","m2","m3"];supplyEditMid="m1";', ctx)
  dom.field('sem-n', 'ОСП 30 м²')       // имя то же
  dom.field('sem-mode', 'piece')
  dom.field('sem-cost', '750')          // подорожало
  dom.field('sem-store', 'Белка')
  dom.field('sem-note', '')
  dom.field('sem-q-m1', '25'); dom.field('sem-q-m2', '15'); dom.field('sem-q-m3', '10')
  const btn = dom.action({ a: 'supply-mat-save' })
  vm.runInContext('bind();', ctx)
  btn.onclick()
  ok('новая цена во всех трёх', ['m1', 'm2', 'm3'].every((id) => q(ctx, `supplyFindMat(${JSON.stringify(id)})`).cost === 750))
  ok('отметка «куплено» сохранилась', q(ctx, 'purchased').m1 === true, 'смена цены — не замена товара')
  ok('позиция партии осталась привязанной', q(ctx, 'purchases')[0].items[0].needId === 'm1')
  ok('фасовка своя не потерялась', q(ctx, 'supplyFindMat("m1")').sheetM2 === 3.12)
}

// ── 5. Групповое удаление ────────────────────────────────────────────────────
{
  console.log('Групповое удаление')
  const { ctx, dom } = boot()
  seed(ctx)
  const btn = dom.action({ a: 'supply-mat-del', mid: 'm1', ids: 'm1,m2,m3' })
  vm.runInContext('bind();', ctx)
  btn.onclick()
  ok('все три потребности удалены', ['m1', 'm2', 'm3'].every((id) => findMat(ctx, id) === null))
  ok('стоимость работ обнулилась', q(ctx, 'objects[0].stages[0].works[0].cost') === 0)
  ok('отметка закупки вычищена', !q(ctx, 'purchased').m1)
  ok('деньги партии остались', q(ctx, 'batchSum(purchases[0])') === 25 * 710)
}

// ── 6. Одиночная правка (кнопка в обычной строке) ────────────────────────────
{
  console.log('Одиночная правка')
  const { ctx, dom } = boot()
  seed(ctx)
  const open = dom.action({ a: 'supply-edit-mat', mid: 'm2' })   // data-ids нет — как в matRow
  vm.runInContext('bind();', ctx)
  open.onclick({ stopPropagation() {} })
  ok('групповой режим не включился', q(ctx, 'supplyEditIds').length === 0 && q(ctx, 'supplyEditMid') === 'm2')
  const html = vm.runInContext('tSupplyDetail({o1:true},"stage")', ctx)
  ok('поле количества одно', html.includes('id="sem-qty"') && !html.includes('id="sem-q-m2"'))

  dom.field('sem-n', 'ОСП 30 м²'); dom.field('sem-mode', 'piece'); dom.field('sem-cost', '710')
  dom.field('sem-store', 'Белка'); dom.field('sem-note', ''); dom.field('sem-qty', '18')
  const save = dom.action({ a: 'supply-mat-save' })
  vm.runInContext('bind();', ctx)
  save.onclick()
  ok('количество записалось только в свою позицию',
    q(ctx, 'supplyFindMat("m2")').qty === 18 && q(ctx, 'supplyFindMat("m1")').qty === 25)
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
