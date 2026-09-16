#!/usr/bin/env node
// Квартира во вкладке «🏗 Проекты» (public/admin.js).
//
// Раздел заводился под дом из контейнера: его портал ЧЕРТИТ. Квартиру он не
// чертит — её обмерил дизайнер, и портал хранит замер. Здесь сторожим, что эти
// два типа не перепутались на экране: квартире не подсовывают заготовку
// контейнера, её полоса «Чертёж» — это таблица помещений и лист заказчика, а
// смета считается по тем же площадям, что показаны, и правятся они на месте.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_paint', name: 'Краска', unitCost: 500, store: 'Лемана ПРО', mode: 'm2' },
]
const EST = [
  { id: 'e_wall', kind: 'kflat', name: 'Покраска стен', stage: 2, lines: [{ pid: 'p_paint', qty: 1 }] },
  { id: 'e_wall_h', kind: 'house', name: 'Покраска стен', stage: 2, lines: [{ pid: 'p_paint', qty: 1 }] },
]
const RULES = [
  { id: 'r_wall', kind: 'kflat', estId: 'e_wall', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 0 },
  { id: 'r_wall_h', kind: 'house', estId: 'e_wall_h', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 0 },
]
// Виды смет заводят люди в разделе «Виды». Вид — НЕ тип модели: по нему
// подбираются сметы и правила, и квартира, заведённая видом «Дом», собрала бы
// состав контейнера.
const KINDS = [
  { k: 'house', n: 'Дом', emoji: '🏠' },
  { k: 'kflat', n: 'Квартира Бизнес', emoji: '🧾' },
]

function panel() {
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
    specSheets: [], specSheets2: [], projects: [], buildRules: RULES,
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30 }, EST_KINDS: KINDS,
  })
  // Частичная перерисовка в node:vm ни к чему: тестам нужен стейт, а HTML они
  // берут вызовом tProjects() там, где он нужен.
  p.run('rerenderTab=function(){};')
  return p
}

// Тап по кнопке: узел регистрируется ДО bind() — иначе вешать обработчик не на что.
function tap(p, dataset) {
  const el = p.dom.node(dataset)
  p.run('bind();')
  el.onclick()
  return el
}

// Правка поля: тот же порядок, но обработчик висит на change.
function put(p, dataset, value) {
  const el = p.dom.node(dataset)
  p.run('bind();')
  el.value = String(value)
  el.onchange()
  return el
}

// Создание так, как это делает человек: имя → тип → «Создать».
function create(p, kind, name) {
  p.run('tab="projects";projOpenId=null;projNew=null;tProjects();')
  tap(p, { a: 'proj-new' })
  if (kind === 'flat') {
    p.run('tProjects();')
    tap(p, { a: 'proj-n-kind', k: 'flat' })
  }
  p.dom.field('proj-n-name', name || 'Квартира на Кончаловского')
  p.dom.field('proj-n-client', 'c1')
  p.run('tProjects();')
  tap(p, { a: 'proj-create' })
}

// Помещение руками: кнопка «+ Помещение», потом поля строки.
function addRoom(p, pid, r) {
  p.run('projBand="plan";tProjects();')
  tap(p, { a: 'flat-room-add', id: pid })
  const rid = p.q('projects[0].model.rooms[projects[0].model.rooms.length-1].id')
  Object.keys(r).forEach((f) => {
    p.run('tProjects();')
    put(p, { a: 'flat-room', id: pid, rid: rid, f: f }, r[f])
  })
  return rid
}

// ── 1. Тип выбирают при создании ─────────────────────────────────────────────
{
  t.section('Дом и квартира — разные проекты с самого начала')
  const p = panel()
  p.run('tab="projects";projOpenId=null;tProjects();')
  tap(p, { a: 'proj-new' })
  const form = p.run('tProjects()')
  t.ok('спрашивают, что заводим', form.indexOf('data-a="proj-n-kind"') >= 0)
  t.ok('по умолчанию дом — с заготовками', form.indexOf('data-a="proj-n-preset"') >= 0)

  tap(p, { a: 'proj-n-kind', k: 'flat' })
  const flatForm = p.run('tProjects()')
  // Заготовка контейнера у квартиры — это чужие площади: их там быть не должно.
  t.ok('у квартиры заготовок нет', flatForm.indexOf('data-a="proj-n-preset"') < 0)
  t.ok('и объяснено почему', /замер/.test(flatForm))
  // Вид сметы спрашивают сразу: без него смета собирается не тем составом.
  t.ok('вид сметы спрашивают', flatForm.indexOf('id="proj-n-kind-est"') >= 0)
  t.ok('и подсказан квартирный', /value="kflat" selected/.test(flatForm))
}

