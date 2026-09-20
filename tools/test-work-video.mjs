#!/usr/bin/env node
// Видео работы (public/admin.js).
//
// Раньше любой ролик ложился в obj.videos: бригадир снимал «Монтаж перегородок»,
// а видео числилось «по объекту», и найти, к какой работе оно относится, можно было
// только по подписи в Telegram. Сторожим, что кнопки съёмки несут sid/wid, ролик
// уходит в w.videos, а карточка объекта по-прежнему показывает ВСЕ ролики — и свои,
// и снятые по работам, — с именем работы в строке.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const VID = (id) => ({ id, topicId: 5, messageId: 77, name: 'Монтаж перегородок — VID_1.mp4', size: 2 * 1048576, date: '2026-09-20 18:12', uploader: 'Валера' })

function panel (net) {
  const p = boot(net ? { net } : {})
  p.set({
    users: [{ id: 'u1', name: 'Валера', roles: ['brigadier'], c: '#8e44ad', av: '👷', objs: ['o1'] }],
    roles: [{ id: 'brigadier', n: 'Бригадир' }],
    objects: [{
      id: 'o1', icon: '🛁', name: 'Баня Буханка', tgTopicId: 5, videos: [], stages: [
        { id: 's1', n: 'ЭТАП 1 — ПОДГОТОВИТЕЛЬНЫЙ', c: '#e67e22', works: [
          { id: 'w1', n: 'Монтаж перегородок', cost: 5000, done: false, mats: [], timeLogs: [] },
          { id: 'w2', n: 'Укладка лаг', cost: 3000, done: false, mats: [], timeLogs: [], videos: [VID('v1')] },
        ] },
      ],
    }],
    issues: [], templates: [], contractDocs: [], crmClients: [], purchases: [], purchased: {}, arrived: {},
    finTxns: [], receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {}, stock: [],
  })
  return p
}
const openWork = (p, wid) => {
  p.run(`tab="objects";openObject="o1";objWorkView="receive";openPhotoWid=${JSON.stringify(wid)};`)
  return p.run('tObjects()')
}
// Кусок разметки вокруг кнопки: иначе «есть data-wid» ловится где угодно на экране.
const around = (html, marker) => {
  const i = html.indexOf(marker)
  return i < 0 ? '' : html.slice(Math.max(0, i - 700), i + 200)
}

t.section('Кнопки съёмки знают свою работу')
{
  const m = openWork(panel(), 'w1')
  const cam = around(m, 'id="work-video-cam-w1"')
  t.ok('камера подписана работой', /data-wid="w1"/.test(cam) && /data-sid="s1"/.test(cam), cam.slice(-260))
  t.ok('и объектом', /data-oid="o1"/.test(cam))
  t.ok('это видеоинпут с камерой', /accept="video\/\*" capture="environment"/.test(cam))
  const file = around(m, 'id="work-video-file-w1"')
  t.ok('«из памяти» — та же работа', /data-wid="w1"/.test(file) && /data-sid="s1"/.test(file))
}

t.section('Снятое видно у самой работы')
{
  const m = openWork(panel(), 'w2')
  t.ok('ролик в блоке работы', m.indexOf('ВИДЕО ВЫПОЛНЕНИЯ · 1 шт') >= 0)
  t.ok('ссылка в тему объекта', m.indexOf('https://t.me/c/') >= 0 && m.indexOf('/5/77') >= 0)
  t.ok('удаление адресное', /data-a="obj-del-work-video"[^>]*data-wid="w2"[^>]*data-vid="v1"/.test(m))
  t.ok('чип работы считает видео', /data-a="obj-toggle-photo"[^>]*data-wid="w2"[\s\S]{0,400}?🎬 1/.test(m))
}

t.section('Карточка объекта показывает и ролики работ')
{
  const p = panel()
  p.run('objSecOpen={"o1|video":true};')   // раздел живёт под чипом — раскрываем
  const m = openWork(p, 'w1')
  const i = m.indexOf('ВИДЕО ОБЪЕКТА')
  const sec = m.slice(i, i + 3000)
  t.ok('раздел считает ролики работ', i >= 0 && sec.indexOf('нет</span>') < 0, sec.slice(0, 300))
  t.ok('видно, по какой работе снято', sec.indexOf('🔨 Укладка лаг') >= 0, sec.slice(0, 600))
  t.ok('удаление ведёт в работу', /data-a="obj-del-work-video"[^>]*data-wid="w2"/.test(sec))
}

t.section('Загрузка кладёт ролик в работу, а не в объект')
{
  const calls = []
  const net = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ success: true, topicId: 5, messageId: 99, fileId: 'f1' }) } }
  const p = panel(net)
  // Сжатие и разбор кадра — не наша тема (их сторожит test-tg-video), глушим.
  p.run('compressVideo=async function(f){return f;};videoMeta=async function(){return {w:1280,h:720,dur:7};};')
  p.run('currentUser=users[0];')
  await p.run('handleObjVideoFile({name:"VID_2.mp4",size:1048576,type:"video/mp4"},"o1","Монтаж перегородок",{sid:"s1",wid:"w1"})')
  const w1 = p.q('objects[0].stages[0].works[0].videos||[]')
  t.ok('ролик у работы', w1.length === 1 && w1[0].messageId === 99, JSON.stringify(w1))
  t.ok('имя работы в названии', (w1[0] || {}).name === 'Монтаж перегородок — VID_2.mp4')
  t.ok('объект не забрал его себе', p.q('(objects[0].videos||[]).length') === 0)
  t.ok('соседняя работа не тронута', p.q('(objects[0].stages[0].works[1].videos||[]).length') === 1)
  t.ok('ушло в тему объекта', calls.some((u) => u.indexOf('/api/video?') >= 0 && u.indexOf('topicId=5') >= 0))
  t.ok('флаг загрузки снят', p.q('videoUploading') === null)
}

t.section('Видео объекта целиком по-прежнему работает')
{
  const net = async () => ({ ok: true, status: 200, json: async () => ({ success: true, topicId: 5, messageId: 100, fileId: 'f2' }) })
  const p = panel(net)
  p.run('compressVideo=async function(f){return f;};videoMeta=async function(){return {w:1280,h:720,dur:7};};')
  p.run('currentUser=users[0];')
  await p.run('handleObjVideoFile({name:"VID_3.mp4",size:1048576,type:"video/mp4"},"o1","")')
  t.ok('без работы — в объект', p.q('(objects[0].videos||[]).length') === 1)
  t.ok('работы не тронуты', p.q('(objects[0].stages[0].works[0].videos||[]).length') === 0)
}

t.done()
