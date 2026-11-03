import { commitState } from './state-store.js';

// A draft is only needed after the latest real customer text, never after our reply.
export function missingDraftTarget(chat) {
  if (!chat || chat.spam || chat.archived || !['avito', 'manual'].includes(chat.source)) return null;
  const messages = chat.messages || [];
  let i = messages.length - 1;
  while (i >= 0 && messages[i].status === 'draft') i--;
  const m = messages[i];
  if (!m || m.role !== 'user' || m.image || !String(m.text || '').trim()) return null;
  if (messages.slice(i + 1).some(x => x.role === 'assistant' && x.status === 'draft' && x.text)) return null;
  return { index: i, token: String(m.avitoMsgId || ('local:' + m.ts + ':' + i + ':' + m.text)), message: m };
}

async function load(env) {
  const row = await env.DB.prepare("SELECT data,updated_at FROM work_states WHERE storage_key='admin_panel' AND work_id='aiChats'").first();
  return { chats: JSON.parse(row?.data || '{}'), version: Number(row?.updated_at) || 0 };
}
const save = (env, state) => commitState(env, 'admin_panel', [{ work_id: 'aiChats', data: state.chats }], { aiChats: state.version });

// The version-guarded lease is shared by webhook, CRM and cron. Generation never sends.
export async function prepareMissingDraft(env, key, deps, options = {}) {
  if (!options.manual && !(await deps.enabled())) return { success: true, paused: true };
  const claim = crypto.randomUUID();
  let input, target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await load(env), chat = state.chats[key];
    target = missingDraftTarget(chat);
    if (!target) return { success: true, existing: true };
    const prior = chat.draftState;
    if (prior?.target === target.token && prior.status === 'thinking' && prior.until > Date.now()) return { success: true, pending: true };
    if (!options.manual && prior?.target === target.token && prior.status === 'error' && prior.until > Date.now()) return { success: false, error: prior.error };
    chat.draftState = { target: target.token, claim, status: 'thinking', until: Date.now() + 120000 };
    if ((await save(env, state)).ok) { input = chat; break; }
  }
  if (!input) return { success: false, error: 'Диалог изменился. Повторите подготовку ответа.' };
  let ai, error = '', providerStatus = '';
  try {
    const history = input.messages.filter(m => ['user', 'assistant'].includes(m.role) && m.status !== 'draft').slice(-12).map(m => ({ role: m.role, content: m.text || '' }));
    ai = await deps.reply(history, input);
    if (!ai || !String(ai.reply || '').trim()) throw new Error('Empty AI reply');
  } catch (e) {
    error = 'Не удалось подготовить ответ ИИ. Нажмите «Повторить».';
    providerStatus = String(e).match(/\b[45]\d\d\b/)?.[0] || '';
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await load(env), chat = state.chats[key], current = missingDraftTarget(chat);
    if (!current || current.token !== target.token || chat.draftState?.claim !== claim) return { success: true, stale: true };
    if (error) {
      chat.draftState = { target: target.token, status: 'error', error, providerStatus, until: Date.now() + 60000 };
    } else {
      chat.messages.push({ id: crypto.randomUUID(), role: 'assistant', text: ai.reply, status: 'draft', needsApproval: ai.needsApproval, plans: ai.plans || [], ts: Date.now(), draftFor: target.token, ...options.cardMeta });
      chat.draftState = { target: target.token, status: 'ready' };
    }
    chat.updatedAt = Date.now();
    if (!(await save(env, state)).ok) continue;
    if (error) return { success: false, error, providerStatus };
    return { success: true, created: true, chat, index: chat.messages.length - 1, reply: ai.reply, needsApproval: ai.needsApproval };
  }
  return { success: false, error: 'Диалог изменился. Повторите подготовку ответа.' };
}

export async function saveDraftDelivery(env, key, id, messageId, card) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await load(env), draft = state.chats[key]?.messages.find(m => m.id === id);
    if (!draft) return;
    Object.assign(draft, { tgMsgId: messageId, card });
    if ((await save(env, state)).ok) return;
  }
}
