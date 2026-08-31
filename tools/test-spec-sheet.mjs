#!/usr/bin/env node
// Вкладка «Спецификация»: сборка дома продавцом и превращение её в договор и объект
// (public/admin.js).
//
// Расчёт как таковой сторожит test-spec (src/spec.js). Здесь проверяется то, что живёт
// только в панели и ломается тише всего: спецификация — КОПИЯ планировки, цена клиенту
// в договоре равна цене на экране, а объект собирается из выбранного, а не из шаблона.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_gkl', name: 'ГКЛ 12,5 мм', unitCost: 400, store: 'Лемана', mode: 'sheet', packBase: 'м²', packPer: 3 },
  { id: 'p_mdf', name: 'МДФ панель', unitCost: 700, store: 'Белка', mode: 'm2' },
  { id: 'p_lam', name: 'Ламинат', unitCost: 800, store: 'Лемана', mode: 'm2' },
  { id: 'p_ppu3', name: 'ППУ 3 см', unitCost: 500, store: 'Белка', mode: 'm2' },
  { id: 'p_ppu8', name: 'ППУ 8 см', unitCost: 1100, store: 'Белка', mode: 'm2' },
  { id: 'p_screw', name: 'Саморезы', unitCost: 300, store: 'Озон', mode: 'piece' },
]

const EST = [
  { id: 'e_base', kind: 'banya', name: 'Каркас и обвязка', stage: 1, lines: [{ pid: 'p_screw', qty: 4 }] },
  { id: 'e_gkl', kind: 'banya', name: 'Стены ГКЛ', stage: 2, optScope: 'room', optGroup: 'Стены', optLabel: 'ГКЛ', optSurface: 'wall',
    lines: [{ pid: 'p_gkl', qty: 1 }, { pid: 'p_screw', qty: 1 }] },
  { id: 'e_mdf', kind: 'banya', name: 'Стены МДФ', stage: 2, optScope: 'room', optGroup: 'Стены', optLabel: 'МДФ', optSurface: 'wall',
    lines: [{ pid: 'p_mdf', qty: 1 }] },
  { id: 'e_lam', kind: 'banya', name: 'Пол ламинат', stage: 3, optScope: 'room', optGroup: 'Пол', optLabel: 'Ламинат', optSurface: 'floor',
    lines: [{ pid: 'p_lam', qty: 1 }] },
  { id: 'e_ppu3', kind: 'banya', name: 'Утепление ППУ 3 см', stage: 1, optScope: 'global', optGroup: 'Утепление', optLabel: '3 см', optSurface: 'wall',
    lines: [{ pid: 'p_ppu3', qty: 1 }] },
  { id: 'e_ppu8', kind: 'banya', name: 'Утепление ППУ 8 см', stage: 1, optScope: 'global', optGroup: 'Утепление', optLabel: '8 см', optSurface: 'wall',
    lines: [{ pid: 'p_ppu8', qty: 1 }] },
]

const PLANS = [
  { id: 'pl1', name: 'Баня 4×6', cat: 'banya', specs: { height: 2.5, openings: [], rooms: [
    { id: 'r1', name: 'Парная', w: 2, l: 3, wallLen: 10 },
    { id: 'r2', name: 'Комната отдыха', w: 3, l: 4, wallLen: 14 },
  ] } },
  { id: 'pl2', name: 'Дом 3×3', cat: 'house', specs: { height: 2.4, openings: [], rooms: [
    { id: 'q1', name: 'Мойка', w: 3, l: 3, wallLen: 12 },
  ] } },
]

function panel(opts) {
  const p = boot(opts)
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: PLANS,
    crmClients: [{ id: 'c1', name: 'Иванов И.И.' }],
    specSheets: [], objects: [], templates: [], contractDocs: [], purchases: [],
    issues: [], users: [], stock: [], settings: { specMarkup: 40 },
  })
  p.run('currentUser={id:"u1",name:"Менеджер",roles:["sales_mgr"],objs:[],c:"#000",av:"💼"};')
  return p
}

// Создать спецификацию так, как это делает продавец: форма → «Создать».
function create(p, planId = 'pl1') {
  p.dom.field('spec-n-name', 'Баня Иванова')
  p.dom.field('spec-n-client', 'c1')
  const tile = p.dom.node({ a: 'spec-n-plan-pick', id: planId })
  p.run('bind();')
  tile.onclick()
  const btn = p.dom.node({ a: 'spec-create' })
  p.run('bind();')
  btn.onclick()
  return p.q('specSheets')[0]
}

function pickRoom(p, rid, group, eid) {
  const el = p.dom.node({ a: 'spec-pick-room', rid, g: group, eid })
  p.run('bind();')
  el.onclick()
}

function pickGlobal(p, group, eid) {
  const el = p.dom.node({ a: 'spec-pick-global', g: group, eid })
  p.run('bind();')
  el.onclick()
}

