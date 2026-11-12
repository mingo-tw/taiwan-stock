#!/usr/bin/env python3
"""訊號股測試：python tests/test_signals.py
1) 指標與回測用的 JS 版逐點比對  2) 假資料跑完整流程，確認訊號、賣點判斷正確"""
import datetime as dt
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import signals  # noqa: E402


def fake_series(seed, n=130, start=dt.date(2026, 5, 4)):
    rnd = random.Random(seed)
    rows, px, d = [], 100.0, start
    while len(rows) < n:
        if d.weekday() < 5:
            o = px * (1 + rnd.uniform(-0.01, 0.01))
            c = o * (1 + rnd.uniform(-0.03, 0.03))
            h, l = max(o, c) * (1 + rnd.uniform(0, 0.015)), min(o, c) * (1 - rnd.uniform(0, 0.015))
            rows.append((d.isoformat(), round(o, 2), round(h, 2), round(l, 2), round(c, 2),
                         rnd.randint(-5000, 6000) * 1000, rnd.randint(-500, 600) * 1000, rnd.randint(-300, 400) * 1000))
            px = c
        d += dt.timedelta(days=1)
    return rows


def test_indicators():
    for seed in range(5):
        rows = fake_series(seed)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump([{"d": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "F": r[5], "T": r[6], "D": r[7]} for r in rows], f)
        ref = json.loads(subprocess.check_output(["node", str(ROOT / "tests" / "ref_indicators.js"), f.name]))
        ind = signals.indicators(rows)
        for a, b in (("K", "K"), ("D", "D"), ("rsi", "rsi"), ("wk", "WK")):
            worst = max(abs(x - y) for x, y in zip(ind[a], ref[b]))
            assert worst < 1e-9, (seed, a, worst)
        st = [signals.inst_streak(rows, i) for i in range(len(rows))]
        assert st == ref["streak"], seed
    print("OK 指標與回測 JS 版一致")


def test_end_to_end():
    """假資料：1111 一路下跌到最後一天（最後一天才出現訊號）；6666（上櫃）在倒數第 3 天出現訊號，
    隔天持平、再大漲 15%；視窗為最近 4 個交易日（應判定已到停利賣點）。00 開頭 ETF 不入選。"""
    tmp = Path(tempfile.mkdtemp())
    (tmp / "data" / "ohlc").mkdir(parents=True)
    (tmp / "data" / "raw").mkdir(parents=True)
    (tmp / "config").mkdir()
    signals.ROOT, signals.OHLC, signals.RAW = tmp, tmp / "data" / "ohlc", tmp / "data" / "raw"
    n = 100
    d, dates = dt.date(2026, 6, 1), []
    while len(dates) < n:
        if d.weekday() < 5:
            dates.append(d)
        d += dt.timedelta(days=1)
    shares = {"1111": [1_000_000_000, "01", "twse"], "6666": [500_000_000, "01", "otc"], "0050": [9e9, "01", "twse"]}
    (tmp / "data" / "shares.json").write_text(json.dumps({"items": shares}))

    def px_a(i):
        return 100 - i * 0.2 if i < 85 else 83 - (i - 85) * 2.2

    def px_b(i):
        if i <= 97:
            return px_a(i)
        return px_b(97) if i == 98 else px_b(97) * 1.15

    prev = {}
    for i, day in enumerate(dates):
        t, o = {"0050": [100, 101, 99, 100, 1, 0, 0, 0]}, {}
        for code, fn, dst, buy_from in (("1111", px_a, t, 92), ("6666", px_b, o, 94)):
            c = fn(i)
            op = prev.get(code, c)
            dst[code] = [op, max(op, c) * 1.002, min(op, c) * 0.998, c, 5000,
                         800_000 if i >= buy_from else -800_000, 50_000, 10_000]
            prev[code] = c
        (tmp / "data" / "ohlc" / f"{day:%Y%m%d}.json").write_text(json.dumps({"date": day.isoformat(), "t": t, "o": o}))
    (tmp / "data" / "raw" / f"{dates[-1]:%Y%m%d}.json").write_text(json.dumps(
        {"stocks": {"1111": ["測試股", "twse"], "6666": ["櫃買股", "otc"]}, "pe": {"1111": [12.3, 1, 1]}}))
    res = signals.build({"x": 1})
    assert res["ready"] and res["date"] == dates[-1].isoformat(), res
    codes = {v: [r["c"] for r in res[v]] for v in ("strict", "loose")}
    print("嚴格", codes["strict"], "寬鬆", codes["loose"])
    assert "0050" not in codes["strict"] + codes["loose"], "ETF 不應入選"
    assert "1111" in codes["strict"] and "6666" in codes["strict"], codes
    a = next(r for r in res["strict"] if r["c"] == "1111")
    assert a["today"] and a["first"] == dates[96].isoformat() and a["entry"]["d"] == dates[97].isoformat(), a
    assert a["streak"] >= 3 and a["pe"] == 12.3 and a["ret"] < 0 and a["exit"] is None, a
    b = next(r for r in res["strict"] if r["c"] == "6666")
    assert b["m"] == "otc" and b["entry"]["d"] == dates[97].isoformat() and not b["today"], b
    assert b["exit"] and b["exit"]["why"] == "TP" and b["exit"]["d"] == dates[99].isoformat(), b
    assert b["ret"] > 10, b
    tr = res["track"]
    assert tr["ready"] and len(tr["dates"]) == signals.TRACK_DAYS and "1111" in tr["s"] and "0050" not in tr["s"], tr["dates"][:2]
    name, mk, closes, opens, rsis = tr["s"]["6666"]
    assert mk == "otc" and len(closes) == len(opens) == len(rsis) == signals.TRACK_DAYS and closes[-1] > 60 and rsis[-1] is not None
    for p in sorted((tmp / "data" / "ohlc").glob("*.json"))[:60]:
        p.unlink()
    assert signals.WINDOW == 4
    assert signals.build()["ready"] is False
    print("OK 端到端與資料不足")


if __name__ == "__main__":
    test_indicators()
    test_end_to_end()
