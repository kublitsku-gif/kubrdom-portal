#!/usr/bin/env node
// Рендер вкладок админ-панели вне браузера — чтобы проверять правки вёрстки
// public/admin.js на боевых данных, без пароля от админки и без деплоя.
//
//   npm run harness -- "tObjects()"
//   npm run harness -- --state 'objArchOpen=true' "tObjects()"
//   npm run harness -- --role brigadier "tReceive({})"
//   npm run harness -- --refresh --raw "tSupplySelect({})" > /tmp/out.html
//   npm run harness -- --list
//
// Почему так, а не «выдрать нужную функцию регуляркой»: в admin.js есть
// replace(/"/g,"&quot;") — кавычка внутри регулярки, на ней разъезжается любой
// наивный сканер строк; плюс const/let из разных eval друг друга не видят.
// Дешевле выполнить файл целиком в vm с заглушками браузера.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createBrowserContext } from './harness/browser-stubs.js'
import { loadSnapshot, listChunks, DEFAULT_CHUNKS } from './harness/d1-snapshot.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_JS = path.join(ROOT, 'public', 'admin.js')

function parseArgs(argv) {
  const opts = { state: [], chunks: DEFAULT_CHUNKS, role: 'admin', raw: false, refresh: false, list: false }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--state') opts.state.push(argv[++i])
    else if (a === '--role') opts.role = argv[++i]
    else if (a === '--chunks') opts.chunks = argv[++i].split(',')
    else if (a === '--raw') opts.raw = true
    else if (a === '--refresh') opts.refresh = true
    else if (a === '--list') opts.list = true
    else if (a === '--help' || a === '-h') opts.help = true
    else rest.push(a)
  }
  opts.expr = rest.join(' ')
  return opts
}

const HELP = `
Рендер админ-панели вне браузера.

  npm run harness -- [опции] "<выражение>"

Выражение — любой JS в контексте admin.js, обычно вызов рендер-функции:
  tObjects()            вкладка «Объекты»
  tSupplySelect({})     «Снабжение» — список выбора объектов
  tSupplyDetail({<oid>:true},"stage")   «Снабжение» — материалы
  tReceive({})          «Приёмка на склад»
  tContracts()          «Договора»

Опции:
  --state "<js>"   выполнить перед рендером (можно несколько раз),
                   например --state 'objArchOpen=true'
  --role <роль>    роль currentUser: admin (по умолч.), brigadier, worker,
                   prod_head, supply, financier
  --chunks a,b,c   какие чанки снимка подгрузить (по умолч.: ${DEFAULT_CHUNKS.join(',')})
  --refresh        перечитать данные из D1, а не брать кеш tools/.cache
  --raw            печатать HTML как есть (по умолч. — текст без тегов)
  --list           показать доступные чанки снимка и выйти
`.trim()

function run() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) return console.log(HELP)
  if (opts.list) return console.log(listChunks().join('\n'))
  if (!opts.expr) return console.log(HELP)

  const ctx = createBrowserContext()
  // admin.js теперь импортирует общие модули из src/ — vm такого не исполнит, поэтому
  // сначала собираем ровно тем же способом, что и прод (esbuild --bundle), и гоняем сборку.
  const bundled = path.join(ROOT, 'tools', '.cache', 'admin.bundle.js')
  fs.mkdirSync(path.dirname(bundled), { recursive: true })
  execFileSync('npx', ['esbuild', ADMIN_JS, '--target=es2017', '--bundle', '--format=cjs',   // cjs не оборачивает в IIFE — функции панели остаются видимыми для vm
    '--outfile=' + bundled, '--allow-overwrite'], { stdio: ['ignore', 'ignore', 'inherit'] })
  vm.runInContext(fs.readFileSync(bundled, 'utf8'), ctx, { filename: 'admin.js' })

  // Боевой снимок поверх дефолтного стейта панели. Присваиваем через
  // runInContext, иначе не достучаться до let-переменных модуля.
  const snapshot = loadSnapshot(opts.chunks, { refresh: opts.refresh })
  // Имя чанка ≠ имя переменной для справочников смет: в снимке estStages/estKinds/estRooms,
  // а в admin.js это EST_STAGES/EST_KINDS/EST_ROOMS. Без маппинга такой чанк молча уезжал
  // в новую глобальную, а рендер работал на сидовых значениях — проверка врала.
  const VAR_BY_CHUNK = { estStages: 'EST_STAGES', estKinds: 'EST_KINDS', estRooms: 'EST_ROOMS' }
  const assign = Object.entries(snapshot)
    .map(([k, v]) => `${VAR_BY_CHUNK[k] || k}=${JSON.stringify(v)};`)
    .join('')
  vm.runInContext(assign, ctx)
  vm.runInContext(`currentUser={id:"harness",name:"Харнесс",roles:${JSON.stringify([opts.role])},objs:[],c:"#2980b9",av:"🧪"};`, ctx)
  opts.state.forEach((s) => vm.runInContext(s, ctx))

  const html = vm.runInContext(opts.expr, ctx)
  if (typeof html !== 'string') return console.log(html)
  if (opts.raw) return console.log(html)
  // Текстовый режим: разметку долой, пустые строки схлопнуть — так виден
  // порядок карточек и заголовков, ради которого харнесс обычно и зовут.
  console.log(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
      .replace(/<[^>]*>/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n'),
  )
}

try {
  run()
} catch (e) {
  console.error('✘ ' + e.message)
  process.exit(1)
}