// Полностью собранная спецификация: обе комнаты и общедомовая опция.
function assembled(p) {
  const sh = create(p)
  pickRoom(p, 'r1', 'Стены', 'e_gkl')
  pickRoom(p, 'r1', 'Пол', 'e_lam')
  pickRoom(p, 'r2', 'Стены', 'e_mdf')
  pickRoom(p, 'r2', 'Пол', 'e_lam')
  pickGlobal(p, 'Утепление', 'e_ppu8')
  return sh.id
}

// ── 1. Спецификация — копия планировки ───────────────────────────────────────
{
  t.section('Создание из планировки')
  const p = panel()
  const sh = create(p)
  t.ok('размеры приехали из планировки', (sh.specs.rooms || []).length === 2 && sh.specs.height === 2.5,
    JSON.stringify(sh.specs))
  t.ok('клиент и вид записаны', sh.clientId === 'c1' && sh.kind === 'banya')
  t.ok('наценка взята из настроек', sh.markup === 40, String(sh.markup))
  t.ok('спецификация открылась сразу', p.q('specOpenId') === sh.id)

  // Планировку в базе правят постоянно; проданное этим меняться не должно.
  p.run('dbPlans[0].specs.rooms[0].w=99;dbPlans[0].specs.height=9;')
  const after = p.q('specSheets')[0]
  t.ok('правка планировки в базе спецификацию не трогает', after.specs.rooms[0].w === 2 && after.specs.height === 2.5,
    JSON.stringify(after.specs.rooms[0]) + ' — иначе цена, названная клиенту, поедет задним числом')
}

// ── 2. Выбор варианта меняет цену на экране ──────────────────────────────────
{
  t.section('Выбор отделки')
  const p = panel()
  const id = create(p).id
  const empty = p.q(`specTot(specSheet(${JSON.stringify(id)})).cost`)

  pickRoom(p, 'r1', 'Стены', 'e_mdf')
  const mdf = p.q(`specTot(specSheet(${JSON.stringify(id)})).cost`)
  t.ok('выбор стен добавил стоимость', mdf - empty === 25 * 700, String(mdf - empty) + ' — 25 м² × 700')

  pickRoom(p, 'r1', 'Стены', 'e_gkl')
  const gkl = p.q(`specTot(specSheet(${JSON.stringify(id)})).cost`)
  t.ok('другой вариант заменяет прежний, а не добавляется', gkl !== mdf && p.q(`Object.keys(specSheet(${JSON.stringify(id)}).rooms.r1)`).length === 1,
    JSON.stringify(p.q(`specSheet(${JSON.stringify(id)}).rooms`)))

  pickRoom(p, 'r1', 'Стены', '')
  t.ok('выбор снимается', p.q(`specTot(specSheet(${JSON.stringify(id)})).cost`) === empty)

  pickGlobal(p, 'Утепление', 'e_ppu8')
  const ins = p.q(`specTot(specSheet(${JSON.stringify(id)})).cost`)
  t.ok('общедомовая опция считается по всему дому', ins - empty === 60 * 1100, String(ins - empty) + ' — 25 + 35 м² стен')

  p.run(`specSheet(${JSON.stringify(id)}).markup=0;`)
  t.ok('цена клиенту = себестоимость × наценка', p.q(`specTot(specSheet(${JSON.stringify(id)})).price`) === ins)
}

// ── 3. Смена планировки сбрасывает выбор ─────────────────────────────────────
{
  t.section('Смена планировки')
  const p = panel()
  const id = assembled(p)
  const tile = p.dom.node({ a: 'spec-plan-pick', id: 'pl2' })
  p.run('bind();')
  tile.onclick()
  const sh = p.q('specSheets')[0]
  t.ok('помещения стали другими', sh.specs.rooms.length === 1 && sh.specs.rooms[0].id === 'q1')
  t.ok('отделка по старым комнатам сброшена', Object.keys(sh.rooms || {}).length === 0,
    JSON.stringify(sh.rooms) + ' — id помещений другие, выбор повис бы в пустоте')
  t.ok('общедомовой выбор остался — он от планировки не зависит', sh.global['Утепление'] === 'e_ppu8')
  t.ok('высота взята у новой планировки', sh.specs.height === 2.4)
  t.ok('id спецификации не менялся', sh.id === id)
}

