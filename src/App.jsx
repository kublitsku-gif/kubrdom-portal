import { useState, useEffect } from "react";

// ─── ИМПОРТ ДАШБОРДОВ ────────────────────────────────────────────────────────
// Подключи нужные файлы в своём проекте:
// import BanyaKiev       from "./banya_kiev";
// import DomAlekseya     from "./dom_alekseya";
// import DomFermeraMarat from "./dom_fermera_marat";
//
// Для демо — заглушки (замени на реальные импорты выше)
function BanyaKiev({ storageKey })       { return <Placeholder storageKey={storageKey} name="Баня Олег на Киевке" />; }
function DomAlekseya({ storageKey })     { return <Placeholder storageKey={storageKey} name="Дом Алексея на Дмитрове" />; }
function DomFermeraMarat({ storageKey }) { return <Placeholder storageKey={storageKey} name="Дом фермера Марата" />; }

function Placeholder({ name, storageKey }) {
  const [apiState, setApiState] = useState({ status: "loading", count: 0 });

  useEffect(() => {
    if (!storageKey) return;
    loadState(storageKey)
      .then(data => {
        if (data && Array.isArray(data.items)) {
          setApiState({ status: "ok", count: data.items.length });
        } else {
          setApiState({ status: "empty", count: 0 });
        }
      })
      .catch(() => setApiState({ status: "error", count: 0 }));
  }, [storageKey]);

  const apiMessage =
    apiState.status === "loading" ? "⏳ Загрузка состояния из API..." :
    apiState.status === "ok"      ? `📊 ${apiState.count} работ в API · storage_key: ${storageKey}` :
    apiState.status === "empty"   ? `📭 Пока нет данных · storage_key: ${storageKey}` :
                                    "⚠️ API недоступен, показан локальный кеш";

  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🏗️</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
      <div style={{ marginTop: 8, color: "#888", fontSize: 13 }}>
        Подключи файл дашборда через import
      </div>
      <div style={{
        marginTop: 24, padding: "12px 18px",
        background: "#f0f4f8", border: "1px solid #d0dae8",
        borderRadius: 10, display: "inline-block",
        fontSize: 13, color: "#5a7a9a",
      }}>
        {apiMessage}
      </div>
    </div>
  );
}

// ─── КОНФИГ ОБЪЕКТОВ ─────────────────────────────────────────────────────────
// Реестр всех объектов: storage_key → { name, emoji, component }.
// USERS ссылаются на ключи отсюда, чтобы метаданные жили в одном месте.
const OBJECTS = {
  banya_kiev:        { id: "banya_kiev",        name: "Баня Олег на Киевке",     emoji: "🛁", component: BanyaKiev },
  dom_alekseya:      { id: "dom_alekseya",      name: "Дом Алексея на Дмитрове", emoji: "🏠", component: DomAlekseya },
  dom_fermera_marat: { id: "dom_fermera_marat", name: "Дом фермера Марата",      emoji: "🌾", component: DomFermeraMarat },
};

// ─── РОЛИ ────────────────────────────────────────────────────────────────────
// Пользователь может носить несколько ролей одновременно (см. USERS.roles).
const ROLE_LABELS = {
  worker:    { emoji: "👷",   text: "Рабочий"       },
  brigadier: { emoji: "🧑‍🏭", text: "Бригадир"      },
  supply:    { emoji: "📦",   text: "Снабженец"     },
  admin:     { emoji: "🔑",   text: "Админ"         },
  escort:    { emoji: "🚛",   text: "Сопровождение" },
};

