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
