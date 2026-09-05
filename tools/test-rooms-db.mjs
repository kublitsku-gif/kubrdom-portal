#!/usr/bin/env node
// Справочник комнат — «🗄️ База данных → 🚪 Комнаты».
//
// Смысл шага: комнаты живут в справочнике вида смет, и от них зависит не только
// выбор в карточке сметы, но и цвет блоков в смете по чертежу. Раньше добавить
// или удалить комнату можно было только внутри карточки конкретной сметы — место,
// куда за справочником никто не пойдёт. Здесь сторожим, что справочник правится
// на своём экране и что правки видны там, где комнаты показываются.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const STATE = {
  expProducts: [], estimates: [], dbPlans: [], crmClients: [], specSheets: [], specSheets2: [],
  winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
  users: [], stock: [], settings: {}, buildRules: [],
}

// ── 1. Кухня-гостиная заведена по умолчанию ─────────────────────────────────
{
  t.section('Кухня-гостиная в справочнике дома')
  const p = boot({})
  p.set(STATE)
  const rooms = p.q('roomsFor("house")')
  const kg = rooms.filter((r) => /кухня/i.test(r.n))[0]
  t.ok('кухня-гостиная есть', !!kg, 'комнаты: ' + rooms.map((r) => r.n).join(', '))
  t.ok('с собственным цветом', kg && /^#[0-9a-f]{6}$/i.test(kg.color), kg && kg.color)
  // Значок по умолчанию у добавленных руками комнат — дверь; у заведённой в коде
  // он должен говорить о комнате, иначе список читается одинаковыми дверями.
  t.ok('и со своим значком', kg && kg.emoji && kg.emoji !== '🚪', kg && kg.emoji)
  const cols = rooms.map((r) => r.color)
  t.ok('цвета комнат дома не повторяются', new Set(cols).size === cols.length, cols.join(' '))
  // Ради этого всё и затевалось: блок «Кухня-гостиная» в смете по чертежу должен
  // краситься цветом справочника, а не случайным по имени.
  t.ok('блок сметы возьмёт её цвет', p.q('roomLook("Кухня-гостиная","house").color') === (kg || {}).color)
  t.ok('«Общие» остаются последними', rooms[rooms.length - 1].k === 'obshchie', rooms[rooms.length - 1].n)
}

// ── 2. Раздел справочника ───────────────────────────────────────────────────
{
  t.section('Комнаты правятся в своём разделе базы')
  const p = boot({})
  p.set(STATE)
  const html = p.run('tab="works";dbSection="rooms";roomsDbKind="house";tWorks()')
  t.ok('раздел есть в переключателе базы', html.indexOf('data-dt="rooms"') >= 0)
  t.ok('виды смет перечислены', html.indexOf('data-a="rooms-kind"') >= 0)
  t.ok('комнаты вида показаны', /Кухня-гостиная/.test(html), 'нет комнаты в списке')
  t.ok('у каждой комнаты есть удаление',
    (html.match(/data-a="rooms-del"/g) || []).length === p.q('roomsFor("house").length') - 1,
    'кнопок: ' + (html.match(/data-a="rooms-del"/g) || []).length)
  t.ok('и кнопка добавления', html.indexOf('data-a="rooms-add"') >= 0)
}

// ── 3. Добавление ───────────────────────────────────────────────────────────
{
  t.section('Комната добавляется')
  const p = boot({})
  p.set(STATE)
  p.run('tab="works";dbSection="rooms";roomsDbKind="house";render();')
  const before = p.q('roomsFor("house").length')
  const add = p.dom.node({ a: 'rooms-add' })
  p.run('bind();'); add.onclick()
  const after = p.q('roomsFor("house")')
  t.ok('комнат стало больше', after.length === before + 1, 'было ' + before + ', стало ' + after.length)
  t.ok('«Общие» по-прежнему последние', after[after.length - 1].k === 'obshchie', after[after.length - 1].n)
  t.ok('у новой свой цвет, не повтор соседа',
    after[after.length - 2].color !== after[after.length - 3].color)
  // Правка справочника вида не должна трогать другой вид — сметы бани не знают
  // про комнаты дома.
  t.ok('баня не изменилась', p.q('roomsFor("banya").length') === 6, 'у бани: ' + p.q('roomsFor("banya").length'))
}

// ── 4. Переименование и цвет ────────────────────────────────────────────────
{
  t.section('Имя и цвет комнаты правятся')
  const p = boot({})
  p.set(STATE)
  p.run('tab="works";dbSection="rooms";roomsDbKind="house";render();')
  const key = p.q('roomsFor("house")[0].k')
  const nameInput = p.dom.node({ a: 'rooms-name', r: key })
  p.run('bind();')
  nameInput.value = 'Гостиная-столовая'
  nameInput.onchange()
  t.ok('имя сохранилось', p.q('roomsFor("house")[0].n') === 'Гостиная-столовая', p.q('roomsFor("house")[0].n'))
  const colorBtn = p.dom.node({ a: 'rooms-color', r: key, c: '#2c3e50' })
  p.run('bind();'); colorBtn.onclick()
  t.ok('цвет сохранился', p.q('roomsFor("house")[0].color') === '#2c3e50', p.q('roomsFor("house")[0].color'))
  // Переименовали — и смета красит блок по новому имени.
  t.ok('смета красит по новому имени', p.q('roomLook("Гостиная-столовая","house").color') === '#2c3e50')
}

// ── 5. Удаление ─────────────────────────────────────────────────────────────
{
  t.section('Комната удаляется, «Общие» — нет')
  const p = boot({ confirm: true })
  p.set(STATE)
  p.run('tab="works";dbSection="rooms";roomsDbKind="house";render();')
  const before = p.q('roomsFor("house")')
  const victim = before[0].k
  const del = p.dom.node({ a: 'rooms-del', r: victim })
  p.run('bind();'); del.onclick()
  const after = p.q('roomsFor("house")')
  t.ok('комнаты не стало', after.length === before.length - 1 && !after.some((r) => r.k === victim),
    'осталось: ' + after.length)
  // «Общие» — системная: в неё попадают сметы без своей комнаты, удалить нельзя.
  const html = p.run('tWorks()')
  t.ok('у «Общих» кнопки удаления нет',
    (html.match(/data-a="rooms-del"/g) || []).length === after.length - 1)
}

t.done()
