#!/usr/bin/env node
// Чтение чужой планировки (src/plan-read.js).
//
// Здесь чужие миллиметры превращаются в наши площади, по которым выставляют счёт.
// Поэтому сторожим не «модель ответила», а перевод: чистовой размер чертежа →
// размер по коробке, сумма помещений → длина дома, и — главное — что КАЖДОЕ
// расхождение доехало до человека списком. Молчаливая правка чужого обмера
// страшнее ошибки: ошибку видно, поправку — нет.
import {
  planRequest, planFromResponse, planNormalize, planToModel, PLAN_TOOL, PLAN_MODEL, PLAN_SCHEMA,
} from '../src/plan-read.js'
import { totalLength, modelRooms, FINISH_THICK } from '../src/model.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}
const ids = () => { let i = 0; return () => 'id' + (++i) }

// Ответ, какой присылает модель по чертежу заказчика 1200 × 247 см.
const READ = {
  length: 11952, width: 2352, height: 2500,
  bays: [
    { name: 'Санузел', len: 2000 },
    { name: 'Кухня-гостиная', len: 6400 },
    { name: 'Спальня', len: 3200 },
  ],
  openings: [
    { kind: 'win', side: 's', after_bay: null, pos: 2976, width: 1300, height: 1150, label: 'ОК-1' },
    { kind: 'door', side: 's', after_bay: null, pos: 5276, width: 1000, height: 2100, label: 'Вход' },
    { kind: 'door', side: 'part', after_bay: 0, pos: 826, width: 700, height: 2050, label: 'Д-1' },
  ],
  notes: '',
}

// ── 1. Запрос ────────────────────────────────────────────────────────────────
// PDF уходит в Claude как есть: он читает страницы сам, растрировать не нужно.
// Тип блока обязан совпасть с типом файла — иначе API отвечает 400, и «не
// распозналось» окажется не про чертёж.
{
  console.log('Запрос')
  const pdf = planRequest('application/pdf', 'QkFTRTY0')
  ok('PDF уходит документом', pdf.messages[0].content[0].type === 'document')
  ok('и не растрируется на нашей стороне', pdf.messages[0].content[0].source.media_type === 'application/pdf')
  const png = planRequest('image/png', 'QkFTRTY0')
  ok('картинка уходит картинкой', png.messages[0].content[0].type === 'image')
  ok('с её собственным типом', png.messages[0].content[0].source.media_type === 'image/png')

  // Ответ нужен структурой, а не рассказом: инструмент один и он обязателен.
  ok('инструмент навязан', pdf.tool_choice.type === 'tool' && pdf.tool_choice.name === PLAN_TOOL.name)
  ok('и он строгий', PLAN_TOOL.strict === true && PLAN_SCHEMA.additionalProperties === false)
  ok('чертёж читает модель посильнее', pdf.model === PLAN_MODEL && /opus/.test(PLAN_MODEL), pdf.model)
  // Все поля обязательные: пропущенное поле молча стало бы «нулём», а ноль в
  // размере — это не «не прочитал», это неверный счёт.
  ok('все поля обязательные', PLAN_SCHEMA.required.length === Object.keys(PLAN_SCHEMA.properties).length)
}

// ── 2. Разбор ответа ─────────────────────────────────────────────────────────
{
  console.log('Разбор ответа')
  const got = planFromResponse({ content: [{ type: 'tool_use', name: 'plan_read', input: READ }] })
  ok('планировка достаётся из вызова инструмента', got.bays.length === 3)
  let err = ''
  try { planFromResponse({ content: [{ type: 'text', text: 'Это фотография кота' }] }) } catch (e) { err = e.message }
  // Модель отказалась читать — это не сбой сети и не «настройте ключ»: человеку
  // надо показать, ЧТО она увидела, иначе он будет перезагружать тот же файл.
  ok('отказ модели объясняется словами', /кота/.test(err), err)
}

