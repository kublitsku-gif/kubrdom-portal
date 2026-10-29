import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const body=source.split('async scheduled(event, env, ctx) {')[1].split('\n  },\n  async fetch')[0];
const reminders=[],deliveries=[],nudges=[],crmTicks=[];
const scheduled=new Function('runReminders','deliverWebsiteLeads','aiNudge','crmTick','return async function(event,env,ctx){'+body+'}')(
 async(env,cron)=>reminders.push(cron),async()=>deliveries.push(true),async()=>nudges.push(true),async()=>crmTicks.push(true));
const ctx={waitUntil(p){return p;}};
for(const hour of [16,17,18]) await scheduled({cron:'0 16,17,18 * * *',scheduledTime:Date.UTC(2026,8,23,hour)}, {},ctx);
assert.deepEqual(reminders,['0 16 * * *','0 17 * * *','0 18 * * *']);
await scheduled({cron:'*/5 * * * *',scheduledTime:Date.UTC(2026,8,23,16)}, {},ctx);
assert.equal(reminders.length,3);assert.equal(deliveries.length,1);assert.equal(nudges.length,0);assert.equal(crmTicks.length,1);
await scheduled({cron:'0 6 * * *',scheduledTime:Date.UTC(2026,8,23,6)}, {},ctx);
assert.equal(reminders.at(-1),'0 6 * * *');assert.equal(nudges.length,1);assert.equal(crmTicks.length,1);
console.log('✓ Consolidated evening cron preserves reminders; website retries never trigger employee reminders or AI nudges; CRM wait/remind pushes run every 5 min only');