// ─── КОНФИГ ПОЛЬЗОВАТЕЛЕЙ ────────────────────────────────────────────────────
const USERS = [
  { id:"valera",   name:"Валера",    avatar:"👷",   color:"#e67e22", roles:["brigadier"],      objects:["banya_kiev"] },
  { id:"inna",     name:"Инна",      avatar:"👩‍💼", color:"#9b59b6", roles:["brigadier"],      objects:["dom_alekseya","dom_fermera_marat"] },
  { id:"azis",     name:"Азис",      avatar:"🧑‍🔧", color:"#2980b9", roles:["worker"],         objects:["dom_fermera_marat","dom_alekseya"] },
  { id:"yura",     name:"Юрий",      avatar:"Ю",    color:"#c0392b", roles:["admin","supply"], objects:["banya_kiev","dom_alekseya","dom_fermera_marat"] },
  { id:"alexandr", name:"Александр", avatar:"Ал",   color:"#7f8c8d", roles:["escort"],         objects:["banya_kiev","dom_alekseya","dom_fermera_marat"] },
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
    // Админу выбор объекта не нужен — он сразу попадает в админ-панель.
    // Объект всё равно подставляем (первый из списка), чтобы session был валиден.
    if (u?.roles.includes("admin"))      setObjId(u.objects[0] ?? null);
    else if (u?.objects.length === 1)    setObjId(u.objects[0]);
    else                                 setObjId(null);
  }

  function handleEnter() {
    if (!user) return;
    const objKey = user.objects.includes(objId) ? objId : user.objects[0];
    onLogin({ userId: user.id, objId: objKey });
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
          <div style={{ fontSize: 40, fontWeight: 900, color: "#0d1b2e", letterSpacing: -0.5, lineHeight: 1 }}>
            КубрДом
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#3a5a7a", marginTop: 8 }}>
            Производственный портал
          </div>
          <div style={{ fontSize: 13, color: "#5a7a9a", marginTop: 10 }}>
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
                    {u.roles
                      .map(r => ROLE_LABELS[r] ? `${ROLE_LABELS[r].emoji} ${ROLE_LABELS[r].text}` : r)
                      .join(" · ")}
                    {" · "}
                    {u.objects
                      .map(k => OBJECTS[k] ? `${OBJECTS[k].emoji} ${OBJECTS[k].name}` : k)
                      .join("  /  ")}
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

        {/* Шаг 2 — выбор объекта (если > 1 и пользователь не админ) */}
        {user && user.objects.length > 1 && !user.roles.includes("admin") && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "#5a7a9a", fontWeight: 700, letterSpacing: 1, marginBottom: 10, textAlign: "center" }}>
              ВЫБЕРИТЕ ОБЪЕКТ
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {user.objects.map(objKey => {
                const obj = OBJECTS[objKey];
                if (!obj) return null;
                return (
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
                );
              })}
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
          Данные объектов синхронизируются с сервером
        </div>
      </div>
    </div>
  );
}

