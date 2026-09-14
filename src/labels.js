// ─── ТАБЛИЧКИ НА СТЕЛЛАЖ ─────────────────────────────────────────────────────
// Дом комплектуют на стеллаже: полка — этап, стеллаж — дом. На полке лежит то,
// что нужно этому этапу этого дома, и ламинированная бирка отвечает на один
// вопрос — «всё ли тут». Отсюда вся раскладка ниже.
//
// Почему логика здесь, а не в панели: по этим же числам считается смета проекта
// (`works2`) и собирается объект (`specBuildStages`). Своя раскладка в admin.js
// означала бы, что на бирке одно, а на стройке другое, и находится это на
// комплектации — то есть на складе, руками, поштучно.
//
// Позиции приходят из `allPositions` — того же списка, что показан в «Составе»
// проекта. Ничего не сохраняется: бирка считается на лету, и разойтись с чертежом
// ей нечем.

// Полок обычно пять, а этапов три. Лишние две не пустуют: самый объёмный этап
// (черновые) занимает две полки, последняя остаётся под то, что по этапам не
// раскладывается — окна, двери, крепёж. Ноль значит «этапа нет, полка свободная».
export const SHELVES_DEFAULT = [1, 2, 2, 3, 0];

// Сколько строк занимает работа на листе: своя строка плюс строка на материал.
// Считаем именно строками, а не работами: работа с десятью материалами занимает
// полку не так, как работа с одним, и делить этап «по числу работ» значит
// насыпать на одну полку втрое больше другой.
export function labelUnits(w) {
  return 1 + (((w && w.mats) || []).length);
}

// Позиция сметы → строка бирки. Берём ровно то, что видно на полке: имя работы и
// её материалы с количеством. Цен здесь нет намеренно — бирку читает каждый, кто
// подошёл к стеллажу, а для комплектации цена бесполезна.
export function labelWorks(positions, unitOf) {
  const unit = (typeof unitOf === "function") ? unitOf : function () { return ""; };
  return (positions || []).filter(function (p) { return p && !p.off; }).map(function (p) {
    const mats = ((p.mats) || []).filter(function (m) {
      return (Number(m.qty) || 0) > 0 && String(m.n || "").trim();
    }).map(function (m) {
      return { n: String(m.n), qty: Math.round((Number(m.qty) || 0) * 100) / 100, unit: unit(m) };
    });
    // Комната — часть имени работы на бирке: правило по помещениям даёт строку на
    // каждую комнату, и три «Обрешётки стен» подряд без неё — это один и тот же
    // текст трижды, по которому не понять, что комплектуют.
    return { key: String(p.key || ""), name: String(p.name || ""), room: String(p.room || ""),
      stage: Number(p.stage) || 0, mats: mats };
  });
}

// Ключ материала внутри работы. Адресуем ИМЕНЕМ, а не номером в списке: порядок
// материалов правят прямо в смете, и привязка, висящая на номере, после первой же
// перестановки указывала бы на соседний товар.
export function matPinKey(workKey, matName) {
  return String(workKey || "") + "#" + String(matName || "");
}

