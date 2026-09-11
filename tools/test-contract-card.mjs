#!/usr/bin/env node
// Карточка договора (src/contract-card.js) — логика без экрана.
//
// Договор без объекта не видят ни стройка, ни закупки, ни финансы объекта, а
// привязать его было некуда нажать: объект создавали в другой вкладке, выбирали
// из плоского списка, где занятые стояли вперемешку со свободными. Сторожим то,
// на чём держится новая карточка: шаги договора и чего не хватает для следующего,
// порядок объектов в выборе, защиту от второго основного договора, имя и шаблон
// объекта из договора, прогресс стройки и даты по-русски.
import { dateRu, CT_STEPS, ctStep, ctMissing, objPickList, mainContractOf, ctObjName, ctTemplateFor, objProgress,
  ctMainConflict, ctOthersOnObject, ctCanBecomeMain, ctPayProgress } from '../src/contract-card.js'

const t = reporterOf()
function reporterOf() {
  let failed = 0
  return {
    section: (n) => console.log(n),
    ok: (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) },
    done: () => { console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли'); process.exit(failed ? 1 : 0) },
  }
}

const TODAY = '2026-09-11'
const work = (o) => Object.assign({ id: 'w', n: 'Работа', done: false, timeLogs: [] }, o || {})
const stage = (n, works, o) => Object.assign({ id: 's' + n, n: 'Этап ' + n, works: works }, o || {})

{
  t.section('Даты по-русски')
  t.ok('21 авг 2026', dateRu('2026-08-21') === '21 авг 2026', dateRu('2026-08-21'))
  t.ok('7 дек 2026 — без ведущего нуля', dateRu('2026-12-07') === '7 дек 2026')
  t.ok('мая — в родительном', dateRu('2026-05-01') === '1 мая 2026')
  t.ok('пусто и мусор — пустая строка', dateRu('') === '' && dateRu(null) === '' && dateRu('скоро') === '')
}

{
  t.section('Шаги договора')
  t.ok('четыре шага по порядку', CT_STEPS.map((s) => s.k).join(',') === 'draft,signed,work,closed')
  const noStart = { id: 'o1', stages: [stage(1, [work()])] }
  const started = { id: 'o1', stages: [stage(1, [work({ timeLogs: [{ date: '2026-09-01', h: 4 }] })])] }
  t.ok('черновик — черновик', ctStep({ status: 'draft' }, null) === 'draft')
  t.ok('подписан, стройка не начата — «Подписан»', ctStep({ status: 'signed' }, noStart) === 'signed')
  // «В работе» не хранится: шаг ставится сам, когда на объекте появился первый след работы.
  t.ok('подписан, на объекте есть часы — «В работе»', ctStep({ status: 'signed' }, started) === 'work')
  t.ok('подписан без объекта — не «В работе»', ctStep({ status: 'signed' }, null) === 'signed')
  t.ok('закрыт — закрыт', ctStep({ status: 'closed' }, started) === 'closed')

  const d = ctMissing({ status: 'draft', amount: 0, signDate: '', responsible: [] }, null)
  t.ok('черновику для подписи не хватает объекта, суммы, даты и ответственных',
    d.next === 'Подписан' && d.missing.map((m) => m.k).join(',') === 'obj,amount,signDate,resp', JSON.stringify(d))
  // Договор Кутьина: подписан, а объекта нет — первым делом объект.
  const s = ctMissing({ status: 'signed', amount: 1752000, signDate: '2026-08-21', responsible: ['u1'] }, null)
  t.ok('подписанному без объекта не хватает объекта', s.next === 'В работе' && s.missing[0].k === 'obj', JSON.stringify(s))
  const s2 = ctMissing({ status: 'signed', amount: 1, signDate: '2026-08-21', responsible: ['u1'] }, noStart)
  t.ok('с объектом — сроков этапов и первой работы', s2.missing.map((m) => m.k).join(',') === 'plan,start', JSON.stringify(s2))
  const w = ctMissing({ status: 'signed', responsible: ['u1'] }, { stages: [stage(1, [work({ done: true, doneAt: '2026-09-02' })]), stage(2, [work({ timeLogs: [{ date: '2026-09-05' }] })])] })
  t.ok('в работе — закрыть оставшиеся этапы', w.next === 'Закрыт' && /осталось 1/.test(w.missing[0].t), JSON.stringify(w))
  t.ok('закрытому не хватает ничего', ctMissing({ status: 'closed' }, null).missing.length === 0)
}

