import { regions, wallOutline } from "./geom.js";

// ─── МОДЕЛЬ КОНТЕЙНЕРА ───────────────────────────────────────────────────────
// Дом из морского контейнера — это коробка фиксированного размера, разделённая
// перегородками, с проёмами в стенах. Больше в нём ничего нет, и этого достаточно,
// чтобы считать площади, а из площадей — смету.
//
// Поэтому модель здесь не «BIM» в смысле IFC, а ровно то, что меняет деньги:
// длины помещений вдоль контейнера и проёмы на стенах. Всё остальное (розетки,
// отделка, этапы) уже умеет спецификация и берёт отсюда готовые площади.
//
//   model = {
//     type: "40hc",                  // типоразмер, см. CONTAINERS
//     l, w, h,                       // внутренние габариты, мм
//     rooms:    [{id, name, len, pts, sub}],   // ОТСЕКИ поперёк контейнера
//     openings: [{id, side, pos, sill, typeId}],   // проёмы на стенах
//     wallThick, finish               // перегородка и толщина отделки, мм
//   }
//
// Отсек — поперечный кусок контейнера. Обычно это одно помещение во всю ширину,
// но санузел стоит в углу, поэтому отсек умеет делиться ещё и вдоль:
// `sub = {id, name, pts, at}` — вторая комната, `at` = ширина ПЕРВОЙ (от верхней
// стены). Дальше двух комнат в отсеке не идём: в контейнере шириной 2,35 м
// третья полоса — это уже не помещение.
//
// Помещения хранятся ДЛИНАМИ, а не координатами границ: перетаскивание границы —
// это перенос миллиметров из одного помещения в соседнее, и в таком виде сумма
// длин не может разъехаться с длиной контейнера из-за округления.

export const CONTAINERS = [
  { k: "20",    n: "20 футов",        l: 5898,  w: 2352, h: 2393 },
  { k: "40",    n: "40 футов",        l: 12032, w: 2352, h: 2393 },
  { k: "40hc",  n: "40 футов HC",     l: 12032, w: 2352, h: 2698 },
  { k: "45hc",  n: "45 футов HC",     l: 13556, w: 2352, h: 2698 },
];

export const MIN_ROOM = 900;      // меньше — уже не помещение, а шкаф
// Стандартное межкомнатное полотно. Живёт здесь, а не в заготовке: его ставят и в
// заготовке, и руками в редакторе, и размер обязан быть один — по нему заказывают.
export const INNER_DOOR = { kind: "door", n: "Дверь межкомнатная 600×2050", w: 600, h: 2050 };
export const WALL_THICK = 100;    // каркасная перегородка с обшивкой
// Обрешётка с утеплителем и обшивкой съедает по стене сантиметров восемь. Без этого
// модель считает по железу контейнера и даёт лишний квадрат на комнату — а это уже
// материалы и деньги: в проекте №7640467 при ширине контейнера 2352 комнаты 2200.
export const FINISH_THICK = 76;
// Усиление проёма: по обе стороны окна или входной двери стоит труба 40×40 во всю
// высоту, и изделие вставляется МЕЖДУ трубами с зазором на монтаж. Значит проём в
// коробке шире изделия на две трубы и два зазора — по этим числам режут стену, и
// ошибка здесь стоит переваренного проёма.
export const JAMB_TUBE = 40;          // труба 40×40 мм
export const JAMB_GAP_MIN = 15, JAMB_GAP = 20;   // зазор до изделия, мм

// Пирог перегородки: из чего она собрана, слой за слоем поперёк толщины. Бригаде
// нужен именно этот список — по нему считают материал и собирают стену, а «100 мм»
// на плане не говорит, что внутри. Умолчание — типовой пирог заказчика; правится
// в редакторе и живёт в модели, потому что у каждого дома он свой.
export const WALL_LAYERS = [
  { n: "Плитка SPC", mm: 5 },
  { n: "ОСП", mm: 9 },
  { n: "Пароизоляция", mm: 0.1 },
  { n: "Брус", mm: 50 },
  { n: "Пароизоляция", mm: 0.1 },
  { n: "ОСП", mm: 9 },
  { n: "Фанера шлифованная", mm: 4 },
];

// Пирог НАРУЖНОЙ стены: железо контейнера, утеплитель, обрешётка и обшивка. Это
// те самые миллиметры, на которые чистовое помещение меньше коробки, — раньше они
// стояли одним числом `finish`, и что за ним, знал только тот, кто его вписал.
export const SKIN_LAYERS = [
  { n: "Металл контейнера", mm: 2 },
  { n: "ППУ", mm: 50 },
  { n: "Обрешётка из бруса 20×40", mm: 20 },
  { n: "ОСП", mm: 9 },
  { n: "Фанера", mm: 4 },
];

const listOf = function (own, def, pre) {
  return (own && own.length) ? own : def.map(function (l, i) {
    return { id: pre + (i + 1), n: l.n, mm: l.mm };
  });
};
export function wallLayers(model) { return listOf(model && model.layers, WALL_LAYERS, "wl"); }
export function skinLayers(model) { return listOf(model && model.skin, SKIN_LAYERS, "sk"); }

// План идёт ЗА пирогом: толщина стены — это сумма её слоёв, а не отдельное число,
// которое кто-то вписал руками. Поэтому правка пирога сразу двигает геометрию —
// иначе на чертеже одно, а на площадке другое. В план уходит целое число: миллиметры
// геометрии целые, и «77,2» обещало бы точность, которой в плане нет.
export function applyLayers(model, key, list) {
  // Лишние поля слоя (товар, этап) переживают правку толщины: слой — это не только
  // миллиметры, а ещё и то, из чего он сделан и по чём куплен.
  const cut = (list || []).map(function (l) {
    const out = { id: l.id, n: l.n, mm: Number(l.mm) || 0 };
    if (l.pid) out.pid = l.pid;
    if (Number(l.stage) > 0) out.stage = Number(l.stage);
    return out;
  });
  const mm = Math.max(1, Math.round(layersThick(cut)));
  const patch = { };
  patch[key] = cut;
  patch[(key === "skin") ? "finish" : "wallThick"] = mm;
  return Object.assign({}, model, patch);
}

// Толщина пирога. Считаем в десятых: пароизоляция 0,1 мм — тоже слой, и сумма
// «77,2» обязана сходиться, иначе узел спорит с планом.
export function layersThick(list) {
  return Math.round((list || []).reduce(function (a, l) { return a + (Number(l.mm) || 0); }, 0) * 10) / 10;
}

export function containerMeta(k) {
  return CONTAINERS.find(function (c) { return c.k === k; }) || CONTAINERS[1];
}

export function emptyModel(k) {
  const c = containerMeta(k || "40hc");
  return {
    type: c.k, l: c.l, w: c.w, h: c.h, wallThick: WALL_THICK, finish: FINISH_THICK,
    rooms: [{ id: "rm1", name: "Помещение", len: c.l, pts: {} }],
    openings: [],
  };
}

// ─── КАТАЛОГ ИЗДЕЛИЙ ─────────────────────────────────────────────────────────
// Окна и двери приходят от поставщика спецификацией: система, размер, раскладка и
// цена. Их заказывают повторно, поэтому каталог живёт в коде рядом с заготовками
// планировок, а в данные портала попадает КОПИЕЙ — как материал из каталога в
// смету: поставщик поменяет цену, а проданное останется таким, как продали.
//
// Раскладка створок — не оформление. Два окна одного габарита, глухое и
// поворотно-откидное, стоят разных денег и монтируются по-разному, а строка
// «1300×1150» их не различает. Из той же раскладки рисуется мини-картинка, и
// разойтись с изделием она не может: она и есть изделие.
//
//   face: [{h, cells:[{w, o, hg}]}]  — ряды сверху вниз, в ряду створки слева направо
//   o:  ""  глухая | "po" поворотно-откидная | "p" поворотная
//   hg: "l" | "r"  — откос с петлями (ручка на противоположном)
//
// Источник — спецификация ПК «Окна Столицы» №ZZ/204764 от 28.08.2026. Цена в
// каталоге за ОДНО изделие: в спецификации строка окна 500×500 стоит на две штуки.
export const WIN_CATALOG = [
  {
    k: "os-1300x1150", no: 1, kind: "win", n: "Окно 1300×1150 п/о", w: 1300, h: 1150, cost: 14555,
    sys: "60 Rehau Termo · ФУТУРУСС", note: "ст/п 32 (4-10-4-10-4И) · антрацит",
    face: [{ cells: [{ w: 650 }, { w: 650, o: "po", hg: "l" }] }],
  },
  {
    k: "os-1500x1200", no: 3, kind: "win", n: "Окно 1500×1200 п/о", w: 1500, h: 1200, cost: 16307,
    sys: "60 Rehau Termo · ФУТУРУСС", note: "ст/п 32 (4-10-4-10-4И) · антрацит",
    face: [{ cells: [{ w: 750 }, { w: 750, o: "po", hg: "l" }] }],
  },
  {
    // Двухчастное: поворотно-откидная створка сверху, глухая часть снизу. В
    // спецификации строка на две штуки — 35 638,51 ₽; в каталоге цена за ОДНО.
    k: "os-1000x2100", no: 1, kind: "win", n: "Окно 1000×2100 п/о + глухое", w: 1000, h: 2100, cost: 17819,
    sys: "60 Rehau Termo · ФУТУРУСС", note: "ст/п 32 (4-10-4-10-4И) · антрацит",
    face: [{ h: 1050, cells: [{ o: "po", hg: "l" }] }, { cells: [{}] }],
  },
  {
    k: "os-500x500", no: 4, kind: "win", n: "Окно 500×500 п/о", w: 500, h: 500, cost: 6576,
    sys: "60 Rehau Termo · Vorne", note: "ст/п 32 · магнитная защёлка · антрацит",
    face: [{ cells: [{ o: "po", hg: "r" }] }],
  },
  {
    k: "os-2160x2390", no: 5, kind: "win", n: "Витраж 2160×2390 глухой", w: 2160, h: 2390, cost: 22282,
    sys: "60 Rehau Termo", note: "фрамуга 500 + два глухих поля · антрацит",
    face: [{ h: 500, cells: [{}] }, { cells: [{ w: 1080 }, { w: 1080 }] }],
  },
  {
    // Изделие №6 спецификации: поворотная створка 900 слева (петли справа, ручка
    // слева) и глухое поле 950. Строка на ДВЕ штуки — 57 330,12 ₽; в каталоге, как
    // и у остальных, цена за ОДНО изделие. Вес одного — 130,72 кг.
    k: "os-1850x2100", no: 6, kind: "win", n: "Окно 1850×2100 поворотное + глухое", w: 1850, h: 2100, cost: 28665,
    sys: "60 Rehau Termo · ФУТУРУСС", note: "поворотное D25 с цилиндром · ст/п 32 (4-10-4-10-4И) · антрацит",
    face: [{ cells: [{ w: 900, o: "p", hg: "r" }, { w: 950 }] }],
  },
  {
    // Изделие №3 спецификации: два глухих поля по 775. Строка на одну штуку.
    // Вес — 107,02 кг: две трети центнера стекла, вешать вдвоём нечего и думать.
    k: "os-1550x2100", no: 3, kind: "win", n: "Витраж 1550×2100 глухой", w: 1550, h: 2100, cost: 17613,
    sys: "60 Rehau Termo · ФУТУРУСС", note: "два глухих поля 775 · ст/п 32 (4-10-4-10-4И) · антрацит",
    face: [{ cells: [{ w: 775 }, { w: 775 }] }],
  },
  {
    k: "os-vd-1000x2100", no: 2, kind: "door", n: "Дверь входная 1000×2100", w: 1000, h: 2100, cost: 27150,
    sys: "ВД Наружу/60 Rehau", note: "многозапорный замок · ключ/барашек · антрацит",
    face: [{ cells: [{ o: "p", hg: "r" }] }],
  },
  // Межкомнатное полотно — не от этого поставщика, и цены у него в каталоге нет:
  // её ставит человек. Но ставят такую дверь чаще любой другой, и место ей здесь,
  // рядом со всем остальным, что суют в стену, а не отдельной кнопкой сбоку.
  {
    k: "inner-600x2050", kind: "door", n: INNER_DOOR.n, w: INNER_DOOR.w, h: INNER_DOOR.h, cost: 0,
    sys: "Межкомнатная", note: "цену впишете сами — она своя у каждого поставщика",
    face: [{ cells: [{ o: "p", hg: "l" }] }],
  },
];

