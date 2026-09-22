// Confirm IDB writes on transaction completion, never on put.onsuccess.
// A tab has its own recovery record; another tab cannot overwrite its draft.
export function createSnapshotCache({local,indexedDB,key,onStatus=()=>{}}) {
  let memory=null,chain=Promise.resolve(),opened=null;
  const scrub=record=>JSON.parse(JSON.stringify(record,(k,v)=>['pin','clientPin','pinHash','clientPinHash'].includes(k)?undefined:v));
  function open() {
    if(!indexedDB)return Promise.reject(new Error('IndexedDB unavailable'));
    if(!opened)opened=new Promise((resolve,reject)=>{
      const r=indexedDB.open('kubr-state-recovery',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('snapshots');
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>{opened=null;reject(r.error);};
      r.onblocked=()=>reject(new Error('Storage blocked'));
    });
    return opened;
  }
  function readSync(){
    if(memory)return memory;
    try{memory=JSON.parse(local.getItem(key())||'null');}catch{ /* The other persistence layer may still be available. */ }
    return memory;
  }
  async function read(){
    const sync=readSync();
    try{
      const db=await open();
      const value=await new Promise((resolve,reject)=>{
        const tx=db.transaction('snapshots','readonly'),r=tx.objectStore('snapshots').get(key());
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
      if(value&&(!sync||value.ts>sync.ts))memory=value;
      if(!memory){
        const prefix=key().slice(0,key().lastIndexOf(':')+1);
        if(prefix)memory=await new Promise((resolve,reject)=>{
          let newest=null;
          const r=db.transaction('snapshots','readonly').objectStore('snapshots').openCursor();
          r.onsuccess=()=>{const cursor=r.result;if(!cursor){resolve(newest);return;}
            if(String(cursor.key).startsWith(prefix)&&cursor.value.pending&&(!newest||cursor.value.ts>newest.ts))newest={...cursor.value,recoveredFrom:cursor.key};
            cursor.continue();};r.onerror=()=>reject(r.error);
        });
      }
    }catch{ /* The other persistence layer may still be available. */ }
    if(!memory){
      const prefix=key().slice(0,key().lastIndexOf(':')+1);
      try{for(let i=0;prefix&&i<local.length;i++){
        const k=local.key(i);if(!k.startsWith(prefix))continue;
        const v=JSON.parse(local.getItem(k)||'null');
        if(v?.pending&&(!memory||v.ts>memory.ts))memory={...v,recoveredFrom:k};
      }}catch{ /* The other persistence layer may still be available. */ }
    }
    return memory;
  }
  function write(record){
    const value=scrub({...record,recoveredFrom:memory?.recoveredFrom,ts:Math.max(Date.now(),(memory?.ts||0)+1)});memory=value;
    const storageKey=key();let sync=false;
    try{local.setItem(storageKey,JSON.stringify(value));sync=true;
      if(!value.pending&&value.recoveredFrom&&value.recoveredFrom!==storageKey)local.removeItem(value.recoveredFrom);
    }catch{ /* The other persistence layer may still be available. */ }
    onStatus(sync);
    chain=chain.catch(()=>{}).then(async()=>{
      try{
        const db=await open();
        await new Promise((resolve,reject)=>{
          const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(value,storageKey);
          if(!value.pending&&value.recoveredFrom&&value.recoveredFrom!==storageKey)tx.objectStore('snapshots').delete(value.recoveredFrom);
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage aborted'));
        });
        if(memory===value)onStatus(true);
        return true;
      }catch{if(memory===value)onStatus(sync);return sync;}
    });
    return {sync,done:chain};
  }
  return {read,readSync,write,reset(){memory=null;},settled:()=>chain};
}
