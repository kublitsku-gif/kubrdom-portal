#!/usr/bin/env node
// Шаблон договора (public/admin.js): заказчик — физлицо ИЛИ юрлицо. Раньше преамбула
// и реквизиты собирались жёстко как «Гражданин (ка) …, паспорт …», и договор с ООО
// (безнал) выписать было нельзя. Сторожим: физлицо не изменилось, у юрлица в шапке
// ИНН/КПП/ОГРН и «в лице», в п. 12 банковские реквизиты и М.П., слова «Гражданин» и
// «паспорт» не всплывают, и в портал уходит название организации, а не пустое ФИО.
//
// Плюс дедлайн: он считается локальным календарём, и раньше уезжал на день назад,
// потому что обратно в строку его клали через toISOString() (UTC). Набор гоняем
// в МСК принудительно — в UTC-поясе (CI, воркер) баг не воспроизводится вовсе.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { boot, reporter } from './harness/panel-vm.js'

const TZ = 'Europe/Moscow'
if (process.env.TZ !== TZ) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)],
    { stdio: 'inherit', env: { ...process.env, TZ } })
  process.exit(r.status === null ? 1 : r.status)
}

const t = reporter()

const ORG = {
  clientKind: 'org',
  orgName: 'Общество с ограниченной ответственностью "РУЗСКОЕ ОХОТНИЧЬЕ РЫБОЛОВНОЕ ХОЗЯЙСТВО"',
  orgShort: 'ООО "РУЗСКОЕ ОРХ"',
  orgInn: '5075020003', orgKpp: '507501001', orgOgrn: '1115075001975',
  orgAddress: '143103, Московская обл., г. Руза, пер. Интернациональный, д. 5, офис 8',
  orgRepr: 'генерального директора Лаврентьева Александра Александровича',
  orgBasis: 'Устава',
  orgSigner: 'Генеральный директор Лаврентьев А.А.',
  orgBank: 'ПАО СБЕРБАНК', orgBik: '044525225',
  orgAcc: '40702810138260016651', orgCorr: '30101810400000000225',
  orgEmail: 'Ushenkova78@rambler.ru', phone: '89107165166',
  num: '1909-1/26', date: '2026-09-19', amount: 1730000, objType: 'house',
  payments: [{ amount: 600000, note: 'первый этап' }, { amount: 1130000, note: 'остальное' }],
}
const PERSON = {
  clientKind: 'person', fio: 'Иванов Иван Иванович', citizenship: 'РФ',
  dob: '1981-07-21', passport: '4521 363664', passportIssued: 'ГУ МВД России по г. Москве',
  passportDate: '2021-07-08', passportCode: '770-094', regAddress: 'г. Москва, ул. Кулакова, д. 15',
  phone: '+79032599333', num: '1909-1/26', date: '2026-09-19', amount: 900000,
  payments: [{ amount: 900000, note: 'единым платежом' }],
}

function panel(draft) {
  const p = boot({})
  p.set({
    users: [{ id: 'u1', name: 'Юрий', roles: ['admin'], c: '#000', av: '👨', objs: [] }],
    roles: [{ id: 'admin', n: 'Админ' }],
    crmClients: [{ id: 'k1', name: 'ООО "РУЗСКОЕ ОРХ"', phone: '89107165166', stage: 'contract', source: '', notes: '', msg: '' }],
    objects: [], contractDocs: [], templates: [], settings: {},
    finTxns: [], receipts: [], issues: [], purchases: [], estimates: [], expProducts: [],
    specSheets: [], specSheets2: [], projects: [], buildRules: [], winTypes: [], dbPlans: [],
  })
  p.run('tab="contracts";ctSubTab="template";ctTpl=Object.assign(ctTplDefaults(),' + JSON.stringify(draft) + ');')
  return p
}
const doc = (p) => p.q('ctTplDocHtml()')
// esc() превращает кавычки названия в &quot; — для проверок возвращаем их обратно,
// иначе регулярка про «ООО "…"» не совпадёт ни с чем.
const plain = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')

{
  t.section('Физлицо — как было')
  const p = panel(PERSON)
  const h = plain(doc(p))
  t.ok('преамбула с гражданством и ФИО', /Гражданин \(ка\) РФ Иванов Иван Иванович/.test(h), h.slice(0, 400))
  t.ok('паспорт в преамбуле', /паспорт серия и номер: 4521 363664/.test(h))
  t.ok('род «именуемый (-ая)»', /именуемый \(-ая\) в дальнейшем «Заказчик»/.test(h))
  t.ok('реквизиты с адресом регистрации', /Адрес регистрации: г. Москва, ул. Кулакова/.test(h))
  t.ok('подпись заказчика без М.П.', h.indexOf('Заказчик _________________') >= 0 && !/М\.П\.[^]*Заказчик/.test(''))
  t.ok('имя для портала — ФИО', p.q('ctTplClientName()') === 'Иванов Иван Иванович')
}

