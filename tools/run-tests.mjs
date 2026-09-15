#!/usr/bin/env node
// Прогон смоук-наборов портала.
//
//   npm test                     все наборы, тихо: строка на набор + вывод только упавших
//   npm test -- supply           только наборы, в имени которых есть «supply» (быстрый цикл правки)
//   npm test -- --verbose        как раньше: весь вывод каждого набора
//
// Находит tools/test-*.mjs сам — новый набор подхватывается без правки package.json
// и CI. Каждый набор запускается отдельным процессом: они держат общий стейт панели
// в node:vm, и в одном процессе один набор видел бы данные другого.
//
// Тихий режим по умолчанию: наборы печатают почти три тысячи строк «✓», и прогон
// целиком съедал контекст ИИ-помощнику. Упавший набор печатается полностью —
// в логе CI по-прежнему видно, что именно упало.
//
// Выход: 0 — все прошли; 1 — хоть один упал или фильтр ничего не нашёл (этого ждёт деплой).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const MAX_SUITE_OUTPUT = 64 * 1024 * 1024
const args = process.argv.slice(2)
const isVerbose = args.includes('--verbose')
const filters = args.filter((a) => !a.startsWith('--')).map((a) => a.toLowerCase())

const files = fs.readdirSync(DIR)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .filter((f) => !filters.length || filters.some((q) => f.toLowerCase().includes(q)))
  .sort()

if (!files.length) {
  console.error(filters.length ? `✘ нет наборов tools/test-*.mjs под фильтр: ${filters.join(', ')}` : '✘ в tools/ нет ни одного набора test-*.mjs')
  process.exit(1)
}

function runSuite(file) {
  const started = Date.now()
  const r = isVerbose
    ? spawnSync(process.execPath, [path.join(DIR, file)], { stdio: 'inherit' })
    : spawnSync(process.execPath, [path.join(DIR, file)], { encoding: 'utf8', maxBuffer: MAX_SUITE_OUTPUT })
  const ok = r.status === 0
  if (!ok && !isVerbose) process.stdout.write((r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) + '\n' : ''))
  console.log(`${ok ? '✓' : '✘'} ${file} · ${((Date.now() - started) / 1000).toFixed(1)}с`)
  return ok
}

const t0 = Date.now()
const failed = files.filter((f) => !runSuite(f))
const secs = ((Date.now() - t0) / 1000).toFixed(1)
if (failed.length) {
  console.error(`\n✘ провалено наборов: ${failed.length} из ${files.length} — ${failed.join(', ')} · ${secs}с`)
  process.exit(1)
}
console.log(`\n✓ все наборы прошли: ${files.length} · ${secs}с`)