export function winCatItem(k) {
  return WIN_CATALOG.find(function (x) { return x.k === k; }) || null;
}

// Раскладка в координатах изделия — из неё рисуется мини-картинка.
//
// Последний ряд и последняя створка в ряду добирают ОСТАТОК габарита: картинка
// обязана заполнять изделие целиком, иначе она обещает раму, которой в нём нет.
// Что заданные числа и так сходятся с габаритом — сторожит тест, а не рисование.
// Раскладки нет (изделие завели руками) — рисуем одну створку по виду: у двери
// поворотная, у окна поворотно-откидная.
export function winFace(item) {
  const it = item || {};
  const W = Math.max(0, Math.round(Number(it.w) || 0));
  const H = Math.max(0, Math.round(Number(it.h) || 0));
  const rows = (it.face && it.face.length) ? it.face
    : [{ cells: [{ o: (it.kind === "door") ? "p" : "po", hg: "r" }] }];
  const out = [];
  let y = 0;
  rows.forEach(function (row, i) {
    const rest = Math.max(0, H - y);
    const rh = (i === rows.length - 1) ? rest : Math.min(rest, Math.max(0, Math.round(Number(row.h) || 0)));
    const cells = (row.cells && row.cells.length) ? row.cells : [{}];
    let x = 0;
    out.push({
      y: y, h: rh,
      cells: cells.map(function (c, j) {
        const left = Math.max(0, W - x);
        const cw = (j === cells.length - 1) ? left : Math.min(left, Math.max(0, Math.round(Number(c.w) || 0)));
        const cell = { x: x, y: y, w: cw, h: rh, o: c.o || "", hg: (c.hg === "l") ? "l" : "r" };
        x += cw;
        return cell;
      }),
    });
    y += rh;
  });
  return { w: W, h: H, rows: out };
}

// Изделие каталога → строка справочника портала. Копия, а не ссылка: цена в
// проданном доме — согласованный бюджет, и переписывать её при правке каталога
// нельзя. Откуда пришло, помним в `cat` — по нему видно, что это то самое изделие.
export function winTypeFrom(item, id) {
  const it = item || {};
  return {
    id: id, kind: (it.kind === "door") ? "door" : "win", n: it.n || "",
    w: Number(it.w) || 0, h: Number(it.h) || 0, cost: Number(it.cost) || 0,
    // Раскладку копируем ВГЛУБЬ: общий массив створок означал бы, что правка
    // изделия в одном доме меняет картинку во всех остальных и в самом каталоге.
    face: it.face ? JSON.parse(JSON.stringify(it.face)) : null, cat: it.k || "",
  };
}

// ─── ГОТОВЫЕ ПЛАНИРОВКИ ──────────────────────────────────────────────────────
// Заготовка — уже начерченный дом: отсеки со своими длинами и проёмы в стенах.
// Типовой контейнер продают повторно, и собирать его перегородку за перегородкой
// с нуля каждому клиенту незачем: тап — и дальше это обычная модель, которую
// двигают как любую другую.
//
// Длины тут ПО КОРОБКЕ (то, что модель хранит в rooms[].len), а не чистовые: у
// крайних отсеков отделка съедает ещё и торец, поэтому чистовым 2000 мм на чертеже
// соответствует 2076 по коробке. Считать наоборот нельзя — площади разъедутся с
// чертежом ровно на толщину обшивки.
//
// Проём ссылается на изделие не по id, а по НОМЕРУ в `needs`: заготовка живёт в
// коде, справочник изделий — в данных портала, и связать их можно только размером.
export const MODEL_PRESETS = [
  {
    k: "c12-san-liv-bed",
    n: "12 м · санузел / кухня-гостиная / спальня",
    note: "По чертежу 1200 × 247 см: 4,40 + 14,08 + 7,04 м²",
    // Обмер — docs/plan-container-1200.svg (чертёж заказчика, переведённый в размеры).
    // Высота — ЧИСТОВАЯ (2500 в 40HC после пирога пола и потолка): спецификация
    // берёт h как высоту помещения, и по ней же считается площадь стен.
    type: "40hc", l: 11952, w: 2352, h: 2500, wallThick: WALL_THICK, finish: FINISH_THICK,
    rooms: [
      { name: "Санузел",        len: 2076, pts: {} },
      { name: "Кухня-гостиная", len: 6400, pts: {} },
      { name: "Спальня",        len: 3276, pts: {} },
    ],
    // Изделия — ключами каталога: заказывают их на заводе по ограниченному списку.
    // На чертеже заказчика окно 1500×2100 и витраж 2000×2200 — покупаем ближайшее
    // из каталога, а отметки пересчитаны по центрам нарисованных проёмов.
    needs: [
      { cat: "os-1000x2100" },       // на чертеже 1500×2100
      { cat: "os-vd-1000x2100" },
      { cat: "os-2160x2390" },       // на чертеже витраж 2000×2200
      { cat: "inner-600x2050" },
    ],
    // Проём на перегородке ссылается на отсек НОМЕРОМ (`afterRoom`) — id отсека
    // заготовка знать не может, он рождается при сборке модели.
    // Отметки межкомнатных дверей — от чистовой стены, как на чертеже: проёмы
    // 750 · 700 · 750 у санузла и 1450 · 700 · 50 у спальни (плюс обшивка 76).
    // Полотно 600 стоит в проёме по центру, поэтому отметка на 50 больше.
    openings: [
      { side: "s", pos: 3226, sill: 0,   need: 0 },   // окно по центру нарисованного (2976 + 750 − 500)
      { side: "s", pos: 5276, sill: 0,   need: 1 },   // вход: 800 от окна
      // Витраж 2390 высотой: при потолке 2500 подоконник больше 110 не поднять.
      { side: "e", pos: 96,   sill: 100, need: 2 },   // витраж в торце спальни, по центру нарисованного
      { side: "part", afterRoom: 0, pos: 876,  need: 3, into: 1, hinge: "start" },   // санузел
      { side: "part", afterRoom: 1, pos: 1576, need: 3, into: 1, hinge: "end" },     // спальня
    ],
  },
  {
    k: "svo",
    n: "Дом для СВО · санузел / зал / спальня",
    note: "По чертежу 1200 × 247 см: 4,39 + 14,08 + 7,04 м²",
    // Тот же двенадцатиметровый корпус, что и первая заготовка, но порядок комнат
    // обратный: санузел слева, зал посередине, спальня в торце с окном.
    type: "40hc", l: 11952, w: 2352, h: 2500, wallThick: WALL_THICK, finish: FINISH_THICK,
    rooms: [
      { name: "Санузел", len: 2076, pts: {} },   // 2000 в чистоте + отделка торца
      { name: "Зал",     len: 6400, pts: {} },
      { name: "Спальня", len: 3276, pts: {} },
    ],
    // Изделия — ключами каталога. На чертеже окно зала 1500 поворотно-откидное:
    // ближайшее каталожное того же габарита — витраж 1550×2100, но он ГЛУХОЙ. Если
    // створка нужна, меняется на «Окно 1850×2100 поворотное + глухое» в редакторе.
    needs: [
      { cat: "os-1550x2100" },       // на чертеже окно зала 1500×2100 п/о
      { cat: "os-vd-1000x2100" },    // вход 1000×2100, H=210
      { cat: "os-1850x2100" },       // торцевое окно спальни, на чертеже 2000×2200
      { cat: "inner-600x2050" },
    ],
    // Отметки — по нижней цепочке чертежа: 300 · 150 · 80 · 100 · 571.
    openings: [
      { side: "s", pos: 2951, sill: 0,   need: 0 },   // окно зала по центру нарисованного 1500
      { side: "s", pos: 5276, sill: 0,   need: 1 },   // вход, 800 от окна
      // Торцевое окно спальни: Н под.=20 с чертежа, по центру торца.
      { side: "e", pos: 251,  sill: 200, need: 2 },
      // Двери санузла и спальни: проёмы 700 (75 · 70 · 75 по чертежу), полотно 600
      // по центру проёма. Обе открываются в зал и в спальню — как нарисовано.
      { side: "part", afterRoom: 0, pos: 876,  need: 3, into: 1, hinge: "start" },
      { side: "part", afterRoom: 1, pos: 1476, need: 3, into: 1, hinge: "start" },
    ],
  },
  {
    k: "maksim-2",
    n: "Дом Максима 2 · спальня / санузел углом / гостиная",
    note: "По чертежу 1201 × 230 см: 7,34 + 2,71 + 14,19 м²",
    // Обмер — чертёж заказчика (два листа: чистовой план и размерный).
    // Дом читается по подписанным площадям: ширина в чистоте 210 (230 − 2×10),
    // спальня 350 × 210 = 7,35; санузел 208 × 130 = 2,70; гостиная вместе с
    // коридором под санузлом = 14,12. Все три сходятся с подписями на плане —
    // это и есть проверка, что размеры сняты верно.
    type: "40hc", l: 12010, w: 2300, h: 2500, wallThick: WALL_THICK, finish: 100,
    // Отсеков ДВА: перегородка во всю ширину здесь одна — у спальни. Санузел
    // вырезан кусками стен, и «отсеком» он не является: справа от него стены нет,
    // коридор переходит в гостиную.
    rooms: [
      { name: "Спальня",  len: 3600, pts: {} },   // 3500 в чистоте + отделка торца
      { name: "Гостиная", len: 8310, pts: {} },
    ],
    // Санузел вырезан стенами, и низ у него НЕ прямой: под душем стенка уходит
    // ВГЛУБЬ санузла на 370 — это ниша, в которой стоит шкаф, открытый в коридор.
    // Ширина санузла складывается из подписей чертежа: 100 (ниша) + 15 + 70 (дверь)
    // + 74 = 259. По ней и глубине 119 площадь выходит 2,68 против подписанных
    // 2,71 — сходится, а прямая стенка давала верную площадь при неверной форме.
    // Координаты по коробке, от левого верхнего угла.
    walls: [
      { x: 3700, y: 920,  w: 1000, h: 100 },      // верх ниши (шкаф под ней, в коридоре)
      { x: 4700, y: 920,  w: 100,  h: 470 },      // щека ниши
      { x: 4700, y: 1290, w: 1690, h: 100 },      // низ санузла, вдоль дома
      { x: 6290, y: 100,  w: 100,  h: 1190 },     // правая стенка санузла
    ],
    // Имя вырезанной комнаты держится точкой внутри неё: номера областей
    // меняются от любого движения стены, а точка остаётся в санузле.
    spots: [{ name: "Санузел", x: 5500, y: 600 }],
    // Изделия — ТОЛЬКО ключами каталога: на заводе покупают ограниченный список, и
    // окна с чертежа заказчика (900×1900, 400×800, витраж 2000×2200) там не заказать.
    // Берём ближайшее из каталога, а отметки считаем по центрам нарисованных проёмов —
    // окно шире на 100 мм не должно съезжать вбок от того места, где его начертили.
    needs: [
      { cat: "os-1000x2100" },       // на чертеже 900×1900 (H=190)
      { cat: "os-vd-1000x2100" },    // на чертеже дверь 900×2100
      { cat: "os-500x500" },         // на чертеже окно санузла 400×800 (H=80)
      { cat: "os-2160x2390" },       // на чертеже панорама 2000×2200 (H=220)
      { cat: "inner-600x2050" },
    ],
    // Отметки — по нижней размерной цепочке чертежа: 200 · 90 · 200 · 90 · 266 · 90 · 265.
    openings: [
      { side: "s", pos: 1950, sill: 200, need: 0 },   // окно спальни, по центру нарисованного 900
      { side: "s", pos: 4850, sill: 0,   need: 1 },   // вход
      { side: "s", pos: 8410, sill: 200, need: 0 },   // окно гостиной
      { side: "n", pos: 4730, sill: 1100, need: 2 },  // окно санузла, Н под.=110 с чертежа
      // Витраж 2390 высотой: при потолке 2500 подоконник выше 110 не поднять,
      // хотя на чертеже подписано 20 см.
      { side: "e", pos: 70,   sill: 100, need: 3 },   // панорама в торце гостиной
      // Дверь спальни — по цепочке чертежа: 135 стены + 5 + 70 проёма = 210 чистовой
      // ширины, то есть проём прижат к нижней стене. Открывается В СПАЛЬНЮ, петли
      // сверху — как нарисовано у заказчика. В коридор её открыть нельзя: стенка
      // санузла примыкает к перегородке прямо над проёмом и ловит полотно.
      { side: "part", afterRoom: 0, pos: 1550, need: 4, into: -1, hinge: "start" },  // H=200
      // Дверь санузла — в НИЖНЕМ куске стены (walls[1]), открывается в коридор.
      // Место по цепочке чертежа: от ниши 15, проём 70, до правой стенки 74 —
      // 4700 + 150 = 4850, и 5550 + 740 = 6290 сходится с правой стенкой санузла.
      // Полотно 600 стоит в проёме 700 по центру.
      { side: "wall", wallIdx: 2, pos: 4900, need: 4, into: 1, hinge: "end" },
    ],
  },
];

