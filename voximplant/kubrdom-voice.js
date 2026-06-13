/**
 * KubrDom — голосовой обзвон. Сценарий VoxEngine для Voximplant.
 *
 * КУДА: загрузите этот файл как сценарий в кабинете Voximplant и привяжите к Rule
 * вашего приложения. ID этого правила укажите в Worker как VOX_RULE_ID.
 *
 * ЗАПУСК: Worker (POST /api/voice-call) вызывает Management API StartScenarios с
 *   script_custom_data = JSON.stringify({ lead, config, callerId, callbackBase, secret }).
 *
 * ПОТОК: callPSTN → приветствие (TTS) → цикл [ASR(SpeechKit) → /api/voice-brain
 *   (YandexGPT) → TTS] с перебиванием (barge-in) → по завершении POST /api/voice-result.
 *
 * ⚠️ Вендорные константы (имена голосов/профилей/событий, сигнатура Net.httpRequest)
 *    различаются между версиями VoxEngine — помечены «← сверьте в доках Voximplant».
 *    Прогоните один тестовый звонок и поправьте, если упадёт на инициализации.
 */
require(Modules.ASR);

var DATA = {};
try { DATA = JSON.parse(VoxEngine.customData() || "{}"); } catch (e) { DATA = {}; }
var LEAD = DATA.lead || {};
var CFG = DATA.config || {};
var CB = String(DATA.callbackBase || "").replace(/\/+$/, "");   // база Worker для вебхуков
var SECRET = DATA.secret || "";
var CALLER = DATA.callerId || "";

// Голос Yandex по ключу из панели. ← сверьте имена в VoiceList.Yandex.* в доках Voximplant.
function pickVoice(key) {
  var V = (typeof VoiceList !== "undefined" && VoiceList.Yandex) ? VoiceList.Yandex : {};
  var map = {
    alena: V.Alena_ru_RU, jane: V.Jane_ru_RU, omazh: V.Omazh_ru_RU,
    filipp: V.Filipp_ru_RU, ermil: V.Ermil_ru_RU
  };
  return map[key] || V.Alena_ru_RU || V.Filipp_ru_RU;
}
var TTS_OPTS = { language: pickVoice(CFG.voice), progressivePlayback: true };

var history = [];      // [{role:'assistant'|'user', content}] — для мозга
var transcript = [];   // строки расшифровки для итога
var lastIntent = "talking";
var bookedAt = "";
var call = null, asr = null, player = null, finished = false;

VoxEngine.addEventListener(AppEvents.Started, function () {
  if (!LEAD.phone) { VoxEngine.terminate(); return; }
  call = VoxEngine.callPSTN(LEAD.phone, CALLER || undefined);
  call.addEventListener(CallEvents.Connected, onConnected);
  call.addEventListener(CallEvents.Failed, function (e) { finish("failed:" + (e && e.code)); });
  call.addEventListener(CallEvents.Disconnected, function () { finish(lastIntent === "talking" ? "hangup" : "done"); });
});

function onConnected() {
  // Непрерывное распознавание речи клиента (SpeechKit STT). ← профиль сверьте в доках.
  asr = VoxEngine.createASR({ profile: ASRProfileList.Yandex.ru_RU, singleUtterance: false });
  call.sendMediaTo(asr);
  // Перебивание: клиент заговорил поверх робота → глушим воспроизведение.
  asr.addEventListener(ASREvents.SpeechCaptureStarted, function () { if (player) { try { player.stop(); } catch (e) {} } });
  asr.addEventListener(ASREvents.Result, function (e) {
    var text = ((e && e.text) || "").trim();
    if (!text) return;
    history.push({ role: "user", content: text });
    transcript.push("Клиент: " + text);
    think();
  });
  // Первая реплика робота — без ввода клиента (поздоровается по сценарию).
  history.push({ role: "user", content: "[звонок начался — поздоровайся и начни по сценарию]" });
  think();
}

// Один ход: спрашиваем мозг (YandexGPT через Worker) и произносим ответ.
function think() {
  httpPost(CB + "/api/voice-brain?s=" + encodeURIComponent(SECRET),
    JSON.stringify({ history: history, config: CFG }),
    function (txt) {
      var j = {}; try { j = JSON.parse(txt || "{}"); } catch (e) {}
      var reply = (j && j.reply) || "Извините, не расслышал, повторите, пожалуйста.";
      lastIntent = (j && j.intent) || "talking";
      if (j && j.date) bookedAt = j.date;
      history.push({ role: "assistant", content: reply });
      transcript.push("Робот: " + reply);
      say(reply, lastIntent === "booked" || lastIntent === "refused");
    },
    function () { say("Извините, технические неполадки. Перезвоним вам позже.", true); }
  );
}

function say(text, hangupAfter) {
  player = call.say(text, TTS_OPTS);
  player.addEventListener(PlayerEvents.PlaybackFinished, function () {
    if (hangupAfter) finish(lastIntent);
    // иначе ждём следующую реплику клиента (ASREvents.Result)
  });
}

function finish(status) {
  if (finished) return; finished = true;
  httpPost(CB + "/api/voice-result?s=" + encodeURIComponent(SECRET),
    JSON.stringify({ lead: LEAD, status: status, intent: lastIntent, bookedAt: bookedAt, transcript: transcript.join("\n") }),
    function () { VoxEngine.terminate(); },
    function () { VoxEngine.terminate(); }
  );
}

// Обёртка HTTP: новые версии VoxEngine — Net.httpRequestAsync (Promise); если у вас старая
// с колбэками — поменяйте на Net.httpRequest(url, cb, opts). ← сверьте в доках.
function httpPost(url, body, onOk, onErr) {
  try {
    Net.httpRequestAsync(url, { method: "POST", headers: ["Content-Type: application/json"], postData: body })
      .then(function (res) { onOk((res && res.text) || ""); })
      .catch(function () { onErr(); });
  } catch (e) { onErr(); }
}
