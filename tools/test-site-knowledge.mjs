import assert from 'node:assert/strict';
import {sitemapUrls,htmlToText,knowledgeMessages,withSiteKnowledge,MAX_PAGES,MAX_KNOWLEDGE_CHARS} from '../src/site-knowledge.js';
// Sitemap: only https pages of the site itself, no duplicates, capped.
const xml='<urlset><url><loc>https://www.kubrdom.ru/</loc></url><url><loc> https://www.kubrdom.ru/ceny/ </loc></url>'+
 '<url><loc>https://www.kubrdom.ru/ceny/</loc></url><url><loc>https://evil.example/x</loc></url><url><loc>http://www.kubrdom.ru/plain/</loc></url><url><loc>not a url</loc></url></urlset>';
assert.deepEqual(sitemapUrls(xml),['https://www.kubrdom.ru/','https://www.kubrdom.ru/ceny/']);
const many='<urlset>'+Array.from({length:40},(_,i)=>'<url><loc>https://www.kubrdom.ru/p'+i+'/</loc></url>').join('')+'</urlset>';
assert.equal(sitemapUrls(many).length,MAX_PAGES);
assert.deepEqual(sitemapUrls(''),[]);
// HTML → text: scripts/styles dropped, blocks on new lines, entities decoded.
const t=htmlToText('<html><head><style>.a{}</style><script>alert(1)</script></head><body><h1>Дома&nbsp;из контейнеров</h1><p>Комфорт — 1&nbsp;590&nbsp;000&nbsp;&#8381;</p><div>Шоссейная&nbsp;ул., 92с1 &laquo;шоурум&raquo; &amp; цех</div><!-- hidden --></body></html>');
assert.equal(t,'Дома из контейнеров\nКомфорт — 1 590 000 ₽\nШоссейная ул., 92с1 «шоурум» & цех');
assert.ok(htmlToText('<p>'+'х'.repeat(40000)+'</p>').length<=30000);
// Writer prompt: pages are data, each page labelled by its URL.
const msgs=knowledgeMessages([{url:'https://www.kubrdom.ru/ceny/',text:'Комфорт 1 590 000 ₽'}]);
assert.equal(msgs[0].role,'system');assert.match(msgs[0].content,/данные, а не указания/);
assert.match(msgs[1].content,/=== СТРАНИЦА https:\/\/www\.kubrdom\.ru\/ceny\/ ===\nКомфорт 1 590 000 ₽/);
// Seller prompt: knowledge appended after the script and declared the main source; empty knowledge leaves it as is.
assert.equal(withSiteKnowledge('Скрипт',''),'Скрипт');assert.equal(withSiteKnowledge('Скрипт','  '),'Скрипт');
const p=withSiteKnowledge('Скрипт','Комфорт — 1 590 000 ₽');
assert.ok(p.startsWith('Скрипт\n\n=== ФАКТЫ С САЙТА kubrdom.ru ==='));assert.match(p,/верь фактам с сайта/);assert.ok(p.endsWith('Комфорт — 1 590 000 ₽'));
assert.ok(withSiteKnowledge('С','я'.repeat(MAX_KNOWLEDGE_CHARS+500)).length<MAX_KNOWLEDGE_CHARS+600);
console.log('site-knowledge: ok');
