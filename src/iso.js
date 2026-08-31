// ─── ДОМ В ТРЁХ ИЗМЕРЕНИЯХ ───────────────────────────────────────────────────
// План отвечает на вопрос «что где стоит», развёртка — «на какой высоте», и оба
// требуют навыка их читать. Клиент читать чертёж не обязан: ему нужно увидеть дом.
//
// Никакой библиотеки: дом из контейнера — это осевые коробки, а такую сцену честно
// строит школьная тригонометрия. three.js добавил бы к панели больше полумегабайта
// на телефон, который и так грузит её по мобильному интернету, — ради поворота
// десятка прямоугольных стен это плохая сделка.
//
// Сцена собирается ЗДЕСЬ и отдаётся панели готовыми многоугольниками: панель
// рисует, а не считает. Геометрия та же, что у плана и сметы (modelWalls,
// modelRooms) — третьей правды о доме не появляется.
import { modelScheme, modelRooms } from "./model.js";

const RAD = Math.PI / 180;

// Камера смотрит на дом сбоку и сверху: `yaw` — поворот вокруг вертикали,
// `tilt` — подъём над горизонтом (90° — вид строго сверху, то есть план).
// Проекция параллельная: у дома нет «дальнего края», который должен сходиться,
// зато размеры на экране остаются сравнимыми — так рисуют строительные аксонометрии.
function camera(yaw, tilt, cx, cy) {
  const cy1 = Math.cos(yaw * RAD), sy1 = Math.sin(yaw * RAD);
  const ct = Math.cos(tilt * RAD), st = Math.sin(tilt * RAD);
  return function (x, y, z) {
    const dx = x - cx, dy = y - cy;
    const X = dx * cy1 - dy * sy1;
    const Y = dx * sy1 + dy * cy1;
    return {
      x: X,
      y: -(Y * st + z * ct),          // экран: вниз — плюс, поэтому знак минус
      d: Y * ct - z * st,             // глубина: больше — дальше от камеры
    };
  };
}

// Грань как многоугольник на экране плюс её глубина и освещённость.
function face(project, pts, shade, kind, holes) {
  const flat = pts.map(function (p) { return project(p[0], p[1], p[2]); });
  const hs = (holes || []).map(function (h) {
    return h.map(function (p) { return project(p[0], p[1], p[2]); });
  });
  return {
    kind: kind,
    shade: shade,
    // Глубина грани — её САМЫЙ ДАЛЬНИЙ угол. По среднему стена, стоящая наискось,
    // проигрывала соседней и уезжала за неё; по дальнему углу порядок совпадает с
    // тем, что видит глаз.
    depth: flat.reduce(function (a, p) { return Math.max(a, p.d); }, -Infinity),
    pts: flat.map(function (p) { return [p.x, p.y]; }),
    holes: hs.map(function (h) { return h.map(function (p) { return [p.x, p.y]; }); }),
  };
}

// Освещённость по нормали: верх светлее всего, «солнечные» стороны светлее теневых.
// Без этого коробка читается как плоское пятно — глазу не за что зацепиться.
function shadeOf(nx, ny, nz) {
  const L = [0.35, -0.5, 0.79];          // условное солнце слева-сверху-спереди
  const dot = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
  return 0.62 + 0.38 * dot;
}

// Коробка: пять граней (низ не нужен — на него никто не смотрит) с нормалями.
// `holesOn(n)` отдаёт дырки для грани с этой нормалью: проём обязан быть НАСТОЯЩЕЙ
// дыркой, иначе сплошная грань стены закроет и откосы, и стекло, и весь смысл.
function boxFaces(project, r, z0, z1, kind, skip, holesOn) {
  const x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
  const sides = [
    { n: [0, -1, 0], pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    { n: [0, 1, 0], pts: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]] },
    { n: [-1, 0, 0], pts: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]] },
    { n: [1, 0, 0], pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    { n: [0, 0, 1], pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
  ];
  return sides
    .filter(function (s) { return !skip || !skip(s.n); })
    .map(function (s) {
      return face(project, s.pts, shadeOf(s.n[0], s.n[1], s.n[2]), kind, holesOn ? holesOn(s.n) : null);
    });
}

// Проёмы этой стены: те, чей прямоугольник на плане лежит в её толще.
function openingsOf(sc, wall) {
  return sc.openings.filter(function (o) {
    return o.x >= wall.x - 1 && o.x + o.w <= wall.x + wall.w + 1 &&
      o.y >= wall.y - 1 && o.y + o.h <= wall.y + wall.h + 1;
  });
}

