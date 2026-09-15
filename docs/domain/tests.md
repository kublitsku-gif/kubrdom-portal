# Тесты

`npm test` (`tools/run-tests.mjs`) прогоняет ВСЕ наборы `tools/test-*.mjs` — каждый отдельным процессом, потому что панельные наборы держат общий стейт в `node:vm`. Новый файл `tools/test-*.mjs` подхватывается сам, правок в package.json и CI не нужно.

- Общие модули: `test-stage-schedule` — сроки этапов (`src/stages.js`), `test-model` — модель контейнера (`src/model.js`), `test-recipe` — правила сборки (`src/recipe.js`), `test-proj-revision` — версии проекта (`src/projrev.js`), `test-prices` — история цен товара (`src/prices.js`).
- Сквозные: `test-spec` — расчёт спецификации (`src/spec.js`), `test-spec-sheet` — вкладка «Спецификация» целиком: копия планировки, выбор вариантов, печать клиенту, договор и объект из спеки. `test-photo-queue` — офлайн-очередь фото, `test-selection` — выбор клиента и бюджет, `test-tpl-revision` — «в шаблоне изменилось», `test-stock` — склад остатков (перекуп → склад → выдача, без двойного расхода), `test-acceptance` — приёмка этапа и транши, обе половины (панель + ручка Worker'а).
- Панель (`tools/harness/panel-vm.js` — admin.js в `node:vm` с поддельным DOM, стейт синтетический): `test-supply-group` — групповая правка закупки, `test-material-link` — связь с каталогом, `test-mat-change` — заявка на замену, `test-state-sync` — что именно уходит в облако и что держат стражи (`boot({net})` подменяет fetch).
- Worker/бот (моки D1 и fetch, гоняют настоящий `worker.fetch`): `test-login-guard` — вход и перебор PIN, `test-state-api` — версия снимка и скоуп оптимистичной блокировки, `test-catalog-api` — ручка заведения товаров, `test-mcp` — MCP-эндпоинт (доступ, протокол, совпадение цифр с панелью, недоступность финансов), `test-botissue`, `test-issue-escalation`, `test-stt`, `test-ogg`.

**CI гоняет их перед выкатом:** в `deploy.yml` есть job `test`, оба деплой-job'а стоят на `needs: test` — упавший тест останавливает выкат целиком. Всё равно гоняйте локально перед пушем в `main`: прогон ~3 с.
