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

const dayOf = (v) => String(v || '').slice(0, 10);

// Готовность работы 0..100 на КОНЕЦ дня asOf (null = «сейчас, со всем, что есть»).
// Отметка «Готово» → последний введённый процент → оценка по часам.
// Без плановых часов и без ручного процента — 0.
export function workPctAsOf(w, asOf) {
  if (!w) return 0;
  if (w.done) {
    if (!asOf) return 100;
    // Без даты закрытия сказать, был ли он закрыт в тот день, нельзя — считаем,
    // что закрыли позже, иначе задним числом «сделаем» работу в день, когда её ещё делали.
    if (w.doneAt && dayOf(w.doneAt) <= asOf) return 100;
  }
  const logs = (w.timeLogs || []).filter((l) => !asOf || dayOf(l && l.date) <= asOf);
  const manual = lastPctLog(logs);
  if (manual) return clamp(manual.pct, 100);
  const plan = Number(w.planHours) || 0;
  if (plan <= 0) return 0;
  const fact = logs.reduce((a, l) => a + (Number(l && l.hours) || 0), 0);
  return clamp((fact / plan) * 100, AUTO_PCT_CAP);
}

export function workPct(w) { return workPctAsOf(w, null); }

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

// ── СДВИГ ГОТОВНОСТИ ЗА ДЕНЬ ────────────────────────────────────────────────
// «Часов отмечено: 7» не отвечает на вопрос, что за день сдвинулось: семь часов
// могли уйти в одну работу или в восемь по чуть-чуть. Сдвиг считаем как разницу
// готовности на конец дня и на конец предыдущего — тогда в него попадает и
// названный процент, и оценка по часам, и закрытая работа.
const prevDay = (date) => {
  const d = new Date(String(date) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// Работа шевелилась в этот день, если за неё есть запись времени или её закрыли.
// uid задан — считаем только то, что делал ОН: отчёт дня личный.
function touchedOn(w, date, uid) {
  const byLog = (w.timeLogs || []).some((l) => l && dayOf(l.date) === date && (!uid || l.userId === uid));
  if (byLog) return true;
  return !!(w.done && dayOf(w.doneAt) === date && (!uid || w.doneBy === uid));
}

// [{oid, objName, sid, wid, wname, from, to, delta, done}] — только реальные сдвиги,
// крупные впереди.
export function dayPctShifts(objects, date, uid) {
  if (!date) return [];
  const before = prevDay(date);
  const out = [];
  (objects || []).forEach((o) => {
    (o.stages || []).forEach((st) => {
      (st.works || []).forEach((w) => {
        if (!touchedOn(w, date, uid)) return;
        const to = workPctAsOf(w, date);
        const from = workPctAsOf(w, before);
        if (to === from) return;
        out.push({
          oid: o.id, objName: o.name || '', sid: st.id, wid: w.id, wname: w.n || '',
          from, to, delta: to - from, done: !!(w.done && dayOf(w.doneAt) === date),
        });
      });
    });
  });
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// Строка для сводки: «Монтаж перегородок 20 → 40%».
export function shiftLabel(sh) {
  return sh.wname + ' ' + sh.from + ' → ' + sh.to + '%' + (sh.done ? ' ✅' : '');
}

// Блок «что сдвинулось» для вечерней сводки. Живёт здесь, а не в reminders.js,
// чтобы его можно было проверить без мока Telegram и D1.
export const SHIFT_DIGEST_MAX = 5;

export function shiftsDigest(shifts, hours, esc) {
  const e = esc || ((x) => x);
  const list = shifts || [];
  if (!list.length) return (Number(hours) || 0) > 0 ? '📈 Готовность работ за день не сдвинулась\n' : '';
  const head = '📈 Сдвинулось работ: <b>' + list.length + '</b>\n';
  const rows = list.slice(0, SHIFT_DIGEST_MAX).map(
    (sh) => '   • ' + e(shiftLabel(sh)) + ' (' + (sh.delta > 0 ? '+' : '') + sh.delta + ')').join('\n');
  const rest = list.length > SHIFT_DIGEST_MAX ? '\n   • и ещё ' + (list.length - SHIFT_DIGEST_MAX) : '';
  return head + rows + rest + '\n';
}
