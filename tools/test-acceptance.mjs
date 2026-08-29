#!/usr/bin/env node
// Приёмка этапа клиентом и график платежей.
//
// Две половины одной цепочки, и обе надо сторожить:
//   • панель — состояния транша и кто может просить приёмку;
//   • Worker — сам факт приёмки, потому что писать снимок клиенту нельзя, и отметку
//     ставит сервер, проверяя, что этап принадлежит ЕГО договору.
import { boot, reporter } from './harness/panel-vm.js'
import worker from '../src/worker.js'

const t = reporter()
const TOKEN = 'master-secret'

// ── Панель ───────────────────────────────────────────────────────────────────
function panel(extra = {}) {
  const p = boot()
  p.set(Object.assign({
    objects: [{ id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [
      { id: 's1', n: 'ЭТАП 1', works: [{ id: 'w1', n: 'Пол', cost: 0, mats: [], done: true, doneAt: '2026-09-05 10:00' }] },
      { id: 's2', n: 'ЭТАП 2', works: [{ id: 'w2', n: 'Стены', cost: 0, mats: [] }] },
    ] }],
    contractDocs: [{ id: 'c1', objId: 'o1', status: 'signed', client: 'Любовь', amount: 1000000, tranches: [
      { id: 'tr1', title: 'Аванс', amount: 300000, stageId: '' },
      { id: 'tr2', title: 'После этапа 1', amount: 400000, stageId: 's1' },
      { id: 'tr3', title: 'После этапа 2', amount: 300000, stageId: 's2' },
    ] }],
    users: [{ id: 'u1', name: 'Админ', roles: ['admin'] }], issues: [], finTxns: [],
  }, extra))
  p.run('currentUser={id:"u1",name:"Админ",roles:["admin"],objs:[],c:"#000",av:"⚙️"};')
  return p
}

{
  t.section('Состояния траншей')
  const p = panel()
  const state = (tid) => p.q(`trancheState(contractDocs[0].tranches.find(t=>t.id===${JSON.stringify(tid)}), objects[0])`)
  t.ok('транш без этапа ждёт', state('tr1') === 'wait')
  t.ok('этап закрыт, но приёмку не просили — тоже ждёт', state('tr2') === 'wait',
    'закрытая галочка бригадира ещё не приёмка клиентом')

  p.run('objects[0].stages[0].acceptance={askedAt:"2026-09-08 10:00",askedBy:"u1"};')
  t.ok('приёмка запрошена — «на приёмке»', state('tr2') === 'asked')

  p.run('objects[0].stages[0].acceptance.acceptedAt="2026-09-09 12:00";')
  t.ok('клиент принял — «к оплате»', state('tr2') === 'due')
  t.ok('соседний транш не тронут', state('tr3') === 'wait')

  p.run('contractDocs[0].tranches[1].paidAt="2026-09-10";')
  t.ok('оплаченный транш — «оплачен»', state('tr2') === 'paid')
  const due = p.q('tranchesDue().map(x=>x.tr.id)')
  t.ok('в «к оплате» оплаченный не попадает', due.length === 0, JSON.stringify(due))
}

{
  t.section('Кто и когда может просить приёмку')
  const p = panel()
  t.ok('этап со всеми закрытыми работами — можно', p.q('stageCanAskAccept(objects[0].stages[0])') === true)
  t.ok('этап с незакрытой работой — нельзя', p.q('stageCanAskAccept(objects[0].stages[1])') === false,
    '«принять недоделанное» — способ потерять право на переделку')
  p.run('objects[0].stages.push({id:"s3",n:"ЭТАП 3",works:[]});')
  t.ok('пустой этап предъявлять нечего', p.q('stageCanAskAccept(objects[0].stages[2])') === false)
  p.run('objects[0].stages[0].acceptance={askedAt:"2026-09-08 10:00"};')
  t.ok('повторно просить нельзя', p.q('stageCanAskAccept(objects[0].stages[0])') === false)
}

{
  t.section('Кабинет клиента показывает приёмку')
  const p = panel()
  p.run('objects[0].stages[0].acceptance={askedAt:"2026-09-08 10:00",askedBy:"u1"};')
  const html = p.run('clientProjectContent(contractDocs[0],"objects")')
  t.ok('этап предъявлен клиенту', html.includes('ЖДЁТ ВАШЕЙ ПРИЁМКИ') && html.includes('ЭТАП 1'))
  t.ok('названа сумма счёта, который последует', html.includes((400000).toLocaleString('ru-RU')),
    'клиент должен видеть последствие кнопки до нажатия')
  t.ok('кнопка ведёт в серверную ручку', html.includes('data-a="client-accept-stage"') && html.includes('data-sid="s1"'))

  p.run('objects[0].stages[0].acceptance.acceptedAt="2026-09-09 12:00";')
  const html2 = p.run('clientProjectContent(contractDocs[0],"objects")')
  t.ok('принятый этап уходит в список принятых', html2.includes('ПРИНЯТЫЕ ЭТАПЫ') && !html2.includes('ЖДЁТ ВАШЕЙ ПРИЁМКИ'))
}

