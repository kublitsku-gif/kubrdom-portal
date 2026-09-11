#!/usr/bin/env node
// Удалить работу из сметы дома (`posDel`) — не то же, что выключить её галочкой
// (`posOff`). Выключенная стоит на своём месте серой: её прикидывают. Удалённой в
// списке нет вовсе — только в перечне «удалено», откуда её можно вернуть: справочник
// общий на все дома, и молча потерять из него строку для этого дома нельзя.
import { dropOff, carryRuleEdits } from '../src/recipe.js'

const t = reporterOf()
function reporterOf() {
  let failed = 0
  return {
    section: (n) => console.log(n),
    ok: (n, c, extra) => { if (c) return console.log('  ✓ ' + n); failed++; console.log('  ✗ ' + n + (extra ? '\n      ' + extra : '')) },
    done: () => { console.log(failed ? `\n✘ провалено проверок: ${failed}` : '\n✓ все проверки прошли'); process.exit(failed ? 1 : 0) },
  }
}

const P = (key, cost) => ({ key, name: key, cost, stage: 2 })
const RAW = { positions: [P('a', 100), P('b', 200), P('c', 300)] }
const keys = (list) => (list || []).map((p) => p.key).join(',')

{
  t.section('Удалённая работа уходит из списка')
  const r = dropOff(RAW, { posDel: { b: 1 } })
  t.ok('в деньги не входит', keys(r.positions) === 'a,c', keys(r.positions))
  t.ok('и на экране её нет', keys(r.shown) === 'a,c', keys(r.shown))
  t.ok('в «не в итоге» тоже нет', (r.dropped || []).length === 0)
  t.ok('лежит в перечне удалённых — с ценой', keys(r.deleted) === 'b' && r.deleted[0].cost === 200, JSON.stringify(r.deleted))

  // Удалили строку, которая была выключена галочкой: она уходит из «не в итоге».
  const both = dropOff(RAW, { posOff: { b: 1, c: 1 }, posDel: { b: 1 } })
  t.ok('удаление главнее галочки', keys(both.shown) === 'a,c' && keys(both.dropped) === 'c' && keys(both.deleted) === 'b',
    [keys(both.shown), keys(both.dropped), keys(both.deleted)].join(' | '))

  const none = dropOff(RAW, {})
  t.ok('без отметок перечни пустые', (none.deleted || []).length === 0 && (none.dropped || []).length === 0 && none.shown.length === 3)
  t.ok('исходный список не тронут', RAW.positions.length === 3 && !RAW.positions.some((p) => p.off || p.deleted))
}

{
  // Строка справочника уехала под правило — правки переезжают за ней. «Удалено»
  // не переезжает, как и «не в итоге»: молча удалить то, что сейчас стоит в смете,
  // хуже, чем показать лишнее. И в удалённую строку правила ничего не везём.
  t.section('Удаление и перенос правок под правило')
  const RP = [{ key: 'rule:r1:house', estId: 'e1', ruleId: 'r1' }]
  const sh = { posDel: { 'base:e1': 1 }, posHours: { 'base:e1': 2 } }
  carryRuleEdits(sh, RP)
  t.ok('«удалено» остаётся на старом ключе', sh.posDel['base:e1'] === 1 && sh.posDel['rule:r1:house'] === undefined)
  t.ok('а часы переезжают', !!sh.posHours && sh.posHours['rule:r1:house'] === 2, JSON.stringify(sh.posHours))

  const gone = { posDel: { 'rule:r1:house': 1 }, posHours: { 'base:e1': 2 } }
  carryRuleEdits(gone, RP)
  t.ok('в удалённую строку правила ничего не везём',
    gone.posHours['rule:r1:house'] === undefined && gone.posHours['base:e1'] === 2, JSON.stringify(gone.posHours))
}

t.done()
