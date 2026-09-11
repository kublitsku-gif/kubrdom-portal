#!/usr/bin/env node
// Панель, открытая из Telegram (public/admin.js): вход без PIN по подписи Telegram и
// переход в нужный раздел по кнопке напоминания. Подпись и выдачу токена сторожит
// test-tg-miniapp.mjs — здесь то, что делает сама страница.
import { boot } from './harness/panel-vm.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra !== undefined ? '\n      ' + JSON.stringify(extra) : ''))
}

// Сырая initData так, как её отдаёт Telegram. Подпись здесь не проверяем — это работа сервера.
const INIT = 'query_id=AAE1&user=%7B%22id%22%3A777%7D&auth_date=1790000000&hash=' + 'a'.repeat(64)
const TG_HASH = '#tgWebAppData=' + encodeURIComponent(INIT) + '&tgWebAppVersion=8.0&tgWebAppPlatform=ios'

// Подменённый сервер: запоминает запросы и отвечает заданным телом.
function server(status, body) {
  const calls = []
  const net = async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null })
    if (status === 0) throw new Error('offline')
    return { ok: status < 400, status, json: async () => body }
  }
  return { calls, net }
}

console.log('Данные Telegram из адреса')
{
  const p = boot({})
  p.run(`location.hash=${JSON.stringify(TG_HASH)}`)
  ok('initData достаётся из хеша без искажений', p.q('tgInitData()') === INIT, p.q('tgInitData()'))
  p.run('location.hash=""')
  ok('в обычном браузере initData нет', p.q('tgInitData()') === '')
  p.run('location.hash="#tab=supply"')
  ok('старая ссылка с хешем не принимается за Telegram', p.q('tgInitData()') === '')
}

console.log('Переход в раздел по кнопке напоминания')
{
  const p = boot({})
  p.set({ objects: [{ id: 'o1', name: 'Баня с хозблоком', stages: [] }] })
  p.run('var __urls=[];history.replaceState=function(a,b,u){__urls.push(u)};')
  p.run(`location.search="?go=obj%3Do1%26view%3Dreceive";location.hash=${JSON.stringify(TG_HASH)};tab="finance";openObject=null;applyDeepLink();`)
  ok('открыт нужный объект', p.q('openObject') === 'o1' && p.q('tab') === 'assign', [p.q('tab'), p.q('openObject')])
  ok('сразу в режиме «Приёмка»', p.q('objWorkView') === 'receive', p.q('objWorkView'))
  ok('go и подпись Telegram стёрты из адреса', p.q('__urls').slice(-1)[0] === '/admin', p.q('__urls'))

  p.run('location.search="?go=tab%3Dsupply";location.hash="";tab="finance";openObject=null;applyDeepLink();')
  ok('вкладка из go', p.q('tab') === 'supply', p.q('tab'))

  p.run('location.search="";location.hash="#tab=issues";tab="finance";applyDeepLink();')
  ok('старые ссылки с хешем работают как раньше', p.q('tab') === 'issues', p.q('tab'))
}

console.log('Вход по подписи Telegram')
{
  const s = server(200, { success: true, token: 'v1.tok.sig', user: { id: 'u1', name: 'Валера' } })
  const p = boot({ net: s.net })
  const res = await p.run(`tgLogin(${JSON.stringify(INIT)})`)
  ok('вход удался', res === true, res)
  ok('запрос ушёл на /api/tg-login', s.calls.length === 1 && /\/api\/tg-login$/.test(s.calls[0].url), s.calls)
  ok('initData отправлена как есть', s.calls[0] && s.calls[0].body && s.calls[0].body.initData === INIT, s.calls[0])
  ok('личный токен сохранён — дальше обычная загрузка сотрудника', p.storage.get('admin_token') === 'v1.tok.sig', [...p.storage.entries()])
}
{
  const s = server(403, { success: false, error: 'Этот Telegram не привязан к порталу. Войдите по PIN и нажмите 🔔 Напоминания → «Привязать Telegram».' })
  const p = boot({ net: s.net })
  const res = await p.run(`tgLogin(${JSON.stringify(INIT)})`)
  ok('без привязки вход не выполнен', res === false, res)
  ok('токен не сохранён', !p.storage.has('admin_token'))
  ok('на экране входа видно, что делать', /Привязать Telegram/.test(p.q('empPhoneError') || ''), p.q('empPhoneError'))
  ok('открыта форма входа сотрудника, где эту причину видно', p.q('loginMode') === 'employee', p.q('loginMode'))
}
{
  const s = server(0, null)
  const p = boot({ net: s.net })
  const res = await p.run(`tgLogin(${JSON.stringify(INIT)})`)
  ok('нет сети — вход не выполнен, а не зависание', res === false, res)
  ok('понятная ошибка про связь', /связ/i.test(p.q('empPhoneError') || ''), p.q('empPhoneError'))
  ok('и форма входа по PIN под рукой', p.q('loginMode') === 'employee', p.q('loginMode'))
}

console.log('\n' + (failed ? '❌ ПРОВАЛЕНО: ' + failed : '✅ Все проверки пройдены'))
process.exit(failed ? 1 : 0)