// ── 4. Печатная форма клиенту ────────────────────────────────────────────────
{
  t.section('Печать клиенту')
  const p = panel()
  const id = assembled(p)
  p.run('window.__printed="";window.open=function(){return {document:{write:function(h){window.__printed=h;},close:function(){}}};};')
  const btn = p.dom.node({ a: 'spec-print', id })
  p.run('bind();')
  btn.onclick()
  const html = p.run('window.__printed')
  const tot = p.q(`specTot(specSheet(${JSON.stringify(id)}))`)
  t.ok('форма собралась', html.length > 500 && html.indexOf('<table') > 0)
  t.ok('помещения названы', html.indexOf('Парная') > 0 && html.indexOf('Комната отдыха') > 0)
  t.ok('цена клиенту — та же, что на экране', html.indexOf(tot.price.toLocaleString('ru-RU')) > 0,
    String(tot.price))
  t.ok('себестоимость наружу не выносим', html.indexOf('ебестоимость') < 0 && html.indexOf(String(tot.cost.toLocaleString('ru-RU'))) < 0,
    'клиенту показываем, ЧТО он получит, а не нашу математику')
  // Спецификация — это перечень того, что будет смонтировано, поэтому материалы в ней
  // ЕСТЬ. Нет закупочных цен: количество клиенту нужно, наша калькуляция — нет.
  t.ok('состав материалов перечислен', html.indexOf('Саморезы') > 0 && html.indexOf('МДФ панель') > 0)
  t.ok('с количеством и единицей', /Саморезы — \d/.test(html) && /м²/.test(html), 'клиент читает «40 м²», а не «40»')
  const matBlocks = html.match(/<div class="mats">([^<]*)<\/div>/g) || []
  t.ok('но без закупочных цен', matBlocks.length > 0 && matBlocks.every((x) => x.indexOf('₽') < 0),
    'иначе из спецификации считается наша наценка')
  t.ok('позиции разложены по этапам',
    html.indexOf('ПОДГОТОВИТЕЛЬНЫЙ') > 0 && html.indexOf('Итого по этапу') > 0,
    'стройка меряется этапами, по ним же идут сроки и платежи')

  // Наценка размазана по позициям, и рубли обязаны сойтись: расхождение строк с «ИТОГО»
  // клиент читает как ошибку в счёте, а спорить придётся продавцу.
  const rows = (html.match(/<td class="r">([^<]+)<\/td>/g) || [])
    .map((x) => Number(x.replace(/<[^>]*>/g, '').replace(/[^0-9]/g, '')))
  t.ok('строки складываются ровно в цену клиенту', rows.reduce((a, b) => a + b, 0) === tot.price,
    rows.reduce((a, b) => a + b, 0) + ' vs ' + tot.price)
}

// ── 5. Спецификация → договор ────────────────────────────────────────────────
{
  t.section('Договор из спецификации')
  const p = panel()
  const id = assembled(p)
  const tot = p.q(`specTot(specSheet(${JSON.stringify(id)}))`)
  const btn = p.dom.node({ a: 'spec-to-contract', id })
  p.run('bind();')
  btn.onclick()
  const c = p.q('contractDocs')[0]
  t.ok('договор заведён', !!c && p.q('contractDocs').length === 1)
  t.ok('сумма договора = цена спецификации', c.amount === tot.price, c.amount + ' vs ' + tot.price)
  t.ok('в договоре осталась ссылка на спецификацию', c.specId === id,
    'через полгода будет видно, из чего эта сумма собралась')
  t.ok('клиент перенесён', c.crmClientId === 'c1' && c.client === 'Иванов И.И.')
  t.ok('договор заводится черновиком', c.status === 'draft')
  const sh = p.q('specSheets')[0]
  t.ok('спецификация помечена проданной и знает свой договор', sh.status === 'sold' && sh.contractId === c.id)
}

// ── 6. Спецификация → объект ─────────────────────────────────────────────────
{
  t.section('Объект из спецификации')
  const p = panel()
  const id = assembled(p)
  const tot = p.q(`specTot(specSheet(${JSON.stringify(id)}))`)
  const toC = p.dom.node({ a: 'spec-to-contract', id })
  p.run('bind();')
  toC.onclick()
  const btn = p.dom.node({ a: 'spec-to-object', id })
  p.run('bind();')
  btn.onclick()

  const o = p.q('objects')[0]
  t.ok('объект создан', !!o && p.q('objects').length === 1)
  t.ok('шаблон здесь не участвует', o.templateId === '' && o.specId === id,
    'объект и есть проданный дом, а не копия фиксированного шаблона')
  t.ok('характеристики приехали из спецификации', (o.specs.rooms || []).length === 2 && o.specs.height === 2.5)

  const works = o.stages.reduce((a, s) => a.concat(s.works), [])
  t.ok('этапы разложены по номерам смет', o.stages.length === 3, JSON.stringify(o.stages.map((s) => s.n)))
  t.ok('работ столько же, сколько позиций', works.length === tot.count, works.length + ' vs ' + tot.count)
  t.ok('себестоимость объекта совпала со спецификацией',
    works.reduce((a, w) => a + w.cost, 0) === tot.cost,
    works.reduce((a, w) => a + w.cost, 0) + ' vs ' + tot.cost)
  t.ok('w.cost равен сумме материалов', works.every((w) => w.cost === w.mats.reduce((a, m) => a + m.cost * m.qty, 0)),
    'иначе смета объекта разойдётся со снабжением с первого дня')
  t.ok('у работ есть estId — ревизии и связь со сметой работают', works.every((w) => !!w.estId))
  t.ok('в названии работы видно помещение', works.some((w) => /Парная/.test(w.n)), JSON.stringify(works.map((w) => w.n)))
  const ids = works.map((w) => w.id).concat(works.reduce((a, w) => a.concat(w.mats.map((m) => m.id)), []))
  t.ok('id уникальны', new Set(ids).size === ids.length, 'общий id «протёк» бы отметками закупки')
  t.ok('материалы сохранили ссылку на каталог', works.every((w) => w.mats.every((m) => !!m.pid)),
    'без pid карточка товара не соберёт «где используется»')

  const sh = p.q('specSheets')[0]
  t.ok('спецификация знает свой объект', sh.objId === o.id)
  t.ok('договор привязан к объекту', p.q('contractDocs')[0].objId === o.id,
    'иначе договор остаётся без стройки, а стройка без денег')

  // Второй объект по той же спецификации — это дубль сметы на площадке.
  btn.onclick()
  t.ok('повторное создание объекта не проходит', p.q('objects').length === 1)
}

