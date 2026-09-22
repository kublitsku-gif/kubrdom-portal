// One D1 batch = one transaction. A failed CHECK aborts the entire batch, so a
// conflict can never partially write a multi-section save. No clock exceptions.
export async function commitState(env, storageKey, items, bases) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS state_write_guard (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1))').run();
  const id=crypto.randomUUID();
  const checks=[], params=[];
  for (const [key,version] of Object.entries(bases)) {
    checks.push('COALESCE((SELECT updated_at FROM work_states WHERE storage_key=? AND work_id=?),0)=?');
    params.push(storageKey,key,version);
  }
  const guard=env.DB.prepare('INSERT INTO state_write_guard(id,ok) VALUES (?, CASE WHEN '+(checks.join(' AND ')||'1')+' THEN 1 ELSE 0 END)').bind(id,...params);
  const statements=[guard];
  const now=Date.now();
  for(const item of items) statements.push(env.DB.prepare(
    'INSERT INTO work_states(storage_key,work_id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(storage_key,work_id) DO UPDATE SET data=excluded.data, updated_at=MAX(work_states.updated_at+1,excluded.updated_at)'
  ).bind(storageKey,item.work_id,JSON.stringify(item.data),now));
  statements.push(env.DB.prepare('SELECT work_id, updated_at FROM work_states WHERE storage_key=? AND work_id IN ('+items.map(()=>'?').join(',')+')').bind(storageKey,...items.map(x=>x.work_id)));
  statements.push(env.DB.prepare('DELETE FROM state_write_guard WHERE id=?').bind(id));
  try {
    const results=await env.DB.batch(statements);
    return {ok:true,versions:Object.fromEntries((results[results.length-2].results||[]).map(x=>[x.work_id,x.updated_at]))};
  } catch(error) {
    if(/CHECK constraint failed.*ok\s*=\s*1/i.test(String(error))) return {ok:false};
    throw error;
  }
}
