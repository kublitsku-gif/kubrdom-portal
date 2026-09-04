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
  t.ok('материалы перечнем', parts.indexOf('data-a="est-mat-open"') >= 0)
  t.ok('количество правится руками', parts.indexOf('data-a="est-mat-qty"') >= 0)
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
  t.ok('убранное показано отдельно', /УБРАНО ИЗ ЭТОГО ДОМА/.test(after))
  t.ok('и его можно вернуть', after.indexOf('data-a="est-pos-back"') >= 0)
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

t.done()
