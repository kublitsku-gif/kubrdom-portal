// ─── СВОЯ КАМЕРА ВНУТРИ СТРАНИЦЫ (Android WebView / Telegram) ──────────────────
// Кнопки «📷 Снять фото» / «🎥 Снять видео» — это <input type=file capture>. Браузер
// по `capture` сразу открывает камеру, но во встроенном браузере Android (WebView) —
// а бригадир открывает портал кнопкой «Портал» в Telegram — атрибут игнорируется:
// Telegram отдаёт выбор файла системе, и вместо камеры открывается галерея. Валера
// снимал камерой телефона и потом выбирал снимок из галереи (2026-09-14).
//
// Поэтому в WebView снимаем сами: getUserMedia → видоискатель на весь экран → кадр
// или запись MediaRecorder. Готовый файл кладём в тот же input и шлём `change` —
// все обработчики загрузки (очередь фото, сжатие, Telegram-зеркало) остаются прежними.
// Камера недоступна (нет разрешения, старый WebView) — показываем причину и кнопку
// «Открыть галерею»: хуже, чем было, не становится никогда.

// Встроенный браузер Android помечает себя «; wv)» в user-agent; Telegram — ещё и своим именем.
export function needsInPageCamera(ua) {
  const s = String(ua || "");
  return /Android/i.test(s) && (/; wv\)/.test(s) || /Telegram-Android/i.test(s));
}

// Что снимать — по accept инпута. Пусто — не наш случай, пусть работает браузер.
export function captureKind(accept) {
  const a = String(accept || "").toLowerCase();
  if (a.indexOf("video/") >= 0) return "video";
  if (a.indexOf("image/") >= 0) return "photo";
  return "";
}

// Telegram принимает видео в mp4/H.264, а не webm (см. compressVideo в admin.js).
// Нет mp4 у MediaRecorder — пишем webm не будем: откатимся на выбор готового файла.
export const VIDEO_MIMES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4"];
export function pickVideoMime(isTypeSupported) {
  if (typeof isTypeSupported !== "function") return "";
  for (const m of VIDEO_MIMES) {
    try { if (isTypeSupported(m)) return m; } catch (e) { /* неизвестный тип — пробуем следующий */ }
  }
  return "";
}

// Лимит загрузки видео — 50 МБ. 2 Мбит/с × 3 мин ≈ 45 МБ со звуком, запись сама встанет.
export const VIDEO_BITRATE = 2000000;
export const VIDEO_MAX_SEC = 180;
export const PHOTO_QUALITY = 0.92;

