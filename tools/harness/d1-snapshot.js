// Чтение боевого снимка админки из D1.
//
// Панель хранит весь стейт в work_states одной строкой на ключ:
// storage_key='admin_panel', work_id=<имя чанка>, data=<JSON>. Чтение через
// wrangler работает на обычном OAuth-логине — отдельный API-токен нужен только
// для деплоя Worker'а, не для запросов к D1.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache')
const DB_NAME = 'banya-db'
const SNAPSHOT_KEY = 'admin_panel'

// Чанки, которых хватает рендеру вкладок «Объекты», «Снабжение», «Приёмка».
export const DEFAULT_CHUNKS = ['objects', 'contractDocs', 'users', 'purchased', 'arrived', 'templates']

// wrangler печатает баннер в stderr, а --json кладёт в stdout массив результатов.
function queryD1(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
  )
  const start = out.indexOf('[')
  if (start < 0) throw new Error('wrangler не вернул JSON — проверьте `npx wrangler whoami`')
  try {
    return JSON.parse(out.slice(start))
  } catch (e) {
    throw new Error('не разобрать ответ wrangler: ' + e.message, { cause: e })
  }
}

// Список доступных чанков — удобно, когда не помнишь точное имя.
export function listChunks() {
  const sql = `SELECT work_id FROM work_states WHERE storage_key='${SNAPSHOT_KEY}' ORDER BY work_id`
  return queryD1(sql)[0].results.map((r) => r.work_id)
}

function fetchChunk(name) {
  const sql = `SELECT data FROM work_states WHERE storage_key='${SNAPSHOT_KEY}' AND work_id='${name}'`
  const rows = queryD1(sql)[0].results
  if (!rows.length) throw new Error('в снимке нет чанка «' + name + '»')
  return rows[0].data
}

// Кеш на диске: тянуть 7 чанков из D1 на каждый прогон долго и незачем.
// refresh=true — перечитать из облака.
export function loadChunk(name, { refresh = false } = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const file = path.join(CACHE_DIR, name + '.json')
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  const raw = fetchChunk(name)
  const parsed = JSON.parse(raw)
  fs.writeFileSync(file, JSON.stringify(parsed))
  return parsed
}

export function loadSnapshot(chunks = DEFAULT_CHUNKS, opts = {}) {
  const state = {}
  chunks.forEach((name) => { state[name] = loadChunk(name, opts) })
  return state
}