{
  t.section('Юрлицо — реквизиты вместо паспорта')
  const p = panel(ORG)
  const raw = doc(p)
  const h = plain(raw)
  t.ok('полное название в шапке', /Общество с ограниченной ответственностью "РУЗСКОЕ/.test(h), h.slice(0, 500))
  t.ok('ИНН, КПП, ОГРН в преамбуле', /ИНН 5075020003, КПП 507501001, ОГРН 1115075001975/.test(h))
  t.ok('юридический адрес в преамбуле', /юридический адрес: 143103, Московская обл/.test(h))
  t.ok('в лице и на основании Устава', /в лице генерального директора Лаврентьева Александра Александровича, действующего на основании Устава/.test(h))
  t.ok('род «именуемое»', /именуемое в дальнейшем «Заказчик»/.test(h))
  t.ok('нет слова «Гражданин»', h.indexOf('Гражданин') < 0, h.slice(0, 500))
  t.ok('нет паспорта заказчика', h.indexOf('паспорт серия и номер') < 0)
  t.ok('в п.12 расчётный счёт и БИК', /Расчетный счет: 40702810138260016651/.test(h) && /БИК: 044525225/.test(h))
  t.ok('в п.12 корр. счёт и банк', /Название банка: ПАО СБЕРБАНК/.test(h) && /Корреспондентский счет: 30101810400000000225/.test(h))
  t.ok('подпись с должностью и М.П.', /Заказчик ____________ \/ Генеральный директор Лаврентьев А.А. \/ М.П./.test(h), h.slice(-600))
  t.ok('реквизиты исполнителя не тронуты', /ИП Кублицкая Любовь Евгеньевна/.test(h))
  t.ok('сумма прописью', /Один миллион семьсот тридцать тысяч рублей 00 копеек/.test(h))
}

{
  t.section('Юрлицо в форме и в портале')
  const p = panel(ORG)
  const form = p.q('tContractTemplate()')
  t.ok('переключатель заказчика есть', form.indexOf('data-a="ct-tpl-clientkind"') >= 0)
  t.ok('показаны поля юрлица', form.indexOf('id="ct-tpl-orgInn"') >= 0 && form.indexOf('id="ct-tpl-orgAcc"') >= 0)
  t.ok('паспортных полей нет', form.indexOf('id="ct-tpl-passport"') < 0)
  t.ok('имя заказчика — сокращённое название', p.q('ctTplClientName()') === 'ООО "РУЗСКОЕ ОРХ"')
  t.ok('в карточке портала видно организацию', form.indexOf('ООО &quot;РУЗСКОЕ ОРХ&quot;') >= 0 || form.indexOf('ООО "РУЗСКОЕ ОРХ"') >= 0)

  p.run('ctTplToPortal();')
  const cards = p.q('contractDocs')
  t.ok('карточка заведена', cards.length === 1, JSON.stringify(cards))
  t.ok('клиент карточки — организация', cards[0] && cards[0].client === 'ООО "РУЗСКОЕ ОРХ"')
  t.ok('привязался CRM-клиент по названию', cards[0] && cards[0].crmClientId === 'k1')
  t.ok('сумма договора в карточке', cards[0] && cards[0].amount === 1730000)
}

{
  t.section('Форма физлица без полей юрлица')
  const p = panel(PERSON)
  const form = p.q('tContractTemplate()')
  t.ok('паспортные поля на месте', form.indexOf('id="ct-tpl-passport"') >= 0 && form.indexOf('id="ct-tpl-regAddress"') >= 0)
  t.ok('полей юрлица нет', form.indexOf('id="ct-tpl-orgInn"') < 0)
}

{
  t.section('Акт сдачи-приёмки для юрлица')
  const p = panel(Object.assign({}, ORG, { docType: 'act', actStage: -1, actAddress: 'г. Руза, уч. 12' }))
  const h = plain(p.q('ctActDocHtml()'))
  t.ok('организация в преамбуле акта', /ООО "РУЗСКОЕ ОРХ", ИНН 5075020003, в лице генерального директора/.test(h), h.slice(0, 400))
  t.ok('в акте нет паспорта', h.indexOf('Паспорт РФ') < 0 && h.indexOf('Гражданин') < 0)
  t.ok('в подписном блоке реквизиты организации', /ИНН: 5075020003 · КПП: 507501001/.test(h))
  t.ok('адрес установки остался', /адрес: г. Руза, уч. 12/.test(h))
}

{
  t.section('Дедлайн договора — локальный календарь, не UTC')
  // Тот самый случай из договора № 1909-1/26: 19.09.2026 + 60 рабочих дней.
  // Локально это пятница 11 декабря; toISOString() в МСК отдавал «2026-12-10».
  const p = panel(Object.assign({}, PERSON, { date: '2026-09-19', workDays: 60 }))
  t.ok('пояс набора — МСК', new Date('2026-12-11T00:00:00').getTimezoneOffset() === -180,
    String(new Date('2026-12-11T00:00:00').getTimezoneOffset()))
  t.ok('60 рабочих дней от 19.09.2026 → 11.12.2026', p.q('ctTplDeadline()') === '2026-12-11', p.q('ctTplDeadline()'))
  t.ok('день недели совпадает с расчётным (пятница)',
    new Date(p.q('ctTplDeadline()') + 'T00:00:00').getDay() === 5)
  t.ok('в карточку портала уходит тот же дедлайн',
    (p.run('ctTplToPortal();contractDocs[contractDocs.length-1].deadlineDate')) === '2026-12-11')

  // Круглый год: ни один день не должен съезжать назад — это ловит и UTC-сдвиг,
  // и переход на летнее время в поясах, где оно есть.
  let shifted = null
  for (let i = 0; i < 366 && !shifted; i++) {
    const start = new Date(2026, 0, 1 + i)
    const iso = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0')
    const got = panel(Object.assign({}, PERSON, { date: iso, workDays: 45 })).q('ctTplDeadline()')
    const want = new Date(start); let left = 45
    while (left > 0) { want.setDate(want.getDate() + 1); const wd = want.getDay(); if (wd !== 0 && wd !== 6) left-- }
    const wantIso = want.getFullYear() + '-' + String(want.getMonth() + 1).padStart(2, '0') + '-' + String(want.getDate()).padStart(2, '0')
    if (got !== wantIso) shifted = iso + ': ' + got + ' вместо ' + wantIso
  }
  t.ok('45 рабочих дней от любой даты 2026 года — без сдвига', !shifted, shifted || '')
}

{
  t.section('Сегодня и рабочие дни — те же правила')
  const p = panel(PERSON)
  const now = new Date()
  const iso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
  // Вечером после 21:00 МСК UTC-дата — уже вчерашняя; todayISO() обязан дать сегодня.
  t.ok('todayISO() — сегодня по местному календарю', p.q('todayISO()') === iso, p.q('todayISO()') + ' ≠ ' + iso)
  t.ok('дата договора по умолчанию — сегодня', p.q('ctTplDefaults().date') === iso)
  t.ok('дата акта по умолчанию — сегодня', p.q('ctTplDefaults().actDate') === iso)
  // Дедлайн бригадира (тот же расчёт, другая точка входа).
  t.ok('addBusinessDays: 19.09.2026 + 60 → 11.12.2026',
    p.q('addBusinessDays("2026-09-19",60)') === '2026-12-11', p.q('addBusinessDays("2026-09-19",60)'))
  t.ok('addBusinessDays: 1 рабочий день от пятницы — понедельник',
    p.q('addBusinessDays("2026-09-18",1)') === '2026-09-21', p.q('addBusinessDays("2026-09-18",1)'))
  t.ok('кривая дата — пустая строка, а не «NaN-NaN-NaN»', p.q('addBusinessDays("не дата",5)') === '')
}

{
  t.section('Печать: оверлей вместо всплывающего окна')
  // Всплывающее окно глушат встроенные браузеры и iOS, причём молча — кнопка
  // «Сформировать договор» переставала работать. Документ должен рисоваться в
  // оверлее поверх панели, а window.open не звать вовсе.
  const p = panel(ORG)
  p.run('__opened=0; window.open=function(){__opened++; return null;};'
    + '__made=[]; var _ce=document.createElement.bind(document);'
    + 'document.createElement=function(tag){const e=_ce(tag); __made.push({tag:tag,e:e}); return e;};')
  p.run('ctTplOpenPrint();')
  const info = p.q('(function(){'
    + 'const f=__made.filter(function(x){return x.tag==="iframe";}).pop();'
    + 'const doc=f?String(f.e.srcdoc||""):"";'
    + 'return {opened:__opened, overlay:!!document.getElementById("ct-doc-overlay"), len:doc.length,'
    + ' num:doc.indexOf("1909-1/26")>=0, org:doc.indexOf("\u0420\u0423\u0417\u0421\u041a\u041e\u0415")>=0,'
    + ' hidesToolbar:doc.indexOf(".toolbar{display:none!important}")>=0};})()')
  t.ok('всплывающее окно не открывается', info.opened === 0, JSON.stringify(info))
  t.ok('диалог печати сам не всплывает', p.q('typeof __made.filter(function(x){return x.tag==="iframe";}).pop().e.onload') === 'undefined')
  t.ok('оверлей на странице', info.overlay === true)
  t.ok('документ отдан в iframe', info.len > 5000, JSON.stringify(info))
  t.ok('в документе номер и заказчик', info.num && info.org)
  t.ok('внутренний тулбар документа спрятан', info.hidesToolbar === true, JSON.stringify(info))

  // Повторный вызов не должен копить оверлеи друг на друге
  p.run('ctTplOpenPrint();')
  const again = p.q('__made.filter(function(x){return x.tag==="iframe";}).length')
  t.ok('второй вызов рисует новый iframe', again === 2)
  t.ok('окно так и не открывалось', p.q('__opened') === 0)

  // Акт печатается тем же путём
  p.run('ctTplGet().docType="act"; ctTplGet().actStage=-1; ctActOpenPrint();')
  t.ok('акт тоже без окна', p.q('__opened') === 0)
  t.ok('акт отрисован в оверлее', p.q('__made.filter(function(x){return x.tag==="iframe";}).length') === 3)
}

t.done()
