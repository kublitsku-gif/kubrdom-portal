export const equalJSON=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const record=v=>v && typeof v==='object' && !Array.isArray(v);
export const isIdArray=v=>Array.isArray(v)&&v.every(x=>record(x)&&x.id!=null);
// Recursive three-way merge: separate fields in the same object can merge,
// while a delete-versus-edit remains an explicit conflict.
export function mergeValue(base,local,server,path='',choices={}) {
  if(equalJSON(local,server))return {ok:true,value:local};
  if(equalJSON(local,base))return {ok:true,value:server};
  if(equalJSON(server,base))return {ok:true,value:local};
  if(choices[path]==='local')return {ok:true,value:local};
  if(choices[path]==='server')return {ok:true,value:server};
  if(isIdArray(base)&&isIdArray(local)&&isIdArray(server)) {
    const bm=new Map(base.map(x=>[x.id,x])),lm=new Map(local.map(x=>[x.id,x])),sm=new Map(server.map(x=>[x.id,x]));
    const out=[],conflicts=[];
    for(const id of new Set([...server.map(x=>x.id),...local.map(x=>x.id)])) {
      const m=mergeValue(bm.get(id),lm.get(id),sm.get(id),path+'/'+encodeURIComponent(id),choices);
      if(!m.ok)conflicts.push(...m.conflicts); else if(m.value!==undefined)out.push(m.value);
    }
    return conflicts.length?{ok:false,conflicts}:{ok:true,value:out};
  }
  if(record(base)&&record(local)&&record(server)) {
    const out={},conflicts=[];
    for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(server)])) {
      const m=mergeValue(base[key],local[key],server[key],path+'/'+encodeURIComponent(key),choices);
      if(!m.ok)conflicts.push(...m.conflicts);else if(m.value!==undefined)out[key]=m.value;
    }
    return conflicts.length?{ok:false,conflicts}:{ok:true,value:out};
  }
  return {ok:false,conflicts:[{path,base,local,server}]};
}
export function mergeSnapshots(baseItems,localItems,serverItems,choices={}) {
  const map=items=>Object.fromEntries((items||[]).map(x=>[x.work_id,x.data]));
  const b=map(baseItems),l=map(localItems),s=map(serverItems),merged={},conflicts=[],details=[];
  for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(s)])) {
    if(!(key in s))continue; // an omitted section is not a deletion
    const m=mergeValue(b[key],l[key],s[key],key,choices);
    if(m.ok){if(m.value!==undefined)merged[key]=m.value;}
    else {conflicts.push(key);details.push(...m.conflicts);}
  }
  return {merged,conflicts,details};
}
export function changedSections(items,baseline,allowed=null) {
  const old=new Map((baseline||[]).map(x=>[x.work_id,JSON.stringify(x.data)]));
  return items.filter(x=>(!allowed||allowed.includes(x.work_id))&&old.get(x.work_id)!==JSON.stringify(x.data));
}
