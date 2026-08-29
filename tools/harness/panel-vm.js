// Запуск public/admin.js в node:vm для тестов панели.
//
// Отличие от render-harness.js: там боевой снимок из D1 и печать HTML, здесь —
// синтетический стейт и обращение к функциям панели, чтобы проверять ЛОГИКУ
// (замена материала, ссылки на каталог) без браузера и без данных заказчика.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createBrowserContext } from './browser-stubs.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(ROOT, 'tools', '.cache', 'admin.test.cjs')

// Бандл собираем один раз на процесс: esbuild быстрый, но десяток вызовов подряд
// заметен, а исходник за время прогона не меняется.
let bundle = null
function bundled() {
  if (bundle) return bundle
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  execFileSync('npx', ['esbuild', path.join(ROOT, 'public', 'admin.js'), '--target=es2017', '--bundle',
    '--format=cjs', '--outfile=' + OUT, '--allow-overwrite'], { stdio: ['ignore', 'ignore', 'inherit'] })
  bundle = fs.readFileSync(OUT, 'utf8')
  return bundle
}

// DOM ровно в объёме тестов: поля формы по id и элементы с data-a / data-*.
function makeDoc(base) {
  const fields = new Map()
  const nodes = []
  const match = (sel, el) => {
    const m = /^\[([a-z-]+)(?:='([^']*)')?\]$/.exec(sel)
    if (!m) return false
    const key = m[1].replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    return m[2] === undefined ? el.dataset[key] !== undefined : el.dataset[key] === m[2]
  }
  const doc = {
    ...base,
    getElementById: (id) => fields.get(id) || null,
    querySelectorAll: (sel) => nodes.filter((el) => match(sel, el)),
    querySelector: (sel) => nodes.find((el) => match(sel, el)) || null,
  }
  return {
    doc,
    field: (id, value) => fields.set(id, { id, value: String(value), dataset: {}, style: {} }),
    node: (dataset, id) => {
      const el = { id, dataset, style: {}, onclick: null, onchange: null, oninput: null,
        querySelectorAll: (sel) => nodes.filter((x) => match(sel, x)) }
      nodes.push(el)
      if (id) fields.set(id, el)
      return el
    },
  }
}

// Готовый контекст панели. render/scheduleSave глушим: тестам нужен стейт, не HTML,
// а рендер целиком потянул бы за собой весь DOM.
export function boot({ confirm = true } = {}) {
  const base = createBrowserContext()
  const dom = makeDoc(base.document)
  base.document = dom.doc
  base.confirm = () => confirm
  base.alert = () => {}
  const ctx = vm.createContext(base)
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx
  vm.runInContext(bundled(), ctx, { filename: 'admin.js' })
  vm.runInContext('render=function(){};scheduleSave=function(){};renderExpCard=function(){};', ctx)
  const q = (expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx) ?? 'null')
  return {
    ctx, dom, q,
    run: (code) => vm.runInContext(code, ctx),
    set: (state) => {
      Object.entries(state).forEach(([k, v]) => vm.runInContext(`${k}=${JSON.stringify(v)};`, ctx))
      vm.runInContext('currentUser={id:"t",name:"Тест",roles:["admin"],objs:[],c:"#000",av:"🧪"};_hydrated=true;', ctx)
    },
    mat: (id) => q(`supplyFindMat(${JSON.stringify(id)})||null`),
  }
}

// Мини-ассерты: тестов немного, а зависимость ради них тянуть незачем.
export function reporter() {
  let failed = 0
  return {
    section: (name) => console.log(name),
    ok: (name, cond, extra) => {
      if (cond) return console.log('  ✓ ' + name)
      failed++
      console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
    },
    done: () => {
      console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
      process.exit(failed ? 1 : 0)
    },
  }
}
