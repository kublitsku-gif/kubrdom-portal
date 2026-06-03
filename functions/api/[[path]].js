// Cloudflare Pages Function: прозрачный прокси /api/* → Worker (kubrdom-portal-api).
// Зачем: чтобы портал торчал наружу ОДНИМ хостом (portal.kubrdom.ru), а не двумя
// (*.pages.dev + *.workers.dev). Edge Cloudflare дёргает Worker на стороне сервера —
// это не попадает под клиентскую SNI-блокировку в РФ. Заодно убирает CORS (всё same-origin).
const WORKER_ORIGIN = "https://kubrdom-portal-api.kublitsku.workers.dev";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = WORKER_ORIGIN + url.pathname + url.search;

  // Копируем заголовки клиента (вкл. X-Admin-Token), убираем host — его задаёт целевой URL.
  const headers = new Headers(request.headers);
  headers.delete("host");

  const method = request.method;
  const init = {
    method,
    headers,
    body: (method === "GET" || method === "HEAD") ? undefined : request.body,
    redirect: "manual",
  };

  return fetch(target, init);
}
