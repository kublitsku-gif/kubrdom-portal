#!/usr/bin/env node
// Просмотр фото и видео работы (public/admin.js).
//
// «Вижу, что есть фото» и «могу их посмотреть» жили на разных экранах: значок на Ганте
// только уводил в карточку объекта. Теперь тап по 📷/🎬 открывает галерею поверх любой
// вкладки. Сторожим список (фото, потом видео), листание по кругу, живую ссылку на
// прокси Telegram для видео и то, что просмотрщик держит АДРЕС работы, а не копию файлов.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

function panel () {
  const p = boot({})
  p.set({
    users: [{ id: 'u1', name: 'Юрий', roles: ['admin'], c: '#34495e', av: '🧑‍💼', objs: ['o1'] }],
    roles: [{ id: 'admin', n: 'Админ' }],
    objects: [{ id: 'o1', icon: '🛁', name: 'Баня Буханка', tgTopicId: 5, stages: [
      { id: 's1', n: 'ЭТАП 1', c: '#e67e22', works: [
        { id: 'w1', n: 'Монтаж перегородок', cost: 10000, mats: [], timeLogs: [{ id: 'l1', userId: 'u1', date: '2026-09-19', hours: 7, pct: 40 }],
          photos: [
            { id: 'p1', data: '/api/file/a.jpg', uploader: 'Валера', date: '2026-09-19 12:00', size: 900000 },
            { id: 'p2', data: '/api/file/b.jpg', uploader: 'Валера', date: '2026-09-19 12:05' }],
          videos: [{ id: 'v1', fileId: 'AgACfile', topicId: 5, messageId: 77, name: 'VID.mp4', uploader: 'Валера', date: '2026-09-19 18:00', size: 4300000 }] },
        { id: 'w2', n: 'Укладка лаг', cost: 8000, mats: [], timeLogs: [] },
      ] },
    ] }],
    issues: [], templates: [], contractDocs: [], crmClients: [], purchases: [], purchased: {}, arrived: {},
    finTxns: [], receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {}, stock: [],
  })
  p.run('currentUser=users[0];')
  return p
}
const view = (p) => p.run('mediaViewModal()')

t.section('Список работы: сначала фото, потом видео')
{
  const p = panel()
  t.ok('фото и видео в одном списке', p.q('workMedia("o1","s1","w1").items.length') === 3)
  t.ok('порядок: фото → видео', p.q('workMedia("o1","s1","w1").items.map(function(x){return x.kind;})').join() === 'photo,photo,video')
  t.ok('у работы без медиа список пуст', p.q('workMedia("o1","s1","w2").items.length') === 0)
  t.ok('несуществующая работа не роняет', p.q('workMedia("o1","s1","нет").items.length') === 0)
}

t.section('Открытие')
{
  const p = panel()
  p.run('mediaOpen("o1","s1","w1",0);')
  t.ok('открылось на первом фото', p.q('mediaView.i') === 0)
  t.ok('в кадре картинка', view(p).indexOf('/api/file/a.jpg') >= 0)
  p.run('mediaOpen("o1","s1","w1",2);')
  t.ok('🎬 открывает сразу видео', view(p).indexOf('/api/tg-video/AgACfile') >= 0)
  p.run('mediaOpen("o1","s1","w1",99);')
  t.ok('индекс за краем подрезается', p.q('mediaView.i') === 2)
  const p2 = panel()
  p2.run('mediaOpen("o1","s1","w2",0);')
  t.ok('без медиа не открываем пустоту', p2.q('mediaView') === null)
}

t.section('Листание')
{
  const p = panel()
  p.run('mediaOpen("o1","s1","w1",0);mediaStep(1);')
  t.ok('вперёд', p.q('mediaView.i') === 1)
  p.run('mediaStep(-1);mediaStep(-1);')
  t.ok('назад с первого — в конец, по кругу', p.q('mediaView.i') === 2)
  p.run('mediaStep(1);')
  t.ok('и обратно в начало', p.q('mediaView.i') === 0)
}

t.section('Что видно в просмотрщике')
{
  const p = panel()
  p.run('mediaOpen("o1","s1","w1",0);')
  const h = view(p)
  t.ok('чья это работа', h.indexOf('Монтаж перегородок') >= 0 && h.indexOf('Баня Буханка') >= 0)
  t.ok('счётчик кадров', h.indexOf('1 / 3') >= 0)
  t.ok('сколько чего', h.indexOf('📷 2') >= 0 && h.indexOf('🎬 1') >= 0)
  t.ok('кто и когда снял', h.indexOf('Валера') >= 0 && h.indexOf('2026-09-19 12:00') >= 0)
  t.ok('есть чем листать и закрыть', h.indexOf('media-prev') >= 0 && h.indexOf('media-next') >= 0 && h.indexOf('media-close') >= 0)
  t.ok('лента миниатюр', (h.match(/data-a="media-go"/g) || []).length === 3)
  p.run('mediaOpen("o1","s1","w1",2);')
  const v = view(p)
  t.ok('у видео — запасной путь в Telegram', v.indexOf('https://t.me/c/') >= 0 && v.indexOf('/5/77') >= 0)
  t.ok('и объяснение про 20 МБ', v.indexOf('больше 20 МБ') >= 0)
}

t.section('Держим адрес работы, а не копию файлов')
{
  const p = panel()
  p.run('mediaOpen("o1","s1","w1",0);')
  // Пришёл живой опрос и принёс новое фото — просмотрщик должен это увидеть.
  p.run('objects[0].stages[0].works[0].photos.push({id:"p3",data:"/api/file/c.jpg"});')
  t.ok('новый кадр подхватился', view(p).indexOf('4') >= 0 && p.q('workMedia("o1","s1","w1").items.length') === 4)
  t.ok('в просмотрщике лежит адрес', p.q('Object.keys(mediaView).sort()').join() === 'i,oid,sid,wid')
}

t.section('Точки входа')
{
  const p = panel()
  p.run('tab="analysis";analysisObj="o1";')
  const g = p.run('tBuildAnalysis()')
  t.ok('значок 📷 на Ганте — кнопка', /data-a="media-open"[^>]*data-wid="w1"[^>]*data-i="0"/.test(g))
  t.ok('значок 🎬 открывает с видео', /data-a="media-open"[^>]*data-wid="w1"[^>]*data-i="2"/.test(g))
  p.run('tab="assign";openObject="o1";objWorkView="receive";openPhotoWid="w1";')
  const card = p.run('tObjects()')
  t.ok('миниатюра в карточке тоже открывает', /<img data-a="media-open"[^>]*data-i="0"/.test(card))
  t.ok('строка видео — «Смотреть», а не уход в Telegram', /data-a="media-open"[^>]*data-i="2"[^>]*>▶ Смотреть/.test(card))
}

t.done()
