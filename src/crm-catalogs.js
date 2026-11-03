// Marketing files live in R2. A new edition must use a new key: file URLs are immutable.
export const HOUSE_CATALOG = Object.freeze({
  title: 'Место, куда хочется возвращаться',
  pages: 8,
  date: '03.11.2026',
  path: '/api/file/catalogs/dom-dlya-zhizni-20261103.pdf',
  url: 'https://portal.kubrdom.ru/api/file/catalogs/dom-dlya-zhizni-20261103.pdf',
});

// Adding a catalog only edits the reply draft; the existing send action delivers it.
export function appendHouseCatalog(value) {
  const text = String(value || '');
  if (text.includes(HOUSE_CATALOG.url)) return { text, already: true };
  const attachment = 'Каталог домов КубрДом: 5 планировок, комплектации и цены.\n' + HOUSE_CATALOG.url;
  const next = (text.trim() ? text + '\n\n' : '') + attachment;
  if (next.length > 2000) return { text, error: 'Сократите ответ, чтобы текст и ссылка на каталог поместились в 2000 символов.' };
  return { text: next };
}
