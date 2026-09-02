#!/usr/bin/env node
// Схема плана (modelScheme в src/model.js).
//
// Схема — чертёж, по которому строят, поэтому сторожим то, из-за чего чертёж врёт:
// размерная цепочка обязана сходиться в габарит (иначе на площадке замер не бьётся),
// проём обязан лежать в толще своей стены, а перегородки — стоять там же, где их
// видит расчёт площадей. И ничего лишнего: мебели, сантехники и площадей на схеме нет.
import { modelScheme, presetModel, emptyModel, splitAt, splitLengthwiseAt, totalLength,
  modelBays, modelRooms } from '../src/model.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}
const ids = () => { let i = 0; return () => 'id' + (++i) }
const sum = (a) => a.reduce((x, y) => x + y, 0)

// ── 1. Цепочки сходятся ──────────────────────────────────────────────────────
{
  console.log('Размерные цепочки')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)

  ok('габарит равен длине модели', sc.l === totalLength(model) && sc.w === model.w)
  // Сумма цепочки обязана равняться расстоянию между её крайними отметками — иначе
  // подпись на чертеже врёт. У внешних цепочек это ещё и весь габарит; внутренние
  // (двери в перегородках) меряются от чистовых стен, и обшивка в них не входит.
  sc.dims.forEach((d) => {
    ok('«' + d.name + '» (' + d.side + ') сходится по своим отметкам',
      sum(d.segs) === d.ticks[d.ticks.length - 1] - d.ticks[0],
      sum(d.segs) + ' · ' + d.segs.join(' '))
    if (!d.inner) ok('«' + d.name + '» (' + d.side + ') покрывает габарит целиком',
      sum(d.segs) === d.span, sum(d.segs) + ' ≠ ' + d.span)
    else ok('«' + d.name + '» меряется от чистовых стен',
      sum(d.segs) === d.span - sc.finish * 2, sum(d.segs) + ' ≠ ' + (d.span - sc.finish * 2))
  })

  const bay = sc.dims.find((d) => d.name === 'Помещения и перегородки')
  ok('цепочка помещений — обшивка, комнаты и перегородки',
    bay.segs.join(' ') === '76 2000 100 6400 100 3200 76', bay.segs.join(' '))
  // Цепочка проёмов меряет РЕЗ в стене: окно уже реза на два монтажных зазора, а
  // трубы варятся ПОВЕРХ листа и в этот размер не входят (узел 1).
  const bot = sc.dims.find((d) => d.side === 'bottom')
  // В цепочке проёмов стоят и ГРАНИ ВНУТРЕННИХ СТЕН: размечают не «от угла
  // контейнера», а от того, что рядом, — от перегородки до окна. Считать это
  // вычитанием двух разных цепочек значит перекладывать работу на бригаду.
  ok('цепочка проёмов длинной стены — по резу и с привязками',
    bot.segs.join(' ') === '2176 1030 1040 1010 1040 2280 3376', bot.segs.join(' '))
  // Толщина стены стоит на чертеже ОДИН раз — в цепочке перегородок. Повторять её
  // у каждого окна значит засыпать план одинаковыми «100»: их перестают читать
  // все, включая нужные. В привязке — одна грань, та, к которой ведут рулетку.
  ok('толщин стен в привязках нет',
    !bot.segs.some((v) => v === sc.wallThick || v === sc.finish), bot.segs.join(' '))
  ok('а в цепочке перегородок они есть',
    sc.dims[0].segs.filter((v) => v === sc.wallThick).length ===
    (sc.walls.filter((w) => w.kind === 'part' && w.h > w.w).length), sc.dims[0].segs.join(' '))
  ok('и она так и названа', bot.name === 'Проёмы (вырез) и привязки', bot.name)
  // Сумма цепочки равна габариту — привязки не сдвинули ни одного реза.
  ok('и сумма её равна дому', bot.segs.reduce((a, b) => a + b, 0) === sc.l,
    bot.segs.reduce((a, b) => a + b, 0) + ' против ' + sc.l)
  ok('рез шире изделия на два зазора, без труб',
    sc.openings.filter((o) => o.frame).every((o) => o.cutW === o.width + 40))
  ok('у неусиленных рез равен изделию',
    sc.openings.filter((o) => !o.frame).every((o) => o.cutW === o.width))
  const right = sc.dims.find((d) => d.side === 'right')
  ok('цепочка проёмов торца', right.segs.join(' ') === '96 2160 96', right.segs.join(' '))
  ok('ширина: обшивка и чистовой размер',
    sc.dims.find((d) => d.name === 'Ширина').segs.join(' ') === '76 2200 76')

  // Отметки цепочки идут по возрастанию и без дублей — иначе сегмент нулевой длины.
  sc.dims.forEach((d) => {
    const asc = d.ticks.every((v, i) => i === 0 || v > d.ticks[i - 1])
    ok('«' + d.name + '» (' + d.side + '): отметки без дублей и по порядку', asc, d.ticks.join(' '))
  })
}

