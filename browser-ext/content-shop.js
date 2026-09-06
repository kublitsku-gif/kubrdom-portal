// Снимает цену и наличие с открытой карточки товара.
//
// Читаем СНАЧАЛА разметку Schema.org (JSON-LD): её магазины кладут для поисковиков,
// она стабильна и меняется куда реже вёрстки. Вёрстка — запасной путь: классы вида
// `p1r1p6we_pdp` живут до ближайшего релиза магазина.
(function () {
  const RUB = /([0-9][0-9   ]{0,9}(?:[.,][0-9]{1,2})?)\s*(?:₽|руб)/i;

  function num(v) {
    const n = parseFloat(String(v).replace(/[   ]/g, "").replace(",", "."));
    return isFinite(n) && n > 0 ? n : null;
  }

  function fromLd() {
    const nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of nodes) {
      let data;
      try { data = JSON.parse(s.textContent); } catch (e) { continue; }
      const list = Array.isArray(data) ? data : [data];
      for (const it of list) {
        const off = it && it.offers;
        const offers = Array.isArray(off) ? off : (off ? [off] : []);
        for (const o of offers) {
          const price = num(o && o.price);
          if (price === null) continue;
          const av = String((o && o.availability) || "");
          return { price: price, inStock: !/OutOfStock|SoldOut|Discontinued/i.test(av), src: "schema.org" };
        }
      }
    }
    return null;
  }

  function fromDom() {
    const sel = '[itemprop="price"],[data-qa*="price"],[data-widget="webPrice"],[class*="price" i]';
    for (const el of document.querySelectorAll(sel)) {
      const attr = el.getAttribute && (el.getAttribute("content") || el.getAttribute("data-value"));
      const price = num(attr) || num((String(el.textContent || "").match(RUB) || [])[1]);
      if (price !== null) return { price: price, inStock: !outOfStockText(), src: "вёрстка" };
    }
    return null;
  }

  // «Нет в наличии» пишут словами — и это единственное, что говорит о наличии,
  // когда цену магазин всё равно показывает.
  function outOfStockText() {
    const t = (document.body.innerText || "").slice(0, 6000).toLowerCase();
    return /(нет в наличии|товар закончил|распрода|нет в продаже|снят с produ|временно отсутств)/.test(t);
  }

  function read() {
    const r = fromLd() || fromDom();
    if (!r) return { ok: false, error: "цена не найдена", url: location.href };
    if (outOfStockText()) r.inStock = false;
    return { ok: true, price: r.price, inStock: r.inStock, src: r.src, url: location.href, title: document.title.slice(0, 120) };
  }

  chrome.runtime.onMessage.addListener(function (msg, _s, reply) {
    if (!msg || msg.type !== "kd-read-price") return;
    // Карточки дорисовываются скриптами: даём странице договорить, но не ждём вечно.
    let tries = 0;
    (function attempt() {
      const r = read();
      if (r.ok || tries++ > 6) { reply(r); return; }
      setTimeout(attempt, 500);
    })();
    return true;
  });
})();