// ── 3. Чужие единицы ─────────────────────────────────────────────────────────
// Чертежи подписывают в метрах и сантиметрах, и «2,4» доезжает как есть. Масштаб
// узнаём ОДИН на всю планировку — по длине дома: контейнерный дом это 3…20 метров,
// и в каком бы виде длина ни пришла, она выдаёт себя порядком. Разбирать единицы
// у каждого числа отдельно нельзя: чертёж подписан в одних, и «эта длина в метрах,
// а та в миллиметрах» — уже не чтение, а угадывание.
{
  console.log('Единицы и пропуски')
  const metres = planNormalize({
    length: 11.952, width: 2.352, height: 2.5,
    bays: [{ name: 'Спальня', len: 3.2 }, { name: '', len: null }],
    openings: [
      { kind: 'win', side: 's', pos: 2.976, width: 1.5, height: null, label: 'ОК-1' },
      { kind: 'win', side: 's', pos: 0.1, width: null, height: 1.4, label: 'ОК-2' },
    ],
    notes: 'план без размеров окон',
  })
  const plan = metres.plan
  const warnings = metres.warnings
  ok('метры стали миллиметрами', plan.length === 11952, String(plan.length))
  ok('ширина тоже', plan.width === 2352, String(plan.width))
  ok('длина помещения переведена', plan.bays[0].len === 3200, String(plan.bays[0].len))
  ok('и отметка проёма', plan.openings[0].pos === 2976, String(plan.openings[0].pos))
  ok('и его ширина', plan.openings[0].w === 1500, String(plan.openings[0].w))

  const cm = planNormalize({
    length: 1195.2, width: 235.2, height: 250,
    bays: [{ name: 'Спальня', len: 320 }],
    openings: [{ kind: 'win', side: 's', pos: 297.6, width: 150, height: 140, label: 'ОК-1' }],
    notes: '',
  }).plan
  ok('сантиметры тоже', cm.length === 11952 && cm.width === 2352, cm.length + ' × ' + cm.width)
  ok('и проём в сантиметрах', cm.openings[0].w === 1500 && cm.openings[0].pos === 2976,
    cm.openings[0].pos + ' / ' + cm.openings[0].w)

  ok('помещение без длины выброшено', plan.bays.length === 1, String(plan.bays.length))
  ok('и об этом сказано', warnings.some((w) => /длина не прочиталась/.test(w)), warnings.join(' | '))
  ok('проём без ширины выброшен', plan.openings.length === 1, String(plan.openings.length))
  ok('и об этом тоже', warnings.some((w) => /ОК-2/.test(w)), warnings.join(' | '))
  // Высоты на виде сверху не видно почти никогда. Ставим типовую — но говорим об
  // этом: по высоте заказывают изделие, и молчаливые 1400 приедут стеклопакетом.
  ok('высота подставлена типовая', plan.openings[0].h === 1400, String(plan.openings[0].h))
  ok('и подстановка названа', warnings.some((w) => /высота не подписана/.test(w)), warnings.join(' | '))
  ok('заметки модели сохранены', plan.notes === 'план без размеров окон')
}

