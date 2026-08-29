#!/usr/bin/env node
// Очередь фото для полевого режима (public/admin.js).
//
// Стейт объекта офлайн переживает всё (кэш + дожим), а фото до сих пор терялось: один
// fetch без сети — и отчёт о работе пропадал. Хранилище очереди подменяем целиком,
// поэтому проверяется логика, а не наличие IndexedDB в node.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

// Управляемый «сервер»: online=false рвёт любой запрос, как это делает мобильный интернет.
function net(state) {
  return async (url, init = {}) => {
    if (!state.online) throw new Error('Failed to fetch')
    state.calls.push(String(url))
    if (/\/api\/file/.test(String(url))) {
      return { status: 200, ok: true, headers: { get: () => null }, async json() { return { success: true, url: '/api/file/k' + state.calls.length } } }
    }
    return { status: 200, ok: true, headers: { get: () => null }, async json() { return { success: true, updated_at: Date.now() } } }
  }
}

function panel(state) {
  const p = boot({ net: net(state) })
  p.set({
    objects: [{ id: 'o1', name: 'Баня', icon: '🛁', stages: [{ id: 's1', n: 'ЭТАП 1', works: [
      { id: 'w1', n: 'Пол', cost: 0, mats: [], photos: [] },
    ] }] }],
    templates: [], contractDocs: [], issues: [], users: [], purchased: {}, arrived: {}, purchases: [], stock: [],
  })
  p.run('currentUser={id:"u1",name:"Валера",roles:["brigadier"],objs:[],c:"#000",av:"👷"};')
  p.run('setToken("v1.t.s");_hydrated=true;_serverVerified=true;')
  // Хранилище очереди — обычный массив в памяти.
  p.run(`window._q=[];_uploadStore={
    list:function(){return Promise.resolve(window._q.slice());},
    put:function(it){window._q.push(it);return Promise.resolve();},
    del:function(id){window._q=window._q.filter(function(x){return x.id!==id;});return Promise.resolve();}
  };`)
  return p
}

// ── 1. Без связи снимок не пропадает ─────────────────────────────────────────
{
  t.section('Съёмка без связи')
  const state = { online: false, calls: [] }
  const p = panel(state)
  const okAdd = await p.ctx.photoQueueAdd({ name: 'IMG_1.jpg', type: 'image/jpeg', size: 900000 },
    { kind: 'work-photo', oid: 'o1', sid: 's1', wid: 'w1' })
  t.ok('фото легло в очередь', okAdd === true && p.q('window._q.length') === 1)
  t.ok('счётчик показывает ожидание', p.q('_photoQueueN') === 1)
  t.ok('в объекте его пока нет', p.q('objects[0].stages[0].works[0].photos').length === 0,
    'битую ссылку в стейт класть нельзя — её потом не отличить от настоящей')

  const sent = await p.ctx.photoQueueFlush()
  t.ok('без сети досылка ничего не отправила', sent === 0)
  t.ok('и очередь не тронула', p.q('window._q.length') === 1, 'иначе снимок исчезнет молча')
}

// ── 2. Связь появилась — фото доехало и прикрепилось ─────────────────────────
{
  t.section('Связь появилась')
  const state = { online: false, calls: [] }
  const p = panel(state)
  await p.ctx.photoQueueAdd({ name: 'IMG_1.jpg', type: 'image/jpeg', size: 900000 },
    { kind: 'work-photo', oid: 'o1', sid: 's1', wid: 'w1' })
  state.online = true
  const sent = await p.ctx.photoQueueFlush()
  t.ok('отправлено одно', sent === 1, String(sent))
  t.ok('очередь пуста', p.q('window._q.length') === 0)
  const photos = p.q('objects[0].stages[0].works[0].photos')
  t.ok('фото прикреплено к своей работе', photos.length === 1 && /\/api\/file\//.test(photos[0].data), JSON.stringify(photos))
  t.ok('автор и время сохранены с момента съёмки', photos[0].uploader === 'Валера' && !!photos[0].date,
    JSON.stringify(photos[0]) + ' — снимали на объекте, а не когда доехало')
  t.ok('счётчик обнулился', p.q('_photoQueueN') === 0)
}

// ── 3. Порядок и остановка на первой ошибке ──────────────────────────────────
{
  t.section('Обрыв связи посреди отправки')
  const state = { online: true, calls: [] }
  const p = panel(state)
  for (const n of ['a', 'b', 'c']) {
    await p.ctx.photoQueueAdd({ name: n + '.jpg', type: 'image/jpeg', size: 1000 },
      { kind: 'work-photo', oid: 'o1', sid: 's1', wid: 'w1' })
  }
  // Сеть отваливается после первой отправки.
  p.ctx.fetch = async (url) => {
    if (state.calls.length >= 1) throw new Error('Failed to fetch')
    state.calls.push(String(url))
    return { status: 200, ok: true, headers: { get: () => null }, async json() { return { success: true, url: '/api/file/one' } } }
  }
  const sent = await p.ctx.photoQueueFlush()
  t.ok('успело уйти одно', sent === 1, String(sent))
  t.ok('остальные ждут', p.q('window._q.length') === 2,
    'перебирать очередь при мёртвой сети — только жечь батарею')
}

// ── 4. Работу удалили, пока фото ждало ───────────────────────────────────────
{
  t.section('Работы уже нет')
  const state = { online: true, calls: [] }
  const p = panel(state)
  await p.ctx.photoQueueAdd({ name: 'x.jpg', type: 'image/jpeg', size: 10 },
    { kind: 'work-photo', oid: 'o1', sid: 's1', wid: 'w_gone' })
  const sent = await p.ctx.photoQueueFlush()
  t.ok('очередь не зависает на потерянном адресате', p.q('window._q.length') === 0, 'иначе она копится вечно')
  t.ok('и не считается прикреплённой', sent === 0, String(sent))
}

// ── 5. Плашка в карточке объекта ─────────────────────────────────────────────
{
  t.section('Плашка ожидания')
  const state = { online: false, calls: [] }
  const p = panel(state)
  p.run('openObject="o1";')
  t.ok('без очереди плашки нет', !p.run('tObjects()').includes('фото ждут связи'))
  await p.ctx.photoQueueAdd({ name: 'x.jpg', type: 'image/jpeg', size: 10 },
    { kind: 'work-photo', oid: 'o1', sid: 's1', wid: 'w1' })
  const html = p.run('tObjects()')
  t.ok('с очередью — сказано, сколько ждёт', html.includes('1 фото ждут связи'))
  t.ok('и есть кнопка отправить вручную', html.includes('data-a="photo-queue-flush"'))
}

t.done()
