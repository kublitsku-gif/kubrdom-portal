// Bounded fallback for a missed webhook. Old conversations and spam are not
// imported; recovery uses history import and never invokes the AI seller.
export function missingAvitoChats(raw, chats, ownId, now = Date.now()) {
  return (raw || []).filter(c => {
    const m = c.last_message;
    const local = chats['avito:' + c.id];
    if (!c.id || !m?.id || local?.spam) return false;
    if (!['text', 'image'].includes(m.type)) return false;
    if (m.direction === 'out' || String(m.author_id) === String(ownId)) return false;
    const ts = Number(m.created) * 1000;
    if (!ts || ts < now - 86400000 || ts > now + 60000) return false;
    return !(local?.messages || []).some(x => String(x.avitoMsgId || '') === String(m.id));
  }).sort((a, b) => Number(b.last_message.created) - Number(a.last_message.created));
}

export async function recoverAvito(env, { token, loadChats, importChat }, now = Date.now()) {
  if (!env.AVITO_CLIENT_ID || !env.AVITO_CLIENT_SECRET || !env.TG_SALES_BOT_TOKEN) return;
  const t = await token(env);
  const response = await fetch('https://api.avito.ru/messenger/v2/accounts/' + env.AVITO_USER_ID + '/chats?limit=30', {
    headers: { Authorization: 'Bearer ' + t }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Avito recovery list HTTP ' + response.status);
  const data = await response.json();
  if (!Array.isArray(data.chats)) throw new Error('Invalid Avito chat list');
  const candidates = missingAvitoChats(data.chats, await loadChats(env), env.AVITO_USER_ID, now);
  // One history import per cron bounds Avito, Telegram and Worker subrequests.
  if (!candidates.length) return;
  const request = new Request('https://portal.kubrdom.ru/api/avito/import-chat', {
    method: 'POST', body: JSON.stringify({ chatId: candidates[0].id, reopen: true }),
  });
  const result = await importChat(env, request);
  if (!result.ok) throw new Error('Avito history recovery HTTP ' + result.status);
}
