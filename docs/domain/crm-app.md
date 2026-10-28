# CRM отдельным приложением (/crm): лента Авито и пуши

- **Адрес `/crm` — та же панель (тот же `admin.js`), открытая в режиме «только CRM».** `dist/crm.html` НЕ лежит в `public/`: его собирает `tools/stamp-admin.mjs` из `admin.html`, подменяя манифест (`/crm.webmanifest`), заголовок, цвет темы и apple-иконку. Править вёрстку оболочки — только в `admin.html`, иначе два файла разъедутся. Скрипт в `crm.html` идёт абсолютным путём (`/admin.<hash>.js`).
- Режим включает `isCrmApp()` → `isCrmPath(location.pathname)` (`src/crm-app.js`): `/crm`, `/crm/`, `/crm.html`. В `page()` при этом: вкладка принудительно `crm`, ленты вкладок и «Ещё» нет, внизу своя панель `crmAppBarHtml()` («🎯 Воронка / 💬 Чаты»). Без права на CRM — `crmNoAccessHtml()`, а не чужая вкладка.
- Манифест `crm.webmanifest`: `id:"/crm"`, `scope:"/crm"`, свои иконки `kubrdom-crm-*.png` (логотип + синий значок чата справа сверху). У основного манифеста `id` нет (= `/admin`), поэтому Android ставит две разные иконки.
- **Лента «Чаты»** — `crmView="chats"` (`tCRMChats`), диалог — `crmView="chat"` + `crmChatKey` (`tCRMChat`). Данные — те же `crmChats` из `/api/ai/chats`, порядок и признаки считает `chatFeed`. Ответ уходит тем же `crm-send-avito` (`data-cid="chat"` → поле `crm-reply-chat`). В полном портале в ленту ведёт кнопка «💬 Чаты» в шапке воронки.
- **«Не отвечено» = последняя НЕ-черновая реплика от клиента.** Черновик ИИ клиенту не ушёл и ответом не считается — так считают и `chatFeed`, и `chatUnanswered` (бейдж вкладки). Не расходить.
- Реплики пузырями рисует одна функция `crmMsgsHtml` — и в карточке клиента, и в диалоге. У черновика в диалоге кнопка «✏️ Взять в ответ» (кладёт текст в поле, сама не шлёт).
- Карточка, открытая из диалога (`crm-chat-card`), по «назад» возвращается в диалог (`crmBackView`).

## Пуши

- `public/sw.js` — service worker **только для пушей, без обработчика fetch** (сеть и свежесть `admin.js` как раньше; не добавлять кэш). Регистрирует его лишь приложение `/crm` (`crmAppInit` из `_startLoops`).
- Кнопка «🔔 Включить уведомления» (в ленте, только в `/crm`) → `Notification.requestPermission` → `GET /api/push/key` → `pushManager.subscribe` → `POST /api/push/subscribe`. «Проверить» — `POST /api/push/test` (только свои подписки), «Выкл» — `POST /api/push/unsubscribe`.
- Подписки — `work_states` с `storage_key="push_subs"`, строка на телефон (`work_id` = хэш адреса). В снимок панели не попадают (читаются только `admin_panel` + `STATE_SECTIONS`), версию снимка не двигают.
- **Шлём пуш в `aiProcessIncoming` сразу после записи входящего Авито-сообщения**, до ИИ: по нажатию диалог уже есть. Получатели — подписки тех, у кого СЕЙЧАС есть доступ к CRM (`pushAllowUid`: admin / `crm` / `marketing`, не `disabled`); подписка переживает увольнение, поэтому права проверяются при отправке. 404/410 от push-сервиса — подписка удаляется.
- Адрес подписки принимается только у настоящих push-сервисов (`cleanSubscription`: FCM, Mozilla, Windows, Apple), иначе Worker можно было бы заставить постучаться куда угодно.
- Шифрование и VAPID — свои, на WebCrypto (`src/webpush.js`, RFC 8291 aes128gcm + RFC 8292). Ключи: `VAPID_PUBLIC_KEY` в `wrangler.toml`, приватный — GitHub-секрет `VAPID_PRIVATE_KEY` → `deploy.yml` → Worker. Сменить ключи = все телефоны должны заново включить уведомления.
- Нажатие на пуш: окно `/crm` открыто — `postMessage({type:"crm-open"})` → `crmOpenFromUrl`; нет — открывается `/crm?go=chat%3D<key>`, разбирает `applyDeepLink` (`q.chat`).
- Android-пуши идут через FCM (Google). Если в РФ отвалится — дублировать в Telegram (sales-бот уже шлёт ветку по каждому клиенту).
- Сторожит `tools/test-crm-app.mjs` (в т.ч. расшифровка пуша «браузером» по RFC и проверка подписи VAPID).
