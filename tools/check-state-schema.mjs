// Read-only deployment gate. Never prints records, contact details or credentials.
import fs from 'node:fs';
import {STATE_SECTIONS,validateStateItems} from '../src/state-schema.js';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw new Error('Cloudflare credentials are required for the read-only compatibility check');
const database=fs.readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8').match(/database_id\s*=\s*"([^"]+)"/)?.[1];
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{
 method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
 body:JSON.stringify({sql:"SELECT work_id,data FROM work_states WHERE storage_key='admin_panel'"}),signal:AbortSignal.timeout(60000),
});
const body=await response.json();
if(!response.ok||!body.success)throw new Error('D1 compatibility check failed: HTTP '+response.status);
const rows=body.result.flatMap(r=>r.results||[]),issues=[];
for(const row of rows){
 if(!STATE_SECTIONS.includes(row.work_id))continue;
 let data;try{data=JSON.parse(row.data);}catch{issues.push(row.work_id+': invalid JSON');continue;}
 const error=validateStateItems([{work_id:row.work_id,data}]);
 if(error)issues.push(error);
 console.log(row.work_id+': '+(Array.isArray(data)?data.length:Object.keys(data).length)+' records; '+(error?'REVIEW REQUIRED':'compatible'));
 if(row.work_id==='users'&&!data.some(u=>u.roles?.includes('admin')&&(u.pinHash||u.pin)))issues.push('At least one administrator must have an explicitly configured PIN before deployment');
}
if(issues.length)throw new Error('Deployment stopped: '+issues.join('; '));
console.log('Existing portal data is compatible. No records changed.');