export function modelPreset(k) {
  return MODEL_PRESETS.find(function (p) { return p.k === k; }) || null;
}

// Заготовка → модель плюс изделия, которых для неё не хватает в справочнике.
// Изделие ищем по РАЗМЕРУ и виду, а не по имени: имена правят и дублируют, а окно
// 1500×2100 остаётся тем же окном. Нашлось — берём вместе с его ценой, чужую цену
// заготовка не навязывает; не нашлось — заводим с нулевой, чтобы её вписал человек.
export function presetModel(preset, winTypes, newId) {
  const p = (typeof preset === "string") ? modelPreset(preset) : preset;
  if (!p) return null;
  let seq = 0;
  const gen = (typeof newId === "function") ? newId : function () { return p.k + "-" + (++seq); };
  const types = (winTypes || []).slice();
  const ids = (p.needs || []).map(function (nd) {
    // Изделие заготовки — СТРОКА КАТАЛОГА, а не свой размер: окна заказывают на
    // заводе по ограниченному списку, и «окно 900×1900, как на чертеже заказчика»
    // купить негде. Чертёж подгоняют под то, что покупают, а не наоборот.
    const cat = winCatItem(nd.cat) || null;
    const need = cat || nd;
    const has = types.find(function (t) {
      return t && (t.kind || "win") === (need.kind || "win") &&
        Number(t.w) === Number(need.w) && Number(t.h) === Number(need.h);
    });
    if (has) return has.id;
    if (cat) { const t = winTypeFrom(cat, gen()); types.push(t); return t.id; }
    // Раскладку копируем вглубь: по ней рисуется мини-картинка изделия и решается,
    // глухое ли оно, — а общий массив означал бы, что правка в одном доме меняет
    // картинку во всех.
    const t = { id: gen(), kind: nd.kind || "win", n: nd.n, w: nd.w, h: nd.h, cost: Number(nd.cost) || 0 };
    if (nd.face) t.face = JSON.parse(JSON.stringify(nd.face));
    types.push(t);
    return t.id;
  });
  const model = {
    type: p.type, l: p.l, w: p.w, h: p.h,
    wallThick: p.wallThick, finish: p.finish,
    rooms: (p.rooms || []).map(function (r) {
      return { id: gen(), name: r.name, len: r.len, pts: Object.assign({}, r.pts || {}) };
    }),
    openings: [],
  };
  // Куски стен и подписи вырезанных ими комнат — ДО проёмов: проём в куске стены
  // ссылается на него номером в заготовке, а id рождается здесь.
  if ((p.walls || []).length) {
    model.walls = p.walls.map(function (w) { return Object.assign({ id: gen() }, w); });
  }
  if ((p.spots || []).length) {
    model.spots = p.spots.map(function (sp) { return Object.assign({}, sp, { id: gen(), pts: sp.pts || {} }); });
  }
  model.openings = (p.openings || []).map(function (o) {
    const op = { id: gen(), side: o.side, pos: o.pos, sill: o.sill, typeId: ids[o.need] };
    if (o.side === "wall") {
      const wl = (model.walls || [])[o.wallIdx];
      if (!wl) return null;
      op.wall = wl.id;
      op.into = o.into;
      op.hinge = o.hinge;
      delete op.sill;                 // дверь во внутренней стене стоит на полу
    }
    if (o.side === "part") {
      const bay = model.rooms[o.afterRoom];
      if (!bay) return null;
      op.after = bay.id;
      op.into = o.into;
      op.hinge = o.hinge;
      delete op.sill;
    }
    return op;
  }).filter(function (o) { return o && o.typeId; });
  return { model: model, winTypes: types };
}

// Габариты по типоразмеру. Свои размеры остаются, если тип «свой».
export function applyContainer(model, k) {
  const c = containerMeta(k);
  const m = Object.assign({}, model, { type: c.k, w: c.w, h: c.h });
  m.rooms = scaleRooms(model.rooms || [], c.l);
  m.l = c.l;
  return m;
}

// Растянуть/сжать помещения под новую длину пропорционально: смена типоразмера
// не должна ломать раскладку — соотношение комнат обычно и есть решение планировки.
function scaleRooms(rooms, total) {
  const src = (rooms || []).filter(function (r) { return r; });
  if (!src.length) return [{ id: "rm1", name: "Помещение", len: total, pts: {} }];
  const sum = src.reduce(function (a, r) { return a + (Number(r.len) || 0); }, 0) || 1;
  let left = total;
  return src.map(function (r, i) {
    const len = (i === src.length - 1) ? left : Math.round((Number(r.len) || 0) / sum * total);
    left -= len;
    return Object.assign({}, r, { len: len });
  });
}

// Помещения с координатами: x0/x1 — от начала контейнера, мм.
// Стены планировки — всё, что делит пол: обшивка коробки, перегородки между
// отсеками, продольные перегородки и свободные стены, нарисованные руками. Одно
// место, где планировка превращается в геометрию: по этому же списку рисуется
// чертёж, и разъехаться чертежу с расчётом больше нечем.
//
// Свободная стена (`model.walls`) — прямоугольник в тех же миллиметрах. Она может
// не доходить до соседней стены: тогда помещение не делится, а становится
// Г-образным, и это ровно то, ради чего геометрия считается заливкой.
export function modelWalls(model) {
  const m = model || {};
  const fin = (m.finish == null) ? FINISH_THICK : (Number(m.finish) || 0);
  const th = Number(m.wallThick) || 0;
  const W = Number(m.w) || 0;
  const L = totalLength(m);
  const out = [
    { kind: "shell", x: 0, y: 0, w: L, h: fin },
    { kind: "shell", x: 0, y: W - fin, w: L, h: fin },
    { kind: "shell", x: 0, y: fin, w: fin, h: Math.max(0, W - fin * 2) },
    { kind: "shell", x: L - fin, y: fin, w: fin, h: Math.max(0, W - fin * 2) },
  ];
  modelBays(m).forEach(function (b, i, all) {
    if (i < all.length - 1) out.push({ kind: "part", x: b.x1, y: fin, w: th, h: Math.max(0, W - fin * 2) });
    // Продольная перегородка (санузел в углу) идёт по чистовой длине своего отсека.
    if (b.sub) {
      const x0 = Math.max(b.x0, fin), x1 = Math.min(b.x1, L - fin);
      out.push({ kind: "part", x: x0, y: Number(b.sub.at) || 0, w: Math.max(0, x1 - x0), h: th });
    }
  });
  (m.walls || []).forEach(function (w) {
    out.push({ kind: "free", id: w.id, x: Number(w.x) || 0, y: Number(w.y) || 0,
      w: Math.max(0, Number(w.w) || 0), h: Math.max(0, Number(w.h) || 0) });
  });
  return out;
}

// ─── СВОБОДНЫЕ СТЕНЫ ─────────────────────────────────────────────────────────
// Стена, проведённая рукой, обязана встать в чертёж так, будто её ставил чертёжник:
// концами В ГРАНЬ соседней стены, без щели и без торчащего хвоста. Рука в такое не
// попадает, поэтому попадает код: концы и ось прилипают к ближайшим граням, а хвост,
// перелезший через встреченную стену, подрезается по её дальней грани.
//
// Щель в один миллиметр — это не «почти закрыто», а проход: заливка справедливо
// считает комнату одной, и кладовка молча не замыкается. Ради этого всё и делается.
export const WALL_SNAP = 220;

// ─── ВЕРХ ПРОЁМОВ ────────────────────────────────────────────────────────────
// Окна и двери в доме стоят под ОДНОЙ перемычкой: на фасаде это первое, что видно,
// и разнобой по верху читается как ошибка монтажа даже теми, кто чертежей не знает.
// Поэтому подоконник не задают — задают верх, а низ из него вычитается.
//
// 2100 — обычная высота дверного проёма, к ней и равняются окна. Изделие выше
// перемычки (панорамный витраж) вниз уже не опустить: оно встаёт от пола, и его
// верх оказывается выше линии — это не сбой, а физика.
export const OPENING_HEAD = 2100;
// Меньше этого угла дверь уже не открывается, а приоткрывается: ниже — не «тесно»,
// а «в проём не пройти». Чертим её на этом угле и говорим об этом в замечаниях.
export const SWING_MIN = 20;

