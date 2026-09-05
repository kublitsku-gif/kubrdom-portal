#!/usr/bin/env node
// Вкладка «🏗 Проекты» — дом от чертежа до договора одной карточкой (public/admin.js).
//
// Проект — тот же лист, что спецификация, поэтому главное здесь не экран, а то,
// что весь остальной портал принял его как свой: редактор чертит его модель,
// смета считается общим модулем, объект собирается ТЕМ ЖЕ составом, что показан,
// а договор ссылается на проект. Это и сторожим.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const PRODUCTS = [
  { id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана', mode: 'm2' },
  { id: 'p_sock', name: 'Розетка', unitCost: 300, store: 'Белка', mode: 'piece' },
]
const EST = [
  { id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2, lines: [{ pid: 'p_osb', qty: 1 }] },
  { id: 'e_win', kind: 'house', name: 'Монтаж окна', stage: 2, optPoint: 'win', lines: [{ pid: 'p_sock', qty: 1 }] },
]
const RULES = [
  { id: 'r_wall', kind: 'house', estId: 'e_osb', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 0 },
]

function panel(rules) {
  const p = boot({})
  p.set({
    expProducts: PRODUCTS, estimates: EST, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
    specSheets: [], specSheets2: [], projects: [], buildRules: rules || [],
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30 },
  })
  return p
}

// Создание так, как это делает человек: имя → заготовка → «Создать».
function create(p, name) {
  p.run('tab="projects";projOpenId=null;tProjects();')
  const btn = p.dom.node({ a: 'proj-new' })
  p.run('bind();')
  btn.onclick()
  p.dom.field('proj-n-name', name || 'Дом Ивановых')
  p.dom.field('proj-n-client', 'c1')
  p.run('tProjects();')
  const go = p.dom.node({ a: 'proj-create' })
  p.run('bind();')
  go.onclick()
  // Этапы свёрнуты по умолчанию — оглавление сметы. Проверкам нужны сами строки,
  // поэтому разворачиваем все; свёрнутость сторожит своя секция.
  p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};')
}

// ── 1. Список и создание ────────────────────────────────────────────────────
{
  t.section('Проект заводится с чертежа')
  const p = panel()
  const empty = p.run('tab="projects";tProjects()')
  t.ok('пустой список объясняет, с чего начать', /Проектов пока нет/.test(empty))
  t.ok('и предлагает завести', empty.indexOf('data-a="proj-new"') >= 0)

  create(p)
  t.ok('проект появился', p.q('projects.length') === 1)
  // В проект заходят к смете: она первая полоса и открывается сразу.
  t.ok('открывается «Состав»', p.q('projBand') === 'parts')
  t.ok('и открылся', p.q('projOpenId') === p.q('projects[0].id'))
  t.ok('имя своё', p.q('projects[0].name') === 'Дом Ивановых')
  t.ok('клиент привязан', p.q('projects[0].clientId') === 'c1')
  t.ok('модель есть', p.q('(projects[0].model.rooms||[]).length') >= 3)
  // Пирог материализуется сразу: план идёт за ним, и «просто число» разъедется с узлами.
  t.ok('пирог перегородки задан', p.q('(projects[0].model.layers||[]).length') > 0)
  t.ok('пирог наружной стены тоже', p.q('(projects[0].model.skin||[]).length') > 0)
  t.ok('характеристики синхронизированы с моделью', p.q('(projects[0].specs.rooms||[]).length') >= 3)
  t.ok('изделия заготовки заведены в справочник', p.q('winTypes.length') > 0)
}

// ── 2. Четыре полосы ────────────────────────────────────────────────────────
{
  t.section('Одна карточка — четыре полосы')
  const p = panel(RULES)
  create(p)
  const plan = p.run('projBand="plan";tProjects()')
  t.ok('чертёж рисуется', plan.indexOf('<svg') >= 0 && plan.indexOf('sch-hatch') >= 0)
  t.ok('площади рядом', /ПЛОЩАДИ/.test(plan))
  t.ok('и печать для бригады', plan.indexOf('data-a="spec2-print"') >= 0)
  t.ok('редактор открывается отсюда', plan.indexOf('data-a="proj-edit"') >= 0)

  const parts = p.run('projBand="parts";tProjects()')
  t.ok('состав посчитан', /СЕБЕСТОИМОСТЬ/.test(parts) && /ОСП/.test(parts))
  t.ok('откуда число — сказано', /стены [\d,]+ м²/.test(parts))
  // Кнопки действий живут на «Деньгах»: две одинаковые в соседних полосах
  // читаются как два разных действия.
  t.ok('объект отсюда не заводится', parts.indexOf('data-a="spec-to-object"') < 0)
  const bands = p.run('tProjects()')
  t.ok('и «Состав» стоит первой полосой',
    bands.indexOf('data-v="parts"') < bands.indexOf('data-v="plan"'),
    'parts@' + bands.indexOf('data-v="parts"') + ' plan@' + bands.indexOf('data-v="plan"'))

  const money = p.run('projBand="money";tProjects()')
  t.ok('деньги показаны', /СЕБЕСТОИМОСТЬ/.test(money) && /КЛИЕНТУ/.test(money))
  t.ok('наценка правится', money.indexOf('data-a="proj-markup"') >= 0)
  t.ok('объект и договор — отсюда',
    money.indexOf('data-a="spec-to-object"') >= 0 && money.indexOf('data-a="spec-to-contract"') >= 0)

  const build = p.run('projBand="build";tProjects()')
  t.ok('стройки пока нет, и сказано где её завести', /Объекта по этому проекту ещё нет/.test(build))
}

// ── 3. Правила работают и в проекте ─────────────────────────────────────────
{
  t.section('Смета проекта считается правилами')
  const withRules = panel(RULES)
  create(withRules)
  const nWith = withRules.q('works2(projects[0], specCtx(projects[0])).positions.length')
  const without = panel([])
  create(without)
  const nWithout = without.q('works2(projects[0], specCtx(projects[0])).positions.length')
  t.ok('правило добавило строки', nWith > nWithout, nWith + ' против ' + nWithout)
  t.ok('и это строки по помещениям',
    withRules.q('works2(projects[0], specCtx(projects[0])).positions.filter(function(x){return x.from==="rule";}).length') >= 3)
}

// ── 4. Объект и договор из проекта ──────────────────────────────────────────
{
  t.section('Объект и договор')
  const p = panel(RULES)
  create(p)
  const id = p.q('projects[0].id')
  const shown = p.q('works2(projects[0], specCtx(projects[0])).positions.length')

  p.run('projBand="money";tProjects();')
  const toObj = p.dom.node({ a: 'spec-to-object', id: id })
  p.run('bind();')
  toObj.onclick()
  t.ok('объект создан', p.q('objects.length') === 1)
  t.ok('проект его помнит', p.q('projects[0].objId') === p.q('objects[0].id'))
  t.ok('шаблон не участвовал', p.q('objects[0].templateId') === '')
  t.ok('объект ссылается на проект', p.q('objects[0].specId') === id)
  const nWorks = p.q('objects[0].stages.reduce(function(a,s){return a+s.works.length;},0)')
  t.ok('в объекте столько же работ, сколько в смете', nWorks === shown, 'объект ' + nWorks + ', смета ' + shown)
  t.ok('характеристики уехали в объект', p.q('(objects[0].specs.rooms||[]).length') >= 3)

  const toCt = p.dom.node({ a: 'spec-to-contract', id: id })
  p.run('bind();')
  toCt.onclick()
  t.ok('договор заведён', p.q('contractDocs.length') === 1)
  t.ok('на сумму проекта', p.q('contractDocs[0].amount') === p.q('specTot(projects[0]).price'))
  t.ok('и помнит, из чего собрана', p.q('contractDocs[0].specId') === id)
  t.ok('стройка привязана к договору', p.q('contractDocs[0].objId') === p.q('objects[0].id'))

  const build = p.run('projBand="build";tProjects()')
  t.ok('полоса стройки показывает этапы', /ОБЪЕКТ/.test(build) && build.indexOf('data-a="proj-open-obj"') >= 0)

  // Удаление проекта — это удаление проекта, а не стройки и не денег.
  const del = p.dom.node({ a: 'proj-del', id: id })
  p.run('projBand="money";tProjects();bind();')
  del.onclick()
  t.ok('проект удалён', p.q('projects.length') === 0)
  t.ok('объект остался', p.q('objects.length') === 1)
  t.ok('договор остался', p.q('contractDocs.length') === 1)
}