// ── 2. Стены и перегородки ───────────────────────────────────────────────────
{
  console.log('Стены')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)
  const shell = sc.walls.filter((w) => w.kind === 'shell')
  const part = sc.walls.filter((w) => w.kind === 'part')
  ok('коробка обшита с четырёх сторон', shell.length === 4)
  ok('перегородок на одну меньше, чем отсеков', part.length === modelBays(model).length - 1, String(part.length))
  ok('перегородки стоят между отсеками',
    part.every((w) => modelBays(model).some((b) => b.x1 === w.x)), JSON.stringify(part.map((w) => w.x)))
  ok('перегородка не залезает в обшивку',
    part.every((w) => w.y === sc.finish && w.y + w.h === sc.w - sc.finish))
  ok('толщина перегородки из модели', part.every((w) => w.w === model.wallThick))

  // Продольная перегородка — санузел в углу.
  let m = emptyModel('40hc')
  m.rooms[0].id = 'b1'
  m = splitAt(m, 4000, 'b2')
  m = splitLengthwiseAt(m, 'b1', 1200, 'b1s')
  const sc2 = modelScheme(m, [])
  const lengthwise = sc2.walls.filter((w) => w.kind === 'part' && w.h === m.wallThick)
  ok('продольная перегородка нарисована', lengthwise.length === 1, JSON.stringify(sc2.walls))
  ok('она стоит на своей отметке по ширине', lengthwise[0] && lengthwise[0].y === 1200)
  ok('и не выходит за обшивку',
    lengthwise[0] && lengthwise[0].x >= sc2.finish && lengthwise[0].x + lengthwise[0].w <= sc2.l - sc2.finish)
}

