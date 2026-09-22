// Execute the actual Worker SQL using SQLite, including transactional rollback.
// Python's standard library is available on the development Mac and Ubuntu CI.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PYTHON = `import sqlite3,json,sys
payload=json.load(sys.stdin)
db=sqlite3.connect(payload['file'])
db.row_factory=sqlite3.Row
try:
 db.execute('BEGIN IMMEDIATE')
 result=[]
 for statement in payload['statements']:
  before=db.total_changes
  cursor=db.execute(statement['sql'],statement['args'])
  rows=[dict(r) for r in cursor.fetchall()] if cursor.description else []
  result.append({'results':rows,'meta':{'changes':db.total_changes-before}})
 db.commit()
 print(json.dumps({'results':result}))
except Exception as e:
 db.rollback()
 print(json.dumps({'error':str(e)}))
finally:
 db.close()
`;
export function sqliteDB(seed = {}) {
  const dir=mkdtempSync(path.join(tmpdir(),'kubr-sqlite-'));
  const file=path.join(dir,'state.sqlite');
  const log=[];
  function execute(statements){
    log.push(...statements);
    const run=spawnSync('python3',['-c',PYTHON],{input:JSON.stringify({file,statements}),encoding:'utf8',maxBuffer:32*1024*1024});
    if(run.status!==0)throw new Error(run.stderr||String(run.error));
    const out=JSON.parse(run.stdout);if(out.error)throw new Error(out.error);
    return out.results;
  }
  execute([{sql:'CREATE TABLE work_states(storage_key TEXT,work_id TEXT,data TEXT,updated_at INTEGER,PRIMARY KEY(storage_key,work_id))',args:[]}]);
  function set(key,data,at=1000){execute([{sql:"INSERT OR REPLACE INTO work_states VALUES ('admin_panel',?,?,?)",args:[key,JSON.stringify(data),at]}]);}
  for(const [key,value] of Object.entries(seed))set(key,Object.hasOwn(value,"data")?value.data:value,typeof value.at==="number"?value.at:1000);
  const prepare=sql=>{
    const statement=args=>({sql,args,bind:(...v)=>statement(v),async all(){return execute([{sql,args}])[0];},async run(){return execute([{sql,args}])[0];},async first(){return execute([{sql,args}])[0].results[0]||null;}});
    return statement([]);
  };
  const db={prepare,async batch(statements){return execute(statements.map(({sql,args})=>({sql,args})));}};
  const close=()=>rmSync(dir,{recursive:true,force:true});process.once('exit',close);
  return {db,log,set,close,get(key){const row=execute([{sql:"SELECT * FROM work_states WHERE storage_key='admin_panel' AND work_id=?",args:[key]}])[0].results[0];return row?{data:JSON.parse(row.data),at:row.updated_at}:null;}};
}
