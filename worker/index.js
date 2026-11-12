/**
 * 台股籌碼追蹤 — Cloudflare Worker
 * - 靜態網站由 ASSETS 提供；/data/* 在「key 模式」下需要有效登入
 * - 一把 key 同一時間只允許一台裝置使用；閒置超過 idle_seconds 才能換裝置
 * - /api/admin/* 用 ADMIN_PASSWORD 保護
 */
const COOKIE = "tws_s";
const now = () => Math.floor(Date.now() / 1000);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith("/api/admin/")) return await admin(req, env, url);
      if (p === "/api/me") return await me(req, env);
      if (p === "/api/login" && req.method === "POST") return await login(req, env);
      if (p === "/api/heartbeat" && req.method === "POST") return await heartbeat(req, env);
      if (p === "/api/logout" && req.method === "POST") return await logout(req, env);
      if (p === "/api/apply" && req.method === "POST") return await apply(req, env);
      if (p.startsWith("/api/")) return json({ error: "not found" }, 404);

      if (p.startsWith("/data/")) {
        const s = await settings(env);
        if (s.auth_mode === "key") {
          const sess = await currentSession(req, env, s);
          if (!sess.ok) return json({ error: "login required", reason: sess.reason }, 401);
          const res = await env.ASSETS.fetch(req);
          const h = new Headers(res.headers);
          h.set("Cache-Control", "private, no-store");
          return new Response(res.body, { status: res.status, headers: h });
        }
      }
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

// ---------- 工具 ----------
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function randToken(n = 32) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function newKey() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混淆的 0/O/1/I
  const b = crypto.getRandomValues(new Uint8Array(12));
  const s = [...b].map(x => A[x % A.length]).join("");
  return `TWS-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
const normKey = k => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// 名稱比對：去頭尾空白、多個空白合一、英文不分大小寫
const normName = n => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();
const cleanName = n => String(n || "").trim().replace(/\s+/g, " ").slice(0, 40);
const pinValid = p => /^\d{4}$/.test(String(p || ""));
const pinHash = (uname, pin) => sha256(`tws|${uname}|${pin}`);
function getCookie(req, name) {
  const c = req.headers.get("Cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
function cookie(val, maxAge) {
  return `${COOKIE}=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function device(req) {
  const ua = req.headers.get("User-Agent") || "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "其他";
  const br = /Line\//.test(ua) ? "LINE" : /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "瀏覽器";
  return `${os} ${br}`;
}
const ipOf = req => req.headers.get("CF-Connecting-IP") || "";
const countryOf = req => (req.cf && req.cf.country) || "";

async function settings(env) {
  const { results } = await env.DB.prepare("SELECT k, v FROM settings").all();
  const s = { auth_mode: "open", idle_seconds: 180 };
  for (const r of results) s[r.k] = r.k === "idle_seconds" ? Number(r.v) : r.v;
  return s;
}
async function logEvent(env, req, keyId, type) {
  await env.DB.prepare("INSERT INTO events (ts, key_id, type, device, ip, country) VALUES (?,?,?,?,?,?)")
    .bind(now(), keyId, type, device(req), ipOf(req), countryOf(req)).run();
}
function keyUsable(k) {
  if (!k) return "invalid";
  if (k.disabled) return "disabled";
  if (k.expires_at && k.expires_at < now()) return "expired";
  return null;
}

// 目前這個瀏覽器的登入狀態
async function currentSession(req, env, s) {
  const tok = getCookie(req, COOKIE);
  if (!tok) return { ok: false, reason: "none" };
  const row = await env.DB.prepare(
    `SELECT s.*, k.label, k.disabled, k.expires_at FROM sessions s JOIN keys k ON k.id = s.key_id WHERE s.token_hash = ?`
  ).bind(await sha256(tok)).first();
  if (!row) return { ok: false, reason: "none" };
  if (row.ended_at) return { ok: false, reason: row.end_reason || "ended" };
  const bad = keyUsable(row);
  if (bad) {
    await env.DB.prepare("UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ?").bind(now(), bad, row.id).run();
    return { ok: false, reason: bad };
  }
  return { ok: true, row };
}

// ---------- 使用者 API ----------
async function me(req, env) {
  const s = await settings(env);
  if (s.auth_mode !== "key") return json({ mode: "open", authed: true });
  const c = await currentSession(req, env, s);
  return json({ mode: "key", authed: c.ok, reason: c.ok ? null : c.reason, label: c.ok ? c.row.label : null, idle: s.idle_seconds });
}

