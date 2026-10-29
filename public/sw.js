// Service worker портала: ТОЛЬКО пуш-уведомления CRM.
// Обработчика fetch нет намеренно: сеть и кэш работают как без него, свежесть
// admin.js держат заголовки и живое обновление панели — сюда это не тянуть.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  // Цифра на иконке (Android, установленное приложение на Маке): сколько диалогов ждут ответа.
  if (typeof d.count === "number" && self.navigator && self.navigator.setAppBadge) {
    try { if (d.count > 0) self.navigator.setAppBadge(d.count); else self.navigator.clearAppBadge(); } catch (err) {}
  }
  e.waitUntil(self.registration.showNotification(d.title || "КубрДом CRM", {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: "/kubrdom-crm-192.png",
    badge: "/kubrdom-crm-badge.png",
    data: { url: d.url || "/crm" }
  }));
});

// Нажатие: окно CRM уже открыто — переводим его на диалог, иначе открываем новое.
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/crm";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (new URL(c.url).pathname.indexOf("/crm") === 0 && "focus" in c) {
        c.postMessage({ type: "crm-open", url: url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
