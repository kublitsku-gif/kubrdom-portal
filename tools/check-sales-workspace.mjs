// Uses existing deployment credentials only against the portal. Never logs credentials or customers.
const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error("Missing deployment credential");
let result;
for (let attempt = 0; attempt < 4; attempt++) {
  const r = await fetch("https://portal.kubrdom.ru/api/ai/workspace/setup", {
    method: "POST",
    headers: { "X-Admin-Token": token },
    signal: AbortSignal.timeout(60000),
  });
  try {
    result = await r.json();
  } catch {
    result = null;
  }
  if (r.ok && result?.success && result.today && result.service) break;
  if (attempt === 3)
    throw new Error(
      "Telegram workspace verification failed (HTTP " + r.status + ")",
    );
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.log(
  "Telegram workspace ready: " +
    result.cards +
    " cards; " +
    result.pending +
    " pending retries; Today and service topics created.",
);
if (result.pending)
  throw new Error("Some cards still need delivery; inspect Worker logs");
