// ─── СРОКИ ПО ЭТАПАМ ─────────────────────────────────────────────────────────
// Общая логика панели и напоминаний (как src/supply.js для закупок): состояние этапа
// должно одинаково считаться на экране и в Telegram, иначе бригадир и прораб увидят
// разное — «просрочен 4 дня» в панели и тишину в чате.
//
// План живёт на этапе объекта: s.planStart / s.planEnd (ISO-даты, обе необязательные).
// Факт НЕ храним — выводим из следов работы (часы, отметки «выполнено»): отдельное поле
// пришлось бы вести руками, и оно разошлось бы с работами при первой правке.

// Рабочие дни между датами. Свой, а не общий с panel/reminders: у каждого из них своя
// копия по историческим причинам, и тащить сюда их зависимости ради десяти строк дороже,
// чем повторить счёт, у которого один-единственный правильный ответ.
export function bizDaysBetween(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from + "T00:00:00"), b = new Date(to + "T00:00:00");
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  let n = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setDate(cur.getDate() + 1);
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

// Что на этапе происходило на самом деле.
export function stageFact(s) {
  const works = (s && s.works) || [];
  const days = [];
  works.forEach(function (w) {
    (w.timeLogs || []).forEach(function (l) { if (l && l.date) days.push(String(l.date).slice(0, 10)); });
    if (w.done && w.doneAt) days.push(String(w.doneAt).slice(0, 10));
  });
  days.sort();
  const done = works.filter(function (w) { return !!w.done; }).length;
  const allDone = works.length > 0 && done === works.length;
  return {
    start: days[0] || "",
    // Конец — только когда закрыты ВСЕ работы этапа: пока хоть одна открыта, этап идёт,
    // и «закончен такого-то» читалось бы как сдача.
    end: allDone ? (days[days.length - 1] || "") : "",
    allDone: allDone, done: done, total: works.length,
  };
}

// Состояние этапа по срокам:
//   none       — плана нет
//   done       — закрыт в срок
//   lateDone   — закрыт с опозданием на late рабочих дней
//   overdue    — план кончился, этап не закрыт (days — просрочка)
//   notStarted — пора было начать, следов работы нет (days — сколько уже стоим)
//   soon       — до конца плана 2 рабочих дня или меньше
//   go         — идём в сроке
export function stageSchedule(s, today) {
  const plan = { start: (s && s.planStart) || "", end: (s && s.planEnd) || "" };
  const fact = stageFact(s);
  const out = { plan: plan, fact: fact, days: 0, late: 0, left: 0 };
  if (!plan.end) { out.state = fact.allDone ? "done" : "none"; return out; }
  if (fact.allDone) {
    out.late = (fact.end && fact.end > plan.end) ? bizDaysBetween(plan.end, fact.end) : 0;
    out.state = out.late ? "lateDone" : "done";
    return out;
  }
  if (today > plan.end) { out.days = bizDaysBetween(plan.end, today); out.state = "overdue"; return out; }
  if (plan.start && today > plan.start && !fact.start) { out.days = bizDaysBetween(plan.start, today); out.state = "notStarted"; return out; }
  out.left = bizDaysBetween(today, plan.end);
  out.state = out.left <= 2 ? "soon" : "go";
  return out;
}

// Насколько состояние срочное. Порядок важности, а не порядок этапов.
export const STAGE_SEVERITY = { overdue: 4, notStarted: 3, soon: 2, lateDone: 1, go: 0, done: 0, none: -1 };

// Худший по срокам этап объекта — одна строка вместо чтения всех этапов.
export function objWorstStage(obj, today) {
  let worst = null;
  ((obj && obj.stages) || []).forEach(function (s) {
    const sc = stageSchedule(s, today);
    if (STAGE_SEVERITY[sc.state] <= 0) return;
    if (!worst || STAGE_SEVERITY[sc.state] > STAGE_SEVERITY[worst.sc.state]
      || (STAGE_SEVERITY[sc.state] === STAGE_SEVERITY[worst.sc.state] && sc.days > worst.sc.days)) {
      worst = { stage: s, sc: sc };
    }
  });
  return worst;
}

// Этапы, о которых стоит написать людям: просрочка, простой и «завтра-послезавтра срок».
export function stagesNeedingAttention(objects, today) {
  const out = [];
  (objects || []).forEach(function (o) {
    ((o && o.stages) || []).forEach(function (s) {
      const sc = stageSchedule(s, today);
      if (STAGE_SEVERITY[sc.state] >= 2) out.push({ obj: o, stage: s, sc: sc });
    });
  });
  out.sort(function (a, b) {
    const d = STAGE_SEVERITY[b.sc.state] - STAGE_SEVERITY[a.sc.state];
    return d || (b.sc.days - a.sc.days);
  });
  return out;
}