// ─── ШАПКА ВНУТРИ ДАШБОРДА ───────────────────────────────────────────────────
function DashboardHeader({ user, obj, onLogout, isAdmin, adminMode, onToggleAdmin }) {
  return (
    <div style={{
      background: "linear-gradient(135deg,#fff,#f0f4f8)",
      borderBottom: "1px solid #d0dae8",
      padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 12,
      position: "sticky", top: 0, zIndex: 200,
    }}>
      <span style={{ fontSize: 20 }}>{adminMode ? "🔑" : obj.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0d1b2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {adminMode ? "Админ-панель" : obj.name}
        </div>
        <div style={{ fontSize: 11, color: "#7a9aaa" }}>
          {user.avatar} {user.name} · {user.roles.map(r => ROLE_LABELS[r]?.text ?? r).join(" · ")}
        </div>
      </div>
      {isAdmin && (
        <button onClick={onToggleAdmin}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "6px 12px",
            background: adminMode ? "#c0392b" : "transparent",
            border: `1px solid ${adminMode ? "#c0392b" : "#d0dae8"}`,
            borderRadius: 20, cursor: "pointer",
            fontSize: 11, fontWeight: 600,
            color: adminMode ? "#fff" : "#c0392b",
            transition: "all 0.15s",
          }}>
          {adminMode ? "← Дашборд" : "🔑 Админ"}
        </button>
      )}
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

// ─── АДМИН-ПАНЕЛЬ ────────────────────────────────────────────────────────────
// Видна только пользователям с ролью "admin" (см. USERS.roles).
// Показывает все объекты с количеством работ и кнопкой очистки + список пользователей.
function AdminPanel() {
  // storage_key → { loading, count, error }
  const [objectStats, setObjectStats] = useState({});

  useEffect(() => {
    let cancelled = false;
    Object.keys(OBJECTS).forEach(async (sk) => {
      setObjectStats(s => ({ ...s, [sk]: { loading: true } }));
      const data = await loadState(sk);
      if (cancelled) return;
      setObjectStats(s => ({
        ...s,
        [sk]: {
          loading: false,
          count: data?.items?.length ?? 0,
          error:  !data,
        },
      }));
    });
    return () => { cancelled = true; };
  }, []);

  async function handleClear(storageKey) {
    const obj = OBJECTS[storageKey];
    if (!window.confirm(`Очистить все работы у объекта "${obj.name}"?\nЭто действие необратимо.`)) return;

    setObjectStats(s => ({ ...s, [storageKey]: { ...s[storageKey], loading: true } }));
    const result = await saveState(storageKey, { items: [] });

    if (result.success) {
      setObjectStats(s => ({ ...s, [storageKey]: { loading: false, count: 0 } }));
    } else {
      setObjectStats(s => ({ ...s, [storageKey]: { ...s[storageKey], loading: false } }));
      window.alert(`Не удалось очистить: ${result.error ?? "неизвестная ошибка"}`);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#0d1b2e", marginBottom: 6 }}>
        🔑 Админ-панель
      </div>
      <div style={{ fontSize: 13, color: "#5a7a9a", marginBottom: 24 }}>
        Глобальный обзор объектов и пользователей
      </div>

      {/* Объекты */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, color: "#5a7a9a", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
          ОБЪЕКТЫ ({Object.keys(OBJECTS).length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.values(OBJECTS).map(obj => {
            const stat = objectStats[obj.id] ?? {};
            return (
              <div key={obj.id} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px", background: "#fff",
                border: "1px solid #dde6f0", borderRadius: 12,
              }}>
                <span style={{ fontSize: 24 }}>{obj.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2a3a" }}>
                    {obj.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#7a9aaa", fontFamily: "monospace", marginTop: 2 }}>
                    {obj.id}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#5a7a9a", whiteSpace: "nowrap" }}>
                  {stat.loading        ? "⏳ ..."              :
                   stat.error          ? "⚠️ API недоступен"   :
                   stat.count === 0    ? "📭 0 работ"          :
                                         `📊 ${stat.count} работ`}
                </div>
                <button
                  onClick={() => handleClear(obj.id)}
                  disabled={stat.loading || stat.error}
                  style={{
                    padding: "6px 12px", fontSize: 11, fontWeight: 600,
                    background: stat.loading || stat.error ? "#f0f4f8" : "#fff",
                    border: "1px solid #e08585", color: stat.loading || stat.error ? "#aab8c8" : "#c0392b",
                    borderRadius: 8, cursor: stat.loading || stat.error ? "not-allowed" : "pointer",
                    transition: "all 0.15s",
                  }}>
                  Очистить
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Пользователи */}
      <div>
        <div style={{ fontSize: 11, color: "#5a7a9a", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
          ПОЛЬЗОВАТЕЛИ ({USERS.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {USERS.map(u => (
            <div key={u.id} style={{
              display: "flex", alignItems: "flex-start", gap: 12,
              padding: "12px 14px", background: "#fff",
              border: "1px solid #dde6f0", borderRadius: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                background: u.color, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 700,
              }}>
                {u.avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2a3a" }}>
                  {u.name}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {u.roles.map(r => (
                    <span key={r} style={{
                      fontSize: 11, padding: "2px 8px",
                      background: "#f0f4f8", color: "#3a5a7a",
                      borderRadius: 10, fontWeight: 600,
                    }}>
                      {ROLE_LABELS[r] ? `${ROLE_LABELS[r].emoji} ${ROLE_LABELS[r].text}` : r}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#7a9aaa", marginTop: 6 }}>
                  Доступ: {u.objects.map(k => OBJECTS[k]?.name ?? k).join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ГЛАВНЫЙ КОМПОНЕНТ ────────────────────────────────────────────────────────
export default function Portal() {
  const [session, setSession]     = useState(() => loadSession());
  const [adminMode, setAdminMode] = useState(false);

  function handleLogin({ userId, objId }) {
    const s = { userId, objId };
    setSession(s);
    saveSession(s);
    // Админы сразу попадают в админ-панель, остальные — на дашборд объекта.
    const u = USERS.find(x => x.id === userId);
    setAdminMode(u?.roles.includes("admin") ?? false);
  }

  function handleLogout() {
    setSession(null);
    setAdminMode(false);
    clearSession();
  }

  // Нет сессии → экран входа
  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const user   = USERS.find(u => u.id === session.userId);
  const objKey = user?.objects.includes(session.objId) ? session.objId : undefined;
  const obj    = objKey ? OBJECTS[objKey] : undefined;

  if (!user || !obj) {
    clearSession();
    return <LoginScreen onLogin={handleLogin} />;
  }

  const isAdmin   = user.roles.includes("admin");
  const Dashboard = obj.component;

  return (
    <div style={{ minHeight: "100vh", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <DashboardHeader
        user={user} obj={obj}
        onLogout={handleLogout}
        isAdmin={isAdmin}
        adminMode={adminMode}
        onToggleAdmin={() => setAdminMode(m => !m)}
      />
      {adminMode ? <AdminPanel /> : <Dashboard storageKey={obj.id} />}
    </div>
  );
}
