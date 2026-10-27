import assert from 'node:assert/strict';
import {claudeBody,claudeHeaders,claudeText,CLAUDE_SELLER_MODEL,CLAUDE_HAIKU_MODEL,CLAUDE_FALLBACK_BETA} from '../src/claude-chat.js';
// Seller draft: system goes to its own field, Sonnet 5.5 by default, no sampling params.
const body=claudeBody([{role:'system',content:'A'},{role:'system',content:'B'},{role:'assistant',content:'old reply'},{role:'user',content:'price?'}],{max_tokens:500});
assert.equal(body.model,CLAUDE_SELLER_MODEL);assert.equal(body.model,'claude-sonnet-5-5');
assert.equal(body.system,'A\n\nB');
assert.deepEqual(body.messages,[{role:'user',content:'price?'}],'history must start with a user turn');
assert.ok(!('temperature' in body)&&!('top_p' in body)&&!('top_k' in body),'Sonnet 5.5 rejects sampling params');
assert.ok(!('thinking' in body),'disabled thinking is a 400 on Sonnet 5.5');
assert.ok(body.max_tokens>=4000,'thinking shares max_tokens with the reply');
assert.equal(body.output_config.effort,'low');assert.equal(body.fallbacks,'default');
assert.equal(claudeBody([{role:'user',content:'hi'}],{model:'claude-opus-5-5',max_tokens:9000}).max_tokens,9000);
assert.equal(claudeBody([{role:'user',content:'hi'}],{model:'claude-opus-5-5'}).model,'claude-opus-5-5');
assert.ok(!('system' in claudeBody([{role:'user',content:'hi'}])));
const h=claudeHeaders('k');assert.equal(h['x-api-key'],'k');assert.equal(h['anthropic-beta'],CLAUDE_FALLBACK_BETA);
// Haiku 5.5 has no server-side fallback: neither the field nor the beta header.
const hb=claudeBody([{role:'user',content:'hi'}],{model:CLAUDE_HAIKU_MODEL});assert.equal(hb.model,'claude-haiku-5-5');
assert.ok(!('fallbacks' in hb));assert.ok(!('anthropic-beta' in claudeHeaders('k',CLAUDE_HAIKU_MODEL)));
assert.ok(!('temperature' in hb)&&!('thinking' in hb));assert.equal(hb.output_config.effort,'low');
// Response: thinking/fallback blocks skipped, refusal and empty answers are errors (the bot then says the draft failed).
assert.equal(claudeText({stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text:' Здравствуйте! '},{type:'text',text:'Баня — от 1,3 млн.'}]}),'Здравствуйте! Баня — от 1,3 млн.');
assert.throws(()=>claudeText({stop_reason:'refusal',stop_details:{category:'general_harms'},content:[]}),/general_harms/);
assert.throws(()=>claudeText({stop_reason:'max_tokens',content:[{type:'thinking',thinking:''}]}),/пустой/);
assert.throws(()=>claudeText({type:'error',error:{type:'authentication_error'}}),/authentication_error/);
console.log('claude-chat: ok');
