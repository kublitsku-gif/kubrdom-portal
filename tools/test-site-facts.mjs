import assert from 'node:assert/strict';
import {saveSql,checkFacts} from './site-facts.mjs';
import {MAX_KNOWLEDGE_CHARS} from '../src/site-knowledge.js';
// Save through Claude Code: one field via json_set, guarded by the version just read.
const sql=saveSql("Шоурум: Шоссейная ул., 92с1 — «КубрДом» it's",1793128769532,1793128799999);
assert.ok(sql.startsWith("UPDATE work_states SET data=json_set(data,'$.aiSiteKnowledge','Шоурум"));
assert.match(sql,/it''s'\), updated_at=1793128799999 WHERE storage_key='admin_panel' AND work_id='settings' AND updated_at=1793128769532;$/);
assert.throws(()=>saveSql('x',0,1),/версии/);assert.throws(()=>saveSql('x',NaN,1),/версии/);
// Facts sanity: not empty, not longer than the worker keeps.
assert.equal(checkFacts('  '+'ф'.repeat(600)+'\n'),'ф'.repeat(600));
assert.throws(()=>checkFacts('коротко'),/короткая/);
assert.throws(()=>checkFacts('ф'.repeat(MAX_KNOWLEDGE_CHARS+1)),/длиннее/);
console.log('site-facts: ok');
