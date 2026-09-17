// Форма sendVideo для видео с объекта.
//
// Без width/height Telegram берёт размер кадра сам, и с телефонными роликами (поворот
// в метаданных, 4K, HEVC) у него не выходит: клиент рисует видео маленьким окошком
// (Telegram на Mac, 2026-09-17). Размер знает браузер — он уже учёл поворот, — поэтому
// клиент шлёт его в query, а мы передаём дальше. supports_streaming даёт смотреть
// ролик, не скачивая целиком: видео с объекта бывают до 50 МБ.

const MAX_SIDE = 16384;          // больше не бывает; мусор в query в Telegram не пускаем
const MAX_DURATION = 24 * 3600;

function positiveInt(raw, max) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 && n <= max ? n : 0;
}

// query → { width, height, duration }; неизвестное = 0 (такое поле не отправляем).
export function videoMetaFromQuery(params) {
  const width = positiveInt(params.get("w"), MAX_SIDE);
  const height = positiveInt(params.get("h"), MAX_SIDE);
  // Размер кадра имеет смысл только парой: одна сторона без другой исказит пропорции.
  const pair = width && height;
  return {
    width: pair ? width : 0,
    height: pair ? height : 0,
    duration: positiveInt(params.get("dur"), MAX_DURATION),
  };
}

export function videoForm({ chatId, topicId, blob, fileName, caption, meta }) {
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("message_thread_id", String(topicId));
  fd.append("video", blob, fileName);
  fd.append("caption", caption);
  fd.append("supports_streaming", "true");
  if (meta.width && meta.height) {
    fd.append("width", String(meta.width));
    fd.append("height", String(meta.height));
  }
  if (meta.duration) fd.append("duration", String(meta.duration));
  return fd;
}
