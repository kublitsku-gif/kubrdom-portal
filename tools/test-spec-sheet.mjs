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

  p.run(`specOpenId=${JSON.stringify(id)};specsCollapsed={${JSON.stringify(id)}:false};`)
  const card = p.run('tSpec()')
  t.ok('в карточке есть блок раскладки', card.indexOf('РАСКЛАДКА ПО ДОМУ') > 0)
  t.ok('и счётчики в развёрнутом редакторе помещений', card.indexOf('spec-pt') > 0)

  p.run('window.__printed="";window.open=function(){return {document:{write:function(h){window.__printed=h;},close:function(){}}};};')
  const btn = p.dom.node({ a: 'spec-print', id })
  p.run('bind();')
  btn.onclick()
  const html = p.run('window.__printed')
  t.ok('в печатной форме есть таблица раскладки', html.indexOf('>Раскладка<') > 0,
    'клиент читает проект по комнатам: сколько где розеток и света')
  t.ok('с итогом по каждой точке', /Всего/.test(html) && html.indexOf('Розетка') > 0)
}

// ── 10. Вкладка рисуется ──────────────────────────────────────────────────────
{
  t.section('Отрисовка вкладки')
  const p = panel()
  const id = assembled(p)
  p.run('specOpenId=null;')
  const list = p.run('tSpec()')
  t.ok('в списке видно спецификацию и её цену', list.indexOf('Баня Иванова') > 0 && list.indexOf('spec-open') > 0)
  p.run(`specOpenId=${JSON.stringify(id)};`)
  const card = p.run('tSpec()')
  t.ok('карточка показывает помещения и группы выбора',
    card.indexOf('Парная') > 0 && card.indexOf('spec-pick-room') > 0 && card.indexOf('spec-pick-global') > 0)
  t.ok('и три действия: клиенту, договор, объект',
    card.indexOf('spec-print') > 0 && card.indexOf('spec-to-contract') > 0 && card.indexOf('spec-to-object') > 0)
}

t.done()