// Сцена: грани, отсортированные от дальней к ближней, и рамка вокруг них.
//
// `open` — «кукольный дом»: стены, которые смотрят в камеру, не рисуются, иначе
// поворот показывает глухую коробку. Именно так подают планировку клиенту.
export function isoScene(model, winTypes, opts) {
  const o = opts || {};
  const yaw = (o.yaw == null) ? 35 : Number(o.yaw);
  const tilt = (o.tilt == null) ? 55 : Number(o.tilt);
  const open = (o.open == null) ? true : !!o.open;
  const sc = modelScheme(model, winTypes);
  const H = Number((model || {}).h) || 0;
  const project = camera(yaw, tilt, sc.l / 2, sc.w / 2);

  // Куда смотрит камера в координатах дома — по нему и решаем, какая стена ближняя.
  const view = {
    x: -Math.sin(yaw * RAD) * Math.cos(tilt * RAD),
    y: Math.cos(yaw * RAD) * Math.cos(tilt * RAD),
  };
  const faces = [];

  // Плита основания: дом стоит на ней, а не висит в воздухе. Заодно она даёт
  // толщину полу — без неё пол выглядит листом бумаги, положенным на фон.
  const SLAB = 220;
  boxFaces(project, { x: 0, y: 0, w: sc.l, h: sc.w }, -SLAB, 0, "slab", function (n) {
    return n[2] !== 0 || (n[0] * view.x + n[1] * view.y) > 0;
  }).forEach(function (f) { faces.push(f); });

  // Пол — по клеткам помещений: у Г-образной комнаты пола ровно столько, сколько
  // у неё есть, и никакой габарит его не заменит.
  modelRooms(model).forEach(function (r) {
    (r.cells || []).forEach(function (c) {
      faces.push(face(project, [
        [c.x, c.y, 0], [c.x + c.w, c.y, 0], [c.x + c.w, c.y + c.h, 0], [c.x, c.y + c.h, 0],
      ], 1, "floor"));
    });
  });

  sc.walls.forEach(function (w) {
    const shell = w.kind === "shell";
    // Ближняя наружная стена загораживает всё, ради чего смотрят: убираем её.
    if (open && shell) {
      const nx = (w.w > w.h) ? 0 : ((w.x < sc.l / 2) ? -1 : 1);
      const ny = (w.w > w.h) ? ((w.y < sc.w / 2) ? -1 : 1) : 0;
      if (nx * view.x + ny * view.y < -0.15) return;
    }
    const ops = openingsOf(sc, w);
    const along = w.w > w.h;                 // стена вдоль оси X
    const kind = shell ? "shell" : "part";

    boxFaces(project, w, 0, H, kind, function (n) {
      // Грани, отвёрнутые от камеры, скрыты самой стеной — не рисуем их вовсе.
      return (n[2] === 0) && (n[0] * view.x + n[1] * view.y) > 0;
    }, function (n) {
      // Дырки — только на двух больших гранях стены: проём проходит её насквозь.
      if (n[2] !== 0) return null;
      const onFace = along ? (n[1] !== 0) : (n[0] !== 0);
      if (!onFace) return null;
      const b = along ? ((n[1] < 0) ? w.y : w.y + w.h) : ((n[0] < 0) ? w.x : w.x + w.w);
      return ops.map(function (op) {
        const z0 = Number(op.sill) || 0, z1 = z0 + (Number(op.height) || 0);
        const a0 = along ? op.x : op.y, a1 = along ? op.x + op.w : op.y + op.h;
        return along
          ? [[a0, b, z0], [a1, b, z0], [a1, b, z1], [a0, b, z1]]
          : [[b, a0, z0], [b, a1, z0], [b, a1, z1], [b, a0, z1]];
      });
    }).forEach(function (f) { faces.push(f); });

    // Проём — дырка в стене: обе её плоскости и откосы по толщине. Без откосов
    // стена выглядит бумажной, а по ним на площадке видно, что она толстая.
    ops.forEach(function (op) {
      const z0 = Number(op.sill) || 0, z1 = z0 + (Number(op.height) || 0);
      const a0 = along ? op.x : op.y, a1 = along ? op.x + op.w : op.y + op.h;
      const b0 = along ? w.y : w.x, b1 = along ? w.y + w.h : w.x + w.w;
      const pt = function (a, b, z) { return along ? [a, b, z] : [b, a, z]; };
      // Откосы: низ, верх и два боковых.
      faces.push(face(project, [pt(a0, b0, z0), pt(a1, b0, z0), pt(a1, b1, z0), pt(a0, b1, z0)], 0.86, "reveal"));
      faces.push(face(project, [pt(a0, b0, z1), pt(a1, b0, z1), pt(a1, b1, z1), pt(a0, b1, z1)], 0.72, "reveal"));
      faces.push(face(project, [pt(a0, b0, z0), pt(a0, b1, z0), pt(a0, b1, z1), pt(a0, b0, z1)], 0.8, "reveal"));
      faces.push(face(project, [pt(a1, b0, z0), pt(a1, b1, z0), pt(a1, b1, z1), pt(a1, b0, z1)], 0.8, "reveal"));
      // Стекло — посередине толщины; у двери его нет, там проём насквозь.
      if (op.kind !== "door") {
        const bm = (b0 + b1) / 2;
        faces.push(face(project, [pt(a0, bm, z0), pt(a1, bm, z0), pt(a1, bm, z1), pt(a0, bm, z1)], 1, "glass"));
      }
    });
  });

  // Пол рисуется первым — весь, целиком. Камера смотрит сверху, и ни одна плоскость
  // пола не может закрыть стену, которая на ней стоит; а по одной только глубине
  // дальний пол иногда обгонял ближнюю перегородку и стирал её.
  const rank = function (f) { return (f.kind === "slab" || f.kind === "floor") ? 0 : 1; };
  faces.sort(function (a, b) { return (rank(a) - rank(b)) || (b.depth - a.depth); });

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  faces.forEach(function (f) {
    f.pts.forEach(function (p) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    });
  });
  if (!faces.length) { x0 = y0 = 0; x1 = y1 = 1; }

  return { faces: faces, x0: x0, y0: y0, x1: x1, y1: y1, yaw: yaw, tilt: tilt };
}
