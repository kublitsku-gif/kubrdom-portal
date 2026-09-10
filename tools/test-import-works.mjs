#!/usr/bin/env node
// «Взять работы из другого проекта» (src/recipe.js: importRows / importPatch).
//
// Дом собирают не с нуля: в «Мордвес 1» уже подобраны трубы к водоснабжению,
// назначена цена бригаде и план часов. Новый дом берёт эти строки ГОТОВЫМИ —
// такими, какими они стоят на экране источника, — и дальше живёт своей сметой.
// Сторожим главное: деньги строки доезжают до копейки, материалы получают СВОИ
// id (общий id «протёк» бы отметками закупки между объектами), а лист, в который
// переносят, не трогается, пока человек не нажал «взять».
import { importRows, importPatch, addedPositions, applyMatEdits, positionSplit } from '../src/recipe.js'
import { reporter } from './harness/panel-vm.js'

const t = reporter()

// Готовые строки источника — ровно в той форме, в какой их отдаёт works2():
// правки листа уже применены, количества итоговые.
const SRC_ID = 'p_mordves'
const SRC = [
  {
    // Своя работа с дописанными трубами: так «Водоснабжение — полипропилен»
    // живёт в боевом «Мордвес 1».
    key: 'add:w1', estId: '', name: 'Водоснабжение — полипропилен', stage: 3, room: 'Санузел',
    own: true, added: true, hours: 8, hoursSet: true, cost: 15000 + 55 * 13 + 70.16 * 3.6,
    mats: [
      { id: 'own:w1', pid: '', own: true, n: 'Водоснабжение — полипропилен', mode: 'piece', cost: 15000, qty: 1 },
      { id: 'm1', pid: 'p_pipe', n: 'Труба PP 20', store: 'Лемана ПРО', url: 'https://x/1', note: '',
        mode: 'mp', cost: 55, qty: 13, unitCost: 55, lenPer: 2, added: true, qtySet: true },
      { id: 'm2', pid: 'p_pnd', n: 'Труба ПНД 32', store: 'Лемана ПРО', url: 'https://x/2',
        note: '3 м ввод + 0,6 м на 2 гильзы', mode: 'mp', cost: 70.16, qty: 3.6, unitCost: 70.16,
        lenPer: 25, packName: 'бухта', added: true, qtySet: true, client: true },
    ],
  },
  {
    // Строка справочника с ценой бригаде «сверху материалов».
    key: 'base:e_el', estId: 'e_el', name: 'Разводка электрики кабелем', stage: 2, room: '',
    labor: 4000, costMode: 'labor', costSet: true, hours: 0, cost: 4000 + 30 * 100,
    mats: [{ lid: 'l1', pid: 'p_cab', n: 'Кабель ВВГ 3×2,5', store: 'Петрович', mode: 'mp', cost: 30, qty: 100 }],
  },
  {
    // «Под ключ»: материалы уже внутри договорной цифры.
    key: 'base:e_roof', estId: 'e_roof', name: 'Кровля под ключ', stage: 2, room: 'Зал',
    costAll: true, costMode: 'all', costSet: true, labor: 0, cost: 90000,
    mats: [{ lid: 'l2', pid: 'p_prof', n: 'Профлист', mode: 'm2', cost: 500, qty: 40 }],
  },
  {
    key: 'base:e_osb', estId: 'e_osb', name: 'Обшивка стен ОСП', stage: 2, room: '',
    cost: 12000, mats: [{ lid: 'l3', pid: 'p_osb', n: 'ОСП 9 мм', mode: 'm2', cost: 1000, qty: 12 }],
  },
]
const PRODUCTS = [
  { id: 'p_pipe', name: 'Труба PP 20', unitCost: 55 },
  { id: 'p_pnd', name: 'Труба ПНД 32', unitCost: 70.16 },
  { id: 'p_cab', name: 'Кабель ВВГ 3×2,5', unitCost: 30 },
  { id: 'p_prof', name: 'Профлист', unitCost: 500 },
]