// Перемычку задаёт САМАЯ ВЫСОКАЯ ДВЕРЬ: дверь стоит на полу и короче себя быть не
// может, поэтому линию верха диктует она, а окна под неё подвешиваются. Без дверей
// берём обычные 2100.
export function headHeight(model, winTypes) {
  const m = model || {};
  const H = Number(m.h) || 0;
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  const doors = (m.openings || []).map(function (op) { return byType[op.typeId]; })
    .filter(function (t) { return t && (t.kind === "door"); })
    .map(function (t) { return Number(t.h) || 0; });
  const head = Number(m.head) || Math.max(OPENING_HEAD, doors.length ? Math.max.apply(null, doors) : 0);
  return H ? Math.min(head, H - 50) : head;
}

// Низ проёма по линии верха. Проём выше перемычки прижимается к полу, а торчать
// сквозь потолок ему не даём: на чертеже такое окно выглядит как дыра в крыше.
export function headSill(model, openingHeight, winTypes) {
  const H = Number((model || {}).h) || 0;
  const h = Number(openingHeight) || 0;
  return Math.max(0, Math.min(headHeight(model, winTypes) - h, H ? (H - h) : Infinity));
}

// Выровнять верх всех проёмов по перемычке. Отдельным действием, а не молча при
// каждом расчёте: подоконник бывает задан осознанно (высокое окно в санузле), и
// стирать его без спроса — та же беда, что и разнобой по верху.
export function alignHeads(model, winTypes) {
  const m = model || {};
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  return Object.assign({}, m, {
    openings: (m.openings || []).map(function (op) {
      const t = byType[op.typeId];
      if (!t) return op;
      return Object.assign({}, op, {
        sill: (t.kind === "door") ? 0 : headSill(m, Number(t.h) || 0, winTypes),
      });
    }),
  });
}

function faces(walls, vertical) {
  return walls.reduce(function (a, w) {
    const isVert = w.h > w.w;
    if (isVert !== vertical) return a;             // ловим только перпендикулярные
    return a.concat(vertical ? [w.x, w.x + w.w] : [w.y, w.y + w.h]);
  }, []);
}
function nearest(v, cands, limit) {
  let best = v, d = limit;
  cands.forEach(function (c) { const dd = Math.abs(c - v); if (dd < d) { d = dd; best = c; } });
  return Math.round(best);
}

// Прилипание. Возвращает новый прямоугольник — тот же, если липнуть не к чему.
export function snapWall(model, rect) {
  const walls = modelWalls(model);
  const th = Number((model || {}).wallThick) || 0;
  const horiz = (Number(rect.w) || 0) >= (Number(rect.h) || 0);
  if (horiz) {
    const x0 = nearest(rect.x, faces(walls, true), WALL_SNAP);
    const x1 = nearest(rect.x + rect.w, faces(walls, true), WALL_SNAP);
    return { x: Math.min(x0, x1), y: nearest(rect.y, faces(walls, false), WALL_SNAP),
      w: Math.abs(x1 - x0), h: th || rect.h };
  }
  const y0 = nearest(rect.y, faces(walls, false), WALL_SNAP);
  const y1 = nearest(rect.y + rect.h, faces(walls, false), WALL_SNAP);
  return { x: nearest(rect.x, faces(walls, true), WALL_SNAP), y: Math.min(y0, y1),
    w: th || rect.w, h: Math.abs(y1 - y0) };
}

// Подрезка хвоста: если стена перелезла через встреченную перпендикулярную и торчит
// за неё меньше, чем на допуск прилипания, — это промах руки, а не замысел.
function trim(wall, cross) {
  const vert = wall.h > wall.w;
  const a0 = vert ? wall.y : wall.x, a1 = vert ? wall.y + wall.h : wall.x + wall.w;
  const c0 = vert ? cross.y : cross.x, c1 = vert ? cross.y + cross.h : cross.x + cross.w;
  // Пересекаются ли они вообще по второй оси — иначе это не угол, а разные места.
  const b0 = vert ? wall.x : wall.y, b1 = vert ? wall.x + wall.w : wall.y + wall.h;
  const d0 = vert ? cross.x : cross.y, d1 = vert ? cross.x + cross.w : cross.y + cross.h;
  if (b1 <= d0 || d1 <= b0) return wall;
  let lo = a0, hi = a1;
  if (a1 > c1 && a1 - c1 <= WALL_SNAP && a0 < c1) hi = c1;
  if (a0 < c0 && c0 - a0 <= WALL_SNAP && a1 > c0) lo = c0;
  if (lo === a0 && hi === a1) return wall;
  return vert ? Object.assign({}, wall, { y: lo, h: hi - lo })
    : Object.assign({}, wall, { x: lo, w: hi - lo });
}

// Поставить стену: прилипание, подрезка своего хвоста и хвостов соседей.
export function addWall(model, rect, id) {
  const m = model || {};
  const put = snapWall(m, rect);
  const th = Number(m.wallThick) || 0;
  if (put.w <= th && put.h <= th) return m;        // тап без длины — не стена
  const others = (m.walls || []);
  const fixed = others.reduce(function (w, o) { return trim(w, o); }, put);
  const next = others.map(function (o) { return trim(o, fixed); })
    .concat([Object.assign({ id: id }, fixed)]);
  return Object.assign({}, m, { walls: next });
}

// Кому принадлежит область: имя, отделка и раскладка живут в записи помещения, а не
// в самой геометрии — иначе любое движение стены обнуляло бы выбранную отделку.
//
// Раздаём личности РАЗОМ и по якорям, а не «какая область попала в отсек»: стоит
// вырезать стеной кладовку, и в границы отсека попадут две области. Обе получили бы
// один id — один и тот же выбор отделки на две разные комнаты и потерянные метры
// в смете. Имя отсека достаётся самой крупной его комнате, а вырезанные получают
// свои записи, как только человек их назовёт.
function assignRooms(model, regs) {
  const m = model || {};
  const th = Number(m.wallThick) || 0;
  const has = function (reg, px, py) {
    return reg.cells.some(function (c) { return px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h; });
  };
  const owner = new Array(regs.length).fill(null);
  const usedId = {};
  const claimAt = function (px, py, rec) {
    if (!rec.id || usedId[rec.id]) return;
    const i = regs.findIndex(function (r, idx) { return !owner[idx] && has(r, px, py); });
    if (i < 0) return;
    owner[i] = rec;
    usedId[rec.id] = 1;
  };
  // Имя отсека достаётся САМОЙ КРУПНОЙ его комнате. Точка-якорь для этого не годится:
  // вырезанная кладовка накрывает середину отсека не реже, чем сама комната, и
  // «Кухня-гостиная» оказывалась подписью к кладовке в два метра.
  const claimBiggest = function (fits, rec) {
    if (!rec.id || usedId[rec.id]) return;
    let best = -1, bestArea = -1;
    regs.forEach(function (r, idx) {
      if (owner[idx] || !fits(r)) return;
      if (r.area > bestArea) { bestArea = r.area; best = idx; }
    });
    if (best < 0) return;
    owner[best] = rec;
    usedId[rec.id] = 1;
  };

  // Явные записи (их заводит редактор для комнат, вырезанных стенами) — первыми:
  // человек уже сказал, что это за комната, и отсек не вправе это перебить.
  (m.spots || []).forEach(function (sp) {
    claimAt(Number(sp.x) || 0, Number(sp.y) || 0,
      { id: sp.id, name: sp.name, pts: sp.pts || {}, bayId: "", sub: false });
  });

  modelBays(m).forEach(function (b) {
    const src = (m.rooms || []).find(function (r) { return r.id === b.id; }) || {};
    const inBay = function (r) { return r.label.x >= b.x0 && r.label.x <= b.x1; };
    if (b.sub) {
      const at = Number(b.sub.at) || 0;
      claimBiggest(function (r) { return inBay(r) && r.label.y < at; },
        { id: src.id || b.id, name: src.name, pts: src.pts || {}, bayId: b.id, sub: false });
      claimBiggest(function (r) { return inBay(r) && r.label.y > at + th; },
        { id: b.sub.id, name: b.sub.name, pts: b.sub.pts || {}, bayId: b.id, sub: true });
    } else {
      claimBiggest(inBay, { id: src.id || b.id, name: src.name, pts: src.pts || {}, bayId: b.id, sub: false });
    }
  });

  // Область, за которую никто не отвечает: имя ей даст человек, а до тех пор она
  // всё равно должна считаться — иначе её метры пропадут из сметы. Ключ — точка
  // внутри неё: он переживает перерисовку, пока комнату не двигали.
  return regs.map(function (reg, i) {
    return owner[i] || { id: "reg:" + Math.round(reg.label.x) + ":" + Math.round(reg.label.y),
      name: "", pts: {}, bayId: "", sub: false };
  });
}

// Помещения: то, что осталось между стенами. Считает `regions` (src/geom.js), здесь
// только опознание — какая запись какой области принадлежит.
//
// x0/x1/y0/y1 — габарит области в ЧИСТОВЫХ размерах. У прямоугольной комнаты это
// она сама, у Г-образной — описанный прямоугольник; площадь и периметр в обоих
// случаях настоящие, поэтому смета считается по ним, а не по габариту.
export function modelRooms(model) {
  const m = model || {};
  const W = Number(m.w) || 0;
  const L = totalLength(m);
  const regs = regions(L, W, modelWalls(m));
  const owners = assignRooms(m, regs);
  const out = regs.map(function (reg, i) {
    const own = owners[i];
    const fw = reg.y1 - reg.y0, fl = reg.x1 - reg.x0;
    return {
      id: own.id, name: own.name || "Помещение", bayId: own.bayId, sub: own.sub,
      len: fl, x0: reg.x0, x1: reg.x1, y0: reg.y0, y1: reg.y1,
      pts: own.pts || {},
      // Прямоугольная комната описывается шириной и длиной — по ним же её считает
      // смета. У Г-образной таких размеров нет: там честны только площадь и периметр.
      rect: reg.rect, finW: reg.rect ? fw : 0, finL: reg.rect ? fl : 0,
      area: Math.round(reg.area / 1000 / 1000 * 100) / 100,
      wallLen: Math.round(reg.perimeter) / 1000,
      label: reg.label, cells: reg.cells,
    };
  });
  // Порядок — слева направо и сверху вниз: так их читают на плане и в списке.
  return out.sort(function (a, b) { return (a.x0 - b.x0) || (a.y0 - b.y0); });
}

// Отсеки с координатами — нужны плану и переносу границ.
export function modelBays(model) {
  const m = model || {};
  const th = Number(m.wallThick) || 0;
  let x = 0;
  return (m.rooms || []).map(function (bay) {
    const len = Math.max(0, Number(bay.len) || 0);
    const out = { id: bay.id, len: len, x0: x, x1: x + len, sub: bay.sub || null };
    x += len + th;
    return out;
  });
}