// ── 3. Проёмы лежат в толще своей стены ──────────────────────────────────────
{
  console.log('Проёмы')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)
  ok('все проёмы на месте, включая межкомнатные', sc.openings.length === 5, String(sc.openings.length))
  sc.openings.filter((o) => o.side !== 'part').forEach((o) => {
    const inBand = (o.side === 'n') ? (o.y === 0 && o.h === sc.finish)
      : (o.side === 's') ? (o.y + o.h === sc.w && o.h === sc.finish)
        : (o.side === 'w') ? (o.x === 0 && o.w === sc.finish)
          : (o.x + o.w === sc.l && o.w === sc.finish)
    ok('«' + o.name + '» в толще стены ' + o.side, inBand, JSON.stringify(o))
    ok('«' + o.name + '» не выходит за стену',
      (o.side === 'n' || o.side === 's') ? (o.x >= 0 && o.x + o.w <= sc.l) : (o.y >= 0 && o.y + o.h <= sc.w))
  })
  ok('дверей три: вход и две межкомнатные', sc.openings.filter((o) => o.kind === 'door').length === 3)

  // Проём в перегородке лежит в её толще, а не рядом.
  const inner = sc.openings.filter((o) => o.side === 'part')
  ok('две двери в перегородках', inner.length === 2)
  inner.forEach((o) => {
    const wall = sc.walls.find((w) => w.kind === 'part' && w.x === o.x && w.w === o.w)
    ok('«' + o.mark + '» в толще перегородки', !!wall, JSON.stringify(o))
    ok('«' + o.mark + '» не выходит за чистовые стены',
      o.y >= sc.finish && o.y + o.h <= sc.w - sc.finish, JSON.stringify(o))
  })
  // Створка: петли, откос и полотно — три точки, по которым панель рисует дугу.
  sc.openings.filter((o) => o.kind === 'door').forEach((o) => {
    const s2 = o.swing
    const len = Math.round(Math.hypot(s2.tip.x - s2.hinge.x, s2.tip.y - s2.hinge.y))
    ok('«' + o.mark + '»: полотно равно ширине проёма', len === o.width, len + ' ≠ ' + o.width)
    const jl = Math.round(Math.hypot(s2.jamb.x - s2.hinge.x, s2.jamb.y - s2.hinge.y))
    ok('«' + o.mark + '»: откосы на ширину проёма', jl === o.width, jl + ' ≠ ' + o.width)
  })
  ok('у окна створки нет', sc.openings.filter((o) => o.kind === 'win').every((o) => o.swing === null))
  ok('марки проставлены', sc.openings.map((o) => o.mark).join(' ') === 'О-1 Д-1 О-2 Д-2 Д-3',
    sc.openings.map((o) => o.mark).join(' '))

  // Цепочка двери в перегородке меряется от ЧИСТОВЫХ стен, как на чертеже.
  const d2 = sc.dims.find((d) => d.name === 'Д-2')
  ok('Д-2: 800 · 600 · 800', d2 && d2.segs.join(' ') === '800 600 800', d2 && d2.segs.join(' '))
  ok('Д-2 стоит у своей перегородки', d2 && d2.at === sc.walls.find((w) => w.kind === 'part').x)
  const d3 = sc.dims.find((d) => d.name === 'Д-3')
  ok('Д-3: 1500 · 600 · 100', d3 && d3.segs.join(' ') === '1500 600 100', d3 && d3.segs.join(' '))
  ok('обе цепочки внутренние', d2 && d3 && d2.inner === true && d3.inner === true)
  // Высота — из ИЗДЕЛИЯ, а подоконник из проёма: витраж 2390 при потолке 2500
  // стоит на 100, и обе величины обязаны приехать в чертёж, а не в него вписаться.
  ok('высота и подоконник приехали из изделия',
    sc.openings.some((o) => o.height === 2390 && o.sill === 100), JSON.stringify(sc.openings.map((o) => [o.height, o.sill])))

  // Проём без изделия рисовать нечем — на схему он не попадает, а не встаёт нулевым.
  const broken = Object.assign({}, model, {
    openings: model.openings.concat([{ id: 'ghost', side: 'n', pos: 1000, typeId: 'нет такого' }]),
  })
  ok('проём без изделия на схему не попал', modelScheme(broken, winTypes).openings.length === 5)

  // Дверь в перегородке, которой больше нет (отсеки слили), рисовать не на чем.
  const orphan = Object.assign({}, model, {
    openings: model.openings.map((o) => (o.side === 'part' ? Object.assign({}, o, { after: 'нет отсека' }) : o)),
  })
  ok('дверь потерянной перегородки на схему не попала', modelScheme(orphan, winTypes).openings.length === 3)
}

