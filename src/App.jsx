import { useState } from "react";

// ─── ИМПОРТ ДАШБОРДОВ ────────────────────────────────────────────────────────
// Подключи нужные файлы в своём проекте:
// import BanyaKiev       from "./banya_kiev";
// import DomAlekseya     from "./dom_alekseya";
// import DomFermeraMarat from "./dom_fermera_marat";
//
// Для демо — заглушки (замени на реальные импорты выше)
function BanyaKiev()       { return <Placeholder name="Баня Олег на Киевке" />; }
function DomAlekseya()     { return <Placeholder name="Дом Алексея на Дмитрове" />; }
function DomFermeraMarat() { return <Placeholder name="Дом фермера Марата" />; }

function Placeholder({ name }) {
  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🏗️</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
      <div style={{ marginTop: 8, color: "#888", fontSize: 13 }}>
        Подключи файл дашборда через import
      </div>
    </div>
  );
}

// ─── КОНФИГ ПОЛЬЗОВАТЕЛЕЙ И ОБЪЕКТОВ ─────────────────────────────────────────
const USERS = [
  {
    id: "valera",
    name: "Валера",
    avatar: "👷",
    color: "#e67e22",
    role: "worker",
    objects: [
      { id: "banya_kiev", name: "Баня Олег на Киевке", emoji: "🛁", component: BanyaKiev },
    ],
  },
  {
    id: "inna",
    name: "Инна",
    avatar: "👩‍💼",
    color: "#9b59b6",
    role: "supply",
    objects: [
      { id: "dom_alekseya",      name: "Дом Алексея на Дмитрове", emoji: "🏠", component: DomAlekseya },
      { id: "dom_fermera_marat", name: "Дом фермера Марата",       emoji: "🌾", component: DomFermeraMarat },
    ],
  },
  {
    id: "azis",
    name: "Азис",
    avatar: "🧑‍🔧",
    color: "#2980b9",
    role: "worker",
    objects: [
      { id: "dom_fermera_marat", name: "Дом фермера Марата",       emoji: "🌾", component: DomFermeraMarat },
      { id: "dom_alekseya",      name: "Дом Алексея на Дмитрове",  emoji: "🏠", component: DomAlekseya },
    ],
  },
];

