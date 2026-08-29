#!/usr/bin/env node
// Сроки по этапам (src/stages.js) — общая логика панели и напоминаний.
//
// Проверяем то, ради чего это и делалось: отставание должно быть видно ДО того, как
// сорван общий срок сдачи, и одинаково — на экране и в Telegram.
import { stageFact, stageSchedule, objWorstStage, stagesNeedingAttention } from '../src/stages.js'

let failed = 0
const ok = (name, cond, extra) => {
  if (cond) return console.log('  ✓ ' + name)
  failed++
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''))
}

// «Сегодня» — четверг 2026-09-10. Все даты подобраны от него.
const TODAY = '2026-09-10'
const work = (id, opts = {}) => ({ id, n: 'Работа ' + id, cost: 0, mats: [], ...opts })
const stage = (opts = {}) => ({ id: 's1', n: 'ЭТАП 2', works: [], ...opts })

// ── 1. Факт выводится из следов работы ───────────────────────────────────────
{
  console.log('Факт по этапу')
  const s = stage({ works: [
    work('w1', { done: true, doneAt: '2026-09-04 17:00', timeLogs: [{ date: '2026-09-02', hours: 8 }, { date: '2026-09-03', hours: 6 }] }),
    work('w2', { timeLogs: [{ date: '2026-09-08', hours: 4 }] }),
  ] })
  const f = stageFact(s)
  ok('начало — первый день с часами', f.start === '2026-09-02', f.start)
  ok('конца нет, пока не закрыты все работы', f.end === '', f.end + ' — иначе «этап закончен» читалось бы как сдача')
  ok('счёт закрытых работ верен', f.done === 1 && f.total === 2)

  s.works[1].done = true
  s.works[1].doneAt = '2026-09-09 12:00'
  const f2 = stageFact(s)
  ok('после закрытия последней работы появляется конец', f2.end === '2026-09-09', f2.end)
  ok('этап отмечен закрытым', f2.allDone === true)
}

// ── 2. Состояния по плану ────────────────────────────────────────────────────
{
  console.log('Состояния этапа')
  const noPlan = stageSchedule(stage({ works: [work('w1')] }), TODAY)
  ok('без плана состояния нет', noPlan.state === 'none')

  const go = stageSchedule(stage({ planStart: '2026-09-07', planEnd: '2026-09-25',
    works: [work('w1', { timeLogs: [{ date: '2026-09-08', hours: 8 }] })] }), TODAY)
  ok('идём в сроке', go.state === 'go' && go.left === 11, JSON.stringify([go.state, go.left]))

  const soon = stageSchedule(stage({ planStart: '2026-09-01', planEnd: '2026-09-14',
    works: [work('w1', { timeLogs: [{ date: '2026-09-08', hours: 8 }] })] }), TODAY)
  ok('за два рабочих дня до срока — предупреждение', soon.state === 'soon' && soon.left === 2, JSON.stringify([soon.state, soon.left]))

  const over = stageSchedule(stage({ planStart: '2026-08-24', planEnd: '2026-09-04',
    works: [work('w1', { timeLogs: [{ date: '2026-09-01', hours: 8 }] })] }), TODAY)
  ok('план кончился, этап открыт — просрочка в РАБОЧИХ днях', over.state === 'overdue' && over.days === 4,
    JSON.stringify([over.state, over.days]) + ' (04.09 пт → 10.09 чт = 4 рабочих дня)')

  const idle = stageSchedule(stage({ planStart: '2026-09-03', planEnd: '2026-09-30', works: [work('w1')] }), TODAY)
  ok('пора было начать, а следов нет', idle.state === 'notStarted' && idle.days === 5, JSON.stringify([idle.state, idle.days]))

  const done = stageSchedule(stage({ planStart: '2026-08-24', planEnd: '2026-09-11',
    works: [work('w1', { done: true, doneAt: '2026-09-09 10:00' })] }), TODAY)
  ok('закрыт в срок', done.state === 'done' && done.late === 0)

  const lateDone = stageSchedule(stage({ planStart: '2026-08-24', planEnd: '2026-09-01',
    works: [work('w1', { done: true, doneAt: '2026-09-08 10:00' })] }), TODAY)
  ok('закрыт с опозданием — опоздание посчитано', lateDone.state === 'lateDone' && lateDone.late === 5,
    JSON.stringify([lateDone.state, lateDone.late]))
  ok('закрытый этап не считается просроченным', lateDone.state !== 'overdue',
    'иначе сданный месяц назад этап вечно горел бы красным')
}

// ── 3. Худший этап объекта ───────────────────────────────────────────────────
{
  console.log('Худший этап объекта')
  const obj = { id: 'o1', name: 'Баня на Киевке', stages: [
    { id: 's1', n: 'ЭТАП 1', planStart: '2026-08-03', planEnd: '2026-08-28', works: [work('w1', { done: true, doneAt: '2026-08-27 10:00' })] },
    { id: 's2', n: 'ЭТАП 2', planStart: '2026-08-31', planEnd: '2026-09-04', works: [work('w2', { timeLogs: [{ date: '2026-09-01', hours: 8 }] })] },
    { id: 's3', n: 'ЭТАП 3', planStart: '2026-09-07', planEnd: '2026-09-14', works: [work('w3')] },
  ] }
  const w = objWorstStage(obj, TODAY)
  ok('выбран просроченный, а не ближайший по порядку', w && w.stage.id === 's2', w && w.stage.id)
  ok('состояние — просрочка', w.sc.state === 'overdue' && w.sc.days === 4)

  const clean = objWorstStage({ id: 'o2', stages: [
    { id: 'x', n: 'ЭТАП 1', planStart: '2026-09-07', planEnd: '2026-09-30', works: [work('w', { timeLogs: [{ date: '2026-09-08', hours: 8 }] })] },
  ] }, TODAY)
  ok('когда всё в сроке — плашки нет', clean === null, 'иначе карточка объекта шумит без повода')
}

// ── 4. Что уходит в напоминания ──────────────────────────────────────────────
{
  console.log('Отбор для напоминаний')
  const objects = [
    { id: 'o1', name: 'Баня', stages: [
      { id: 'a', n: 'ЭТАП 1', planEnd: '2026-09-01', works: [work('w1', { timeLogs: [{ date: '2026-08-31', hours: 8 }] })] },   // просрочен
      { id: 'b', n: 'ЭТАП 2', planEnd: '2026-09-30', works: [work('w2', { timeLogs: [{ date: '2026-09-09', hours: 8 }] })] },   // в сроке
    ] },
    { id: 'o2', name: 'Дом', stages: [
      { id: 'c', n: 'ЭТАП 1', planEnd: '2026-09-11', works: [work('w3', { timeLogs: [{ date: '2026-09-09', hours: 8 }] })] },   // скоро
      { id: 'd', n: 'ЭТАП 2', planEnd: '2026-09-25', works: [work('w4', { done: true, doneAt: '2026-09-05 10:00' })] },         // закрыт
    ] },
  ]
  const hot = stagesNeedingAttention(objects, TODAY)
  ok('в напоминания попадают только горящие', hot.map((x) => x.stage.id).join(',') === 'a,c',
    hot.map((x) => x.stage.id + ':' + x.sc.state).join(','))
  ok('просрочка идёт выше «скоро»', hot[0].sc.state === 'overdue')
  ok('закрытые и идущие в сроке молчат', !hot.some((x) => ['b', 'd'].indexOf(x.stage.id) >= 0),
    'иначе бригада замьютит бота за неделю')
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли')
process.exit(failed ? 1 : 0)