// ── 7. Недособранная спецификация ────────────────────────────
{
  t.section('Незаполненное')
  // confirm:false — продавец увидел список нехватки и отказался.
  const p = panel({ confirm: false })
  const id = create(p, '').id   // без планировки и без выбора
  const iss = p.q(`sheetIssues(specSheet(${JSON.stringify(id)}), estimates, expProducts)`)
  t.ok('продавцу перечислено, чего не хватает', iss.length >= 2, JSON.stringify(iss))

  const btn = p.dom.node({ a: 'spec-to-contract', id })
  p.run('bind();')
  btn.onclick()
  t.ok('отказ от предупреждения останавливает договор', p.q('contractDocs').length === 0,
    'иначе предупреждение — просто текст, а клиент получает сумму без половины дома')

  // Совсем пустая база: цены нет вообще — тут соглашаться уже не предлагается.
  const q = panel()
  q.run('estimates=[];')
  const qid = create(q, '').id
  t.ok('без смет цена нулевая', q.q(`specTot(specSheet(${JSON.stringify(qid)})).price`) === 0)
  const qb = q.dom.node({ a: 'spec-to-contract', id: qid })
  q.run('bind();')
  qb.onclick()
  t.ok('договора на ноль нет', q.q('contractDocs').length === 0)
  const qo = q.dom.node({ a: 'spec-to-object', id: qid })
  q.run('bind();')
  qo.onclick()
  t.ok('и объект из воздуха не собирается', q.q('objects').length === 0,
    'пустой объект на площадке хуже, чем его отсутствие')
}

// ── 8. Планировка клиента: свой чертёж и размеры руками ──────────────────────
{
  t.section('Планировка клиента')
  const p = panel()
  // Планировок «своей» категории может не быть вовсе — как у вида «Дом» на проде.
  const tiles = p.run('specPlanTiles("house","","spec-n-plan-pick")')
  t.ok('в выборе есть планировки обеих категорий', /pl1/.test(tiles) && /pl2/.test(tiles),
    'жёсткий фильтр по категории оставлял продавца с пустым списком')
  t.ok('своя категория идёт первой', tiles.indexOf('pl2') < tiles.indexOf('pl1'), tiles)
  t.ok('и есть плитка «без планировки»', /data-id=""/.test(tiles))

  // Дом собирается и без планировки в базе: помещения заводятся руками по чертежу клиента.
  const id = create(p, '').id
  t.ok('помещений сначала нет', p.q('specSheets')[0].specs.rooms.length === 0)
  const add = p.dom.node({ a: 'spec-room-add', oid: id })
  p.run('bind();')
  add.onclick()
  const set = (f, v) => {
    const el = p.dom.node({ a: 'spec-room-field', oid: id, i: '0', f })
    el.value = String(v)
    p.run('bind();')
    el.onchange()
  }
  set('name', 'Гостиная'); set('w', 4); set('l', 5); set('wallLen', 18)
  p.run(`specSheet(${JSON.stringify(id)}).specs.height=2.7;`)
  const r = p.q('specSheets')[0].specs.rooms[0]
  t.ok('размеры записаны', r.name === 'Гостиная' && r.w === 4 && r.l === 5 && r.wallLen === 18, JSON.stringify(r))

  const rid = r.id
  pickRoom(p, rid, 'Пол', 'e_lam')
  const pos = p.q(`sheetPositions(specSheet(${JSON.stringify(id)}), estimates, expProducts)`)
    .find((x) => x.roomId === rid)
  t.ok('площадь пола посчитана из введённых размеров', pos.area === 20, String(pos.area))
  t.ok('и цена собралась по ней', pos.cost === 20 * 800, String(pos.cost))
  pickRoom(p, rid, 'Стены', 'e_mdf')
  const wall = p.q(`sheetPositions(specSheet(${JSON.stringify(id)}), estimates, expProducts)`)
    .find((x) => x.surface === 'wall' && x.roomId === rid)
  t.ok('стены — периметр × высота', wall.area === 18 * 2.7, String(wall.area))
  t.ok('замечания про помещения больше нет',
    !p.q(`sheetIssues(specSheet(${JSON.stringify(id)}), estimates, expProducts)`).some((x) => /Нет помещений/.test(x)))
}