const SESSION_KEY = "portal_session_v1";
function loadSession() {
  try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

// ─── API ДЛЯ СОСТОЯНИЯ ОБЪЕКТОВ ──────────────────────────────────────────────
// API-first, с graceful fallback на localStorage если сеть/Worker недоступны.
// Snapshot одной storage_key хранится в localStorage под ключом state_<sk>.
const API_BASE = "https://kubrdom-portal-api.kublitsku.workers.dev";

function cacheKey(sk) {
  return `state_${sk}`;
}

function readCache(sk) {
  try { const r = localStorage.getItem(cacheKey(sk)); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

function writeCache(sk, data) {
  try { localStorage.setItem(cacheKey(sk), JSON.stringify(data)); } catch {}
}

export async function loadState(sk) {
  try {
    const r = await fetch(`${API_BASE}/api/state/${encodeURIComponent(sk)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    writeCache(sk, data);
    return data;
  } catch {
    return readCache(sk);
  }
}

export async function saveState(sk, data) {
  writeCache(sk, data);
  try {
    const r = await fetch(`${API_BASE}/api/state/${encodeURIComponent(sk)}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    return { success: false, error: String(err?.message ?? err), fallback: "localStorage" };
  }
}

// Side-effect: якорим API в граф зависимостей и даём смоук-доступ из DevTools.
// Дашборды позже будут импортировать loadState/saveState напрямую.
if (typeof window !== "undefined") {
  window.kubrdomApi = { loadState, saveState, API_BASE };
}

// ─── ЭКРАН ВХОДА ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [userId, setUserId]   = useState(null);
  const [objId,  setObjId]    = useState(null);

  const user = USERS.find(u => u.id === userId);

  function handleSelectUser(id) {
    setUserId(id);
    const u = USERS.find(u => u.id === id);
    // Если у пользователя только 1 объект — сразу выбираем его
    if (u?.objects.length === 1) setObjId(u.objects[0].id);
    else setObjId(null);
  }

  function handleEnter() {
    if (!user) return;
    const obj = user.objects.find(o => o.id === objId) || user.objects[0];
    onLogin({ userId: user.id, objId: obj.id });
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg,#f0f4f8 0%,#e8eef5 100%)",
      fontFamily: "'Segoe UI',system-ui,sans-serif",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{ maxWidth: 420, width: "100%" }}>

        {/* Заголовок */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 56, marginBottom: 10 }}>🏗️</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#0d1b2e" }}>
            Производственный портал
          </div>
          <div style={{ fontSize: 13, color: "#5a7a9a", marginTop: 6 }}>
            Выберите своё имя для входа
          </div>
        </div>

        {/* Шаг 1 — выбор пользователя */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#5a7a9a", fontWeight: 700, letterSpacing: 1, marginBottom: 12, textAlign: "center" }}>
            КТО ВЫ?
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {USERS.map(u => (
              <button key={u.id} onClick={() => handleSelectUser(u.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 18px", textAlign: "left",
                  background: userId === u.id ? u.color + "18" : "#fff",
                  border: `2px solid ${userId === u.id ? u.color : "#dde6f0"}`,
                  borderRadius: 14, cursor: "pointer", transition: "all 0.2s",
                  boxShadow: userId === u.id ? `0 0 16px ${u.color}22` : "0 1px 4px rgba(0,0,0,0.06)",
                }}>
                <div style={{
                  width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
                  background: userId === u.id ? u.color : u.color + "18",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 26, transition: "all 0.2s",
                }}>
                  {u.avatar}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: userId === u.id ? u.color : "#1a2a3a" }}>
                    {u.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#7a9aaa", marginTop: 3 }}>
                    {u.role === "worker" ? "👷 Рабочий" : u.role === "supply" ? "📦 Снабженец" : "🔑 Админ"}
                    {" · "}
                    {u.objects.map(o => o.emoji + " " + o.name).join("  /  ")}
                  </div>
                </div>
                {userId === u.id && (
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: u.color, display: "flex",
                    alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>✓</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Шаг 2 — выбор объекта (если > 1) */}
        {user && user.objects.length > 1 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "#5a7a9a", fontWeight: 700, letterSpacing: 1, marginBottom: 10, textAlign: "center" }}>
              ВЫБЕРИТЕ ОБЪЕКТ
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {user.objects.map(obj => (
                <button key={obj.id} onClick={() => setObjId(obj.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 16px", textAlign: "left",
                    background: objId === obj.id ? user.color + "15" : "#fff",
                    border: `2px solid ${objId === obj.id ? user.color : "#dde6f0"}`,
                    borderRadius: 12, cursor: "pointer", transition: "all 0.15s",
                  }}>
                  <span style={{ fontSize: 24 }}>{obj.emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: objId === obj.id ? user.color : "#1a2a3a" }}>
                    {obj.name}
                  </span>
                  {objId === obj.id && (
                    <div style={{ marginLeft: "auto", width: 20, height: 20, borderRadius: "50%", background: user.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Кнопка входа */}
        {user && objId && (
          <button onClick={handleEnter}
            style={{
              width: "100%", padding: "15px",
              background: `linear-gradient(135deg, ${user.color}, ${user.color}cc)`,
              border: "none", borderRadius: 14, cursor: "pointer",
              color: "#fff", fontSize: 16, fontWeight: 700,
              boxShadow: `0 4px 20px ${user.color}44`,
              transition: "all 0.2s", marginTop: 4,
            }}>
            Войти как {user.name} →
          </button>
        )}

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: "#a0b4c8" }}>
          Данные каждого объекта хранятся отдельно в браузере
        </div>
      </div>
    </div>
  );
}

// ─── ШАПКА ВНУТРИ ДАШБОРДА ───────────────────────────────────────────────────
function DashboardHeader({ user, obj, onLogout }) {
  return (
    <div style={{
      background: "linear-gradient(135deg,#fff,#f0f4f8)",
      borderBottom: "1px solid #d0dae8",
      padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 12,
      position: "sticky", top: 0, zIndex: 200,
    }}>
      <span style={{ fontSize: 20 }}>{obj.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0d1b2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {obj.name}
        </div>
        <div style={{ fontSize: 11, color: "#7a9aaa" }}>
          {user.avatar} {user.name} · {user.role === "worker" ? "Рабочий" : user.role === "supply" ? "Снабженец" : "Админ"}
        </div>
      </div>
      <button onClick={onLogout}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "6px 12px", background: "transparent",
          border: "1px solid #d0dae8", borderRadius: 20,
          cursor: "pointer", fontSize: 11, color: "#7a9aaa",
          transition: "all 0.15s",
        }}>
        ↩ Выйти
      </button>
    </div>
  );
}

// ─── ГЛАВНЫЙ КОМПОНЕНТ ────────────────────────────────────────────────────────
export default function Portal() {
  const [session, setSession] = useState(() => loadSession());

  function handleLogin({ userId, objId }) {
    const s = { userId, objId };
    setSession(s);
    saveSession(s);
  }

  function handleLogout() {
    setSession(null);
    clearSession();
  }

  // Нет сессии → экран входа
  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const user = USERS.find(u => u.id === session.userId);
  const obj  = user?.objects.find(o => o.id === session.objId);

  if (!user || !obj) {
    clearSession();
    return <LoginScreen onLogin={handleLogin} />;
  }

  const Dashboard = obj.component;

  return (
    <div style={{ minHeight: "100vh", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <DashboardHeader user={user} obj={obj} onLogout={handleLogout} />
      <Dashboard />
    </div>
  );
}
