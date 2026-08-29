#!/usr/bin/env node
// Прогон всех смоук-наборов портала: npm test.
//
// Находит tools/test-*.mjs сам — новый набор подхватывается без правки package.json
// и CI. Каждый набор запускается отдельным процессом: они держат общий стейт панели
// в node:vm, и в одном процессе один набор видел бы данные другого.
//
// Выход: 0 — все прошли; 1 — хоть один упал (этого ждёт деплой в .github/workflows).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const files = fs.readdirSync(DIR).filter((f) => /^test-.*\.mjs$/.test(f)).sort()

if (!files.length) {
  console.error('✘ в tools/ нет ни одного набора test-*.mjs')
  process.exit(1)
}

const failed = []
const t0 = Date.now()
for (const f of files) {
  const started = Date.now()
  // stdio наследуем: вывод набора виден как есть, и в логе CI понятно, что именно упало.
  const r = spawnSync(process.execPath, [path.join(DIR, f)], { stdio: 'inherit' })
  const ms = Date.now() - started
  const ok = r.status === 0
  if (!ok) failed.push(f)
  console.log(`${ok ? '✓' : '✘'} ${f} · ${(ms / 1000).toFixed(1)}с\n`)
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
if (failed.length) {
  console.error(`✘ провалено наборов: ${failed.length} из ${files.length} — ${failed.join(', ')} · ${secs}с`)
  process.exit(1)
}
console.log(`✓ все наборы прошли: ${files.length} · ${secs}с`)