// ── 3в. Открывание двери в наружной стене ────────────────────────────────────
// Куда открывается дверь — свойство ПРОЁМА, а не стены: входная дверь бывает и
// внутрь тамбура, и петли бывают на любом откосе. Нарисовать створку не в ту
// сторону — соврать о том, что она заденет: мебель, соседнюю дверь, край крыльца.
{
  console.log('Открывание двери в стене коробки')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const door = model.openings.filter((o) => o.side !== 'part')
    .find((o) => (winTypes.find((t) => t.id === o.typeId) || {}).kind === 'door')
  const swing = () => modelScheme(model, winTypes).openings.find((o) => o.id === door.id).swing

  const out = swing()
  ok('по умолчанию — наружу', out.tip.y > modelScheme(model, winTypes).w, JSON.stringify(out.tip))
  const hingeWas = out.hinge.x

  door.into = -1
  ok('внутрь — створка в комнате', swing().tip.y < modelScheme(model, winTypes).w, JSON.stringify(swing().tip))
  ok('петли при этом на месте', swing().hinge.x === hingeWas)

  door.hinge = (door.hinge === 'start') ? 'end' : 'start'
  ok('другой откос — петли переехали', swing().hinge.x !== hingeWas, JSON.stringify(swing().hinge))

  // Четыре сочетания дают четыре разных чертежа — иначе кнопка ничего не меняет.
  const seen = new Set()
  ;[1, -1].forEach((into) => ['start', 'end'].forEach((h) => {
    door.into = into; door.hinge = h
    const sw = swing()
    seen.add([sw.hinge.x, sw.hinge.y, sw.tip.x, sw.tip.y].join(' '))
  }))
  ok('все четыре положения различаются', seen.size === 4, [...seen].join(' | '))
}

// ── 3б. Усиление проёмов ─────────────────────────────────────────────────────
// По обе стороны окна и входной двери стоит труба 40×40 во всю высоту, изделие
// встаёт между трубами. Значит проём в стене шире изделия на две трубы и два
// зазора — по этим числам режут стену, и ошибка здесь стоит переваренного проёма.
{
  console.log('Усиление проёмов')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)
  const outer = sc.openings.filter((o) => o.side !== 'part')

  const win1 = sc.openings.find((o) => o.mark === 'О-1')
  ok('у окна две трубы', win1.frame === true && win1.jambs.length === 2, JSON.stringify(win1.jambs))
  ok('труба 40×40', win1.jambs.every((j) => j.w === 40 && j.h === 40))
  ok('зазор до изделия 20 мм с обеих сторон',
    win1.x - (win1.jambs[0].x + 40) === 20 && win1.jambs[1].x - (win1.x + win1.w) === 20,
    JSON.stringify([win1.x, win1.w, win1.jambs[0].x, win1.jambs[1].x]))
  ok('и проём выходит шире изделия на 120',
    (win1.jambs[1].x + 40) - win1.jambs[0].x === win1.width + 120)
  ok('труба стоит в толще стены',
    win1.jambs.every((j) => j.y >= win1.y && j.y + j.h <= win1.y + win1.h), JSON.stringify(win1.jambs))

  const door = sc.openings.find((o) => o.mark === 'Д-1')
  ok('у входной двери усиление тоже есть', door.frame === true && door.jambs.length === 2)

  // Торцевой витраж глухой: он стоит между собственными стойками контейнера.
  const vitr = sc.openings.find((o) => o.mark === 'О-2')
  ok('у глухого витража усиления нет', vitr.frame === false && vitr.jambs.length === 0)
  // Межкомнатные двери стоят в каркасной перегородке — варить не во что.
  ok('в перегородках усиления нет',
    sc.openings.filter((o) => o.side === 'part').every((o) => o.frame === false && !o.jambs.length))
  ok('трубы считаются только у наружных проёмов',
    outer.filter((o) => o.jambs.length).length === 2, String(outer.filter((o) => o.jambs.length).length))

  // Решение человека сильнее умолчания — в обе стороны.
  const off = Object.assign({}, model, {
    openings: model.openings.map((o) => (o.side === 's' ? Object.assign({}, o, { frame: false }) : o)),
  })
  ok('снятое усиление не рисуется',
    modelScheme(off, winTypes).openings.filter((o) => o.side === 's').every((o) => !o.jambs.length))
  const on = Object.assign({}, model, {
    openings: model.openings.map((o) => (o.side === 'e' ? Object.assign({}, o, { frame: true }) : o)),
  })
  ok('и включённое у глухого — рисуется',
    modelScheme(on, winTypes).openings.find((o) => o.side === 'e').jambs.length === 2)

  // Торцевой проём меряется по ширине: трубы стоят сверху и снизу от него.
  const endOn = modelScheme(on, winTypes).openings.find((o) => o.side === 'e')
  ok('у торцевого проёма трубы разнесены по ширине контейнера',
    endOn.jambs[0].y + 40 + 20 === endOn.y && endOn.jambs[1].y === endOn.y + endOn.h + 20,
    JSON.stringify(endOn.jambs))
}

