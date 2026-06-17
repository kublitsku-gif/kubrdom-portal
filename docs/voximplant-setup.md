# Голосовой обзвон — настройка Voximplant (телефонная часть)

«Мозг» уже работает в Worker (`/api/voice-brain` → YandexGPT, проверено в панели
«🎙 Голосовой ИИ → 🧪 Тест диалога»). Здесь — телефония: набор номера, распознавание
речи (Yandex ASR) и синтез (Yandex TTS) на стороне **Voximplant**.

Поток: панель → `POST /api/voice-call` (Worker) → Voximplant `StartScenarios`
с `customData` → сценарий VoxEngine звонит лиду → на каждую реплику зовёт
`callbackBase/api/voice-brain?s=SECRET` → по завершении шлёт итог в
`callbackBase/api/voice-result?s=SECRET` → панель видит результат.

---

## Шаг 1. Аккаунт и номер Voximplant

1. Зарегистрируйтесь на https://voximplant.com (есть тестовый баланс).
2. **Phone numbers → Buy** — арендуйте номер РФ (это будет Caller ID).
3. Запомните **Account ID** (Settings → Account) и создайте **API key**
   (Settings → API keys → Generate). Они нужны Worker'у.

## Шаг 2. Приложение, сценарий, правило

1. **Applications → Create** — напр. `kubrdom-voice`.
2. **Scenarios → Create** — вставьте сценарий из Шага 5, назовите `kubrdom-call`.
3. В приложении **Rules → Create**: привяжите сценарий `kubrdom-call`,
   pattern `.*` (исходящие — паттерн не важен). Запомните **Rule ID** правила.

## Шаг 3. Ключи в Cloudflare Worker

Секреты (значения не видны в коде):
```
cd ~/Documents/KUBRDOM-portal
npx wrangler secret put VOX_ACCOUNT_ID     # Account ID Voximplant
npx wrangler secret put VOX_API_KEY        # API key Voximplant
npx wrangler secret put WEBHOOK_SECRET     # уже задан — длинная случайная строка (тот же секрет увидит сценарий)
```
Переменные в `wrangler.toml` (`[vars]`, не секретны):
```
VOX_RULE_ID    = "12345678"                 # Rule ID из Шага 2.3
VOX_CALLER_ID  = "79991234567"              # арендованный номер (только цифры)
PUBLIC_BASE_URL = "https://portal.kubrdom.ru"  # на этот адрес сценарий шлёт колбэки
```
Если `WEBHOOK_SECRET` ещё не генерировали — сделайте длинную случайную строку
(напр. `openssl rand -hex 24`) и положите тем же `wrangler secret put`.

## Шаг 4. Проверка номера получателя (тест)

На триале Voximplant можно звонить только на **подтверждённые** номера:
**Phone numbers → Caller IDs / Verified numbers** — добавьте свой мобильный,
подтвердите кодом. Для боевого обзвона снимается ограничение после пополнения.

## Шаг 5. Сценарий VoxEngine

> Скопируйте целиком в Scenarios. Голоса/ASR — встроенная интеграция Voximplant с
> Yandex SpeechKit. **Если константа голоса/ASR не найдётся** (Voximplant иногда
> переименовывает их между версиями SDK) — откройте в редакторе сценариев
> подсказки по `VoiceList.Yandex.` и `ASRProfileList.Yandex.` и поправьте мапу
> `VOICE_MAP` / профиль ASR под актуальные имена.

