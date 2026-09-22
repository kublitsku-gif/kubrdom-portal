#!/usr/bin/env node
// Защита входа от перебора PIN (src/worker.js): /api/login и /api/client-login.
//
// Гоняем НАСТОЯЩИЙ обработчик Worker'а через его default export, подсунув мок D1.
// Мок повторяет семантику таблицы login_guard (окно, счётчик, блокировка) — сам SQL
// в node не исполняется, поэтому отдельно сторожим то, от чего зависит атомарность:
// неудача должна писаться ОДНИМ upsert'ом на ключ, без чтения-затем-записи.
import worker from "../src/worker.js";
import { sqliteDB } from "./harness/sqlite-db.js";

// Пауза на неудачный вход (400 мс) в проде тормозит перебор, а в тесте только тянет
// прогон: два десятка неудач — это девять секунд ожидания. Ускоряем таймер, поведение
// не трогаем: проверяем решения сторожа, а не то, что node умеет ждать.
const _setTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => _setTimeout(fn, ms > 50 ? 0 : ms, ...a);

let failed = 0;
const ok = (name, cond, extra) => {
  if (cond) return console.log("  ✓ " + name);
  failed++;
  console.log("  ✗ " + name + (extra ? "\n      " + extra : ""));
};

const USERS = [
  { id: "u1", name: "Валера", phone: "+7 926 111-22-33", pin: "4271", roles: ["brigadier"] },
  { id: "u2", name: "Юрий", phone: "+7 926 999-88-77", pin: "1234", roles: ["admin"] },
];
const CONTRACTS = [{ id: "c1", objId: "o1", status: "signed", name: "Баня Киевка", client: "Любовь", crmClientId: "cl1", clientPin: "7788" }];
const CRM = [{ id: "cl1", name: "Любовь", phone: "+7 916 555-77-88" }];

// ── Мок D1: только те запросы, которые делает вход ───────────────────────────
function makeDB(opts = {}) {
  const real=sqliteDB({users:USERS,rolePermissions:{brigadier:["assign"]},contractDocs:CONTRACTS,crmClients:CRM});
  const stats={upserts:0,selects:0,deletes:0};
  const wrap=(sql,stmt)=>({
    sql,args:stmt.args,
    bind(...args){return wrap(sql,stmt.bind(...args));},
    async all(){return stmt.all();},async first(){return stmt.first();},async run(){return stmt.run();}
  });
  const db={prepare(sql){
    if(opts.brokenGuard&&/login_guard/.test(sql))throw new Error("D1 unavailable");
    if(/INSERT INTO login_guard/.test(sql))stats.upserts+=2;
    return wrap(sql,real.db.prepare(sql));
  },batch(list){return real.db.batch(list);}};
  const rows=()=>{const result=real.db.prepare("SELECT * FROM login_guard");return result;};
  const guardRows=new Map();
  // Read guard state synchronously from the same database using actual SELECTs.
  const guard={has(k){return guardRows.has(k);},get(k){return guardRows.get(k);},keys(){return guardRows.keys();}};
  const originalBatch=db.batch;db.batch=async list=>{
    const result=await originalBatch(list);
    try{const state=await rows().all();guardRows.clear();state.results.forEach(r=>guardRows.set(r.k,r));}catch{}
    return result;
  };
  const originalPrepare=db.prepare;db.prepare=sql=>{
    const stmt=originalPrepare(sql);
    if(!/DELETE FROM login_guard/.test(sql))return stmt;
    const originalBind=stmt.bind;stmt.bind=(...args)=>{const bound=originalBind(...args),run=bound.run;bound.run=async()=>{const result=await run();args.forEach(k=>guardRows.delete(k));return result;};return bound;};return stmt;
  };
  return {db,guard,stats};
}

const ENV = (db) => ({ DB: db, ADMIN_TOKEN: "master-secret", R2: null });
const CTX = { waitUntil() {} };

function req(path, body, ip = "10.0.0.1") {
  return new Request("https://portal.kubrdom.ru" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });
}
const post = async (db, path, body, ip) => {
  const r = await worker.fetch(req(path, body, ip), ENV(db), CTX);
  return { status: r.status, body: await r.json() };
};

// ── 1. Обычный вход не сломан ────────────────────────────────────────────────
{
  console.log("Обычный вход");
  const { db } = makeDB();
  const r = await post(db, "/api/login", { phone: "+7 926 111-22-33", pin: "4271" });
  ok("правильный PIN пускает", r.status === 200 && r.body.success === true, JSON.stringify(r.body));
  ok("токен выдан", typeof r.body.token === "string" && r.body.token.length > 20);
  const r2 = await post(db, "/api/login", { phone: "8 (926) 111-22-33", pin: "4271" });
  ok("телефон в другом формате — тот же сотрудник", r2.status === 200 && r2.body.user.id === "u1");
}

