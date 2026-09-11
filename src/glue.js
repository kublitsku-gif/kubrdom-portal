// ─── КЛЕЙ ПОД ОБШИВКУ СТЕН ────────────────────────────────────────────────────
// Фанеру и плитку на стены санузла, зала, спальни сажают на монтажный клей Tytan.
// В справочнике «Стены спальня» он стоит одним картриджем на любую площадь, и
// сколько его на самом деле нужно, считал в уме тот, кто читал смету. Портал
// подсказывает число от площади строки, а ставит его человек — как листы фанеры
// в `matNeedForArea`.
import { guessVolume } from "./recipe.js";

// Норма по умолчанию — 100 г на м² (решение Юрия, 11.09.2026). Производитель пишет
// 150–300 г/м², но это сплошной слой; стену мажут точками и полосами. Норма
// правится в самой подсказке и живёт в `settings.glueGPerM2` — одна на портал:
// от дома к дому клей мажут одинаково, а договориться о числе надо один раз.
export const GLUE_G_PER_M2 = 100;
// Больше двух килограммов на квадрат не бывает — это опечатка, а не норма.
export const GLUE_RATE_MAX = 2000;
// Tytan Classic Fix 310 мл — 0,28 кг нетто (характеристики на карточке Леманы).
// Объём в мл здесь не годится: клей на каучуке легче воды, 310 мл ≠ 310 г.
export const GLUE_G_PER_TUBE = 280;
// Товар в базе ищем по артикулу Леманы из ссылки: имя в карточке правят руками,
// а ссылка на магазин остаётся той же.
const GLUE_SKU = "89453236";

const WALL_SURFACES = ["wall", "wallnet", "wallceil", "wallnetceil"];

function rateOk(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 && n <= GLUE_RATE_MAX;
}

// Норма из настроек портала; не задана или испорчена — по умолчанию.
export function glueRateOf(settings) {
  const v = settings && settings.glueGPerM2;
  return rateOk(v) ? Number(v) : GLUE_G_PER_M2;
}

// Что человек вписал в поле нормы: «150», «120,5», «180 г/м²». null — не число
// или вне разумного, и тогда норму не трогаем.
export function glueRateParse(text) {
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(text == null ? "" : text));
  if (!m) return null;
  const v = Number(m[0].replace(",", "."));
  return rateOk(v) ? v : null;
}

// Картриджи покупают целыми. Площадь × норма / 280 в плавающей точке бывает чуть
// больше целого — без округления до миллионных ровно один картридж стал бы двумя.
export function glueTubes(area, rate) {
  const a = Number(area) || 0;
  if (a <= 0) return 0;
  const g = rateOk(rate) ? Number(rate) : GLUE_G_PER_M2;
  return Math.ceil(Math.round(a * g / GLUE_G_PER_TUBE * 1e6) / 1e6);
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
export function glueForRow(pos, rate) {
  if (!pos || pos.own || !isWallRow(pos)) return null;
  const area = Math.round((Number(pos.area) || 0) * (Number(pos.mult) || 1) * 100) / 100;
  if (!(area > 0)) return null;
  const facing = (pos.mats || []).some(function (m) { return m && !m.own && isGluedFacing(m.n); });
  if (!facing) return null;
  const g = rateOk(rate) ? Number(rate) : GLUE_G_PER_M2;
  return { area: area, rate: g, grams: Math.round(area * g), tubes: glueTubes(area, g) };
}

export function glueProductOf(products) {
  const re = new RegExp("lemanapro\\.ru/product/[^?#]*-" + GLUE_SKU + "(/|$|\\?|#)");
  return (products || []).find(function (p) { return p && re.test(String(p.url || "")); }) || null;
}
