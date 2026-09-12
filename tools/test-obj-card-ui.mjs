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
  t.ok('строка объекта липкая', h.indexOf('data-obj-sticky') >= 0 && /position:sticky/.test(h.slice(Math.max(0, h.indexOf('data-obj-sticky') - 200), h.indexOf('data-obj-sticky') + 200)))
  t.ok('в ней имя и процент', /Баня с хозблоком/.test(plain(h)) && /%/.test(plain(h)))
  t.ok('шапки этапов встают под ней', /top:calc\(var\(--stagetop/.test(h), h.slice(h.indexOf('ЭТАП 2') - 500, h.indexOf('ЭТАП 2')).slice(-200))
  // Внутри объекта лента вкладок не нужна: у экрана своя шапка и своя кнопка возврата.
  t.ok('внутри объекта верхних вкладок нет', p.q('topTabsVisible()') === false)
  p.run('openObject=null;')
  t.ok('в списке объектов — есть', p.q('topTabsVisible()') === true)
}

// ── Второй заход: 1 966 px, из них ~740 px управления до первой работы ────────
{
  t.section('Ничего не раскрывается само и не уезжает вбок')
  const p = panel()
  // Дедлайн бригадира просрочен — раньше блок на 217 px открывался сам.
  p.run(`contractDocs=[{id:"c1",name:"Договор № 1",objId:"o1",type:"main",status:"signed",amount:100000,client:"Клиент",responsible:["u1"],salaries:{},extraWorks:[],files:[],deadlines:{u1:{startDate:"2026-07-25",deadline:"2026-08-31"}}}];`)
  const h = view(p)
  t.ok('ни один раздел не раскрыт сам', h.indexOf('data-open="1"') < 0, plain(h).slice(0, 300))
  t.ok('просрочка видна чипом', /просрочка/i.test(plain(h)) && !/ШТРАФ/.test(plain(h)))
  t.ok('липкая строка не шире колонки', h.indexOf('margin:-4px -14px') < 0 && h.indexOf('data-obj-sticky') >= 0)
}

{
  t.section('Меньше повторов: прогресс, отчёт дня, шаблон')
  const p = panel()
  // Отчёт дня рисуется, когда на объекте есть подписанный договор с ответственными,
  // связь с шаблоном — когда объект создан из шаблона.
  p.run(`contractDocs=[{id:"c1",name:"Договор № 1",objId:"o1",type:"main",status:"signed",amount:100000,client:"Клиент",responsible:["u1"],salaries:{},extraWorks:[],files:[]}];templates=[{id:"t1",name:"Баня",stages:[]}];objects[0].templateId="t1";`)
  const h = view(p)
  const txt = plain(h)
  t.ok('«осталось» — только в липкой строке', (txt.match(/осталось/gi) || []).length === 1, String((txt.match(/осталось/gi) || []).length))
  t.ok('процент — один раз', (txt.match(/%/g) || []).length === 1, String((txt.match(/%/g) || []).length))
  t.ok('«отчёт дня» и «шаблон» — чипами', h.indexOf('data-a="obj-chip"') >= 0 && /data-key="dayreport"/.test(h) && /data-key="tpldiff"/.test(h))
  t.ok('отдельных блоков под них нет', h.indexOf('data-k="o1|dayreport"') < 0 && h.indexOf('data-k="o1|tpldiff"') < 0)
  t.ok('чипы переносятся, а не обрезаются', /data-obj-chips[^>]*flex-wrap:wrap/.test(h), (h.match(/data-obj-chips[^>]{0,120}/) || [""])[0])
}

{
  t.section('Управление над списком работ')
  const p = panel()
  const h = view(p)
  t.ok('лента этапов не нужна на двух этапах', h.indexOf('data-a="obj-stage-jump"') < 0)
  p.run(`objects[0].stages=objects[0].stages.concat([{id:"s3",n:"ЭТАП 4",c:"#8e44ad",works:[{id:"w9",n:"Работа",cost:1,mats:[],timeLogs:[]}]},{id:"s4",n:"ЭТАП 5",c:"#16a085",works:[{id:"w10",n:"Работа",cost:1,mats:[],timeLogs:[]}]}]);`)
  t.ok('на четырёх — появляется', view(p).indexOf('data-a="obj-stage-jump"') >= 0)

  const p2 = panel()
  const h2 = view(p2)
  t.ok('фильтры одним блоком', /data-work-filters/.test(h2) &&
    h2.slice(h2.indexOf('data-work-filters')).indexOf('data-a="obj-ready-filter"') < h2.slice(h2.indexOf('data-work-filters')).indexOf('ПЕРЕЧЕНЬ') + 4000)
  t.ok('поиск спрятан за иконкой', h2.indexOf('id="obj-work-search"') < 0 && h2.indexOf('data-a="obj-search-open"') >= 0)
  click(p2, { a: 'obj-search-open' })
  t.ok('тап — поле поиска на месте', view(p2).indexOf('id="obj-work-search"') >= 0)
}

{
  t.section('Длинные имена и низ экрана')
  const p = panel()
  p.run(`objects[0].stages[0].works[1].n="Монтаж пано можжевеловое, светильники, подсветки и прочее длинное название";`)
  const h = view(p)
  t.ok('имя работы переносится, а не режется', /-webkit-line-clamp:2/.test(h.slice(h.indexOf('Монтаж пано') - 600, h.indexOf('Монтаж пано'))), h.slice(h.indexOf('Монтаж пано') - 300, h.indexOf('Монтаж пано')))
  t.ok('удаление объекта — в меню', h.indexOf('data-a="del-obj"') < 0 && h.indexOf('data-a="obj-menu" data-oid="o1"') >= 0)
  click(p, { a: 'obj-menu', oid: 'o1' })
  t.ok('в меню — удаление', view(p).indexOf('data-a="del-obj" data-oid="o1"') >= 0)
  t.ok('снизу есть запас под плавающей кнопкой', /height:120px/.test(view(p)))
}

// ── Третий заход: 1 493 px; до первой работы ~380 px, закрытые этапы по 159 px ──
{
  t.section('Верх: одна строка объекта вместо трёх блоков')
  const p = panel()
  const h = view(p)
  const sticky = h.slice(h.indexOf('data-obj-sticky'), h.indexOf('data-obj-sticky') + 3000)
  t.ok('«← Объекты» — в строке объекта', h.indexOf('data-a="close-obj"') > h.indexOf('data-obj-sticky') && sticky.indexOf('data-a="close-obj"') >= 0)
  t.ok('полоса прогресса — в ней же', sticky.indexOf('data-obj-bar') >= 0)
  t.ok('отдельной карточки прогресса нет', !/из 4 работ сделано/.test(plain(h)) && /2 из 4 работ/.test(plain(sticky)), plain(sticky).slice(0, 200))
  t.ok('процент — один раз', (plain(h).match(/%/g) || []).length === 1)
  t.ok('правка и этап — не на виду', h.indexOf('data-a="obj-edit-toggle"') < 0 && h.indexOf('data-a="obj-add-stage"') < 0 && !/ПЕРЕЧЕНЬ РАБОТ/.test(plain(h)))
  click(p, { a: 'obj-menu', oid: 'o1' })
  const menu = view(p)
  t.ok('а в меню «⋯»', menu.indexOf('data-a="obj-edit-toggle" data-oid="o1"') >= 0 && menu.indexOf('data-a="obj-add-stage" data-oid="o1"') >= 0)
  click(p, { a: 'obj-edit-toggle', oid: 'o1' })
  t.ok('в режиме правки «Готово» видно без меню', /data-a="obj-edit-toggle" data-oid="o1"[^>]*>[^<]*Готово/.test(view(p)))
  const f = h.slice(h.indexOf('data-work-filters'), h.indexOf('data-work-filters') + 4000)
  t.ok('🔍 — в ряду фильтров', f.indexOf('data-a="obj-search-open"') >= 0 && f.indexOf('data-a="obj-search-open"') < f.indexOf('</div>'))
  t.ok('подписи фильтров не мельче 10 px', !/font-size:[89](\.\d)?px/.test(f.slice(0, f.indexOf('</div>'))), (f.match(/font-size:[\d.]+px/g) || []).join(','))
}

{
  t.section('Закрытый этап — одной строкой')
  const p = panel()
  p.run('objects[0].stages[0].works[1].done=true;objects[0].stages[0].works[1].doneAt="2026-09-03";')
  const h = view(p)
  t.ok('свёрнут: кнопка вместо карточки', h.indexOf('data-a="obj-stage-open" data-sid="s1"') >= 0 && !/Монтаж стен из ОСП/.test(plain(h)))
  t.ok('в строке — имя и счёт', /ЭТАП 2 — ЧЕРНОВЫЕ РАБОТЫ/.test(plain(h)) && /2 работы/.test(plain(h.slice(h.indexOf('data-a="obj-stage-open"'), h.indexOf('data-a="obj-stage-open"') + 1500))))
  t.ok('приёмку запросить можно и из свёрнутого', h.indexOf('data-a="obj-stage-ask-accept" data-oid="o1" data-sid="s1"') >= 0)
  click(p, { a: 'obj-stage-open', sid: 's1' })
  const o = view(p)
  const st = o.slice(o.indexOf('id="stage-s1"'), o.indexOf('id="stage-s2"'))
  t.ok('раскрыли — этап на месте', st.indexOf('data-stage-sub') >= 0 && st.indexOf('data-a="obj-done-open" data-sid="s1"') >= 0)
  t.ok('кнопка приёмки не в шапке, а во второй строке', st.indexOf('data-a="obj-stage-ask-accept"') > st.indexOf('data-stage-sub'))
  t.ok('в закрытый этап работу не добавляют', st.indexOf('data-a="obj-show-work"') < 0 && o.indexOf('data-a="obj-show-work" data-sid="s2"') >= 0)
  const p2 = panel()
  p2.run('objects[0].stages[0].works[1].done=true;')
  p2.run('objWorkSearch="обрешётки";')
  t.ok('при поиске закрытый этап не прячет найденное', /Монтаж обрешётки/.test(plain(view(p2))))
}

{
  t.section('Строки работ: без лишних плашек, замок объяснён')
  const p = panel()
  const h = view(p)
  t.ok('«всё на объекте» не повторяет зелёную полосу', !/всё на объекте/.test(plain(h)))
  t.ok('«ждём» — осталось', /ждём 1 из 1/.test(plain(h)))
  p.run('currentUser=users[0];objReadyFilter="stages";')
  const b = view(p)
  const row = b.slice(b.indexOf('Монтаж стен из ОСП') - 2500, b.indexOf('Монтаж стен из ОСП') + 1500)
  t.ok('замок подписан прямо в строке', /сначала отметьте часы/i.test(plain(row)) && (row.match(/data-a="obj-need-time" data-wid="w2"/g) || []).length >= 2, plain(row).slice(0, 300))
}

{
  t.section('«＋ Запись» ужимается при прокрутке')
  const p = panel()
  const h = view(p)
  t.ok('кнопка с подписью', /data-fab[^>]*>[\s\S]{0,40}Запись/.test(h))
  p.run('_fabMini=true;')
  const m = view(p)
  t.ok('ужатая — без подписи', m.indexOf('data-fab') >= 0 && !/Запись<\/span>/.test(m.slice(m.indexOf('data-fab'), m.indexOf('</button>', m.indexOf('data-fab')))))
}

t.done()
