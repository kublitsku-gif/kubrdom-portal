#!/usr/bin/env node
// Вопрос, чей объект удалили (public/admin.js).
//
// Раньше вкладка «❓ Вопросы» показывала только строку-ссылку в объект: тап по вопросу
// с удалённым объектом открывал пустой экран, и закрыть такой вопрос было негде.
// Теперь кнопки решения стоят прямо в списке, а в несуществующий объект не уводим.
import { boot, reporter } from './harness/panel-vm.js'

const t = reporter()

function seed(p) {
  p.set({
    objects: [{ id: 'o1', name: 'Баня на Киевке', icon: '🛁', stages: [] }],
    issues: [
      { id: 'i_live', objId: 'o1', kind: 'question', to: 'admin', status: 'new', at: '2026-09-10 09:00', by: 'u1', byName: 'Юрий', text: 'Живой объект' },
      { id: 'i_gone', objId: 'o_deleted', kind: 'change', to: 'admin', status: 'new', at: '2026-09-02 09:00', by: 'u1', byName: 'Юрий', text: 'Объект удалён' },
    ],
    contractDocs: [], users: [], templates: [], purchased: {}, arrived: {}, purchases: [], finTxns: [], settings: {},
  })
}

// ── 1. Кнопки решения в самом списке ─────────────────────────────────────────
{
  t.section('Список вопросов')
  const p = boot(); seed(p)
  p.run('objIssueOpen={i_gone:true};')
  const html = p.run('tIssues()')
  t.ok('у вопроса удалённого объекта есть «Решить»', html.includes('data-a="obj-iss-open" data-iid="i_gone"'))
  t.ok('раскрытый вопрос можно закрыть ответом', html.includes('data-a="iss-answer" data-iid="i_gone"'))
  t.ok('удалённый объект назван, а не выдан за «без объекта»', html.includes('объект удалён'))
  t.ok('к удалённому объекту перехода нет', !html.includes('data-oid="o_deleted"'))
  t.ok('к живому объекту переход есть', html.includes('data-a="iss-goto-obj" data-oid="o1"'))
}

// ── 2. Ответ из списка закрывает вопрос ──────────────────────────────────────
{
  t.section('Ответ без объекта')
  const p = boot(); seed(p)
  p.run('prompt=function(){return "Внесу в портал";};issueNotifyAuthor=function(){};')
  const btn = p.dom.node({ a: 'iss-answer', iid: 'i_gone' })
  p.run('bind();')
  btn.onclick()
  const done = p.q('issues.find(function(x){return x.id==="i_gone";})')
  t.ok('вопрос закрыт с ответом', done.status === 'done' && done.answer === 'Внесу в портал', JSON.stringify(done))
}

// ── 3. Переход в удалённый объект не случается ───────────────────────────────
{
  t.section('Переход в объект')
  const p = boot(); seed(p)
  p.run('tab="issues";openObject=null;')
  const btn = p.dom.node({ a: 'iss-goto-obj', oid: 'o_deleted' })
  p.run('bind();')
  btn.onclick()
  t.ok('остались на вкладке вопросов', p.q('tab') === 'issues' && p.q('openObject') === null)

  // Объект удалили, пока он был открыт (например, с другого устройства): вместо пустоты — список.
  p.run('tab="assign";openObject="o_deleted";')
  const html = p.run('tObjects()')
  t.ok('пустого экрана нет', html.length > 0)
  t.ok('ссылка на удалённый объект сброшена', p.q('openObject') === null)
}

t.done()
