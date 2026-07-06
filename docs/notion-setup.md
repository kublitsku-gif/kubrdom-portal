# Заливка больших файлов в Notion — настройка

Портал умеет загружать файлы в R2 (`/api/file`, лимит 20 МБ) и видео в Telegram
(`/api/video`, 50 МБ). Для **больших** файлов (тяжёлые PDF, видео, архивы — до 5 ГБ)
есть отдельный путь: эндпоинт `POST /api/notion/upload`, который льёт файл прямо в
**Notion File Upload API** — при размере >20 МБ автоматически по частям (multi-part),
стримом, без буферизации всего файла в памяти Worker'а.

Поток: клиент → `POST /api/notion/upload` (Worker, с токеном портала) → Notion
создаёт объект загрузки → Worker шлёт содержимое (single_part или части по 10 МБ) →
Notion `complete` → (опц.) файл прикрепляется к указанной странице.

---

## Шаг 1. Создать интеграцию Notion и получить токен

1. Откройте https://www.notion.so/my-integrations → **New integration**.
2. Тип — **Internal**, выберите нужный воркспейс, задайте имя (напр. `kubrdom-portal`).
3. Скопируйте **Internal Integration Secret** — строка вида `ntn_…`. Это и есть токен.

> Лимит размера файла зависит от плана Notion: на бесплатном — 5 МБ на файл,
> на платном воркспейсе — до 5 ГБ. Multi-part включается автоматически при >20 МБ.

## Шаг 2. Дать интеграции доступ к страницам

Интеграция по умолчанию не видит ничего. На каждой странице/в базе, куда будете
лить файлы: **••• (справа вверху) → Connections → Add connections → выберите вашу
интеграцию**. Без этого прикрепление к странице вернёт ошибку доступа.

## Шаг 3. Прописать токен в Worker

Cloudflare → Worker **kubrdom-portal-api** → **Settings → Variables and Secrets** →
**Add** → тип **Secret**:

- Имя: `NOTION_TOKEN`
- Значение: токен `ntn_…` из Шага 1

`NOTION_VERSION` уже задан в `wrangler.toml` (`2026-03-11`); менять его нужно только
при обновлении версии Notion API.

Через CLI то же самое: `npx wrangler secret put NOTION_TOKEN`.

---

## Эндпоинт `POST /api/notion/upload`

Требует токен портала (заголовок `X-Admin-Token`, как и остальные защищённые ручки).

**Тело запроса** — бинарное содержимое файла (не multipart-форма).

**Query-параметры:**

| параметр | обяз. | описание |
|----------|-------|----------|
| `name`   | нет   | имя файла — по нему определяется тип и подпись в Notion (по умолчанию `file`) |
| `pageId` | нет   | id страницы/блока Notion — если задан, файл сразу прикрепляется к ней дочерним блоком (image/video/audio/pdf/file). Без него загрузка «висит» ~1 час, пока её не приложат |
| `size`   | нет   | размер в байтах — запасной вариант, если у запроса нет `Content-Length` |

Тип файла берётся из заголовка `Content-Type` запроса (браузер ставит его сам,
когда телом идёт `File`/`Blob`), иначе угадывается по расширению в `name`.

**Ответ:**

```json
{
  "success": true,
  "fileUploadId": "a3f9d3e2-1abc-42de-b904-badc0ffee000",
  "filename": "smeta.pdf",
  "contentType": "application/pdf",
  "size": 84213655,
  "attached": true
}
```

`fileUploadId` можно приложить к странице/свойству базы через Notion API и позже
(в течение ~часа) — см. https://developers.notion.com/docs/uploading-small-files

### Пример с клиента (браузер, из админки портала)

```js
async function uploadToNotion(file, pageId) {
  const qs = new URLSearchParams({ name: file.name });
  if (pageId) qs.set("pageId", pageId);
  const r = await fetch("/api/notion/upload?" + qs, {
    method: "POST",
    headers: {
      "X-Admin-Token": localStorage.getItem("adminToken"), // токен портала
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file, // Content-Length проставится автоматически → большой файл пойдёт стримом
  });
  const j = await r.json();
  if (!j.success) throw new Error(j.error);
  return j; // { fileUploadId, attached, ... }
}
```

---

## Ограничения платформы

- **Размер тела запроса.** Проходит через Worker, поэтому упирается в лимит тела
  запроса Cloudflare (зависит от плана: Free — 100 МБ, платные — больше). Файлы
  крупнее лимита плана через Worker не пройдут.
- **Число подзапросов.** Каждая часть = 1 подзапрос к Notion. 5 ГБ ÷ 10 МБ ≈ 500
  частей — это в пределах платного плана Workers (1000 подзапросов), но выходит за
  бесплатный (50). Для реальных размеров портала (десятки–сотни МБ) запаса хватает.
- Части по 10 МБ (диапазон Notion — 5–20 МБ), последняя может быть меньше.