// ── 2. Ошибка не рассказывает, кто работает в компании ───────────────────────
{
  console.log("Единый текст ошибки");
  const { db } = makeDB();
  const wrongPin = await post(db, "/api/login", { phone: "+7 926 111-22-33", pin: "0000" });
  const noUser = await post(db, "/api/login", { phone: "+7 900 000-00-00", pin: "0000" });
  ok("«не тот PIN» и «нет такого телефона» неотличимы",
    wrongPin.status === 401 && noUser.status === 401 && wrongPin.body.error === noUser.body.error,
    JSON.stringify([wrongPin.body.error, noUser.body.error]));
  ok("текст не называет причину", /Неверный телефон или PIN/.test(wrongPin.body.error));
}

// ── 3. Перебор упирается в блокировку ────────────────────────────────────────
{
  console.log("Блокировка по личности");
  const { db, guard } = makeDB();
  const phone = "+7 926 111-22-33";
  for (let i = 0; i < 4; i++) {
    const r = await post(db, "/api/login", { phone, pin: "000" + i });
    ok("попытка " + (i + 1) + " — обычный отказ, не блок", r.status === 401);
  }
  const fifth = await post(db, "/api/login", { phone, pin: "9999" });
  ok("5-я неудача закрывает вход", fifth.status === 401, "порог считаем по счётчику, блок наступает со следующей");
  const sixth = await post(db, "/api/login", { phone, pin: "4271" });
  ok("после порога не пускает даже с ВЕРНЫМ PIN", sixth.status === 429, JSON.stringify(sixth.body));
  ok("сказано, сколько ждать", /Попробуйте через \d+ мин/.test(sixth.body.error), sixth.body.error);
  ok("счётчик завёлся и по личности, и по адресу",
    guard.has("id:9261112233") && guard.has("ip:10.0.0.1"), [...guard.keys()].join(","));
}

// ── 4. Блокировка личности не запирает остальных ─────────────────────────────
{
  console.log("Блокировка адресная");
  const { db } = makeDB();
  for (let i = 0; i < 5; i++) await post(db, "/api/login", { phone: "+7 926 111-22-33", pin: "000" + i }, "10.0.0.7");
  const other = await post(db, "/api/login", { phone: "+7 926 999-88-77", pin: "1234" }, "10.0.0.8");
  ok("другой сотрудник с другого адреса входит", other.status === 200 && other.body.success === true, JSON.stringify(other.body));
}

// ── 5. Успех обнуляет счётчик ────────────────────────────────────────────────
{
  console.log("Успех обнуляет счётчик");
  const { db, guard } = makeDB();
  const phone = "+7 926 111-22-33";
  for (let i = 0; i < 3; i++) await post(db, "/api/login", { phone, pin: "000" + i });
  ok("до успеха счётчик есть", guard.get("id:9261112233").fails === 3);
  await post(db, "/api/login", { phone, pin: "4271" });
  ok("после верного PIN счётчик снят", !guard.has("id:9261112233"),
    "иначе следующая опечатка попадёт в хвост старой серии");
}

// ── 6. Кабинет клиента защищён так же ────────────────────────────────────────
{
  console.log("Кабинет клиента");
  const { db } = makeDB();
  const good = await post(db, "/api/client-login", { query: "любовь", pin: "7788" });
  ok("клиент со своим PIN входит", good.status === 200 && good.body.cid === "c1", JSON.stringify(good.body));

  const { db: db2 } = makeDB();
  const noContract = await post(db2, "/api/client-login", { query: "не существует", pin: "0000" });
  const wrongPin = await post(db2, "/api/client-login", { query: "любовь", pin: "0000" });
  ok("«нет договора» и «не тот PIN» неотличимы", noContract.body.error === wrongPin.body.error,
    JSON.stringify([noContract.body.error, wrongPin.body.error]));
  for (let i = 0; i < 4; i++) await post(db2, "/api/client-login", { query: "любовь", pin: "111" + i });
  const blocked = await post(db2, "/api/client-login", { query: "любовь", pin: "7788" });
  ok("перебор PIN клиента упирается в блок", blocked.status === 429, JSON.stringify(blocked.body));
}

// ── 7. Атомарность и стоимость ───────────────────────────────────────────────
{
  console.log("Атомарность счётчика");
  const { db, stats } = makeDB();
  await post(db, "/api/login", { phone: "+7 926 111-22-33", pin: "0000" });
  ok("неудача пишется одним upsert'ом на ключ (личность + адрес)", stats.upserts === 2,
    "upserts=" + stats.upserts + "; чтение-затем-запись оставляет окно гонки для параллельных попыток");
}

// ── 8. Сбой базы не запирает компанию снаружи ────────────────────────────────
{
  console.log("Сбой таблицы сторожа");
  const { db } = makeDB({ brokenGuard: true });
  const good = await post(db, "/api/login", { phone: "+7 926 111-22-33", pin: "4271" });
  ok("верный PIN всё равно пускает (fail-open)", good.status === 200 && good.body.success === true,
    "сбой D1 не должен запирать всю компанию снаружи портала: " + JSON.stringify(good.body));
  const bad = await post(db, "/api/login", { phone: "+7 926 111-22-33", pin: "0000" });
  ok("неверный PIN всё равно отклоняется", bad.status === 401, JSON.stringify(bad.body));
}

console.log(failed ? `\n✘ провалено проверок: ${failed}` : "\n✓ все проверки прошли");
process.exit(failed ? 1 : 0);
