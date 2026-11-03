// Known names provide a reliable fallback when the model omits its name field.
const NAMES = new Set(('александр александра алексей алина алиса алла алёна анастасия анатолий андрей анна антон аркадий артём артур борис вадим валентин валентина валерий валерия василий василиса вера виктор виктория виталий владимир владислав вячеслав галина геннадий георгий глеб григорий даниил данил дарья денис диана дмитрий евгений евгения егор екатерина елена елизавета жанна захар зинаида зоя иван игорь илья инна ирина камиль карина кирилл кристина ксения лариса лев леонид лилия любовь людмила максим маргарита марина мария марк матвей михаил надежда наталия наталья никита николай нина оксана олег олеся ольга павел пётр полина раиса рамазан регина ринат роберт роман ростислав руслан светлана семён сергей софия софья станислав степан таисия тамара татьяна тимофей тимур ульяна фёдор эдуард эльвира юлия юрий яна янина ярослав ярослава alex alexander alexey andrey anna boris daniel denis dmitry elena evgeny igor irina ivan julia kirill maria marina maxim natalia nikita oleg olga pavel roman rostislav sergey svetlana tatiana timur vladimir yanina yulia yuri').split(' '));
const title = s => s.split('-').map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join('-');

export function clientFirstName(profile, suggested) {
  const raw = String(profile || '').trim();
  if (!raw || raw.length > 80 || /[\d@_<>/\\]|https?:|^avito\s*[·:]/i.test(raw) || /^(новый клиент|пользователь|неизвестный|клиент)$/i.test(raw)) return '';
  const parts = raw.split(/\s+/);
  if (parts.length > 3) return '';
  const valid = p => /^[\p{L}]+(?:-[\p{L}]+)?$/u.test(p) && p.length >= 2 && p.length <= 30 && /[аеёиоуыэюяaeiouy]/iu.test(p);
  const known = parts.find(p => valid(p) && p.toLowerCase().split('-').every(n => NAMES.has(n)));
  if (known) return title(known);
  const proposed = String(suggested || '').trim();
  return valid(proposed) && parts.some(p => p.toLowerCase() === proposed.toLowerCase()) ? title(proposed) : '';
}

export function addressClient(reply, name, firstReply = true) {
  const text = String(reply || '').trim();
  if (!text || !name) return text;
  const greeting = text.match(/^(Здравствуйте|Добрый день|Доброе утро|Добрый вечер|Привет)(?=$|[\s,.!?:])/iu);
  if (greeting) {
    let rest = text.slice(greeting[0].length);
    if (rest.toLowerCase().startsWith(', ' + name.toLowerCase())) return text;
    rest = rest.replace(/^,\s*[\p{Lu}][\p{L}-]*(?=[!.])/u, '');
    if (/^[!.]/.test(rest)) return greeting[0] + ', ' + name + rest;
    rest = rest.replace(/^[,\s]+/, '');
    return greeting[0] + ', ' + name + '!' + (rest ? ' ' + rest[0].toUpperCase() + rest.slice(1) : '');
  }
  if (text.toLowerCase().split(/[^\p{L}-]+/u).includes(name.toLowerCase())) return text;
  if (firstReply) return 'Здравствуйте, ' + name + '! ' + text;
  const lower = /^(Да|Нет|Конечно|Спасибо|Подскажите|Хорошо|Для|Есть|Можно|Уточните|Расскажите)(?=$|[\s,.!?:])/u.test(text);
  return name + ', ' + (lower ? text[0].toLowerCase() + text.slice(1) : text);
}
