#!/usr/bin/env node
// Факты с сайта kubrdom.ru для нейропродавца — путь «через подписку Claude Code».
// В панели есть кнопка, где выжимку пишет Claude Sonnet по API (платно). Здесь то же
// самое делает сам Claude Code: скрипт достаёт текст страниц, Claude пишет выжимку
// по тем же правилам, скрипт кладёт её в settings.aiSiteKnowledge. Скилл —
// ~/.claude/skills/kubrdom-site-facts.
//
//   node tools/site-facts.mjs pages > /tmp/pages.txt   правила выжимки + текст всех страниц
//   node tools/site-facts.mjs current                  что сейчас сохранено в портале
//   node tools/site-facts.mjs save facts.md            сохранить выжимку (бэкап, охрана версии, двойная сверка)
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { SITE_ORIGIN, sitemapUrls, htmlToText, knowledgeMessages, MAX_KNOWLEDGE_CHARS } from '../src/site-knowledge.js'

const DB = 'banya-db'
const WHERE = "storage_key='admin_panel' AND work_id='settings'"

// Запрос записи: только одно поле (весь снимок settings с кириллицей упирается в лимит
// D1 на длину выражения), и только если с чтения никто не сохранял настройки.
export function saveSql(text, updatedAt, now) {
  if (!Number.isInteger(updatedAt) || updatedAt <= 0) throw new Error('нет версии строки settings')
  const q = (x) => "'" + String(x).replace(/'/g, "''") + "'"
  return 'UPDATE work_states SET data=json_set(data,' + q('$.aiSiteKnowledge') + ',' + q(text) + '), updated_at=' + now +
    ' WHERE ' + WHERE + ' AND updated_at=' + updatedAt + ';'
}

export function checkFacts(text) {
  const t = String(text || '').trim()
  if (t.length < 500) throw new Error('выжимка подозрительно короткая: ' + t.length + ' знаков')
  if (t.length > MAX_KNOWLEDGE_CHARS) throw new Error('выжимка длиннее ' + MAX_KNOWLEDGE_CHARS + ' знаков (' + t.length + ') — Worker обрежет хвост, сократите')
  return t
}

// wrangler с OAuth-входом: CLOUDFLARE_API_TOKEN из .zshrc протух и перебивает вход.
function d1(args) {
  const env = { ...process.env }; delete env.CLOUDFLARE_API_TOKEN
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 })
  // С --file wrangler печатает перед JSON строки прогресса («├ Checking…»).
  const start = out.search(/^[[{]/m)
  if (start < 0) throw new Error('wrangler без JSON: ' + out.slice(0, 200))
  const j = JSON.parse(out.slice(start))
  if (j && j.error) throw new Error('D1: ' + (j.error.text || JSON.stringify(j.error)))
  return j
}
function readSettings() {
  const r = d1(['--command', 'SELECT data, updated_at FROM work_states WHERE ' + WHERE])[0].results[0]
  if (!r) throw new Error('строки settings нет')
  return { data: JSON.parse(r.data), updatedAt: Number(r.updated_at), raw: r.data }
}

async function get(u) {
  const r = await fetch(u, { headers: { 'User-Agent': 'KubrDom-portal/1.0' }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(u + ' → ' + r.status)
  return r.text()
}

async function pages() {
  let urls = []
  try { urls = sitemapUrls(await get(SITE_ORIGIN + '/sitemap.xml')) } catch (e) { console.error('sitemap: ' + e.message) }
  if (!urls.length) urls = [SITE_ORIGIN + '/']
  const got = []
  for (const u of urls) {
    try { const text = htmlToText(await get(u)); if (text) got.push({ url: u, text }) } catch (e) { console.error('не открылась: ' + e.message) }
  }
  if (!got.length) throw new Error('сайт не открылся')
  const [sys, user] = knowledgeMessages(got)
  process.stdout.write('### ПРАВИЛА ВЫЖИМКИ (те же, что у кнопки в панели)\n' + sys.content + '\n\n### СТРАНИЦЫ\n' + user.content + '\n')
  console.error('страниц: ' + got.length + ', знаков: ' + got.reduce((n, p) => n + p.text.length, 0))
}

function current() {
  const s = readSettings()
  process.stdout.write((s.data.aiSiteKnowledge || '(пусто)') + '\n')
  console.error('сохранено знаков: ' + (s.data.aiSiteKnowledge || '').length + ', версия ' + s.updatedAt)
}

function save(file) {
  const text = checkFacts(fs.readFileSync(file, 'utf8'))
  const before = readSettings()
  const backup = file + '.settings-backup-' + before.updatedAt + '.json'
  fs.writeFileSync(backup, before.raw)
  const sqlFile = file + '.save.sql'
  fs.writeFileSync(sqlFile, saveSql(text, before.updatedAt, Date.now()))
  const res = d1(['--file', sqlFile])
  const written = res[0] && res[0].meta && res[0].meta.rows_written
  if (!written) throw new Error('запись не прошла (настройки изменились с момента чтения?) — запустите ещё раз')
  // Сверка дважды: одно чтение после записи однажды вернуло несогласованную копию.
  for (let i = 0; i < 2; i++) {
    const after = readSettings()
    const others = Object.keys(before.data).filter((k) => k !== 'aiSiteKnowledge').every((k) => JSON.stringify(before.data[k]) === JSON.stringify(after.data[k]))
    if (after.data.aiSiteKnowledge !== text || !others) throw new Error('сверка не сошлась (чтение ' + (i + 1) + '), бэкап: ' + backup)
  }
  console.log('✓ сохранено ' + text.length + ' знаков, остальные настройки не тронуты. Бэкап: ' + backup)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, arg] = process.argv.slice(2)
  try {
    if (cmd === 'pages') await pages()
    else if (cmd === 'current') current()
    else if (cmd === 'save' && arg) save(arg)
    else { console.error('usage: node tools/site-facts.mjs pages | current | save <facts.md>'); process.exit(2) }
  } catch (e) { console.error('✗ ' + (e.message || e)); process.exit(1) }
}