// ── 2. Что создаётся ─────────────────────────────────────────────────────────
{
  t.section('Квартира заводится пустой')
  const p = panel()
  create(p, 'flat')
  t.ok('проект появился', p.q('projects.length') === 1)
  // Вид сметы подсказан по названию: «Квартира Бизнес», а не «Дом». Заведи мы
  // сюда тип модели, смета собралась бы пустой — под «flat» правил нет ни у кого.
  t.ok('вид сметы — квартирный', p.q('projects[0].kind') === 'kflat')
  t.ok('модель квартирная', p.q('projects[0].model.type') === 'flat')
  t.ok('имя своё', p.q('projects[0].name') === 'Квартира на Кончаловского')
  t.ok('клиент привязан', p.q('projects[0].clientId') === 'c1')
  // Пустая — потому что замера ещё нет. Придуманные помещения пришлось бы
  // удалять, а незамеченные доехали бы до сметы.
  t.ok('помещений нет', p.q('(projects[0].model.rooms||[]).length') === 0)
  // Открывается на «Чертеже»: пока помещений нет, смете нечего показать.
  t.ok('открывается на чертеже', p.q('projBand') === 'plan')

  const house = panel()
  create(house, 'house', 'Дом Ивановых')
  t.ok('дом по-прежнему заводится заготовкой', house.q('(projects[0].model.rooms||[]).length') >= 3)
  t.ok('и открывается на составе', house.q('projBand') === 'parts')
  t.ok('дом квартирой не стал', house.q('projects[0].model.type') !== 'flat')
  t.ok('и вид у него свой', house.q('projects[0].kind') === 'house')
}

// ── 3. Полоса «Чертёж» у квартиры ────────────────────────────────────────────
{
  t.section('Вместо чертежа — замер')
  const p = panel()
  create(p, 'flat')
  const plan = p.run('projBand="plan";tProjects()')
  // Рисовать план квартиры по площадям значит выдать бригаде документ, которого
  // никто не мерял.
  t.ok('схемы не рисуется', plan.indexOf('sch-hatch') < 0)
  t.ok('есть габарит и высота', plan.indexOf('data-a="flat-head"') >= 0 && /КВАРТИРА/.test(plan))
  t.ok('есть таблица помещений', /ПОМЕЩЕНИЯ ПО ЭКСПЛИКАЦИИ/.test(plan))
  t.ok('пустая таблица объясняет, что делать', /Распознать|добавьте помещение руками/.test(plan))
  t.ok('можно добавить помещение', plan.indexOf('data-a="flat-room-add"') >= 0)
  t.ok('есть куда положить лист', plan.indexOf('data-a="flat-plan-add"') >= 0)
  // Без листов читать нечего — и кнопки быть не должно.
  t.ok('без листов «Распознать» не предлагают', plan.indexOf('data-a="flat-read"') < 0)

  p.run('projects[0].plans=[{id:"f1",url:"k1",name:"plan.pdf"}];')
  const withPlan = p.run('tProjects()')
  t.ok('с листом кнопка появилась', withPlan.indexOf('data-a="flat-read"') >= 0)
  t.ok('и сказано, сколько листов уйдёт', /Распознать — 1 лист/.test(withPlan))
}

// ── 4. Замер правится руками ─────────────────────────────────────────────────
{
  t.section('Метры правятся там же, где показаны')
  const p = panel()
  create(p, 'flat')
  const pid = p.q('projects[0].id')

  p.run('projBand="plan";tProjects();')
  put(p, { a: 'flat-head', id: pid, f: 'h' }, '2950')
  t.ok('высота записалась', p.q('projects[0].model.h') === 2950)
  // Смета считается по specs — разъехаться им нельзя ни на одной правке.
  t.ok('и уехала в характеристики', p.q('projects[0].specs.height') === 2.95)

  p.run('tProjects();')
  put(p, { a: 'flat-head', id: pid, f: 'partLen' }, '21,4')   // запятая — как её набирают с телефона
  t.ok('перегородки приняты с запятой', p.q('projects[0].model.partLen') === 21.4)

  const rid = addRoom(p, pid, { name: 'Кухня', floor: '15,93', wallLen: '16,23', w: '3325', l: '4790' })
  t.ok('помещение добавилось', p.q('(projects[0].model.rooms||[]).length') === 1)
  t.ok('площадь записалась', p.q(`projects[0].model.rooms[0].floor`) === 15.93)
  t.ok('периметр записался', p.q(`projects[0].model.rooms[0].wallLen`) === 16.23)
  t.ok('характеристики синхронизированы', p.q('(projects[0].specs.rooms||[]).length') === 1)
  t.ok('и площадь в них та же', p.q('projects[0].specs.rooms[0].floor') === 15.93)

  const shown = p.run('tProjects()')
  t.ok('итог пола показан', /15,93 м²/.test(shown))

  // Размеры — проверка чтения, а не источник площади: разошлись — человек видит
  // это в строке, но в смету идёт подписанная.
  p.run('tProjects();')
  put(p, { a: 'flat-room', id: pid, rid: rid, f: 'l' }, '4090')
  t.ok('площадь не пересчиталась по размерам', p.q('projects[0].model.rooms[0].floor') === 15.93)
  t.ok('о расхождении сказано в строке', /не тот размер/.test(p.run('tProjects()')))
}

