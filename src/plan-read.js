// ─── ЧУЖОЙ ЧЕРТЁЖ → НАША МОДЕЛЬ ──────────────────────────────────────────────
// Заказчик приходит с планировкой: PDF от архитектора, скрин из «Планоплана»,
// фотография бумаги в клетку. Раньше её перечерчивали руками — полчаса на дом и
// опечатка в метре, которая всплывает на сдаче. Здесь чертёж читает Claude, а
// человек СВЕРЯЕТ прочитанное с подложкой: из этих метров считается смета, и
// «модель почти всегда права» — не тот порог, за которым можно выставлять счёт.
//
// Поэтому модуль устроен как перевод, а не как оракул:
//   planRequest()  — что именно спросить у модели (чистая сборка запроса);
//   planNormalize()— привести ответ к нашим единицам и отсеять невозможное;
//   planToModel()  — собрать модель портала, ЗАПОМНИВ каждое расхождение.
// Ни одна из трёх функций не ходит в сеть: их гоняют тесты на выдуманных ответах,
// а Worker только подставляет байты файла.
//
// Все размеры — миллиметры, как во всей модели.
import {
  CONTAINERS, emptyModel, FINISH_THICK, MIN_ROOM,
  WIN_CATALOG, INNER_DOOR, winTypeFrom, totalLength, alignHeads,
} from "./model.js";

// Читает чертёж модель посильнее: план — это картинка с цифрами, и ошибка в
// цифре стоит дороже разницы в цене запроса.
export const PLAN_MODEL = "claude-opus-5";

// Сколько листов принимаем за раз. Ограничение не техническое, а смысловое: это
// листы ОДНОГО дома, и когда их десяток — читают уже не дом, а архив проекта.
export const PLAN_MAX_FILES = 8;

// Схема ответа. Строгая (`strict: true`): не «попроси JSON и надейся», а
// гарантия формата на стороне API — разбирать текст с числами мы не будем.
// Чего на чертеже не видно, приходит как null: выдуманный размер хуже пустого,
// пустой человек впишет сам, выдуманный он подпишет не глядя.
const NUM = { type: ["number", "null"] };
export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["length", "width", "height", "bays", "openings", "notes"],
  properties: {
    length: Object.assign({ description: "Длина дома снаружи, мм" }, NUM),
    width: Object.assign({ description: "Ширина дома снаружи, мм" }, NUM),
    height: Object.assign({ description: "Высота помещений в чистоте, мм" }, NUM),
    bays: {
      type: "array",
      description: "Помещения слева направо вдоль длинной стены",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "len"],
        properties: {
          name: { type: "string", description: "Подпись помещения на чертеже" },
          len: Object.assign({ description: "Длина помещения в чистоте, мм" }, NUM),
        },
      },
    },
    openings: {
      type: "array",
      description: "Окна и двери",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "side", "after_bay", "pos", "width", "height", "sill", "label"],
        properties: {
          kind: { type: "string", enum: ["win", "door"] },
          side: { type: "string", enum: ["n", "s", "w", "e", "part"] },
          after_bay: Object.assign({ description: "Для side=part: номер помещения слева от перегородки, с нуля" }, NUM),
          pos: Object.assign({ description: "От наружного левого угла (n/s) или от верхней длинной стены (w/e/part) до ближнего края проёма, мм" }, NUM),
          width: Object.assign({ description: "Ширина проёма, мм" }, NUM),
          height: Object.assign({ description: "Высота проёма, мм (на чертежах подписывают H=…)" }, NUM),
          sill: Object.assign({ description: "Высота низа проёма от чистого пола, мм (на чертежах «Н под.=…»); у дверей 0" }, NUM),
          label: { type: "string", description: "Подпись у проёма на чертеже — по ней человек найдёт его глазами" },
        },
      },
    },
    notes: { type: "string", description: "Что прочитать не удалось и что пришлось предположить" },
  },
};

export const PLAN_TOOL = {
  name: "plan_read",
  description: "Вернуть прочитанную планировку контейнерного дома",
  input_schema: PLAN_SCHEMA,
  strict: true,
};

