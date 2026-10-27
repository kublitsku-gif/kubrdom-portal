# Нейропродавец: Avito → черновик в Telegram

- Конвейер: вебхук Avito (`avitoWebhook`) → `aiProcessIncoming` → ветка клиента в группе sales-бота → `aiSellerReply` → черновик с кнопками «✅ Отправить / ✏️ Изменить» (или автоответ, если `settings.aiAutoSend` и ответ 🟢). Отправка в Avito — `avitoSend`.
- Мозг выбирается тумблером «Модель ИИ» во вкладке Маркетинг (`settings.aiProvider`), Worker читает его в `aiProvider`, доступы — `aiResolve`.
- **Claude — `aiProvider:"claude"`, модель `CLAUDE_SELLER_MODEL` (wrangler.toml, `claude-sonnet-5-5`).** Запрос собирает `src/claude-chat.js` (`claudeBody`/`claudeText`, сторожит `test-claude-chat`). Гочи Sonnet 5.5:
  - `temperature`/`top_p`/`top_k` не слать — 400 на любое недефолтное значение;
  - `thinking:{type:"disabled"}` — 400; мышление включено всегда и ест `max_tokens` вместе с ответом, поэтому пол 4000 (500, которых хватало DeepSeek, обрезали бы реплику); глубину держит `output_config.effort:"low"`;
  - отказ по политике — `fallbacks:"default"` + `anthropic-beta: server-side-fallback-2026-07-01`; если отказала вся цепочка, `claudeText` бросает ошибку, и в ветку уходит «⚠️ Не удалось подготовить ответ ИИ» — человек отвечает сам;
  - история режется хвостом и может начаться с нашей реплики — первые assistant-сообщения отбрасываются (API ждёт первым user).
- `CLAUDE_MODEL` (sonnet-4-6) — это распознавание планировок (`/api/plan-read`), не путать с продавцом.