// Новый дом: в нём уже есть обшивка ОСП (его собственные правила) и комната
// «Санузел» — но под своим id, чертёж у него свой.
const target = () => ({
  id: 'p_new', posAdd: [{ id: 'old1', name: 'Вывоз мусора', cost: 9000, stage: 1 }],
  matAdd: { 'add:old1': [{ id: 'mm', pid: '', n: 'Мешки', cost: 10, qty: 5 }] },
  posHours: { 'base:x': 2 },
})
const TARGET_POS = [
  { key: 'base:e_osb', estId: 'e_osb', name: 'Обшивка стен ОСП', stage: 2 },
  { key: 'add:old1', estId: '', name: 'Вывоз мусора', stage: 1 },
]
const ROOMS = [{ id: 'r_bath_new', name: 'санузел' }, { id: 'r_bed', name: 'Спальня' }]

let seq = 0
const gid = () => 'n' + (++seq)
const byKey = (rows, k) => rows.find((r) => r.key === k)

// ── 1. Перечень строк источника ─────────────────────────────────────────────
{
  t.section('Перечень строк источника')
  const rows = importRows(SRC, TARGET_POS, target(), SRC_ID)
  t.ok('все строки источника в перечне', rows.length === SRC.length, String(rows.length))
  t.ok('порядок как в источнике', rows.map((r) => r.key).join() === SRC.map((s) => s.key).join())
  const w = byKey(rows, 'add:w1')
  t.ok('у строки её деньги', Math.round(w.cost) === Math.round(SRC[0].cost), String(w.cost))
  t.ok('и число материалов без самой работы', w.matCount === 2, String(w.matCount))
  t.ok('этап источника (переставленный руками)', w.stage === 3)
  t.ok('новая для этого дома — не помечена', !w.exists)
}

// ── 2. «Уже есть» — чтобы не задвоить ───────────────────────────────────────
{
  t.section('Уже есть в этом доме')
  const rows = importRows(SRC, TARGET_POS, target(), SRC_ID)
  t.ok('та же строка справочника — уже есть', byKey(rows, 'base:e_osb').exists)
  t.ok('и сказано, почему', /справочник/i.test(byKey(rows, 'base:e_osb').why), byKey(rows, 'base:e_osb').why)
  const tp = TARGET_POS.concat([{ key: 'add:z', estId: '', name: '  водоснабжение —  ПОЛИПРОПИЛЕН ', stage: 1 }])
  t.ok('тёзка по имени — уже есть (регистр и пробелы не в счёт)',
    byKey(importRows(SRC, tp, target(), SRC_ID), 'add:w1').exists)
  const again = target()
  again.posAdd = again.posAdd.concat([{ id: 'q', name: 'Кабель', cost: 0, stage: 2, from: { p: SRC_ID, k: 'base:e_el' } }])
  t.ok('уже взятая из этого же проекта — уже есть',
    byKey(importRows(SRC, TARGET_POS, again, SRC_ID), 'base:e_el').exists)
  t.ok('та же строка из ДРУГОГО проекта — не мешает',
    !byKey(importRows(SRC, TARGET_POS, again, 'p_other'), 'base:e_el').exists)
}

