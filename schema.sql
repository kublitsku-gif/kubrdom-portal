-- Объекты (дашборды). storage_key = ключ, по которому фронт обращается к API.
CREATE TABLE IF NOT EXISTS objects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  storage_key TEXT    NOT NULL UNIQUE
);

-- Состояние работ внутри объекта. data — произвольный JSON-снимок (TEXT в SQLite).
-- Composite PK (storage_key, work_id) даёт бесплатный UPSERT и индекс для GET-запросов.
CREATE TABLE IF NOT EXISTS work_states (
  storage_key TEXT    NOT NULL,
  work_id     TEXT    NOT NULL,
  data        TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (storage_key, work_id)
);

-- Сидируем известные объекты из portal.jsx, чтобы их можно было перечислить через API.
INSERT OR IGNORE INTO objects (name, storage_key) VALUES
  ('Баня Олег на Киевке',     'banya_kiev'),
  ('Дом Алексея на Дмитрове', 'dom_alekseya'),
  ('Дом фермера Марата',      'dom_fermera_marat');

-- История действий (вкладка «🕘 История»). Живёт ОТДЕЛЬНО от снимка admin_panel:
-- снимок ограничен 2 МБ на строку, а лог растёт бесконечно. Пишет только Worker
-- (src/audit.js) — сравнивает пришедший снимок с сохранённым и записывает разницу,
-- автор берётся из подписанного токена, поэтому подделать запись из панели нельзя.
-- Таблица создаётся автоматически при первой записи; этот DDL — для документации
-- и для чистой пересборки базы.
CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,              -- время события (сервер, мс)
  uid      TEXT    NOT NULL,              -- id сотрудника (__master__ — вход по мастер-токену)
  uname    TEXT    NOT NULL DEFAULT '',   -- имя на момент действия
  section  TEXT    NOT NULL,              -- раздел снимка (work_id): objects, estimates, ...
  action   TEXT    NOT NULL,              -- add | edit | del | login | bulk
  title    TEXT    NOT NULL DEFAULT '',   -- «Баня на Киевке › ЭТАП 1 › Обшивка стен»
  field    TEXT    NOT NULL DEFAULT '',   -- какое поле изменено
  old_val  TEXT,                          -- было
  new_val  TEXT,                          -- стало
  sig      TEXT    NOT NULL DEFAULT '',   -- подпись для склейки правок одного поля
  cnt      INTEGER NOT NULL DEFAULT 1     -- сколько правок склеено в эту запись
);
CREATE INDEX IF NOT EXISTS idx_audit_ts  ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_sig ON audit_log(uid, sig, ts DESC);