// Длина стены, вдоль которой ставятся проёмы. Длинные стены идут по всему
// контейнеру, торцы — по его ширине.
export function sideLength(model, side, op) {
  const m = model || {};
  // Кусок стены — сам себе стена: проём на нём меряется по его длине, а не по
  // габариту дома. Стена вдоль — по x, поперёк — по y; какая она, знает она сама.
  if (side === "wall") {
    const w = wallOf(m, op);
    return w ? ((w.w >= w.h) ? w.w : w.h) : 0;
  }
  // Перегородка идёт поперёк контейнера, как и торец: проём на ней меряется по ширине.
  return (side === "w" || side === "e" || side === "part") ? (Number(m.w) || 0) : totalLength(m);
}

// Кусок стены, в котором стоит проём. Ссылаемся по id: куски стен двигают и
// подрезают соседями, а номер в массиве переживает не всякую правку.
export function wallOf(model, op) {
  if (!op || op.side !== "wall") return null;
  return ((model || {}).walls || []).find(function (w) { return w.id === op.wall; }) || null;
}

// Вдоль дома лежит стена или поперёк. Дверь санузла и дверь коридора чертятся
// по-разному только этим, и спрашивать об этом надо у стены, а не у проёма.
export function wallAlong(w) { return !!w && (Number(w.w) || 0) >= (Number(w.h) || 0); }

// Перегородка, названная проёмом: `after` — отсек, СРАЗУ ЗА которым она стоит.
// Ссылаемся на отсек, а не на номер стены: номера съезжают при делении и слиянии,
// а id отсека их переживает.
export function partitionAt(model, afterBayId) {
  const bays = modelBays(model);
  const i = bays.findIndex(function (b) { return b.id === afterBayId; });
  if (i < 0 || i >= bays.length - 1) return null;
  return { bay: bays[i], x: bays[i].x1, w: Number((model || {}).wallThick) || 0 };
}

export function totalLength(model) {
  const m = model || {};
  const rooms = m.rooms || [];
  const walls = Math.max(0, rooms.length - 1) * (Number(m.wallThick) || 0);
  return rooms.reduce(function (a, r) { return a + (Number(r.len) || 0); }, 0) + walls;
}

// В каком помещении оказался проём. У торцов ответ известен заранее: первое и
// последнее помещение. У длинных стен — то, в чьи границы попала позиция.
export function openingRoom(model, op) {
  const rooms = modelRooms(model);
  if (!rooms.length) return null;
  const W = Number((model || {}).w) || 0;
  const side = op.side;
  // Дверь в перегородке принадлежит двум помещениям сразу, и выбрать надо ОДНО:
  // иначе «монтаж двери» посчитается дважды и бригада закажет лишнюю. Считаем её
  // за отсеком, который она закрывает (`after`) — правило простое и не зависит от
  // того, в какую сторону створка открыта.
  if (side === "part") {
    const p = partitionAt(model, op.after);
    if (!p) return null;
    const pos = Number(op.pos) || 0;
    const inBay = rooms.filter(function (r) { return r.bayId === p.bay.id; });
    return inBay.find(function (r) { return pos >= r.y0 && pos <= r.y1; }) || inBay[0] || null;
  }
  // Дверь в куске стены тоже принадлежит двум комнатам сразу, и выбрать надо ОДНУ.
  // Берём ту, что лежит ЗА стеной по её нормали (под горизонтальной, справа от
  // вертикальной) — правило не зависит ни от стороны открывания, ни от того, какая
  // комната больше: и то, и другое меняется правкой, а счёт за монтаж двери — нет.
  if (side === "wall") {
    const wl = wallOf(model, op);
    if (!wl) return null;
    const along = wallAlong(wl);
    const px = along ? ((Number(op.pos) || 0) + 1) : (wl.x + wl.w + 1);
    const py = along ? (wl.y + wl.h + 1) : ((Number(op.pos) || 0) + 1);
    return rooms.find(function (r) {
      return (r.cells || []).some(function (c) {
        return px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h;
      });
    }) || null;
  }
  // Стена принадлежит той комнате, которая её касается: у отсека с продольной
  // перегородкой северная стена у одной комнаты, южная — у другой. Комнаты меряются
  // по ЧИСТОВЫМ размерам, поэтому «касается» — это «вплотную к обшивке», а не
  // «ровно в нуле»: на нуле стоит железо контейнера, а не пол комнаты.
  const fin = ((model || {}).finish == null) ? FINISH_THICK : (Number((model || {}).finish) || 0);
  const touches = function (r) {
    if (side === "n") return r.y0 <= fin;
    if (side === "s") return r.y1 >= W - fin;
    return true;
  };
  if (side === "w" || side === "e") {
    const bays = modelBays(model);
    const bay = (side === "w") ? bays[0] : bays[bays.length - 1];
    if (!bay) return null;
    const pos = Number(op.pos) || 0;
    const inBay = rooms.filter(function (r) { return r.bayId === bay.id; });
    return inBay.find(function (r) { return pos >= r.y0 && pos <= r.y1; }) || inBay[0] || null;
  }
  const pos = Number(op.pos) || 0;
  return rooms.filter(touches).find(function (r) { return pos >= r.x0 && pos <= r.x1; }) || null;
}

// Перенос границы между помещениями i и i+1. Двигаем не «границу», а миллиметры
// из одного помещения в другое: так сумма длин остаётся равной контейнеру.
// Куски длинной стены, занятые проёмами, — вместе с усилением: труба стоит в той же
// стене, и перегородка не может занять её место. По этим отрезкам перегородка
// понимает, докуда ей можно ехать.
export function openingSpans(model, winTypes) {
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  return (model.openings || []).map(function (o) {
    if (o.side !== "n" && o.side !== "s") return null;
    const t = byType[o.typeId];
    if (!t) return null;
    const pad = frameNeeded(o, t) ? (JAMB_TUBE + JAMB_GAP) : 0;
    const p = Number(o.pos) || 0, w = Number(t.w) || 0;
    return { id: o.id, x0: p - pad, x1: p + w + pad };
  }).filter(Boolean);
}

// Влезает ли поперечная стена [x, x+th] между проёмами.
export function wallFits(model, x, winTypes) {
  const th = Number(model.wallThick) || 0;
  return !openingSpans(model, winTypes).some(function (s) { return x < s.x1 && x + th > s.x0; });
}

// Стена, доехавшая до окна, — это дыра в наружной стене, а не планировка: проём
// режет её насквозь, и перегородка упирается в стеклопакет. Поэтому граница
// останавливается У проёма, а не проходит сквозь него: жест продолжается, стена
// стоит — так же, как она стоит, упёршись в соседнюю комнату короче MIN_ROOM.
function stopAtOpenings(spans, x0, th, d) {
  let x = x0 + d;
  for (let pass = 0; pass < 2; pass++) {
    spans.forEach(function (s) {
      if (x < s.x1 && x + th > s.x0) x = (d > 0) ? Math.min(x, s.x0 - th) : Math.max(x, s.x1);
    });
  }
  return x;
}

export function moveBoundary(model, i, deltaMm, winTypes) {
  const rooms = (model.rooms || []).map(function (r) { return Object.assign({}, r); });
  const a = rooms[i], b = rooms[i + 1];
  if (!a || !b) return model;
  let d = Math.round(Number(deltaMm) || 0);
  d = Math.max(d, MIN_ROOM - (Number(a.len) || 0));
  d = Math.min(d, (Number(b.len) || 0) - MIN_ROOM);
  if (d) {
    // Позиция границы — сумма длин слева: столько же, сколько насчитал `modelBays`.
    const th = Number(model.wallThick) || 0;
    const x0 = rooms.slice(0, i + 1).reduce(function (acc, r) { return acc + (Number(r.len) || 0); }, 0) +
      i * th;
    const x = stopAtOpenings(openingSpans(model, winTypes), x0, th, d);
    d = Math.round(x - x0);
  }
  if (!d) return model;
  a.len = (Number(a.len) || 0) + d;
  b.len = (Number(b.len) || 0) - d;
  return Object.assign({}, model, { rooms: rooms });
}

// Проёмы в перегородках при правке отсеков. Перегородка названа отсеком ПЕРЕД ней,
// поэтому деление и слияние её переименовывают — и без этого дверь молча уезжала бы
// на соседнюю стену или висела бы на перегородке, которой уже нет.
function repointParts(model, from, to) {
  const ops = (model.openings || []).map(function (o) {
    return (o.side === "part" && o.after === from) ? Object.assign({}, o, { after: to }) : o;
  }).filter(function (o) { return !(o.side === "part" && o.after == null); });
  return ops;
}

// Разделить помещение перегородкой пополам. Новое помещение получает свой id —
// раскладка и отделка привязаны к id, и делить их пополам было бы враньём.
export function splitRoom(model, roomId, newId, newSubId, winTypes) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === roomId; });
  if (i < 0) return model;
  const r = rooms[i];
  const len = Number(r.len) || 0;
  const half = Math.round((len - (Number(model.wallThick) || 0)) / 2);
  if (half < MIN_ROOM) return model;   // делить нечего
  // Середина отсека может прийтись ровно на окно — тогда делить нечем.
  const bay = modelBays(model).find(function (b) { return b.id === roomId; });
  if (bay && !wallFits(model, bay.x0 + half, winTypes)) return model;
  const left = Object.assign({}, r, { len: half });
  const right = { id: newId, name: "Помещение", len: len - half - (Number(model.wallThick) || 0), pts: {} };
  // Отсек с продольной перегородкой делится вместе с ней: иначе санузел в углу
  // при добавлении поперечной стены молча превращался бы в комнату во всю ширину.
  if (r.sub) right.sub = { id: newSubId || (newId + "s"), name: "Помещение", pts: {}, at: r.sub.at };
  return Object.assign({}, model, {
    rooms: rooms.slice(0, i).concat([left, right], rooms.slice(i + 1)),
    openings: repointParts(model, roomId, newId),
  });
}

// Убрать перегородку справа от помещения: соседи сливаются, длина перегородки
// возвращается в помещение. Раскладка соседа переезжает — точки никуда не делись.
export function mergeRoom(model, roomId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === roomId; });
  if (i < 0 || i + 1 >= rooms.length) return model;
  const a = rooms[i], b = rooms[i + 1];
  // Отсеки с разным делением по ширине не сливаются: получившуюся П-образную
  // комнату модель не умеет описать, а врать про площади нельзя.
  if (!!a.sub !== !!b.sub) return model;
  const addPts = function (x, y) {
    const pts = Object.assign({}, (x && x.pts) || {});
    Object.keys((y && y.pts) || {}).forEach(function (k) { pts[k] = (pts[k] || 0) + y.pts[k]; });
    return pts;
  };
  const merged = Object.assign({}, a, {
    len: (Number(a.len) || 0) + (Number(b.len) || 0) + (Number(model.wallThick) || 0),
    pts: addPts(a, b),
  });
  if (a.sub) merged.sub = Object.assign({}, a.sub, { pts: addPts(a.sub, b.sub) });
  return Object.assign({}, model, {
    rooms: rooms.slice(0, i).concat([merged], rooms.slice(i + 2)),
    // Перегородки больше нет — висевшая на ней дверь вместе с ней и уходит.
    openings: repointParts(model, a.id, null),
  });
}