// ── 3. Перенос: что и куда пишется ──────────────────────────────────────────
{
  t.section('Перенос строки')
  seq = 0
  const tg = target()
  const before = JSON.stringify(tg)
  const rows = importRows(SRC, TARGET_POS, tg, SRC_ID)
  const patch = importPatch(tg, rows, { 'add:w1': true }, SRC_ID, { gid, rooms: ROOMS })
  t.ok('лист не тронут — правка приходит отдельным патчем', JSON.stringify(tg) === before)
  const add = patch.posAdd[patch.posAdd.length - 1]
  t.ok('прежние дописанные работы на месте', patch.posAdd.length === 2 && patch.posAdd[0].id === 'old1')
  t.ok('строка встала своей работой с ценой бригаде', add.name === SRC[0].name && add.cost === 15000, JSON.stringify(add))
  t.ok('на этапе источника', add.stage === 3)
  t.ok('и помнит, откуда пришла', add.from && add.from.p === SRC_ID && add.from.k === 'add:w1')
  t.ok('ссылки на справочник у копии нет', !add.estId)
  const mats = patch.matAdd['add:' + add.id]
  t.ok('материалы доехали без самой работы', mats.length === 2, String(mats && mats.length))
  t.ok('с итоговым количеством', mats[0].qty === 13 && mats[1].qty === 3.6)
  t.ok('со ссылкой на каталог', mats[0].pid === 'p_pipe' && mats[1].pid === 'p_pnd')
  t.ok('и с примечанием', mats[1].note === '3 м ввод + 0,6 м на 2 гильзы')
  t.ok('слово покупки не потерялось', mats[1].packName === 'бухта' && mats[1].lenPer === 25)
  t.ok('у материалов СВОИ id', mats.every((m) => m.id && m.id !== 'm1' && m.id !== 'm2'))
  t.ok('служебные метки источника не тащим', mats.every((m) => !m.added && !m.qtySet && !m.lid && !m.mix))
  t.ok('«платит заказчик» не переносим — это договор того дома', mats.every((m) => !m.client))
  t.ok('прежние дописанные материалы на месте', patch.matAdd['add:old1'].length === 1)
  t.ok('план часов доехал', patch.posHours['add:' + add.id] === 8)
  t.ok('прежние часы на месте', patch.posHours['base:x'] === 2)
  t.ok('комната нашлась по имени, под id нового дома', patch.posRoom['add:' + add.id] === 'r_bath_new')
}

// ── 4. Строка справочника и «под ключ» ──────────────────────────────────────
{
  t.section('Строка справочника и «под ключ»')
  seq = 0
  const rows = importRows(SRC, TARGET_POS, target(), SRC_ID)
  const patch = importPatch(target(), rows, { 'base:e_el': true, 'base:e_roof': true }, SRC_ID, { gid, rooms: ROOMS })
  const el = patch.posAdd.find((r) => r.from && r.from.k === 'base:e_el')
  t.ok('строка справочника стала своей работой с её ценой бригаде', el && el.cost === 4000, JSON.stringify(el))
  t.ok('откуда она в справочнике — помним', el.srcEstId === 'e_el')
  t.ok('её материалы справочника доехали', patch.matAdd['add:' + el.id].length === 1)
  const roof = patch.posAdd.find((r) => r.from && r.from.k === 'base:e_roof')
  t.ok('«под ключ» переносится договорной цифрой', roof.cost === 90000, String(roof.cost))
  t.ok('и без материалов — они уже в этой цифре', !patch.matAdd['add:' + roof.id])
  t.ok('комнаты «Зал» в новом доме нет — остаётся общей', !patch.posRoom || !patch.posRoom['add:' + roof.id])
  t.ok('непомеченное не перенесено', patch.posAdd.length === 3, String(patch.posAdd.length))
}

// ── 5. Деньги сходятся до рубля ─────────────────────────────────────────────
// Главная проверка: взятая строка в новом доме считается ТЕМ ЖЕ кодом, что и
// всё остальное, и её сумма совпадает с суммой в источнике. Иначе «взять из
// Мордвеса» означало бы «взять примерно».
{
  t.section('Деньги сходятся')
  seq = 0
  const tg = target()
  const rows = importRows(SRC, TARGET_POS, tg, SRC_ID)
  const pick = {}; SRC.forEach((s) => { pick[s.key] = true })
  const sheet = Object.assign({}, tg, importPatch(tg, rows, pick, SRC_ID, { gid, rooms: ROOMS }))
  const got = applyMatEdits(addedPositions(sheet, [], PRODUCTS), sheet, PRODUCTS)
  SRC.forEach((s) => {
    const row = sheet.posAdd.find((r) => r.from && r.from.k === s.key)
    const pos = got.find((p) => p.key === 'add:' + row.id)
    t.ok('«' + s.name + '» стоит столько же', pos && Math.round(pos.cost) === Math.round(s.cost),
      (pos && pos.cost) + ' против ' + s.cost)
    // Работа бригаде и материалы — два кармана, и разложиться они обязаны так же.
    const a = positionSplit(pos), b = positionSplit(s)
    t.ok('и так же делится на работу и материалы',
      Math.round(a.labor) === Math.round(b.all ? s.cost : b.labor), a.labor + ' против ' + b.labor)
  })
}

t.done()
