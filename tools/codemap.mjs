#!/usr/bin/env node
// Карта кода портала — навигация по admin.js (2,6 МБ) и src/ без чтения файлов целиком.
//
//   npm run -s codemap              обзор: разделы admin.js, вкладки t*, маршруты Worker'а, экспорты src/
//   npm run -s codemap -- supply    поиск по разделам, функциям, кнопкам data-a, маршрутам, экспортам
//
// Строится на лету, а не хранится файлом: номера строк сдвигаются с каждой правкой,
// сохранённая карта врала бы уже после следующего коммита.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN = 'public/admin.js'
const WORKER = 'src/worker.js'
const MAX_HITS = 80
const MAX_EXPORTS_SHOWN = 10

// Раздел — комментарий С НАЧАЛА строки с рамкой: «// ─── ТЕКСТ ───», «// === ТЕКСТ ===», «// ── ТЕКСТ ──».
const SECTION_RE = /^\/\/\s*(?:─{2,}|={3,})\s*(.+?)\s*[─=]*\s*$/
const FUNCTION_RE = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/
const ACTION_RE = /\ba\s*===?\s*"([^"]+)"/g
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/
const ROUTE_EQ_RE = /url\.pathname\s*===\s*"([^"]+)"(?:.*?request\.method\s*===\s*"([A-Z]+)")?/
const ROUTE_RE_RE = /url\.pathname\.match\(\/(.+?)\/[a-z]*\)/
const ROUTE_PREFIX_RE = /url\.pathname\.startsWith\("([^"]+)"\)/

const linesOf = (src) => src.split('\n')

function collect(src, re) {
  return linesOf(src).flatMap((text, i) => {
    const m = text.match(re)
    return m ? [{ name: m[1], line: i + 1 }] : []
  })
}

export function parseSections(src) {
  const lines = linesOf(src)
  const found = collect(src, SECTION_RE).map((s) => ({ title: s.name.replace(/[─=\s]+$/, ''), line: s.line }))
  return found.map((s, i) => ({ ...s, end: i + 1 < found.length ? found[i + 1].line - 1 : lines.length }))
}

export const parseFunctions = (src) => collect(src, FUNCTION_RE)
export const parseExports = (src) => collect(src, EXPORT_RE)

export function parseActions(src) {
  return linesOf(src).flatMap((text, i) => [...text.matchAll(ACTION_RE)].map((m) => ({ name: m[1], line: i + 1 })))
}

export function parseRoutes(src) {
  return linesOf(src).flatMap((text, i) => {
    const eq = text.match(ROUTE_EQ_RE)
    if (eq) return [{ name: (eq[2] ? eq[2] + ' ' : '') + eq[1], line: i + 1 }]
    const re = text.match(ROUTE_RE_RE)
    if (re) return [{ name: re[1].replace(/^\^|\$$/g, '').replace(/\\\//g, '/'), line: i + 1 }]
    const prefix = text.match(ROUTE_PREFIX_RE)
    return prefix ? [{ name: prefix[1] + '*', line: i + 1 }] : []
  })
}

function readSources() {
  const srcDir = path.join(ROOT, 'src')
  const modules = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort().map((f) => 'src/' + f)
  return Object.fromEntries([ADMIN, ...modules].map((rel) => [rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')]))
}

export function buildMap(sources = readSources()) {
  const files = Object.fromEntries(Object.entries(sources).map(([rel, src]) => [rel, {
    sections: parseSections(src),
    functions: parseFunctions(src),
    actions: rel === ADMIN ? parseActions(src) : [],
    routes: rel === WORKER ? parseRoutes(src) : [],
    exports: rel.startsWith('src/') ? parseExports(src) : [],
  }]))
  return { files }
}

const sectionAt = (sections, line) => sections.findLast((s) => s.line <= line)?.title || ''

export function search(map, query) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (name) => terms.every((term) => name.toLowerCase().includes(term))
  return Object.entries(map.files).flatMap(([file, f]) => [
    ...f.sections.map((s) => ({ kind: 'section', name: s.title, line: s.line, end: s.end })),
    ...f.functions.map((x) => ({ kind: 'fn', ...x })),
    ...f.actions.map((x) => ({ kind: 'data-a', ...x })),
    ...f.routes.map((x) => ({ kind: 'route', ...x })),
    ...f.exports.map((x) => ({ kind: 'export', ...x })),
  ].filter((h) => matches(h.name)).map((h) => ({ file, ...h, section: sectionAt(f.sections, h.line) })))
}

function formatOverview(map) {
  const admin = map.files[ADMIN]
  const fnCount = (s) => admin.functions.filter((x) => x.line >= s.line && x.line <= s.end).length
  const out = [`# ${ADMIN} — разделы (строки, функций)`]
  out.push(...admin.sections.map((s) => `${s.line}-${s.end}  ${s.title}  (${fnCount(s)})`))
  out.push('', '# вкладки t*')
  out.push(admin.functions.filter((x) => /^t[A-Z]/.test(x.name)).map((x) => `${x.name}:${x.line}`).join('  '))
  out.push('', `# ${WORKER} — маршруты`)
  out.push((map.files[WORKER]?.routes || []).map((r) => `${r.name}:${r.line}`).join('  '))
  out.push('', '# src/ — экспорты')
  for (const [file, f] of Object.entries(map.files)) {
    if (!f.exports.length) continue
    const shown = f.exports.slice(0, MAX_EXPORTS_SHOWN).map((x) => x.name).join(', ')
    const more = f.exports.length > MAX_EXPORTS_SHOWN ? ` …+${f.exports.length - MAX_EXPORTS_SHOWN}` : ''
    out.push(`${file}: ${shown}${more}`)
  }
  out.push('', 'Поиск: npm run -s codemap -- <слово>; читать потом Read с offset/limit по номеру строки.')
  return out.join('\n')
}

function formatHits(hits) {
  if (!hits.length) return 'ничего не найдено'
  const rows = hits.slice(0, MAX_HITS).map((h) => {
    const range = h.end ? `-${h.end}` : ''
    const where = h.section && h.kind !== 'section' ? `  [${h.section}]` : ''
    return `${h.file}:${h.line}${range}  ${h.kind.padEnd(7)} ${h.name}${where}`
  })
  if (hits.length > MAX_HITS) rows.push(`…ещё ${hits.length - MAX_HITS}, уточните запрос`)
  return rows.join('\n')
}

function main(args) {
  try {
    const map = buildMap()
    console.log(args.length ? formatHits(search(map, args.join(' '))) : formatOverview(map))
  } catch (err) {
    console.error('✘ карта кода не построилась: ' + err.message)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