export const PLAN_SYSTEM = [
  "Ты читаешь планировку модульного дома из морского контейнера — вид сверху.",
  "Дом вытянут вдоль длинной стены; помещения идут друг за другом по этой длине.",
  "Стороны: n — верхняя длинная стена на чертеже, s — нижняя, w — левый торец, e — правый торец,",
  "part — внутренняя перегородка (тогда after_bay — номер помещения слева от неё, считая с нуля).",
  "Размеры бери С ЧЕРТЕЖА: сначала подписанные числа, и только если размер не подписан — меряй по масштабу.",
  "Все размеры переводи в МИЛЛИМЕТРЫ (на чертежах бывают см и метры: 2,4 м и 240 см — это 2400).",
  "Длины помещений — В ЧИСТОТЕ, между отделанными стенами, как их подписывают на плане.",
  "Положение проёма — до его БЛИЖНЕГО края (левого для n/s, верхнего для w/e/part), от наружного угла дома.",
  "Подписи у проёмов читай так: H=190 — высота проёма, «Н под.=20» — высота подоконника от пола (в тех же единицах, что и весь чертёж).",
  "У дверей подоконник 0. Ширину проёма бери из размерной цепочки по стене, а не из подписи H.",
  "Файлов может быть несколько — это РАЗНЫЕ ЛИСТЫ ОДНОГО дома (план, фасады, разрезы, страницы одного PDF).",
  "Читай их вместе и верни ОДНУ планировку: план даёт длины и положения, разрез и фасад — высоты проёмов.",
  "Не складывай листы как разные дома и не удваивай помещения, увидев их на двух листах.",
  "Если листы противоречат друг другу — верь плану в размерах и напиши о расхождении в notes.",
  "Чего на чертеже нет — оставляй null и пиши об этом в notes. Не достраивай планировку по здравому смыслу:",
  "по этим числам выставляют счёт, и придуманный размер дороже пропущенного.",
].join(" ");

// Запрос к Messages API. PDF уходит как есть — Claude читает страницы сам, и
// растрировать его на нашей стороне не нужно. Картинка — тем же блоком, но типом
// image: тип блока обязан совпадать с типом файла, иначе API отвечает 400.
//
// Файлов может быть НЕСКОЛЬКО, и уходят они одним запросом: заказчик присылает
// план, фасады и разрезы отдельными листами, а дом на них один. Прочитанное по
// одному листу пришлось бы сшивать самим — и сшивать вслепую: высоту окна с
// разреза не с чем связать, кроме как с планом, который в том же запросе.
// Перед каждым файлом кладём его имя: «фасад.pdf» — это подсказка о том, что
// на листе, и стоит она дешевле любого догадывания по картинке.
export function planRequest(files, opts) {
  const o = opts || {};
  const list = (files || []).map(function (f) {
    const type = String((f && f.type) || "");
    const isPdf = type.indexOf("pdf") >= 0;
    return {
      name: String((f && f.name) || ""),
      block: isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.b64 } }
        : { type: "image", source: { type: "base64", media_type: type, data: f.b64 } },
    };
  });
  const content = [];
  list.forEach(function (f, i) {
    if (list.length > 1 || f.name) content.push({ type: "text", text: "Файл " + (i + 1) + ": " + (f.name || "без имени") });
    content.push(f.block);
  });
  content.push({ type: "text", text: o.hint || (list.length > 1
    ? "Это листы ОДНОГО дома. Прочитай их вместе и верни одну планировку через plan_read."
    : "Прочитай эту планировку и верни её через plan_read.") });
  return {
    model: o.model || PLAN_MODEL,
    max_tokens: o.max_tokens || 8000,
    system: PLAN_SYSTEM,
    tools: [PLAN_TOOL],
    // Инструмент ровно один и он обязателен: ответ нужен структурой, а не рассказом.
    tool_choice: { type: "tool", name: PLAN_TOOL.name },
    messages: [{ role: "user", content: content }],
  };
}

// Ответ API → аргументы инструмента. Ошибку API и «модель отказалась» различаем:
// первое чинит настройка, второе — другой файл.
export function planFromResponse(resp) {
  const blocks = (resp && resp.content) || [];
  const call = blocks.find(function (b) { return b && b.type === "tool_use" && b.name === PLAN_TOOL.name; });
  if (!call) {
    const text = blocks.filter(function (b) { return b && b.type === "text"; })
      .map(function (b) { return b.text; }).join(" ").trim();
    throw new Error(text ? ("Не удалось прочитать чертёж: " + text.slice(0, 300)) : "Модель не вернула планировку");
  }
  return call.input;
}

