// Картинки планировок для переписки с клиентом: ИИ называет ключ в поле "plans",
// черновик в Telegram показывает картинку, кнопка «Отправить с планировкой» шлёт её в Авито.
// Файлы лежат в public/plans/ и раздаются самим порталом (PUBLIC_BASE_URL/plans/...).
// Дом — рендер SVG с kubrdom.ru, баня — картинки из папки планировок на Яндекс Диске.

export const PLAN_IMAGES = {
  "house-all": { file: "kd29-all.jpg", title: "Все 5 планировок дома 40 футов" },
  "kd29-1": { file: "kd29-1.jpg", title: "КД-29.1 — отдельная спальня" },
  "kd29-2": { file: "kd29-2.jpg", title: "КД-29.2 — открытая студия" },
  "kd29-3": { file: "kd29-3.jpg", title: "КД-29.3 — две спальни" },
  "kd29-4": { file: "kd29-4.jpg", title: "КД-29.4 — спальня и кабинет" },
  "kd29-5": { file: "kd29-5.jpg", title: "КД-29.5 — с прихожей" },
  "banya-5": { file: "banya-5.jpg", title: "Баня 5 м: комната отдыха, душ, парная" },
  "banya-5wc": { file: "banya-5wc.jpg", title: "Баня 5 м: комната отдыха, туалет, душ, парная" },
  "banya-6": { file: "banya-6.jpg", title: "Баня 6 м: комната отдыха, туалет, душ, парная" },
  "banya-8": { file: "banya-8.jpg", title: "Баня 8 м: комната отдыха, туалет, душ, парная" },
  "banya-12": { file: "banya-12.jpg", title: "Баня 12 м: кухня-гостиная, туалет, душ, парная" },
};
// Больше трёх картинок подряд в чате — уже спам; «все планировки дома» — одна общая картинка.
export const MAX_PLANS = 3;

// Ответ модели — внешние данные: оставляем только известные ключи, без повторов.
export function normPlans(v) {
  const arr = Array.isArray(v) ? v : (typeof v === "string" && v ? [v] : []);
  const out = [];
  for (const x of arr) {
    const k = String(x || "").trim().toLowerCase();
    if (PLAN_IMAGES[k] && !out.includes(k)) out.push(k);
  }
  return out.slice(0, MAX_PLANS);
}

export function planUrl(base, key) {
  return String(base || "https://portal.kubrdom.ru").replace(/\/+$/, "") + "/plans/" + PLAN_IMAGES[key].file;
}

export function planTitles(keys) {
  return normPlans(keys).map((k) => PLAN_IMAGES[k].title).join("; ");
}

// Кусок служебной инструкции: какие картинки есть и когда их прикладывать.
export const PLAN_INSTRUCTION =
  " Поле \"plans\" — массив ключей картинок планировок, которые приложить к ответу (пустой [] — без картинки). " +
  "Прикладывай, когда клиент просит планировки или фото плана, выбирает планировку или спрашивает, как устроены помещения. " +
  "Ссылку на планировки в тексте при этом не давай — картинка уйдёт следом. Ключи: " +
  Object.entries(PLAN_IMAGES).map(([k, v]) => k + " (" + v.title + ")").join(", ") +
  ". Все планировки дома — одной картинкой house-all. Не больше " + MAX_PLANS + " ключей.";

// Тело multipart для uploadImages Авито: одно поле uploadfile[] с JPEG.
export function avitoUploadForm(bytes, name) {
  const fd = new FormData();
  fd.append("uploadfile[]", new Blob([bytes], { type: "image/jpeg" }), name || "plan.jpg");
  return fd;
}

// Ответ uploadImages: { "<image_id>": { "1280x960": "url", ... } } → image_id.
export function avitoImageId(resp) {
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) return "";
  const k = Object.keys(resp).find((x) => x && typeof resp[x] === "object" && !/^(error|result)$/i.test(x));
  return k || "";
}
