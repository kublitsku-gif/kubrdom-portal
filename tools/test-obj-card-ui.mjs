#!/usr/bin/env node
// Экран объекта (public/admin.js): 3 934 px и 91 кнопка на «Бане с хозблоком» — пять
// экранов телефона, и половину верха занимали раскрытые вопросы с формами ответа.
// Сторожим короткий экран: свёрнутые вопросы, заголовок вместо формы, сделанные работы
// и комнаты под свёрткой, нехватку материалов по тапу, липкую строку объекта, скрытые
// верхние вкладки — и две давние помарки: «2 работ» и уезжающую вправо шапку этапа.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()
const mat = (id, n) => ({ id, n, qty: 2, cost: 500, store: 'Лемана ПРО' })

function panel() {
  const p = boot({})
  p.set({
    users: [{ id: 'u1', name: 'Инна', roles: ['brigadier'], c: '#8e44ad', av: '👩', objs: ['o1'] }],
    roles: [{ id: 'brigadier', n: 'Бригадир' }],
    objects: [{
      id: 'o1', icon: '🛁', name: 'Баня с хозблоком', stages: [
        { id: 's1', n: 'ЭТАП 2 — ЧЕРНОВЫЕ РАБОТЫ', c: '#2980b9', works: [
          { id: 'w1', n: 'Монтаж обрешётки', cost: 5000, done: true, doneAt: '2026-09-01', mats: [], timeLogs: [] },
          { id: 'w2', n: 'Монтаж стен из ОСП', cost: 6006, done: false, mats: [mat('m1', 'ОСП 9 мм')], timeLogs: [] },
        ] },
        { id: 's2', n: 'ЭТАП 3 — ЧИСТОВЫЕ РАБОТЫ', c: '#27ae60', works: [
          { id: 'w3', n: 'Стены парной — вагонка', room: 'Парная', cost: 1000, done: true, doneAt: '2026-09-02', mats: [], timeLogs: [] },
          { id: 'w4', n: 'Монтаж полков', room: 'Парная', cost: 2000, done: false, mats: [mat('m2', 'Полок Липа 26×90')], timeLogs: [] },
        ] },
      ],
    }],
    issues: [
      { id: 'i1', objId: 'o1', kind: 'supply', text: 'Не хватает плитки 2 кв за печкой', status: 'work', src: 'bot', by: 'yuriy', byName: 'Юрий', at: '2026-09-01 10:00', payer: 'company', amount: 4000 },
      { id: 'i2', objId: 'o1', kind: 'question', text: 'Сколько уголков заказать?', status: 'new', src: 'bot', by: 'yuriy', byName: 'Юрий', at: '2026-09-02 10:00' },
    ],
    templates: [], contractDocs: [], crmClients: [], purchases: [], purchased: {}, arrived: {},
    finTxns: [], receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {}, stock: [],
  })
  p.run('tab="objects";openObject="o1";objWorkView="works";')
  return p
}
const view = (p) => p.run('tObjects()')
const plain = (h) => h.replace(/<[^>]*>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')
const click = (p, ds) => { const n = p.dom.node(ds); p.run('bind();'); n.onclick && n.onclick({ stopPropagation() {}, target: {} }); return n }

{
  t.section('Шапка этапа: склонение и вёрстка')
  const p = panel()
  const h = view(p)
  // «2 работ» было в каждой шапке, хотя склонение в портале давно написано.
  const _stageHead = h.slice(h.indexOf('id="stage-s1"'), h.indexOf('id="stage-s2"'))
  t.ok('«2 работы», а не «2 работ»', /2 работы/.test(plain(_stageHead)) && !/2 работ /.test(plain(_stageHead)), plain(_stageHead).slice(0, 300))
  // Правая колонка уезжала за карточку: имени можно было занять всю ширину.
  t.ok('счёт и сумма не сжимаются', /flex-shrink:0/.test(_stageHead), _stageHead.slice(0, 300))
  t.ok('длинное имя обрезается, а не рвётся', /text-overflow:ellipsis[^>]*>ЭТАП 2/.test(_stageHead), _stageHead.slice(0, 400))
  t.ok('счёт и деньги — отдельной строкой', h.indexOf('data-stage-sub') >= 0)
}

{
  t.section('Вопросы свёрнуты, раскрываются по одному')
  const p = panel()
  const h = view(p)
  t.ok('блок свёрнут', /ВОПРОСЫ ПО ОБЪЕКТУ/.test(plain(h)) && h.indexOf('data-a="iss-answer"') < 0, plain(h).slice(0, 300))
  t.ok('в шапке видно, сколько открытых', /2 открыт/.test(plain(h)))
  click(p, { a: 'obj-sec-toggle', k: 'o1|issues', open: '0' })
  const open = view(p)
  t.ok('раскрыли — вопросы строками', /Не хватает плитки/.test(plain(open)) && open.indexOf('data-a="obj-iss-open" data-iid="i1"') >= 0)
  t.ok('но форма решения ещё не развёрнута', open.indexOf('data-a="iss-payer"') < 0 && open.indexOf('data-a="iss-answer"') < 0)
  click(p, { a: 'obj-iss-open', iid: 'i1' })
  const one = view(p)
  t.ok('открыли один — появились суммы и кнопки', one.indexOf('data-a="iss-payer" data-iid="i1"') >= 0 && one.indexOf('data-a="iss-answer" data-iid="i1"') >= 0)
  t.ok('второй остался строкой', one.indexOf('data-a="iss-answer" data-iid="i2"') < 0)
}

{
  t.section('Заголовок объекта вместо формы')
  const p = panel()
  const h = view(p)
  t.ok('имя — заголовком', /Баня с хозблоком/.test(plain(h)) && h.indexOf('id="obj-name-o1"') < 0)
  // Имя живёт в липкой строке; вторая копия в карточке под ней накладывалась на неё.
  t.ok('имя не задвоено', (h.match(/>Баня с хозблоком</g) || []).length === 1, String((h.match(/>Баня с хозблоком</g) || []).length))
  t.ok('правка — по карандашу', h.indexOf('data-a="obj-head-edit" data-oid="o1"') >= 0)
  click(p, { a: 'obj-head-edit', oid: 'o1' })
  const edit = view(p)
  t.ok('в правке — поле, иконка и сохранение', edit.indexOf('id="obj-name-o1"') >= 0 && edit.indexOf('id="obj-icon-o1"') >= 0 && edit.indexOf('data-a="save-obj-info"') >= 0)
}

{
  t.section('Сделанные работы — под свёрткой')
  const p = panel()
  const h = view(p)
  t.ok('закрытая работа не занимает место', !/Монтаж обрешётки/.test(plain(h)), plain(h).slice(0, 500))
  t.ok('но видно, сколько сделано', h.indexOf('data-a="obj-done-open" data-sid="s1"') >= 0 && /Сделано 1/.test(plain(h)))
  click(p, { a: 'obj-done-open', sid: 's1' })
  t.ok('раскрыли — работа на месте', /Монтаж обрешётки/.test(plain(view(p))))
}

{
  t.section('Комнаты сворачиваются')
  const p = panel()
  const h = view(p)
  // Ключ комнаты портал выводит из названия работы — берём его из разметки, а не гадаем.
  const _rk = (h.match(/data-a="obj-room-toggle" data-k="(s2:[^"]+)"/) || [])[1]
  t.ok('комната — кнопка', !!_rk, plain(h).slice(plain(h).indexOf('ЧИСТОВЫЕ'), plain(h).indexOf('ЧИСТОВЫЕ') + 200))
  t.ok('работы комнаты видны', /Монтаж полков/.test(plain(h)))
  click(p, { a: 'obj-room-toggle', k: _rk })
  const _after = view(p)
  t.ok('свернули — работы скрыты, комната осталась',
    !/Монтаж полков/.test(plain(_after)) && _after.indexOf('data-a="obj-room-toggle" data-k="' + _rk + '"') >= 0, plain(_after).slice(0, 300))
}

{
  t.section('Чего не хватает — по тапу')
  const p = panel()
  const h = view(p)
  // «Не куплено» в шапке этапа — это чип закупки; сторожим строку САМОЙ работы.
  const _row = h.slice(h.indexOf('Монтаж стен из ОСП'), h.indexOf('Монтаж стен из ОСП') + 1500)
  t.ok('на строке только чип «ждём»', /ждём 1 из 1/.test(plain(_row)) && !/ОСП 9 мм/.test(plain(_row)), plain(_row).slice(0, 300))
  click(p, { a: 'obj-toggle-mats', wid: 'w4' })
  t.ok('тап раскрывает, чего ждём', /Полок Липа/.test(plain(view(p))))
}

{
  t.section('Липкая строка объекта и верхние вкладки')
  const p = panel()
  const h = view(p)
  t.ok('строка объекта липкая', h.indexOf('data-obj-sticky') >= 0 && /position:sticky/.test(h.slice(h.indexOf('data-obj-sticky') - 200, h.indexOf('data-obj-sticky') + 200)))
  t.ok('в ней имя и процент', /Баня с хозблоком/.test(plain(h)) && /%/.test(plain(h)))
  t.ok('шапки этапов встают под ней', /top:calc\(var\(--stagetop/.test(h), h.slice(h.indexOf('ЭТАП 2') - 500, h.indexOf('ЭТАП 2')).slice(-200))
  // Внутри объекта лента вкладок не нужна: у экрана своя шапка и своя кнопка возврата.
  t.ok('внутри объекта верхних вкладок нет', p.q('topTabsVisible()') === false)
  p.run('openObject=null;')
  t.ok('в списке объектов — есть', p.q('topTabsVisible()') === true)
}

t.done()
