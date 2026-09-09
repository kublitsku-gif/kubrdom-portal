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
  { id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'm2' },
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

// ── 2б. Площади по помещениям ───────────────────────────────────────────────
// Материал заказывают В КОМНАТУ: плитку в санузел, ламинат в спальню. Итог по
// дому («стены 80 м²») на этот вопрос не отвечает, а комнатные числа модель уже
// посчитала — держать их только на чертеже значит заставить сверять два экрана.
{
  t.section('Площади по помещениям — чем заказывают материал')
  const p = panel(RULES)
  create(p)
  p.run('factsOpen=false;projBand="parts";tProjects();')
  const head = p.dom.node({ a: 'est-facts-open' })
  p.run('bind();')
  head.onclick()
  const open = p.run('tProjects()')
  t.ok('таблица по помещениям есть', /ПО ПОМЕЩЕНИЯМ/.test(open))
  t.ok('комнаты названы', /Санузел/.test(open) && /Спальня/.test(open))
  // Стены двумя числами: чистыми обшивают и красят, полными считают обрешётку и
  // утеплитель — они проходят и за окном.
  // Изделия заказывают площадью: стекло у окна, полотно у двери.
  t.ok('у изделий в проёмах стоит площадь', /\d+×\d+ · [\d,]+ м²/.test(open))
  t.ok('и подытог окон с дверями', /Окна [\d,]+ м² · двери [\d,]+ м² · всего [\d,]+ м²/.test(open))
  t.ok('пол, потолок и стены двумя числами',
    /ПОЛ/.test(open) && /ПОТОЛОК/.test(open) && /СТЕНЫ ЧИСТЫЕ/.test(open) && /СТЕНЫ ПОЛНЫЕ/.test(open))
  // Числа — те же, что считает модель: своя арифметика в панели разошлась бы с
  // чертежом и печатью для бригады.
  const san = p.run('(function(){var r=modelAreas(projects[0].model, winTypes).rooms.filter(function(x){return x.name==="Санузел";})[0];'
    + 'return [numRu(r.floor),numRu(r.ceil),numRu(r.wallNet),numRu(r.wallGross)];})()')
  t.ok('пол санузла — из модели', open.indexOf('>' + san[0] + '</div>') >= 0, 'ждали: ' + san[0])
  t.ok('потолок равен полу', san[1] === san[0], 'получили: ' + san[1])
  t.ok('чистые стены санузла — из модели', open.indexOf('>' + san[2] + '</div>') >= 0, 'ждали: ' + san[2])
  t.ok('и полные тоже', open.indexOf('>' + san[3] + '</div>') >= 0, 'ждали: ' + san[3])
  // Справка свёрнута по умолчанию: экран открывают ради сметы.
  p.run('bind();')
  head.onclick()
  t.ok('и всё это прячется обратно', !/ПО ПОМЕЩЕНИЯМ/.test(p.run('tProjects()')))
}

