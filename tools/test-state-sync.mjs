#!/usr/bin/env node
// Синхронизация панели с облаком (public/admin.js): что именно уходит на сервер.
//
// Раньше любая правка отправляла ВЕСЬ снимок — мегабайт на каждую цифру, и, что хуже,
// сторож base на сервере смотрит на присланные разделы, поэтому правка одного сотрудника
// отклоняла сохранение всем остальным. Здесь сторожим обратное: уходит только изменённое,
// а защиты от затирания облака при этом не ослабли.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

// Управляемый сервер: копит запросы и отвечает тем, что скажет тест.
function server({ reply = null } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), method: init.method || 'GET', body })
    const r = reply && reply(String(url), body)
    const out = r || { status: 200, json: { success: true, updated_at: Date.now() } }
    return { status: out.status, ok: out.status >= 200 && out.status < 300, headers: { get: () => null }, async json() { return out.json } }
  }
  return { fetch, calls, saves: () => calls.filter((c) => c.method === 'POST') }
}

// Сервер, у которого версия выросла и есть готовый снимок для баннера.
function server_({ version, items }) {
  return server({ reply: (url) => (/\/version$/.test(url)
    ? { status: 200, json: { success: true, version: version } }
    : /\/api\/state\/admin_panel$/.test(url)
      ? { status: 200, json: { success: true, items: items } }
      : null) })
}

function panel(net) {
  const p = boot({ net: net.fetch })
  p.set({
    objects: [{ id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [] }],
    templates: [], estimates: [], expProducts: [], contractDocs: [], issues: [],
    // id не из демо-сида (ft1, ft2 и т.п.): их страж справедливо считает признаком стейл-вкладки.
    finTxns: [{ id: 'tx_a', amount: 100 }], users: [{ id: 'u1', name: 'Тест', roles: ['admin'] }],
    purchased: {}, arrived: {}, purchases: [],
  })
  // Состояние «залогинен и уже сверился с сервером» — иначе сработает страж «не пиши
  // туда, чего не видел», и это правильно, но проверяем мы не его.
  p.run('setToken("v1.test.sig");')
  p.run('_hydrated=true;_serverVerified=true;_lastSeen=1000;')
  p.run('_lastSavedJson=JSON.stringify(serializeState());')
  p.run('updateServerCounts(serializeState());')
  return p
}

// ── 1. Уходит только изменившийся раздел ─────────────────────────────────────
{
  t.section('Сейв по разделам')
  const net = server()
  const p = panel(net)
  p.run('objects[0].name="Баня на Киевке-2";')
  await p.ctx.apiSave()
  const save = net.saves()[0]
  t.ok('запрос ушёл', !!save, JSON.stringify(net.calls.map((c) => c.method + ' ' + c.url)))
  t.ok('в теле ровно один раздел', save.body.items.length === 1, JSON.stringify(save.body.items.map((i) => i.work_id)))
  t.ok('и это именно объекты', save.body.items[0].work_id === 'objects')
  t.ok('base приложен — сторож на сервере работает', save.body.base === 1000, String(save.body.base))
  t.ok('финансы, которых не касались, не отправлены',
    !save.body.items.some((i) => i.work_id === 'finTxns'),
    'иначе правка снабженца продолжала бы конфликтовать с правкой финансиста')
}

// ── 2. Два раздела — два раздела ─────────────────────────────────────────────
{
  t.section('Несколько разделов')
  const net = server()
  const p = panel(net)
  p.run('objects[0].name="Другое имя";finTxns.push({id:"tx_b",amount:50});')
  await p.ctx.apiSave()
  const ids = net.saves()[0].body.items.map((i) => i.work_id).sort()
  t.ok('ушли оба и только они', ids.join(',') === 'finTxns,objects', ids.join(','))
}

// ── 3. Нечего слать — не шлём ────────────────────────────────────────────────
{
  t.section('Пустая правка')
  const net = server()
  const p = panel(net)
  const r = await p.ctx.apiSave()
  t.ok('без изменений запрос не уходит', net.saves().length === 0 && r.skipped === true, JSON.stringify(r))
}