// ── 5. Чужие разделы не задеты ──────────────────────────────────────────────
{
  t.section('Старая цепочка на месте')
  const p = panel(RULES)
  create(p)
  p.run('specSheets=[{id:"war",name:"Боевая",kind:"house",markup:30,specs:{height:2.5,rooms:[{id:"r1",name:"Зал",w:3,l:4,wallLen:14,pts:{}}]},rooms:{},global:{},qty:{}}];')
  t.ok('боевая спецификация правил не видит', p.q('specCtx(specSheet("war")).rules.length') === 0)
  t.ok('а проект видит', p.q('specCtx(projects[0]).rules.length') === 1)
  t.ok('лист проекта находится по id', p.q('!!specSheet(projects[0].id)') === true)
  // Редактор чертит проект как свой: окна и двери врозь — как в опытном разделе.
  t.ok('редактор считает проект опытным листом', p.q('modelLab(projects[0])') === true)
  t.ok('а боевую спецификацию — нет', p.q('modelLab(specSheet("war"))') === false)
  t.ok('вкладка спецификации от проектов не изменилась', p.run('tab="spec";tSpec()').indexOf('data-a="proj-') < 0)
}

// ── 6. Смета проекта правится там же, где показана ──────────────────────────
// Всё, что умеет опытный раздел, обязано работать и здесь: иначе «проект» это
// красивый экран, а работают всё равно в другом месте.
{
  t.section('Правки состава внутри проекта')
  const EST2 = EST.concat([
    { id: 'e_p3', kind: 'house', name: 'Утепление — ППУ 3 см', stage: 1, lines: [{ pid: 'p_sock', qty: 1 }] },
    { id: 'e_p5', kind: 'house', name: 'Утепление — ППУ 5 см', stage: 1, lines: [{ pid: 'p_sock', qty: 2 }] },
  ])
  const p = boot({})
  p.set({
    expProducts: PRODUCTS.concat([{ id: 'p_alt', name: 'Розетка влагозащищённая', unitCost: 500, store: 'Белка', mode: 'piece' }]),
    estimates: EST2, dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }],
    specSheets: [], specSheets2: [], projects: [], buildRules: [],
    winTypes: [], objects: [], templates: [], contractDocs: [], purchases: [], issues: [],
    users: [], stock: [], settings: { specMarkup: 30 },
  })
  create(p)
  const parts = p.run('projBand="parts";tProjects()')
  // Список читают РАБОТАМИ: двадцать строк сметы, развернувших по шесть
  // материалов, не дают увидеть сам состав дома. Материалы — за одну строку.
  t.ok('материалы свёрнуты', parts.indexOf('data-a="est-mats-open"') >= 0 &&
    parts.indexOf('data-a="est-mat-open"') < 0)
  // В каждой строке две цифры: сколько тут материалов и сколько работы. Одна
  // сумма отвечала «сколько стоит», но не на те два вопроса, которые задают:
  // сколько закупать и сколько платить бригаде.
  t.ok('в строке видно материалы, работу и итог',
    /материалы <\/span><span[^>]*>[\d\s\u00a0]+ ₽<\/span><span[^>]*> · работа /.test(parts), 'нет раскладки')
  const matsKey = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: matsKey }); p.run('bind();'); openMats.onclick()
  const parts2 = p.run('tProjects()')
  t.ok('разворачиваются по тапу', parts2.indexOf('data-a="est-mat-open"') >= 0)
  t.ok('количество правится руками', parts2.indexOf('data-a="est-mat-qty"') >= 0)
  t.ok('чип «откуда число» тапается', parts.indexOf('data-a="est-why"') >= 0)
  t.ok('правила раскрываются тут же', parts.indexOf('data-a="proj-rules"') >= 0)
  t.ok('но по умолчанию свёрнуты', parts.indexOf('data-a="rule-add"') < 0)

  const open = p.dom.node({ a: 'proj-rules' }); p.run('bind();'); open.onclick()
  const withRules = p.run('tProjects()')
  t.ok('раскрылись', /ПРАВИЛА СБОРКИ/.test(withRules) && withRules.indexOf('data-a="rule-add"') >= 0)
  const add = p.dom.node({ a: 'rule-add' }); p.run('bind();'); add.onclick()
  t.ok('правило заводится из проекта', p.q('buildRules.length') === 1)
  t.ok('и вида проекта', p.q('buildRules[0].kind') === 'house')

  // Замена материала внутри проекта.
  const key = p.q('works2(projects[0], specCtx(projects[0])).positions.filter(function(x){return x.estId==="e_p3";})[0].key') + '|p_sock'
  const chip = p.dom.node({ a: 'est-mat-open', k: key }); p.run('bind();'); chip.onclick()
  p.dom.field('msw-input', 'Розетка влагозащищённая')
  const go = p.dom.node({ a: 'est-mat-do', k: key }); p.run('bind();'); go.onclick()
  t.ok('замена записалась в проект', p.q('Object.keys(projects[0].mats||{}).length') === 1)

  // Варианты — переключателем, как в опытном разделе.
  p.run('estWhyOpen="e_p5";tProjects();')
  const auto = p.dom.node({ a: 'est-opt-auto', e: 'e_p5', g: 'Утепление' }); p.run('bind();'); auto.onclick()
  t.ok('группа собрана в проекте', p.q('Object.keys(projects[0].optOf||{}).length') === 2)
  t.ok('в доме один вариант',
    p.q('works2(projects[0], specCtx(projects[0])).positions.filter(function(x){return /ППУ/.test(x.name);}).length') === 1)
  const chips = p.run('estWhyOpen="";tProjects()')
  t.ok('и переключатель на месте', (chips.match(/data-a="est-opt-pick"/g) || []).length === 2)

  // Всё это уезжает в объект тем же составом.
  const shown = p.q('works2(projects[0], specCtx(projects[0])).positions.length')
  const nWorks = p.q('specBuildStages(projects[0]).reduce(function(a,s){return a+s.works.length;},0)')
  t.ok('объект собран тем же списком', nWorks === shown, 'объект ' + nWorks + ', смета ' + shown)
}