// ── 4. Чистовые размеры → размеры по коробке ─────────────────────────────────
// Главный перевод. У крайних помещений отделка съедает ещё и торец: чистовым
// 2000 соответствует 2076 по коробке. Ошибка здесь — это лишний квадрат в смете.
{
  console.log('Перевод в размеры коробки')
  const { plan } = planNormalize(READ)
  const { model, winTypes, warnings } = planToModel(plan, [], ids())
  ok('типоразмер узнан', model.type === '40hc', model.type)
  ok('длина взята с чертежа, а не из справочника', model.l === 11952, String(model.l))
  ok('крайнее помещение выросло на отделку торца',
    model.rooms[0].len === 2000 + FINISH_THICK, String(model.rooms[0].len))
  ok('среднее осталось чистовым', model.rooms[1].len === 6400, String(model.rooms[1].len))
  ok('и последнее тоже выросло', model.rooms[2].len === 3200 + FINISH_THICK, String(model.rooms[2].len))
  // Сумма отсеков со стенами обязана сойтись с длиной дома до миллиметра: иначе
  // последняя перегородка встанет за торцом, а площади окажутся вымышленными.
  ok('сумма сошлась с длиной дома', totalLength(model) === model.l,
    totalLength(model) + ' против ' + model.l)
  ok('чужой обмер сошёлся без правок', !warnings.length, warnings.join(' | '))

  // Площади — то, ради чего всё затеяно: они уходят в смету.
  const rooms = modelRooms(model)
  ok('помещений три', rooms.length === 3, String(rooms.length))
  ok('санузел ≈ 4,4 м²', Math.abs(rooms[0].area - 4.4) < 0.05, String(rooms[0].area))
  ok('имена помещений с чертежа', rooms[1].name === 'Кухня-гостиная', rooms[1].name)

  // Изделия: окно и две двери, входная и межкомнатная.
  ok('изделия заведены', winTypes.length === 3, String(winTypes.length))
  ok('проёмы на местах', model.openings.length === 3, String(model.openings.length))
  const part = model.openings.find((o) => o.side === 'part')
  ok('дверь встала на перегородку санузла', part.after === model.rooms[0].id)
  ok('у двери порог на полу', model.openings[1].sill === 0, String(model.openings[1].sill))
  // Окно 1300×1150 подвешено под перемычку 2100: подоконник — то, что осталось.
  ok('окно подвешено под перемычку', model.openings[0].sill === 2100 - 1150, String(model.openings[0].sill))
  ok('у двери в перегородке порога нет', part.sill === undefined, String(part.sill))
}

// ── 5. Расхождения громкие, а не тихие ───────────────────────────────────────
// Чужой обмер сходится редко. Поправить его можно — молча поправить нельзя.
{
  console.log('Расхождения')
  const { plan } = planNormalize(Object.assign({}, READ, {
    bays: [{ name: 'Санузел', len: 2000 }, { name: 'Зал', len: 6000 }, { name: 'Спальня', len: 3200 }],
  }))
  const { model, warnings } = planToModel(plan, [], ids())
  ok('сумма всё равно сошлась', totalLength(model) === model.l,
    totalLength(model) + ' против ' + model.l)
  ok('разницу добавили в самое длинное помещение', model.rooms[1].len === 6400, String(model.rooms[1].len))
  ok('и сказали об этом', warnings.some((w) => /разошлась/.test(w) && /Зал/.test(w)), warnings.join(' | '))

  // Проём за торцом — ошибка чтения, а не планировка: прижимаем к стене и
  // показываем человеку именно его.
  const far = planNormalize(Object.assign({}, READ, {
    openings: [{ kind: 'win', side: 's', pos: 11500, width: 1500, height: 1400, label: 'ОК-9' }],
  }))
  const out = planToModel(far.plan, [], ids())
  ok('проём вернулся в стену', out.model.openings[0].pos + 1500 <= out.model.l,
    String(out.model.openings[0].pos))
  ok('и об этом сказано', out.warnings.some((w) => /ОК-9/.test(w)), out.warnings.join(' | '))

  // Перегородка за последним помещением — это торец, а не перегородка.
  const bad = planNormalize(Object.assign({}, READ, {
    openings: [{ kind: 'door', side: 'part', after_bay: 2, pos: 800, width: 700, height: 2050, label: 'Д-9' }],
  }))
  const res = planToModel(bad.plan, [], ids())
  ok('несуществующая перегородка пропущена', res.model.openings.length === 0)
  ok('и названа', res.warnings.some((w) => /Д-9/.test(w)), res.warnings.join(' | '))
}