// ── 4. Эталон стража двигается только по подтверждённым разделам ─────────────
{
  t.section('Страж после сейва по разделам')
  const net = server()
  const p = panel(net)
  // Представим, что финансы на сервере богаче, чем в этой вкладке (её данные устарели).
  p.run('_serverCounts.finTxns=5;')
  p.run('objects[0].name="Правка объектов";')
  await p.ctx.apiSave()
  t.ok('счёт по объектам обновлён', p.q('_serverCounts.objects') === 1)
  t.ok('счёт по финансам НЕ переписан локальным', p.q('_serverCounts.finTxns') === 5,
    'иначе сейв чужого раздела обезоруживал бы стража там, где вкладка устарела')
}

// ── 5. Страж по-прежнему держит подозрительный сейв ──────────────────────────
{
  t.section('Страж не ослаб')
  const net = server()
  const p = panel(net)
  p.run('_serverCounts.objects=4;_serverIds.objects=new Set(["o1","o2","o3","o4"]);')
  p.run('objects.length=0;')                         // вкладка «потеряла» объекты
  const r = await p.ctx.apiSave()
  t.ok('обнуление раздела заблокировано', r.success === false && !!r.blocked, JSON.stringify(r))
  t.ok('на сервер ничего не ушло', net.saves().length === 0)
}

// ── 6. «Сохранить как есть» шлёт всё ─────────────────────────────────────────
{
  t.section('Форс-сохранение')
  const net = server()
  const p = panel(net)
  p.run('objects[0].name="Форс";window._forceSaveOnce=true;')
  await p.ctx.apiSave()
  const body = net.saves()[0].body
  t.ok('уходит весь снимок', body.items.length > 5, String(body.items.length))
  t.ok('без base — кнопка обещает перезаписать облако', body.base === undefined, JSON.stringify(body.base))
}

// ── 7. Опрос спрашивает версию, а не снимок ──────────────────────────────────
{
  t.section('Опрос версии')
  const net = server({ reply: (url) => (/\/version$/.test(url) ? { status: 200, json: { success: true, version: 1000 } } : null) })
  const p = panel(net)
  p.run('document.hidden=false;')
  await p.ctx.pollOnce()
  const urls = net.calls.map((c) => c.url)
  t.ok('спросили версию', urls.some((u) => /\/api\/state\/admin_panel\/version$/.test(u)), urls.join(' '))
  t.ok('снимок не тянули — версия та же', !urls.some((u) => /\/api\/state\/admin_panel$/.test(u)), urls.join(' '))

  const net2 = server({ reply: (url) => (/\/version$/.test(url)
    ? { status: 200, json: { success: true, version: 9999 } }
    : { status: 200, json: { success: true, items: [{ work_id: 'objects', data: [{ id: 'o1' }], updated_at: 9999 }] } }) })
  const p2 = panel(net2)
  p2.run('document.hidden=false;')
  await p2.ctx.pollOnce()
  t.ok('версия выросла — тянем снимок', net2.calls.some((c) => /\/api\/state\/admin_panel$/.test(c.url)),
    net2.calls.map((c) => c.url).join(' '))
}

// ── 8. Принятая чужая правка не уезжает обратно ──────────────────────────────
{
  t.section('После применения чужой правки')
  const server = [{ work_id: 'objects', data: [{ id: 'o1', name: 'Переименовали в другой вкладке', stages: [] }], updated_at: 9999 }]
  const net = server_({ version: 9999, items: server })
  const p = panel(net)
  p.run('document.hidden=false;')
  await p.ctx.pollOnce()
  const apply = p.ctx.document.getElementById('live-apply')
  t.ok('баннер предложил обновиться', !!apply && typeof apply.onclick === 'function')
  apply.onclick()
  t.ok('данные применились', p.q('objects[0].name') === 'Переименовали в другой вкладке')

  net.calls.length = 0
  const r = await p.ctx.apiSave()
  t.ok('обратно на сервер ничего не ушло', net.saves().length === 0 && r.skipped === true,
    JSON.stringify(net.saves().map((c) => c.body.items.map((i) => i.work_id))) +
    ' — иначе вкладка переписывает только что принятое и отбивает 409 остальным')
}

t.done()