// ── 2в. Высота стен и разбор площади ────────────────────────────────────────
// Стены считаются периметром × высоту, поэтому высота правится ТАМ ЖЕ, где эти
// числа показаны: уходить за ней в полноэкранный редактор значит уходить с
// экрана, ради которого её и меняют. А на вопрос «откуда 19,64» отвечает разбор
// по тапу и подсказка по наведению — число, которого не проверить, принимают на
// веру или не верят вовсе.
{
  t.section('Высота стен правится в справке')
  const p = panel(RULES)
  create(p)
  p.run('factsOpen=true;factsRoomOpen="";projBand="parts";tProjects();')
  const shown = p.run('tProjects()')
  t.ok('поле высоты стоит рядом с площадями', shown.indexOf('data-a="est-model-h"') >= 0)
  t.ok('и подписано', /ВЫСОТА СТЕН/.test(shown))
  // Значение с ТОЧКОЙ: с запятой браузер считает поле невалидным и показывает пустым.
  t.ok('значение — с точкой', /data-a="est-model-h" value="[\d.]+"/.test(shown), 'получили: '
    + (shown.match(/data-a="est-model-h" value="[^"]*"/) || [''])[0])

  const wallsAt = () => p.q('modelAreas(projects[0].model, winTypes).total.wallGross')
  const was = wallsAt()
  const field = p.dom.node({ a: 'est-model-h' })
  p.run('bind();')
  field.value = '2.8'
  field.onchange()
  t.ok('высота уехала в модель', p.q('projects[0].model.h') === 2800, 'получили: ' + p.q('projects[0].model.h'))
  t.ok('и стены пересчитались', wallsAt() > was, 'было ' + was + ', стало ' + wallsAt())
  // Характеристики листа идут за моделью: по ним считается отделка и печать.
  t.ok('характеристики синхронизированы', p.q('projects[0].specs.height') === 2.8,
    'получили: ' + p.q('projects[0].specs.height'))

  // Дом высотой в пять метров — опечатка, а не планировка.
  p.run('bind();')
  field.value = '5'
  field.onchange()
  t.ok('опечатку не принимаем', p.q('projects[0].model.h') === 2800, 'получили: ' + p.q('projects[0].model.h'))
  // Стена ниже своего окна — сломанный чертёж: изделие уже стоит в проёме.
  p.run('bind();')
  field.value = '2'
  field.onchange()
  t.ok('стену ниже окна тоже', p.q('projects[0].model.h') === 2800, 'получили: ' + p.q('projects[0].model.h'))
}

// ── 2г. Откуда взялась площадь ──────────────────────────────────────────────
{
  t.section('Формула площади — по наведению и по тапу')
  const p = panel(RULES)
  create(p)
  const shown = p.run('factsOpen=true;factsRoomOpen="";projBand="parts";tProjects()')
  t.ok('подсказка про стены висит на самом числе', /title="Стены: периметр [^"]+"/.test(shown))
  t.ok('и в ней есть высота', /title="Стены: периметр [^"]*высота [^"]+"/.test(shown))
  t.ok('у пола своя', /title="Пол: [^"]+"/.test(shown))

  // Подсказки по наведению видны в разметке всегда, поэтому «раскрыт ли разбор»
  // проверяем по тексту БЕЗ атрибутов title — иначе тест не отличит одно от другого.
  const body = (x) => x.replace(/title="[^"]*"/g, '')
  t.ok('до тапа разбора нет', !/периметр [\d,]+ м × высота/.test(body(shown)))

  const room = p.dom.node({ a: 'est-room-why', id: p.q('modelAreas(projects[0].model, winTypes).rooms[0].id') })
  p.run('bind();')
  room.onclick()
  const open = body(p.run('tProjects()'))
  t.ok('тап раскрывает разбор', /периметр [\d,]+ м × высота [\d,]+ м = [\d,]+ м²/.test(open))
  t.ok('и в нём сказано про вычет проёмов', /минус проёмы|проёмов в этом помещении нет/.test(open))
  t.ok('раскрытая комната помечена', /▾ /.test(open))
  // Разбор живёт на экране: это способ проверить число, а не правка дома.
  t.ok('в лист он не пишется', p.q('projects[0].factsRoomOpen') === null || p.q('projects[0].factsRoomOpen') === undefined)
  p.run('bind();')
  room.onclick()
  t.ok('второй тап закрывает', !/периметр [\d,]+ м × высота/.test(body(p.run('tProjects()'))))
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
  const partsPlain = parts.replace(/<[^>]*>/g, '').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('в строке видно материалы, работу и итог',
    /материалы [\d ]+ ₽ · работа [\d ]+ ₽/.test(partsPlain), 'нет раскладки')
  // Цифра ведёт туда, где её правят.
  t.ok('«материалы» раскрывают список', parts.indexOf('data-a="est-mats-open"') >= 0)
  t.ok('«работа» ведёт в поле цены', parts.indexOf('data-a="est-pos-cost-focus"') >= 0)
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
  // Имя работы едет в самой кнопке: спрашивать «убрать работу?» без имени — это
  // спрашивать про ту ли строку человек попал пальцем.
  t.ok('крестик знает имя работы', /data-a="est-pos-del" data-k="[^"]*" data-n="[^"]+"/.test(before))

  // Крестик стоит вплотную к переносу и этапу, поэтому спрашиваем. Передумал —
  // работа остаётся в доме.
  const no = panel(RULES)
  no.run('confirm=function(){return false;};')
  create(no, 'Дом с лишней работой')
  no.run('projBand="parts";')
  const nokey = no.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const nodel = no.dom.node({ a: 'est-pos-del', k: nokey, n: 'Работа' })
  no.run('bind();'); nodel.onclick()
  t.ok('отказ оставляет работу в доме',
    no.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(nokey) + ';}).length') === 1)
  t.ok('и в листе ничего не записано', !no.q('projects[0].posOff'))

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
  // Внутри «ЭТАП 1» у каждой строки стояло «Этап 1» — колонка повторяла заголовок.
  // Выбор прячется за кнопкой ⇅ и раскрывается тапом; у переставленных он виден сам.
  t.ok('пока этап не менян — только кнопка', p.run('tProjects()').indexOf('data-a="est-pos-stage-pick"') >= 0
    && p.run('tProjects()').indexOf('data-a="est-pos-stage"') < 0)
  const pick = p.dom.node({ a: 'est-pos-stage-pick', k: key }); p.run('bind();'); pick.onclick()
  t.ok('тап раскрывает выбор этапа', p.run('tProjects()').indexOf('data-a="est-pos-stage"') >= 0)

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
  t.ok('у работы есть ручка переноса', idle.indexOf('data-a="est-pos-drag"') >= 0)
  t.ok('мест «сюда» в списке нет', idle.indexOf('data-a="est-pos-drop"') < 0)
  t.ok('и стрелок тоже нет', idle.indexOf('data-a="est-pos-step"') < 0)
  // Строка знает свой адрес: перенос ищет соседей по разметке, а не по индексу —
  // между работами стоят шапки помещений и раскрытые редакторы.
  t.ok('у строки есть адрес', idle.indexOf('data-pos-row="' + before[0] + '"') >= 0)
  t.ok('и помещение в адресе', /data-pos-grp="2\|/.test(idle))
  t.ok('ручка не перехватывается прокруткой', /data-a="est-pos-drag"[^>]*touch-action:none/.test(idle))

  // Сам жест — браузерный, поэтому проверяем то, чем он заканчивается: работу
  // ставят перед той строкой, на которую её принесли.
  t.ok('строка встала перед соседкой',
    p.q('estPosPutBefore(' + JSON.stringify(before[1]) + ',' + JSON.stringify(before[0]) + ')') === true)
  const after = stageKeys()
  t.ok('порядок поменялся', after.join(',') === before.slice().reverse().join(','),
    before.join(',') + ' → ' + after.join(','))
  // Порядок хранится в листе — справочник общий на все дома.
  t.ok('порядок записан в лист', !!p.q('projects[0].posOrder'))
  t.ok('справочник не тронут', p.q('estimates.length') === 2)

  // Пустой адрес — «последней в этом помещении»: так заканчивается бросок ниже
  // всех соседей, где строки, перед которой встать, уже нет.
  t.ok('без адреса строка уходит вниз',
    p.q('estPosPutBefore(' + JSON.stringify(before[1]) + ', "")') === true &&
    stageKeys().join(',') === before.join(','), stageKeys().join(','))
  // Бросок на своё же место — не перестановка: сохранять и перерисовывать нечего.
  t.ok('перенос на место ничего не меняет',
    p.q('estPosPutBefore(' + JSON.stringify(before[1]) + ', "")') === false &&
    stageKeys().join(',') === before.join(','))
  t.ok('чужой ключ переносить нечего', p.q('estPosPutBefore("нет такой", "")') === false)

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
    expProducts: [{ id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'm2',
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
  t.ok('и открывается в новой вкладке', /target="_blank"[^>]*>Лемана ПРО|Лемана ПРО[^<]*↗/.test(html))
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
  const qty = p.dom.node({ a: 'est-mat-qty', k: key + '|+' + mid })
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
    html.indexOf('data-a="est-mat-open" data-k="' + key + '|+' + mid + '"') < 0)
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

  // Комнаты раскрывает кнопка у самой строки — постоянный ряд из пяти кнопок в
  // каждой работе читался бы как часть сметы.
  const key = house.positions[0].key
  const pick = p.dom.node({ a: 'est-pos-room-pick', k: key }); p.run('bind();'); pick.onclick()
  const held = p.run('tProjects()')
  t.ok('предложено перенести в комнату', /ПЕРЕНЕСТИ В/.test(held))
  t.ok('и комнаты перечислены', (held.match(/data-a="est-pos-room"/g) || []).length >= 3)

  const room = W().rooms[0]
  const chip = p.dom.node({ a: 'est-pos-room', k: key, r: room.id }); p.run('bind();'); chip.onclick()
  t.ok('работа переехала в комнату',
    st().blocks.filter((b) => b.key === room.id)[0].positions.some((x) => x.key === key), layout())
  t.ok('приписка лежит в листе', p.q('projects[0].posRoom[' + JSON.stringify(key) + ']') === room.id)
  t.ok('справочник не тронут', p.q('estimates.length') === 3)
  t.ok('ряд комнат закрылся', p.q('roomPickKey') === '')
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
  const pick2 = p.dom.node({ a: 'est-pos-room-pick', k: key }); p.run('bind();'); pick2.onclick()
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
    const mk = key + '|' + was[was.length - 1]
    t.ok('у материала есть ручка переноса', idle.indexOf('data-a="est-mat-drag"') >= 0)
    t.ok('мест «сюда» в списке нет', idle.indexOf('data-a="est-mat-drop"') < 0)
    t.ok('и стрелок шага тоже нет', idle.indexOf('data-a="est-mat-step"') < 0)
    t.ok('у материала есть адрес', idle.indexOf('data-mat-row="' + was[was.length - 1] + '"') >= 0)
    t.ok('и работа в адресе', idle.indexOf('data-mat-grp="' + key + '"') >= 0)
    t.ok('ручка не перехватывается прокруткой', /data-a="est-mat-drag"[^>]*touch-action:none/.test(idle))

    // Жест браузерный — проверяем то, чем он заканчивается.
    t.ok('материал встал первым',
      p.q('matPutBefore(' + JSON.stringify(mk) + ',' + JSON.stringify(was[0]) + ')') === true &&
      mats()[0] === was[was.length - 1], mats().join(','))
    t.ok('порядок записан в лист', !!p.q('projects[0].matOrder'))
    t.ok('цена строки не изменилась',
      p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].cost') === cost0)
    t.ok('справочник не тронут', p.q('estimates.length') === 3)
    // Пустой адрес — «последним в этой работе»: так заканчивается бросок ниже всех.
    t.ok('без адреса материал уходит вниз',
      p.q('matPutBefore(' + JSON.stringify(mk) + ', "")') === true &&
      mats().join(',') === was.join(','), mats().join(','))
    t.ok('перенос на место ничего не меняет',
      p.q('matPutBefore(' + JSON.stringify(mk) + ', "")') === false)
    t.ok('чужой материал переносить нечего', p.q('matPutBefore(' + JSON.stringify(key + '|нет') + ', "")') === false)

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
  t.ok('в строке видно обе половины', /материалы 200 ₽ · работа 500 ₽/.test(own2), 'нет раскладки')

  // Цена своей работы правится В ПОЛЕ: она лежит в самой строке, а не отметкой
  // поверх расчёта, и раньше поле оставалось пустым при живой цене.
  const ownField = () => (p.run('tProjects()').match(new RegExp('id="pc-' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*')) || [''])[0]
  t.ok('цена своей работы стоит в поле', /value="500"/.test(ownField()), ownField().slice(0, 140))
  const setOwn = p.dom.node({ a: 'est-pos-cost', k: key })
  p.run('bind();'); setOwn.value = '900'; setOwn.onchange()
  t.ok('и правится там же', own().cost === 900 + 200, String(own().cost))
  t.ok('правка ушла в саму работу, а не в отметку поверх расчёта',
    p.q('projects[0].posAdd[0].cost') === 900 && !p.q('projects[0].posCost'))
  t.ok('пустого чипа «откуда число» нет',
    !/border-radius:7px;padding:2px 7px[^>]*"><\/span>/.test(p.run('tProjects()')))

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
  // Поле в шапке — это цена БРИГАДЕ, и пока её не назначили, оно пустое с
  // подсказкой: подставленный туда итог строки читался как «работа стоит столько
  // же, сколько всё», и вносить оплату было некуда.
  const fieldHtml = () => (p.run('tProjects()').match(/data-a="est-pos-cost"[^>]*/) || [''])[0]
  t.ok('поле цены пустое', /value=""/.test(fieldHtml()), fieldHtml().slice(0, 120))
  t.ok('и подписано «работа»', /placeholder="работа"/.test(fieldHtml()))
  t.ok('без цены бригаде работа нулевая',
    new RegExp('материалы ' + cost0.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ') + ' ₽ · работа 0 ₽').test(plain()), 'нет раскладки')

  const inp = p.dom.node({ a: 'est-pos-cost', k: key })
  p.run('bind();'); inp.value = '12000'; inp.onchange()
  t.ok('цена бригаде встала в «работу»', /· работа 12 000 ₽/.test(plain()), 'нет цены работы')
  t.ok('и в поле стоит она же, а не итог', /value="12000"/.test(fieldHtml()), fieldHtml().slice(0, 120))
  t.ok('и материалы остались своей цифрой',
    new RegExp('материалы ' + cost0.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ') + ' ₽ · работа 12 000').test(plain()))

  // «Под ключ» не делится: материалы в эту цифру уже включены.
  const chip = p.dom.node({ a: 'est-pos-cost-mode', k: key })
  p.run('bind();'); chip.onclick()
  // «Под ключ» не делится на половинки: сама цифра стоит справа от имени, а в
  // раскладке остаётся пометка, что материалы в неё уже включены.
  t.ok('под ключ помечен в раскладке', /материалы \d+ · под ключ/.test(plain()), plain().slice(0, 200))
  t.ok('и на половинки не делится', !/материалы 2 000 ₽ · работа/.test(plain()))
  p.run('bind();'); chip.onclick()

  // Подытоги этапа — те же две цифры, считает их общий модуль.
  const st = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.filter(function(s){return s.n===2;})[0]')
  t.ok('этап знает свои материалы и работу', st.mats > 0 && st.labor === 12000, st.mats + ' / ' + st.labor)
  t.ok('и сумма сходится с итогом этапа', st.mats + st.labor === Math.round(st.cost), st.cost)
  // Итог строки — крупной цифрой рядом с полем, чип режима стоит всегда.
  t.ok('итог строки виден в шапке',
    /font-size:13px;font-weight:800[^>]*white-space:nowrap">[\d\s\u00a0]+ ₽/.test(p.run('tProjects()')))
  t.ok('чип «за работу / под ключ» есть и без назначенной цены',
    p.run('tProjects()').indexOf('data-a="est-pos-cost-mode"') >= 0)
  // Крестик работы красный, крестик материала приглушён: рядом стоящие одинаковые
  // стирали всю работу вместо одного материала.
  p.run('matsOpen[' + JSON.stringify(key) + ']=1;')
  const marks = p.run('tProjects()')
  t.ok('✕ материала приглушён', /data-a="est-mat-off"[^>]*color:#9aabbf/.test(marks))
  t.ok('✕ работы остаётся красным', /data-a="est-pos-del"[^>]*color:#e74c3c/.test(marks))
  t.ok('«+ материал» во всю ширину', /est-mat-add-open[^>]*width:100%/.test(marks))

  t.ok('подытоги видны в шапке этапа',
    new RegExp('материалы ' + st.mats.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ') + ' ₽ · работа 12 000 ₽').test(plain()))
}

// ── Строка не рассыпается и читается сверху вниз ─────────────────────────────
// Всё управление стояло в один ряд с именем, и на узкой колонке имя сжималось до
// одного слова в строку: поле, чип, итог, ↕, этап и ✕ не сжимаются.
{
  t.section('Вёрстка строки')
  const p = panel()
  create(p, 'Дом с длинным именем')
  p.run('estimates=estimates.concat([{id:"e_long",kind:"house",name:"Монтаж подвесов для обрешётки к стенам",stage:1,lines:[{pid:"p_osb",qty:2}]}]);')
  p.run('projBand="parts";')
  const html = p.run('tProjects()')
  t.ok('имя не длиннее двух строк', /-webkit-line-clamp:2/.test(html))
  t.ok('и полное имя в подсказке', /title="Монтаж подвесов для обрешётки к стенам"/.test(html))
  t.ok('итог стоит справа от имени',
    /font-size:13px;font-weight:800[^>]*white-space:nowrap">[\d\s\u00a0\u202f]+ ₽/.test(html))
  t.ok('строки разделяет воздух, а не линия',
    /padding:12px 0/.test(html) && html.indexOf('border-top:1px solid #f4f7fb') < 0)
  t.ok('кнопки одного размера', (html.match(/width:28px;height:28px/g) || []).length >= 3)
  // «Итого» из раскладки убрано: число уже стоит справа.
  const plain = html.replace(/<[^>]*>/g, '').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('раскладка без повтора итога', /материалы [\d ]+ ₽ · работа [\d ]+ ₽/.test(plain) && !/· итого /.test(plain))
}

// ── Цены материалов: каталог подорожал ───────────────────────────────────────
// Цена дописанного материала — КОПИЯ: она застыла в момент, когда его вписали, а
// каталог с тех пор мог подорожать. Строка обязана это показать, а обновление —
// быть одним тапом: и по одному материалу, и по этапу целиком. Экран сметы у
// проекта и у опытного раздела ОДИН, поэтому то же самое сторожит test-spec2-smeta.
{
  t.section('Цены материалов по каталогу')
  const p = panel()
  create(p, 'Дом с ценами')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const posOf = () => p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()

  // Дописываем товар ИЗ БАЗЫ, но по своей цене: 100 ₽ против 300 ₽ в каталоге.
  const addOpen = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); addOpen.onclick()
  p.dom.field('mad-n', 'Розетка'); p.dom.field('mad-qty', '2'); p.dom.field('mad-cost', '100')
  const addDo = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); addDo.onclick()
  const mid = p.q('projects[0].matAdd[' + JSON.stringify(key) + '][0].id')

  const html = p.run('tProjects()').replace(/[  ]/g, ' ')
  t.ok('строка говорит, что в базе дороже', /в базе 300 ₽/.test(html), 'нет пометки о каталоге')
  t.ok('и обновление — одним тапом',
    html.indexOf('data-a="est-mat-price" data-k="' + key + '|+' + mid + '"') >= 0, 'нет кнопки у материала')
  // Кнопка этапа зажигается только тогда, когда есть что обновлять.
  const stN = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.filter(function(s){return (s.positions||[]).some(function(x){return x.key===' + JSON.stringify(key) + ';});})[0].n')
  t.ok('и кнопка этапа зажглась',
    new RegExp('data-a="est-stage-prices" data-n="' + stN + '"(?! disabled)').test(html), 'кнопка выключена')

  // Этап целиком: одним тапом по всем отставшим копиям.
  const cost0 = posOf().cost
  const stage = p.dom.node({ a: 'est-stage-prices', n: String(stN) }); p.run('bind();'); stage.onclick()
  const posA = posOf()
  const matA = (posA.mats || []).filter((m) => m.added)[0]
  t.ok('цена материала стала каталожной', matA && matA.cost === 300, JSON.stringify(matA && matA.cost))
  t.ok('и строка подорожала на разницу', posA.cost === cost0 + 400, cost0 + ' → ' + posA.cost)
  t.ok('правка легла в проект', p.q('projects[0].matAdd[' + JSON.stringify(key) + '][0].cost') === 300)
  t.ok('справочник товаров не тронут',
    p.q('expProducts.filter(function(x){return x.id==="p_sock";})[0].unitCost') === 300)
  // Кнопка не гаснет: сверить цены хотят и тогда, когда всё сошлось, — иначе
  // «не работает» неотличимо от «нечего обновлять». Гаснет не кнопка, а тревога.
  t.ok('кнопка осталась рабочей',
    new RegExp('data-a="est-stage-prices" data-n="' + stN + '"(?! disabled)').test(p.run('tProjects()')),
    'кнопку выключили')
  t.ok('и точки-тревоги на ней больше нет',
    !/💱 цены •/.test(p.run('tProjects()')), 'тревога висит после обновления')

  // И тот же материал — кнопкой в самой строке.
  p.run('projects[0].matAdd[' + JSON.stringify(key) + '][0].cost=100;tProjects();')
  const one = p.dom.node({ a: 'est-mat-price', k: key + '|+' + mid }); p.run('bind();'); one.onclick()
  t.ok('строка обновилась сама', p.q('projects[0].matAdd[' + JSON.stringify(key) + '][0].cost') === 300,
    String(p.q('projects[0].matAdd[' + JSON.stringify(key) + '][0].cost')))

  // История цены товара: строка отвечает на «почему подорожало» сама.
  p.run('expProducts.filter(function(x){return x.id==="p_osb";})[0].hist=[{at:"2026-01-10T00:00:00Z",c:700,by:"Иван"},{at:"2026-03-01T00:00:00Z",c:1000,by:"Иван"}];')
  const withHist = p.run('tProjects()').replace(/[  ]/g, ' ')
  t.ok('в строке видно прежнюю цену', /было 700 ₽/.test(withHist), 'истории нет в строке')
  t.ok('и когда её правили', withHist.indexOf('цена до 10.01.26') >= 0, 'нет даты правки')
}

// ── Дописанный материал того же товара — своя строка ─────────────────────────
// Адрес материала внутри строки был «его товар», и дописанный «ОСП 9 мм» жил по
// одному адресу с тем же товаром, уже посчитанным в смете: ручное количество,
// порядок и «убрать» доставались обеим строкам сразу. Экран сметы у двух
// разделов ОДИН — то же самое сторожит test-spec2-smeta.
{
  t.section('Дописан тот же товар, что в расчёте')
  const p = panel()
  create(p, 'Дом с двумя ОСП')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const posOf = () => p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const was = posOf()
  const base = (was.mats || []).filter((m) => m.pid === 'p_osb')[0]
  t.ok('в строке уже есть этот товар', !!base, JSON.stringify((was.mats || []).map((m) => m.pid)))

  // Дописываем ТОТ ЖЕ товар второй строкой — так добирают вторую фасовку.
  const addOpen = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); addOpen.onclick()
  p.dom.field('mad-n', 'ОСП 9 мм'); p.dom.field('mad-qty', '1'); p.dom.field('mad-cost', '1000')
  const addDo = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); addDo.onclick()
  const mid = p.q('projects[0].matAdd[' + JSON.stringify(key) + '][0].id')
  const two = posOf()
  t.ok('в строке две записи товара',
    (two.mats || []).filter((m) => m.pid === 'p_osb').length === 2,
    JSON.stringify((two.mats || []).map((m) => [m.pid, m.qty])))

  // Правим количество ДОПИСАННОГО: расчётный остаётся как посчитано.
  const qty = p.dom.node({ a: 'est-mat-qty', k: key + '|+' + mid })
  qty.value = '5'; p.run('bind();'); qty.onchange()
  const now = posOf()
  const added = (now.mats || []).filter((m) => m.added)[0]
  const calc = (now.mats || []).filter((m) => !m.added && m.pid === 'p_osb')[0]
  t.ok('количество досталось дописанному', added && added.qty === 5, JSON.stringify(added && added.qty))
  t.ok('а расчётный остался как был', calc && calc.qty === base.qty && !calc.qtySet,
    JSON.stringify(calc && [calc.qty, !!calc.qtySet]))
  t.ok('правка адресована своим ключом',
    p.q('projects[0].matQty[' + JSON.stringify(key) + '][' + JSON.stringify('+' + mid) + ']') === 5,
    JSON.stringify(p.q('projects[0].matQty[' + JSON.stringify(key) + ']')))

  // «Убрать» расчётный — дописанный остаётся: это две разные строки.
  const drop = p.dom.node({ a: 'est-mat-off', k: key + '|p_osb' }); p.run('bind();'); drop.onclick()
  const left = posOf()
  t.ok('убрался только расчётный',
    (left.mats || []).filter((m) => m.pid === 'p_osb').length === 1
    && (left.mats || []).filter((m) => m.pid === 'p_osb')[0].added === true,
    JSON.stringify((left.mats || []).map((m) => [m.pid, !!m.added])))
}

// ── Старые адреса переживают загрузку ───────────────────────────────────────
// Правки по прежним адресам лежат в боевых листах: убранный материал вернулся бы
// на экран, а ручное количество откатилось бы к расчётному. Поэтому при загрузке
// к старому адресу дописывается новый — экран остаётся таким же, как был.
{
  t.section('Миграция адресов при загрузке')
  const p = panel()
  create(p, 'Дом со старыми адресами')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const addOpen = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); addOpen.onclick()
  p.dom.field('mad-n', 'ОСП 9 мм'); p.dom.field('mad-qty', '1'); p.dom.field('mad-cost', '1000')
  const addDo = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); addDo.onclick()
  const mid = p.q('projects[0].matAdd[' + JSON.stringify(key) + '][0].id')

  // Так эта правка лежит в листах, сделанных до смены адреса.
  p.run('projects[0].matQty={' + JSON.stringify(key) + ':{p_osb:7}};ensureMatAddrs();')
  t.ok('новый адрес дописан',
    p.q('projects[0].matQty[' + JSON.stringify(key) + '][' + JSON.stringify('+' + mid) + ']') === 7,
    JSON.stringify(p.q('projects[0].matQty[' + JSON.stringify(key) + ']')))
  const pos = p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  t.ok('количество дописанного не потерялось',
    (pos.mats || []).filter((m) => m.added)[0].qty === 7,
    JSON.stringify((pos.mats || []).map((m) => [m.pid, m.qty, !!m.added])))
  t.ok('повторная загрузка ничего не меняет', p.q('ensureMatAddrs()') === 0)
}

// ── Один товар дважды в самой смете ─────────────────────────────────────────
// «ОСП на пол» и «ОСП на стены» одной работой — это две строки, и правят их
// порознь. Адресом обеих был один товар: замена меняла товар в обеих, ручное
// количество доставалось обеим. Экран сметы у двух разделов ОДИН — то же самое
// сторожит test-spec2-smeta.
{
  t.section('Один товар дважды в смете')
  const p = boot({})
  p.set({
    expProducts: [{ id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'piece' },
      { id: 'p_ply', name: 'Фанера 4 мм', unitCost: 700, store: 'Лемана ПРО', mode: 'piece' }],
    estimates: [{ id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2,
      lines: [{ pid: 'p_osb', qty: 1 }, { pid: 'p_osb', qty: 2 }] }],
    dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [],
    purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
  })
  create(p, 'Дом с двумя строками ОСП')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const posOf = () => p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0]')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const both = posOf().mats
  t.ok('в строке две записи товара', both.length === 2, JSON.stringify(both.map((m) => [m.pid, m.qty])))

  const html = p.run('tProjects()')
  t.ok('у первой прежний адрес', html.indexOf('data-a="est-mat-qty" data-k="' + key + '|p_osb"') >= 0)
  t.ok('у повтора свой', html.indexOf('data-a="est-mat-qty" data-k="' + key + '|p_osb#2"') >= 0,
    'адрес повтора не проставлен')

  // Заменяем ПЕРВУЮ: вторая обязана остаться прежним товаром.
  const open = p.dom.node({ a: 'est-mat-open', k: key + '|p_osb' }); p.run('bind();'); open.onclick()
  p.run('tProjects();')
  p.dom.field('msw-input', 'Фанера 4 мм')
  const doIt = p.dom.node({ a: 'est-mat-do', k: key + '|p_osb' }); p.run('bind();'); doIt.onclick()
  const after = posOf().mats
  t.ok('заменилась одна строка', after.filter((m) => m.pid === 'p_ply').length === 1,
    JSON.stringify(after.map((m) => m.pid)))
  t.ok('и это первая', after[0].pid === 'p_ply' && after[1].pid === 'p_osb',
    JSON.stringify(after.map((m) => m.pid)))
  t.ok('замена адресована первой', p.q('projects[0].mats[' + JSON.stringify(key) + '].p_osb') === 'p_ply')

  // Количество повтора — тоже своё.
  const qty = p.dom.node({ a: 'est-mat-qty', k: key + '|p_osb#2' })
  qty.value = '9'; p.run('bind();'); qty.onchange()
  const now = posOf().mats
  t.ok('количество досталось повтору', now[1].qty === 9, JSON.stringify(now.map((m) => m.qty)))
  t.ok('а первая строка своё сохранила', now[0].qty === 1 && !now[0].qtySet,
    JSON.stringify([now[0].qty, !!now[0].qtySet]))
}

// ── Адрес по строке сметы: правка переживает перестановку ───────────────────
// Адресом материала был его товар, и правка «второй строки ОСП» держалась на
// том, что строки идут в прежнем порядке: переставь их в справочнике — и ручное
// количество досталось бы соседней. Теперь адрес — id строки справочника.
// Экран сметы у двух разделов ОДИН, то же самое сторожит test-spec2-smeta.
{
  t.section('Адрес по строке сметы')
  const p = boot({})
  p.set({
    expProducts: [{ id: 'p_osb', name: 'ОСП 9 мм', unitCost: 1000, store: 'Лемана ПРО', mode: 'piece' }],
    estimates: [{ id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2,
      lines: [{ pid: 'p_osb', qty: 1 }, { pid: 'p_osb', qty: 2 }] }],
    dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [],
    purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
  })
  // Так строкам смет проставляются id при загрузке: детерминированно, чтобы две
  // вкладки не разошлись, и только там, где их ещё нет.
  t.ok('id проставились', p.q('ensureLineIds()') === 2)
  t.ok('и они предсказуемы', p.q('estimates[0].lines.map(function(l){return l.id;}).join(",")')
    === 'ln_e_osb_1,ln_e_osb_2', p.q('estimates[0].lines.map(function(l){return l.id;}).join(",")'))
  t.ok('повтор ничего не трогает', p.q('ensureLineIds()') === 0)

  create(p, 'Дом с id строк')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const matsOf = () => p.q('allPositions(projects[0], specCtx(projects[0])).filter(function(x){return x.key===' + JSON.stringify(key) + ';})[0].mats')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const html = p.run('tProjects()')
  t.ok('адрес на экране — по строке',
    html.indexOf('data-a="est-mat-qty" data-k="' + key + '|l:ln_e_osb_2"') >= 0,
    'адрес по строке не проставлен')

  const qty = p.dom.node({ a: 'est-mat-qty', k: key + '|l:ln_e_osb_2' })
  qty.value = '9'; p.run('bind();'); qty.onchange()
  t.ok('правка легла на строку',
    p.q('projects[0].matQty[' + JSON.stringify(key) + ']["l:ln_e_osb_2"]') === 9,
    JSON.stringify(p.q('projects[0].matQty[' + JSON.stringify(key) + ']')))
  t.ok('количество применилось', matsOf()[1].qty === 9, JSON.stringify(matsOf().map((m) => m.qty)))

  // ГЛАВНОЕ: строки переставили местами в справочнике.
  p.run('estimates[0].lines=[estimates[0].lines[1],estimates[0].lines[0]];')
  const after = matsOf()
  t.ok('правка осталась на своей строке',
    after.filter((m) => m.lid === 'ln_e_osb_2')[0].qty === 9,
    JSON.stringify(after.map((m) => [m.lid, m.qty])))
  t.ok('а соседняя не тронута', after.filter((m) => m.lid === 'ln_e_osb_1')[0].qty === 1)

  // «Вернуть расчётное» снимает правку целиком — и по прежнему адресу тоже.
  p.run('projects[0].matQty[' + JSON.stringify(key) + ']["p_osb"]=4;tProjects();')
  const reset = p.dom.node({ a: 'est-mat-qty-reset', k: key + '|l:ln_e_osb_2' })
  p.run('bind();'); reset.onclick()
  t.ok('правка снята', !p.q('(projects[0].matQty||{})[' + JSON.stringify(key) + ']||null'),
    JSON.stringify(p.q('(projects[0].matQty||{})[' + JSON.stringify(key) + ']||null')))
}

// ── Цены проекта в списке ───────────────────────────────────────────────────
// В списке проектов видно, где смета считается по вчерашнему каталогу. Иначе это
// выясняется на встрече с заказчиком — самым дорогим способом.
{
  t.section('Список проектов показывает состояние цен')
  const p = panel([{ id: 'r_w', kind: 'banya', estId: 'e_wall', what: 'surface', k: 'wall', scope: 'house', qty: 1, stage: 2 }])
  p.run('expProducts=expProducts.concat([{id:"p_sock",name:"Розетка",unitCost:300,store:"Лемана ПРО",mode:"piece"}]);')
  create(p, 'Дом Ивановых')
  const key = p.q('works2(projects[0], specCtx(projects[0])).positions[0].key')
  const stN = p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.filter(function(s){return (s.positions||[]).some(function(x){return x.key===' + JSON.stringify(key) + ';});})[0].n')

  // Никто не сверял — молчим: такой проект не хороший и не плохой.
  p.run('projOpenId=null;tProjects();')
  const html0 = p.run('tProjects()')
  t.ok('без сверки чипа нет', !/цены сверены/.test(html0) && !/цены отстали/.test(html0))

  // Цена в каталоге уехала — проект помечен.
  p.run('var sh=projects[0]; sh.matAdd={}; sh.matAdd[' + JSON.stringify(key) + ']=[{id:"m1",pid:"p_sock",n:"Розетка",cost:100,qty:2,mode:"piece"}];')
  t.ok('расхождение видно в списке', /цены отстали/.test(p.run('tProjects()')), 'нет отметки об отставании')

  // Обошли магазины по всем товарам — загорелась галочка.
  p.run('var sh=projects[0]; sh.matAdd[' + JSON.stringify(key) + '][0].cost=300;'
    + 'expProducts.forEach(function(x){ x.priceOkAt="2026-09-06"; });')
  t.ok('после сверки — галочка', /цены сверены/.test(p.run('tProjects()')), 'нет галочки актуальности')
}

// ── Поиск по смете ──────────────────────────────────────────────────────────
// В смете сорок строк по шести свёрнутым этапам, а вопрос к ней точечный: «где
// тут ОСП». Ищем и по работе, и по материалу — половину состава дома помнят
// товаром, а не именем работы. Экран сметы у двух разделов ОДИН: то же самое
// сторожит test-spec2-smeta.
{
  t.section('Поиск по смете')
  const p = panel(RULES)
  create(p, 'Дом с поиском')
  p.run('projBand="parts";estFind="";')
  const all = p.q('allPositions(projects[0], specCtx(projects[0])).length')
  t.ok('в смете есть что искать', all >= 2, 'позиций: ' + all)
  t.ok('поле поиска есть', p.run('tProjects()').indexOf('data-a="est-find"') >= 0)

  // По имени работы.
  p.run('estFind="обшивка";')
  const byName = p.run('tProjects()')
  t.ok('нашлась работа', /Обшивка стен ОСП/.test(byName), 'работа не найдена')
  t.ok('чужая работа скрыта', !/Монтаж окна/.test(byName), 'в выдаче лишнее')
  t.ok('видно, сколько нашлось', /найдено \d+ из /.test(byName), 'нет счётчика')
  // Этапы свёрнуты по умолчанию — найденное обязано быть видно без раскрытия.
  p.run('stageOpen={};')
  t.ok('этап раскрыт под находку', /Обшивка стен ОСП/.test(p.run('tProjects()')),
    'находка спряталась в свёрнутый этап')

  // По материалу — и строка сразу показывает, почему она в выдаче.
  p.run('estFind="розетка";matsOpen={};')
  const byMat = p.run('tProjects()')
  t.ok('нашлось по материалу', /Монтаж окна/.test(byMat), 'по материалу не ищет')
  t.ok('и материалы раскрыты', byMat.indexOf('data-a="est-mat-qty"') >= 0, 'состав не показан')

  // Слова ищутся все сразу: «осп 9» — это ОСП 9 мм, а не всё с девяткой.
  p.run('estFind="осп 9";')
  t.ok('слова складываются', /Обшивка стен ОСП/.test(p.run('tProjects()')))
  p.run('estFind="осп окно";')
  t.ok('и лишнее не находят', /ничего не нашлось/.test(p.run('tProjects()')), 'нашлось невозможное')

  // Пустой результат объясняет себя, а не показывает пустой экран.
  p.run('estFind="абракадабра";')
  const none = p.run('tProjects()')
  t.ok('пустая выдача объясняет', /в этой смете ничего нет/.test(none))
  t.ok('и подсказывает, как ищет', /по материалу/.test(none))

  // Крестик возвращает всю смету.
  p.run('tProjects();')
  const clr = p.dom.node({ a: 'est-find-clear' }); p.run('bind();'); clr.onclick()
  t.ok('поиск сброшен', p.q('estFind') === '')
  // Этапы возвращаются к своей свёрнутости — раскрывал их поиск, а не человек.
  t.ok('этапы снова свёрнуты', !/Монтаж окна/.test(p.run('tProjects()')), 'этап остался раскрытым')
  p.run('stageOpen={0:1,1:1,2:1,3:1,4:1,5:1,6:1};')
  t.ok('смета вернулась целиком', /Монтаж окна/.test(p.run('tProjects()')))
  // Поиск — способ посмотреть, а не правка: в листе его нет.
  t.ok('в проект поиск не записан',
    !p.q('JSON.stringify(projects[0]).indexOf("estFind")>=0'), 'поиск утёк в лист')
}

// ── Дописанный материал заводится в базу ────────────────────────────────────
// Материал без карточки — снимок в одном доме: цена застыла в дне, когда его
// вписали, истории у неё нет, сверка его не видит, а в следующем доме его
// вписывают заново. Экран сметы у двух разделов ОДИН — то же сторожит
// test-spec2-smeta.
{
  t.section('Материал заводится в базу из строки')
  const p = panel()
  create(p, 'Дом с новым товаром')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const was = p.q('expProducts.length')

  const addOpen = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); addOpen.onclick()
  t.ok('форма просит ссылку', p.run('tProjects()').indexOf('id="mad-url"') >= 0)
  t.ok('и предлагает завести в базу', p.run('tProjects()').indexOf('id="mad-base"') >= 0)
  p.dom.field('mad-n', 'Уголок усиленный 40х40')
  p.dom.field('mad-qty', '2'); p.dom.field('mad-cost', '180')
  p.dom.field('mad-url', 'https://lemanapro.ru/product/ugolok-40/')
  p.dom.field('mad-base', true)                      // галка «завести в базу» стоит по умолчанию
  const addDo = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); addDo.onclick()

  t.ok('товар появился в каталоге', p.q('expProducts.length') === was + 1)
  const np = p.q('expProducts.filter(function(x){return /Уголок/.test(x.name||"");})[0]')
  t.ok('с ценой из формы', np && np.unitCost === 180, JSON.stringify(np && np.unitCost))
  t.ok('магазин узнан по ссылке', np && np.store === 'Лемана ПРО', JSON.stringify(np && np.store))
  t.ok('и ссылка сохранена', np && /lemanapro/.test(np.url || ''))
  // Строка сметы теперь ссылается на карточку, а не живёт снимком.
  const mat = p.q('projects[0].matAdd[' + JSON.stringify(key) + '][0]')
  t.ok('строка связана с карточкой', mat && mat.pid === np.id, JSON.stringify(mat && mat.pid))

  // Галку сняли — товар в каталог не лезет: справочник общий.
  const addOpen2 = p.dom.node({ a: 'est-mat-add-open', k: key }); p.run('bind();'); addOpen2.onclick()
  p.run('tProjects();')
  p.dom.field('mad-n', 'Скоба разовая'); p.dom.field('mad-qty', '1'); p.dom.field('mad-cost', '20')
  p.dom.field('mad-url', ''); p.dom.field('mad-base', '')
  const addDo2 = p.dom.node({ a: 'est-mat-add-do', k: key }); p.run('bind();'); addDo2.onclick()
  t.ok('без галки каталог не растёт', p.q('expProducts.length') === was + 1,
    'товаров: ' + p.q('expProducts.length'))
  t.ok('а в строке материал есть',
    p.q('projects[0].matAdd[' + JSON.stringify(key) + '].length') === 2)
}

// ── «30 листов» — это сколько квадратов ─────────────────────────────────────
// Товар продаётся листами, а стены меряют квадратами. Считать в уме 30 × 3,12
// при каждом взгляде на строку — не работа человека. Экран сметы у двух
// разделов ОДИН: то же сторожит test-spec2-smeta.
{
  t.section('Пересчёт в базовую единицу')
  const p = boot({})
  p.set({
    expProducts: [
      { id: 'p_osb', name: 'ОСП 18 м²', unitCost: 710, store: 'Белка', mode: 'sheet', packBase: 'м²', packPer: 3.12 },
      { id: 'p_tr', name: 'Труба профильная 40x40', unitCost: 193, store: 'Белка', mode: 'mp', lenPer: 3 },
    ],
    estimates: [{ id: 'e_osb', kind: 'house', name: 'Обшивка стен ОСП', stage: 2,
      lines: [{ id: 'l1', pid: 'p_osb', qty: 30 }, { id: 'l2', pid: 'p_tr', qty: 12 }] }],
    dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [],
    purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
  })
  create(p, 'Дом с листами')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const html = p.run('tProjects()').replace(/[  ]/g, ' ')

  t.ok('листы переведены в квадраты', /= 93,6 м²/.test(html), 'нет пересчёта листов')
  t.ok('а метраж — в хлысты', /≈ 4 хлыст/.test(html), 'нет пересчёта метража')
  // Штучному товару переводить не во что — лишней подписи быть не должно.
  t.ok('у штучного подписи нет', (html.match(/= \d/g) || []).length === 1,
    JSON.stringify(html.match(/= [^<]+/g)))

  // В карточке не заполнено «1 лист = ? м²» — молчать нельзя: вопрос никуда не
  // делся, а молчащая строка выглядит так, будто пересчёта не бывает.
  p.run('delete expProducts.filter(function(x){return x.id==="p_osb";})[0].packPer;')
  const gap = p.run('tProjects()').replace(/[\u00a0\u202f]/g, ' ')
  t.ok('без коэффициента строка зовёт в карточку',
    gap.indexOf('data-a="est-mat-card" data-p="p_osb"') >= 0, 'нет приглашения заполнить')
  t.ok('и говорит, чего не хватает', /= \? м²/.test(gap), JSON.stringify(gap.match(/= [^<]+/g)))
}

// ── Материалы читаются блоком своей работы ──────────────────────────────────
// Четыре работы подряд с материалами шли одной белой простынёй, и где кончается
// состав одной и начинается состав другой, полоска в пиксель не говорила.
// Экран сметы у двух разделов ОДИН: то же сторожит test-spec2-smeta.
{
  t.section('Состав работы — свой блок')
  const p = panel(RULES)
  create(p, 'Дом с блоками материалов')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const html = p.run('tProjects()')

  t.ok('у списка своя рейка слева', /border-left:3px solid #c9d6e4/.test(html), 'нет рейки')
  t.ok('и своя подложка', /background:#f7fafc/.test(html), 'нет подложки')
  t.ok('блок подписан', /СОСТАВ · \d/.test(html), 'нет подписи блока')
  // Свёрнутый список никакого блока не рисует: он про раскрытые материалы.
  const shut = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); shut.onclick()
  t.ok('свёрнутый состав блока не оставляет',
    !/border-left:3px solid #c9d6e4/.test(p.run('tProjects()')), 'блок остался после сворачивания')
}

// ── Рулон называется рулоном ────────────────────────────────────────────────
// Режим товара говорит, как он СЧИТАЕТСЯ, а не как называется на складе.
// «≈ 0,4 лист» у рулона пароизоляции читается как ошибка расчёта, хотя число
// верное, — и человек идёт перепроверять то, что и так посчитано правильно.
{
  t.section('Слово одной покупки')
  const p = boot({})
  p.set({
    expProducts: [
      { id: 'p_film', name: 'Пароизоляция', unitCost: 20, store: 'Лемана ПРО', mode: 'm2',
        sheetM2: 60, packName: 'рулон' },
      { id: 'p_wool', name: 'Утеплитель', unitCost: 1081, store: 'Лемана ПРО', mode: 'pack',
        packBase: 'м²', packPer: 6, packName: 'мешок' },
    ],
    estimates: [{ id: 'e_w', kind: 'house', name: 'Пароизоляция стен', stage: 2,
      lines: [{ id: 'l1', pid: 'p_film', qty: 25 }, { id: 'l2', pid: 'p_wool', qty: 2 }] }],
    dbPlans: [], crmClients: [{ id: 'c1', name: 'Иванов' }], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], objects: [], templates: [], contractDocs: [],
    purchases: [], issues: [], users: [], stock: [], settings: { specMarkup: 30 },
  })
  create(p, 'Дом с рулонами')
  p.run('projBand="parts";')
  const key = p.q('allPositions(projects[0], specCtx(projects[0]))[0].key')
  const openMats = p.dom.node({ a: 'est-mats-open', k: key }); p.run('bind();'); openMats.onclick()
  const html = p.run('tProjects()').replace(/[  ]/g, ' ')

  t.ok('пересчёт называет рулон рулоном', /≈ 0,5 рулон/.test(html),
    JSON.stringify(html.match(/≈ [^<]+/g)))
  t.ok('и слова «лист» рядом нет', !/≈ [\d,]+ лист/.test(html), 'остался «лист»')
  // У пачки слово — это её единица: и в цене, и в количестве.
  t.ok('пачка зовётся мешком', /₽\/мешок/.test(html), JSON.stringify(html.match(/₽\/[^<]+/g)))

  // Слова нет — остаётся умолчание по режиму, как было.
  p.run('delete expProducts.filter(function(x){return x.id==="p_film";})[0].packName;')
  t.ok('без слова — прежний «лист»',
    /≈ 0,5 лист/.test(p.run('tProjects()').replace(/[  ]/g, ' ')), 'умолчание сломалось')
}

// ── Комната, которой в этапе ещё нет ────────────────────────────────────────
// Блок помещения рождается вместе с ПЕРВОЙ работой в нём, и до неё комнаты на
// экране не существует: «добавьте зал» упирается в то, что зала нигде не видно —
// он есть только в чертеже. Экран сметы у двух разделов ОДИН: то же самое
// сторожит test-spec2-smeta.
{
  t.section('Комната добавляется в этап')
  const p = panel([
    { id: 'r_wall', kind: 'house', estId: 'e_osb', what: 'surface', k: 'wall', scope: 'room', qty: 1, stage: 3 },
  ])
  create(p, 'Дом с пустой комнатой')
  p.run('projBand="parts";')
  const stN = 3
  const w = () => p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes}))')
  const rooms = w().rooms || []
  t.ok('у дома есть комнаты', rooms.length >= 2, 'комнат: ' + rooms.length)

  // Приписываем ВСЕ работы одной комнате — остальные остаются без блока.
  const keys = p.q('allPositions(projects[0], specCtx(projects[0])).map(function(x){return x.key;})')
  const first = rooms[0].id
  p.run('projects[0].posRoom=' + JSON.stringify(keys.reduce((a, k) => (a[k] = first, a), {})) + ';')
  const st = () => p.q('works2(projects[0], Object.assign(specCtx(projects[0]),{winTypes:winTypes})).stages.filter(function(s){return s.n===' + stN + ';})[0]')
  const blocks = (st() || {}).blocks || []
  t.ok('блок остался один', blocks.length === 1, 'блоков: ' + blocks.length)

  const html = p.run('tProjects()')
  const missing = rooms.filter((r) => !blocks.some((b) => b.key === r.id))[0]
  t.ok('пустые комнаты предложены', /ЕЩЁ КОМНАТЫ:/.test(html), 'нет ряда пустых комнат')
  t.ok('и среди них та, которой нет в этапе',
    html.indexOf('data-a="est-pos-add-open" data-k="' + p.q('projects[0].id') + '@' + stN + '|' + missing.id + '"') >= 0,
    'комнаты ' + missing.name + ' в предложении нет')

  // Тап заводит работу сразу в эту комнату — блок появляется вместе с ней.
  const add = p.dom.node({ a: 'est-pos-add-open', k: p.q('projects[0].id') + '@' + stN + '|' + missing.id })
  p.run('bind();'); add.onclick()
  t.ok('форма раскрылась', p.run('tProjects()').indexOf('id="pad-n"') >= 0, 'нет формы работы')
  p.dom.field('pad-n', 'Уборка после отделки'); p.dom.field('pad-cost', '3000')
  const doIt = p.dom.node({ a: 'est-pos-add-do', k: p.q('projects[0].id') + '@' + stN + '|' + missing.id })
  p.run('bind();'); doIt.onclick()

  const after = (st() || {}).blocks || []
  t.ok('блок комнаты появился', after.some((b) => b.key === missing.id),
    JSON.stringify(after.map((b) => b.room)))
  t.ok('и работа лежит в нём',
    after.filter((b) => b.key === missing.id)[0].positions.some((x) => /Уборка/.test(x.name)))
  // Из ряда «ещё комнаты» она ушла: блок у неё теперь есть. Смотрим именно ряд —
  // тот же адрес есть и у «+» в шапке появившегося блока.
  // Ряд «ещё комнаты» есть в КАЖДОМ этапе (в другом этапе этой комнаты по-прежнему
  // нет), поэтому смотрим только на разбираемый: остальные сворачиваем.
  p.run('stageOpen={' + stN + ':1};')
  const tail = p.run('tProjects()')
  const row = tail.slice(tail.indexOf('ЕЩЁ КОМНАТЫ:'))
  t.ok('а из «ещё комнат» она ушла',
    tail.indexOf('ЕЩЁ КОМНАТЫ:') < 0 || row.slice(0, row.indexOf('</div>')).indexOf(missing.id) < 0,
    'комната осталась в предложении')
}

// ── Деньги проекта = его состав ──────────────────────────────────────────────
// Полоса «Деньги» и полоса «Состав» обязаны называть ОДНУ цифру: по «Деньгам»
// заводится договор, по «Составу» собирается объект. Разъедься они — договор
// подписан на одну сумму, а строят по другой, и находится это на приёмке этапа.
//
// Ломалось это дважды и по-разному, поэтому проверок две. Проект живёт в своей
// коллекции (`projects`), и `specIs2` его не узнавал — «Деньги» уходили в боевой
// `sheetTotals(sh, …)` мимо модели, правил, пирогов и правок листа. А сам
// `totals2` при пустых правилах уходил туда же коротким путём — и терял пироги,
// дописанные руками работы и правки листа уже у любого дома.
{
  t.section('Деньги проекта считаются его же составом')

  const withRules = panel(RULES)
  create(withRules)
  const wr = 'works2(projects[0], specCtx(projects[0]))'
  t.ok('с правилами: себестоимость та же',
    withRules.q('specTot(projects[0]).cost') === withRules.q(wr + '.cost') && withRules.q(wr + '.cost') > 0,
    withRules.q('specTot(projects[0]).cost') + ' / ' + withRules.q(wr + '.cost'))
  t.ok('с правилами: цена клиенту та же',
    withRules.q('specTot(projects[0]).price') === withRules.q(wr + '.price'))
  t.ok('и позиций поровну',
    withRules.q('specTot(projects[0]).count') === withRules.q(wr + '.positions.length'))

  // Дом без единого правила — обычный дом, и дописанная в него руками работа
  // обязана попасть в обе полосы: короткий путь её не видел.
  const plain = panel()
  create(plain)
  const pr = 'works2(projects[0], specCtx(projects[0]))'
  const before = plain.q('specTot(projects[0]).cost')
  plain.run('projects[0].posAdd=[{id:"a1", name:"Вывоз мусора", cost:5000, stage:2}];')
  t.ok('без правил: дописанная работа попала в состав',
    plain.q(pr + '.cost') === before + 5000, String(plain.q(pr + '.cost')) + ' было ' + before)
  t.ok('и в деньги тоже',
    plain.q('specTot(projects[0]).cost') === plain.q(pr + '.cost'),
    plain.q('specTot(projects[0]).cost') + ' / ' + plain.q(pr + '.cost'))

  // Договор берёт цену оттуда же — это и есть цена расхождения.
  t.ok('договор завёлся бы на сумму состава',
    plain.q('specTot(projects[0]).price') === plain.q(pr + '.price'))
}

t.done()
