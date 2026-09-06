// Обход магазинов по очереди. Вкладки открываются в фоне и закрываются сразу
// после ответа: пятнадцать вкладок разом — это не сверка, а зависший браузер.
const WAIT_MS = 15000;     // сколько ждём карточку, прежде чем признать неудачу
const PAUSE_MS = 700;      // пауза между карточками: мы в гостях у магазина

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function readTab(tabId) {
  return new Promise(function (resolve) {
    const timer = setTimeout(function () { resolve({ ok: false, error: "не дождались карточки" }); }, WAIT_MS);
    // Скрипту нужно время подняться на новой вкладке — пробуем несколько раз.
    let n = 0;
    (function ask() {
      chrome.tabs.sendMessage(tabId, { type: "kd-read-price" }, function (res) {
        if (chrome.runtime.lastError || !res) {
          if (n++ > 12) { clearTimeout(timer); resolve({ ok: false, error: "страница не ответила" }); return; }
          setTimeout(ask, 900); return;
        }
        clearTimeout(timer); resolve(res);
      });
    })();
  });
}

async function checkOne(item) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: item.url, active: false });
    const res = await readTab(tab.id);
    return Object.assign({ id: item.id, offerId: item.offerId || "", url: item.url }, res);
  } catch (e) {
    return { id: item.id, offerId: item.offerId || "", url: item.url, ok: false, error: String(e && e.message || e) };
  } finally {
    if (tab && tab.id) { try { await chrome.tabs.remove(tab.id); } catch (e) {} }
  }
}

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!msg || msg.type !== "kd-check-prices") return;
  (async function () {
    const items = (msg.items || []).slice(0, 60);   // здравый предел на один заход
    const out = [];
    for (let i = 0; i < items.length; i++) {
      out.push(await checkOne(items[i]));
      // Портал показывает прогресс, пока идёт обход: молчащая кнопка выглядит
      // сломанной, а обход двадцати карточек — это полминуты.
      if (sender.tab && sender.tab.id) {
        chrome.tabs.sendMessage(sender.tab.id, { type: "kd-progress", done: i + 1, total: items.length });
      }
      await sleep(PAUSE_MS);
    }
    reply({ ok: true, results: out });
  })();
  return true;
});