// Поставить продольную перегородку в отсеке: санузел в углу — это она.
// Дальше двух комнат не идём: третья полоса в контейнере уже не помещение.
export function splitLengthwise(model, bayId, newId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bayId; });
  if (i < 0 || rooms[i].sub) return model;
  const W = Number(model.w) || 0, th = Number(model.wallThick) || 0;
  if (W - th < MIN_ROOM * 2) return model;   // делить нечего
  const at = Math.round((W - th) / 2);
  const bay = Object.assign({}, rooms[i], { sub: { id: newId, name: "Помещение", pts: {}, at: at } });
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([bay], rooms.slice(i + 1)) });
}

// Отсек, в который попала координата вдоль контейнера.
export function bayAt(model, x) {
  const bays = modelBays(model);
  return bays.find(function (b) { return x >= b.x0 && x <= b.x1; }) ||
    (x < 0 ? bays[0] : bays[bays.length - 1]) || null;
}

// Поперечная стена ровно там, где её нарисовали. Это то же деление отсека, но
// не пополам: рисуя стену, человек показывает место, а не факт деления.
export function splitAt(model, x, newId, newSubId, winTypes) {
  const bay = bayAt(model, x);
  if (!bay) return model;
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bay.id; });
  if (i < 0) return model;
  const th = Number(model.wallThick) || 0;
  const left = Math.round(x - bay.x0);
  const right = (Number(rooms[i].len) || 0) - left - th;
  if (left < MIN_ROOM || right < MIN_ROOM) return model;   // слишком близко к соседу
  // И не в проём: окно режет наружную стену насквозь, перегородке там не на что встать.
  if (!wallFits(model, Math.round(x), winTypes)) return model;
  const a = Object.assign({}, rooms[i], { len: left });
  const b = { id: newId, name: "Помещение", len: right, pts: {} };
  if (rooms[i].sub) b.sub = { id: newSubId || (newId + "s"), name: "Помещение", pts: {}, at: rooms[i].sub.at };
  return Object.assign({}, model, {
    rooms: rooms.slice(0, i).concat([a, b], rooms.slice(i + 1)),
    openings: repointParts(model, rooms[i].id, newId),
  });
}

// Продольная стена на заданной отметке по ширине — тем же жестом, что и поперечная.
export function splitLengthwiseAt(model, bayId, y, newId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bayId; });
  if (i < 0 || rooms[i].sub) return model;
  const W = Number(model.w) || 0, th = Number(model.wallThick) || 0;
  const fin = (model.finish == null) ? FINISH_THICK : (Number(model.finish) || 0);
  const at = Math.round(Math.max(fin + MIN_ROOM, Math.min(W - fin - th - MIN_ROOM, y)));
  if (W - th - fin * 2 < MIN_ROOM * 2) return model;
  const bay = Object.assign({}, rooms[i], { sub: { id: newId, name: "Помещение", pts: {}, at: at } });
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([bay], rooms.slice(i + 1)) });
}

// К какой стене ближе точка. Проём ставят тапом рядом со стеной, а не выбором
// из списка: на плане видно, куда он встанет.
export function nearestSide(model, x, y) {
  const L = totalLength(model), W = Number(model.w) || 0;
  const d = [["n", y], ["s", W - y], ["w", x], ["e", L - x]];
  d.sort(function (a, b) { return a[1] - b[1]; });
  return d[0][0];
}

// Позиция проёма на стене по точке клика, с учётом его ширины и границ стены.
export function opPosAt(model, side, x, y, widthMm) {
  const along = (side === "n" || side === "s");
  const span = sideLength(model, side);
  const c = along ? x : y;
  return Math.max(0, Math.min(Math.max(0, span - (Number(widthMm) || 0)), Math.round(c - (Number(widthMm) || 0) / 2)));
}

// Убрать продольную перегородку. Раскладка второй комнаты переезжает в первую —
// розетки никуда не делись, их всё равно монтировать.
export function mergeLengthwise(model, bayId) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bayId; });
  if (i < 0 || !rooms[i].sub) return model;
  const bay = Object.assign({}, rooms[i]);
  const pts = Object.assign({}, bay.pts || {});
  Object.keys((bay.sub.pts) || {}).forEach(function (k) { pts[k] = (pts[k] || 0) + bay.sub.pts[k]; });
  bay.pts = pts;
  delete bay.sub;
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([bay], rooms.slice(i + 1)) });
}

// Перенос продольной перегородки: та же арифметика, что у поперечной, но по ширине.
export function moveLengthwise(model, bayId, deltaMm) {
  const rooms = model.rooms || [];
  const i = rooms.findIndex(function (r) { return r.id === bayId; });
  if (i < 0 || !rooms[i].sub) return model;
  const W = Number(model.w) || 0, th = Number(model.wallThick) || 0;
  const cur = Number(rooms[i].sub.at) || 0;
  const fin = (model.finish == null) ? FINISH_THICK : (Number(model.finish) || 0);
  const at = Math.max(fin + MIN_ROOM, Math.min(W - fin - th - MIN_ROOM, cur + Math.round(Number(deltaMm) || 0)));
  if (at === cur) return model;
  const bay = Object.assign({}, rooms[i], { sub: Object.assign({}, rooms[i].sub, { at: at }) });
  return Object.assign({}, model, { rooms: rooms.slice(0, i).concat([bay], rooms.slice(i + 1)) });
}

// Проёмы, посчитанные по помещениям: окна и двери попадают в раскладку сами,
// поэтому «монтаж окна ×3» считается той же машинкой, что розетки.
export function openingCounts(model, winTypes) {
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  const out = {};
  (model.openings || []).forEach(function (op) {
    const room = openingRoom(model, op);
    if (!room) return;
    const t = byType[op.typeId] || {};
    const key = (t.kind === "door") ? "door" : "win";
    if (!out[room.id]) out[room.id] = {};
    out[room.id][key] = (out[room.id][key] || 0) + 1;
  });
  return out;
}

// Модель → характеристики помещений, с которыми уже умеет работать спецификация.
// Это и есть смысл модели: двигаешь перегородку — меняются площади, а значит и смета.
export function modelToSpecs(model, winTypes) {
  const m = model || {};
  const counts = openingCounts(m, winTypes);
  return {
    height: Math.round((Number(m.h) || 0) / 10) / 100,
    rooms: modelRooms(m).map(function (r) {
      const pts = Object.assign({}, r.pts || {}, counts[r.id] || {});
      // У прямоугольной комнаты смета считает площадь как ширину на длину — так она
      // считала всегда, и трогать это незачем. У Г-образной таких размеров нет:
      // передаём площадь напрямую (`floor`), а ширину и длину оставляем нулями,
      // иначе смета перемножит габарит и выставит счёт за метры, которых нет.
      return {
        id: r.id, name: r.name, pts: pts,
        w: Math.round(r.finW / 10) / 100,
        l: Math.round(r.finL / 10) / 100,
        floor: r.area,
        wallLen: r.wallLen,
      };
    }),
    openings: [],
  };
}

// Стоимость самих изделий (окна и двери из справочника) и метраж перегородок.
export function modelTotals(model, winTypes) {
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  let openings = 0, area = 0;
  (model.openings || []).forEach(function (op) {
    const t = byType[op.typeId];
    if (!t) return;
    openings += Number(t.cost) || 0;
    area += (Number(t.w) || 0) * (Number(t.h) || 0) / 1000000;
  });
  const cross = Math.max(0, (model.rooms || []).length - 1);
  const subs = (model.rooms || []).filter(function (b) { return b.sub; });
  const walls = cross + subs.length;
  // Поперечная перегородка идёт по ШИРИНЕ контейнера, продольная — по длине своего
  // отсека. Считать их одинаково значит выставить счёт за метры, которых нет.
  const H = Number(model.h) || 0;
  const bays = modelBays(model);
  const partMm2 = cross * (Number(model.w) || 0) * H +
    subs.reduce(function (a, b) {
      const bay = bays.find(function (x) { return x.id === b.id; });
      return a + (bay ? bay.len : 0) * H;
    }, 0);
  return {
    openingsCost: Math.round(openings),
    openingsArea: Math.round(area * 100) / 100,
    partitions: walls,
    partitionArea: Math.round(partMm2 / 1000000 * 100) / 100,
    floorArea: Math.round(modelRooms(model).reduce(function (a, r) { return a + r.area; }, 0) * 100) / 100,
  };
}

// Развёртка стены: то, что в дизайн-проекте называется «развёртки стен». Показывает,
// на какой высоте что стоит — по этим числам электрик ставит подрозетники, а бригада
// вешает споты. План сверху высоту показать не может в принципе.
//
// points — каталог точек (SPEC_POINTS): модель не знает, что такое розетка, и не
// должна знать; она знает только, сколько их в комнате и где стена.
export function elevation(model, side, winTypes, points) {
  const m = model || {};
  const H = Number(m.h) || 0;
  const len = sideLength(m, side);
  const rooms = modelRooms(m);
  const W = Number(m.w) || 0;
  const along = (side === "n" || side === "s");
  // Какие комнаты выходят на эту стену и каким куском.
  const bays = modelBays(m);
  let wallRooms;
  if (along) {
    const fin = (m.finish == null) ? FINISH_THICK : (Number(m.finish) || 0);
    wallRooms = rooms.filter(function (r) { return side === "n" ? r.y0 <= fin : r.y1 >= W - fin; })
      .map(function (r) { return { room: r, a: r.x0, b: r.x1 }; });
  } else {
    const bay = (side === "w") ? bays[0] : bays[bays.length - 1];
    wallRooms = rooms.filter(function (r) { return bay && r.bayId === bay.id; })
      .map(function (r) { return { room: r, a: r.y0, b: r.y1 }; });
  }

  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  const ops = (m.openings || []).filter(function (o) { return o.side === side; }).map(function (o) {
    const t = byType[o.typeId] || { n: "Проём", w: 0, h: 0, kind: "win" };
    const sill = (o.sill == null) ? ((t.kind === "door") ? 0 : 900) : (Number(o.sill) || 0);
    return {
      id: o.id, name: t.n || "Проём", kind: t.kind || "win",
      x0: Number(o.pos) || 0, x1: (Number(o.pos) || 0) + (Number(t.w) || 0),
      y0: sill, y1: sill + (Number(t.h) || 0), sill: sill,
    };
  });

  // Точки раскладки расставляем равномерно по своей комнате: точных координат
  // модель не хранит, а высота — хранит, и именно её тут и показывают.
  const marks = [];
  (points || []).forEach(function (pt) {
    if (pt.h == null) return;                       // потолочные на развёртке не рисуем
    wallRooms.forEach(function (wr) {
      const n = Number((wr.room.pts || {})[pt.k]) || 0;
      if (!n) return;
      const step = (wr.b - wr.a) / (n + 1);
      for (let i = 1; i <= n; i++) {
        marks.push({ k: pt.k, emoji: pt.emoji, n: pt.n, h: pt.h, x: Math.round(wr.a + step * i), room: wr.room.name });
      }
    });
  });

  return { side: side, len: len, height: H, rooms: wallRooms, openings: ops, marks: marks };
}

