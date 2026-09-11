// ─── ПЛИНТУС В СМЕТЕ ─────────────────────────────────────────────────────────
// Плинтус дописывают в строку штуками («Сосна АА … 3000 мм», 144 ₽/шт) или
// метражом, а сколько его брать, считал в уме тот, кто читал смету. Погонные метры
// портал уже знает (`modelAreas`): напольный — периметр минус проёмы до пола,
// потолочный — весь периметр, по комнатам и на дом. Здесь — сколько штук ЭТОГО
// товара на эти метры и какие варианты объёма предложить строке. Ставит число
// человек, как листы фанеры в `matNeedForArea` и картриджи клея в `glueForRow`.

// Хлыст плинтуса — от метра до шести: короче — это сечение (15×42 мм) или
// фасонина, длиннее плинтус не продают, и такое число в названии — опечатка.
const PIECE_MIN_M = 1;
const PIECE_MAX_M = 6;

const KIND_N = { floor: "пол", ceil: "потолок", both: "пол + потолок" };

function norm(text) {
  return String(text == null ? "" : text).toLowerCase().replace(/ё/g, "е");
}

// Погонный плинтус, а не то, что к нему покупают штуками к углам: комплект
// фасонины, уголки, заглушки и соединители считаются по углам, а не по метрам.
export function isPlinthMat(name) {
  const s = norm(name);
  if (!/плинтус/.test(s)) return false;
  return !/комплект|фасонин|угол|заглушк|соединител|стыков|клипс|крепеж|клей/.test(s);
}

// Длина одной штуки, м. Сначала карточка метража (`lenPer`), потом название:
// «13 * 43 * 3000 мм» — длина это самое большое из чисел перед «мм», если оно
// похоже на хлыст; «2,5 м» — метры отдельным словом. 0 — длина неизвестна, и
// выдумывать её нельзя: лучше промолчать, чем подсказать неверное число.
export function plinthPieceLen(mat) {
  const m = mat || {};
  const own = Number(m.lenPer) || 0;
  if (own > 0) return own;
  const s = norm(m.n || m.name);
  const inMm = /((?:\d+(?:[.,]\d+)?\s*[*×xх]\s*)*\d+(?:[.,]\d+)?)\s*мм/g;
  let best = 0;
  let r;
  while ((r = inMm.exec(s))) {
    r[1].split(/[*×xх]/).forEach(function (v) {
      const len = Number(String(v).trim().replace(",", ".")) / 1000;
      if (len >= PIECE_MIN_M && len <= PIECE_MAX_M && len > best) best = len;
    });
  }
  if (best > 0) return best;
  const inM = /(\d+(?:[.,]\d+)?)\s*м(?![мa-zа-я²\d])/.exec(s);
  const len = inM ? Number(inM[1].replace(",", ".")) : 0;
  return (len >= PIECE_MIN_M && len <= PIECE_MAX_M) ? len : 0;
}

// Сколько брать на эти метры. Метраж — самими метрами, вверх до 0,1; штуки —
// целыми, вверх. 33 / 3 в плавающей точке бывает чуть больше 11 — без округления
// до миллионных лишней стала бы целая штука. 0 — считать нечего.
export function plinthNeed(mat, metres) {
  const len = Number(metres) || 0;
  if (!mat || len <= 0) return 0;
  if ((mat.mode || "piece") === "mp") return Math.ceil(Math.round(len * 10 * 1e6) / 1e6) / 10;
  const piece = plinthPieceLen(mat);
  if (!(piece > 0)) return 0;
  return Math.ceil(Math.round(len / piece * 1e6) / 1e6);
}

// Напольный или потолочный — по словам: «потолочный», «Потолок зал» — потолок;
// «напольный», «Пол на весь дом» — пол. «пол» — отдельным словом, как в
// `guessVolume`: полиуретан и полотно — не пол. "" — не сказано.
export function plinthKindOf(text) {
  const s = norm(text);
  if (/потол/.test(s)) return "ceil";
  if (/напольн/.test(s) || /(^|[^а-я])пол(а|у|ом|е|ы|ов)?([^а-я]|$)/.test(s)) return "floor";
  return "";
}

// Метры для строки: у приписанной к комнате — этой комнаты, иначе — всего дома.
function metresOf(pos, facts) {
  const rooms = facts.rooms || [];
  const id = String((pos && pos.roomId) || "");
  const name = String((pos && pos.room) || "").trim();
  const room = (id && rooms.find(function (r) { return String(r.id) === id; }))
    || (name && rooms.find(function (r) { return r.name === name; }))
    || null;
  if (room) return { where: room.name, floor: Number(room.plinthFloor) || 0, ceil: Number(room.plinthCeil) || 0 };
  const t = facts.total || {};
  return { where: "весь дом", floor: Number(t.plinthFloor) || 0, ceil: Number(t.plinthCeil) || 0 };
}

// Варианты объёма для плинтуса в строке: [{ k, n, where, len, need }]. Какой он —
// скажет название товара, не сказало — название строки; не сказало и оно —
// предлагаем пол, потолок и оба, выбирает человек. Пусто — строке подсказывать
// нечего: не плинтус, длина штуки неизвестна или чертежа нет.
export function plinthOptions(pos, mat, facts) {
  if (!mat || mat.own || !facts || !isPlinthMat(mat.n || mat.name)) return [];
  const src = metresOf(pos, facts);
  const kind = plinthKindOf(mat.n || mat.name) || plinthKindOf(pos && pos.name);
  return [
    { k: "floor", len: src.floor },
    { k: "ceil", len: src.ceil },
    { k: "both", len: Math.round((src.floor + src.ceil) * 1000) / 1000 },
  ]
    .filter(function (o) { return o.len > 0 && (!kind || o.k === kind); })
    .map(function (o) { return { k: o.k, n: KIND_N[o.k], where: src.where, len: o.len, need: plinthNeed(mat, o.len) }; })
    .filter(function (o) { return o.need > 0; });
}
