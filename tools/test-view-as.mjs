#!/usr/bin/env node
// «Работать как сотрудник» (public/admin.js).
//
// Админу нужно видеть портал глазами бригадира, не зная его PIN: сказать, что
// поправить, можно только глядя на настоящий экран. Роли, объекты и вкладки берутся
// из currentUser, поэтому подмена даёт НАСТОЯЩИЙ экран, а не похожий. Сторожим: кто
// имеет право, что видно в шапке, что учётные настройки чужого человека спрятаны,
// и что возврат возвращает именно админа.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

function panel (opts) {
  const p = boot(opts || {})
  p.set({
    users: [
      { id: 'a1', name: 'Админ', roles: ['admin'], c: '#34495e', av: '🧑‍💼', objs: [] },
      { id: 'u1', name: 'Валера', roles: ['brigadier'], c: '#8e44ad', av: '👷', objs: ['o1'] },
      { id: 'u2', name: 'Пётр', roles: ['worker'], c: '#2980b9', av: '🧑', objs: ['o1'], mustChangePin: true },
    ],
    roles: [{ id: 'admin', n: 'Админ' }, { id: 'brigadier', n: 'Бригадир' }, { id: 'worker', n: 'Рабочий' }],
    objects: [{ id: 'o1', icon: '🛁', name: 'Баня Буханка', stages: [] }],
    issues: [], templates: [], contractDocs: [], crmClients: [], purchases: [], purchased: {}, arrived: {},
    finTxns: [], receipts: [], estimates: [], expProducts: [], specSheets: [], specSheets2: [],
    projects: [], buildRules: [], winTypes: [], dbPlans: [], settings: {}, stock: [],
  })
  p.run('currentUser=users[0];tab="team";')
  return p
}
const who = (p) => p.q('currentUser.id')

t.section('Кому вообще показываем кнопку')
{
  const p = panel()
  const team = p.run('tTeam()')
  t.ok('у сотрудника есть 👁', /data-a="viewas-enter"[^>]*data-uid="u1"/.test(team))
  t.ok('на себе кнопки нет', !/data-a="viewas-enter"[^>]*data-uid="a1"/.test(team))
  const p2 = panel()
  p2.run('currentUser=users[1];')
  t.ok('бригадиру кнопка не положена', p2.run('tTeam()').indexOf('viewas-enter') < 0)
}

t.section('Вход в роль')
{
  const p = panel()
  p.run('enterViewAs("u1");')
  t.ok('экран стал экраном Валеры', who(p) === 'u1')
  t.ok('админ не потерян', p.q('viewAsReal.id') === 'a1')
  t.ok('вкладка пересобрана под его роль', p.q('tab') === 'assign')
  t.ok('вложенность запрещена', (p.run('enterViewAs("u2");'), p.q('currentUser.id')) === 'u1')
}

t.section('Кто не может войти в роль')
{
  const p = panel()
  p.run('currentUser=users[1];enterViewAs("u2");')
  t.ok('не админ — нет', who(p) === 'u1' && p.q('viewAsReal') === null)
  const p2 = panel()
  p2.run('enterViewAs("a1");')
  t.ok('в себя не входим', p2.q('viewAsReal') === null)
  const p3 = panel()
  p3.run('enterViewAs("нет такого");')
  t.ok('несуществующий сотрудник — нет', p3.q('viewAsReal') === null)
  const p4 = panel({ confirm: false })
  p4.run('enterViewAs("u1");')
  t.ok('отказ в подтверждении — не входим', p4.q('viewAsReal') === null && who(p4) === 'a1')
}

t.section('Шапка честно говорит, что происходит')
{
  const p = panel()
  p.run('enterViewAs("u1");')
  const h = p.run('page()')
  t.ok('видно, чей экран', h.indexOf('Валера') >= 0)
  t.ok('и кто на самом деле', h.indexOf('👁 вы — Админ') >= 0)
  t.ok('предупреждение про запись', h.indexOf('всё пишется на него') >= 0)
  t.ok('«Выйти» заменено возвратом', h.indexOf('viewas-exit') >= 0 && h.indexOf('data-a="logout"') < 0)
  t.ok('чужой PIN не сменить случайно', h.indexOf('pin-change-open') < 0)
  t.ok('и Telegram не перепривязать', h.indexOf('notify-open') < 0)
}

t.section('Экран правда чужой, а не админский')
{
  const p = panel()
  const mine = p.run('page()')
  p.run('enterViewAs("u1");')
  const his = p.run('page()')
  t.ok('вкладки бригадира короче админских', his.indexOf('👥 Команда') < 0 && mine.indexOf('👥 Команда') >= 0)
}

t.section('Возврат')
{
  const p = panel()
  p.run('enterViewAs("u1");exitViewAs();')
  t.ok('вернулись админом', who(p) === 'a1' && p.q('viewAsReal') === null)
  t.ok('шапка снова обычная', p.run('page()').indexOf('viewas-exit') < 0)
  t.ok('лишний вызов ничего не ломает', (p.run('exitViewAs();'), who(p)) === 'a1')
}

t.section('Чужой «смените PIN» админа не запирает')
{
  const p = panel()
  p.run('enterViewAs("u2");')
  t.ok('вошли в роль Петра', who(p) === 'u2')
  // Экран принудительной смены PIN выхода не имеет — для гостя его не показываем.
  p.run('document.getElementById("app")||0;')
  const h = p.run('page()')
  t.ok('это рабочий экран, а не смена PIN', h.indexOf('viewas-exit') >= 0)
}

t.done()
