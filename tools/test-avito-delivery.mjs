import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { sqliteDB } from './harness/sqlite-db.js';

const db = sqliteDB({ aiChats: { 'avito:test': { source: 'avito', avitoChatId: 'test', messages: [] } } });
const env = { DB: db.db, ADMIN_TOKEN: 'synthetic', AVITO_CLIENT_ID: 'fake', AVITO_CLIENT_SECRET: 'fake', AVITO_USER_ID: '9' };
const original = globalThis.fetch;
let response;
globalThis.fetch = async url => String(url).endsWith('/token') ? Response.json({ access_token: 'fake', expires_in: 3600 }) : response();
const send = async () => (await worker.fetch(new Request('https://test.invalid/api/ai/send', {
  method: 'POST', headers: { 'X-Admin-Token': 'synthetic', 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientKey: 'avito:test', text: 'Сохраните этот ответ' }),
}), env, { waitUntil() {} })).json();
try {
  response = () => Response.json({ error: { message: 'Payment Required' } }, { status: 402 });
  let result = await send();
  assert.equal(result.sent, false); assert.equal(result.success, false);
  assert.match(result.note, /HTTP 402/); assert.match(result.note, /подписку Авито/);
  let saved = db.get('aiChats').data['avito:test'].messages.at(-1);
  assert.equal(saved.status, 'draft'); assert.equal(saved.text, 'Сохраните этот ответ'); assert.equal(saved.deliveryError, result.note);
  // Even a misleading body with an ID must not turn an HTTP error into delivery.
  response = () => Response.json({ id: 'not-sent', access_token: 'must-not-appear' }, { status: 503 });
  result = await send(); assert.equal(result.sent, false); assert.match(result.note, /HTTP 503/); assert.ok(!result.note.includes('must-not-appear'));
  response = () => new Response('<html>upstream failure</html>', { status: 502 });
  result = await send(); assert.equal(result.sent, false); assert.match(result.note, /HTTP 502/);
  response = () => Response.json({});
  result = await send(); assert.equal(result.sent, false); assert.match(result.note, /не подтвердил/);
  response = () => Response.json({ id: 'confirmed' });
  result = await send(); assert.equal(result.sent, true);
  saved = db.get('aiChats').data['avito:test'].messages.at(-1);
  assert.equal(saved.status, 'sent'); assert.equal(saved.avitoMsgId, 'confirmed'); assert.equal(saved.deliveryError, undefined);
  console.log('Avito delivery: HTTP failures are never sent, subscription refusal preserved, no raw payload leaks, confirmed ID required');
} finally { globalThis.fetch = original; db.close(); }