// Метры и сантиметры, просочившиеся в ответ. Модель просят про миллиметры, но
// чертёж подписан в метрах, и «2,4 м» иногда доезжает как есть.
//
// Множитель ОДИН на всю планировку, а не на каждое число: чертёж подписывают в
// одних единицах, и «эта длина в метрах, а та в миллиметрах» — не про чертежи, а
// про угадывание. Узнаём его по длине дома: контейнерный дом — это 3…20 метров,
// и в каком бы виде эта величина ни пришла, она себя выдаёт порядком.
function unitScale(r) {
  const L = Number(r.length) || 0;
  if (L >= 3000) return 1;          // миллиметры
  if (L >= 300) return 10;          // сантиметры
  if (L >= 3) return 1000;          // метры
  // Длину не прочитали — идём от самого большого числа на чертеже.
  const nums = [];
  (r.bays || []).forEach(function (b) { nums.push(Number(b && b.len) || 0); });
  (r.openings || []).forEach(function (o) { nums.push(Number(o && o.pos) || 0); });
  const max = nums.length ? Math.max.apply(null, nums) : 0;
  if (max >= 1000) return 1;
  if (max >= 100) return 10;
  return max ? 1000 : 1;
}

// Подоконник особенный: НОЛЬ — это ответ («окно от пола»), а «не подписан» —
// это null. Через toMm их не различить: там ноль означает «не прочитали», и
// неподписанное окно молча легло бы на пол.
function sillOf(v, k) {
  if (v == null) return null;
  if (Number(v) === 0) return 0;
  return toMm(v, k, 1, 2500) || null;
}

function toMm(v, k, lo, hi) {
  const n = Math.round((Number(v) || 0) * k);
  if (!isFinite(n) || n <= 0) return 0;
  return (n >= lo && n <= hi) ? n : 0;
}

// Прочитанное → наши единицы и наши границы. Всё, что пришлось поправить или
// выбросить, возвращается списком: человек увидит это списком у себя на экране.
export function planNormalize(raw) {
  const r = raw || {};
  const warn = [];
  const k = unitScale(r);
  const bays = (r.bays || []).map(function (b, i) {
    return { name: String((b && b.name) || "").trim() || ("Помещение " + (i + 1)), len: toMm(b && b.len, k, 900, 20000) };
  }).filter(function (b, i) {
    if (b.len) return true;
    warn.push("«" + b.name + "»: длина не прочиталась — помещение пропущено");
    return false;
  });

  const openings = (r.openings || []).map(function (o, i) {
    const it = o || {};
    const side = ["n", "s", "w", "e", "part"].indexOf(it.side) >= 0 ? it.side : "s";
    const label = String(it.label || "").trim();
    const nameOf = label || ((it.kind === "door" ? "Дверь" : "Окно") + " №" + (i + 1));
    const w = toMm(it.width, k, 300, 6000);
    if (!w) { warn.push(nameOf + ": ширина не прочиталась — проём пропущен"); return null; }
    return {
      kind: (it.kind === "door") ? "door" : "win",
      side: side,
      after: (it.after_bay == null) ? null : Math.max(0, Math.round(Number(it.after_bay) || 0)),
      pos: toMm(it.pos, k, 1, 20000),
      w: w,
      // Высоту не прочитали — ставим типовую: без неё изделие не заказать, а
      // 2100 у двери и 1400 у окна человек поправит быстрее, чем впишет с нуля.
      h: toMm(it.height, k, 300, 3000) || (it.kind === "door" ? 2100 : 1400),
      // Подоконник читаем, если подписан: чертёж знает его точнее, чем наша общая
      // линия верха. Ноль — тоже ответ (дверь), поэтому «не подписан» — это null.
      sill: (it.kind === "door") ? 0 : sillOf(it.sill, k),
      label: label,
      guessH: !toMm(it.height, k, 300, 3000),
    };
  }).filter(Boolean);

  openings.forEach(function (o) {
    if (o.guessH) warn.push((o.label || "проём " + o.w) + ": высота не подписана, поставили " + o.h);
  });

  return {
    plan: {
      length: toMm(r.length, k, 3000, 20000),
      width: toMm(r.width, k, 1800, 5000),
      height: toMm(r.height, k, 1800, 4000),
      bays: bays, openings: openings,
      notes: String(r.notes || "").trim(),
    },
    warnings: warn,
  };
}

// Ближайший типоразмер контейнера. Обмер чужого чертежа гуляет на сантиметры, и
// 11 950 — это 40 футов, а не «свой размер»: у типоразмера правильная ширина и
// высота, а они на чертеже подписаны редко.
function pickContainer(len, width, height) {
  let best = null, bestD = Infinity;
  CONTAINERS.forEach(function (c) {
    // Высота помещения в чистоте больше высоты коробки не бывает: 2500 в чистоте —
    // это HC, и обычный сорокафутовый отпадает, хотя по длине они близнецы.
    if (height && height > c.h) return;
    const d = Math.abs(c.l - (len || 0)) + Math.abs(c.w - (width || c.w)) / 2;
    if (d < bestD) { bestD = d; best = c; }
  });
  return (bestD <= 500) ? best : null;
}

