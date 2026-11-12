// 「我的持股」伺服器端測試：node --no-warnings tests/test_positions.mjs（需要 Node 22 的 node:sqlite）
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
const env = {
  DB: { prepare(sql) {
    let args = []; const st = db.prepare(sql);
    const api = { bind(...a) { args = a; return api; },
      first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }),
      run: async () => ({ meta: { changes: st.run(...args).changes } }) };
    return api;
  } },
  ASSETS: { fetch: async () => new Response("x") },
};
const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, "0")).join("");
const t = Math.floor(Date.now() / 1000);
for (const [id, tok] of [[1, "tok1"], [2, "tok2"]]) {
  db.prepare("INSERT INTO keys (id, key_hash, key_hint, label, created_at) VALUES (?,?,?,?,?)").run(id, "h" + id, "0000", "user" + id, t);
  db.prepare("INSERT INTO sessions (key_id, token_hash, started_at, last_seen) VALUES (?,?,?,?)").run(id, await sha(tok), t, t);
}
const call = async (method, tok, body) => {
  const r = await worker.fetch(new Request("https://x/api/positions", { method, headers: { "Content-Type": "application/json", ...(tok ? { Cookie: `tws_s=${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, json: await r.json() };
};
const mode = v => db.prepare("UPDATE settings SET v = ? WHERE k = 'auth_mode'").run(v);

// 開放模式：沒有帳號可綁
assert.equal((await call("GET", "tok1")).status, 404);
mode("key");
assert.equal((await call("GET", null)).status, 401, "沒登入不能讀");
let r = await call("GET", "tok1");
assert.deepEqual([r.status, r.json.version, r.json.data], [200, 0, { open: [], done: [] }]);

const A = { open: [{ c: "2385", n: "群光", m: "twse", sig: "2026-11-09", entry: "2026-11-10", px: 87.8, added: "2026-11-12", evil: "<script>" }], done: [] };
r = await call("PUT", "tok1", { base: 0, data: A });
assert.deepEqual([r.status, r.json.version], [200, 1]);
r = await call("GET", "tok1");
assert.equal(r.json.data.open[0].c, "2385");
assert.equal(r.json.data.open[0].evil, undefined, "多餘欄位要被濾掉");

// 兩台裝置同時改：後到的用舊版本會被擋，並拿到最新資料
r = await call("PUT", "tok1", { base: 0, data: { open: [], done: [] } });
assert.equal(r.status, 409);
assert.equal(r.json.data.open.length, 1, "衝突時要回傳最新資料，不能覆蓋掉");
r = await call("PUT", "tok1", { base: 1, data: { open: [...A.open, { c: "3363", n: "上詮", m: "otc", px: 370 }], done: [] } });
assert.deepEqual([r.status, r.json.version], [200, 2]);

// 帳號隔離：別人看不到
r = await call("GET", "tok2");
assert.deepEqual([r.json.version, r.json.data.open.length], [0, 0]);
// 亂資料
assert.equal((await call("PUT", "tok2", { base: 0, data: "x" })).status, 400);
assert.equal((await call("PUT", "tok2", { base: 0, data: { open: new Array(301).fill({ c: "1" }), done: [] } })).status, 400);
r = await call("PUT", "tok2", { base: 0, data: { open: [{ c: 5, px: "abc", m: "zzz", sig: "亂寫" }, { c: "2330", px: "abc", m: "zzz", sig: "亂寫" }], done: [] } });
assert.equal(r.status, 200);
r = await call("GET", "tok2");
assert.deepEqual(r.json.data.open, [{ c: "2330", n: "", m: "twse", sig: null, entry: null, px: null, added: null }]);
// 登出（session 結束）後不能存取
db.prepare("UPDATE sessions SET ended_at = ?, end_reason = 'logout' WHERE key_id = 1").run(t);
assert.equal((await call("GET", "tok1")).status, 401);
console.log("OK 持股伺服器端：登入保護、帳號隔離、版本衝突、資料清理");
