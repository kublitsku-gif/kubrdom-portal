#!/usr/bin/env node
// Какие объекты видит бригадир/рабочий (getUserObjects в public/admin.js): отмеченные
// вручную (u.objs) и те, где он ответственный в договоре. Архивный договор доступа НЕ
// даёт: черновик «Договор №58», собранный по спецификации и убранный в архив, открыл
// Валере «Мордвес 1», хотя на объект его никто не назначал (15.09.2026).
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

const p = boot({})
p.set({
  users: [{ id: 'valera', name: 'Валера', roles: ['brigadier'], objs: ['o_manual'] }],
  objects: [
    { id: 'o_manual', name: 'Отмечен вручную', stages: [] },
    { id: 'o_signed', name: 'Действующий договор', stages: [] },
    { id: 'o_archived', name: 'Только архивный договор', stages: [] },
    { id: 'o_mixed', name: 'Архивный и действующий', stages: [] },
  ],
  contractDocs: [
    { id: 'c1', objId: 'o_signed', status: 'signed', responsible: ['valera'] },
    { id: 'c2', objId: 'o_archived', status: 'draft', archived: true, responsible: ['valera'] },
    { id: 'c3', objId: 'o_mixed', status: 'signed', archived: true, responsible: ['valera'] },
    { id: 'c4', objId: 'o_mixed', status: 'draft', responsible: ['valera'] },
  ],
})

const mine = p.run('getUserObjects(users[0])')
t.ok('вручную отмеченный объект виден', mine.includes('o_manual'), mine)
t.ok('действующий договор даёт доступ', mine.includes('o_signed'), mine)
t.ok('архивный договор доступа не даёт', !mine.includes('o_archived'), mine)
t.ok('есть неархивный договор — объект виден, архивный рядом не мешает', mine.includes('o_mixed'), mine)
t.ok('архивный договор не прячет вручную отмеченный объект', (() => {
  p.run('contractDocs=contractDocs.concat([{id:"c5",objId:"o_manual",status:"signed",archived:true,responsible:["valera"]}])')
  return p.run('getUserObjects(users[0])').includes('o_manual')
})())

t.done()