// ── Worker ───────────────────────────────────────────────────────────────────
function makeDB(seed) {
  const rows = new Map()
  Object.entries(seed).forEach(([k, v]) => rows.set(k, { data: JSON.stringify(v), updated_at: 1000 }))
  const run = (sql, args) => {
    if (/CREATE (TABLE|INDEX)|INSERT INTO audit_log|login_guard/.test(sql)) return { results: [] }
    if (/SELECT data, updated_at FROM work_states/.test(sql)) {
      const r = rows.get(args[0])
      return { results: r ? [{ data: r.data, updated_at: r.updated_at }] : [] }
    }
    if (/UPDATE work_states SET data/.test(sql)) {
      const [data, at, workId, expect] = args
      const r = rows.get(workId)
      if (!r || r.updated_at !== expect) return { results: [], meta: { changes: 0 } }
      rows.set(workId, { data, updated_at: at })
      return { results: [], meta: { changes: 1 } }
    }
    if (/SELECT work_id, data FROM work_states/.test(sql)) {
      return { results: args.filter((k) => rows.has(k)).map((k) => ({ work_id: k, data: rows.get(k).data })) }
    }
    return { results: [] }
  }
  const prepare = (sql) => {
    const make = (args) => ({
      bind: (...a) => make(a),
      async all() { return run(sql, args) },
      async run() { return run(sql, args) },
      async first() { return (run(sql, args).results || [])[0] || null },
    })
    return make([])
  }
  return { db: { prepare, async batch(l) { return Promise.all(l.map((x) => x.run())) } }, rows }
}

const OBJECTS = [{ id: 'o1', name: 'Баня', stages: [
  { id: 's1', n: 'ЭТАП 1', works: [{ id: 'w1', done: true, doneAt: '2026-09-05 10:00' }], acceptance: { askedAt: '2026-09-08 10:00' } },
  { id: 's2', n: 'ЭТАП 2', works: [{ id: 'w2' }] },
] }]
const CONTRACTS = [
  { id: 'c1', objId: 'o1', status: 'signed', client: 'Любовь', tranches: [{ id: 'tr2', title: 'После этапа 1', amount: 400000, stageId: 's1' }] },
  { id: 'c9', objId: 'o9', status: 'signed', client: 'Чужой' },
]

// Токен клиента делаем настоящим — через сам worker, чтобы подпись сошлась.
async function clientToken(db, cid) {
  const r = await worker.fetch(new Request('https://p/api/client-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.1' },
    body: JSON.stringify({ query: cid === 'c1' ? 'любовь' : 'чужой', pin: '1111' }),
  }), { DB: db, ADMIN_TOKEN: TOKEN }, { waitUntil() {} })
  const j = await r.json()
  return j.token
}

{
  t.section('Приёмку пишет сервер')
  const { db, rows } = makeDB({ objects: OBJECTS, contractDocs: CONTRACTS, issues: [], crmClients: [{ id: 'x', phone: '+7 900 000-11-11' }] })
  // PIN клиента — последние 4 цифры телефона из CRM; привяжем его к обоим договорам.
  const cts = JSON.parse(rows.get('contractDocs').data)
  cts.forEach((c) => { c.clientPin = '1111' })
  rows.set('contractDocs', { data: JSON.stringify(cts), updated_at: 1000 })

  const tok = await clientToken(db, 'c1')
  t.ok('клиент вошёл', typeof tok === 'string' && tok.length > 20, String(tok))

  const call = async (token, body) => {
    const r = await worker.fetch(new Request('https://p/api/client/accept-stage', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify(body),
    }), { DB: db, ADMIN_TOKEN: TOKEN }, { waitUntil() {} })
    return { status: r.status, body: await r.json() }
  }

  const wrongObj = await call(tok, { objId: 'o9', stageId: 's1' })
  t.ok('чужой объект недоступен даже по прямому запросу', wrongObj.status === 404, JSON.stringify(wrongObj.body))

  const notAsked = await call(tok, { objId: 'o1', stageId: 's2' })
  t.ok('нельзя принять то, что не предъявляли', notAsked.status === 409 && /не запрошена/.test(notAsked.body.error), JSON.stringify(notAsked.body))

  const okRes = await call(tok, { objId: 'o1', stageId: 's1' })
  t.ok('предъявленный этап принимается', okRes.status === 200 && okRes.body.success === true, JSON.stringify(okRes.body))
  const objs = JSON.parse(rows.get('objects').data)
  t.ok('отметка легла в этап', !!objs[0].stages[0].acceptance.acceptedAt)
  t.ok('версия строки сдвинулась', rows.get('objects').updated_at !== 1000)

  const issues = JSON.parse(rows.get('issues').data)
  t.ok('заведён вопрос финансисту', issues.length === 1 && issues[0].to === 'financier' && issues[0].kind === 'money',
    JSON.stringify(issues))
  t.ok('в вопросе сумма транша', issues[0].amount === 400000 && /выставить счёт/.test(issues[0].text), JSON.stringify(issues[0]))

  const again = await call(tok, { objId: 'o1', stageId: 's1' })
  t.ok('повторная приёмка отклоняется', again.status === 409 && /уже принят/.test(again.body.error), JSON.stringify(again.body))
  t.ok('второго вопроса не завелось', JSON.parse(rows.get('issues').data).length === 1)

  const noAuth = await worker.fetch(new Request('https://p/api/client/accept-stage', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN }, body: JSON.stringify({ objId: 'o1', stageId: 's1' }),
  }), { DB: db, ADMIN_TOKEN: TOKEN }, { waitUntil() {} })
  t.ok('сотруднику эта ручка недоступна', noAuth.status === 403,
    String(noAuth.status) + ' — принять за клиента нельзя даже мастер-токеном')
}

t.done()
