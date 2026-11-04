// Existing deployment credentials stay in Actions; never print access-bearing URLs.
import { clientFirstName } from '../src/client-name.js';
const origin = 'https://portal.kubrdom.ru';
const env = process.env;
for (const name of ['AVITO_CLIENT_ID', 'AVITO_CLIENT_SECRET', 'WEBHOOK_SECRET', 'ADMIN_TOKEN']) {
  if (!env[name]) throw new Error('Missing credential: ' + name);
}
async function request(url, options = {}) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(/\/api\/ai\/(prepare|redraft)$/.test(url) ? 90000 : 45000) });
  if (!r.ok) {
    const error = await r.json().catch(() => ({}));
    throw new Error('Integration request failed: HTTP ' + r.status + (error.providerStatus ? ', AI provider HTTP ' + error.providerStatus : ''));
  }
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
const portalPost = (path, body) => request(origin + path, { method: 'POST', headers: { 'X-Admin-Token': env.ADMIN_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
if (env.DIAGNOSE_NAME) {
  const local = await request(origin + '/api/ai/chats', { headers: { 'X-Admin-Token': env.ADMIN_TOKEN } });
  const matches = Object.values(local.chats || {}).filter(c => c.avitoChatId && (String(c.name || '').toLowerCase().includes(env.DIAGNOSE_NAME.toLowerCase()) || (c.messages || []).some(m => m.manual && String(m.text || '').toLowerCase().includes(env.DIAGNOSE_NAME.toLowerCase()))));
  console.log('Delivery diagnosis matches:', matches.length);
  for (const chat of matches) {
    const base = '/messenger/v2/accounts/401020763/chats/' + encodeURIComponent(chat.avitoChatId);
    const meta = await api(base);
    const historyResponse = await fetch('https://api.avito.ru/messenger/v3/accounts/401020763/chats/' + encodeURIComponent(chat.avitoChatId) + '/messages/?limit=100', { headers, signal: AbortSignal.timeout(15000) });
    const history = await historyResponse.json().catch(() => ({}));
    if (!historyResponse.ok) console.log('History API refusal:', JSON.stringify({ status: historyResponse.status, error: history }));
    const failed = (chat.messages || []).filter(m => m.manual && m.status === 'draft').slice(-5);
    console.log('Delivery diagnosis:', JSON.stringify({
      chatId: chat.avitoChatId, localFailed: failed.map(m => ({ ts: m.ts, characters: m.text?.length, note: m.deliveryError || null, foundInAvito: historyResponse.ok ? (Array.isArray(history) ? history : history.messages || []).some(a => String(a.author_id) === '401020763' && a.content?.text === m.text) : null })),
      recent: (chat.messages || []).slice(-6).map(m => ({ role: m.role, status: m.status, manual: m.manual, ts: m.ts, characters: m.text?.length })),
      metaKeys: Object.keys(meta), historyCount: history.messages?.length, lastType: meta.last_message?.type,
      users: (meta.users || []).map(u => ({ self: String(u.id) === '401020763', keys: Object.keys(u) })),
    }));
    if (failed.length) {
      // No real recipient: validates the rejected payload without contacting a customer.
      const probe = await fetch('https://api.avito.ru/messenger/v1/accounts/401020763/chats/crm-validation-no-recipient/messages', {
        method: 'POST', headers, body: JSON.stringify({ type: 'text', message: { text: failed.at(-1).text } }), signal: AbortSignal.timeout(15000),
      });
      console.log('Text payload validation:', JSON.stringify({ status: probe.status, response: await probe.json().catch(() => ({})) }));
    }
  }
}
if (env.PROBE_PDF === 'true') {
  // Deliberately invalid recipient and absent file: this cannot contact a customer.
  const validation = await fetch('https://api.avito.ru/messenger/v1/accounts/401020763/chats/crm-validation-no-recipient/messages', {
    method: 'POST', headers, body: JSON.stringify({ type: 'file' }), signal: AbortSignal.timeout(15000),
  });
  const error = await validation.json().catch(() => ({}));
  console.log('Avito file-type validation:', JSON.stringify({ status: validation.status, error: error.error || error.message || error.result || null }));
}
if (env.DRAFT_MODE === 'true') {
  const mode = await portalPost('/api/ai/draft-mode');
  console.log('AI draft mode:', JSON.stringify(mode));
  if (!mode.enabled || mode.autoSend) throw new Error('Draft-only mode was not confirmed');
}
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
if (env.IMPORT_CHAT_ID && env.PREPARE_DRAFT !== 'true') {
  const result = await request(origin + '/api/avito/import-chat', {
    method: 'POST', headers: { 'X-Admin-Token': env.ADMIN_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: env.IMPORT_CHAT_ID }),
  });
  console.log('Chat import:', JSON.stringify(result));
  if (!result.success) throw new Error('Chat import failed');
}
if (env.PREPARE_DRAFT === 'true' && env.IMPORT_CHAT_ID) {
  const prepared = await portalPost('/api/ai/prepare', { clientKey: 'avito:' + env.IMPORT_CHAT_ID, manual: true });
  console.log('AI draft preparation:', JSON.stringify({ success: prepared.success, created: prepared.created, pending: prepared.pending, providerStatus: prepared.providerStatus }));
  if (!prepared.success) throw new Error('AI draft preparation failed');
  const chats = await request(origin + '/api/ai/chats', { headers: { 'X-Admin-Token': env.ADMIN_TOKEN } });
  const chat = chats.chats?.['avito:' + env.IMPORT_CHAT_ID];
  const messages = chat?.messages || [];
  const name = clientFirstName(chat?.name);
  const draft = messages.at(-1);
  if (draft?.role !== 'assistant' || draft.status !== 'draft' || !draft.text?.trim()) throw new Error('A pending non-empty draft was not found');
  console.log('AI draft verified:', JSON.stringify({ pending: true, characters: draft.text.length, mentionsCatalog: /каталог/i.test(draft.text), rewritten: draft.rewritten || 0 }));
  if (env.REWRITE_HINT) {
    const refined = await portalPost('/api/ai/redraft', { clientKey: 'avito:' + env.IMPORT_CHAT_ID, idx: messages.length - 1, hint: env.REWRITE_HINT });
    if (!refined.success || !refined.reply?.trim()) throw new Error('AI draft refinement failed');
    const saved = await request(origin + '/api/ai/chats', { headers: { 'X-Admin-Token': env.ADMIN_TOKEN } });
    const savedDraft = saved.chats?.['avito:' + env.IMPORT_CHAT_ID]?.messages?.[messages.length - 1];
    if (savedDraft?.status !== 'draft' || savedDraft.text !== refined.reply) throw new Error('Refinement was not saved as a draft');
    if (name && !refined.reply.includes(name)) throw new Error('Client name missing from refined draft');
    console.log('AI refinement verified:', JSON.stringify({ pending: true, characters: refined.reply.length, nameAddressed: name ? refined.reply.includes(name) : null }));
  }
}