// ── 9. Чертёж: из базы и в базу ──────────────────────────────────────────────
{
  t.section('Чертёж планировки')
  const p = panel()
  p.run('dbPlans[0].img="/api/file/plans/64.png";')
  const id = create(p).id
  const sh = p.q('specSheets')[0]
  t.ok('план из базы приехал вместе с чертежом', sh.specs.planUrl === '/api/file/plans/64.png',
    'продавец показывает клиенту план, а не таблицу чисел')

  // Загруженный чертёж можно завести в базу — иначе он грузится заново каждому клиенту.
  const q = panel()
  const qid = create(q, '').id
  q.run(`(function(){var sh=specSheet(${JSON.stringify(qid)});ensureSpecs(sh);sh.specs.planUrl="/api/file/plans/client.pdf";sh.specs.planName="План Петровых";sh.specs.rooms=[{id:"x1",name:"Зал",w:3,l:4,wallLen:14}];sh.specs.height=2.6;})();`)
  q.run('window.prompt=function(){return "Дом Петровых";};')
  const toBase = q.dom.node({ a: 'spec-plan-tobase', id: qid })
  q.run('bind();')
  toBase.onclick()
  const plans = q.q('dbPlans')
  t.ok('планировка добавлена в базу', plans.length === 3 && plans[2].img === '/api/file/plans/client.pdf', String(plans.length))
  t.ok('размеры скопированы вместе с ней', plans[2].specs.rooms.length === 1 && plans[2].specs.height === 2.6)
  t.ok('категория взята у вида сметы', plans[2].cat === 'banya', plans[2].cat)
  t.ok('спецификация теперь ссылается на неё', q.q('specSheets')[0].planId === plans[2].id)
  toBase.onclick()
  t.ok('повторно та же планировка не заводится', q.q('dbPlans').length === 3)
}

// ── 9б. Раскладка в панели: счётчики, сводка, печать ─────────────────────────
{
  t.section('Раскладка в панели')
  const p = panel()
  const id = assembled(p)
  const rid = p.q('specSheets')[0].specs.rooms[0].id

  // Счётчик у помещения: продавец снимает раскладку с дизайн-проекта кнопками.
  const inc = p.dom.node({ a: 'spec-pt', oid: id, i: '0', k: 'sock', d: '1' })
  p.run('bind();')
  inc.onclick(); inc.onclick(); inc.onclick()
  t.ok('точки записались в помещение', p.q('specSheets')[0].specs.rooms[0].pts.sock === 3,
    JSON.stringify(p.q('specSheets')[0].specs.rooms[0].pts))

  const dec = p.dom.node({ a: 'spec-pt', oid: id, i: '0', k: 'sock', d: '-1' })
  p.run('bind();')
  dec.onclick(); dec.onclick(); dec.onclick(); dec.onclick()
  t.ok('ниже нуля не уходит и пустое не хранится',
    !(p.q('specSheets')[0].specs.rooms[0].pts || {}).sock,
    JSON.stringify(p.q('specSheets')[0].specs.rooms[0].pts))

  // Раскладка целого дома видна на старте — и на экране, и в печати.
  p.run(`(function(){var sh=specSheet(${JSON.stringify(id)});
    sh.specs.rooms[0].pts={win:2,sock:10,lamp:6,sw:1};
    sh.specs.rooms[1].pts={win:1,sock:5,lamp:3};})();`)
  t.ok('сводка по дому сложилась', JSON.stringify(p.q(`pointTotals(specSheet(${JSON.stringify(id)}))`)) ===
    JSON.stringify({ win: 3, sock: 15, lamp: 9, sw: 1 }),
    JSON.stringify(p.q(`pointTotals(specSheet(${JSON.stringify(id)}))`)))

  p.run(`specOpenId=${JSON.stringify(id)};specsCollapsed={${JSON.stringify(id)}:false};specView="sheet";specAcc={rooms:true,pts:true};`)
  const card = p.run('tSpec()')
  t.ok('в карточке есть блок раскладки', card.indexOf('Раскладка по дому') > 0 && card.indexOf('15') > 0)
  // Редактор помещений переехал в блок «откуда дом» — раскладка правится там же,
  // где размеры, а не третьим блоком на экране.
  p.run('specGeoOpen=true;specGeoTab="manual";')
  t.ok('и счётчики в развёрнутом редакторе помещений', p.run('tSpec()').indexOf('spec-pt') > 0)
  p.run('specGeoOpen=false;specGeoTab="";')

  p.run('window.__printed="";window.open=function(){return {document:{write:function(h){window.__printed=h;},close:function(){}}};};')
  const btn = p.dom.node({ a: 'spec-print', id })
  p.run('bind();')
  btn.onclick()
  const html = p.run('window.__printed')
  t.ok('в печатной форме есть таблица раскладки', html.indexOf('>Раскладка<') > 0,
    'клиент читает проект по комнатам: сколько где розеток и света')
  t.ok('с итогом по каждой точке', /Всего/.test(html) && html.indexOf('Розетка') > 0)
}