// ── 7. Приложили чертёж — портал его читает ─────────────────────────────────
// Человек выбрал файл: ждать от него ещё одного тапа по кнопке, спрятанной в
// панели редактора, — это ровно тот случай, когда «портал ничего не сделал».
{
  t.section('Чертёж заказчика читается сразу')
  const p = panel()
  create(p)
  const pid = p.q('projects[0].id')
  p.run('window.__read="";modelPlanRecognize=function(sh){ window.__read=sh.id; };')

  // Файла нет — читать нечего, редактор сам не открывается.
  t.ok('без чертежа чтение не запускается', p.run('projStartRead(' + JSON.stringify(pid) + ')') === false)
  t.ok('и редактор закрыт', p.q('modelFull') !== true)

  // Лист приложен — открываем редактор и читаем.
  p.run('projects[0].plans=[{name:"plan.png",url:"u1",pdf:false}];projects[0].plan=projects[0].plans[0];')
  t.ok('с чертежом чтение запускается', p.run('projStartRead(' + JSON.stringify(pid) + ')') === true)
  t.ok('редактор открыт на этом проекте', p.q('modelFull') === true && p.q('specOpenId') === pid)
  t.ok('и чтение ушло по этому листу', p.q('window.__read') === pid)
  t.ok('инструмент — «двигать», а не рисование', p.q('modelTool') === 'sel')

  // Форма говорит, что будет дальше: иначе человек ждёт чтения, а видит заготовку.
  p.run('modelFull=false;projOpenId=null;projNew={name:"",preset:MODEL_PRESETS[0].k,clientId:""};')
  const form = p.run('tab="projects";tProjects()')
  t.ok('форма обещает чтение', /прочитает чертёж сразу после создания/.test(form))
  t.ok('и объясняет роль заготовки', /заготовка останется запасным вариантом/.test(form))
}

// ── Работу можно убрать из ЭТОГО дома ────────────────────────────────────────
// Смета справочника описывает типовой дом, а в конкретном бывает лишняя строка:
// контейнер уже стоит на участке, электрику ведёт заказчик. Править ради этого
// справочник нельзя — он общий на все дома, — поэтому строка выключается в листе.
{
  t.section('Убрать работу')
  const p = panel(RULES)
  create(p, 'Дом с лишней работой')
  p.run('projBand="parts";')
  const before = p.run('tProjects()')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const cost0 = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost')
  t.ok('у работы есть крестик', before.indexOf('data-a="est-pos-del"') >= 0)

  const del = p.dom.node({ a: 'est-pos-del', k: key })
  p.run('bind();'); del.onclick()
  const after = p.run('tProjects()')
  const cost1 = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost')
  t.ok('строка ушла из сметы',
    p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';}).length') === 0)
  t.ok('и деньги пересчитались', cost1 < cost0, cost0 + ' → ' + cost1)
  // Молча выкинуть работу из сметы — это молча выкинуть её из стройки: убранное
  // остаётся на виду, с ценой и кнопкой «вернуть».
  // Шапка «убрано» видна всегда — со счётом и суммой; сам перечень свёрнут,
  // потому что экран открывают ради сметы, а не ради убранного.
  t.ok('убранное показано отдельно', /УБРАНО ИЗ ЭТОГО ДОМА/.test(after))
  t.ok('перечень свёрнут', after.indexOf('data-a="est-pos-back"') < 0)
  const dropHead = p.dom.node({ a: 'est-dropped-open' }); p.run('bind();'); dropHead.onclick()
  const openDrop = p.run('tProjects()')
  t.ok('и его можно вернуть', openDrop.indexOf('data-a="est-pos-back"') >= 0)
  // Правило и справочник — общие на все дома, их выключение не трогает.
  t.ok('справочник не тронут', p.q('estimates.length') === 2)
  t.ok('правило на месте', p.q('buildRules.length') === 1)

  const back = p.dom.node({ a: 'est-pos-back', k: key })
  p.run('bind();'); back.onclick()
  t.ok('вернулась на место',
    p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';}).length') === 1)
  t.ok('и деньги вернулись',
    p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost') === cost0)
  t.ok('отметка из листа стёрта', !p.q('projects[0].posOff'))

  // Состав объекта собирается ТЕМ ЖЕ списком: убранная работа не должна уехать
  // на стройку — иначе на экране одна смета, а в объекте другая.
  del.onclick()
  const inObj = p.q('allPositions(projects[0], specCtx(projects[0])).map(function(x){return x.key;})')
  t.ok('в состав дома убранная работа не попадает', inObj.indexOf(key) < 0, JSON.stringify(inObj))
}

// ── Работу можно дописать в ЭТОТ дом ─────────────────────────────────────────
// Справочник описывает типовой дом, а в этом бывает то, чего в нём нет вовсе:
// вывоз мусора, сборка мебели заказчика. Править справочник ради одного дома
// нельзя — он общий, — поэтому работа дописывается в лист.
{
  t.section('Дописать работу')
  const p = panel()
  create(p, 'Дом с дописанной работой')
  p.run('projBand="parts";')
  const cost0 = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost')
  t.ok('кнопка «+ работа» есть', p.run('tProjects()').indexOf('data-a="est-pos-add-open"') >= 0)

  const open = p.dom.node({ a: 'est-pos-add-open', k: p.q('projects[0].id') })
  p.run('bind();'); open.onclick()
  t.ok('форма открылась', p.run('tProjects()').indexOf('data-a="est-pos-add-do"') >= 0)

  // Своя строка: имени в справочнике нет, зато есть сумма.
  p.dom.field('pad-n', 'Вывоз мусора'); p.dom.field('pad-cost', '9000'); p.dom.field('pad-stage', '1')
  const go = p.dom.node({ a: 'est-pos-add-do', k: p.q('projects[0].id') })
  p.run('bind();'); go.onclick()
  const own = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.name==="Вывоз мусора";})')
  t.ok('своя работа появилась', own.length === 1, JSON.stringify(own.map((x) => x.name)))
  t.ok('с её суммой', own[0] && own[0].cost === 9000, own[0] && String(own[0].cost))
  t.ok('и на своём этапе', own[0] && own[0].stage === 1, own[0] && String(own[0].stage))
  t.ok('деньги выросли ровно на неё',
    p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost') === cost0 + 9000)
  t.ok('справочник не тронут', p.q('estimates.length') === 2)
  t.ok('на экране помечена дописанной', /дописана/.test(p.run('tProjects()')))

  // Имя из справочника — строка берётся целиком, со своими материалами и ценой.
  const open2 = p.dom.node({ a: 'est-pos-add-open', k: p.q('projects[0].id') })
  p.run('bind();'); open2.onclick()
  p.dom.field('pad-n', 'Обшивка стен ОСП'); p.dom.field('pad-cost', '')
  const go2 = p.dom.node({ a: 'est-pos-add-do', k: p.q('projects[0].id') })
  p.run('bind();'); go2.onclick()
  const fromCat = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key.indexOf("add:")===0&&x.estId==="e_osb";})')
  t.ok('работа из справочника добавилась', fromCat.length === 1)
  t.ok('и пришла со своими материалами', fromCat[0] && (fromCat[0].mats || []).length > 0,
    JSON.stringify(fromCat[0] && fromCat[0].mats))

  // Дописанную удаляем насовсем: «убрано» — это про строки справочника.
  const key = 'add:' + p.q('projects[0].posAdd[0].id')
  const del = p.dom.node({ a: 'est-pos-del', k: key })
  p.run('bind();'); del.onclick()
  t.ok('дописанная удаляется совсем', p.q('(projects[0].posAdd||[]).length') === 1)
  t.ok('и в «убрано» не попадает', !p.q('projects[0].posOff'))
  t.ok('деньги вернулись к прежним + каталожная',
    p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost') > cost0)
}