// ─── ПЛОЩАДИ ПОМЕЩЕНИЙ ───────────────────────────────────────────────────────
// Пол, потолок и стены по каждому помещению — то, из чего считается отделка, и то,
// что человек хочет видеть, пока двигает перегородку: подвинул — увидел новые числа.
//
// Потолок равен полу: это одна плоскость дома, а не отдельный размер.
// Стены даём ДВУМЯ числами. Полная (`wallGross`) — периметр × высота: по ней считают
// обрешётку и утеплитель, которые идут и за окном тоже. Чистая (`wallNet`) — за
// вычетом проёмов: по ней красят и обшивают. Одно число вместо двух врало бы одному
// из двух расчётов, а какому — зависит от материала.
export function modelAreas(model, winTypes) {
  const m = model || {};
  const H = Number(m.h) || 0;
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  const r2 = function (v) { return Math.round(v * 100) / 100; };

  // Проёмы считаем по тому же правилу, что и всё остальное: у каждого ОДНО помещение.
  const opArea = {};
  (m.openings || []).forEach(function (op) {
    const t = byType[op.typeId]; if (!t) return;
    const room = openingRoom(m, op); if (!room) return;
    opArea[room.id] = (opArea[room.id] || 0) + (Number(t.w) || 0) * (Number(t.h) || 0) / 1000000;
  });

  const rooms = modelRooms(m).map(function (r) {
    const gross = r2(r.wallLen * H / 1000);
    const ops = r2(opArea[r.id] || 0);
    return {
      id: r.id, name: r.name, bayId: r.bayId, sub: !!r.sub, rect: r.rect,
      w: r2(r.finW / 1000), l: r2(r.finL / 1000), h: r2(H / 1000),
      perimeter: r.wallLen,
      floor: r.area, ceil: r.area,
      wallGross: gross, openings: ops, wallNet: Math.max(0, r2(gross - ops)),
    };
  });
  const sum = function (k) { return r2(rooms.reduce(function (a, r) { return a + r[k]; }, 0)); };
  return {
    height: r2(H / 1000), rooms: rooms,
    total: { floor: sum("floor"), ceil: sum("ceil"), wallGross: sum("wallGross"),
      openings: sum("openings"), wallNet: sum("wallNet") },
  };
}

// ─── СХЕМА ПЛАНА ─────────────────────────────────────────────────────────────
// Чертёж в том виде, в каком его читают на площадке: несущие стены, перегородки,
// проёмы и размерные цепочки. Мебели, сантехники и площадей здесь нет намеренно —
// это разные документы. Мебель на плане отвечает на вопрос «как жить», схема — на
// вопрос «что строить», и смешанные вместе они мешают обоим.
//
// Геометрия считается здесь, а не в панели: те же числа нужны экрану, печати и
// проверке, и разъехаться им нельзя. Панель из этого рисует SVG, и только.
//
// Стена коробки на схеме — это ОБШИВКА (`finish`): своей толщины у железа
// контейнера модель не знает, а обрешётка с утеплителем — знает, и именно она
// съедает те сантиметры, из-за которых площади не сходятся с чертежом.
// Нужно ли усиление этому проёму. Общая функция: по ней и рисуется труба на
// чертеже, и подписана кнопка у выбранного проёма — иначе экран обещал бы одно,
// а чертёж показывал другое.
export function frameNeeded(op, type) {
  if (!op) return false;
  if (op.frame != null) return !!op.frame;
  // Перегородка и кусок стены — каркасные, варить трубу не во что.
  if (op.side === "part" || op.side === "wall") return false;
  const blind = !!(type && type.face && type.face.length) && winFace(type).rows.every(function (r) {
    return r.cells.every(function (c) { return !c.o; });
  });
  return !blind;                                  // глухой витраж в торце усиливать нечем
}

