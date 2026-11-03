import assert from 'node:assert/strict';
import { missingAvitoChats, recoverAvito } from '../src/avito-recovery.js';
import worker from '../src/worker.js';
import { sqliteDB } from './harness/sqlite-db.js';

const now = Date.now();
const chat = (id, change = {}) => ({ id, last_message: { id: 'msg-' + id, created: Math.floor(now / 1000), author_id: 8, type: 'text', ...change } });
const chats = [chat('new'), chat('known'), chat('spam'), chat('sent', { direction: 'out' }), chat('mine', { author_id: 9 }), chat('old', { created: Math.floor(now / 1000) - 86401 }), chat('system', { type: 'system' })];
const local = { 'avito:known': { messages: [{ avitoMsgId: 'msg-known' }] }, 'avito:spam': { spam: true } };
assert.deepEqual(missingAvitoChats(chats, local, 9, now).map(c => c.id), ['new']);
const realFetch = globalThis.fetch;
let imports = 0;
try {
  globalThis.fetch = async () => Response.json({ chats: [...chats, chat('second')] });
  await recoverAvito({ AVITO_CLIENT_ID: 'id', AVITO_CLIENT_SECRET: 'secret', AVITO_USER_ID: 9, TG_SALES_BOT_TOKEN: 'sales' }, {
    token: async () => 't', loadChats: async () => local,
    importChat: async (_env, request) => { imports++; assert.deepEqual(await request.json(), { chatId: 'new', reopen: true }); return Response.json({ success: true }); },
  }, now);
  assert.equal(imports, 1);
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(() => recoverAvito({ AVITO_CLIENT_ID: 'id', AVITO_CLIENT_SECRET: 'secret', AVITO_USER_ID: 9, TG_SALES_BOT_TOKEN: 'sales' }, { token: async () => 't' }, now), /HTTP 503/);
  // A failure before persistence must not acknowledge the webhook as delivered.
  const db = sqliteDB({ aiChats: {} });
  try {
    const r = await worker.fetch(new Request('https://portal.kubrdom.ru/api/avito/webhook?s=hook', {
      method: 'POST', body: JSON.stringify({ payload: { type: 'message', value: { chat_id: 'new', id: 'm', author_id: 8, type: 'text', content: { text: 'Каталог' } } } }),
    }), { DB: db.db, WEBHOOK_SECRET: 'hook', TG_SALES_BOT_TOKEN: 'sales', TG_SALES_CHAT_ID: '-1001' }, { waitUntil() {} });
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { ok: false });
  } finally { db.close(); }
  console.log('Avito recovery: bounded missing-message reconciliation, no old/spam/outgoing imports, failed webhook gets 503');
} finally { globalThis.fetch = realFetch; }