// ── Работу можно переставить в другой этап ───────────────────────────────────
// По этапам идут сроки, приёмка и транши. Этап — свойство СТРОЙКИ, а не
// справочника: контейнер обычно ставят на подготовительном, но на участок с
// готовым фундаментом его привозят первым днём. Правило общее на все дома,
// поэтому перестановка живёт в листе.
{
  t.section('Переставить этап')
  const p = panel()
  create(p, 'Дом с перестановкой')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const was = p.q('allPositions(projects[0], specCtx(projects[0]))[0].stage')
  t.ok('у работы есть выбор этапа', p.run('tProjects()').indexOf('data-a="est-pos-stage"') >= 0)

  const sel = p.dom.node({ a: 'est-pos-stage', k: key })
  sel.value = '1'
  p.run('bind();'); sel.onchange()
  const now = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  t.ok('этап сменился', now.stage === 1, was + ' → ' + now.stage)
  t.ok('и помечен как заданный руками', now.stageSet === true)
  // Работа уезжает в новый этап целиком: смета читается по этапам, и по ним же
  // идут приёмка и транши.
  const stages = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.map(function(s){return [s.n, s.positions.map(function(x){return x.key;})];})')
  const inStage1 = (stages.find((s) => s[0] === 1) || [0, []])[1]
  t.ok('в смете он в первом этапе', inStage1.indexOf(key) >= 0, JSON.stringify(stages))
  t.ok('деньги этапов сошлись',
    p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.reduce(function(a,s){return a+s.cost;},0)') ===
    p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost'))
  // Справочник и правило общие на все дома — их перестановка не трогает.
  t.ok('справочник не тронут', p.q('estimates.filter(function(e){return e.id==="e_osb";})[0].stage') === 2)

  const back = p.dom.node({ a: 'est-pos-stage-reset', k: key })
  p.run('bind();'); back.onclick()
  t.ok('этап возвращается к справочному',
    p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].stage') === was)
  t.ok('и отметка из листа стёрта', !p.q('projects[0].posStage'))
}

// ── Порядок работ внутри этапа ───────────────────────────────────────────────
// Смета считается сама, и порядок в ней — порядок расчёта, а не стройки. Бригаде
// важно, что сначала обрешётка, потом обшивка; читать смету, перепрыгивая
// глазами, — верный способ пропустить работу.
{
  t.section('Порядок внутри этапа')
  const p = panel()
  create(p, 'Дом с порядком')
  p.run('projBand="parts";')
  // Две работы в одном этапе: обе из справочника, обе на втором.
  const stageKeys = () => p.q('(works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.filter(function(s){return s.n===2;})[0]||{positions:[]}).positions.map(function(x){return x.key;})')
  const before = stageKeys()
  t.ok('в этапе две работы', before.length === 2, JSON.stringify(before))
  const idle = p.run('tProjects()')
  t.ok('работу можно взять', idle.indexOf('data-a="est-pos-grab"') >= 0)
  t.ok('пока не взяли — мест «сюда» нет', idle.indexOf('data-a="est-pos-drop"') < 0)

  // Взял — указал место: место во всю ширину строки, а не стрелка в 20 пикселей.
  const grab = p.dom.node({ a: 'est-pos-grab', k: before[0] })
  p.run('bind();'); grab.onclick()
  const held = p.run('tProjects()')
  t.ok('места появились', held.indexOf('data-a="est-pos-drop"') >= 0)
  t.ok('и видно, какую строку несём', /ПЕРЕНОШУ/.test(held))
  t.ok('взятая строка мест вокруг себя не показывает',
    (held.match(/data-a="est-pos-drop"/g) || []).length === 1, String((held.match(/data-a="est-pos-drop"/g) || []).length))
  t.ok('пока ничего не переставилось', stageKeys().join(',') === before.join(','))

  const slot = p.dom.node({ a: 'est-pos-drop', k: before[0], i: '2' })
  p.run('bind();'); slot.onclick()
  const after = stageKeys()
  t.ok('работа встала на указанное место', after.join(',') === before.slice().reverse().join(','),
    before.join(',') + ' → ' + after.join(','))
  t.ok('и строку отпустили', p.q('estMoveKey') === '')
  // Порядок хранится в листе — справочник общий на все дома.
  t.ok('порядок записан в лист', !!p.q('projects[0].posOrder'))
  t.ok('справочник не тронут', p.q('estimates.length') === 2)

  const grab2 = p.dom.node({ a: 'est-pos-grab', k: before[0] })
  p.run('bind();'); grab2.onclick()
  const slot2 = p.dom.node({ a: 'est-pos-drop', k: before[0], i: '0' })
  p.run('bind();'); slot2.onclick()
  t.ok('и возвращается обратно', stageKeys().join(',') === before.join(','), stageKeys().join(','))

  // Далеко строку несут местом «сюда», а на соседнюю позицию быстрее тапнуть
  // стрелкой — и строка остаётся взятой, потому что шагов обычно несколько.
  t.ok('до взятия стрелок нет', p.run('tProjects()').indexOf('data-a="est-pos-step"') < 0)
  const grabS = p.dom.node({ a: 'est-pos-grab', k: before[0] })
  p.run('bind();'); grabS.onclick()
  const withSteps = p.run('tProjects()')
  t.ok('у взятой строки две стрелки', (withSteps.match(/data-a="est-pos-step"/g) || []).length === 2)
  t.ok('вверх у первой строки отключена', /data-a="est-pos-step" data-k="[^"]*" data-d="-1" disabled/.test(withSteps))
  const step = p.dom.node({ a: 'est-pos-step', k: before[0], d: '1' })
  p.run('bind();'); step.onclick()
  t.ok('шаг вниз переставил строку', stageKeys().join(',') === before.slice().reverse().join(','),
    stageKeys().join(','))
  t.ok('и строка осталась взятой', p.q('estMoveKey') === before[0])
  const stepUp = p.dom.node({ a: 'est-pos-step', k: before[0], d: '-1' })
  p.run('bind();'); stepUp.onclick()
  t.ok('шаг вверх вернул на место', stageKeys().join(',') === before.join(','))
  const cancel = p.dom.node({ a: 'est-pos-grab', k: before[0] })
  p.run('bind();'); cancel.onclick()

  // Передумал — тот же тап кладёт строку обратно, а не оставляет экран в режиме переноса.
  const grab3 = p.dom.node({ a: 'est-pos-grab', k: before[0] })
  p.run('bind();'); grab3.onclick()
  t.ok('строка взята', p.q('estMoveKey') === before[0])
  p.run('bind();'); grab3.onclick()
  t.ok('повторный тап отменяет перенос', p.q('estMoveKey') === '')
  t.ok('и порядок не поехал', stageKeys().join(',') === before.join(','))

  // Ключ позиции у листов общий, поэтому взятая строка помнит и свой лист:
  // иначе в соседнем проекте подсвечивалась бы его тёзка.
  const grab4 = p.dom.node({ a: 'est-pos-grab', k: before[0] })
  p.run('bind();'); grab4.onclick()
  t.ok('строка помнит свой лист', p.q('estMoveSheet') === p.q('projects[0].id'))
  create(p, 'Соседний дом')
  p.run('projBand="parts";')
  t.ok('в соседнем проекте ничего не взято', !/ПЕРЕНОШУ/.test(p.run('tProjects()')))

  // Этапы местами не меняются: по ним идут сроки и приёмка, а перестановка —
  // только внутри своего этапа.
  const stages = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.map(function(s){return s.n;})')
  t.ok('этапы на своих местах', stages.join(',') === stages.slice().sort(function(a,b){return a-b;}).join(','),
    stages.join(','))
  t.ok('деньги не изменились',
    p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost') ===
    p.q('allPositions(projects[0], specCtx(projects[0])).reduce(function(a,x){return a+x.cost;},0)'))
}

// ── Цену работы можно назначить руками ───────────────────────────────────────
// Смета считает цену материалами — это честно, пока работу делают своими руками
// из своего материала. Но бригаде платят ЗА РАБОТУ, и эта цифра к сумме кабелей
// отношения не имеет: разводка стоит своё, кабель с гофрой — своё, и в строке
// должно быть и то, и другое. Отдельный случай — подряд под ключ: там цена и
// есть цифра из договора, а материалы в неё уже входят.
{
  t.section('Цена работы')
  const p = panel()
  create(p, 'Дом с подрядом')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const was = p.q('allPositions(projects[0], specCtx(projects[0]))[0].cost')
  const total0 = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost')
  t.ok('цена правится в строке', p.run('tProjects()').indexOf('data-a="est-pos-cost"') >= 0)

  const inp = p.dom.node({ a: 'est-pos-cost', k: key })
  inp.value = '25000'
  p.run('bind();'); inp.onchange()
  const now = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  // Новая цена — это оплата бригаде: материалы считаются сверху, а не вместо.
  t.ok('цена — оплата работы', now.labor === 25000 && now.costMode === 'labor')
  t.ok('материалы прибавились к ней', now.cost === was + 25000, was + ' → ' + now.cost)
  t.ok('и помечена как назначенная', now.costSet === true)
  t.ok('итог дома пересчитался',
    p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost') === total0 + 25000)
  // Материалы остаются: по ним закупаются, и в цене строки они тоже есть.
  t.ok('материалы никуда не делись', (now.mats || []).length > 0)
  t.ok('справочник не тронут', p.q('estimates.length') === 2)
  t.ok('в строке видно обе половины', /работа <\/span><span[^>]*>25[\s\u00a0]000 ₽/.test(p.run('tProjects()')))

  // В стройку уходит и цена, и её половина: объект пересчитывает себя по `labor`.
  const work = p.q('positionWork(allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0])')
  t.ok('в объект уходит назначенная цена', work.cost === was + 25000, String(work.cost))
  t.ok('и оплата работы отдельно', work.labor === 25000)
  // Объект пересчитывает свои цены при каждой загрузке — и обязан сохранить
  // договорённость с бригадой, а не обнулить её до суммы кабелей.
  p.run('objects=[{id:"o1",name:"Дом",stages:[{id:"s1",n:"ЭТАП",works:[' +
    '{id:"w1",n:"Разводка",labor:25000,cost:0,mats:[{id:"m1",n:"Кабель",cost:800,qty:10}]},' +
    '{id:"w2",n:"Электрика под ключ",costAll:true,cost:25000,mats:[{id:"m2",n:"Кабель",cost:800,qty:10}]}' +
    ']}]}];normalizeWorkCosts();')
  t.ok('оплата работы пережила загрузку', p.q('objects[0].stages[0].works[0].labor') === 25000)
  t.ok('и цена стала «материалы + работа»', p.q('objects[0].stages[0].works[0].cost') === 8000 + 25000)
  t.ok('цена под ключ не тронута', p.q('objects[0].stages[0].works[1].cost') === 25000)
  p.run('objects=[];')

  // Подряд под ключ — второй смысл того же числа, переключается чипом.
  const chip = p.dom.node({ a: 'est-pos-cost-mode', k: key })
  p.run('bind();'); chip.onclick()
  const all = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  t.ok('под ключ — цена как введена', all.cost === 25000 && all.costMode === 'all', String(all.cost))
  t.ok('и оплаты работы в ней нет', !all.labor)
  t.ok('материалы при этом остались', (all.mats || []).length > 0)
  p.run('bind();'); chip.onclick()
  t.ok('чип возвращает обратно',
    p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].cost') === was + 25000)

  const back = p.dom.node({ a: 'est-pos-cost-reset', k: key })
  p.run('bind();'); back.onclick()
  t.ok('цена возвращается к материалам',
    p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].cost') === was)
  t.ok('и отметка из листа стёрта', !p.q('projects[0].posCost') && !p.q('projects[0].posCostMode'))
}

// ── Этап сворачивается целиком ───────────────────────────────────────────────
// В смете на сорок строк искать нужный этап, прокручивая чужие работы, — то же
// самое, что искать его в простыне. Шапка с итогом остаётся всегда: по этим
// суммам идут транши и приёмка.
{
  t.section('Свернуть этап')
  const p = panel()
  create(p, 'Дом со свёрнутым этапом')
  p.run('projBand="parts";')
  // Смета открывается ОГЛАВЛЕНИЕМ: этапы с суммами, работы — по тапу. Сорок строк
  // сразу читаются как простыня, и нужный этап в ней ищут прокруткой.
  p.run('stageOpen={};')
  const start = p.run('tProjects()')
  t.ok('по умолчанию этапы свёрнуты', !/Монтаж окна/.test(start))
  t.ok('но итоги этапов видны', /Этап 2/.test(start) && /data-a="est-stage-open"/.test(start))

  const head = p.dom.node({ a: 'est-stage-open', n: '2' })
  p.run('bind();'); head.onclick()
  const open = p.run('tProjects()')
  t.ok('шапка этапа тапается', open.indexOf('data-a="est-stage-open"') >= 0)
  t.ok('работы видны', /Монтаж окна/.test(open))

  p.run('bind();'); head.onclick()
  const shut = p.run('tProjects()')
  t.ok('работы спрятались', !/Монтаж окна/.test(shut))
  t.ok('но итог этапа на месте', /Этап 2/.test(shut) && /600 ₽/.test(shut))
  t.ok('и видно, сколько работ внутри', /· 2 работы|· 1 работа|· \d+ работ/.test(shut), 'нет счётчика')
  // Свёрнутый этап — это про экран, а не про смету: деньги не меняются.
  t.ok('деньги не изменились',
    p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).cost') ===
    p.q('allPositions(projects[0], specCtx(projects[0])).reduce(function(a,x){return a+x.cost;},0)'))
  t.ok('в листе ничего не записалось', !p.q('projects[0].stageOpen'))

  p.run('bind();'); head.onclick()
  t.ok('разворачивается обратно', /Монтаж окна/.test(p.run('tProjects()')))
}

// ── Материал в смете — ссылка на товар ───────────────────────────────────────
// По ней снабженец идёт покупать. «Озон» без ссылки означает, что тот же товар
// он будет искать в магазине руками заново — при том, что ссылка у нас есть.
{
  t.section('Ссылка на товар')
  const p = boot({})
  p.set({
    expProducts: [{ id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана', mode: 'm2',
      url: 'https://lemanapro.ru/product/osp-9/' },
      { id: 'p_nail', name: 'Гвозди', unitCost: 300, store: 'Белка', mode: 'piece' }],
    estimates: [{ id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2,
      lines: [{ pid: 'p_osb', qty: 1 }, { pid: 'p_nail', qty: 1 }] }],
    dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [],
    purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
  })
  create(p, 'Дом со ссылками')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const html = p.run('tProjects()')
  t.ok('магазин со ссылкой кликабелен',
    html.indexOf('href="https://lemanapro.ru/product/osp-9/"') >= 0, 'ссылки нет в разметке')
  t.ok('и открывается в новой вкладке', /target="_blank"[^>]*>Лемана|Лемана[^<]*↗/.test(html))
  // Ссылки нет — остаётся просто именем магазина, врать нечем.
  t.ok('магазин без ссылки остался текстом', /Белка ·/.test(html), 'ожидали простой текст')
  t.ok('и ложной ссылки не появилось', (html.match(/↗/g) || []).length === 1,
    String((html.match(/↗/g) || []).length))
}

// ── Количество дописанного материала правится ────────────────────────────────
// Дописанные материалы прибавляются к строке последними, и ручное количество их
// не догоняло: число на экране менялось, а в смете оставалось прежним. Хуже
// того — правка уходила в пустой ключ и доставалась чужому материалу без товара.
{
  t.section('Количество дописанного материала')
  const p = panel()
  create(p, 'Дом с дописанным материалом')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()

  // Дописываем материал, которого нет в базе: 1 штука по 500 ₽.
  const addOpen = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); addOpen.onclick()
  p.dom.field('mad-n', 'Уголок усиленный'); p.dom.field('mad-qty', '1'); p.dom.field('mad-cost', '500')
  const addDo = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); addDo.onclick()
  const mid = p.q('projects[0].matAdd[' + JSON.stringify(key) + '][0].id')
  const cost1 = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].cost')

  // И правим количество: было 1, стало 4.
  const qty = p.dom.node({ a: 'est-mat-qty', k: key + '|' + mid })
  qty.value = '4'
  p.run('bind();'); qty.onchange()
  const pos = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  const own = (pos.mats || []).filter((m) => m.n === 'Уголок усиленный')[0]
  t.ok('количество применилось', own && own.qty === 4, JSON.stringify(own && own.qty))
  t.ok('и помечено как ручное', own && own.qtySet === true)
  t.ok('деньги строки выросли на три штуки', pos.cost === cost1 + 1500, cost1 + ' → ' + pos.cost)
  // Правка адресуется своим ключом, а не пустым: чужие материалы её не видят.
  t.ok('чужие материалы не тронуты',
    (pos.mats || []).filter((m) => m.n !== 'Уголок усиленный').every((m) => !m.qtySet),
    JSON.stringify((pos.mats || []).map((m) => [m.n, m.qty, !!m.qtySet])))

  // Заменять дописанный нечем — у него нет товара в базе; есть крестик.
  const html = p.run('tProjects()')
  t.ok('у дописанного нет «заменить»',
    html.indexOf('data-a="est-mat-open" data-k="' + key + '|' + mid + '"') < 0)
  t.ok('зато есть «убрать»', html.indexOf('data-a="est-mat-add-del"') >= 0)
}

