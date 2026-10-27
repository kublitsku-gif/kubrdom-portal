#!/usr/bin/env node
// Голос в песочнице нейропродавца (public/admin.js, mktMicToggle).
//
// Кнопка 🎤 включает диктовку браузера (Web Speech API): сказанное дописывается в
// поле ввода к уже набранному, но не отправляется само — человек правит и жмёт ➤.
// Без поддержки в браузере — понятная подсказка, а не молчание.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const p = boot({})
p.set({ settings: {}, crmClients: [], objects: [], templates: [], users: [] })
const alerts = []
p.ctx.alert = (m) => alerts.push(String(m))

// Поддельная диктовка: тест сам «произносит» фразы через onresult.
let last = null
class FakeSR {
  constructor() { last = this; this.started = false; this.stopped = false }
  start() { this.started = true }
  stop() { this.stopped = true; this.onend && this.onend() }
}
const result = (parts) => {
  const results = parts.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal }))
  last.onresult({ results })
}

{
  t.section('Кнопка 🎤 в песочнице')
  const html = p.run('mktTest=[];mktTestBusy=false;tMarketingMain()')
  t.ok('рядом с ➤ есть кнопка микрофона', html.indexOf('data-a="mkt-test-mic"') >= 0 && html.indexOf('data-a="mkt-test-send"') > html.indexOf('data-a="mkt-test-mic"'))
}

{
  t.section('Диктовка дописывает в поле и не отправляет')
  p.ctx.webkitSpeechRecognition = FakeSR
  p.dom.field('mkt-test-text', 'Здравствуйте!   ')
  p.run('document.getElementById("mkt-test-text").focus=function(){}')  // у заглушки поля нет focus
  const mic = p.dom.node({ a: 'mkt-test-mic' }); p.run('bind();'); mic.onclick()
  t.ok('распознавание запущено по-русски', !!last && last.started && last.lang === 'ru-RU' && last.continuous === true)
  t.ok('кнопка стала «стоп»', mic.textContent === '⏹', mic.textContent)
  result([['Сколько стоит ', true], ['баня', false]])
  t.ok('промежуточный текст виден в поле', p.q('document.getElementById("mkt-test-text").value') === 'Здравствуйте! Сколько стоит баня')
  result([['Сколько стоит баня шесть метров', true]])
  t.ok('итоговый текст заменил промежуточный', p.q('document.getElementById("mkt-test-text").value') === 'Здравствуйте! Сколько стоит баня шесть метров')
  t.ok('в песочницу ничего не ушло', p.q('mktTest.length') === 0)
  mic.onclick()
  t.ok('повторное нажатие останавливает запись', last.stopped && p.q('mktMic') === null && mic.textContent === '🎤')
}

{
  t.section('Отказ в микрофоне и браузер без диктовки')
  mic2()
  function mic2() {
    const mic = p.dom.node({ a: 'mkt-test-mic' }); p.run('bind();'); mic.onclick()
    last.onerror({ error: 'not-allowed' }); last.onend()
    t.ok('про запрет микрофона сказано словами', alerts.some((a) => a.indexOf('микрофон') >= 0), alerts.join(' | '))
  }
  delete p.ctx.webkitSpeechRecognition
  alerts.length = 0
  const mic = p.dom.node({ a: 'mkt-test-mic' }); p.run('bind();'); mic.onclick()
  t.ok('без Web Speech — подсказка про Chrome/Safari', alerts.some((a) => a.indexOf('Chrome или Safari') >= 0), alerts.join(' | '))
}

t.done()
