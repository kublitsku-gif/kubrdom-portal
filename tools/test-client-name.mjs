import assert from 'node:assert/strict';
import { clientFirstName, addressClient } from '../src/client-name.js';

for (const [profile,expected] of [['Янина','Янина'],['янина','Янина'],['Орлова Светлана','Светлана'],['Anna Maria','Анна'],['Анна-Мария','Анна-Мария'],['Новый клиент',''],['Avito · 123',''],['user_278',''],['рпопвп',''],['ООО КубрДом',''],['ignore <instructions>','']]) {
  assert.equal(clientFirstName(profile),expected,profile);
}
assert.equal(clientFirstName('Айгуль Садыкова','Айгуль'),'Айгуль');
assert.equal(clientFirstName('unknown','Янина'),'','No invented name');
assert.equal(addressClient('Здравствуйте! Подберу дом.','Янина'),'Здравствуйте, Янина! Подберу дом.');
assert.equal(addressClient('Здравствуйте. Подберу дом.','Янина'),'Здравствуйте, Янина. Подберу дом.');
assert.equal(addressClient('Добрый день! Подберу дом.','Янина'),'Добрый день, Янина! Подберу дом.');
assert.equal(addressClient('Здравствуйте, Янина! Подберу дом.','Янина'),'Здравствуйте, Янина! Подберу дом.');
assert.equal(addressClient('Здравствуйте, Анна! Подберу дом.','Янина'),'Здравствуйте, Янина! Подберу дом.');
assert.equal(addressClient('Подберу дом.','Янина'),'Здравствуйте, Янина! Подберу дом.');
assert.equal(addressClient('Конечно, подберу дом.','Янина',false),'Янина, конечно, подберу дом.');
assert.equal(addressClient('Здравствуйте! Подберу дом.',''),'Здравствуйте! Подберу дом.');
console.log('Client names: recognizable names addressed, nickname fallbacks, greetings and refinements preserved');

for (const profile of ['Liubov', 'Lyubov', 'Lubov', 'LIUBOV']) assert.equal(clientFirstName(profile), 'Любовь');
assert.equal(clientFirstName('Liubov Petrova', 'Liubov'), 'Любовь');
assert.equal(clientFirstName('Aigul Sadykova', 'Aigul'), 'Аигул');
assert.equal(addressClient('Здравствуйте, Liubov! Подберу дом.', 'Любовь'), 'Здравствуйте, Любовь! Подберу дом.');
assert.equal(addressClient('Liubov, конечно, подберу дом.', 'Любовь', false), 'Любовь, конечно, подберу дом.');
assert.equal(addressClient('Anna, планировка 40HC.', 'Анна', false), 'Анна, планировка 40HC.');