// Что вообще можно поставить в дом: каталог поставщика плюс стандартное
// межкомнатное полотно. Полотно живёт константой, а не строкой каталога, но
// заказывают его так же, и подбирать двери без него — значит каждый раз заводить
// «Дверь 700×2050» заново.
const PRODUCTS = WIN_CATALOG.concat([Object.assign({ k: "inner-door", cost: 0 }, INNER_DOOR)]);

// Насколько далеко изделие может быть от чертежа, чтобы всё ещё считаться тем же.
// Полметра — это ещё «окно чуть другое», а витраж 4 м подменить окном 1,3 м уже
// не «ближайшее», а другой дом.
const FIT_LIMIT = 500;

// Изделие под прочитанный размер. Порядок такой:
//   1) справочник дома — там СОГЛАСОВАННАЯ цена, и переписывать её нельзя;
//   2) БЛИЖАЙШЕЕ по размеру из каталога — заказывают из него, и рисовать окно,
//      которого не купить, значит рисовать чертёж под несуществующий дом;
//   3) если в каталоге нет ничего близкого — изделие по чертежу с нулевой ценой.
// Всякая подмена называется вслух: чертёж говорил 1450, а поедет 1500.
function findType(types, kind, w, h, gen) {
  const near = function (list, limit) {
    let best = null, bestD = Infinity;
    list.forEach(function (t) {
      if (!t || (t.kind || "win") !== kind) return;
      const d = Math.abs(Number(t.w) - w) + Math.abs(Number(t.h) - h);
      if (d < bestD) { bestD = d; best = t; }
    });
    return (best && Math.abs(Number(best.w) - w) <= limit && Math.abs(Number(best.h) - h) <= limit)
      ? best : null;
  };

  // Своё изделие берём только когда оно ТО ЖЕ: у дома в справочнике лежит десяток
  // строк, и «ближайшая» из них подставила бы входную дверь вместо межкомнатной —
  // 300 мм разницы, зато уже заведена. Ближайшее ищут в каталоге, а не среди
  // случайного набора, который успел накопиться в проекте.
  const mine = near(types, 50);
  if (mine) return { id: mine.id, added: null, w: Number(mine.w), h: Number(mine.h), n: mine.n };

  const cat = near(PRODUCTS, FIT_LIMIT);
  if (cat) {
    const t = winTypeFrom(cat, gen());
    return { id: t.id, added: t, w: t.w, h: t.h, n: t.n };
  }
  const t = { id: gen(), kind: kind, n: (kind === "door" ? "Дверь " : "Окно ") + w + "×" + h, w: w, h: h, cost: 0, face: null };
  return { id: t.id, added: t, w: w, h: h, n: t.n, none: true };
}