export function modelScheme(model, winTypes) {
  const m = model || {};
  const fin = (m.finish == null) ? FINISH_THICK : (Number(m.finish) || 0);
  const th = Number(m.wallThick) || 0;
  const W = Number(m.w) || 0;
  const L = totalLength(m);
  const bays = modelBays(m);
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });

  // Стены — те же, по которым считаются помещения (`modelWalls`): чертёж и расчёт
  // обязаны читать одну геометрию, иначе они разойдутся на первой же правке.
  const walls = modelWalls(m);
  // И их общий контур: на чертеже стена, сросшаяся с соседней, — одно тело, без
  // линии на стыке. Панель обводит по нему, а штриховку кладёт по прямоугольникам.
  const outline = wallOutline(L, W, walls);

  // Створка двери: петли на одном откосе, полотно поперёк стены, дуга — путь створки.
  // Считаем её здесь, а не в панели: куда открывается дверь — свойство проёма, а не
  // картинки, и по этим же точкам потом проверяют, не бьётся ли створка о стену.
  const swingOf = function (box, along, out, hinge) {
    const face = { x: box.x + (out[0] > 0 ? box.w : 0), y: box.y + (out[1] > 0 ? box.h : 0) };
    const A = along ? { x: box.x, y: face.y } : { x: face.x, y: box.y };
    const B = along ? { x: box.x + box.w, y: face.y } : { x: face.x, y: box.y + box.h };
    const H = (hinge === "start") ? A : B;
    const J = (hinge === "start") ? B : A;
    const len = along ? box.w : box.h;
    // Створка не проходит сквозь стену. Полотно стоит поперёк своей стены, а
    // напротив бывает стена ближе его длины — коридор в семьдесят сантиметров и
    // дверь шириной восемьдесят. Рисовать её раскрытой настежь значит обещать то,
    // чего в доме нет: по этой дуге расставляют мебель и решают, куда вешать
    // полотенцесушитель. Поэтому чертим на тот угол, на который она открывается.
    if (!len) return { hinge: H, jamb: J, tip: { x: H.x, y: H.y }, open: 0 };
    const u = { x: (J.x - H.x) / len, y: (J.y - H.y) / len };      // закрытое положение
    // Свою стену пропускаем: закрытая створка лежит в ней, и упереться в неё она
    // не может — она из неё выходит.
    const own = walls.filter(function (w) {
      return H.x >= w.x - 1 && H.x <= w.x + w.w + 1 && H.y >= w.y - 1 && H.y <= w.y + w.h + 1;
    });
    const free = function (ang) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const dx = u.x * c + out[0] * s, dy = u.y * c + out[1] * s;
      for (let k = 1; k <= 12; k++) {
        const px = H.x + dx * len * k / 12, py = H.y + dy * len * k / 12;
        const hit = walls.some(function (w) {
          return own.indexOf(w) < 0 &&
            px > w.x + 1 && px < w.x + w.w - 1 && py > w.y + 1 && py < w.y + w.h - 1;
        });
        if (hit) return false;
      }
      return true;
    };
    // Считаем ВЕСЬ размах, а не конечное положение. Дверь ездит от закрытого до
    // открытого, и стена, торчащая у самого проёма, ловит её на первых градусах —
    // распахнутое полотно при этом стоит в чистом месте, и проверка «на 90° всё
    // хорошо» такую дверь пропускает. А она не закроется.
    const RAD = Math.PI / 180;
    let ang = 0;
    for (let a = 5; a <= 90; a += 5) {
      if (!free(a * RAD)) break;
      ang = a;
    }
    const c = Math.cos(ang * RAD), s = Math.sin(ang * RAD);
    return {
      hinge: H, jamb: J, open: ang,
      tip: { x: H.x + (u.x * c + out[0] * s) * len, y: H.y + (u.y * c + out[1] * s) * len },
    };
  };

  // Трубы стоят за зазором от изделия и ВАРЯТСЯ ПОВЕРХ ЛИСТА контейнера, а не
  // вставляются в рез: их внутренняя грань и есть кромка реза. Отсюда равенство,
  // которое на узле подписано прямо: рез в стене = проём между трубами = изделие
  // плюс два зазора. На плане это два квадрата 40×40 — по ним размечают стойки.
  const jambsOf = function (box, along) {
    const t2 = JAMB_TUBE, g = JAMB_GAP;
    return along
      ? [{ x: box.x - g - t2, y: box.y + (box.h - t2) / 2, w: t2, h: t2 },
         { x: box.x + box.w + g, y: box.y + (box.h - t2) / 2, w: t2, h: t2 }]
      : [{ x: box.x + (box.w - t2) / 2, y: box.y - g - t2, w: t2, h: t2 },
         { x: box.x + (box.w - t2) / 2, y: box.y + box.h + g, w: t2, h: t2 }];
  };

  const openings = (m.openings || []).map(function (op) {
    const t = byType[op.typeId] || { n: "Проём", w: 0, h: 0, kind: "win" };
    const wd = Number(t.w) || 0, pos = Number(op.pos) || 0;
    // Верх проёмов держим на одной линии; заданный руками подоконник уважаем, но
    // сквозь потолок не пускаем — окно, торчащее в крышу, чертёж не рисует.
    const th0 = Number(t.h) || 0;
    // Дверь стоит НА ПОЛУ — её низ не выравнивают ни по какой линии; если полотно
    // ниже перемычки, ниже оказывается и его верх, и это правда о полотне.
    const sill = (op.sill == null) ? ((t.kind === "door") ? 0 : headSill(m, th0, winTypes))
      : Math.max(0, Math.min(Number(op.sill) || 0, (Number(m.h) || 0) ? ((Number(m.h) || 0) - th0) : Infinity));
    let box = null, out = null, along = true;
    if (op.side === "part") {
      const p = partitionAt(m, op.after);
      if (!p) return null;
      box = { x: p.x, y: pos, w: p.w, h: wd };
      // Куда открывается: +1 — в сторону конца контейнера. Модель хранит это у проёма,
      // потому что угадать нельзя, а нарисовать створку не в ту комнату — соврать.
      out = [(Number(op.into) || 1) >= 0 ? 1 : -1, 0];
      along = false;
    } else if (op.side === "wall") {
      // Проём в куске стены: дверь санузла, вырезанного стенами, а не отсеком.
      // Ставится он так же, как в перегородке, только стена может лежать и вдоль.
      const wl = wallOf(m, op);
      if (!wl) return null;
      along = wallAlong(wl);
      box = along ? { x: pos, y: wl.y, w: wd, h: wl.h }
        : { x: wl.x, y: pos, w: wl.w, h: wd };
      const dir = (Number(op.into) || 1) >= 0 ? 1 : -1;
      out = along ? [0, dir] : [dir, 0];
    } else {
      box = (op.side === "n") ? { x: pos, y: 0, w: wd, h: fin }
        : (op.side === "s") ? { x: pos, y: W - fin, w: wd, h: fin }
          : (op.side === "w") ? { x: 0, y: pos, w: fin, h: wd }
            : { x: L - fin, y: pos, w: fin, h: wd };
      // Куда открывается дверь в наружной стене — тоже свойство проёма, а не стены.
      // Наружу (`into` +1) чаще, но входная дверь, открывающаяся внутрь тамбура, —
      // обычное дело, а нарисовать створку не в ту сторону значит соврать о том,
      // что она заденет: мебель, соседнюю дверь, край крыльца.
      const outward = (op.side === "n") ? [0, -1] : (op.side === "s") ? [0, 1] : (op.side === "w") ? [-1, 0] : [1, 0];
      const dir = ((op.into == null) ? 1 : ((Number(op.into) || 1) >= 0 ? 1 : -1));
      out = [outward[0] * dir, outward[1] * dir];
      along = (op.side === "n" || op.side === "s");
    }
    const kind = t.kind || "win";
    // Усиление ставят у проёмов НАРУЖНОЙ стены: перегородка каркасная, трубу в неё
    // не варят. Глухой витраж — исключение: он стоит в торце во всю стену, между
    // собственными стойками контейнера, и усиливать там нечего. Глухим считаем то,
    // что само изделие о себе говорит раскладкой; изделие без раскладки о себе
    // ничего не сказало, поэтому усиление ему рисуем — а снять его можно у проёма
    // (`op.frame === false`): угадать за человека, что именно тут стоит, нельзя.
    const frame = frameNeeded(op, t);
    return {
      id: op.id, side: op.side, after: op.after || "", wall: op.wall || "", kind: kind, name: t.n || "Проём",
      pos: pos, width: wd, height: Number(t.h) || 0, sill: sill,
      x: box.x, y: box.y, w: box.w, h: box.h,
      frame: frame, jambs: frame ? jambsOf(box, along) : [],
      // Ширина реза в стене: изделие плюс два монтажных зазора. Трубы стоят ПОВЕРХ
      // листа и в этот размер не входят. По этому числу режут, и оно обязано
      // приезжать из одного места — сюда смотрят и чертёж, и таблица на печатном листе.
      cutW: wd + (frame ? 2 * JAMB_GAP : 0),
      swing: (kind === "door") ? swingOf(box, along, out, op.hinge || (along ? "end" : "start")) : null,
    };
  }).filter(function (o) { return o && o.width > 0; });

  // Марки проёмов, как на чертеже: Д-1, Д-2… по дверям и О-1, О-2… по окнам.
  let nd = 0, nw = 0;
  openings.forEach(function (o) { o.mark = (o.kind === "door") ? ("Д-" + (++nd)) : ("О-" + (++nw)); });

  // Имена помещений: без них чертёж читают, водя пальцем по цепочкам. Площадей и
  // мебели на схеме по-прежнему нет — это разные документы.
  const labels = modelRooms(m).map(function (r) {
    // Точка подписи — из геометрии, а не центр габарита: у Г-образной комнаты центр
    // габарита лежит в вырезанной кладовке, и подпись садится на чужую комнату.
    //
    // Площадь и границы комнаты едут вместе с именем: по площади подписан план для
    // клиента, а по границам подпись отходит в сторону от размерной цепочки — и то,
    // и другое считает модель, а не панель, иначе на чертеже и в смете будут разные
    // квадраты.
    return { id: r.id, name: r.name, rect: r.rect, x: r.label.x, y: r.label.y,
      area: r.area, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 };
  });

  // Размерная цепочка — набор отметок и длин между ними. Считаем отсюда, чтобы
  // подпись на чертеже не могла разойтись с моделью: сумма цепочки равна габариту.
  // bounds — от какой отметки до какой идёт цепочка. По умолчанию весь габарит, но
  // дверь в перегородке меряют от ЧИСТОВЫХ стен: обшивка в этой цепочке — шум.
  const chain = function (side, span, marks, name, at, bounds) {
    const lo = bounds ? bounds[0] : 0, hi = bounds ? bounds[1] : span;
    const seen = {};
    const ticks = marks.concat([lo, hi])
      .map(function (v) { return Math.round(Math.max(lo, Math.min(hi, v))); })
      .filter(function (v) { if (seen[v]) return false; seen[v] = 1; return true; })
      .sort(function (a, b) { return a - b; });
    const segs = [];
    for (let i = 0; i < ticks.length - 1; i++) segs.push(ticks[i + 1] - ticks[i]);
    const out = { side: side, name: name, span: span, ticks: ticks, segs: segs };
    if (at != null) { out.at = at; out.inner = true; }
    return out;
  };
  // Цепочка проёмов меряет РЕЗ в стене, а не изделие: по ней размечают лист, а окно
  // уже реза на два монтажных зазора. Труба варится ПОВЕРХ листа, её внутренняя
  // грань и есть кромка реза (см. узел 1), поэтому трубы в этот размер не входят —
  // рез равен проёму между трубами.
  const cut = function (o) {
    const pad = o.frame ? JAMB_GAP : 0;
    return [o.pos - pad, o.pos + o.width + pad];
  };
  const along = function (sd) {
    return openings.filter(function (o) { return o.side === sd; })
      .reduce(function (a, o) { return a.concat(cut(o)); }, []);
  };

  const bayMarks = [fin];
  bays.forEach(function (b, i) {
    bayMarks.push((i === bays.length - 1) ? (b.x1 - fin) : b.x1);
    if (i < bays.length - 1) bayMarks.push(b.x1 + th);
  });

  // ПРИВЯЗКИ. Размечают стену не «от угла контейнера», а от того, что рядом: от
  // перегородки до окна, от стенки санузла до двери. Считать это вычитанием двух
  // разных цепочек — работа, которую чертёж обязан делать сам, поэтому грани всех
  // внутренних стен стоят в той же цепочке, что и резы проёмов этой стороны.
  const inner = walls.filter(function (w) { return w.kind !== "shell"; });
  const crossFaces = inner.filter(function (w) { return w.h > w.w; })
    .reduce(function (a, w) { return a.concat([w.x, w.x + w.w]); }, []);
  const alongFaces = inner.filter(function (w) { return w.w >= w.h; })
    .reduce(function (a, w) { return a.concat([w.y, w.y + w.h]); }, []);

  const dims = [
    // Стенка санузла — такая же внутренняя стена, как перегородка, и место ей в
    // той же цепочке: иначе её положение вдоль дома не прочитать ниоткуда.
    chain("top", L, bayMarks.concat(crossFaces), "Помещения и перегородки"),
    chain("top", L, [], "Габарит"),
    // Ширина: обшивка, чистовой размер и грани поперечных стен — глубина санузла
    // читается по ней же, а не прикидывается на глаз.
    chain("left", W, [fin, W - fin].concat(alongFaces), "Ширина"),
  ];
  const side = function (sd, dimSide, span) {
    const ops = along(sd);
    if (!ops.length) return;      // стены без проёмов держит цепочка перегородок
    // Привязки нужны ВДОЛЬ дома: там проёмы и перегородки чередуются. Поперёк их
    // держит цепочка «Ширина» — второй такой же у торца была бы копией.
    const cross = (sd === "s" || sd === "n")
      ? inner.filter(function (w) { return w.h > w.w; }) : [];
    const near = function (v) {
      return ops.reduce(function (a, o) { return Math.min(a, Math.abs(o - v)); }, Infinity);
    };
    // От стены берём ОДНУ грань — ту, что смотрит на ближайший проём. Толщина
    // каждой стены уже стоит в цепочке перегородок, и повторять её у каждого окна
    // значит засыпать чертёж одинаковыми «77» и «100»: их перестают читать все,
    // включая нужные. Размечают от грани, к которой ведут рулетку.
    //
    // Грань в полуметре от реза не ставим вовсе: отрезок в десять миллиметров —
    // не размер, а слипшиеся цифры. Рядом уже стоит рез, от него и размечают.
    const keep = cross.map(function (w) {
      const a = w.x, b = w.x + w.w;
      return (near(a) <= near(b)) ? a : b;
    }).filter(function (f) { return near(f) >= 50; });
    dims.push(chain(dimSide, span, ops.concat(keep), "Проёмы (вырез) и привязки"));
  };
  side("s", "bottom", L);
  side("n", "top", L);
  side("e", "right", W);
  side("w", "left", W);
  // Дверь в перегородке меряется от чистовых стен, как на чертеже: 75 · 70 · 75.
  // Цепочка стоит у своей перегородки, поэтому у неё есть `at` — отметка по длине.
  openings.filter(function (o) { return o.side === "part"; }).forEach(function (o) {
    dims.push(chain("part", W, [o.pos, o.pos + o.width], o.mark, o.x, [fin, W - fin]));
  });
  // Проём в куске стены меряется по СВОЕЙ стене, от её концов: цепочка через весь
  // дом сказала бы, где дверь относительно контейнера, а размечают её от стены,
  // в которую она вставлена.
  openings.filter(function (o) { return o.side === "wall"; }).forEach(function (o) {
    const wl = (m.walls || []).find(function (w) { return w.id === o.wall; });
    if (!wl) return;
    if (wallAlong(wl)) {
      dims.push(chain("wallx", L, [o.pos, o.pos + o.width], o.mark, wl.y + wl.h / 2, [wl.x, wl.x + wl.w]));
    } else {
      dims.push(chain("part", W, [o.pos, o.pos + o.width], o.mark, wl.x, [wl.y, wl.y + wl.h]));
    }
  });

  return { l: L, w: W, finish: fin, wallThick: th,
    walls: walls, outline: outline, openings: openings, labels: labels, dims: dims };
}

// Что мешает считать по модели. Продавец должен видеть это до клиента.
export function modelIssues(model, winTypes) {
  const out = [];
  const rooms = modelRooms(model);
  if (!rooms.length) out.push("В модели нет помещений");
  rooms.forEach(function (r) {
    if (r.len < MIN_ROOM) out.push("«" + r.name + "»: меньше " + MIN_ROOM + " мм — это уже не помещение");
  });
  const byType = {};
  (winTypes || []).forEach(function (t) { if (t && t.id) byType[t.id] = t; });
  (model.openings || []).forEach(function (op) {
    if (!byType[op.typeId]) out.push("Проём без типового изделия — цена не посчитается");
    const t = byType[op.typeId] || {};
    const wmm = Number(t.w) || 0;
    // Проём в куске стены меряется от начала СВОЕЙ стены, а не от угла дома:
    // сравнивать его отметку с длиной контейнера — сравнивать разные вещи.
    const wl = wallOf(model, op);
    const from = wl ? (wallAlong(wl) ? wl.x : wl.y) : 0;
    const len = from + sideLength(model, op.side, op);
    if ((Number(op.pos) || 0) + wmm > len) out.push("«" + (t.n || "Проём") + "» выходит за стену");
  });
  if (!(model.openings || []).length) out.push("Ни одного окна или двери");
  // Створка, упирающаяся в стену. Чертёж рисует её на реальный угол — но угол в
  // тридцать градусов это не «дверь открывается», а «в проём не пройти», и сказать
  // об этом надо словами: на плане такое видно только тому, кто присмотрелся.
  modelScheme(model, winTypes).openings.forEach(function (o) {
    if (!o.swing) return;
    // Дверь, которая не открывается, — это не «тесно», а «сюда её ставить нельзя»:
    // она и не закроется, потому что стена ловит полотно у самого проёма.
    if (o.swing.open < SWING_MIN) {
      out.push("«" + o.name + "» здесь не открывается — полотно упирается в стену у самого проёма");
    } else if (o.swing.open < 60) {
      out.push("«" + o.name + "» открывается только на " + o.swing.open + "° — упирается в стену");
    }
  });
  return out;
}
