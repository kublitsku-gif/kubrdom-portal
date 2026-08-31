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
const ROOF = 160;         // толщина крыши
const RIB = 260;          // шаг гофры морского контейнера
const RAIL = 150;         // верхний и нижний рельс: гофра идёт между ними

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
    // Глубина грани — её САМЫЙ БЛИЖНИЙ угол. Не средний: стена, стоящая наискось,
    // по среднему проигрывала соседней и уезжала за неё. И не дальний: у стены во
    // всю длину дома дальний угол лежит за двенадцать метров, и такая стена уходила
    // в конец очереди — перегородки рисовались поверх фасада.
    depth: flat.reduce(function (a, p) { return Math.min(a, p.d); }, Infinity),
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

// Глубина плоскости по её углам. Рёбра гофры и рамки проёмов лежат НА грани стены,
// и своей глубины у них, по сути, нет: берут её у грани и рисуются сразу за ней.
// Иначе сортировка ставит их то до, то после стены — гофра пропадает через раз.
function planeDepth(project, pts) {
  return pts.reduce(function (a, p) { return Math.min(a, project(p[0], p[1], p[2]).d); }, Infinity);
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
// Ближняя стена — та, что смотрит в камеру, — загораживает всё, ради чего смотрят.
// С ней два обхождения, и оба нужны:
//   `walls:"ghost"` — стена ПРОЗРАЧНАЯ. Видно и комнаты, и её собственные окна с
//      дверьми: смотрят на дом чаще всего со стороны фасада, и «окон не видно» —
//      это про снятую вместе с ними стену.
//   `walls:"cut"`   — стена снята совсем: чистый вид внутрь, как в кукольном доме.
export function isoScene(model, winTypes, opts) {
  const o = opts || {};
  const yaw = (o.yaw == null) ? 35 : Number(o.yaw);
  const tilt = (o.tilt == null) ? 55 : Number(o.tilt);
  const mode = o.walls || "solid";
  const cut = (mode === "cut");
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
    // Ближняя наружная стена: снимаем совсем или делаем прозрачной.
    let near = false;
    if (shell) {
      const nx = (w.w > w.h) ? 0 : ((w.x < sc.l / 2) ? -1 : 1);
      const ny = (w.w > w.h) ? ((w.y < sc.w / 2) ? -1 : 1) : 0;
      near = (nx * view.x + ny * view.y) < -0.15;
      if (near && cut) return;
      if (mode === "solid") near = false;         // снаружи стена — обычная стена
    }
    const ops = openingsOf(sc, w);
    const along = w.w > w.h;                 // стена вдоль оси X
    const kind = near ? "ghost" : (shell ? "shell" : "part");

    boxFaces(project, w, 0, H, kind, function (n) {
      // Верх стены под крышей не рисуем: светлая полоса между ними разбивает
      // контейнер на две детали, а он одна конструкция.
      if (n[2] > 0 && mode === "solid") return true;
      // Грани, отвёрнутые от камеры, скрыты самой стеной — не рисуем их вовсе.
      // Для прозрачной это тем более верно: две полупрозрачные грани подряд дают
      // муть вместо стены, а видно сквозь неё одинаково хорошо и через одну.
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

    // Гофра морского контейнера: рёбра по наружной грани коробки. Без них дом
    // читается картонной коробкой — гофра его главная примета. Рисуем отрезками в
    // тех же координатах, что и всё остальное: на повороте они остаются на стене,
    // а не ползут по экрану, как это делал бы узор SVG.
    if (shell && mode === "solid") {
      const outX = (w.w > w.h) ? 0 : ((w.x < sc.l / 2) ? -1 : 1);
      const outY = (w.w > w.h) ? ((w.y < sc.w / 2) ? -1 : 1) : 0;
      if ((outX * view.x + outY * view.y) < 0) {          // наружная грань видна
        const b = along ? ((outY < 0) ? w.y : w.y + w.h) : ((outX < 0) ? w.x : w.x + w.w);
        const a0 = along ? w.x : w.y, a1 = along ? w.x + w.w : w.y + w.h;
        const pt0 = function (a, z) { return along ? [a, b, z] : [b, a, z]; };
        const dz = planeDepth(project, [pt0(a0, 0), pt0(a1, 0), pt0(a1, H), pt0(a0, H)]);
        const put = function (pts, kind) {
          const f = face(project, pts, 1, kind);
          f.depth = dz;                          // всё это живёт на своей грани
          faces.push(f);
        };
        // Рельсы: у контейнера гофра идёт МЕЖДУ верхним и нижним поясом, а не от
        // земли до крыши. Без них рёбра выглядят полосками обоев.
        put([pt0(a0, RAIL), pt0(a1, RAIL)], "rail");
        put([pt0(a0, H - RAIL), pt0(a1, H - RAIL)], "rail");
        // Ребро в проём не заходит: гофра — это стена, а в проёме стены нет.
        // Поэтому ребро разрывается на кусок под подоконником и кусок над верхом.
        const cuts = ops.map(function (op) {
          const z0 = Number(op.sill) || 0;
          return { a0: (along ? op.x : op.y), a1: (along ? op.x + op.w : op.y + op.h),
            z0: z0, z1: z0 + (Number(op.height) || 0) };
        });
        for (let a = a0 + RIB; a < a1 - 1; a += RIB) {
          const hit = cuts.filter(function (c) { return a > c.a0 && a < c.a1; });
          let z = RAIL;
          hit.sort(function (p, q) { return p.z0 - q.z0; }).forEach(function (c) {
            if (c.z0 > z) put([pt0(a, z), pt0(a, Math.min(c.z0, H - RAIL))], "rib");
            z = Math.max(z, c.z1);
          });
          if (z < H - RAIL) put([pt0(a, z), pt0(a, H - RAIL)], "rib");
        }
      }
    }

    // Проём — дырка в стене: обе её плоскости и откосы по толщине. Без откосов
    // стена выглядит бумажной, а по ним на площадке видно, что она толстая.
    ops.forEach(function (op) {
      const z0 = Number(op.sill) || 0, z1 = z0 + (Number(op.height) || 0);
      const a0 = along ? op.x : op.y, a1 = along ? op.x + op.w : op.y + op.h;
      const b0 = along ? w.y : w.x, b1 = along ? w.y + w.h : w.x + w.w;
      const pt = function (a, b, z) { return along ? [a, b, z] : [b, a, z]; };
      // Откосы: низ, верх и два боковых. В прозрачной стене они превращаются в муть —
      // там достаточно самого проёма и стекла.
      if (mode !== "ghost" || !near) {
        faces.push(face(project, [pt(a0, b0, z0), pt(a1, b0, z0), pt(a1, b1, z0), pt(a0, b1, z0)], 0.86, "reveal"));
        faces.push(face(project, [pt(a0, b0, z1), pt(a1, b0, z1), pt(a1, b1, z1), pt(a0, b1, z1)], 0.72, "reveal"));
        faces.push(face(project, [pt(a0, b0, z0), pt(a0, b1, z0), pt(a0, b1, z1), pt(a0, b0, z1)], 0.8, "reveal"));
        faces.push(face(project, [pt(a1, b0, z0), pt(a1, b1, z0), pt(a1, b1, z1), pt(a1, b0, z1)], 0.8, "reveal"));
      }
      // Проём обводим рамкой всегда: на прозрачной стене дырка и стена одинаково
      // бледные, а на тёмной гофре чёрный дверной проём просто сливается со стеной —
      // «дверей не видно» ровно об этом.
      if (near || (shell && mode === "solid")) {
        // Рамка лежит на НАРУЖНОЙ грани стены — той, что видна снаружи. По знаку
        // взгляда её выбирать нельзя: на половине ракурсов рамка садилась на
        // дальнюю плоскость и вылезала кусками сквозь свою же стену.
        const oX = (w.w > w.h) ? 0 : ((w.x < sc.l / 2) ? -1 : 1);
        const oY = (w.w > w.h) ? ((w.y < sc.w / 2) ? -1 : 1) : 0;
        const b = along ? ((oY < 0) ? w.y : w.y + w.h) : ((oX < 0) ? w.x : w.x + w.w);
        const fr = face(project, [pt(a0, b, z0), pt(a1, b, z0), pt(a1, b, z1), pt(a0, b, z1)], 1, "frame");
        const fa0 = along ? w.x : w.y, fa1 = along ? w.x + w.w : w.y + w.h;
        fr.depth = planeDepth(project, [pt(fa0, b, 0), pt(fa1, b, 0), pt(fa1, b, H), pt(fa0, b, H)]);
        faces.push(fr);
      }
      // Стекло — посередине толщины; у двери его нет, там проём насквозь.
      if (op.kind !== "door") {
        const bm = (b0 + b1) / 2;
        faces.push(face(project, [pt(a0, bm, z0), pt(a1, bm, z0), pt(a1, bm, z1), pt(a0, bm, z1)], 1, "glass"));
      }
    });
  });

  // Крыша. Есть только у целого дома: в кукольном и в «сквозь стены» она закрывает
  // ровно то, ради чего туда смотрят.
  if (mode === "solid") {
    boxFaces(project, { x: 0, y: 0, w: sc.l, h: sc.w }, H, H + ROOF, "roof", function (n) {
      return (n[2] === 0) && (n[0] * view.x + n[1] * view.y) > 0;
    }).forEach(function (f) { faces.push(f); });
  }

  // Пол рисуется первым — весь, целиком. Камера смотрит сверху, и ни одна плоскость
  // пола не может закрыть стену, которая на ней стоит; а по одной только глубине
  // дальний пол иногда обгонял ближнюю перегородку и стирал её.
  const rank = function (f) { return (f.kind === "slab" || f.kind === "floor") ? 0 : 1; };
  // На одной глубине первой идёт сама грань, за ней — то, что на ней лежит.
  const layer = function (f) { return (f.kind === "rib" || f.kind === "frame") ? 1 : 0; };
  faces.sort(function (a, b) {
    return (rank(a) - rank(b)) || (b.depth - a.depth) || (layer(a) - layer(b));
  });

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
