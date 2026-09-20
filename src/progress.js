// Готовность работы в процентах.
//
// Раньше готовность была булевой: `w.done` да/нет. День, в котором бригадир сдвинул
// восемь работ по чуть-чуть, выглядел в портале как ноль — счётчик «8 из 44» не
// менялся. Гибрид: процент считается сам из часов (факт/план), а человек одним тапом
// перебивает оценку, когда реальность другая.
//
// Процент — ТОЛЬКО видимость. Транши и оплата труда остаются на `w.done` и приёмке
// этапа клиентом: как только процент начнёт двигать выплаты, его начнут завышать.

// Шаг 10%: бригадир говорит «эту на 10, эту на 20» — на четвертях такое не выразить.
// Раскладка как у часов в той же панели: две строки чипов.
export const PCT_PRESETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

// Оценка по часам не доходит до 100: «почти доделал» — это не «сделано»,
// закрыть работу может только человек кнопкой «Готово».
export const AUTO_PCT_CAP = 95;

const clamp = (n, max) => Math.max(0, Math.min(max, Math.round(n)));

// Последний ВВЕДЁННЫЙ процент: сначала по дате записи, при равных датах — тот,
// что внесли позже. Задним числом добавленная запись не отматывает готовность назад.
export function lastPctLog(logs) {
  let best = null;
  (logs || []).forEach((l, i) => {
    if (!l || l.pct == null || !isFinite(l.pct)) return;
    const key = String(l.date || '') + '|' + String(i).padStart(6, '0');
    if (!best || key > best.key) best = { key, log: l };
  });
  return best ? best.log : null;
}

// Готовность работы 0..100: отметка «Готово» → последний введённый процент →
// оценка по часам. Без плановых часов и без ручного процента — 0.
export function workPct(w) {
  if (!w) return 0;
  if (w.done) return 100;
  const logs = w.timeLogs || [];
  const manual = lastPctLog(logs);
  if (manual) return clamp(manual.pct, 100);
  const plan = Number(w.planHours) || 0;
  if (plan <= 0) return 0;
  const fact = logs.reduce((a, l) => a + (Number(l && l.hours) || 0), 0);
  return clamp((fact / plan) * 100, AUTO_PCT_CAP);
}

// Процент выведен из часов, а не назван человеком: в интерфейсе такой показываем
// приглушённо и с «~», чтобы его не принимали за отчёт бригадира.
export function isAutoPct(w) {
  if (!w || w.done) return false;
  return !lastPctLog(w.timeLogs || []);
}

// Готовность объекта: взвешенная по стоимости работ. По числу работ считать нельзя —
// «монтаж перегородок» весит столько же, сколько «повесить крючок».
export function objPct(obj) {
  const works = (obj && obj.stages || []).flatMap((s) => s.works || []);
  if (!works.length) return 0;
  const total = works.reduce((a, w) => a + (Number(w.cost) || 0), 0);
  if (total > 0) {
    const done = works.reduce((a, w) => a + (Number(w.cost) || 0) * workPct(w) / 100, 0);
    return clamp((done / total) * 100, 100);
  }
  // Смета без цен (шаблон, «своя работа») — тогда хотя бы поровну.
  return clamp(works.reduce((a, w) => a + workPct(w), 0) / works.length, 100);
}
