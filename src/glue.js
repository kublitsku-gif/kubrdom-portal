// ─── КЛЕЙ ПОД ОБШИВКУ СТЕН ────────────────────────────────────────────────────
// Фанеру и плитку на стены санузла, зала, спальни сажают на монтажный клей Tytan.
// В справочнике «Стены спальня» он стоит одним картриджем на любую площадь, и
// сколько его на самом деле нужно, считал в уме тот, кто читал смету. Портал
// подсказывает число от площади строки, а ставит его человек — как листы фанеры
// в `matNeedForArea`.
import { guessVolume } from "./recipe.js";

// Расход по производителю — 150–300 г/м², берём середину: стену мажут полосами,
// а не сплошь, и 200 г выходит на реальной фанере и плитке.
export const GLUE_G_PER_M2 = 200;
// Tytan Classic Fix 310 мл — 0,28 кг нетто (характеристики на карточке Леманы).
// Объём в мл здесь не годится: клей на каучуке легче воды, 310 мл ≠ 310 г.
export const GLUE_G_PER_TUBE = 280;
// Товар в базе ищем по артикулу Леманы из ссылки: имя в карточке правят руками,
// а ссылка на магазин остаётся той же.
const GLUE_SKU = "89453236";

const WALL_SURFACES = ["wall", "wallnet", "wallceil", "wallnetceil"];

// Картриджи покупают целыми. 1,4 × 200 / 280 в плавающей точке чуть больше
// единицы — без округления до миллионных ровно один картридж стал бы двумя.
export function glueTubes(area) {
  const a = Number(area) || 0;
  if (a <= 0) return 0;
  return Math.ceil(Math.round(a * GLUE_G_PER_M2 / GLUE_G_PER_TUBE * 1e6) / 1e6);
}

export function isGlueMat(name) {
  return /tytan|титан/i.test(String(name || ""));
}

// Что сажают на клей. «Клей для плитки», «мат под плитку», «затирка для плитки»
// содержат то же слово, но на стену их не клеят — отсекаем их первыми.
export function isGluedFacing(name) {
  const s = String(name || "").toLowerCase().replace(/ё/g, "е");
  if (/клей|затирк|грунт|крестик|свп|профил|уголок|под плитк|для плитк/.test(s)) return false;
  return /фанер|керамогранит|кафел|(^|[^а-я])плитк/.test(s);
}

// Стены — это поверхность правила. У строки справочника без правила поверхности
// нет, и читаем её по названию тем же `guessVolume`, что предлагает ей объём.
export function isWallRow(pos) {
  if (!pos) return false;
  if (pos.surface) return WALL_SURFACES.indexOf(pos.surface) >= 0;
  const g = guessVolume(pos.name, []);
  return !!g && (g.k === "wall" || g.k === "wallceil");
}

// Подсказка для строки: null — считать нечего (не стены, нет площади, нечего
// клеить). Площадь с множителем правила: «×2» удваивает материалы, а с ними клей.
export function glueForRow(pos) {
  if (!pos || pos.own || !isWallRow(pos)) return null;
  const area = Math.round((Number(pos.area) || 0) * (Number(pos.mult) || 1) * 100) / 100;
  if (!(area > 0)) return null;
  const facing = (pos.mats || []).some(function (m) { return m && !m.own && isGluedFacing(m.n); });
  if (!facing) return null;
  return { area: area, grams: Math.round(area * GLUE_G_PER_M2), tubes: glueTubes(area) };
}

export function glueProductOf(products) {
  const re = new RegExp("lemanapro\\.ru/product/[^?#]*-" + GLUE_SKU + "(/|$|\\?|#)");
  return (products || []).find(function (p) { return p && re.test(String(p.url || "")); }) || null;
}