```javascript
require(Modules.ASR);

// ── Конфиг звонка из Worker (StartScenarios script_custom_data) ──
let D = {};
try { D = JSON.parse(VoxEngine.customData() || "{}"); } catch (e) {}
const LEAD   = D.lead   || {};
const CFG    = D.config || {};
const BASE   = (D.callbackBase || "").replace(/\/+$/, "");
const SECRET = D.secret || "";
const CALLER = D.callerId || "";

// Маппинг голосов панели → голоса Yandex в Voximplant.
// Проверьте актуальные имена в подсказках редактора (VoiceList.Yandex.).
const VOICE_MAP = {
  alena:  VoiceList.Yandex.ru_RU_Alena_Neural,
  jane:   VoiceList.Yandex.ru_RU_Jane_Neural,
  omazh:  VoiceList.Yandex.ru_RU_Omazh_Neural,
  filipp: VoiceList.Yandex.ru_RU_Filipp_Neural,
};
const VOICE = VOICE_MAP[CFG.voice] || VoiceList.Yandex.ru_RU_Alena_Neural;

const MAX_TURNS = 14;        // защита от зацикливания
const SILENCE_MS = 7000;     // нет речи — завершаем
let history = [];            // [{role,content}]
let turns = 0;
let lastIntent = "talking", lastDate = "", ended = false;
let call, asr, silenceTimer;

VoxEngine.addEventListener(AppEvents.Started, function () {
  if (!LEAD.phone || !BASE) { VoxEngine.terminate(); return; }
  call = VoxEngine.callPSTN(LEAD.phone, CALLER);
  call.addEventListener(CallEvents.Connected, onConnected);
  call.addEventListener(CallEvents.Failed, function (e) { finish("failed:" + (e && e.code)); });
  call.addEventListener(CallEvents.Disconnected, function () { finish(lastIntent === "booked" ? "booked" : "ended"); });
});

function onConnected() {
  asr = VoxEngine.createASR({ profile: ASRProfileList.Yandex.ru_RU, singleUtterance: true });
  asr.addEventListener(ASREvents.Result, onSpeech);
  ask("");                   // первая реплика робота (приветствие из промпта)
}

// Спросить «мозг» и проговорить ответ
function ask(clientText) {
  if (ended) return;
  if (clientText) history.push({ role: "user", content: clientText });
  if (++turns > MAX_TURNS) { say("Спасибо, всего доброго!", true); return; }

  const url = BASE + "/api/voice-brain?s=" + encodeURIComponent(SECRET);
  const payload = JSON.stringify({
    config: { prompt: CFG.prompt, goal: CFG.goal, model: CFG.model, maxTokens: CFG.maxTokens },
    history: history
  });
  Net.httpRequestAsync(url, {
    method: "POST",
    postData: payload,
    headers: ["Content-Type: application/json"]
  }).then(function (res) {
    let p = {}; try { p = JSON.parse(res.text || "{}"); } catch (e) {}
    const reply = (p.reply || "Извините, повторите, пожалуйста.").toString();
    lastIntent = p.intent || "talking";
    if (p.date) lastDate = p.date;
    history.push({ role: "assistant", content: reply });
    const finalTurn = (lastIntent === "booked" || lastIntent === "refused");
    say(reply, finalTurn);
  }).catch(function () { say("Извините, плохая связь. Перезвоним позже.", true); });
}

// Синтез реплики; finalTurn=true — после неё прощаемся и кладём трубку
function say(text, finalTurn) {
  if (ended) return;
  const player = VoxEngine.createTTSPlayer(text, { language: VOICE, progressivePlayback: true });
  player.sendMediaTo(call);
  player.addEventListener(PlayerEvents.PlaybackFinished, function () {
    if (finalTurn) { finish(lastIntent === "booked" ? "booked" : (lastIntent === "refused" ? "refused" : "ended")); return; }
    listen();
  });
}

// Слушаем клиента (с таймаутом тишины)
function listen() {
  if (ended) return;
  call.sendMediaTo(asr);
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(function () { say("Если будут вопросы — звоните. Всего доброго!", true); }, SILENCE_MS);
}

function onSpeech(e) {
  clearTimeout(silenceTimer);
  const text = (e && e.text) ? e.text.trim() : "";
  if (!text) { listen(); return; }
  ask(text);
}

// Завершение: положить трубку и отправить итог в Worker
function finish(status) {
  if (ended) return; ended = true;
  clearTimeout(silenceTimer);
  const transcript = history.map(function (m) {
    return (m.role === "assistant" ? "Робот: " : "Клиент: ") + m.content;
  }).join("\n");
  const url = BASE + "/api/voice-result?s=" + encodeURIComponent(SECRET);
  Net.httpRequestAsync(url, {
    method: "POST",
    postData: JSON.stringify({ lead: LEAD, status: status, intent: lastIntent, date: lastDate, transcript: transcript }),
    headers: ["Content-Type: application/json"]
  }).then(terminate).catch(terminate);
}
function terminate() { try { if (call) call.hangup(); } catch (e) {} VoxEngine.terminate(); }
```

## Шаг 6. Боевой запуск

1. Задеплойте Worker с ключами: `cd ~/Documents/KUBRDOM-portal && npm run deploy`
   (или `npx wrangler deploy`).
2. В панели **🎙 Голосовой ИИ**: включите робота, выберите лида (с телефоном из
   подтверждённых на триале) → **«📞 Позвонить»**.
3. Звонок пойдёт; результат (статус, дата просмотра, расшифровка) появится в
   «Результатах звонков» (кнопка 🔄 Обновить).

## Если что-то не так

- Кнопка «Позвонить» → «Voximplant не настроен» — не заданы `VOX_ACCOUNT_ID` /
  `VOX_API_KEY` / `VOX_RULE_ID` (см. Шаг 3).
- Звонок не доходит на триале — номер не в «Verified numbers» (Шаг 4) или нет
  баланса.
- Робот молчит/не понимает — проверьте константы `VOICE_MAP` и
  `ASRProfileList.Yandex.ru_RU` (подсказки в редакторе сценариев), и что
  YandexGPT отвечает (панель → 🧪 Тест диалога).
- Нет результата в панели — проверьте `PUBLIC_BASE_URL` и `WEBHOOK_SECRET`
  (один и тот же секрет у Worker и в `customData`, его сценарий шлёт обратно).

> ИИ-логика и промпт — в Worker (`/api/voice-brain`), здесь только телефония.
> Менять реплики робота — во вкладке «🎙 Голосовой ИИ → Системный промпт».
