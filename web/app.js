/* 台股籌碼追蹤 — 前端（無外部套件） */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const SVGNS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  const state = { market: null, latest: null, stocks: [], stockMap: new Map(), cur: null,
                  range: { ov: 60, in: 20, mg: 60, st: 60, k: 60 } };
  const RANGES = [[20, "20日"], [60, "60日"], [120, "120日"], [0, "全部"]];

  // ---------- 格式 ----------
  const isNum = v => typeof v === "number" && isFinite(v);
  const nf = (v, d = 0) => isNum(v) ? v.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
  const signed = (v, d = 0) => isNum(v) ? (v > 0 ? "+" : "") + nf(v, d) : "—";
  const cls = v => !isNum(v) || v === 0 ? "" : v > 0 ? "up" : "down";
  const yi = v => isNum(v) ? v / 1e8 : null;          // 元 → 億
  const lots = v => isNum(v) ? Math.round(v / 1000) : null; // 股 → 張
  const money = v => {                                 // 元 → 億 / 萬（帶正負號）
    if (!isNum(v)) return "—";
    const a = Math.abs(v);
    return a >= 1e8 ? signed(v / 1e8, 2) + " 億" : signed(v / 1e4, 0) + " 萬";
  };
  const mmdd = d => !d ? "" : d.length === 7 ? d.slice(2).replace("-", "/") : d.slice(5).replace("-", "/");
  const sum = a => a.reduce((s, x) => s + (isNum(x) ? x : 0), 0);
  const sliceRange = (arr, n) => n ? arr.slice(-n) : arr;

  // ---------- 提示框 ----------
  const tip = $("#tip");
  function showTip(x, y, lines) {
    tip.replaceChildren();
    lines.forEach((ln, i) => { const d = el("div", ln.cls || ""); if (i === 0) d.appendChild(el("b", null, ln.text)); else d.textContent = ln.text; tip.appendChild(d); });
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 12, top = y - h - 12;
    if (left + w > innerWidth - 8) left = x - w - 12;
    if (left < 8) left = 8;
    if (top < 8) top = y + 16;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- 圖表 ----------
  const charts = new Map();
  const ro = new ResizeObserver(entries => entries.forEach(e => { const c = charts.get(e.target); if (c) render(e.target, c); }));

  function chart(node, cfg) { if (!charts.has(node)) ro.observe(node); charts.set(node, cfg); render(node, cfg); }

  function niceTicks(min, max, n = 4) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const tickFmt = v => Math.abs(v) >= 1e4 ? nf(v / 1e4, Math.abs(v) >= 1e5 ? 0 : 1) + "萬" : nf(v, Math.abs(v % 1) > 1e-9 ? 1 : 0);

  function render(node, cfg) {
    if (cfg.draw) return cfg.draw(node);
    const { labels, values, type, fmt } = cfg;
    node.replaceChildren();
    const pts = values.map((v, i) => ({ i, v })).filter(p => isNum(p.v));
    if (!pts.length) { node.appendChild(el("div", "nodata", "尚無資料")); return; }
    const W = node.clientWidth || 300, H = node.clientHeight || 170;
    const m = { t: 8, r: 8, b: 20, l: 46 };
    let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
    if (type === "bar") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    (cfg.refs || []).forEach(r => { if (isNum(r.v)) { lo = Math.min(lo, r.v); hi = Math.max(hi, r.v); } });
    const ticks = niceTicks(lo, hi);
    const y0 = type === "bar" ? ticks[0] : Math.min(ticks[0], lo), y1 = ticks[ticks.length - 1];
    const n = values.length, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const X = type === "bar" ? i => m.l + (i + 0.5) * iw / n : i => m.l + (n === 1 ? iw / 2 : i * iw / (n - 1));
    const Y = v => m.t + ih - (v - y0) / (y1 - y0 || 1) * ih;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const ax = svgEl("g", { class: "ax" });
    ticks.forEach(t => {
      ax.appendChild(svgEl("line", { class: t === 0 && type === "bar" ? "zero" : "gl", x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
      const tx = svgEl("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end" }); tx.textContent = tickFmt(t); ax.appendChild(tx);
    });
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 60))));
    for (let i = n - 1; i >= 0; i -= every) {
      const tx = svgEl("text", { x: X(i), y: H - 4, "text-anchor": i === n - 1 ? "end" : "middle" });
      tx.textContent = mmdd(labels[i]); ax.appendChild(tx);
    }
    svg.appendChild(ax);

    const marks = svgEl("g");
    if (type === "bar") {
      const bw = Math.max(1, Math.min(18, iw / n - 2));
      pts.forEach(p => {
        const ya = Y(Math.max(p.v, 0)), yb = Y(Math.min(p.v, 0));
        const h = Math.max(1, yb - ya), r = Math.min(4, bw / 2, h / 2);
        const x = X(p.i) - bw / 2, pos = p.v >= 0;
        // 只把遠離 0 軸的那端做圓角
        const d = pos
          ? `M${x},${yb}V${ya + r}Q${x},${ya} ${x + r},${ya}H${x + bw - r}Q${x + bw},${ya} ${x + bw},${ya + r}V${yb}Z`
          : `M${x},${ya}V${yb - r}Q${x},${yb} ${x + r},${yb}H${x + bw - r}Q${x + bw},${yb} ${x + bw},${yb - r}V${ya}Z`;
        marks.appendChild(svgEl("path", { d, class: "bar " + (pos ? "pos" : "neg"), "data-i": p.i }));
      });
    } else {
      const d = pts.map((p, k) => (k ? "L" : "M") + X(p.i).toFixed(1) + "," + Y(p.v).toFixed(1)).join("");
      const a = d + `L${X(pts[pts.length - 1].i)},${m.t + ih}L${X(pts[0].i)},${m.t + ih}Z`;
      marks.appendChild(svgEl("path", { d: a, class: "area" }));
      marks.appendChild(svgEl("path", { d, class: "ln" }));
      if (pts.length <= 2) pts.forEach(p => marks.appendChild(svgEl("circle", { class: "dot", cx: X(p.i), cy: Y(p.v), r: 4 })));
    }
    (cfg.refs || []).forEach(r => {
      if (!isNum(r.v)) return;
      svg.appendChild(svgEl("line", { class: "ref", x1: m.l, x2: W - m.r, y1: Y(r.v), y2: Y(r.v) }));
      const t = svgEl("text", { class: "ref-l", x: W - m.r - 2, y: Y(r.v) - 4, "text-anchor": "end" });
      t.textContent = r.label; svg.appendChild(t);
    });
    svg.appendChild(marks);

    const hover = svgEl("g", { visibility: "hidden" });
    const xh = svgEl("line", { class: "xh", y1: m.t, y2: m.t + ih });
    const dot = svgEl("circle", { class: "dot", r: 4.5 });
    hover.appendChild(xh); if (type !== "bar") hover.appendChild(dot);
    svg.appendChild(hover);

    const hit = svgEl("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" });
    svg.appendChild(hit);
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      let best = pts[0], bd = Infinity;
      pts.forEach(p => { const dd = Math.abs(X(p.i) - px); if (dd < bd) { bd = dd; best = p; } });
      hover.setAttribute("visibility", "visible");
      xh.setAttribute("x1", X(best.i)); xh.setAttribute("x2", X(best.i));
      dot.setAttribute("cx", X(best.i)); dot.setAttribute("cy", Y(best.v));
      $$(".bar", svg).forEach(b => b.classList.toggle("hi", +b.dataset.i !== best.i && type === "bar"));
      const extra = cfg.tip ? cfg.tip(best.i) : [];
      showTip(ev.clientX, ev.clientY, [{ text: labels[best.i] }, { text: fmt(best.v), cls: type === "bar" ? cls(best.v) : "" }, ...extra]);
    };
    const leave = () => { hover.setAttribute("visibility", "hidden"); $$(".bar", svg).forEach(b => b.classList.remove("hi")); hideTip(); };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
    node.appendChild(svg);
  }

  // ---------- 小元件 ----------
  function tiles(node, list) {
    node.replaceChildren(...list.map(t => {
      const d = el("div", "tile");
      d.appendChild(el("div", "k", t.k));
      d.appendChild(el("div", "v " + (t.vc || ""), t.v));
      if (t.s != null) d.appendChild(el("div", "s " + (t.sc || ""), t.s));
      return d;
    }));
  }
  function table(node, head, rows, onClick) {
    const thead = el("thead"), tr = el("tr");
    head.forEach(h => tr.appendChild(el("th", null, h))); thead.appendChild(tr);
    const tb = el("tbody");
    rows.forEach(r => {
      const row = el("tr");
      r.cells.forEach(c => { const td = el("td", c && c.cls, c && typeof c === "object" ? c.t : c); row.appendChild(td); });
      if (onClick) row.addEventListener("click", () => onClick(r));
      tb.appendChild(row);
    });
    node.replaceChildren(thead, tb);
  }
  function segs() {
    $$(".seg[data-range]").forEach(s => {
      const key = s.dataset.range;
      s.replaceChildren(...RANGES.map(([n, t]) => {
        const b = el("button", state.range[key] === n ? "on" : "", t); b.type = "button";
        b.onclick = () => { state.range[key] = n; segs(); draw(key); };
        return b;
      }));
    });
  }
  const draw = key => ({ ov: drawOverview, in: drawInst, mg: drawMargin, st: drawStockCharts, k: drawK })[key]?.();

  // ---------- 總覽 ----------
  const days = () => state.market?.days || [];
  const lastWith = f => { const d = days(); for (let i = d.length - 1; i >= 0; i--) if (f(d[i])) return d[i]; return null; };
  const ratioOf = d => d && isNum(d.short) && d.fin ? d.short / d.fin * 100 : null;

  function drawOverview() {
    const D = days(), L = D[D.length - 1];
    if (!L) { $("#ov-tiles").replaceChildren(el("div", "empty", "還沒有資料。第一次部署後請到 GitHub Actions 手動執行「回補」。")); return; }
    const I = lastWith(d => d.inst)?.inst || {}, M = lastWith(d => isNum(d.fin_amt)) || {};
    tiles($("#ov-tiles"), [
      { k: "加權指數", v: nf(L.taiex, 2), s: `${signed(L.chg, 2)}（${signed(L.pct, 2)}%）`, sc: cls(L.chg) },
      { k: "成交金額", v: isNum(L.turnover) ? nf(L.turnover / 1e8, 0) + " 億" : "—" },
      { k: "三大法人合計", v: money(I.total), vc: cls(I.total) },
      { k: "外資", v: money(I.foreign), vc: cls(I.foreign) },
      { k: "投信", v: money(I.trust), vc: cls(I.trust) },
      { k: "自營商", v: money(I.dealer), vc: cls(I.dealer) },
      { k: "融資餘額", v: isNum(M.fin_amt) ? nf(M.fin_amt / 1e5, 1) + " 億" : "—",
        s: isNum(M.fin_amt_prev) ? signed((M.fin_amt - M.fin_amt_prev) / 1e5, 1) + " 億" : null, sc: cls(M.fin_amt - M.fin_amt_prev) },
      { k: "券資比", v: isNum(ratioOf(M)) ? nf(ratioOf(M), 2) + "%" : "—",
        s: isNum(M.short) ? `融券 ${nf(M.short)} 張` : null },
    ]);
    const R = sliceRange(D, state.range.ov);
    chart($("#ov-taiex"), { type: "line", labels: R.map(d => d.d), values: R.map(d => d.taiex), fmt: v => nf(v, 2),
      tip: i => [{ text: `漲跌 ${signed(R[i].chg, 2)}（${signed(R[i].pct, 2)}%）`, cls: cls(R[i].chg) }] });
    chart($("#ov-inst"), { type: "bar", labels: R.map(d => d.d), values: R.map(d => yi(d.inst?.total)), fmt: v => signed(v, 2) + " 億" });
  }

  // ---------- 三大法人 ----------
  function drawInst() {
    const D = days().filter(d => d.inst), L = D[D.length - 1];
    if (!L) return;
    const n5 = D.slice(-5), n20 = D.slice(-20);
    tiles($("#in-tiles"), ["foreign", "trust", "dealer", "total"].map((k, j) => ({
      k: ["外資", "投信", "自營商", "合計"][j] + "（" + mmdd(L.d) + "）",
      v: money(L.inst[k]), vc: cls(L.inst[k]),
      s: `5日 ${money(sum(n5.map(d => d.inst[k])))}・20日 ${money(sum(n20.map(d => d.inst[k])))}`,
    })));
    const R = sliceRange(D, state.range.in), lb = R.map(d => d.d), f = v => signed(v, 2) + " 億";
    chart($("#in-foreign"), { type: "bar", labels: lb, values: R.map(d => yi(d.inst.foreign)), fmt: f });
    chart($("#in-trust"), { type: "bar", labels: lb, values: R.map(d => yi(d.inst.trust)), fmt: f });
    chart($("#in-dealer"), { type: "bar", labels: lb, values: R.map(d => yi(d.inst.dealer)), fmt: f });
    const c = v => ({ t: signed(yi(v), 2), cls: cls(v) });
    table($("#in-table"), ["日期", "外資", "投信", "自營商", "合計", "加權指數"],
      D.slice(-60).reverse().map(d => ({ cells: [d.d, c(d.inst.foreign), c(d.inst.trust), c(d.inst.dealer), c(d.inst.total),
        { t: nf(d.taiex, 2), cls: cls(d.chg) }] })));
  }

  // ---------- 融資融券 ----------
  function drawMargin() {
    const D = days().filter(d => isNum(d.fin)), L = D[D.length - 1];
    if (!L) return;
    tiles($("#mg-tiles"), [
      { k: "融資餘額（金額）", v: nf(L.fin_amt / 1e5, 1) + " 億", s: signed((L.fin_amt - L.fin_amt_prev) / 1e5, 2) + " 億", sc: cls(L.fin_amt - L.fin_amt_prev) },
      { k: "融資餘額（張）", v: nf(L.fin), s: signed(L.fin - L.fin_prev) + " 張", sc: cls(L.fin - L.fin_prev) },
      { k: "融券餘額（張）", v: nf(L.short), s: signed(L.short - L.short_prev) + " 張", sc: cls(L.short - L.short_prev) },
      { k: "券資比", v: nf(ratioOf(L), 2) + "%", s: D.length > 1 ? `前日 ${nf(ratioOf(D[D.length - 2]), 2)}%` : null },
    ]);
    const R = sliceRange(D, state.range.mg), lb = R.map(d => d.d);
    chart($("#mg-fin"), { type: "line", labels: lb, values: R.map(d => isNum(d.fin_amt) ? d.fin_amt / 1e5 : null), fmt: v => nf(v, 1) + " 億" });
    chart($("#mg-short"), { type: "line", labels: lb, values: R.map(d => d.short), fmt: v => nf(v) + " 張" });
    chart($("#mg-ratio"), { type: "line", labels: lb, values: R.map(ratioOf), fmt: v => nf(v, 2) + "%" });
    table($("#mg-table"), ["日期", "融資(億)", "增減(億)", "融資(張)", "增減(張)", "融券(張)", "增減(張)", "券資比"],
      D.slice(-60).reverse().map(d => {
        const a = (d.fin_amt - d.fin_amt_prev) / 1e5, b = d.fin - d.fin_prev, s = d.short - d.short_prev;
        return { cells: [d.d, nf(d.fin_amt / 1e5, 1), { t: signed(a, 2), cls: cls(a) }, nf(d.fin), { t: signed(b), cls: cls(b) },
          nf(d.short), { t: signed(s), cls: cls(s) }, nf(ratioOf(d), 2) + "%"] };
      }));
  }

  // ---------- 個股 ----------
  // rows: [日期, 收盤, 漲跌, 成交股數, 外資, 投信, 自營, 合計, 融資餘額, 融資增減, 融券餘額, 融券增減]
  const WKEY = "twchips.watch";
  const getWatch = () => { try { return JSON.parse(localStorage.getItem(WKEY)) || []; } catch { return []; } };
  const setWatch = w => { try { localStorage.setItem(WKEY, JSON.stringify(w)); } catch { /* 無痕模式 */ } };
  function drawWatch() {
    const w = getWatch();
    $("#watch").replaceChildren(...w.map(c => {
      const b = el("button", "chip", `${c} ${state.stockMap.get(c)?.[1] || ""}`); b.type = "button";
      b.onclick = () => openStock(c); return b;
    }));
    if (state.cur) { const on = w.includes(state.cur.c); $("#st-star").classList.toggle("on", on); $("#st-star").textContent = on ? "★ 已自選" : "☆ 自選"; }
  }

  function resolve(q) {
    q = q.trim(); if (!q) return null;
    const code = q.split(/\s+/)[0].toUpperCase();
    if (state.stockMap.has(code)) return code;
    const hit = state.stocks.find(s => s[1] === q) || state.stocks.find(s => s[1].includes(q)) || state.stocks.find(s => s[0].startsWith(code));
    return hit ? hit[0] : code;
  }

  async function openStock(code) {
    if (!code) return;
    location.hash = "stock-" + code;
  }

  async function loadStock(code) {
    $("#q").value = code;
    $("#st-empty").textContent = "載入中…"; $("#st-empty").hidden = false; $("#st-body").hidden = true;
    try {
      state.cur = await getJSON(`data/s/${encodeURIComponent(code)}.json`);
    } catch {
      state.cur = null;
      $("#st-empty").textContent = `找不到「${code}」。上市股票都查得到；上櫃股票只有在自動抓取成功的日子才有資料。`;
      return;
    }
    $("#st-empty").hidden = true; $("#st-body").hidden = false;
    drawStock();
  }

  function drawStock() {
    const S = state.cur, rows = S.rows, L = rows[rows.length - 1];
    $("#st-name").textContent = S.n; $("#st-code").textContent = S.c;
    $("#st-mkt").textContent = S.m === "otc" ? "上櫃" : "上市";
    $("#st-close").textContent = nf(L[1], 2);
    const pct = isNum(L[2]) && isNum(L[1]) && L[1] - L[2] ? L[2] / (L[1] - L[2]) * 100 : null;
    $("#st-chg").textContent = `${signed(L[2], 2)}（${signed(pct, 2)}%）`; $("#st-chg").className = cls(L[2]);
    $("#st-close").className = cls(L[2]);
    $("#st-date").textContent = `資料日期 ${L[0]}`;
    const n5 = rows.slice(-5), n20 = rows.slice(-20);
    const flow = isNum(L[7]) && isNum(L[1]) ? L[7] * L[1] : null;
    const ratio = L[8] ? L[10] / L[8] * 100 : null;
    const lotS = v => isNum(v) ? signed(lots(v)) + " 張" : "—";
    tiles($("#st-tiles"), [
      { k: "三大法人合計", v: lotS(L[7]), vc: cls(L[7]), s: `估算資金 ${money(flow)}`, sc: cls(flow) },
      { k: "外資", v: lotS(L[4]), vc: cls(L[4]) },
      { k: "投信", v: lotS(L[5]), vc: cls(L[5]) },
      { k: "自營商", v: lotS(L[6]), vc: cls(L[6]) },
      { k: "近 5 日法人", v: lotS(sum(n5.map(r => r[7]))), vc: cls(sum(n5.map(r => r[7]))),
        s: `估算 ${money(sum(n5.map(r => isNum(r[7]) && isNum(r[1]) ? r[7] * r[1] : 0)))}` },
      { k: "近 20 日法人", v: lotS(sum(n20.map(r => r[7]))), vc: cls(sum(n20.map(r => r[7]))),
        s: `估算 ${money(sum(n20.map(r => isNum(r[7]) && isNum(r[1]) ? r[7] * r[1] : 0)))}` },
      { k: "融資餘額", v: isNum(L[8]) ? nf(L[8]) + " 張" : "—", s: isNum(L[9]) ? signed(L[9]) + " 張" : null, sc: cls(L[9]) },
      { k: "融券餘額", v: isNum(L[10]) ? nf(L[10]) + " 張" : "—", s: isNum(L[11]) ? signed(L[11]) + " 張" : null, sc: cls(L[11]) },
      { k: "券資比", v: isNum(ratio) ? nf(ratio, 2) + "%" : "—" },
    ]);
    drawValuation(S, L);
    drawK();
    drawStockCharts();
    const c = v => ({ t: isNum(v) ? signed(lots(v)) : "—", cls: cls(v) });
    table($("#st-table"), ["日期", "收盤", "漲跌", "外資", "投信", "自營", "合計", "估算資金", "融資", "資增減", "融券", "券增減"],
      rows.slice(-30).reverse().map(r => ({ cells: [r[0], nf(r[1], 2), { t: signed(r[2], 2), cls: cls(r[2]) }, c(r[4]), c(r[5]), c(r[6]), c(r[7]),
        { t: isNum(r[7]) && isNum(r[1]) ? money(r[7] * r[1]) : "—", cls: cls(r[7]) },
        nf(r[8]), { t: signed(r[9]), cls: cls(r[9]) }, nf(r[10]), { t: signed(r[11]), cls: cls(r[11]) }] })));
    drawWatch();
  }

  // ---------- K 線・技術指標 ----------
  // k: [日期, 開, 高, 低, 收, 成交張數]
  function sma(a, n) { const o = []; let s = 0; a.forEach((v, i) => { s += v; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); }); return o; }
  function ema(a, n) { const o = [], k = 2 / (n + 1); let e = null; a.forEach((v, i) => { e = e === null ? v : v * k + e * (1 - k); o.push(i >= n - 1 ? e : null); }); return o; }
  function rsi(c, n) {  // Wilder 平滑
    const o = [null]; let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up / n; l += dn / n; o.push(i === n ? (l === 0 ? 100 : 100 - 100 / (1 + g / l)) : null); }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); }
    }
    return o;
  }
  function indicators(k) {
    const c = k.map(r => r[4]);
    const e12 = ema(c, 12), e26 = ema(c, 26);
    const dif = c.map((_, i) => e12[i] !== null && e26[i] !== null ? e12[i] - e26[i] : null);
    const difv = dif.filter(v => v !== null), dea0 = ema(difv, 9), off = dif.length - difv.length;
    const dea = dif.map((_, i) => i >= off ? dea0[i - off] : null);
    return { ma5: sma(c, 5), ma20: sma(c, 20), ma60: sma(c, 60), dif, dea,
             osc: dif.map((v, i) => v !== null && dea[i] !== null ? v - dea[i] : null), rsi6: rsi(c, 6), rsi12: rsi(c, 12) };
  }

  function drawK() {
    const node = $("#kchart"), S = state.cur;
    if (!S) return;
    const k = (S.k || []).filter(r => r.slice(1, 5).every(isNum));
    if (k.length < 2) {
      node.replaceChildren(el("div", "nodata", "這檔股票還沒有開高低收資料，之後每天會自動累積。"));
      $("#k-note").textContent = ""; charts.delete(node); return;
    }
    chart(node, { draw: n => renderK(n, k) });
    const enough = k.length >= 35;
    $("#k-note").textContent = `紅K 收盤 ≥ 開盤、綠K 收盤 < 開盤。均線 MA5／MA20／MA60；MACD(12,26,9)，柱狀為 DIF−DEA；RSI 6／12 日，70 以上偏熱、30 以下偏冷。`
      + (enough ? "" : ` 目前只有 ${k.length} 天資料，MACD、長天期均線需要更多天數才會出現。`);
  }

  function renderK(node, K) {
    node.replaceChildren();
    const ind = indicators(K), n0 = state.range.k ? Math.max(0, K.length - state.range.k) : 0;
    const k = K.slice(n0), I = {}; for (const key in ind) I[key] = ind[key].slice(n0);
    const n = k.length, W = node.clientWidth || 340;
    const m = { l: 48, r: 8 }, iw = W - m.l - m.r;
    const P = [  // 各面板：標題列 16px＋圖
      { key: "k", h: 210 }, { key: "v", h: 60 }, { key: "macd", h: 80 }, { key: "rsi", h: 70 }];
    let y = 0; P.forEach(p => { p.top = y + 18; y = p.top + p.h + 8; }); const H = y + 14;
    const X = i => m.l + (i + 0.5) * iw / n, bw = Math.max(1, Math.min(9, iw / n * 0.7));
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img" });
    const add = (e, g = svg) => (g.appendChild(e), e);
    const fin = v => v !== null && v !== undefined && isFinite(v);
    const scale = (p, lo, hi, pad = 0.04) => { const d = (hi - lo) || Math.abs(hi) || 1; lo -= d * pad; hi += d * pad; p.lo = lo; p.hi = hi; p.Y = v => p.top + p.h - (v - lo) / (hi - lo) * p.h; };
    const axis = (p, ticks, f) => ticks.forEach(t => {
      add(svgEl("line", { class: "gl", x1: m.l, x2: W - m.r, y1: p.Y(t), y2: p.Y(t) }));
      const tx = add(svgEl("text", { class: "ax", x: m.l - 5, y: p.Y(t) + 3.5, "text-anchor": "end" })); tx.textContent = f(t);
    });
    const line = (vals, cls, p) => {
      let d = ""; vals.forEach((v, i) => { if (fin(v)) d += (d && fin(vals[i - 1]) ? "L" : "M") + X(i).toFixed(1) + "," + p.Y(v).toFixed(1); });
      if (d) add(svgEl("path", { d, class: cls }));
    };
    const title = (p, t) => { const e = add(svgEl("text", { class: "ptitle", x: m.l, y: p.top - 6 })); e.textContent = t; return e; };
    const pfmt = v => nf(v, v >= 1000 ? 0 : v >= 100 ? 1 : 2);

    // 1) K 線＋均線
    const pk = P[0];
    const lows = k.map(r => r[3]).concat(I.ma5, I.ma20, I.ma60).filter(fin), highs = k.map(r => r[2]).concat(I.ma5, I.ma20, I.ma60).filter(fin);
    scale(pk, Math.min(...lows), Math.max(...highs));
    axis(pk, niceTicks(pk.lo, pk.hi, 4).filter(t => t >= pk.lo && t <= pk.hi), pfmt);
    const gk = add(svgEl("g"));
    k.forEach((r, i) => {
      const [, o, h, l, c] = r, cls = c >= o ? "up" : "dn", x = X(i);
      add(svgEl("line", { class: "wick " + cls, x1: x, x2: x, y1: pk.Y(h), y2: pk.Y(l) }), gk);
      const y1 = pk.Y(Math.max(o, c)), y2 = pk.Y(Math.min(o, c));
      add(svgEl("rect", { class: cls, x: x - bw / 2, y: y1, width: bw, height: Math.max(1, y2 - y1), "data-i": i }), gk);
    });
    line(I.ma5, "l1", pk); line(I.ma20, "l2", pk); line(I.ma60, "l3", pk);
    const tK = title(pk, "");

    // 2) 成交量
    const pv = P[1], vmax = Math.max(...k.map(r => r[5] || 0)) || 1;
    pv.lo = 0; pv.hi = vmax; pv.Y = v => pv.top + pv.h - v / vmax * pv.h;
    add(svgEl("line", { class: "gl", x1: m.l, x2: W - m.r, y1: pv.Y(0), y2: pv.Y(0) }));
    const vt = add(svgEl("text", { class: "ax", x: m.l - 5, y: pv.top + 8, "text-anchor": "end" })); vt.textContent = tickFmt(vmax);
    k.forEach((r, i) => { if (fin(r[5])) add(svgEl("rect", { class: r[4] >= r[1] ? "up" : "dn", x: X(i) - bw / 2, y: pv.Y(r[5]), width: bw, height: Math.max(0.5, pv.Y(0) - pv.Y(r[5])) })); });
    const tV = title(pv, "");

    // 3) MACD
    const pm = P[2], mv = I.dif.concat(I.dea, I.osc).filter(fin);
    const tM = title(pm, "");
    if (mv.length) {
      const a = Math.max(...mv.map(Math.abs)) || 1; scale(pm, -a, a, 0.05);
      add(svgEl("line", { class: "zero", x1: m.l, x2: W - m.r, y1: pm.Y(0), y2: pm.Y(0) }));
      const t2 = add(svgEl("text", { class: "ax", x: m.l - 5, y: pm.top + 8, "text-anchor": "end" })); t2.textContent = nf(a, a >= 10 ? 0 : 2);
      I.osc.forEach((v, i) => { if (fin(v)) { const y0 = pm.Y(0), y1 = pm.Y(v); add(svgEl("rect", { class: v >= 0 ? "up" : "dn", x: X(i) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(0.5, Math.abs(y1 - y0)) })); } });
      line(I.dif, "l1", pm); line(I.dea, "l2", pm);
    } else { pm.Y = () => pm.top + pm.h / 2; const t = add(svgEl("text", { class: "ax", x: m.l + iw / 2, y: pm.top + pm.h / 2, "text-anchor": "middle" })); t.textContent = "資料天數不足"; }

    // 4) RSI
    const pr = P[3]; pr.lo = 0; pr.hi = 100; pr.Y = v => pr.top + pr.h - v / 100 * pr.h;
    [30, 70].forEach(t => { add(svgEl("line", { class: "ref", x1: m.l, x2: W - m.r, y1: pr.Y(t), y2: pr.Y(t) })); const e = add(svgEl("text", { class: "ax", x: m.l - 5, y: pr.Y(t) + 3.5, "text-anchor": "end" })); e.textContent = t; });
    line(I.rsi6, "l1", pr); line(I.rsi12, "l2", pr);
    const tR = title(pr, "");

    // X 軸日期
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
    for (let i = n - 1; i >= 0; i -= every) {
      if (i !== n - 1 && X(n - 1) - X(i) < 62) continue;  // 太靠近最右邊的日期就略過，避免重疊
      const t = add(svgEl("text", { class: "ax", x: X(i), y: H - 2, "text-anchor": i === n - 1 ? "end" : "middle" })); t.textContent = mmdd(k[i][0]);
    }

    // 面板標題＝圖例＋當天數值（色塊對應線條顏色）
    const legend = (tnode, name, items) => {
      tnode.replaceChildren(); const ts = (txt, cls) => { const e = svgEl("tspan", cls ? { class: cls } : {}); e.textContent = txt; tnode.appendChild(e); };
      ts(name + "  ");
      items.forEach(([lab, val, sw]) => { if (sw) ts("■ ", sw); ts(`${lab} ${val}   `, "lg"); });
    };
    const f2 = v => fin(v) ? nf(v, 2) : "—", fp = v => fin(v) ? pfmt(v) : "—";
    function setLegend(i) {
      const r = k[i];
      legend(tK, `K線 ${mmdd(r[0])}`, [["MA5", fp(I.ma5[i]), "sw1"], ["MA20", fp(I.ma20[i]), "sw2"], ["MA60", fp(I.ma60[i]), "sw3"]]);
      legend(tV, "成交量", [["", (fin(r[5]) ? nf(r[5]) : "—") + " 張"]]);
      legend(tM, "MACD", [["DIF", f2(I.dif[i]), "sw1"], ["DEA", f2(I.dea[i]), "sw2"], ["柱", f2(I.osc[i])]]);
      legend(tR, "RSI", [["6日", fin(I.rsi6[i]) ? nf(I.rsi6[i], 1) : "—", "sw1"], ["12日", fin(I.rsi12[i]) ? nf(I.rsi12[i], 1) : "—", "sw2"]]);
    }
    setLegend(n - 1);

    // 十字線＋提示
    const xh = add(svgEl("line", { class: "xh", y1: P[0].top, y2: P[3].top + P[3].h, visibility: "hidden" }));
    const hit = add(svgEl("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" }));
    const move = ev => {
      const b = svg.getBoundingClientRect(), px = (ev.clientX - b.left) * (W / b.width);
      const i = Math.max(0, Math.min(n - 1, Math.floor((px - m.l) / (iw / n))));
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
      setLegend(i);
      const r = k[i], prev = i > 0 ? k[i - 1][4] : (n0 > 0 ? K[n0 - 1][4] : null), chg = isNum(prev) ? (r[4] / prev - 1) * 100 : null;
      showTip(ev.clientX, ev.clientY, [{ text: r[0] }, { text: `開 ${fp(r[1])}　高 ${fp(r[2])}` }, { text: `低 ${fp(r[3])}　收 ${fp(r[4])}` },
        { text: `漲跌 ${isNum(chg) ? signed(chg, 2) + "%" : "—"}`, cls: cls(chg) }, { text: `量 ${fin(r[5]) ? nf(r[5]) : "—"} 張` }]);
    };
    const leave = () => { xh.setAttribute("visibility", "hidden"); setLegend(n - 1); hideTip(); };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move); hit.addEventListener("pointerleave", leave);
    node.appendChild(svg);
  }

  // ---------- 估值 ----------
  function drawValuation(S, L) {
    const v = S.v || {}, close = L[1], e = v.est;
    const pos = x => isNum(x) && x > 0;
    const epsTtm = pos(v.pe) && isNum(close) ? close / v.pe : null;
    // 未來 12 個月預估 EPS：今年剩餘月份用今年預估、其餘用明年預估（台股多為曆年制）
    let fwd = null, fwdNote = "";
    if (e && isNum(e.y0)) {
      const [yy, mm] = L[0].split("-").map(Number);
      if (yy === e.fy) {
        const f = (12 - mm + 1) / 12;
        fwd = isNum(e.y1) ? f * e.y0 + (1 - f) * e.y1 : e.y0;
        fwdNote = isNum(e.y1) ? `${e.fy} 年預估 × ${nf(f * 12)}/12 ＋ ${e.fy + 1} 年預估 × ${nf(12 - f * 12)}/12` : `${e.fy} 年預估`;
      } else if (yy === e.fy + 1 && isNum(e.y1)) { fwd = e.y1; fwdNote = `${e.fy + 1} 年預估`; }
    }
    const fwdPe = pos(fwd) && isNum(close) ? close / fwd : null;
    const est = (y, lo, hi, n) => isNum(y) ? nf(y, 2) + " 元" : "—";
    const estS = (lo, hi, n) => isNum(n) ? `${nf(n)} 位分析師・${nf(lo, 1)}～${nf(hi, 1)}` : null;
    tiles($("#val-tiles"), [
      { k: "本益比（近四季）", v: pos(v.pe) ? nf(v.pe, 2) + " 倍" : (v.pe_why === "loss" ? "虧損" : "無資料"),
        s: isNum(epsTtm) ? `近四季 EPS ${nf(epsTtm, 2)} 元` : null },
      { k: "近 3 年平均本益比", v: isNum(v.avg) ? nf(v.avg, 2) + " 倍" : "—",
        s: isNum(v.min) ? `最低 ${nf(v.min, 1)}・最高 ${nf(v.max, 1)}（${v.n} 個月）` : "歷史資料不足" },
      { k: "前瞻本益比", v: isNum(fwdPe) ? nf(fwdPe, 2) + " 倍" : "—",
        s: isNum(fwd) ? `未來 12 個月預估 EPS ${nf(fwd, 2)} 元${fwd <= 0 ? "（預估虧損）" : ""}` : "沒有分析師追蹤這檔股票" },
      { k: `${e ? e.fy : "今"}年預估 EPS`, v: est(e?.y0), s: e ? estS(e.y0_lo, e.y0_hi, e.y0_n) : null },
      { k: `${e ? e.fy + 1 : "明"}年預估 EPS`, v: est(e?.y1), s: e ? estS(e.y1_lo, e.y1_hi, e.y1_n) : null },
      { k: "殖利率／股價淨值比", v: isNum(v.yld) ? nf(v.yld, 2) + "%" : "—", s: isNum(v.pb) ? `淨值比 ${nf(v.pb, 2)} 倍` : null },
    ]);

    const otc = v.mode === "otc";
    $("#val-hist").hidden = otc;
    $("#val-fair-h").textContent = otc ? "合理價估算（預估 EPS × 目前本益比）" : "合理價估算（EPS × 近 3 年本益比）";
    if (otc) {
      $$("#val-tiles .tile")[1].remove();  // 不顯示 3 年平均本益比
      const fair = pos(fwd) && pos(v.pe) ? fwd * v.pe : null, gap = fair ? (close / fair - 1) * 100 : null;
      table($("#val-table"), ["基準", "預估 EPS", "目前本益比", "合理價", "現價", "現價 vs 合理價"],
        [{ cells: ["未來 12 個月預估 EPS", isNum(fwd) ? nf(fwd, 2) : "—", pos(v.pe) ? nf(v.pe, 2) : "—",
          fair ? nf(fair, 1) : "—", nf(close, 2), { t: isNum(gap) ? signed(gap, 1) + "%" : "—", cls: cls(gap) }] }]);
      const n2 = ["上櫃沒有官方歷史本益比，所以不用 3 年本益比；合理價 = 未來 12 個月預估 EPS × 目前本益比（假設市場維持現在的本益比）。"];
      if (fwdNote) n2.push(`未來 12 個月 EPS = ${fwdNote}。分析師預估來自 Yahoo Finance 共識，更新於 ${e.at}。`);
      else n2.push("這檔沒有分析師預估，無法估算合理價。");
      n2.push("僅供參考，非投資建議。");
      $("#val-note").textContent = n2.join(" ");
      return;
    }
    const rows = [];
    const tag = (p, lo, mid, hi) => p < lo ? "低於便宜價" : p < mid ? "便宜～合理" : p < hi ? "合理～昂貴" : "高於昂貴價";
    [["近四季 EPS", epsTtm], ["未來 12 個月預估 EPS", fwd]].forEach(([name, eps]) => {
      if (!pos(eps) || !isNum(v.avg)) { rows.push({ cells: [name, isNum(eps) ? nf(eps, 2) : "—", "—", "—", "—", "—", "—"] }); return; }
      const lo = eps * v.min, mid = eps * v.avg, hi = eps * v.max, gap = (close / mid - 1) * 100;
      rows.push({ cells: [name, nf(eps, 2), nf(lo, 1), nf(mid, 1), nf(hi, 1),
        { t: signed(gap, 1) + "%", cls: cls(gap) }, { t: tag(close, lo, mid, hi), cls: "pos-tag" }] });
    });
    table($("#val-table"), ["基準", "EPS", "便宜價", "合理價", "昂貴價", "現價 vs 合理價", "位階"], rows);

    const H = v.hist || [];
    chart($("#val-chart"), { type: "line", labels: H.map(h => h[0]), values: H.map(h => h[1]), fmt: x => nf(x, 2) + " 倍",
      refs: isNum(v.avg) ? [{ v: v.avg, label: `平均 ${nf(v.avg, 1)}` }] : [] });

    const notes = [`便宜／合理／昂貴價 = EPS × 近 3 年月底本益比的最低／平均／最高。現價 ${nf(close, 2)}（${L[0]}）。`];
    if (fwdNote) notes.push(`未來 12 個月 EPS = ${fwdNote}。分析師預估來自 Yahoo Finance 共識，更新於 ${e.at}。`);
    if (v.n < 24) notes.push(`本益比歷史目前只有 ${v.n} 個月，平均值參考性較低${S.m === "otc" ? "（上櫃沒有官方歷史本益比，會每天自動累積）" : ""}。`);
    notes.push("僅供參考，非投資建議。");
    $("#val-note").textContent = notes.join(" ");
  }

  function drawStockCharts() {
    if (!state.cur) return;
    const R = sliceRange(state.cur.rows, state.range.st), lb = R.map(r => r[0]);
    chart($("#st-price-c"), { type: "line", labels: lb, values: R.map(r => r[1]), fmt: v => nf(v, 2),
      tip: i => [{ text: `漲跌 ${signed(R[i][2], 2)}`, cls: cls(R[i][2]) }] });
    chart($("#st-inst-c"), { type: "bar", labels: lb, values: R.map(r => lots(r[7])), fmt: v => signed(v) + " 張",
      tip: i => [{ text: `外資 ${signed(lots(R[i][4]))}・投信 ${signed(lots(R[i][5]))}・自營 ${signed(lots(R[i][6]))}` },
                 { text: `估算資金 ${isNum(R[i][7]) && isNum(R[i][1]) ? money(R[i][7] * R[i][1]) : "—"}` }] });
    chart($("#st-fin-c"), { type: "line", labels: lb, values: R.map(r => r[8]), fmt: v => nf(v) + " 張",
      tip: i => [{ text: `增減 ${signed(R[i][9])} 張・融券 ${nf(R[i][10])} 張` }] });
  }

  // ---------- 排行 ----------
  const RANK = {
    inst_buy: ["合計(張)", x => x.tot, "估算金額", x => x.amt], inst_sell: ["合計(張)", x => x.tot, "估算金額", x => x.amt],
    for_buy: ["外資(張)", x => x.for, "估算金額", x => x.for_amt], for_sell: ["外資(張)", x => x.for, "估算金額", x => x.for_amt],
    tru_buy: ["投信(張)", x => x.tru, "估算金額", x => x.tru_amt], tru_sell: ["投信(張)", x => x.tru, "估算金額", x => x.tru_amt],
    fin_up: ["融資增減", x => x.fin_chg, "融資餘額", x => x.fin], fin_down: ["融資增減", x => x.fin_chg, "融資餘額", x => x.fin],
    ratio: ["券資比", x => x.ratio, "融券餘額", x => x.sho],
  };
  function drawRank() {
    const L = state.latest; if (!L || !L.date) return;
    const key = $("#rk-sel").value, [h1, f1, h2, f2] = RANK[key];
    $("#rk-title").textContent = `排行（${L.date}）`;
    const isShares = key.startsWith("inst") || key.startsWith("for") || key.startsWith("tru");
    table($("#rk-table"), ["股票", "收盤", "漲跌", h1, h2],
      (L[key] || []).map(x => ({ code: x.c, cells: [`${x.c} ${x.n}`, nf(x.close, 2), { t: signed(x.chg, 2), cls: cls(x.chg) },
        key === "ratio" ? nf(f1(x), 2) + "%" : { t: signed(isShares ? lots(f1(x)) : f1(x)), cls: cls(f1(x)) },
        isShares ? { t: money(f2(x)), cls: cls(f2(x)) } : nf(f2(x))] })),
      r => openStock(r.code));
  }

  // ---------- 估值排行 ----------
  state.vmkt = "twse";
  function drawValueRank() {
    const V = state.valuation; if (!V) return;
    const optT = $('#vr-sort option[value="gap_t"]');
    optT.hidden = optT.disabled = state.vmkt === "otc";
    if (state.vmkt === "otc" && $("#vr-sort").value === "gap_t") $("#vr-sort").value = "gap_f";
    $('#vr-sort option[value="gap_f"]').textContent = state.vmkt === "otc"
      ? "現價 vs 合理價・預估EPS×目前本益比（低→高）" : "現價 vs 合理價・預估 EPS（低→高）";
    const key = $("#vr-sort").value, rows = (V[state.vmkt] || []).slice();
    const ok = x => isNum(x[key]) && (key.startsWith("gap") || x[key] > 0);
    rows.sort((a, b) => (ok(b) - ok(a)) || (ok(a) ? a[key] - b[key] : b.cap - a.cap));
    const nOk = rows.filter(ok).length;
    $("#vr-title").textContent = `估值排行（${V.date}）`;
    $("#vr-count").textContent = `顯示前 50 名（${rows.length} 檔中有 ${nOk} 檔有數字）`;
    rows.splice(50);
    const gapKey = key === "gap_t" ? "gap_t" : "gap_f", fairKey = gapKey === "gap_t" ? "fair_t" : "fair_f";
    const pe = x => pos(x) ? nf(x, 1) : "—", otc = state.vmkt === "otc";
    const head = ["排名・股票", "收盤", "市值(億)", "目前本益比", "前瞻本益比"];
    if (!otc) head.push("3年均本益比");
    head.push(otc ? "合理價(預估EPS×目前PE)" : gapKey === "gap_t" ? "合理價(近四季)" : "合理價(預估)", "現價 vs 合理價");
    table($("#vr-table"), head,
      rows.map((x, i) => {
        const peCell = pos(x.pe) ? nf(x.pe, 1) : { t: WHY[x.pe_why] || "—", cls: "why" };
        const fpeCell = pos(x.fpe) ? nf(x.fpe, 1) : { t: WHY[x.fpe_why] || "—", cls: "why" };
        const cells = [`${ok(x) ? (i + 1) + ". " : "－ "}${x.c} ${x.n}`, nf(x.close, 2), nf(x.cap), peCell, fpeCell];
        if (!otc) cells.push(isNum(x.avg) ? nf(x.avg, 1) + (x.hist_n < 24 ? "*" : "") : { t: "歷史不足", cls: "why" });
        cells.push(isNum(x[fairKey]) ? nf(x[fairKey], 1) : { t: "無法估算", cls: "why" },
          { t: isNum(x[gapKey]) ? signed(x[gapKey], 1) + "%" : "—", cls: cls(x[gapKey]) });
        return { code: x.c, cells };
      }),
      r => openStock(r.code));
  }
  const pos = x => isNum(x) && x > 0;
  const WHY = { loss: "虧損", na: "無資料", no_est: "無分析師預估", est_loss: "預估虧損" };


  // ---------- 訊號股 ----------
  state.sver = "strict";
  function drawSignals() {
    const S = state.signals;
    const msg = $("#sg-msg"), tbl = $("#sg-table");
    if (!S) { msg.hidden = false; msg.textContent = "載入中…"; tbl.replaceChildren(); return; }
    const st = S.stats, ver = st && st.versions[state.sver], rows = (S[state.sver] || []);
    $("#sg-title").textContent = S.date ? `訊號股（${S.date}）` : "訊號股";
    if (ver) {
      $("#sg-cond").replaceChildren(...ver.cond.map(t => el("li", null, t)));
      $("#sg-entry").textContent = `進場：${st.entry}。範圍：${st.universe}。`;
    }
    if (!S.ready) {
      msg.hidden = false; msg.textContent = S.message || "尚未就緒"; tbl.replaceChildren();
    } else {
      $("#sg-list-h").textContent = `近 ${S.window.length} 個交易日（${mmdd(S.window[0])}～${mmdd(S.window[S.window.length - 1])}）出現訊號的股票・${rows.length} 檔`;
      msg.hidden = rows.length > 0;
      msg.textContent = "近 4 個交易日沒有股票符合這個版本的條件。";
      // 寬鬆版：某天只有個股單獨符合（當天符合檔數 < 5）時，回測表現偏弱（樣本小，僅供觀察）
      const wn = $("#sg-warn") || (() => { const w = el("p", "note"); w.id = "sg-warn"; w.hidden = true; $("#sg-list-h").after(w); return w; })();
      const perDay = {}; rows.forEach(x => x.sig.forEach(d => { perDay[d] = (perDay[d] || 0) + 1; }));
      const lastD = S.window[S.window.length - 1], nLast = perDay[lastD] || 0;
      wn.hidden = !(state.sver === "loose" && rows.length > 0 && nLast >= 1 && nLast < 5);
      wn.textContent = `提醒：最近一天只有 ${nLast} 檔符合寬鬆版，屬個股單獨超跌；回測中這類訊號表現偏弱（樣本小，僅供觀察），建議少買或觀望。部位請控制在總資金上限內。`;
      const when = x => (x.first === x.last ? mmdd(x.first) : `${mmdd(x.first)}～${mmdd(x.last)}`) + (x.today ? "" : "（今日已不符）");
      const sell = x => {
        if (!x.entry) return { t: "明天開盤買進", cls: "why" };
        if (x.exit) return { t: `${x.exit.why === "RSI" ? "RSI 回到 60" : "已賺 10%"}（${mmdd(x.exit.d)}）可賣`, cls: "up" };
        return { t: `持有中・RSI ${nf(x.rsi_now, 1)}`, cls: "why" };
      };
      table(tbl, ["股票", "訊號日", "最新收盤", "K / D", "RSI", "週 K", "5 日跌幅", "法人連買", "外資／投信／自營（張）", "進場（隔日開盤）", "至今報酬", "賣點", "追蹤"],
        rows.map(x => ({ code: x.c, cells: [
          `${x.c} ${x.n}${x.m === "otc" ? "（櫃）" : ""}`, when(x), nf(x.now, 2), `${nf(x.K, 1)} / ${nf(x.D, 1)}`, nf(x.rsi, 1), nf(x.wk, 1),
          { t: signed(x.r5, 1) + "%", cls: cls(x.r5) }, `${x.streak} 天`,
          `${signed(x.F)} / ${signed(x.T)} / ${signed(x.Dl)}`,
          x.entry ? `${mmdd(x.entry.d)}　${nf(x.entry.px, 2)}` : "—",
          x.entry ? { t: signed(x.ret, 1) + "%", cls: cls(x.ret) } : "—", sell(x), ""] })),
        r => openStock(r.code));
      $$("#sg-table tbody tr").forEach((tr, i) => {
        const x = rows[i], held = getPos().open.some(p => p.c === x.c);
        const b = el("button", "btn-s" + (held ? "" : " on"), held ? "已在持股" : "＋我買了"); b.type = "button"; b.disabled = held;
        b.addEventListener("click", e => { e.stopPropagation(); addPos({ c: x.c, n: x.n, m: x.m, sig: x.first, entry: x.entry ? x.entry.d : null, px: x.entry ? x.entry.px : null }); });
        tr.lastElementChild.replaceChildren(b);
      });
    }
    if (!ver) return;
    const ex = ver.exits, rec = ex.find(e => e.exit === "RSI 回到 60") || ex[0];
    $("#sg-stat-h").textContent = `回測成績・${ver.label}`;
    $("#sg-stat-sub").textContent = `${st.period}，${st.universe}。${st.cost}。以下用「${rec.exit}」當賣點。`;
    tiles($("#sg-tiles"), [
      { k: "勝率", v: nf(rec.win, 0) + "%", s: `${nf(rec.n)} 筆交易` },
      { k: "獲利因子", v: nf(rec.pf, 1), s: "賺的總額 ÷ 賠的總額" },
      { k: "平均持有", v: nf(rec.avg_hold) + " 天", s: "交易日" },
      { k: "平均每筆", v: signed(rec.avg_ret, 1) + "%", vc: cls(rec.avg_ret), s: `約每天 ${signed(rec.per_day, 2)}%` },
    ]);
    table($("#sg-stat"), ["賣出方式", "筆數", "勝率", "獲利因子", "平均持有", "平均每筆", "平均每天", "最差單筆", "上市／上櫃勝率"],
      ex.map(e => ({ cells: [{ t: (e.rec ? "★ " : "") + e.exit, cls: e.rec ? "rec" : "" }, nf(e.n), nf(e.win, 0) + "%", nf(e.pf, 1), nf(e.avg_hold) + " 天",
        { t: signed(e.avg_ret, 1) + "%", cls: cls(e.avg_ret) }, signed(e.per_day, 2) + "%", { t: nf(e.worst) + "%", cls: "down" },
        `${nf(e.win_twse)}% ／ ${nf(e.win_otc)}%`] })));
    $("#sg-notes").replaceChildren(...(st.notes || []).map(t => el("p", "note", t)));
  }


  // ---------- 我的持股 ----------
  const POS_KEY = "tw_positions_v1";
  const posState = { data: { open: [], done: [] }, version: 0, server: false, err: "" };
  const okPos = v => v && Array.isArray(v.open) && Array.isArray(v.done);
  function localPos() {
    try { const v = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (okPos(v)) return v; } catch { /* */ }
    return { open: [], done: [] };
  }
  function saveLocal(v) { try { localStorage.setItem(POS_KEY, JSON.stringify(v)); } catch { alert("這個瀏覽器不允許儲存，持股紀錄無法保存。"); } }
  const getPos = () => posState.data;
  // 登入模式：存在伺服器（綁帳號，換裝置也在）；開放模式：只存這個瀏覽器
  async function srv(method, body) {
    const r = await fetch("api/positions", { method, credentials: "same-origin", cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }
  async function loadPos() {
    if (auth.mode !== "key") { posState.server = false; posState.data = localPos(); return drawHold(); }
    try {
      const r = await srv("GET");
      if (r.status !== 200) throw new Error("status " + r.status);
      posState.server = true; posState.err = "";
      posState.version = r.json.version; posState.data = r.json.data;
      const loc = localPos();  // 第一次登入：把這個瀏覽器原本的持股搬上帳號
      if (!posState.data.open.length && !posState.data.done.length && (loc.open.length || loc.done.length)) {
        await mutatePos(() => loc, true);
        try { localStorage.removeItem(POS_KEY); } catch { /* */ }
      }
    } catch { posState.server = false; posState.err = "連不上伺服器，目前顯示的是這個瀏覽器的紀錄。"; posState.data = localPos(); }
    drawHold();
  }
  // fn(目前資料) → 新資料。伺服器版會先取最新、改完再存；別台裝置同時改到時（409）自動重來
  async function mutatePos(fn, quiet) {
    if (!posState.server) { posState.data = fn(JSON.parse(JSON.stringify(posState.data))) || posState.data; saveLocal(posState.data); return; }
    for (let k = 0; k < 4; k++) {
      const next = fn(JSON.parse(JSON.stringify(posState.data))) || posState.data;
      const r = await srv("PUT", { base: posState.version, data: next }).catch(() => ({ status: 0, json: {} }));
      if (r.status === 200) { posState.data = next; posState.version = r.json.version; return; }
      if (r.status === 409) { posState.data = r.json.data; posState.version = r.json.version; continue; }
      if (!quiet) alert("存檔失敗（" + (r.status || "網路") + "），請稍後再試。");
      return;
    }
    if (!quiet) alert("同時有其他裝置在修改，請再按一次。");
  }
  async function addPos(p) {
    await mutatePos(v => { if (!v.open.some(x => x.c === p.c)) v.open.push({ ...p, added: new Date().toISOString().slice(0, 10) }); return v; });
    drawHold(); drawSignals();
  }
  // 成本：買賣各 0.1425% 手續費 + 賣出 0.3% 證交稅（與回測相同）
  const netRet = (px, buy) => (px * (1 - 0.001425 - 0.003) / (buy * 1.001425) - 1) * 100;
  const SELL_RSI = 60, TAKE = 0.10, MAXD = 60;
  function holdInfo(p) {
    const T = state.track;
    if (!T || !T.ready || !T.s || !T.s[p.c]) return { why: "nodata" };
    const [, , cl, op, rs] = T.s[p.c], dates = T.dates, last = dates.length - 1;
    let ei = p.entry ? dates.indexOf(p.entry) : dates.findIndex(d => d > p.sig);
    if (p.entry && ei < 0) ei = p.entry < dates[0] ? 0 : -1;
    if (ei < 0 || ei > last) return { why: "pending" };
    const buy = isNum(p.px) ? p.px : op[ei];
    if (!isNum(buy)) return { why: "pending" };
    let now = last; while (now > ei && !isNum(cl[now])) now--;
    let hit = null;
    for (let s = ei + 1; s <= now; s++) {
      if (isNum(rs[s]) && rs[s] >= SELL_RSI) { hit = { why: "RSI", d: dates[s] }; break; }
      if (isNum(cl[s]) && cl[s] / buy - 1 >= TAKE) { hit = { why: "TP", d: dates[s] }; break; }
    }
    const days = now - ei + 1;
    return { buy, ei, entry: dates[ei], now: cl[now], nowDate: dates[now], ret: netRet(cl[now], buy), rsi: rs[now], toTp: (buy * (1 + TAKE) / cl[now] - 1) * 100,
             days, hit, hitToday: !!hit && hit.d === dates[now], full: days >= MAXD };
  }
  function holdStatus(p, h) {
    if (h.why === "nodata") return { t: "資料不足，暫時無法判斷", cls: "why", alert: false };
    if (h.why === "pending") return { t: "等明天開盤買進後開始計算（進場價以你實際買進的為準，可在右邊「改進場價」修改）", cls: "why", alert: false };
    const why = h.hit && (h.hit.why === "RSI" ? `RSI 回到 ${SELL_RSI}` : "已賺 10%");
    if (h.hitToday) return { t: `🔔 今天收盤出現賣出訊號（${why}）→ 明天開盤賣`, cls: "up", alert: true };
    if (h.hit) return { t: `⚠ ${mmdd(h.hit.d)} 已出現賣出訊號（${why}），還沒賣的話建議儘快處理`, cls: "up", alert: true };
    if (h.full) return { t: `⏰ 已持有滿 ${MAXD} 個交易日（回測上限），建議出場`, cls: "up", alert: true };
    return { t: `等待賣出訊號・RSI ${nf(h.rsi, 1)}（≥ ${SELL_RSI} 賣）・距停利還差 ${signed(h.toTp, 1)}%`, cls: "", alert: false };
  }
  function drawHold() {
    const v = getPos(), T = state.track;
    $("#hd-title").textContent = T && T.date ? `我的持股（資料日 ${T.date}）` : "我的持股";
    $("#hd-empty").hidden = v.open.length > 0;
    $("#hd-where").textContent = posState.err || (posState.server ? "持股存在你的帳號裡，換手機或電腦登入後都會同步。" : "目前網站是開放模式，持股只存在這個瀏覽器；改成登入制後會自動搬到帳號。");
    const infos = v.open.map(p => { const h = holdInfo(p); return { p, h, st: holdStatus(p, h) }; });
    const alerts = infos.filter(x => x.st.alert);
    $("#hd-badge").hidden = !alerts.length; $("#hd-badge").textContent = alerts.length;
    document.title = (alerts.length ? `(${alerts.length}) ` : "") + "台股-脫離社畜研究社";
    const box = $("#hd-alert");
    box.hidden = !alerts.length;
    if (alerts.length) box.textContent = "出現賣出訊號：" + alerts.map(x => `${x.p.c} ${x.p.n || ""}`).join("、");
    const btn = (txt, fn) => { const b = el("button", "btn-s", txt); b.type = "button"; b.addEventListener("click", e => { e.stopPropagation(); fn(); }); return b; };
    table($("#hd-table"), ["股票", "買進", "持有", "最新收盤", "至今報酬", "狀態", "操作"],
      infos.map(({ p, h, st }) => ({ code: p.c, cells: [
        `${p.c} ${p.n || ""}${p.m === "otc" ? "（櫃）" : ""}`,
        h.buy ? `${mmdd(h.entry)}　${nf(h.buy, 2)}` : (p.entry ? `${mmdd(p.entry)}　${nf(p.px, 2)}` : `訊號 ${mmdd(p.sig)}`),
        h.days ? `${h.days} 天` : "—", h.now ? nf(h.now, 2) : "—", h.now ? { t: signed(h.ret, 1) + "%", cls: cls(h.ret) } : "—",
        { t: st.t, cls: "sell " + st.cls }, ""] })),
      r => openStock(r.code));
    $$("#hd-table tbody tr").forEach((tr, i) => {
      const { p, h } = infos[i], td = tr.lastElementChild;
      td.replaceChildren(
        btn("已賣出", () => {
          const def = h.now || "";
          const s = prompt(`${p.c} ${p.n || ""} 的實際賣出價（元）？`, def);
          const px = parseFloat(s); if (!isFinite(px) || px <= 0) return;
          const buy = h.buy || parseFloat(p.px), d = { c: p.c, n: p.n, m: p.m, entry: h.entry || p.entry, buy, sold: new Date().toISOString().slice(0, 10), sell: px, ret: isFinite(buy) ? netRet(px, buy) : null, days: h.days || null };
          mutatePos(cur => { const k = cur.open.findIndex(x => x.c === p.c); if (k < 0) return cur; cur.open.splice(k, 1); cur.done.unshift(d); return cur; }).then(() => { drawHold(); drawSignals(); });
        }),
        btn("改進場價", () => {
          const s = prompt(`${p.c} 的實際買進價（元）？`, h.buy || p.px || ""); const px = parseFloat(s);
          if (!isFinite(px) || px <= 0) return;
          mutatePos(cur => { const q = cur.open.find(x => x.c === p.c); if (q) q.px = px; return cur; }).then(drawHold);
        }),
        btn("刪除", () => {
          if (!confirm(`刪除 ${p.c} ${p.n || ""} 的紀錄？（不會記入已賣出紀錄）`)) return;
          mutatePos(cur => { cur.open = cur.open.filter(x => x.c !== p.c); return cur; }).then(() => { drawHold(); drawSignals(); });
        }));
    });
    table($("#hd-done"), ["股票", "買進", "賣出", "持有", "報酬"],
      v.done.map(d => ({ code: d.c, cells: [`${d.c} ${d.n || ""}`, `${d.entry ? mmdd(d.entry) : "—"}　${nf(d.buy, 2)}`, `${mmdd(d.sold)}　${nf(d.sell, 2)}`,
        d.days ? `${d.days} 天` : "—", isNum(d.ret) ? { t: signed(d.ret, 1) + "%", cls: cls(d.ret) } : "—"] })),
      r => openStock(r.code));
  }

  // ---------- 路由 ----------
  function route() {
    const h = location.hash.slice(1) || "overview";
    const [tab, code] = h.startsWith("stock-") ? ["stock", h.slice(6)] : [h, null];
    const name = ["overview", "inst", "margin", "stock", "rank", "value", "signal", "hold"].includes(tab) ? tab : "overview";
    $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + name));
    $$("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === name));
    if (name === "stock") {
      if (code && code !== state.cur?.c) loadStock(code);
      else if (!code && state.cur) history.replaceState(null, "", "#stock-" + state.cur.c);
    }
    // 切換分頁後重畫，確保圖表寬度正確
    requestAnimationFrame(() => charts.forEach((cfg, node) => node.offsetParent && render(node, cfg)));
    hideTip();
  }

  // ---------- 登入（key 模式才會啟用；GitHub Pages 或開放模式下不影響） ----------
  const auth = { mode: "open", timer: null };
  const REASON = { takeover: "這個帳號已在其他裝置登入，你已被登出。", forced: "管理員已將你登出。",
    disabled: "此帳號已停用。", expired: "此帳號已過期，請聯絡管理員。", deleted: "此帳號已被刪除。", logout: "" };
  async function api(path, body) {
    const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch { /* 非 JSON */ }
    return { status: r.status, ...j };
  }
  async function checkAuth() {
    try {
      const r = await fetch("api/me", { credentials: "same-origin", cache: "no-store" });
      if (!r.ok || !(r.headers.get("Content-Type") || "").includes("json")) return true; // 沒有後端（GitHub Pages）
      const j = await r.json();
      auth.mode = j.mode;
      $("#apply-link").hidden = false;  // 有後端（Cloudflare）才提供申請
      if (j.mode !== "key") return true;
      $("#logout").hidden = false;
      if (j.authed) { startHeartbeat(); return true; }
      return showGate(REASON[j.reason] || "", j.reason);
    } catch { return true; }
  }
  // 「記住我」：名稱與密碼存在這台裝置（localStorage）
  const RKEY = "twchips.login";
  const getSaved = () => { try { return JSON.parse(localStorage.getItem(RKEY)); } catch { return null; } };
  const setSaved = v => { try { v ? localStorage.setItem(RKEY, JSON.stringify(v)) : localStorage.removeItem(RKEY); } catch { /* 無痕模式 */ } };
  const LOGOUT_FLAG = "twchips.loggedout";
  // 這台裝置的固定編號（讓同一台裝置重新登入時不會被當成別台）
  const deviceId = (() => {
    try {
      let d = localStorage.getItem("twchips.device");
      if (!d) { d = crypto.getRandomValues(new Uint32Array(4)).join("-"); localStorage.setItem("twchips.device", d); }
      return d;
    } catch { return ""; }
  })();
  // 網址帶 ?apply=1（從舊網址公告連過來）：只用一次，用完就從網址拿掉，避免登入後又跳回申請畫面
  function takeApplyParam() {
    if (!/[?&]apply=1/.test(location.search)) return false;
    try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* */ }
    return true;
  }
  function showGate(msg, reason) {
    stopHeartbeat();
    $("#gate").hidden = false; $("#gate-msg").textContent = msg || "";
    const saved = getSaved();
    $("#forget-wrap").hidden = !saved;
    if (saved) { $("#gate-name").value = saved.name; $("#gate-pin").value = saved.pin; $("#gate-remember").checked = true; }
    let manual = false; try { manual = sessionStorage.getItem(LOGOUT_FLAG) === "1"; } catch { /* */ }
    // 有記住帳號、而且不是自己按登出／被別台接手／被管理員登出 → 自動登入
    const auto = saved && !manual && !["takeover", "forced", "disabled", "expired", "deleted"].includes(reason);
    const p = new Promise(resolve => { auth.resolve = resolve; });
    if (takeApplyParam()) { showApply(true); return p; }  // 從舊網址公告連過來：直接開申請（只開一次）
    showApply(false);
    if (auto) setTimeout(() => $("#gate-btn").click(), 0);
    else setTimeout(() => (saved ? $("#gate-btn") : $("#gate-name")).focus(), 50);
    return p;
  }
  async function submitGate(e) {
    e.preventDefault();
    const btn = $("#gate-btn"); btn.disabled = true; $("#gate-msg").textContent = "";
    const remember = $("#gate-remember").checked;
    const r = await api("api/login", { name: $("#gate-name").value, pin: $("#gate-pin").value, remember, device_id: deviceId });
    btn.disabled = false;
    if (r.ok) {
      setSaved(remember ? { name: $("#gate-name").value.trim(), pin: $("#gate-pin").value } : null);
      try { sessionStorage.removeItem(LOGOUT_FLAG); } catch { /* */ }
      $("#gate").hidden = true; $("#gate-pin").value = "";
      startHeartbeat();
      if (auth.resolve) { const f = auth.resolve; auth.resolve = null; f(true); }
      else location.reload();
    } else {
      $("#gate-msg").textContent = r.error || "登入失敗";
      if (r.status === 403) setSaved(null);  // 記住的密碼已經不對（例如被重設）→ 清掉
    }
  }
  async function beat() {
    if (document.visibilityState !== "visible") return;
    const r = await api("api/heartbeat", {}).catch(() => null);
    if (r && r.status === 401) showGate(REASON[r.reason] || "請重新登入。", r.reason);
  }
  function showApply(on) {
    $("#gate-form").hidden = on; $("#apply-form").hidden = !on;
    if (on) setTimeout(() => $("#ap-name").focus(), 50);
  }
  async function submitApply(e) {
    e.preventDefault();
    const btn = $("#ap-btn"); btn.disabled = true; $("#ap-msg").className = "gate-msg"; $("#ap-msg").textContent = "";
    if (!/^\d{4}$/.test($("#ap-pin").value)) { btn.disabled = false; $("#ap-msg").textContent = "密碼請設定 4 位數字"; return; }
    const r = await api("api/apply", { name: $("#ap-name").value, pin: $("#ap-pin").value });
    btn.disabled = false;
    if (r.ok) {
      $("#ap-msg").className = "gate-msg ok";
      $("#ap-msg").textContent = `已送出申請！管理員核准後，就能用「${$("#ap-name").value.trim()}」和你設的密碼登入。`;
      $("#ap-pin").value = "";
    } else $("#ap-msg").textContent = r.error || "送出失敗";
  }
  function startHeartbeat() { stopHeartbeat(); auth.timer = setInterval(beat, 60000); }
  function stopHeartbeat() { if (auth.timer) clearInterval(auth.timer); auth.timer = null; }
  document.addEventListener("visibilitychange", () => { if (auth.mode === "key" && auth.timer) beat(); if (!document.hidden && posState.server) loadPos(); });

  // ---------- 啟動 ----------
  async function getJSON(p) {
    const r = await fetch(p, { cache: "no-cache", credentials: "same-origin" });
    if (r.status === 401 && auth.mode === "key") { const j = await r.json().catch(() => ({})); await showGate(REASON[j.reason] || "請重新登入。", j.reason); return getJSON(p); }
    if (!r.ok) throw new Error(p + " " + r.status);
    return r.json();
  }

  // ---------- 舊網址（GitHub Pages）搬家公告 ----------
  const MOVE_DATE = "2026-11-19";  // 舊網站關閉日
  function moveNotice() {
    if (!/github\.io$/.test(location.hostname)) return false;
    const [y, m, d] = MOVE_DATE.split("-").map(Number);
    $$(".move-date").forEach(e => { e.textContent = `${y} 年 ${m} 月 ${d} 日`; });
    const closed = Date.now() >= new Date(MOVE_DATE + "T00:00:00+08:00").getTime();
    $("#move-banner").hidden = false;
    $("#move-modal").hidden = false;
    if (closed) {  // 已過關閉日：只顯示公告，不能再使用
      $("#move-close").hidden = true;
      $(".warn-text").textContent = "舊網站已關閉，請改用新網址。";
      return true;
    }
    $("#move-close").addEventListener("click", () => { $("#move-modal").hidden = true; });
    return false;
  }

  // ---------- 免責聲明：每次開啟網站（新分頁／新瀏覽階段）都先跳出，按「我了解」才關閉 ----------
  function disclaimer() {
    const box = $("#disc"), seen = () => { try { return sessionStorage.getItem("tw_disc") === "1"; } catch { return false; } };
    const close = () => { box.hidden = true; try { sessionStorage.setItem("tw_disc", "1"); } catch { /* */ } };
    $("#disc-ok").addEventListener("click", close);
    $("#disc-open").addEventListener("click", e => { e.preventDefault(); box.hidden = false; });
    if (!seen()) box.hidden = false;
  }

  async function init() {
    disclaimer();
    if (moveNotice()) return;
    $("#gate-form").addEventListener("submit", submitGate);
    $("#apply-form").addEventListener("submit", submitApply);
    $("#to-apply").addEventListener("click", e => { e.preventDefault(); showApply(true); });
    $("#to-login").addEventListener("click", e => {
      e.preventDefault();
      if (auth.mode === "key") showApply(false); else $("#gate").hidden = true;  // 開放模式：直接關掉
    });
    $("#apply-link").addEventListener("click", e => { e.preventDefault(); $("#gate").hidden = false; showApply(true); });
    $("#logout").addEventListener("click", async () => {
      try { sessionStorage.setItem(LOGOUT_FLAG, "1"); } catch { /* */ }  // 自己登出：不要自動再登入
      await api("api/logout", {}); location.reload();
    });
    $("#forget").addEventListener("click", e => {
      e.preventDefault(); setSaved(null); $("#gate-name").value = ""; $("#gate-pin").value = ""; $("#forget-wrap").hidden = true;
    });
    await checkAuth();
    await loadPos();
    // 開放模式下從舊網址連過來：打開申請畫面（登入模式已在 showGate 處理；已登入就不再打擾）
    if (auth.mode !== "key" && takeApplyParam() && !$("#apply-link").hidden) { $("#gate").hidden = false; showApply(true); }
    else takeApplyParam();
    segs();
    $("#search").addEventListener("submit", e => { e.preventDefault(); openStock(resolve($("#q").value)); $("#q").blur(); });
    $("#st-star").addEventListener("click", () => {
      if (!state.cur) return; const w = getWatch(), c = state.cur.c, i = w.indexOf(c);
      if (i >= 0) w.splice(i, 1); else w.push(c); setWatch(w); drawWatch();
    });
    $("#rk-sel").addEventListener("change", drawRank);
    $("#vr-sort").addEventListener("change", drawValueRank);
    $("#hd-form").addEventListener("submit", e => {
      e.preventDefault();
      const code = resolve($("#hd-code").value), px = parseFloat($("#hd-px").value), date = $("#hd-date").value;
      const st = state.stockMap.get(code);
      if (!st) { alert("找不到這個股票代號，請從清單選一檔。"); return; }
      if (!date || !isFinite(px) || px <= 0) { alert("請填買進日期和買進價。"); return; }
      if (getPos().open.some(x => x.c === code)) { alert("這檔已經在持股裡了。"); return; }
      $("#hd-code").value = ""; $("#hd-px").value = "";
      addPos({ c: code, n: st[1], m: st[2], sig: date, entry: date, px });
    });
    $$("#sg-ver button").forEach(b => b.addEventListener("click", () => {
      state.sver = b.dataset.v; $$("#sg-ver button").forEach(x => x.classList.toggle("on", x === b)); drawSignals();
    }));
    $$("#vr-mkt button").forEach(b => b.addEventListener("click", () => {
      state.vmkt = b.dataset.m; $$("#vr-mkt button").forEach(x => x.classList.toggle("on", x === b)); drawValueRank();
    }));
    addEventListener("hashchange", route);
    addEventListener("scroll", hideTip, { passive: true });

    try {
      const [m, l, s] = await Promise.all([getJSON("data/market.json"), getJSON("data/latest.json"), getJSON("data/stocks.json")]);
      getJSON("data/valuation.json").then(v => { state.valuation = v; drawValueRank(); }).catch(() => {});
      getJSON("data/track.json").then(v => { state.track = v; drawHold(); drawSignals(); }).catch(() => { state.track = { ready: false }; drawHold(); });
      getJSON("data/signals.json").then(v => { state.signals = v; drawSignals(); }).catch(() => { state.signals = { ready: false, message: "訊號資料讀取失敗，請稍後再試。", stats: null }; drawSignals(); });
      state.market = m; state.latest = l; state.stocks = s;
      s.forEach(x => state.stockMap.set(x[0], x));
      const dl = $("#codes"); dl.replaceChildren(...s.map(x => { const o = el("option"); o.value = `${x[0]} ${x[1]}`; return o; }));
      const last = m.days[m.days.length - 1];
      $("#asof").textContent = last ? `資料日 ${last.d}` : "";
    } catch (e) {
      $("#ov-tiles").replaceChildren(el("div", "empty", "資料讀取失敗：" + e.message));
    }
    drawOverview(); drawInst(); drawMargin(); drawRank(); drawWatch(); drawHold();
    route();
  }
  init();
})();
