// Existing deployment credentials stay in Actions; never print access-bearing URLs.
const origin = 'https://portal.kubrdom.ru';
const env = process.env;
for (const name of ['AVITO_CLIENT_ID', 'AVITO_CLIENT_SECRET', 'WEBHOOK_SECRET', 'ADMIN_TOKEN']) {
  if (!env[name]) throw new Error('Missing credential: ' + name);
}
async function request(url, options = {}) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error('Integration request failed: HTTP ' + r.status);
  return r.json();
}
const auth = await request('https://api.avito.ru/token', {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.AVITO_CLIENT_ID, client_secret: env.AVITO_CLIENT_SECRET }),
});
if (!auth.access_token) throw new Error('Avito authorization failed');
const headers = { Authorization: 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' };
const api = (path, body) => request('https://api.avito.ru' + path, {
  headers, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
});
const expected = origin + '/api/avito/webhook?s=' + encodeURIComponent(env.WEBHOOK_SECRET);
async function subscriptions() {
  const j = await api('/messenger/v1/subscriptions', {});
  if (!Array.isArray(j.subscriptions)) throw new Error('Unknown Avito subscriptions response');
  console.log('Webhook subscriptions:', JSON.stringify(j.subscriptions.map(s => {
    const u = new URL(s.url);
    return { endpoint: u.origin + u.pathname, matchesCurrent: s.url === expected };
  })));
  return j.subscriptions.some(s => s.url === expected);
}
let healthy = await subscriptions();
console.log('Portal webhook configured:', healthy);
if (!healthy && env.REPAIR_WEBHOOK === 'true') {
  await api('/messenger/v3/webhook', { url: expected });
  healthy = await subscriptions();
  if (!healthy) throw new Error('Webhook repair was not confirmed');
}
const j = await api('/messenger/v2/accounts/401020763/chats?limit=30');
if (!Array.isArray(j.chats)) throw new Error('Unknown Avito chats response');
// Only matching lead metadata is printed, never message bodies or phone numbers.
const target = j.chats.filter(c => (c.users || []).some(u => /янина/i.test(u.name || '')));
console.log('Recent Avito chat count:', j.chats.length);
console.log('Matching lead:', JSON.stringify(target.map(c => ({ id: c.id, lastAt: c.last_message?.created, type: c.last_message?.type }))));
if (env.IMPORT_CHAT_ID) {
  const result = await request(origin + '/api/avito/import-chat', {
    method: 'POST', headers: { 'X-Admin-Token': env.ADMIN_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: env.IMPORT_CHAT_ID }),
  });
  console.log('Chat import:', JSON.stringify(result));
  if (!result.success) throw new Error('Chat import failed');
}