async function login(req, env) {
  const s = await settings(env);
  if (s.auth_mode !== "key") return json({ ok: true, mode: "open" });
  const ip = ipOf(req);
  // 防暴力猜測：同一 IP 10 分鐘內錯 20 次就暫停（手機網路常多人共用 IP，所以放寬一些）
  const fails = await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE type = 'denied_invalid' AND ip = ? AND ts > ?")
    .bind(ip, now() - 600).first();
  if (fails.n >= 20) return json({ ok: false, error: "嘗試次數太多，請 10 分鐘後再試" }, 429);

  const body = await req.json().catch(() => ({}));
  let k;
  if (body.name !== undefined) {
    const uname = normName(body.name);
    k = uname ? await env.DB.prepare("SELECT * FROM keys WHERE username = ?").bind(uname).first() : null;
    if (k) {
      // 同一個帳號 1 小時內密碼錯 10 次就鎖住（管理員重設密碼可解除）
      const since = Math.max(now() - 3600, k.pin_set_at || 0);
      const f = await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE key_id = ? AND type = 'denied_pin' AND ts > ?")
        .bind(k.id, since).first();
      if (f.n >= 10) return json({ ok: false, error: "密碼錯太多次，已暫時鎖住。請 1 小時後再試，或請管理員重設密碼。" }, 429);
      if (!pinValid(body.pin) || (await pinHash(uname, body.pin)) !== k.pin_hash) {
        await logEvent(env, req, k.id, "denied_pin");
        await logEvent(env, req, null, "denied_invalid");  // 也算進 IP 的錯誤次數
        return json({ ok: false, error: "名稱或密碼不正確" }, 403);
      }
    }
  } else {
    k = await env.DB.prepare("SELECT * FROM keys WHERE key_hash = ?").bind(await sha256(normKey(body.key))).first();
  }
  const bad = keyUsable(k);
  if (bad) {
    await logEvent(env, req, k ? k.id : null, bad === "invalid" ? "denied_invalid" : "denied_" + bad);
    const msg = { invalid: body.name !== undefined ? "名稱或密碼不正確" : "Key 不正確",
                  disabled: "此帳號已停用，請聯絡管理員", expired: "此帳號已過期，請聯絡管理員" }[bad];
    return json({ ok: false, error: msg }, 403);
  }

  // 同一個瀏覽器已經用這把 key 登入中 → 直接沿用
  const cur = await currentSession(req, env, s);
  if (cur.ok && cur.row.key_id === k.id) return json({ ok: true, label: k.label });

  const t = now();
  const { results: open } = await env.DB.prepare(
    "SELECT * FROM sessions WHERE key_id = ? AND ended_at IS NULL ORDER BY last_seen DESC").bind(k.id).all();
  // 同一台裝置（相同裝置編號）重新登入：直接接手自己的舊連線
  const devId = String(body.device_id || "").slice(0, 64) || null;
  const busy = open.find(x => t - x.last_seen < s.idle_seconds && !(devId && x.device_id === devId));
  if (busy) {
    await logEvent(env, req, k.id, "denied_busy");
    const wait = s.idle_seconds - (t - busy.last_seen);
    return json({ ok: false, busy: true, error: `此帳號正在其他裝置（${busy.device}）使用中。請先在那台裝置登出，或約 ${Math.ceil(wait / 60)} 分鐘後再試。` }, 409);
  }
  for (const x of open) {
    const same = devId && x.device_id === devId;
    await env.DB.prepare("UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ?").bind(t, same ? "relogin" : "takeover", x.id).run();
  }
  if (open.some(x => !(devId && x.device_id === devId))) await logEvent(env, req, k.id, "takeover");

  const tok = randToken();
  await env.DB.prepare(
    "INSERT INTO sessions (key_id, token_hash, device, ip, country, started_at, last_seen, device_id) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(k.id, await sha256(tok), device(req), ip, countryOf(req), t, t, devId).run();
  await logEvent(env, req, k.id, "login");
  // 勾「記住我」保留 1 年，否則 30 天
  return json({ ok: true, label: k.label }, 200, { "Set-Cookie": cookie(tok, 60 * 60 * 24 * (body.remember ? 365 : 30)) });
}

async function heartbeat(req, env) {
  const s = await settings(env);
  if (s.auth_mode !== "key") return json({ ok: true, mode: "open" });
  const c = await currentSession(req, env, s);
  if (!c.ok) return json({ ok: false, reason: c.reason }, 401);
  await env.DB.prepare("UPDATE sessions SET last_seen = ?, ip = ?, country = ? WHERE id = ?")
    .bind(now(), ipOf(req), countryOf(req), c.row.id).run();
  return json({ ok: true, idle: s.idle_seconds });
}

async function logout(req, env) {
  const tok = getCookie(req, COOKIE);
  if (tok) {
    const row = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ? AND ended_at IS NULL").bind(await sha256(tok)).first();
    if (row) {
      await env.DB.prepare("UPDATE sessions SET ended_at = ?, end_reason = 'logout' WHERE id = ?").bind(now(), row.id).run();
      await logEvent(env, req, row.key_id, "logout");
    }
  }
  return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
}

// 申請 Key：只填名稱（＋選填聯絡方式），進入待審核清單
async function apply(req, env) {
  const ip = ipOf(req);
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM applications WHERE ip = ? AND created_at > ?")
    .bind(ip, now() - 3600).first();
  if (n.n >= 5) return json({ ok: false, error: "申請次數太多，請稍後再試" }, 429);
  const body = await req.json().catch(() => ({}));
  const name = cleanName(body.name), uname = normName(body.name);
  const note = String(body.note || "").trim().slice(0, 100);
  if (!name) return json({ ok: false, error: "請填寫名稱" }, 400);
  if (!pinValid(body.pin)) return json({ ok: false, error: "密碼請設定 4 位數字" }, 400);
  const dup = await env.DB.prepare("SELECT 1 FROM keys WHERE username = ?").bind(uname).first()
    || (await env.DB.prepare("SELECT name FROM applications WHERE status = 'pending'").all()).results.find(a => normName(a.name) === uname);
  if (dup) return json({ ok: false, error: "這個名稱已經有人使用或正在申請，請換一個" }, 409);
  await env.DB.prepare("INSERT INTO applications (name, note, pin_hash, ip, device, country, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(name, note, await pinHash(uname, body.pin), ip, device(req), countryOf(req), now()).run();
  return json({ ok: true });
}

// ---------- 管理 API ----------
function safeEq(a, b) {
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

async function admin(req, env, url) {
  const ip = ipOf(req);
  if (!env.ADMIN_PASSWORD) return json({ error: "尚未設定 ADMIN_PASSWORD" }, 503);
  const fails = await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE type = 'admin_fail' AND ip = ? AND ts > ?")
    .bind(ip, now() - 600).first();
  if (fails.n >= 10) return json({ error: "嘗試次數太多，請 10 分鐘後再試" }, 429);
  if (!safeEq(req.headers.get("X-Admin-Password"), env.ADMIN_PASSWORD)) {
    await logEvent(env, req, null, "admin_fail");
    return json({ error: "管理密碼不正確" }, 401);
  }
  const p = url.pathname.replace("/api/admin", "");
  const s = await settings(env);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (p === "/state" && req.method === "GET") {
    const t = now();
    const { results: keys } = await env.DB.prepare(`
      SELECT k.id, k.key_hint, k.label, k.username, k.created_at, k.expires_at, k.disabled,
        (SELECT COUNT(*) FROM events e WHERE e.key_id = k.id AND e.type = 'denied_pin' AND e.ts > MAX(${now() - 3600}, COALESCE(k.pin_set_at, 0))) AS pin_fails,
        (SELECT MAX(ts) FROM events e WHERE e.key_id = k.id AND e.type = 'login') AS last_login,
        (SELECT COUNT(*) FROM events e WHERE e.key_id = k.id AND e.type = 'login') AS logins
      FROM keys k ORDER BY k.id DESC`).all();
    const { results: sess } = await env.DB.prepare(
      "SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY last_seen DESC").all();
    for (const k of keys) {
      const x = sess.find(z => z.key_id === k.id);
      k.session = x ? { device: x.device, ip: x.ip, country: x.country, started_at: x.started_at, last_seen: x.last_seen,
                        online: t - x.last_seen < s.idle_seconds } : null;
    }
    const { results: events } = await env.DB.prepare(`
      SELECT e.*, k.label, k.key_hint FROM events e LEFT JOIN keys k ON k.id = e.key_id
      WHERE e.type NOT IN ('admin_fail') AND NOT (e.type = 'denied_invalid' AND e.key_id IS NULL AND EXISTS (
        SELECT 1 FROM events d WHERE d.type = 'denied_pin' AND d.ts = e.ts AND d.ip = e.ip))
      ORDER BY e.id DESC LIMIT 300`).all();
    const { results: apps } = await env.DB.prepare(`
      SELECT a.*, k.key_hint FROM applications a LEFT JOIN keys k ON k.id = a.key_id
      ORDER BY (a.status = 'pending') DESC, a.id DESC LIMIT 200`).all();
    return json({ settings: s, now: t, keys, events, apps });
  }

  const makeKey = async (label, days, uname = null, pinH = null) => {
    const key = newKey();  // 內部識別用，使用者不需要知道
    const exp = days > 0 ? now() + days * 86400 : null;
    const r = await env.DB.prepare(
      "INSERT INTO keys (key_hash, key_hint, label, created_at, expires_at, username, pin_hash, pin_set_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(await sha256(normKey(key)), key.slice(-4), String(label || "").slice(0, 60), now(), exp, uname, pinH, pinH ? now() : null).run();
    return { key, id: r.meta.last_row_id };
  };

  // 管理員直接新增使用者（名稱＋4 位數密碼）
  if (p === "/keys" && req.method === "POST") {
    const name = cleanName(body.name || body.label), uname = normName(name);
    if (!name) return json({ error: "請填寫名稱" }, 400);
    const pin = pinValid(body.pin) ? String(body.pin) : String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (await env.DB.prepare("SELECT 1 FROM keys WHERE username = ?").bind(uname).first()) return json({ error: "這個名稱已經存在" }, 409);
    await makeKey(name, Number(body.days) || 0, uname, await pinHash(uname, pin));
    return json({ ok: true, name, pin });
  }

  const ma = p.match(/^\/applications\/(\d+)$/);
  if (ma && req.method === "POST") {
    const id = Number(ma[1]);
    const a = await env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first();
    if (!a) return json({ error: "找不到申請" }, 404);
    if (body.action === "approve") {
      if (a.status === "approved") return json({ error: "已經核發過了" }, 400);
      const days = body.days === undefined ? 365 : Number(body.days) || 0;
      const uname = normName(a.name);
      if (await env.DB.prepare("SELECT 1 FROM keys WHERE username = ?").bind(uname).first()) return json({ error: "已經有同名的使用者" }, 409);
      const { id: keyId } = await makeKey(a.name, days, uname, a.pin_hash);
      if (a.note) await env.DB.prepare("UPDATE keys SET label = ? WHERE id = ?").bind(`${a.name}（${a.note}）`.slice(0, 60), keyId).run();
      await env.DB.prepare("UPDATE applications SET status = 'approved', decided_at = ?, key_id = ? WHERE id = ?")
        .bind(now(), keyId, id).run();
      return json({ ok: true, name: a.name });
    }
    if (body.action === "reject") {
      await env.DB.prepare("UPDATE applications SET status = 'rejected', decided_at = ? WHERE id = ?").bind(now(), id).run();
      return json({ ok: true });
    }
    if (body.action === "delete") {
      await env.DB.prepare("DELETE FROM applications WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  }

  const m = p.match(/^\/keys\/(\d+)$/);
  if (m && req.method === "POST") {
    const id = Number(m[1]);
    const endAll = reason => env.DB.prepare("UPDATE sessions SET ended_at = ?, end_reason = ? WHERE key_id = ? AND ended_at IS NULL")
      .bind(now(), reason, id).run();
    switch (body.action) {
      case "disable": await env.DB.prepare("UPDATE keys SET disabled = 1 WHERE id = ?").bind(id).run(); await endAll("disabled"); break;
      case "enable": await env.DB.prepare("UPDATE keys SET disabled = 0 WHERE id = ?").bind(id).run(); break;
      case "release": await endAll("forced"); await logEvent(env, req, id, "forced"); break;
      case "label": await env.DB.prepare("UPDATE keys SET label = ? WHERE id = ?").bind(String(body.label || "").slice(0, 60), id).run(); break;
      case "reset_pin": {
        const k = await env.DB.prepare("SELECT username FROM keys WHERE id = ?").bind(id).first();
        if (!k || !k.username) return json({ error: "這把 Key 沒有名稱帳號" }, 400);
        const pin = pinValid(body.pin) ? String(body.pin) : String(Math.floor(Math.random() * 10000)).padStart(4, "0");
        await env.DB.prepare("UPDATE keys SET pin_hash = ?, pin_set_at = ? WHERE id = ?").bind(await pinHash(k.username, pin), now(), id).run();
        return json({ ok: true, pin });
      }
      case "expire_at": {  // 指定到期時間（秒）；null = 不過期
        const at = body.expires_at === null ? null : Number(body.expires_at);
        if (at !== null && !(at > 0)) return json({ error: "日期不正確" }, 400);
        await env.DB.prepare("UPDATE keys SET expires_at = ? WHERE id = ?").bind(at, id).run();
        break;
      }
      case "expire": {
        const days = Number(body.days) || 0;
        await env.DB.prepare("UPDATE keys SET expires_at = ? WHERE id = ?").bind(days > 0 ? now() + days * 86400 : null, id).run();
        break;
      }
      case "delete":
        await endAll("deleted");
        await env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(id).run();
        break;
      default: return json({ error: "unknown action" }, 400);
    }
    return json({ ok: true });
  }

  if (p === "/settings" && req.method === "POST") {
    if (body.auth_mode && ["open", "key"].includes(body.auth_mode)) {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('auth_mode', ?)").bind(body.auth_mode).run();
    }
    const idle = Number(body.idle_seconds);
    if (idle >= 60 && idle <= 3600) {
      await env.DB.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('idle_seconds', ?)").bind(String(idle)).run();
    }
    return json({ ok: true, settings: await settings(env) });
  }
  return json({ error: "not found" }, 404);
}