// ── Материал убирается из строки ─────────────────────────────────────────────
// Экран сметы у проекта и у опытного раздела ОДИН, и правится он сразу в обоих:
// здесь сторожим, что правка доехала до проекта — по нему собирают объект и
// договор, и цена, показанная на «Составе», обязана быть той же.
{
  t.section('Убрать материал из строки')
  const p = panel()
  create(p, 'Дом без гофры')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const pos0 = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  const mat = (pos0.mats || [])[0]
  t.ok('в строке есть материал', !!mat && !!mat.pid, JSON.stringify(mat && mat.n))
  t.ok('и у него крестик', p.run('tProjects()').indexOf('data-a="est-mat-off"') >= 0)

  const drop = p.dom.node({ a: 'est-mat-off', k: key + '|' + mat.pid }); p.run('bind();'); drop.onclick()
  const pos1 = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  t.ok('материала в строке нет', !(pos1.mats || []).some((m) => m.pid === mat.pid))
  t.ok('и цена упала на него',
    pos1.cost === pos0.cost - Math.round((Number(mat.cost) || 0) * (Number(mat.qty) || 0)),
    pos0.cost + ' → ' + pos1.cost)
  t.ok('правка лежит в проекте', p.q('projects[0].matOff[' + JSON.stringify(key) + '].join(",")') === mat.pid)
  t.ok('справочник не тронут', p.q('estimates.length') === 2)
  t.ok('в строке видно, что убрано', /УБРАНО ИЗ ЭТОГО ДОМА/.test(p.run('tProjects()')))

  // Объект собирается тем же составом, что показан: продали одно — строят то же.
  p.run('projBand="money";tProjects();')
  const toObj = p.dom.node({ a: 'spec-to-object', id: p.q('projects[0].id') }); p.run('bind();'); toObj.onclick()
  const works = p.q('objects[0].stages.reduce(function(a,s){return a.concat(s.works||[]);},[])')
    .filter((w) => w.posKey === key)
  t.ok('работа на стройке есть', works.length === 1, 'работ: ' + works.length)
  t.ok('на стройку убранное не уехало', !(works[0].mats || []).some((m) => m.pid === mat.pid))

  // Возвращается тем же тапом.
  p.run('projBand="parts";tProjects();')
  const back = p.dom.node({ a: 'est-mat-on', k: key + '|' + mat.pid }); p.run('bind();'); back.onclick()
  const pos2 = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  t.ok('материал вернулся', (pos2.mats || []).some((m) => m.pid === mat.pid))
  t.ok('и цена прежняя', pos2.cost === pos0.cost, String(pos2.cost))
  t.ok('лист чист', !p.q('projects[0].matOff'))
}