// Имя как у камеры телефона: по нему в карточке фото видно время съёмки.
export function shotName(kind, date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  return kind === "video" ? "VID_" + stamp + ".mp4" : "IMG_" + stamp + ".jpg";
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// Почему не открылась камера — человеческими словами.
export function cameraErrorText(err) {
  const name = (err && err.name) || "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Нет доступа к камере. Разрешите камеру для Telegram в настройках телефона.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Камера не найдена.";
  if (name === "NotReadableError") return "Камера занята другим приложением.";
  if (name === "NoRecorder") return "Этот телефон не умеет записывать видео внутри Telegram.";
  return "Камера не открылась" + (err && err.message ? ": " + err.message : ".");
}

// ─── DOM ──────────────────────────────────────────────────────────────────────

const BTN = "border:none;border-radius:14px;padding:12px 18px;font-size:15px;font-weight:800;cursor:pointer";

function el(doc, tag, css, text) {
  const n = doc.createElement(tag);
  if (css) n.style.cssText = css;
  if (text) n.textContent = text;
  return n;
}

// Кладём снятый файл в инпут и зовём его обработчик, как будто файл выбрали руками.
export function deliverFile(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// Полноэкранный видоискатель. onFile(file) — снято; onNative() — человек попросил галерею.
export function openInPageCamera(win, { kind, onFile, onNative }) {
  const doc = win.document;
  const nav = win.navigator;
  const root = el(doc, "div", "position:fixed;inset:0;z-index:100000;background:#000;display:flex;flex-direction:column;color:#fff;font-family:inherit");
  const video = el(doc, "video", "flex:1;min-height:0;width:100%;object-fit:contain;background:#000");
  video.setAttribute("playsinline", ""); video.setAttribute("muted", ""); video.muted = true; video.autoplay = true;
  const msg = el(doc, "div", "position:absolute;left:16px;right:16px;top:40%;text-align:center;font-size:15px;line-height:1.4", "Открываю камеру…");
  const clock = el(doc, "div", "position:absolute;top:14px;left:50%;transform:translateX(-50%);background:#e74c3c;border-radius:10px;padding:4px 12px;font-weight:800;font-size:15px;display:none");
  const bar = el(doc, "div", "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px calc(14px + env(safe-area-inset-bottom));background:#000");
  const close = el(doc, "button", BTN + ";background:#333;color:#fff", "✕");
  const shoot = el(doc, "button", "width:72px;height:72px;border-radius:50%;border:5px solid #fff;background:" + (kind === "video" ? "#e74c3c" : "#fff") + ";cursor:pointer;flex-shrink:0;display:none");
  const gallery = el(doc, "button", BTN + ";background:#333;color:#fff", "🖼");
  gallery.title = "Выбрать из памяти";
  bar.append(close, shoot, gallery);
  root.append(video, msg, clock, bar);
  doc.body.appendChild(root);

  let stream = null, rec = null, timer = 0, done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) win.clearInterval(timer);
    try { if (rec && rec.state !== "inactive") rec.stop(); } catch (e) { /* уже встала */ }
    if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* уже встала */ } });
    root.remove();
  };
  const fail = (err) => {
    if (done) return;
    if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* уже встала */ } });
    stream = null;
    shoot.style.display = "none";
    msg.textContent = cameraErrorText(err);
    gallery.textContent = "🖼 Открыть галерею";
  };
  close.onclick = finish;
  gallery.onclick = () => { finish(); onNative(); };

  const mime = kind === "video" ? pickVideoMime(win.MediaRecorder && win.MediaRecorder.isTypeSupported) : "";
  if (kind === "video" && !mime) { fail({ name: "NoRecorder" }); return; }
  if (!nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== "function") { fail({ name: "NotFoundError" }); return; }

  nav.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: kind === "video",
  }).then((s) => {
    if (done) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    video.srcObject = s;
    const p = video.play(); if (p && p.catch) p.catch(() => {});
    msg.textContent = "";
    shoot.style.display = "block";
    shoot.onclick = kind === "video" ? toggleRecord : takePhoto;
  }).catch(fail);

  function takePhoto() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    const c = doc.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(video, 0, 0, w, h);
    shoot.disabled = true;
    c.toBlob((blob) => {
      if (!blob) { shoot.disabled = false; fail(new Error("кадр не сохранился")); return; }
      const file = new win.File([blob], shotName("photo"), { type: "image/jpeg" });
      finish();
      onFile(file);
    }, "image/jpeg", PHOTO_QUALITY);
  }

  function toggleRecord() {
    if (rec) { rec.stop(); return; }
    const chunks = [];
    try {
      rec = new win.MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
    } catch (e) { fail({ name: "NoRecorder" }); return; }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      if (timer) win.clearInterval(timer);
      const blob = new Blob(chunks, { type: "video/mp4" });
      const cancelled = done;
      finish();
      if (!cancelled && blob.size) onFile(new win.File([blob], shotName("video"), { type: "video/mp4" }));
    };
    rec.start(1000);
    const t0 = Date.now();
    shoot.style.borderRadius = "18px";
    clock.style.display = "block";
    clock.textContent = "● " + fmtClock(0);
    gallery.style.visibility = "hidden";
    timer = win.setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      clock.textContent = "● " + fmtClock(sec) + " / " + fmtClock(VIDEO_MAX_SEC);
      if (sec >= VIDEO_MAX_SEC && rec.state === "recording") rec.stop();
    }, 500);
  }
}

// Перехват тапа по кнопке «Снять…». Кнопка — <label> со скрытым <input capture> внутри;
// гасим открытие системного окна и снимаем сами. Галерею по просьбе открываем тем же
// инпутом, пропустив его мимо перехвата.
export function installInPageCamera(win) {
  if (!win || !win.document || !win.navigator || !needsInPageCamera(win.navigator.userAgent)) return false;
  let passThrough = null;
  win.document.addEventListener("click", (ev) => {
    const label = ev.target && ev.target.closest ? ev.target.closest("label") : null;
    const input = label ? label.querySelector("input[type=file][capture]") : null;
    if (!input || input === passThrough) return;
    const kind = captureKind(input.accept);
    if (!kind) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Пока снимали, живой опрос мог перерисовать экран — берём свежий инпут по id.
    const current = () => (input.id && win.document.getElementById(input.id)) || input;
    openInPageCamera(win, {
      kind,
      onFile: (file) => {
        try { deliverFile(current(), file); }
        catch (e) { win.alert("Снимок не удалось передать: " + ((e && e.message) || e)); }
      },
      onNative: () => {
        const inp = current();
        passThrough = inp;
        try { inp.click(); } finally { passThrough = null; }
      },
    });
  }, true);
  return true;
}