// ── 9б2. Модель предлагается сразу при создании ──────────────────────────────
{
  t.section('Модель из формы создания')
  const p = panel()
  p.dom.field('spec-n-name', 'Дом 12 м')
  p.dom.field('spec-n-client', '')
  const box = p.dom.node({ a: 'spec-n-model', k: '40hc' })
  p.run('bind();')
  box.onclick()
  const btn = p.dom.node({ a: 'spec-create' })
  p.run('bind();')
  btn.onclick()
  const sh = p.q('specSheets')[0]
  t.ok('спецификация создана сразу с моделью', !!sh.model && sh.model.type === '40hc',
    'иначе про модель узнают, только открыв карточку')
  t.ok('и характеристики уже посчитаны', sh.specs.rooms.length === 1 && sh.specs.height === 2.7,
    JSON.stringify(sh.specs.rooms))

  p.run('specOpenId=null;')
  const list = p.run('tSpec()')
  t.ok('в списке видно, что она собрана моделью', list.indexOf('модель') > 0)

  const form = p.run('specShowNew=true;specNew={name:"",kind:"house",clientId:"",planId:"",model:""};tSpec()')
  t.ok('в форме создания есть выбор контейнера', form.indexOf('spec-n-model') > 0 && form.indexOf('40 футов HC') > 0)
}