// ── Работы этапа блоками по помещениям ───────────────────────────────────────
// «Стены санузел, стены зал, стены спальня, пол санузел…» — это перечисление
// поверхностей. Бригада работает комнатой, и этап обязан читаться комнатами.
{
  t.section('Блоки по помещениям')
  const p = panel([
    { id: 'r_wall', kind: 'house', estId: 'e_osb', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 3 },
    { id: 'r_flr', kind: 'house', estId: 'e_win', what: 'surface', k: 'floor', scope: 'room', qty: 1, stage: 3 },
  ])
  create(p, 'Дом комнатами')
  p.run('projBand="parts";')
  const st = () => p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.filter(function(s){return s.n===3;})[0]')
  const blocks = st().blocks
  t.ok('блоков столько же, сколько комнат', blocks.length >= 2, 'блоков: ' + blocks.length)
  t.ok('у блока есть имя комнаты', !!blocks[0].room, JSON.stringify(blocks[0].room))
  t.ok('и в нём разные работы', blocks[0].positions.length === 2, String(blocks[0].positions.length))
  t.ok('сумма блоков равна сумме этапа',
    blocks.reduce((a, b) => a + b.cost, 0) === Math.round(st().cost))

  const html = p.run('tProjects()')
  t.ok('заголовки блоков нарисованы', (html.match(/data-a="est-block-open"/g) || []).length === blocks.length)
  t.ok('комната названа', html.indexOf(blocks[0].room.toUpperCase()) >= 0 || html.indexOf(blocks[0].room) >= 0)

  // Блок сворачивается: смотришь спальню — санузел не мешает.
  const head = p.dom.node({ a: 'est-block-open', b: '3|' + blocks[0].key })
  p.run('bind();'); head.onclick()
  const shut = p.run('tProjects()')
  t.ok('работы блока спрятались',
    (shut.match(/data-a="est-pos-del"/g) || []).length === (html.match(/data-a="est-pos-del"/g) || []).length - 2)
  t.ok('а итог блока остался', shut.indexOf(Math.round(blocks[0].cost).toLocaleString('ru-RU')) >= 0)
  t.ok('деньги не изменились', Math.round(st().cost) === blocks.reduce((a, b) => a + b.cost, 0))
  p.run('bind();'); head.onclick()

  // Объект собирается ТЕМ ЖЕ порядком: показали комнатами — строят комнатами.
  p.run('projBand="money";tProjects();')
  const toObj = p.dom.node({ a: 'spec-to-object', id: p.q('projects[0].id') }); p.run('bind();'); toObj.onclick()
  const built = p.q('objects[0].stages.reduce(function(a,s){return a.concat(s.works||[]);},[])')
    .filter((w) => (w.posKey || '').indexOf('rule:') === 0)
  const order = st().positions.map((x) => x.key).filter((k) => k.indexOf('rule:') === 0)
  t.ok('на стройке тот же порядок',
    built.map((w) => w.posKey).join(',') === order.join(','),
    built.map((w) => w.n).join(' | '))
}

