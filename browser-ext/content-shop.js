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

  // Ozon свою разметку прячет, зато цену рисует в блоке webPrice — и рисует её
  // ДВАЖДЫ: зелёная с Ozon Картой и обычная. Берём меньшую: закупаемся по Карте,
  // и именно она стоит в каталоге (договорённость по каталогу КубрДома).
  function fromOzon() {
    if (!/(^|\.)ozon\.ru$/.test(location.hostname)) return null;
    const box = document.querySelector('[data-widget="webPrice"]') || document.body;
    const found = [];
    for (const el of box.querySelectorAll("span,div")) {
      const t = (el.textContent || "").trim();
      if (t.length > 22) continue;                 // берём только сами ценники, не абзацы
      const m = t.match(RUB);
      const n = m && num(m[1]);
      if (n) found.push(n);
    }
    if (!found.length) return null;
    return { price: Math.min.apply(null, found), inStock: !outOfStockText(), src: "Ozon (цена по Карте)" };
  }

  // Капча — это не «цена не найдена», а «нас не пустили». Разница важна: в первом
  // случае карточку надо чинить, во втором — просто пройти пазл и повторить.
  function captcha() {
    const t = (document.title || "") + " " + (document.body ? document.body.innerText.slice(0, 300) : "");
    return /antibot|captcha|Сопоставьте пазл|Подтвердите, что вы не бот/i.test(t);
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

  // Если товара нет — замену ищем ТУТ ЖЕ: магазин сам показывает «Похожие» под
  // карточкой. Это надёжнее поиска по каталогу (выдача часто под антиботом) и
  // честнее: предлагаем то, что лежит на полке рядом.
  function collectAlts(limit) {
    const out = [], seen = {};
    for (const a of document.querySelectorAll('a[href*="/product/"], a[href*="/card/"]')) {
      const href = a.href;
      if (!href || href === location.href || seen[href]) continue;
      const box = a.closest("article, li, div") || a;
      const txt = (box.innerText || "").trim();
      const m = txt.match(RUB);
      const price = m && num(m[1]);
      if (!price) continue;
      const name = (a.textContent || "").trim().split("\n")[0].trim().slice(0, 120);
      if (name.length < 10) continue;              // «Смотреть всё» — не товар
      seen[href] = 1;
      out.push({ name: name, url: href, price: price, store: document.title.indexOf("Лемана") >= 0 ? "Лемана" : "" });
      if (out.length >= limit) break;
    }
    return out;
  }

  function read() {
    if (captcha()) return { ok: false, error: "магазин показал капчу", captcha: true, url: location.href };
    const r = fromLd() || fromOzon() || fromDom();
    if (!r) return { ok: false, error: "цена не найдена", url: location.href };
    if (outOfStockText()) r.inStock = false;
    const res = { ok: true, price: r.price, inStock: r.inStock, src: r.src, url: location.href, title: document.title.slice(0, 120) };
    if (!r.inStock) {
      const alts = collectAlts(3);
      if (alts.length) { res.alt = alts[0]; res.alts = alts; }
    }
    return res;
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
