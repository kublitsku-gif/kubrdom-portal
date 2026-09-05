// ─── ИСТОРИЯ ЦЕН ТОВАРА ──────────────────────────────────────────────────────
// Цена товара в каталоге — живая: её правят, когда магазин поднял ценник. Но
// смета, посчитанная вчера, считалась по вчерашней цене, и через месяц вопрос
// «почему подорожало» упирается в то, что прежней цифры больше нет нигде.
//
// Поэтому у товара есть короткая история: `prod.hist = [{at, c, by}]`, где `c` —
// цена ЗА ЕДИНИЦУ, `at` — момент правки. Храним НЕ каждый ввод, а состоявшиеся
// изменения: посимвольная правка поля дала бы десяток записей на одну цену.
//
// Длина ограничена (`HIST_MAX`): раздел `expProducts` уходит в снимок целиком, а
// у него общий с остальными лимит строки D1 в два мегабайта.

export const HIST_MAX = 20;

export function priceHist(prod) {
  const h = (prod && prod.hist) || [];
  return Array.isArray(h) ? h : [];
}

// Последняя записанная цена — та, по которой считали до нынешней правки.
export function priceWas(prod) {
  const h = priceHist(prod);
  if (!h.length) return null;
  const cur = Math.round(Number((prod && prod.unitCost) || 0));
  for (let i = h.length - 1; i >= 0; i--) {
    const c = Math.round(Number(h[i].c) || 0);
    if (c !== cur) return h[i];
  }
  return null;
}

// Записать цену в историю. Возвращает true, если запись появилась: одна и та же
// цифра подряд историей не является, а «правка» без изменения цены — это просто
// повторное сохранение карточки.
export function pricePush(prod, cost, at, by) {
  if (!prod) return false;
  const c = Math.round(Number(cost) || 0);
  const h = priceHist(prod).slice();
  const last = h.length ? Math.round(Number(h[h.length - 1].c) || 0) : null;
  if (last === c) return false;
  h.push({ at: String(at || ""), c: c, by: String(by || "") });
  prod.hist = h.slice(-HIST_MAX);
  return true;
}

// Цена материала отстала от каталога? Сравниваем то, что лежит в строке, с
// карточкой товара — и только у материалов со ссылкой на каталог: у вписанного
// руками товара сравнивать не с чем.
export function priceStale(mat, prod) {
  if (!mat || !prod || !mat.pid) return false;
  return Math.round(Number(mat.cost) || 0) !== Math.round(Number(prod.unitCost) || 0);
}

// Пересчёт цен по каталогу для списка материалов. Возвращает, сколько строк
// обновилось и на сколько изменилась сумма — без этого «готово» не отличить от
// «нечего было делать».
export function refreshPrices(mats, prodById) {
  let n = 0, was = 0, now = 0;
  (mats || []).forEach(function (m) {
    const p = prodById[m && m.pid];
    if (!p || !priceStale(m, p)) return;
    const qty = Number(m.qty) || 0;
    was += (Number(m.cost) || 0) * qty;
    m.cost = Math.round(Number(p.unitCost) || 0);
    m.unitCost = m.cost;
    now += m.cost * qty;
    n++;
  });
  return { n: n, diff: Math.round(now - was) };
}