// ── 5. Смета считает по замеру ───────────────────────────────────────────────
{
  t.section('Смета не знает, откуда метры')
  const p = panel()
  create(p, 'flat')
  const pid = p.q('projects[0].id')
  p.run('tProjects();')
  put(p, { a: 'flat-head', id: pid, f: 'h' }, '2950')
  addRoom(p, pid, { name: 'Кухня', floor: '15,93', wallLen: '16,23' })

  p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};')
  const parts = p.run('projBand="parts";tProjects()')
  t.ok('позиция собралась по правилу', /Покраска стен/.test(parts))
  // 16,23 × 2,95 = 47,88 м² стен. Это то самое число, ради которого квартира и
  // заведена: периметр с чертежа, высота с обмера, ничего не пересчитано.
  t.ok('стены посчитаны по периметру и высоте', /47,88 м²/.test(parts))
}

// ── 6. Убрать помещение ──────────────────────────────────────────────────────
{
  t.section('Убранное помещение уходит целиком')
  const p = panel()
  create(p, 'flat')
  const pid = p.q('projects[0].id')
  const rid = addRoom(p, pid, { name: 'Санузел', floor: '4,84', wallLen: '9,04' })
  p.run(`projects[0].model.openings=[{id:"o1",roomId:${JSON.stringify(rid)},typeId:"t1"}];`)

  p.run('tProjects();')
  tap(p, { a: 'flat-room-del', id: pid, rid: rid })
  t.ok('помещение убрано', p.q('(projects[0].model.rooms||[]).length') === 0)
  // Проём без своей комнаты не попадёт никуда и будет молча висеть в модели.
  t.ok('и его проём вместе с ним', p.q('(projects[0].model.openings||[]).length') === 0)
}

// ── 7. Распознавание идёт квартирным читателем ───────────────────────────────
{
  t.section('Читают квартиру своим читателем')
  let sent = null
  const p = boot({
    net: async (url, init) => {
      sent = { url: String(url), body: JSON.parse((init && init.body) || '{}') }
      return {
        ok: true,
        json: async () => ({
          success: true, kind: 'flat', provider: 'Claude', model: 'claude-opus-5', warnings: [],
          plan: {
            length: 7190, width: 6410, height: 2950, partLen: 21.4, notes: '',
            rooms: [
              { name: 'Кухня', area: 15.93, perimeter: 16.23, w: 3325, l: 4790 },
              { name: 'Спальня', area: 11.79, perimeter: 15.55, w: 0, l: 0 },
            ],
            openings: [],
          },
        }),
      }
    },
  })
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [],
    specSheets: [], specSheets2: [], projects: [], buildRules: RULES,
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: {}, EST_KINDS: KINDS,
  })
  p.run('rerenderTab=function(){};')
  create(p, 'flat')
  const pid = p.q('projects[0].id')
  p.run('projects[0].plans=[{id:"f1",url:"k1",name:"plan.pdf"}];')
  p.run('projBand="plan";tProjects();')
  tap(p, { a: 'flat-read', id: pid })
  await new Promise((r) => setTimeout(r, 20))

  t.ok('запрос ушёл на чтение', sent && /\/api\/plan-read$/.test(sent.url), sent && sent.url)
  // Это и есть главное: квартиру нельзя спросить как контейнер, иначе она
  // вернётся отсеками вдоль длины, которых в ней нет.
  t.ok('и помечен как квартира', sent && sent.body.kind === 'flat', JSON.stringify(sent && sent.body))

  const panelHtml = p.run('tProjects()')
  t.ok('сверка показана', /Прочитано с планировки/.test(panelHtml))
  t.ok('габарит квартиры, а не длина дома', /Габарит квартиры/.test(panelHtml) && !/Длина дома/.test(panelHtml))
  t.ok('перегородки показаны метрами', /21,4 м\.п\./.test(panelHtml))
  t.ok('площади из экспликации видны', /15,93 м²/.test(panelHtml) && /11,79 м²/.test(panelHtml))
  t.ok('итог посчитан', /27,72 м²/.test(panelHtml))
  // Ничего не применяется молча: пока не нажали «Начертить», модель пуста.
  t.ok('пока не применено — модель пуста', p.q('(projects[0].model.rooms||[]).length') === 0)

  tap(p, { a: 'model-read-apply' })
  t.ok('применилось', p.q('(projects[0].model.rooms||[]).length') === 2)
  t.ok('площадь доехала нетронутой', p.q('projects[0].model.rooms[0].floor') === 15.93)
  t.ok('высота с обмера', p.q('projects[0].model.h') === 2950)
  t.ok('перегородки доехали', p.q('projects[0].model.partLen') === 21.4)
  t.ok('модель осталась квартирой', p.q('projects[0].model.type') === 'flat')
  t.ok('характеристики пересобрались', p.q('(projects[0].specs.rooms||[]).length') === 2)
}

t.done()
