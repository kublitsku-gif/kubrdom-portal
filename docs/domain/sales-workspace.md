# Telegram sales workspace

`src/sales-workspace.js` owns `sales_cards` (one row per client), `sales_prompts` (private force-reply notes, bound to user/chat/message), and `sales_meta` (group destinations, Today and service topics). No personal data in logs.

Website outbox delivers a pinned per-client card and contact instead of a General message. Explicit test submissions go to the service topic. Existing Avito topics stay where they are; the five-minute cron migrates three dialogs at a time. Phone numbers are extracted only from client messages. Unknown names stay “Новый клиент”; profile button accepts name | location | interest.

Buttons: callback in an hour, tomorrow at 10:00 Moscow or an explicit date; call note; waiting; contract/refused/irrelevant; reopen; profile. Notes only accept replies to the exact prompt and are never forwarded to Avito, including expired prompts. Administrator membership is checked before changes. Chat ID plus topic ID identify a dialog. Closed cards suppress AI nudges.

CRM linkage uses existing `avitoKey`, preventing duplicate clients. Updates use the existing snapshot version guard and preserve unrelated client fields/rows. `salesStatus`, `salesFollowupAt`, `salesNote`, `salesTopicUrl` are shown in the CRM card; operational statuses are managed in Telegram. Contract also sets CRM stage=contract. Topic and card IDs persist between retries. Failed card deliveries stay dirty for cron retry; an unknown Telegram result can still create a duplicate, so strict exactly-once is not promised.

Setup: in a private forum group with the sales bot as administrator, the owner (also administrator of the original TG_SALES_CHAT_ID) sends `/sales_bind website`, `/sales_bind avito` or `/sales_bind service`. Only future topics use changed destinations. The original group remains the home of Today and historical Avito topics. Telegram folders must be created using the user's client; Bot API cannot create groups or personal folders.

Tests: `npm test -- sales-workspace website-leads`; full `npm test` before push.