// ── Блоки правятся руками ────────────────────────────────────────────────────
// Расчёт знает комнату только там, где по ней считал: восемнадцать обязательных
// работ висят в «общем по дому», а делают их в санузле и в зале. Значит имя
// помещения, состав блока и переносы между блоками должны править руками.
{
  t.section('Правка блоков помещений')
  const p = panel([
    { id: 'r_wall', kind: 'house', estId: 'e_osb', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 3 },
  ])
  create(p, 'Дом с блоками')
  // Обязательная работа «на весь дом» в том же этапе: именно такие и висят
  // общим списком, пока их не разложат по комнатам.
  p.run('estimates=estimates.concat([{id:"e_clean",kind:"house",name:"Уборка",stage:3,lines:[{pid:"p_sock",qty:1}]}]);')
  p.run('projBand="parts";')
  const W = () => p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes}))')
  const st = () => W().stages.filter((s) => s.n === 3)[0]
  const layout = () => st().blocks.map((b) => (b.room || 'ДОМ') + ':' + b.positions.length).join(' | ')
  t.ok('комнаты дома известны экрану', (W().rooms || []).length >= 2, JSON.stringify((W().rooms || []).length))
  const house = st().blocks.filter((b) => !b.key)[0]
  t.ok('обязательная работа висит в общем по дому', !!house && house.positions.length >= 1, layout())

  // Взял строку — появились не только места «сюда», но и комнаты.
  const key = house.positions[0].key
  const grab = p.dom.node({ a: 'est-pos-grab', k: key }); p.run('bind();'); grab.onclick()
  const held = p.run('tProjects()')
  t.ok('предложено перенести в комнату', /ПЕРЕНЕСТИ В/.test(held))
  t.ok('и комнаты перечислены', (held.match(/data-a="est-pos-room"/g) || []).length >= 3)

  const room = W().rooms[0]
  const chip = p.dom.node({ a: 'est-pos-room', k: key, r: room.id }); p.run('bind();'); chip.onclick()
  t.ok('работа переехала в комнату',
    st().blocks.filter((b) => b.key === room.id)[0].positions.some((x) => x.key === key), layout())
  t.ok('приписка лежит в листе', p.q('projects[0].posRoom[' + JSON.stringify(key) + ']') === room.id)
  t.ok('справочник не тронут', p.q('estimates.length') === 3)
  t.ok('строку отпустили', p.q('estMoveKey') === '')
  t.ok('деньги дома не изменились',
    W().cost === p.q('allPositions(projects[0], specCtx(projects[0])).reduce(function(a,x){return a+x.cost;},0)'))

  // Имя помещения правится тут же — и живёт в модели, то есть и на чертеже.
  p.run('window.prompt=function(){return "Ванная комната"};')
  const ren = p.dom.node({ a: 'est-room-name', r: room.id }); p.run('bind();'); ren.onclick()
  t.ok('блок переименован', st().blocks.some((b) => b.room === 'Ванная комната'), layout())
  t.ok('и это имя из модели', p.q('modelRooms(projects[0].model).filter(function(r){return r.id===' + JSON.stringify(room.id) + ';})[0].name') === 'Ванная комната')

  // «+» в шапке помещения кладёт работу сразу туда, куда её добавляли.
  const tag = p.q('projects[0].id') + '@3|' + room.id
  const open = p.dom.node({ a: 'est-pos-add-open', k: tag }); p.run('bind();'); open.onclick()
  t.ok('форма открылась в помещении', /ДОБАВИТЬ РАБОТУ — ВАННАЯ КОМНАТА/.test(p.run('tProjects()')))
  p.dom.field('pad-n', 'Затирка швов'); p.dom.field('pad-cost', '5000')
  const add = p.dom.node({ a: 'est-pos-add-do', k: tag }); p.run('bind();'); add.onclick()
  const inRoom = st().blocks.filter((b) => b.key === room.id)[0]
  t.ok('работа добавлена в это помещение', inRoom.positions.some((x) => x.name === 'Затирка швов'), layout())
  t.ok('и в этот этап', st().positions.some((x) => x.name === 'Затирка швов'))

  // Добавленную работу удаляют насовсем — она и появилась руками.
  const own = inRoom.positions.filter((x) => x.name === 'Затирка швов')[0]
  const del = p.dom.node({ a: 'est-pos-del', k: own.key }); p.run('bind();'); del.onclick()
  t.ok('работа удалена', !st().positions.some((x) => x.name === 'Затирка швов'))

  // «По расчёту» возвращает работу туда, где её посчитали.
  const grab2 = p.dom.node({ a: 'est-pos-grab', k: key }); p.run('bind();'); grab2.onclick()
  const undo = p.dom.node({ a: 'est-pos-room', k: key, r: '~' }); p.run('bind();'); undo.onclick()
  t.ok('работа вернулась в общее по дому',
    st().blocks.filter((b) => !b.key)[0].positions.some((x) => x.key === key), layout())
  t.ok('и лист чист', !p.q('projects[0].posRoom'), JSON.stringify(p.q('projects[0].posRoom')))
  // Удалённая руками работа не оставляет за собой ни этапа, ни комнаты: иначе они
  // лежат в снимке вечно и всплывут на следующей строке с тем же адресом.
  t.ok('от удалённой работы не осталось отметок',
    !p.q('Object.keys(projects[0].posStage||{}).filter(function(k){return k.indexOf("add:")===0;}).length'))
}

