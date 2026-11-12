// 回測當時在瀏覽器裡用的指標算法（原樣搬過來），用來和 scripts/signals.py 比對
const fs = require("fs");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); // [{d,o,h,l,c,F,T,D}]
const R = rows, n = R.length, C = R.map(r => r.c);
const wkey = d => { const t = new Date(d + "T00:00:00Z"); const dow = (t.getUTCDay() + 6) % 7; return new Date(t.getTime() - dow * 86400000).toISOString().slice(0, 10); };
let K = [], D = [], k = 50, d = 50;
for (let i = 0; i < n; i++) { let hi = -1e9, lo = 1e9; for (let j = Math.max(0, i - 8); j <= i; j++) { hi = Math.max(hi, R[j].h); lo = Math.min(lo, R[j].l); } const rsv = hi === lo ? 50 : (C[i] - lo) / (hi - lo) * 100; k = k * 2 / 3 + rsv / 3; d = d * 2 / 3 + k / 3; K.push(k); D.push(d); }
let rsi = new Array(n).fill(50), ag = 0, al = 0;
for (let i = 1; i < n; i++) { const ch = C[i] - C[i - 1]; const g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; } rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
const WK = new Array(n).fill(50); let weeks = []; let kc = 50, dc = 50; let curKey = null, cur = null;
for (let i = 0; i < n; i++) { const wk = wkey(R[i].d);
  if (wk !== curKey) { if (cur) { weeks.push(cur); const arr = weeks.slice(-9); let hi = Math.max(...arr.map(w => w.h)), lo = Math.min(...arr.map(w => w.l)); const rsv = hi === lo ? 50 : (cur.c - lo) / (hi - lo) * 100; kc = kc * 2 / 3 + rsv / 3; dc = dc * 2 / 3 + kc / 3; } curKey = wk; cur = { h: R[i].h, l: R[i].l, c: R[i].c }; }
  else { cur.h = Math.max(cur.h, R[i].h); cur.l = Math.min(cur.l, R[i].l); cur.c = R[i].c; }
  const arr = weeks.slice(-8).concat([cur]); let hi = Math.max(...arr.map(w => w.h)), lo = Math.min(...arr.map(w => w.l)); const rsv = hi === lo ? 50 : (cur.c - lo) / (hi - lo) * 100; WK[i] = kc * 2 / 3 + rsv / 3; }
const sumS = i => { let s = 0; for (let j = i; j >= 0 && j > i - 15 && (R[j].F + R[j].T + R[j].D) > 0; j--) s++; return s; };
console.log(JSON.stringify({ K, D, rsi, WK, streak: R.map((_, i) => sumS(i)) }));
