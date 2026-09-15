// ─── ЗАКРЫТИЕ ДНЯ: одно правило для панели, бота и напоминаний ───────────────
// За незакрытый день удерживается штраф живыми деньгами, поэтому «закрыт ли день»
// обязано считаться в ОДНОМ месте. Разойдись панель с кроном — человек видит в
// «Отчёте дня» зелёную галочку, а утром получает 500 ₽ удержания, и спорить с ним
// будет нечем. Отсюда общий модуль (как src/stages.js): его импортирует и
// public/admin.js, и src/reminders.js, а паритет сторожит test-day-close.
//
// День ЛИЧНЫЙ, а не объектный: человек мог весь день провести на втором объекте.
// Поэтому состояние считается по всем объектам сразу, а «🏖 Выходной» из бота
// пишется во все его активные объекты — выходной везде выходной, иначе диаграмма
// второго объекта покажет рабочий день без единого часа.

export const DAY_FINE_CAT = "⚠️ Штраф за незакрытый день";
export const DAY_FINE_DEFAULT = 500;

// Настройка живёт в разделе снимка settings: кого штрафуем и сколько — вопрос
// договорённости с людьми, а не кода. Пустой список = не штрафуем никого.
export function dayFineCfg(settings) {
  const raw = (settings && settings.dayFine) || {};
  const amount = Math.round(Number(raw.amount));
  return {
    enabled: !!raw.enabled,
    amount: amount > 0 ? amount : DAY_FINE_DEFAULT,
    uids: Array.isArray(raw.uids) ? raw.uids.slice() : [],
    // Дни до этой даты не штрафуются вообще: включили режим в среду — за вторник не удерживаем.
    from: typeof raw.from === "string" ? raw.from : "",
    // Мягкий запуск: по эту дату включительно вместо списания приходит «это стоило бы 500 ₽».
    softUntil: typeof raw.softUntil === "string" ? raw.softUntil : "",
  };
}
export function underDayFine(settings, uid) {
  const cfg = dayFineCfg(settings);
  return cfg.enabled && cfg.uids.indexOf(uid) >= 0;
}
export const softDay = (cfg, date) => !!cfg.softUntil && date <= cfg.softUntil;
export const fineStarted = (cfg, date) => !cfg.from || date >= cfg.from;

export function dayReport(obj, uid, date) {
  return ((obj && obj.dayReports) || []).find(function (r) { return r && r.userId === uid && r.date === date; });
}

// Что человек сделал за день на ОДНОМ объекте. Часы и отметки работ берём ровно
// так же, как их пишет панель («Мой день») и бот (botwork.commitDone).
export function dayOnObject(obj, uid, date) {
  let hours = 0, works = 0;
  ((obj && obj.stages) || []).forEach(function (s) {
    ((s && s.works) || []).forEach(function (w) {
      ((w.timeLogs || [])).forEach(function (l) {
        if (l && l.userId === uid && l.date === date) hours += Number(l.hours) || 0;
      });
      if (w.done && w.doneBy === uid && String(w.doneAt || "").indexOf(date) === 0) works++;
    });
  });
  const r = dayReport(obj, uid, date);
  return {
    hours: hours, works: works,
    off: !!(r && r.dayOff),
    note: (r && !r.dayOff && r.note) ? String(r.note) : "",
  };
}

// Итог по человеку за дату. closed — то самое, за что штрафуют (точнее, за что НЕ штрафуют).
export function dayCloseState(objects, uid, date) {
  const out = { closed: false, hours: 0, works: 0, off: false, note: "", objIds: [] };
  (objects || []).forEach(function (o) {
    if (!o) return;
    const d = dayOnObject(o, uid, date);
    if (!d.hours && !d.works && !d.off && !d.note) return;
    out.hours += d.hours; out.works += d.works;
    if (d.off) out.off = true;
    if (d.note && !out.note) out.note = d.note;
    out.objIds.push(o.id);
  });
  out.closed = out.hours > 0 || out.works > 0 || out.off || !!out.note;
  return out;
}

// ─── Штраф ───────────────────────────────────────────────────────────────────
// Идемпотентность держим меткой В САМОЙ транзакции, а не отдельной таблицей: снимок
// уже откатывали через D1 Time Travel, и таблица-сторож после отката «помнила» штраф,
// которого в финансах больше нет.
export const fineRef = (uid, date) => "dayfine:" + uid + ":" + date;
export function hasDayFine(txns, uid, date) {
  const ref = fineRef(uid, date);
  return (txns || []).some(function (t) { return t && t.ref === ref; });
}
export function dayFineTxn(uid, date, amount, obj, contractId) {
  return {
    id: "tx" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    type: "expense", category: DAY_FINE_CAT, amount: Math.round(amount),
    date: date, objId: (obj && obj.id) || "", contractId: contractId || "",
    userId: uid, ref: fineRef(uid, date),
    note: "день не закрыт: ни часов, ни выполненных работ, ни выходного",
  };
}

// Удержания человека. Все «⚠️»-категории, а не только наша: заказчик решил, что
// штраф уменьшает «осталось получить», и просрочка тут ничем не отличается от
// незакрытого дня — оба уже показывались строкой «Удержано штрафов» в боте.
export function fineSum(txns, uid, contractId) {
  return (txns || []).filter(function (t) {
    if (!t || t.type !== "expense" || t.userId !== uid) return false;
    if (contractId !== undefined && contractId !== null && t.contractId !== contractId) return false;
    return String(t.category || "").indexOf("⚠️") === 0;
  }).reduce(function (a, t) { return a + (Number(t.amount) || 0); }, 0);
}

// ─── Запись отметок (общая для бота и панели) ────────────────────────────────
// Возвращают НОВЫЙ массив объектов: снимок в панели иммутабелен, а бот пишет ту же
// строку work_states, что и она.
function upsertReport(o, uid, date, patch, newId) {
  const reports = (o.dayReports || []).slice();
  const i = reports.findIndex(function (r) { return r && r.userId === uid && r.date === date; });
  if (i < 0) reports.push(Object.assign({ id: newId(), userId: uid, date: date }, patch));
  else reports[i] = Object.assign({}, reports[i], patch);
  return Object.assign({}, o, { dayReports: reports });
}
export function markDayOff(objects, uid, date, oids, newId) {
  const want = new Set(oids || []);
  return (objects || []).map(function (o) {
    return want.has(o.id) ? upsertReport(o, uid, date, { dayOff: true, note: "" }, newId) : o;
  });
}
export function setDayNote(objects, uid, date, oid, note, newId) {
  return (objects || []).map(function (o) {
    return o.id === oid ? upsertReport(o, uid, date, { note: String(note || ""), dayOff: false }, newId) : o;
  });
}