{
  t.section('Выбор объекта: порядок')
  const OBJ = [
    { id: 'busy', name: 'Дом 40 футов Олег' },
    { id: 'free', name: 'Баня 6 м Сергей' },
    { id: 'match', name: 'Дом 12 м Кутьин' },
    { id: 'mine', name: 'Дом по безналу' },
  ]
  const CT = [
    { id: 'c1', objId: 'busy', type: 'main', name: '№ 1906-1/26' },
    { id: 'me', objId: 'mine', type: 'main', name: '№ 2108-1/26', crmClientId: 'k1' },
  ]
  const list = objPickList(OBJ, CT, CT[1], 'Кутьин Алексей Владимирович')
  t.ok('текущий — первым', list[0].o.id === 'mine' && list[0].current, list.map((x) => x.o.id).join(','))
  t.ok('дальше подходящий по фамилии', list[1].o.id === 'match' && list[1].match && list[1].free)
  t.ok('потом свободные', list[2].o.id === 'free' && list[2].free && !list[2].match)
  t.ok('занятый — последним, с договором, у которого он', list[3].o.id === 'busy' && !list[3].free && list[3].busy[0].name === '№ 1906-1/26')
  t.ok('свой договор объект не «занимает»', list[0].free === true)
  // Объект, созданный из договора, помнит клиента — подходит и без фамилии в названии.
  const byClient = objPickList([{ id: 'x', name: 'Объект' }, { id: 'y', name: 'Другой', crmClientId: 'k1' }], [], { id: 'n', crmClientId: 'k1' }, '')
  t.ok('подходит по клиенту из CRM', byClient[0].o.id === 'y' && byClient[0].match)
}

{
  t.section('Второй основной договор')
  const CT = [
    { id: 'a', objId: 'o1', type: 'main', name: 'Основной' },
    { id: 'b', objId: 'o1', type: 'extra', name: 'Доп' },
    { id: 'c', objId: 'o2', type: 'main', name: 'Архивный', archived: true },
  ]
  t.ok('у объекта уже есть основной', (mainContractOf(CT, 'o1', 'new') || {}).id === 'a')
  t.ok('сам себе не мешает', mainContractOf(CT, 'o1', 'a') === null)
  t.ok('доп. работы основным не считаются', mainContractOf([CT[1]], 'o1', 'new') === null)
  t.ok('архивный не мешает', mainContractOf(CT, 'o2', 'new') === null)
}