// Раскладка работ по полкам. `stages` — этап каждой полки (SHELVES_DEFAULT),
// `pins` — то, что человек разложил руками: ключ работы или материала → номер полки.
//
// Работы этапа делятся между ЕГО полками поровну по длине. Это приближение, и
// честно: физический объём мешка ППУ порталу неизвестен, поэтому ручная привязка
// всегда сильнее автомата.
//
// Материал можно отправить на полку ОТДЕЛЬНО от своей работы — длинный брусок
// кладут вниз, а не туда, где лежит остальной каркас. На чужой полке он всё равно
// показан под именем своей работы: материал без ответа «подо что он» — это просто
// товар и число, и на складе по нему не понять, куда он уйдёт.
export function shelfLayout(works, stages, pins) {
  const list = (stages && stages.length) ? stages : SHELVES_DEFAULT;
  const shelves = list.map(function (s, i) { return { i: i + 1, stage: Number(s) || 0, works: [] }; });
  const pin = pins || {};
  const at = function (key) {
    const n = Number(pin[key]);
    return (n >= 1 && n <= shelves.length) ? n : 0;
  };

  // Сначала отщепляем материалы, отправленные на свою полку: они уезжают отдельной
  // строкой, а работа остаётся с тем, что на ней и лежало.
  const rest = [];
  (works || []).forEach(function (w) {
    const home = at(w.key);
    const stay = [], away = {};
    ((w.mats) || []).forEach(function (m) {
      const to = at(matPinKey(w.key, m.n));
      if (to && to !== home) (away[to] = away[to] || []).push(m);
      else stay.push(m);
    });
    Object.keys(away).forEach(function (k) {
      shelves[Number(k) - 1].works.push({ key: w.key, name: w.name, room: w.room, stage: w.stage, mats: away[k], part: true });
    });
    // Работа, у которой ВСЕ материалы уехали, на своей полке не нужна: пустая
    // строка «Каркас» без единого материала — это вопрос, а не бирка.
    if (!stay.length && Object.keys(away).length) return;
    const left = { key: w.key, name: w.name, room: w.room, stage: w.stage, mats: stay };
    if (home) shelves[home - 1].works.push(left);
    else rest.push(left);
  });

  const byStage = {};
  rest.forEach(function (w) { (byStage[w.stage] = byStage[w.stage] || []).push(w); });

  Object.keys(byStage).forEach(function (k) {
    const items = byStage[k];
    let mine = shelves.filter(function (s) { return s.stage === Number(k); });
    if (!mine.length) {
      // Этапу полки не назначили. Работу нельзя ни потерять, ни молча подмешать
      // к чужому этапу: кладём на первую свободную, а не осталось свободных — на
      // первую полку. Пустой список на складе означал бы недокомплект.
      const free = shelves.filter(function (s) { return !s.stage; });
      mine = [free.length ? free[0] : shelves[0]];
    }
    if (mine.length === 1) { mine[0].works = mine[0].works.concat(items); return; }
    const total = items.reduce(function (a, w) { return a + labelUnits(w); }, 0);
    const quota = total / mine.length;
    let ix = 0, acc = 0;
    items.forEach(function (w) {
      // Работу целиком, а не половину: разрезанная пополам работа читается на
      // двух полках как две разные, и материал ищут не там.
      if (ix < mine.length - 1 && acc > 0 && acc + labelUnits(w) / 2 > quota * (ix + 1)) ix++;
      mine[ix].works.push(w);
      acc += labelUnits(w);
    });
  });
  return shelves;
}

// Полка, не влезшая на лист, продолжается вторым листом. Режем по строкам, а не
// надеемся на разрыв страницы браузером: заголовок листа обязан повториться, иначе
// второй лист — безымянная простыня, по которой не понять, чей он и от какой полки.
export function shelfPages(works, perPage) {
  const per = Math.max(6, Number(perPage) || 26);
  const pages = [];
  let cur = [], n = 0;
  (works || []).forEach(function (w) {
    const u = labelUnits(w);
    if (n && n + u > per) { pages.push(cur); cur = []; n = 0; }
    cur.push(w); n += u;
  });
  if (cur.length || !pages.length) pages.push(cur);
  return pages;
}

// «1-21», «1,3,7», «1-5, 9». Серия домов задаётся строкой, потому что номера
// бывают не подряд: часть партии уже собрана, часть отменена.
export function houseNums(spec) {
  const out = [];
  String(spec == null ? "" : spec).split(/[,;]+/).forEach(function (part) {
    const s = part.trim();
    if (!s) return;
    const m = s.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (m) {
      let a = Number(m[1]), b = Number(m[2]);
      if (a > b) { const t = a; a = b; b = t; }
      for (let i = a; i <= b && out.length < 300; i++) out.push(String(i));
    } else if (out.length < 300) out.push(s);
  });
  return out.length ? out : ["1"];
}

// Сколько листов уйдёт в принтер. Считаем ДО печати: 21 дом — это больше сотни
// листов, и узнавать об этом из лотка принтера поздно.
export function labelSheetCount(shelves, houses, perPage, withCover, withShelves) {
  const perHouse = (withCover ? 1 : 0) + (withShelves
    ? shelves.reduce(function (a, s) { return a + shelfPages(s.works, perPage).length; }, 0)
    : 0);
  return perHouse * (houses || []).length;
}
