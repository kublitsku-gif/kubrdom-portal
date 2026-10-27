// Claude (Anthropic Messages API) для нейропродавца: тело запроса и разбор ответа.
// Чистые функции — fetch делает aiChat в worker.js, тест гоняет их без сети.

export const CLAUDE_SELLER_MODEL = "claude-sonnet-5-5";
// Отказ модели по политике сервер сам переигрывает на рекомендованной модели.
export const CLAUDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
// Мышление у Sonnet 5.5 включено всегда и тратит max_tokens наравне с ответом:
// 500 токенов, которых хватало DeepSeek, обрезали бы реплику на полуслове.
const MIN_MAX_TOKENS = 4000;

export function claudeHeaders(key) {
  return {
    "Content-Type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": CLAUDE_FALLBACK_BETA,
  };
}

// messages — OpenAI-формат [{role:"system"|"user"|"assistant", content}].
// temperature не шлём: Sonnet 5.5 отвечает 400 на любое значение, кроме дефолта.
export function claudeBody(messages, opts) {
  opts = opts || {};
  let system = "";
  const msgs = [];
  (messages || []).forEach(function (m) {
    if (m.role === "system") system += (system ? "\n\n" : "") + m.content;
    else msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") });
  });
  // История режется хвостом (последние 12) и может начаться с нашей реплики, а API ждёт первым user.
  while (msgs.length && msgs[0].role === "assistant") msgs.shift();
  return Object.assign(
    {
      model: opts.model || CLAUDE_SELLER_MODEL,
      max_tokens: Math.max(Number(opts.max_tokens) || 0, MIN_MAX_TOKENS),
      // Реплика в чат — не задача на рассуждение: low быстрее и дешевле.
      output_config: { effort: opts.effort || "low" },
      fallbacks: "default",
      messages: msgs,
    },
    system ? { system: system } : {},
  );
}

// Ответ API → текст. Отказ и обрезка — ошибка: пустой черновик в Telegram хуже,
// чем «⚠️ не удалось подготовить ответ», после которого человек отвечает сам.
export function claudeText(j) {
  if (!j || !Array.isArray(j.content)) throw new Error("Claude: неожиданный ответ — " + JSON.stringify(j && (j.error || j)).slice(0, 200));
  if (j.stop_reason === "refusal") throw new Error("Claude отказался отвечать" + (j.stop_details && j.stop_details.category ? " (" + j.stop_details.category + ")" : ""));
  const text = j.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("").trim();
  if (!text) throw new Error("Claude: пустой ответ (stop_reason=" + j.stop_reason + ")");
  return text;
}
