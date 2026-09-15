#!/usr/bin/env node
// Своя камера внутри страницы (src/camera.js).
//
// В Telegram на Android кнопка «Снять фото» открывала галерею: встроенный браузер
// игнорирует `capture`. Сторожим, что перехват включается ровно там (WebView), а
// в обычном Chrome/iOS остаётся родная камера; что видео пишем только в mp4 (webm
// Telegram не примет); что снятый файл уходит в тот же инпут с событием change.
import { needsInPageCamera, captureKind, pickVideoMime, shotName, fmtClock, cameraErrorText,
  deliverFile, installInPageCamera, VIDEO_BITRATE, VIDEO_MAX_SEC } from '../src/camera.js'

let failed = 0
const ok = (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) }
const section = (n) => console.log(n)

const UA_TG_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A515F Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 Telegram-Android/11.1.3 (Samsung SM-A515F; Android 14; SDK 34; AVERAGE)'
const UA_WV = 'Mozilla/5.0 (Linux; Android 13; Redmi Note 11; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0 Mobile Safari/537.36'
const UA_CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'
const UA_IPHONE_TG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

section('Где снимаем сами')
ok('Telegram на Android — да', needsInPageCamera(UA_TG_ANDROID))
ok('любой WebView на Android — да', needsInPageCamera(UA_WV))
ok('Chrome на Android — нет, там родная камера работает', !needsInPageCamera(UA_CHROME_ANDROID))
ok('iPhone (и Telegram на нём) — нет', !needsInPageCamera(UA_IPHONE_TG))
ok('пустой user-agent — нет', !needsInPageCamera(undefined))

section('Что снимаем')
ok('image/* — фото', captureKind('image/*') === 'photo')
ok('video/* — видео', captureKind('video/*') === 'video')
ok('документы — не наш случай', captureKind('application/pdf') === '' && captureKind('') === '')

section('Формат видео')
ok('берём mp4, если умеет', pickVideoMime((m) => m === 'video/mp4') === 'video/mp4')
ok('предпочитаем H.264 со звуком', pickVideoMime(() => true).indexOf('avc1') > 0)
ok('умеет только webm — пусто (Telegram webm не примет)', pickVideoMime((m) => m.indexOf('webm') >= 0) === '')
ok('нет MediaRecorder — пусто', pickVideoMime(undefined) === '')
ok('isTypeSupported кидает — не падаем', pickVideoMime(() => { throw new Error('x') }) === '')
ok('3 минуты записи укладываются в лимит 50 МБ', VIDEO_BITRATE * VIDEO_MAX_SEC / 8 < 50 * 1024 * 1024)

section('Мелочи')
const d = new Date(2026, 8, 14, 17, 42, 36)
ok('имя фото как у камеры', shotName('photo', d) === 'IMG_20260914_174236.jpg', shotName('photo', d))
ok('имя видео — mp4', shotName('video', d) === 'VID_20260914_174236.mp4')
ok('часы записи', fmtClock(0) === '0:00' && fmtClock(65.7) === '1:05')
ok('отказ в доступе объясняем', /Разрешите камеру/.test(cameraErrorText({ name: 'NotAllowedError' })))

section('Файл уходит в тот же инпут')
{
  const events = []
  globalThis.DataTransfer = class { constructor () { const list = []; this.items = { add: (f) => list.push(f) }; this.files = list } }
  globalThis.Event ||= class { constructor (t) { this.type = t } }
  const input = { files: null, dispatchEvent: (e) => events.push(e.type) }
  const file = { name: 'IMG_1.jpg' }
  deliverFile(input, file)
  ok('files подменён', input.files && input.files[0] === file)
  ok('и обработчик позван через change', events.join() === 'change')
}

section('Перехват ставится только в WebView')
{
  const mkWin = (ua) => {
    const listeners = []
    return { listeners, navigator: { userAgent: ua }, document: { addEventListener: (t, fn, cap) => listeners.push([t, cap]) } }
  }
  const wv = mkWin(UA_TG_ANDROID), chrome = mkWin(UA_CHROME_ANDROID)
  ok('Telegram Android — поставлен на click в фазе захвата', installInPageCamera(wv) && wv.listeners.length === 1 && wv.listeners[0][0] === 'click' && wv.listeners[0][1] === true)
  ok('Chrome Android — не тронут', !installInPageCamera(chrome) && chrome.listeners.length === 0)
  ok('без окна (тестовый стенд) — не падает', installInPageCamera(undefined) === false)

  const handlers = []
  const win = { navigator: { userAgent: UA_TG_ANDROID }, document: { addEventListener: (t, fn) => handlers.push(fn), getElementById: () => null } }
  installInPageCamera(win)
  let prevented = false
  const plainLabel = { querySelector: () => null }
  handlers[0]({ target: { closest: () => plainLabel }, preventDefault: () => { prevented = true }, stopPropagation () {} })
  ok('обычная загрузка файла (без capture) идёт как раньше', !prevented)
}

if (failed) { console.log(`\n${failed} проверок упало`); process.exit(1) }
console.log('\nВсе проверки камеры прошли')