{
  t.section('Объект из договора: имя и шаблон')
  const kut = { name: 'Договор подряда № 2108-1/26', note: 'Дом 12 м на базе морского контейнера. Комфорт-комплектация 1 590 000 + опции = 1 752 000 ₽.' }
  t.ok('«Дом 12 м · Кутьин»', ctObjName(kut, 'Кутьин Алексей Владимирович') === 'Дом 12 м · Кутьин', ctObjName(kut, 'Кутьин Алексей Владимирович'))
  t.ok('баня из примечания', ctObjName({ note: 'Баня 6 м с печью' }, 'Петров Иван') === 'Баня 6 м · Петров', ctObjName({ note: 'Баня 6 м с печью' }, 'Петров Иван'))
  t.ok('без клиента — без точки', ctObjName({ note: 'Дом 40 футов' }, '') === 'Дом 40 футов', ctObjName({ note: 'Дом 40 футов' }, ''))
  t.ok('ничего не сказано — «Дом»', ctObjName({ name: 'Договор № 5' }, 'Сидоров') === 'Дом · Сидоров')
  // Живые договоры 11.09.2026: квартира называлась «Дом · Гринин», а у клиентов-
  // организаций фамилией становилась форма собственности — «Дом · ИП», «Дом · ООО».
  t.ok('квартира — «Квартира», а не «Дом»', ctObjName({ name: 'Договор подряда — квартира Кончаловского' }, 'Гринин Павел') === 'Квартира · Гринин',
    ctObjName({ name: 'Договор подряда — квартира Кончаловского' }, 'Гринин Павел'))
  t.ok('«ИП Петров Андрей» — Петров', ctObjName({ name: 'Договор № 7' }, 'ИП Петров Андрей') === 'Дом · Петров', ctObjName({ name: 'Договор № 7' }, 'ИП Петров Андрей'))
  t.ok('«ООО «Ромашка»» — Ромашка', ctObjName({ name: 'Договор № 8' }, 'ООО «Ромашка»') === 'Дом · Ромашка', ctObjName({ name: 'Договор № 8' }, 'ООО «Ромашка»'))
  t.ok('одна форма собственности без имени — без точки', ctObjName({ name: 'Договор № 9' }, 'ООО') === 'Дом', ctObjName({ name: 'Договор № 9' }, 'ООО'))

  const TPL = [
    { id: 'b6', name: 'Баня 6 м', kind: 'banya' },
    { id: 'mb', name: 'Баня из минибруса 6 м', kind: 'minibrus' },
    { id: 'd40', name: 'Дом 40 футов', kind: 'house' },
    { id: 'oka', name: 'Дом на Оке', kind: 'kx178' },
  ]
  t.ok('дому — шаблон дома', ['d40', 'oka'].indexOf((ctTemplateFor(kut, TPL) || {}).id) >= 0, JSON.stringify(ctTemplateFor(kut, TPL)))
  t.ok('«40 футов» в договоре — именно этот дом', (ctTemplateFor({ note: 'Дом 40 футов, ПМЖ' }, TPL) || {}).id === 'd40')
  t.ok('бане — баня', (ctTemplateFor({ note: 'Баня 6 м' }, TPL) || {}).id === 'b6')
  t.ok('минибрус — минибрус', (ctTemplateFor({ note: 'Баня из минибруса 6 м' }, TPL) || {}).id === 'mb')
  t.ok('не понять — не угадываем', ctTemplateFor({ name: 'Договор № 5' }, TPL) === null)

  // Живые данные 11.09.2026: Кутьину «Дом 12 м» подобралась «Квартира ул. Петра
  // Кончаловского». Квартира — не дом из контейнера, а цифры шаблона находились
  // внутри чужих чисел договора («40» в «№7640467», «7» в «1 752 000»).
  const LIVE = [
    { id: 'mb', name: 'Баня из минибруса 6 м', kind: 'minibrus' },
    { id: 'd40', name: 'Дом 40 футов', kind: 'house' },
    { id: 'flat', name: 'Квартира Ул. Петра Кончаловского, д.7, к.4, кв 11', kind: 'kx1784410316' },
    { id: 'oka', name: 'Дом на Оке', kind: 'kx1787624896' },
  ]
  // Примечание обезличено (в живом — паспорт и телефон), но ловушка та же: «7» и «4»
  // шаблона квартиры сидят внутри сроков и дат договора.
  const kutLive = { name: 'Договор подряда № 2108-1/26', note: 'Дом 12 м на базе морского контейнера. Аванс 1 050 000 ₽ при подписании. Срок 75 раб. дн., старт 24.08.2026, дедлайн ~07.12.2026 (расчётный).' }
  const pick = ctTemplateFor(kutLive, LIVE)
  t.ok('дому не подбирается квартира', !!pick && pick.id !== 'flat', JSON.stringify(pick))
  t.ok('подбирается шаблон дома', !!pick && ['d40', 'oka'].indexOf(pick.id) >= 0, JSON.stringify(pick))
  t.ok('квартире — квартира', (ctTemplateFor({ note: 'Ремонт квартиры на Кончаловского' }, LIVE) || {}).id === 'flat')
  t.ok('число совпадает целиком, а не куском', (ctTemplateFor({ note: 'Дом, проект №7640467' }, [LIVE[1], { id: 'd12', name: 'Дом 12 м', kind: 'house' }]) || {}).id === 'd40',
    'цифры «40» внутри «7640467» не должны давать очков — при равенстве остаётся первый')
}

