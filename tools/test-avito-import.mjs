import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { sqliteDB } from './harness/sqlite-db.js';

const db = sqliteDB({ crmClients: [], aiChats: { other: { name: 'Keep', messages: [] } } });
const env = { DB: db.db, ADMIN_TOKEN: 'master', AVITO_CLIENT_ID: 'id', AVITO_CLIENT_SECRET: 'secret', AVITO_USER_ID: '9', TG_SALES_BOT_TOKEN: 'sales', TG_SALES_CHAT_ID: '-100123' };
const calls = [];
let seq = 100, conflict = true;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); calls.push({ url, init });
  if (url.endsWith('/token')) return Response.json({ access_token: 'test', expires_in: 3600 });
  if (url.includes('/messages/')) return Response.json({ messages: [
    { id: 'incoming', author_id: 8, created: 1793700000, type: 'text', content: { text: 'Можно каталог?' } },
    { id: 'outgoing', author_id: 9, created: 1793700010, type: 'text', content: { text: 'Прежний ответ' } },
  ] });
  if (url.includes('api.avito.ru/messenger/v2/')) return Response.json({ users: [{ id: 8, name: 'Янина' }], context: { value: { id: 1, title: 'Дом' } } });
  if (url.includes('api.telegram.org/')) {
    // Incoming webhook racing with topic delivery must survive the second write.
    if (conflict && url.endsWith('/createForumTopic')) {
      conflict = false;
      const latest = db.get('aiChats');
      latest.data.other.messages.push({ role: 'user', text: 'Concurrent', ts: 1 });
      db.set('aiChats', latest.data, latest.at + 1);
    }
    return Response.json({ ok: true, result: { message_id: ++seq, message_thread_id: seq } });
  }
  throw new Error('Unexpected network request: ' + url);
};
const request = (token, body) => worker.fetch(new Request('https://portal.kubrdom.ru/api/avito/import-chat', {
  method: 'POST', headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, { waitUntil() {} });
try {
  assert.equal((await request('', { chatId: 'chat1' })).status, 401);
  assert.equal((await request('master', { chatId: '' })).status, 400);
  const first = await (await request('master', { chatId: 'chat1' })).json();
  assert.equal(first.success, true);
  assert.equal(first.added, 2);
  assert.equal(first.telegram, true);
  const imported = db.get('aiChats').data['avito:chat1'];
  assert.equal(imported.name, 'Янина');
  assert.ok(imported.topicId);
  assert.equal(imported.messages.length, 2);
  assert.equal(db.get('aiChats').data.other.messages[0].text, 'Concurrent');
  assert.equal(db.get('crmClients').data.length, 1);
  assert.equal(db.get('crmClients').data[0].avitoKey, 'avito:chat1');
  const second = await (await request('master', { chatId: 'chat1' })).json();
  assert.equal(second.success, true);
  assert.equal(second.added, 0);
  assert.equal(db.get('crmClients').data.length, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/createForumTopic')).length, 1);
  assert.ok(!calls.some(c => c.url.includes('api.avito.ru') && c.init.method === 'POST' && !c.url.endsWith('/token')));
  assert.ok(!calls.some(c => /anthropic|deepseek|moonshot|openai/.test(c.url)));
  console.log('Avito import: persisted history and CRM, Telegram topic reused, concurrent edits preserved, no customer replies');
} finally { globalThis.fetch = realFetch; db.close(); }
