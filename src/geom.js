// ─── ПЛАНИРОВКА КАК ГЕОМЕТРИЯ ────────────────────────────────────────────────
// Помещение — это не «длина отсека», а то, что осталось между стенами. Пока
// перегородки шли от стены до стены, разница была незаметна: отсеки и помещения
// совпадали. Стоит поставить стену не во всю ширину — и совпадение кончается:
// комната становится Г-образной, а «ширина × длина» перестаёт быть её площадью.
//
// Поэтому геометрия считается ЗДЕСЬ и только здесь: план разрезается по всем
// координатам стен на клетки, клетки под стенами выбрасываются, а оставшиеся
// слипаются в области заливкой. Дальше область — это и есть помещение: площадь
// суммой клеток, периметр суммой рёбер, которые упёрлись в стену.
//
// Почему сетка, а не полигоны: все стены в контейнере осевые, а на осевой сетке
// разрезание точное — ни одного числа с плавающей точкой не появляется, площадь
// сходится до миллиметра. Полигональная библиотека дала бы то же самое ценой
// эпсилонов и вырожденных случаев, которые вылезают ровно на сдаче объекта.
//
// Все размеры — миллиметры, как во всей модели.

// Стены задаются прямоугольниками {x,y,w,h}: и коробка, и перегородка, и огрызок
// стены — одно и то же, разной длины. Так их и рисуют, и двигают.
function rects(walls) {
  return (walls || [])
    .map(function (r) {
      return {
        x: Math.round(Number(r.x) || 0), y: Math.round(Number(r.y) || 0),
        w: Math.max(0, Math.round(Number(r.w) || 0)), h: Math.max(0, Math.round(Number(r.h) || 0)),
      };
    })
    .filter(function (r) { return r.w > 0 && r.h > 0; });
}

function axis(lo, hi, values) {
  const seen = {};
  const out = [];
  values.concat([lo, hi]).forEach(function (v) {
    const n = Math.round(v);
    if (n < lo || n > hi || seen[n]) return;
    seen[n] = 1;
    out.push(n);
  });
  return out.sort(function (a, b) { return a - b; });
}

// Разрез плана по координатам стен. Клетка целиком либо стена, либо пол: между
// двумя соседними отметками ни одна стена не может начаться или кончиться.
export function grid(planW, planH, walls) {
  const ws = rects(walls);
  const xs = axis(0, planW, ws.reduce(function (a, r) { return a.concat([r.x, r.x + r.w]); }, []));
  const ys = axis(0, planH, ws.reduce(function (a, r) { return a.concat([r.y, r.y + r.h]); }, []));
  const nx = Math.max(0, xs.length - 1), ny = Math.max(0, ys.length - 1);
  const solid = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      solid[i * ny + j] = ws.some(function (r) {
        return cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h;
      });
    }
  }
  return { xs: xs, ys: ys, nx: nx, ny: ny, solid: solid };
}

// Области пола: связные группы клеток, не занятых стенами. Соседство по стороне —
// диагональ соседством не считается, иначе комнаты «протекали» бы через угол стены.
export function regions(planW, planH, walls) {
  const g = grid(planW, planH, walls);
  const { xs, ys, nx, ny, solid } = g;
  const mark = new Array(nx * ny).fill(-1);
  const out = [];

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const at = i * ny + j;
      if (solid[at] || mark[at] >= 0) continue;
      const id = out.length;
      const cells = [];
      const queue = [at];
      mark[at] = id;
      while (queue.length) {
        const cur = queue.pop();
        const ci = Math.floor(cur / ny), cj = cur % ny;
        cells.push({ i: ci, j: cj });
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          const ni = ci + d[0], nj = cj + d[1];
          if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) return;
          const next = ni * ny + nj;
          if (solid[next] || mark[next] >= 0) return;
          mark[next] = id;
          queue.push(next);
        });
      }
      out.push(measure(cells, g));
    }
  }
  return out;
}

// Мерки области: площадь, периметр, габарит и точка, в которой можно писать имя.
// Периметр — сумма рёбер, упёршихся в стену или в край плана: именно по нему
// считается площадь стен под отделку, и для Г-образной комнаты он больше, чем
// у прямоугольника той же площади. В этом вся разница, ради которой всё затеяно.
function measure(cells, g) {
  const { xs, ys, nx, ny, solid } = g;
  const at = {};
  cells.forEach(function (c) { at[c.i + ":" + c.j] = 1; });
  const inside = function (i, j) { return i >= 0 && j >= 0 && i < nx && j < ny && at[i + ":" + j]; };

  let area = 0, perimeter = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let best = null, bestArea = -1;

  cells.forEach(function (c) {
    const cw = xs[c.i + 1] - xs[c.i], ch = ys[c.j + 1] - ys[c.j];
    const a = cw * ch;
    area += a;
    if (a > bestArea) { bestArea = a; best = c; }
    if (xs[c.i] < x0) x0 = xs[c.i];
    if (ys[c.j] < y0) y0 = ys[c.j];
    if (xs[c.i + 1] > x1) x1 = xs[c.i + 1];
    if (ys[c.j + 1] > y1) y1 = ys[c.j + 1];
    if (!inside(c.i - 1, c.j)) perimeter += ch;
    if (!inside(c.i + 1, c.j)) perimeter += ch;
    if (!inside(c.i, c.j - 1)) perimeter += cw;
    if (!inside(c.i, c.j + 1)) perimeter += cw;
  });

  return {
    cells: cells.map(function (c) {
      return { x: xs[c.i], y: ys[c.j], w: xs[c.i + 1] - xs[c.i], h: ys[c.j + 1] - ys[c.j] };
    }),
    area: area, perimeter: perimeter,
    x0: x0, y0: y0, x1: x1, y1: y1,
    // Точка подписи — центр самой крупной клетки: он гарантированно ВНУТРИ
    // помещения. Центр габарита у Г-образной комнаты попадает в стену или к соседям.
    label: { x: (xs[best.i] + xs[best.i + 1]) / 2, y: (ys[best.j] + ys[best.j + 1]) / 2 },
    // Прямоугольная ли область: если да, «ширина × длина» остаётся честной подписью.
    rect: cells.length > 0 && area === (x1 - x0) * (y1 - y0),
  };
}

// В какой области лежит точка. По ней помещение узнаёт себя после правки стен:
// имя, отделка и раскладка привязаны к точке-якорю, а не к номеру области —
// номера меняются от любого движения, а точка внутри комнаты остаётся в ней.
export function regionAt(list, x, y) {
  return (list || []).find(function (r) {
    return r.cells.some(function (c) {
      return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
    });
  }) || null;
}