// ── Материалы переставляются тем же жестом ──────────────────────────────────
// Список читают сверху вниз и по нему закупают. Жест тот же, что у работ: взял —
// указал место, а на соседнюю строку быстрее тапнуть стрелкой.
{
  t.section('Порядок материалов в строке')
  const p = panel()
  create(p, 'Дом с материалами')
  // Строка с тремя материалами: у смет набора их по одному, а переставлять надо
  // то, что видно в списке.
  p.run('estimates=estimates.concat([{id:"e_many",kind:"house",name:"Обшивка",stage:2,' +
    'lines:[{pid:"p_osb",qty:2},{pid:"p_sock",qty:50}]}]);')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.estId==="e_many";})[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const mats = () => p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].mats.map(function(m){return m.pid||m.id;})')
  const was = mats()
  const cost0 = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].cost')
  if (was.length < 2) {
    t.ok('в строке есть что переставлять', false, 'материалов: ' + was.length)
  } else {
    const idle = p.run('tProjects()')
    t.ok('у материала есть ↕', idle.indexOf('data-a="est-mat-grab"') >= 0)
    t.ok('до взятия мест «сюда» нет', idle.indexOf('data-a="est-mat-drop"') < 0)

    const grab = p.dom.node({ a: 'est-mat-grab', k: key + '|' + was[was.length - 1] })
    p.run('bind();'); grab.onclick()
    const held = p.run('tProjects()')
    t.ok('места «сюда» раскрылись', held.indexOf('data-a="est-mat-drop"') >= 0)
    t.ok('и стрелки шага у взятого', (held.match(/data-a="est-mat-step"/g) || []).length === 2)

    const slot = p.dom.node({ a: 'est-mat-drop', k: key + '|' + was[was.length - 1], i: '0' })
    p.run('bind();'); slot.onclick()
    t.ok('материал встал первым', mats()[0] === was[was.length - 1], mats().join(','))
    t.ok('порядок записан в лист', !!p.q('projects[0].matOrder'))
    t.ok('материал отпущен', p.q('matMoveKey') === '')
    t.ok('цена строки не изменилась',
      p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].cost') === cost0)
    t.ok('справочник не тронут', p.q('estimates.length') === 3)

    // Шаг вниз — и материал остаётся взятым: шагов обычно несколько подряд.
    const g2 = p.dom.node({ a: 'est-mat-grab', k: key + '|' + was[was.length - 1] })
    p.run('bind();'); g2.onclick()
    const step = p.dom.node({ a: 'est-mat-step', k: key + '|' + was[was.length - 1], d: '1' })
    p.run('bind();'); step.onclick()
    t.ok('шаг вниз сработал', mats()[1] === was[was.length - 1], mats().join(','))
    t.ok('и материал ещё взят', p.q('matMoveKey') === key + '|' + was[was.length - 1])

    // На стройку уезжает тот же порядок, что показан.
    p.run('projBand="money";tProjects();')
    const toObj = p.dom.node({ a: 'spec-to-object', id: p.q('projects[0].id') }); p.run('bind();'); toObj.onclick()
    const w = p.q('objects[0].stages.reduce(function(a,s){return a.concat(s.works||[]);},[])')
      .filter((x) => x.posKey === key)[0]
    t.ok('в объекте тот же порядок материалов',
      (w.mats || []).map((m) => m.pid).join(',') === mats().join(','),
      (w.mats || []).map((m) => m.pid).join(','))
  }
}

// ── Своя работа: удаляется она сама, а не её «материал» ─────────────────────
// У работы, вписанной руками, материалов нет — её цена показана одним
// «материалом», чтобы деньги считались общим правилом. Строка с крестиком в
// списке материалов обещала удаление и не делала ничего: у такого материала нет
// ни товара, ни своего id, и адрес кнопки уходил пустым.
{
  t.section('Своя работа и её цена')
  const p = panel()
  create(p, 'Дом со своей работой')
  p.run('projBand="parts";')
  const open = p.dom.node({ a: 'est-pos-add-open', k: p.q('projects[0].id') })
  p.run('bind();'); open.onclick()
  p.dom.field('pad-n', 'Сборка стеллажей'); p.dom.field('pad-cost', '500'); p.dom.field('pad-stage', '1')
  p.run('tProjects();')
  const go = p.dom.node({ a: 'est-pos-add-do', k: p.q('projects[0].id') })
  p.run('bind();'); go.onclick()
  const own = () => p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.name==="Сборка стеллажей";})[0]')
  t.ok('работа появилась', !!own() && own().cost === 500)
  t.ok('у её цены есть свой адрес',
    p.q('matKeyOf(allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.name==="Сборка стеллажей";})[0].mats[0])').length > 0)

  const key = own().key
  p.run('matsOpen[' + JSON.stringify(key) + ']=1;')
  const html = p.run('tProjects()')
  t.ok('фантомной строки материала нет', html.indexOf('data-a="est-mat-off" data-k="' + key + '|"') < 0)
  t.ok('но материал дописать можно', html.indexOf('data-a="est-mat-add-open" data-k="' + key + '"') >= 0)

  // Дописанный материал живёт своей жизнью, а цена работы видна подписью.
  const ao = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); ao.onclick()
  p.dom.field('mad-n', 'Уголок'); p.dom.field('mad-qty', '2'); p.dom.field('mad-cost', '100')
  const ad = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); ad.onclick()
  t.ok('цена сложилась из работы и материала', own().cost === 500 + 200, String(own().cost))
  const own2 = p.run('tProjects()').replace(/<[^>]*>/g, '').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('в строке видно обе половины', /материалы 200 ₽ · работа 500 ₽ · итого 700 ₽/.test(own2), 'нет раскладки')

  // Удаляется работа целиком — крестиком в своей строке.
  const del = p.dom.node({ a: 'est-pos-del', k: key }); p.run('bind();'); del.onclick()
  t.ok('работа удалилась', !own())
  t.ok('и её материалы не остались в листе', !p.q('projects[0].matAdd'))
}

// ── Две цифры: материалы и работа ───────────────────────────────────────────
// Одна сумма отвечала на вопрос «сколько стоит», но не на те два, которые задают
// на самом деле: сколько закупать и сколько платить бригаде.
{
  t.section('Материалы и работа порознь')
  const p = panel()
  create(p, 'Дом двумя цифрами')
  p.run('projBand="parts";')
  const plain = () => p.run('tProjects()').replace(/<[^>]*>/g, '').replace(/[\u00a0\u202f]/g, ' ')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const cost0 = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].cost')
  t.ok('без цены бригаде работа нулевая',
    new RegExp('материалы ' + cost0.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ') + ' ₽ · работа 0 ₽').test(plain()), 'нет раскладки')

  const inp = p.dom.node({ a: 'est-pos-cost', k: key })
  p.run('bind();'); inp.value = '12000'; inp.onchange()
  t.ok('цена бригаде встала в «работу»', /· работа 12 000 ₽ · итого /.test(plain()), 'нет цены работы')
  t.ok('и материалы остались своей цифрой',
    new RegExp('материалы ' + cost0.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ') + ' ₽ · работа 12 000').test(plain()))

  // «Под ключ» не делится: материалы в эту цифру уже включены.
  const chip = p.dom.node({ a: 'est-pos-cost-mode', k: key })
  p.run('bind();'); chip.onclick()
  t.ok('под ключ показан одной цифрой', /под ключ 12 000 ₽/.test(plain()), plain().slice(0, 200))
  t.ok('и на половинки не делится', !/материалы 2 000 ₽ · работа/.test(plain()))
  p.run('bind();'); chip.onclick()

  // Подытоги этапа — те же две цифры, считает их общий модуль.
  const st = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.filter(function(s){return s.n===2;})[0]')
  t.ok('этап знает свои материалы и работу', st.mats > 0 && st.labor === 12000, st.mats + ' / ' + st.labor)
  t.ok('и сумма сходится с итогом этапа', st.mats + st.labor === Math.round(st.cost), st.cost)
  t.ok('подытоги видны в шапке этапа',
    new RegExp('материалы ' + st.mats.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ') + ' ₽ · работа 12 000 ₽').test(plain()))
}

t.done()