// ── 6. Изделия — из каталога, а не выдуманные ────────────────────────────────
// Дом собирают из того, что заказывают. Окно «1450×1300 по чертежу» купить
// негде: в заказ уйдёт ближайшее каталожное, и чертёж обязан показывать ЕГО —
// иначе проём режут под изделие, которого не существует. Всякая подмена
// называется вслух: человек сверяет её с чертежом заказчика.
{
  console.log('Изделия из каталога')
  const one = (o, mine) => {
    const { plan } = planNormalize(Object.assign({}, READ, { openings: [o] }))
    const r = planToModel(plan, mine || [], ids())
    const t = r.winTypes.find((x) => x.id === r.model.openings[0].typeId)
    return { t, warn: r.warnings, op: r.model.openings[0] }
  }

  // Точное попадание в каталог — молча, вместе с ценой поставщика и раскладкой.
  const exact = one({ kind: 'win', side: 's', pos: 3000, width: 1300, height: 1150, label: 'ОК-1' })
  ok('каталожный размер узнан', exact.t.w === 1300 && exact.t.cost > 0, exact.t.n + ' ' + exact.t.cost)
  ok('раскладка створок приехала', !!exact.t.face)
  ok('и подменять нечего', !exact.warn.length, exact.warn.join(' | '))

  // Чертёж рисовали не по каталогу — ставим ближайшее и говорим об этом.
  const near = one({ kind: 'win', side: 's', pos: 3000, width: 1450, height: 1300, label: 'ОК-2' })
  ok('чужой размер заменён каталожным', near.t.w === 1500 && near.t.h === 1200, near.t.n)
  ok('и цена у него настоящая', near.t.cost > 0, String(near.t.cost))
  ok('подмена названа вслух',
    near.warn.some((w) => /ОК-2/.test(w) && /1450×1300/.test(w) && /1500×1200/.test(w)), near.warn.join(' | '))
  // Изделие шире нарисованного — но встаёт туда же, где было: чертёж показывал
  // окно посреди простенка, и 50 мм ширины не повод сдвигать его вбок.
  ok('проём остался на месте центром', near.op.pos === 3000 - 25, String(near.op.pos))

  // В каталоге нет ничего близкого — врать нельзя: изделие по чертежу и ноль в
  // цене, который человек обязан заполнить.
  const far = one({ kind: 'win', side: 's', pos: 500, width: 4000, height: 2200, label: 'Панорама' })
  ok('панорамное окно осталось своим', far.t.w === 4000 && far.t.cost === 0, far.t.n)
  ok('и об этом сказано', far.warn.some((w) => /нет ничего близкого/.test(w)), far.warn.join(' | '))

  // Межкомнатная дверь — стандартное полотно, а не «ближайшая входная»: у входной
  // разница всего 300 мм, а это другая дверь и другие деньги.
  const inner = one({ kind: 'door', side: 'part', after_bay: 0, pos: 800, width: 700, height: 2050, label: 'Д-1' })
  ok('межкомнатная дверь — стандартное полотно', inner.t.w === 700 && /межкомнатная/i.test(inner.t.n), inner.t.n)

  // Справочник дома важнее каталога: там СОГЛАСОВАННАЯ цена проданного дома.
  const mine = [{ id: 'w1', kind: 'win', n: 'Окно 1300×1150 п/о', w: 1300, h: 1150, cost: 31000 }]
  const own = one({ kind: 'win', side: 's', pos: 3000, width: 1300, height: 1150, label: 'ОК-1' }, mine)
  ok('своё изделие узнано по размеру', own.t.id === 'w1', own.t.id)
  ok('и цена осталась своя', own.t.cost === 31000, String(own.t.cost))

  // Но «своё» — это то же самое, а не «что-то похожее»: входная дверь, уже
  // заведённая в проекте, не должна перехватывать межкомнатную.
  const doors = [{ id: 'd1', kind: 'door', n: 'Дверь входная 1000×2100', w: 1000, h: 2100, cost: 27150 }]
  const grab = one({ kind: 'door', side: 'part', after_bay: 0, pos: 800, width: 700, height: 2050, label: 'Д-1' }, doors)
  ok('входная дверь не перехватывает межкомнатную', grab.t.id !== 'd1' && grab.t.w === 700, grab.t.n)
}

// ── 7. Пустой ответ не роняет разбор ─────────────────────────────────────────
{
  console.log('Пустой ответ')
  const { plan, warnings } = planNormalize({})
  const { model } = planToModel(plan, [], ids())
  ok('нормализация пережила пустоту', plan.bays.length === 0 && warnings.length === 0)
  ok('модель собралась пустой коробкой', model.rooms.length === 1 && model.openings.length === 0)
  ok('и длина у неё осмысленная', totalLength(model) === model.l, totalLength(model) + ' против ' + model.l)
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