{
  t.section('Прогресс стройки')
  t.ok('без этапов — нечего показывать', objProgress({ stages: [] }, TODAY) === null && objProgress(null, TODAY) === null)
  const obj = { stages: [
    stage(1, [work({ done: true, doneAt: '2026-08-30' })]),
    stage(2, [work({ timeLogs: [{ date: '2026-09-02' }] })], { planEnd: '2026-09-03' }),
    stage(3, [work()]),
  ] }
  const p = objProgress(obj, TODAY)
  t.ok('этапов 3, закрыт 1', p.total === 3 && p.done === 1, JSON.stringify(p))
  t.ok('текущий — второй', p.cur && p.cur.n === 2 && p.cur.name === 'Этап 2')
  t.ok('стройка идёт', p.started === true)
  // План второго этапа кончился 3 сентября, сегодня 11-е: 6 рабочих дней.
  t.ok('отставание в рабочих днях', p.late === 6, String(p.late))
  const fresh = objProgress({ stages: [stage(1, [work()])] }, TODAY)
  t.ok('не начата — не начата, отставания нет', fresh.started === false && fresh.late === 0)
}

// Живой случай 11.09.2026: договор Кутьина (подписан, 1 752 000 ₽) привязали к «Дому
// СВО», где основным стоял черновик №59, — и подписанный стал «доп. работами».
// Черновик не должен перебивать подписанный договор.
{
  t.section('Основной договор: черновик не перебивает подписанный')
  const draft59 = { id: 'c59', objId: 'svo', type: 'main', status: 'draft', name: '№59' }
  const signedMain = { id: 'cS', objId: 'svo', type: 'main', status: 'signed', name: '№1906' }
  const kut = { id: 'cK', type: 'main', status: 'signed', name: '№2108' }
  t.ok('на объекте черновик — предлагаем поменять местами', (ctMainConflict([draft59], kut, 'svo') || {}).mode === 'swap')
  t.ok('на объекте подписанный — этот становится доп. работами', (ctMainConflict([signedMain], kut, 'svo') || {}).mode === 'extra')
  t.ok('два черновика — тоже доп. работы', (ctMainConflict([draft59], Object.assign({}, kut, { status: 'draft' }), 'svo') || {}).mode === 'extra')
  t.ok('доп. работы не конфликтуют', ctMainConflict([draft59], Object.assign({}, kut, { type: 'extra' }), 'svo') === null)
  t.ok('объекта нет — конфликта нет', ctMainConflict([draft59], kut, '') === null && ctMainConflict([], kut, 'svo') === null)

  const kutExtra = Object.assign({}, kut, { type: 'extra', objId: 'svo' })
  t.ok('подписанный доп. при черновике-основном — можно сделать основным', (ctCanBecomeMain([draft59, kutExtra], kutExtra) || {}).id === 'c59')
  t.ok('при подписанном основном — нельзя', ctCanBecomeMain([signedMain, kutExtra], kutExtra) === null)
  t.ok('черновик сам себя основным не делает', ctCanBecomeMain([draft59, Object.assign({}, kutExtra, { status: 'draft' })], Object.assign({}, kutExtra, { status: 'draft' })) === null)
  t.ok('остальные договоры на объекте', ctOthersOnObject([draft59, signedMain, kutExtra, { id: 'x', objId: 'svo', archived: true }], kutExtra).map((x) => x.id).join(',') === 'c59,cS')
  t.ok('без объекта — никого', ctOthersOnObject([draft59], { id: 'n' }).length === 0)
}

{
  t.section('Оплата клиента по графику')
  const p = ctPayProgress(1752000, [{ amount: 1050000, paidAt: '2026-08-22' }, { amount: 502000 }])
  t.ok('оплачено — только отмеченные', p.paid === 1050000)
  t.ok('расписано — все транши', p.planned === 1552000)
  t.ok('не расписано — остаток суммы', p.unplanned === 200000 && p.over === 0)
  t.ok('процент — от суммы договора', p.pct === 60, String(p.pct))
  const none = ctPayProgress(1752000, null)
  t.ok('графика нет — ничего не оплачено и всё не расписано', none.paid === 0 && none.unplanned === 1752000 && none.pct === 0)
  t.ok('перебор графика виден', ctPayProgress(100, [{ amount: 150 }]).over === 50)
}

t.done()