// Прочитанное → модель портала. Здесь чистовые размеры чертежа становятся
// размерами ПО КОРОБКЕ: у крайних помещений отделка съедает ещё и торец, и
// чистовым 2000 соответствует 2076 по коробке. Считать наоборот нельзя — площади
// разъедутся с чертежом ровно на толщину обшивки, а по ним считают деньги.
export function planToModel(plan, winTypes, newId) {
  const p = plan || {};
  let seq = 0;
  const gen = (typeof newId === "function") ? newId : function () { return "pl-" + (++seq); };
  const warn = [];
  const c = pickContainer(p.length, p.width, p.height);
  const model = emptyModel(c ? c.k : "40hc");
  if (!c && p.length) {
    // Не типоразмер — бывают сборки из двух контейнеров и распилы. Типоразмер не
    // навязываем, ширину и высоту берём контейнерные, если их не прочитали.
    model.type = "custom";
    warn.push("Длина " + p.length + " мм не совпала с типоразмером — оставили как есть");
  }
  // Длина — с ЧЕРТЕЖА, а не из справочника: 11 952 у заказчика и 12 032 в
  // каталоге — это один контейнер, но считать надо по его чертежу.
  if (p.length) { model.l = p.length; model.rooms[0].len = p.length; }
  if (p.width) model.w = p.width;
  if (p.height) model.h = p.height;

  // Чистовые длины → длины по коробке.
  const fin = Number(model.finish) || FINISH_THICK;
  const bays = (p.bays || []).map(function (b, i, all) {
    const ends = (i === 0 ? fin : 0) + (i === all.length - 1 ? fin : 0);
    return { id: gen(), name: b.name, len: b.len + ends, pts: {} };
  });
  if (bays.length) {
    model.rooms = bays;
    // Сумма отсеков обязана сойтись с длиной коробки до миллиметра: иначе
    // последняя перегородка окажется за торцом, а площади — вымышленными.
    // Расхождение чужого обмера кладём в САМОЕ ДЛИННОЕ помещение: там сантиметр
    // незаметен, а в санузле он — четверть процента площади.
    const gap = model.l - totalLength(model);
    if (gap) {
      const big = bays.reduce(function (a, b) { return (b.len > a.len) ? b : a; });
      big.len = Math.max(MIN_ROOM, big.len + gap);
      if (Math.abs(gap) > 100) {
        warn.push("Сумма помещений разошлась с длиной дома на " + Math.abs(gap) +
          " мм — разницу добавили в «" + big.name + "», проверьте");
      }
    }
  }

  const types = (winTypes || []).slice();
  // Подбор изделий — отдельный список, а не только предупреждения: человек сверяет
  // «что нарисовано» с «что заказываем» построчно, и в панели это таблица, а не
  // абзац текста внизу.
  const picks = [];
  model.openings = (p.openings || []).map(function (o) {
    const found = findType(types, o.kind, o.w, o.h, gen);
    if (found.added) types.push(found.added);
    const named = o.label || ((o.kind === "door" ? "дверь " : "окно ") + o.w + "×" + o.h);
    if (found.none) {
      warn.push(named + " " + o.w + "×" + o.h + ": в каталоге нет ничего близкого — завели изделие по чертежу, впишите цену");
    } else if (found.w !== o.w || found.h !== o.h) {
      warn.push(named + ": на чертеже " + o.w + "×" + o.h + ", поставили «" + found.n + "» — ближайшее, что заказываем");
    }
    picks.push({
      label: o.label, kind: o.kind, side: o.side, pos: o.pos,
      sill: o.sill,
      w: o.w, h: o.h,                       // что на чертеже
      name: found.n, tw: found.w, th: found.h,   // что поедет в заказ
      cost: (found.added ? Number(found.added.cost) || 0 : null),
      same: (found.w === o.w && found.h === o.h),
      none: !!found.none,
    });
    // Подменённое изделие встаёт ЦЕНТРОМ туда, где было нарисованное: чертёж
    // показывал окно посреди простенка, и разница в 50 мм ширины не должна
    // сдвигать его вбок.
    const pos = Math.max(0, Math.round(o.pos + (o.w - found.w) / 2));
    const op = { id: gen(), side: o.side, pos: pos, typeId: found.id };
    if (o.side === "part") {
      const bay = bays[o.after == null ? 0 : o.after];
      if (!bay || bay === bays[bays.length - 1]) {
        warn.push(named + ": не понятно, на какой перегородке — пропущен");
        return null;
      }
      op.after = bay.id;
      op.into = 1;
      op.hinge = "start";
    }
    // Проём, вылезший за стену, — это не планировка, а ошибка чтения: прижимаем
    // к стене и говорим об этом, чтобы человек посмотрел именно на него.
    const wallLen = (o.side === "n" || o.side === "s") ? totalLength(model) : (Number(model.w) || 0);
    if (found.w > wallLen) {
      // Изделие шире самой стены — сдвигать некуда, и «сдвинули на 0» тут только
      // сбивает: скорее всего перепутана сторона (торец вместо длинной стены).
      warn.push(named + ": " + found.w + " мм шире стены (" + wallLen + " мм) — проверьте сторону и размер");
      op.pos = 0;
    } else if (op.pos + found.w > wallLen) {
      const fixed = Math.max(0, wallLen - found.w);
      warn.push(named + ": не помещается в стену — сдвинули на " + fixed + " мм");
      op.pos = fixed;
    }
    return op;
  }).filter(Boolean);

  // Подоконник: подписанный на чертеже («Н под.=20») читаем с него, остальным
  // ставим общую линию верха — ровно так же, как выравнивает редактор: двери от
  // пола, окна подвешены под перемычку. Разнобой по верху человек на плане не
  // заметит, а на фасаде — сразу.
  const sills = {};
  (p.openings || []).forEach(function (o, i) { sills[i] = o.sill; });
  model.openings = alignHeads(model, types).openings.map(function (op, i) {
    if (op.side === "part") {
      const cut = Object.assign({}, op);
      delete cut.sill;                // у двери в перегородке порога нет
      return cut;
    }
    // Подписанный на чертеже подоконник выигрывает у нашей линии верха: это ЗАМЕР,
    // а не правило.
    const said = sills[i];
    return (said == null) ? op : Object.assign({}, op, { sill: said });
  });

  return { model: model, winTypes: types, warnings: warn, picks: picks };
}