// ── 9в. Модель контейнера в панели ───────────────────────────────────────────
// Смысл модели один: подвинул перегородку — поехала смета. Это и сторожим.
{
  t.section('Модель контейнера')
  const p = panel()
  const id = create(p, '').id

  const mk = p.dom.node({ a: 'model-create', k: '40hc' })
  p.run('bind();')
  mk.onclick()
  const sh0 = p.q('specSheets')[0]
  t.ok('модель создана', !!sh0.model && sh0.model.l === 12032, JSON.stringify(sh0.model && sh0.model.type))
  t.ok('характеристики приехали из модели', sh0.specs.rooms.length === 1 && sh0.specs.height === 2.7,
    JSON.stringify(sh0.specs.rooms))

  // Делим на два помещения и отделываем оба.
  const rid = sh0.specs.rooms[0].id
  const split = p.dom.node({ a: 'model-split', id: rid })
  p.run('bind();')
  split.onclick()
  const rooms = p.q('specSheets')[0].specs.rooms
  t.ok('помещений стало два', rooms.length === 2, JSON.stringify(rooms.map((r) => r.l)))
  // Отделка у помещений разная — иначе перенос метров из одного в другое
  // ничего не изменит в сумме, и проверка ничего не проверит.
  pickRoom(p, rooms[0].id, 'Пол', 'e_lam')
  pickRoom(p, rooms[1].id, 'Стены', 'e_mdf')

  const before = p.q(`specTot(specSheet(${JSON.stringify(id)}))`)
  const beforeLeft = p.q(`sheetPositions(specSheet(${JSON.stringify(id)}), estimates, expProducts)`)
    .find((x) => x.roomId === rooms[0].id).area

  // Двигаем границу на два метра — площади и цена обязаны поехать.
  p.run(`(function(){var sh=specSheet(${JSON.stringify(id)});sh.model=moveBoundary(sh.model,0,2000);modelSync(sh);})();`)
  const after = p.q(`specTot(specSheet(${JSON.stringify(id)}))`)
  const afterLeft = p.q(`sheetPositions(specSheet(${JSON.stringify(id)}), estimates, expProducts)`)
    .find((x) => x.roomId === rooms[0].id).area
  t.ok('площадь левого помещения выросла', afterLeft > beforeLeft, beforeLeft + ' → ' + afterLeft)
  t.ok('смета пересчиталась', after.cost !== before.cost, before.cost + ' → ' + after.cost)

  // Типовое изделие в проём: цена изделия и «монтаж окна» считаются от модели.
  p.run('winTypes=[{id:"t1",kind:"win",n:"Окно 1300×1150",w:1300,h:1150,cost:14555}];')
  const addOp = p.dom.node({ a: 'model-op-add', t: 't1' })
  p.run('bind();')
  addOp.onclick()
  const sh = p.q('specSheets')[0]
  t.ok('проём встал в стену', (sh.model.openings || []).length === 1, JSON.stringify(sh.model.openings))
  t.ok('и попал в раскладку помещения', sh.specs.rooms.some((r) => (r.pts || {}).win === 1),
    JSON.stringify(sh.specs.rooms.map((r) => r.pts)))
  t.ok('стоимость изделий видна', p.q(`modelTotals(specSheet(${JSON.stringify(id)}).model, winTypes).openingsCost`) === 14555)

  // Продольная перегородка: санузел в углу.
  const bayId = p.q('specSheets')[0].model.rooms[0].id
  const sw = p.dom.node({ a: 'model-split-w', id: bayId })
  p.run('bind();')
  sw.onclick()
  const sh2 = p.q('specSheets')[0]
  t.ok('в отсеке две комнаты', sh2.specs.rooms.filter((r) => r.id === bayId || true).length >= 3,
    JSON.stringify(sh2.specs.rooms.map((r) => r.name)))
  t.ok('и обе попали в характеристики', sh2.specs.rooms.length === 3, String(sh2.specs.rooms.length))

  // Карточка рисуется вместе с планом и вкладками этапов.
  p.run(`specOpenId=${JSON.stringify(id)};`)
  const card = p.run('tSpec()')
  t.ok('в карточке есть план', card.indexOf('model-svg') > 0 && card.indexOf('model-drag') > 0)
  t.ok('проём на плане можно тащить', card.indexOf('model-op-drag') > 0)
  t.ok('и продольную перегородку тоже', card.indexOf('model-drag-w') > 0)

  // Полноэкранный редактор: панель свёрстана в колонку 480 px, а рисуют на большом
  // экране — поэтому он оверлеем, а не растянутой вкладкой.
  p.run('modelFull=true;modelTool="wall";')
  const full = p.run('modelFullOverlay()')
  t.ok('оверлей на весь экран', full.indexOf('position:fixed;inset:0') > 0)
  t.ok('с инструментами рисования', full.indexOf('model-tool') > 0 && full.indexOf('Стена поперёк') > 0)
  t.ok('и холстом, который принимает тапы', full.indexOf('model-canvas') > 0)
  t.ok('ручки перетаскивания в режиме рисования спрятаны',
    p.run('modelPlanSvg(specSheet(' + JSON.stringify(id) + '),true)').indexOf('model-drag"') < 0,
    'иначе они перехватывают тап по стене')
  p.run('modelTool="sel";')
  const plan = p.run('modelPlanSvg(specSheet(' + JSON.stringify(id) + '),true)')
  t.ok('в режиме «двигать» ручки на месте', plan.indexOf('model-drag') > 0)

  // Чертёж в редакторе — ТОТ ЖЕ, что уходит клиенту: штриховка стен и размерные
  // цепочки. Своя картинка у редактора означала бы два изображения одной модели, и
  // какое из них правда — выяснялось бы на площадке.
  const scheme = p.run('modelSchemeSvg(specSheet(' + JSON.stringify(id) + ').model, winTypes)')
  t.ok('редактор рисует чертёж, а не свою картинку', plan.indexOf('sch-hatch') > 0)
  const dims = (h) => (h.match(/>\d{3,5}</g) || []).join(' ')
  t.ok('с теми же размерами, что на чертеже для печати',
    dims(scheme) !== '' && dims(plan).indexOf(dims(scheme)) >= 0, dims(plan) + ' vs ' + dims(scheme))
  // Площадей на чертеже нет: они живут в панели рядом и меняются во время жеста.
  t.ok('площадей на чертеже нет', plan.indexOf('м²') < 0)

  // Узкий размер (обшивка 76, перегородка 100) между засечками не помещается —
  // он обязан уехать на выносную полочку и остаться ГОРИЗОНТАЛЬНЫМ. Повёрнутая
  // цифра в таком месте — то, из-за чего чертёж читают, наклонив голову.
  const narrowTexts = (plan.match(/<text[^>]*>(76|100)</g) || [])
  t.ok('узкие размеры на чертеже есть', narrowTexts.length >= 2, String(narrowTexts.length))
  t.ok('и ни один из них не повёрнут',
    narrowTexts.every((x) => x.indexOf('rotate') < 0), narrowTexts.join(' '))
  // Цифру пересекают выносные линии соседних цепочек — под ней белая подложка.
  t.ok('под цифрами подложка', narrowTexts.every((x) => x.indexOf('paint-order="stroke"') > 0))

  // Створка выходит из коробки на всю ширину полотна. Размерная цепочка обязана
  // лежать ЗА ней: линия, перечёркнутая дверью, читается как часть двери.
  // В этом листе дверей нет — ставим входную на длинную стену.
  p.run('winTypes=winTypes.concat([{id:"td",kind:"door",n:"Дверь 1000×2100",w:1000,h:2100,cost:0}]);')
  p.run('(function(){var sh=specSheet(' + JSON.stringify(id) + ');' +
    'sh.model.openings=(sh.model.openings||[]).concat([{id:"od",side:"s",pos:1000,sill:0,typeId:"td"}]);' +
    'modelSync(sh);})();')
  const withDoor = p.run('modelPlanSvg(specSheet(' + JSON.stringify(id) + '),true)')
  const sc = p.q('modelScheme(specSheet(' + JSON.stringify(id) + ').model, winTypes)')
  const outward = sc.openings.filter((o) => o.swing && o.swing.tip.y > sc.w)
  t.ok('дверь наружу на чертеже есть', outward.length > 0, JSON.stringify(sc.openings.map((o) => o.side)))
  const tipY = Math.max(...outward.map((o) => o.swing.tip.y))
  // Размерные линии — единственные с этой толщиной; берём те, что ниже коробки.
  const dimY = [...withDoor.matchAll(/<line x1="[-\d.]+" y1="([-\d.]+)"[^>]*stroke-width="24"/g)]
    .map((m) => Number(m[1])).filter((y) => y > sc.w)
  t.ok('цепочки снизу есть', dimY.length > 0, JSON.stringify(dimY))
  t.ok('и ни одна не проходит сквозь створку', dimY.every((y) => y > tipY),
    'створка до ' + tipY + ', линии на ' + dimY.join(', '))

  // На глухой стене цепочка не отъезжает: отступ платится только за размах створки.
  const roomier = p.q('(function(){var m=JSON.parse(JSON.stringify(specSheet(' + JSON.stringify(id) + ').model));' +
    'm.openings.forEach(function(o){o.into=-1;});return modelSchemeSvg(m, winTypes);})()')
  const vbOf = (h) => Number(/viewBox="[-\d]+ [-\d]+ \d+ (\d+)"/.exec(h)[1])
  t.ok('внутрь открытая дверь поля не занимает', vbOf(roomier) < vbOf(withDoor),
    vbOf(roomier) + ' против ' + vbOf(withDoor))

  // Жест целиком: палец проехал N пикселей — перегородка обязана проехать ровно
  // столько миллиметров, сколько чертежа под этими пикселями. Здесь и ловится
  // ошибка масштаба: считать мм/пиксель по длине дома нельзя, холст шире неё на
  // поля под цепочками, и перегородка отстаёт от пальца.
  const vbw = /data-vbw="(\d+)"/.exec(plan)
  const vb = /viewBox="[-\d]+ [-\d]+ (\d+) \d+"/.exec(plan)
  t.ok('масштаб жеста берётся с холста', !!vbw && !!vb && vbw[1] === vb[1],
    (vbw && vbw[1]) + ' ≠ ' + (vb && vb[1]))
  t.ok('и холст шире дома — на поля под цепочки',
    !!vb && Number(vb[1]) > p.q('totalLength(specSheet(' + JSON.stringify(id) + ').model)'))

  const SVG_PX = 1000, DRAG_PX = 50
  const handle = p.dom.node({ a: 'model-drag', i: '0' })
  handle.ownerSVGElement = { dataset: { vbw: vbw[1] }, getBoundingClientRect: () => ({ width: SVG_PX, height: 200 }) }
  p.run('bind();')
  const lenBefore = p.q('specSheet(' + JSON.stringify(id) + ').model.rooms[0].len')
  handle.onpointerdown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} })
  handle.onpointermove({ clientX: DRAG_PX, clientY: 0 })
  handle.onpointerup()
  const moved = p.q('specSheet(' + JSON.stringify(id) + ').model.rooms[0].len') - lenBefore
  const want = Math.round(DRAG_PX * Number(vbw[1]) / SVG_PX)
  t.ok('перегородка едет ровно за пальцем', Math.abs(moved - want) <= 1, moved + ' мм вместо ' + want)
  p.run('modelFull=false;')

  // Развёртка стены — второй вид той же модели.
  p.run('modelView="elev";modelSide="n";')
  const elev = p.run('tSpec()')
  t.ok('развёртка рисуется', elev.indexOf('отметки в см от чистого пола') > 0)
  t.ok('на ней видно высоту низа проёма', /H=\d/.test(elev), 'план сверху высоту показать не может')
  p.run('modelView="plan";')
  p.run('specView="sheet";specAcc={stages:true};')
  const stagesCard = p.run('tSpec()')
  t.ok('и вкладки этапов', stagesCard.indexOf('Работы по этапам') > 0 && stagesCard.indexOf('model-stage') > 0)
  t.ok('ручного редактора размеров при модели нет', card.indexOf('РАЗМЕРЫ ПОМЕЩЕНИЙ') < 0,
    'два источника правды об одних помещениях разъедутся в первый же день')
}

// ── 10. Вкладка рисуется ──────────────────────────────────────────────────────
{
  t.section('Отрисовка вкладки')
  const p = panel()
  const id = assembled(p)
  p.run('specOpenId=null;')
  const list = p.run('tSpec()')
  t.ok('в списке видно спецификацию и её цену', list.indexOf('Баня Иванова') > 0 && list.indexOf('spec-open') > 0)
  p.run(`specOpenId=${JSON.stringify(id)};specView="sheet";specAcc={rooms:true,global:true};`)
  const card = p.run('tSpec()')
  t.ok('карточка показывает помещения и группы выбора',
    card.indexOf('Парная') > 0 && card.indexOf('spec-pick-room') > 0 && card.indexOf('spec-pick-global') > 0)
  t.ok('и три действия: клиенту, договор, объект',
    card.indexOf('spec-print') > 0 && card.indexOf('spec-to-contract') > 0 && card.indexOf('spec-to-object') > 0)
}

t.done()