// ── 4. Ничего лишнего ────────────────────────────────────────────────────────
{
  console.log('Чего на схеме нет')
  const { model, winTypes } = presetModel('c12-san-liv-bed', [], ids())
  const sc = modelScheme(model, winTypes)
  const flat = JSON.stringify(sc)
  ok('раскладки (розетки, мебель) нет', flat.indexOf('"pts"') < 0)
  // Площадь у подписи ЕСТЬ: по ней рисуется план для клиента, который меряет дом
  // метрами, а не цепочками. На рабочем чертеже её по-прежнему не печатают —
  // это сторожит `test-spec2-tab` на самом SVG.
  ok('площадь есть у имени помещения',
    sc.labels.every((x) => typeof x.area === 'number' && x.area > 0), JSON.stringify(sc.labels[0]))
  ok('и границы комнаты — тоже',
    sc.labels.every((x) => x.x0 < x.x1 && x.x >= x.x0 && x.x <= x.x1))
  ok('общей площади дома на схеме нет', flat.indexOf('"floorArea"') < 0)
  // Имена помещений НУЖНЫ: без них чертёж читают, водя пальцем по цепочкам.
  ok('имена помещений на месте',
    modelRooms(model).every((r) => sc.labels.some((x) => x.name === r.name)),
    JSON.stringify(sc.labels.map((x) => x.name)))
  ok('подпись стоит внутри своей комнаты',
    sc.labels.every((x) => x.x > 0 && x.x < sc.l && x.y > 0 && x.y < sc.w))
  // Границы комнаты по ширине едут вместе с подписью: имя ставится на доле высоты
  // СВОЕЙ комнаты, а санузел у верхней стены занимает не всю ширину дома — «треть
  // высоты дома» увела бы его имя в коридор под ним, к чужому полу.
  ok('у подписи есть и границы по ширине',
    sc.labels.every((x) => x.y0 != null && x.y1 != null && x.y >= x.y0 && x.y <= x.y1),
    JSON.stringify(sc.labels.map((x) => [x.name, x.y0, x.y, x.y1])))
  ok('в схеме только стены, их контур, проёмы, подписи и размеры',
    Object.keys(sc).sort().join(' ') === 'dims finish l labels openings outline w wallThick walls',
    Object.keys(sc).sort().join(' '))
  // Контур — обводка стен как ОДНОГО тела: обводить каждую стену отдельно значит
  // рисовать линию на каждом стыке, а сросшиеся стены на чертеже линией не делятся.
  ok('контур замкнут по коробке', sc.outline.length > 0 &&
    sc.outline.every((s) => s.x1 === s.x2 || s.y1 === s.y2), String(sc.outline.length))
  ok('и не проходит внутри стены',
    !sc.outline.some((s) => sc.walls.some((w) =>
      Math.min(s.x1, s.x2) > w.x && Math.max(s.x1, s.x2) < w.x + w.w &&
      Math.min(s.y1, s.y2) > w.y && Math.max(s.y1, s.y2) < w.y + w.h)))
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
