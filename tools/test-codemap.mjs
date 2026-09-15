#!/usr/bin/env node
// Карта кода (tools/codemap.mjs).
//
// admin.js — 2,6 МБ и 30+ тысяч строк: читать его целиком ИИ-помощнику дорого, а
// grep по строкам в тысячи символов выдаёт простыни. Карта строится на лету из
// исходников: разделы-комментарии, функции, обработчики кнопок data-a, маршруты
// Worker'а, экспорты модулей src/. Сторожим разбор на синтетике и то, что на
// настоящем коде карта не опустела (иначе конвенции поменялись, а карта молчит).
import { parseSections, parseFunctions, parseActions, parseRoutes, parseExports, buildMap, search } from './codemap.mjs'

const t = reporterOf()
function reporterOf() {
  let failed = 0
  return {
    section: (n) => console.log(n),
    ok: (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) },
    done: () => { console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли'); process.exit(failed ? 1 : 0) },
  }
}

const SRC = [
  '// ─── СИНХРОНИЗАЦИЯ С WORKER ─────────',   // 1
  'function apiSave(){',                        // 2
  '}',                                          // 3
  '  // ── вложенный комментарий не раздел ──', // 4
  '// === РАЗРЕШЕНИЯ: вкладки ролей ===',        // 5
  'async function tSupplySelect(sel){',         // 6
  '  if(a==="supply-open"){}',                  // 7
  '  else if(a==="sup-a"||a=="sup-b"){}',       // 8
  '}',                                          // 9
].join('\n')

t.section('разделы')
{
  const s = parseSections(SRC)
  t.ok('находит только разделы с начала строки', s.length === 2, JSON.stringify(s))
  t.ok('заголовок без рамки из ─ и =', s[0].title === 'СИНХРОНИЗАЦИЯ С WORKER' && s[1].title === 'РАЗРЕШЕНИЯ: вкладки ролей', JSON.stringify(s))
  t.ok('раздел кончается перед следующим, последний — концом файла', s[0].line === 1 && s[0].end === 4 && s[1].line === 5 && s[1].end === 9, JSON.stringify(s))
}

t.section('функции и кнопки')
{
  const f = parseFunctions(SRC)
  t.ok('функции верхнего уровня, включая async', f.map((x) => x.name).join() === 'apiSave,tSupplySelect', JSON.stringify(f))
  t.ok('номер строки функции', f[1].line === 6)
  const a = parseActions(SRC)
  t.ok('все data-a в строке, и === и ==', a.map((x) => x.name).join() === 'supply-open,sup-a,sup-b', JSON.stringify(a))
  t.ok('номер строки обработчика', a[2].line === 8)
}

t.section('маршруты и экспорты')
{
  const w = [
    'const m = url.pathname.match(/^\\/api\\/file\\/(.+)$/);',
    'if (url.pathname === "/api/login" && request.method === "POST") {',
  ].join('\n')
  const r = parseRoutes(w)
  t.ok('маршрут-регэксп и маршрут-строка', r.length === 2 && r[1].name === 'POST /api/login' && r[1].line === 2, JSON.stringify(r))
  t.ok('регэксп маршрута читается как путь', r[0].name.includes('/api/file/'), JSON.stringify(r))
  const e = parseExports('export function a(){}\nexport const B = 1\nfunction hidden(){}\nexport async function c(){}')
  t.ok('экспорты: function, const, async', e.map((x) => x.name).join() === 'a,B,c', JSON.stringify(e))
}

t.section('поиск')
{
  const map = buildMap({ 'public/admin.js': SRC })
  const hits = search(map, 'supply')
  t.ok('находит и функцию, и кнопку без учёта регистра', hits.some((h) => h.kind === 'fn' && h.name === 'tSupplySelect') && hits.some((h) => h.kind === 'data-a' && h.name === 'supply-open'), JSON.stringify(hits))
  const fn = hits.find((h) => h.name === 'tSupplySelect')
  t.ok('у находки есть файл, строка и раздел', fn.file === 'public/admin.js' && fn.line === 6 && fn.section === 'РАЗРЕШЕНИЯ: вкладки ролей', JSON.stringify(fn))
  t.ok('несколько слов — все должны совпасть', search(map, 'sup b').map((h) => h.name).join() === 'sup-b', JSON.stringify(search(map, 'sup b')))
}

t.section('настоящий код портала')
{
  const map = buildMap()
  const admin = map.files['public/admin.js']
  t.ok('admin.js: разделов больше 50', admin && admin.sections.length > 50, admin && admin.sections.length)
  t.ok('admin.js: вкладка tSupplySelect найдена', admin && admin.functions.some((f) => f.name === 'tSupplySelect'))
  t.ok('admin.js: кнопок data-a больше 500', admin && admin.actions.length > 500, admin && admin.actions.length)
  t.ok('worker.js: маршрут POST /api/login', map.files['src/worker.js']?.routes.some((r) => r.name === 'POST /api/login'))
  t.ok('src/stages.js: экспорт stageSchedule', map.files['src/stages.js']?.exports.some((x) => x.name === 'stageSchedule'))
}

t.done()
