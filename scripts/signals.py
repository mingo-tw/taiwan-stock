#!/usr/bin/env python3
"""
訊號股：依回測找出的條件，每天篩出「近 3 個交易日」符合的股票。

共同條件（日線）：
  1. 三大法人合計連續買超 ≥ 3 天（外資 + 投信 + 自營商 每天合計 > 0）
  2. 近 5 個交易日收盤價下跌 > 5%
  3. KD(9,3,3) 的 K < 20 且 D < 20
嚴格版再加：日線 RSI(14) < 30
寬鬆版再加：週 K < 30（用「當週至今」的週線，不偷看未來）

範圍：市值前 200 大上市 + 前 100 大上櫃（與估值排行相同），不含 00 開頭的 ETF。
指標算法與回測完全相同（KD 起始值 50、RSI 用 Wilder 平滑），細節見 tests/test_signals.py。

輸出：site/data/signals.json（由 build.py 呼叫）
"""
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OHLC = ROOT / "data" / "ohlc"
RAW = ROOT / "data" / "raw"
WINDOW = 3          # 看最近幾個交易日的訊號
MIN_ROWS = 60       # 至少要有這麼多天的資料才算指標
KEEP = 160          # 只讀最近這麼多個交易日
N_TWSE, N_OTC = 200, 100
TAKE_PROFIT = 0.10  # 賣點參考：賺到 10%
RSI_EXIT = 60       # 賣點參考：RSI 回到 60

O, H, L, C, V, F, T, D = range(8)  # 每日資料陣列欄位


def week_key(date_str):
    d = dt.date.fromisoformat(date_str)
    return d - dt.timedelta(days=d.weekday())  # 該週星期一


def indicators(rows):
    """rows: [(date, o, h, l, c, F, T, D)]，回傳各指標陣列（與回測 JS 版逐點一致）"""
    n = len(rows)
    close = [r[4] for r in rows]
    # KD(9,3,3)，起始 K=D=50
    K, Dv, k, d = [], [], 50.0, 50.0
    for i in range(n):
        lo_i = max(0, i - 8)
        hi = max(rows[j][2] for j in range(lo_i, i + 1))
        lo = min(rows[j][3] for j in range(lo_i, i + 1))
        rsv = 50.0 if hi == lo else (close[i] - lo) / (hi - lo) * 100
        k = k * 2 / 3 + rsv / 3
        d = d * 2 / 3 + k / 3
        K.append(k)
        Dv.append(d)
    # RSI(14)，Wilder 平滑（前 14 根用簡單平均累加）
    rsi = [50.0] * n
    ag = al = 0.0
    for i in range(1, n):
        ch = close[i] - close[i - 1]
        g, l = max(ch, 0.0), max(-ch, 0.0)
        if i <= 14:
            ag += g / 14
            al += l / 14
        else:
            ag = (ag * 13 + g) / 14
            al = (al * 13 + l) / 14
        rsi[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    # 週 K：用「當週至今」的週線（週 K 的 KD 也是 9,3,3，起始 50）
    wk = [50.0] * n
    weeks, kc, dc, cur_key, cur = [], 50.0, 50.0, None, None
    for i in range(n):
        key = week_key(rows[i][0])
        if key != cur_key:
            if cur is not None:
                weeks.append(cur)
                arr = weeks[-9:]
                hi, lo = max(w[0] for w in arr), min(w[1] for w in arr)
                rsv = 50.0 if hi == lo else (cur[2] - lo) / (hi - lo) * 100
                kc = kc * 2 / 3 + rsv / 3
                dc = dc * 2 / 3 + kc / 3
            cur_key, cur = key, [rows[i][2], rows[i][3], rows[i][4]]  # 高、低、收
        else:
            cur[0] = max(cur[0], rows[i][2])
            cur[1] = min(cur[1], rows[i][3])
            cur[2] = rows[i][4]
        arr = weeks[-8:] + [cur]
        hi, lo = max(w[0] for w in arr), min(w[1] for w in arr)
        rsv = 50.0 if hi == lo else (cur[2] - lo) / (hi - lo) * 100
        wk[i] = kc * 2 / 3 + rsv / 3
    return {"K": K, "D": Dv, "rsi": rsi, "wk": wk}


def inst_streak(rows, i):
    """三大法人合計連續買超天數（最多數 15 天，與回測相同）"""
    s = 0
    j = i
    while j >= 0 and j > i - 15 and (rows[j][5] + rows[j][6] + rows[j][7]) > 0:
        s += 1
        j -= 1
    return s


def net(px, buy):
    """扣手續費（買賣各 0.1425%）與證交稅 0.3% 後的報酬率"""
    return px * (1 - 0.001425 - 0.003) / (buy * 1.001425) - 1


def flags_at(rows, ind, i):
    """第 i 天是否符合基本條件、嚴格版、寬鬆版"""
    if i < 5:
        return None
    streak = inst_streak(rows, i)
    r5 = rows[i][4] / rows[i - 5][4] - 1
    base = streak >= 3 and r5 < -0.05 and ind["K"][i] < 20 and ind["D"][i] < 20
    return {"base": base, "strict": base and ind["rsi"][i] < 30, "loose": base and ind["wk"][i] < 30,
            "streak": streak, "r5": r5}


def load_history():
    files = sorted(OHLC.glob("2*.json"))[-KEEP:]
    days = []
    for f in files:
        try:
            d = json.loads(f.read_text("utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if d.get("t") and d.get("o"):  # 兩個市場都有才用，避免某天缺上櫃造成指標斷層
            days.append(d)
    return days


def universe(days, shares):
    last = days[-1]
    out = {}
    for mk, key, n in (("twse", "t", N_TWSE), ("otc", "o", N_OTC)):
        caps = sorted(((r[C] * shares[c][0], c) for c, r in last[key].items()
                       if c in shares and not c.startswith("00")), reverse=True)
        for _, c in caps[:n]:
            out[c] = mk
    return out


def latest_names():
    files = sorted(RAW.glob("2*.json"))
    if not files:
        return {}, {}
    d = json.loads(files[-1].read_text("utf-8"))
    return {c: r[0] for c, r in d.get("stocks", {}).items()}, d.get("pe") or {}


def build(stats=None):
    days = load_history()
    base = {"ready": False, "need": MIN_ROWS, "have": len(days), "stats": stats,
            "universe": {"twse": N_TWSE, "otc": N_OTC}}
    if len(days) < MIN_ROWS:
        base["message"] = f"歷史資料累積中（已有 {len(days)} 天，至少需要 {MIN_ROWS} 個交易日），補齊後會自動出現訊號。"
        return base
    try:
        shares = json.loads((ROOT / "data" / "shares.json").read_text("utf-8"))["items"]
    except Exception:  # noqa: BLE001
        base["message"] = "缺少已發行股數資料，無法挑選市值排名。"
        return base
    names, pes = latest_names()
    uni = universe(days, shares)
    dates = [d["date"] for d in days]
    window = dates[-WINDOW:]
    out = {"strict": [], "loose": []}

    for code, mk in uni.items():
        key = "t" if mk == "twse" else "o"
        rows, pos = [], {}
        for d in days:
            r = d[key].get(code)
            if r and r[O] > 0 and r[C] > 0:
                pos[d["date"]] = len(rows)
                rows.append((d["date"], r[O], r[H] or r[O], r[L] or r[O], r[C], r[F], r[T], r[D], r[V]))
        if len(rows) < MIN_ROWS:
            continue
        ind = indicators(rows)
        last_i = len(rows) - 1
        hits = {"strict": [], "loose": []}
        for dd in window:
            i = pos.get(dd)
            if i is None:
                continue
            fl = flags_at(rows, ind, i)
            if not fl:
                continue
            for v in ("strict", "loose"):
                if fl[v]:
                    hits[v].append((i, fl))
        for v, hl in hits.items():
            if not hl:
                continue
            first_i, first_fl = hl[0]
            i, fl = hl[-1]  # 最近一次符合
            pe = (pes.get(code) or [None])[0]
            row = {
                "c": code, "n": names.get(code, ""), "m": mk,
                "sig": [rows[j][0] for j, _ in hl],
                "first": rows[first_i][0], "last": rows[i][0],
                "today": rows[i][0] == rows[last_i][0],
                "close": rows[i][4], "now": rows[last_i][4],
                "K": round(ind["K"][i], 1), "D": round(ind["D"][i], 1),
                "rsi": round(ind["rsi"][i], 1), "wk": round(ind["wk"][i], 1),
                "r5": round(fl["r5"] * 100, 1), "streak": fl["streak"],
                "F": round(rows[i][5] / 1000), "T": round(rows[i][6] / 1000), "Dl": round(rows[i][7] / 1000),
                "pe": pe if isinstance(pe, (int, float)) and pe > 0 else None,
                "entry": None,
            }
            e = first_i + 1  # 訊號日隔天開盤買進
            if e <= last_i:
                buy = rows[e][1]
                row["entry"] = {"d": rows[e][0], "px": buy}
                row["ret"] = round(net(rows[last_i][4], buy) * 100, 1)
                row["rsi_now"] = round(ind["rsi"][last_i], 1)
                hit = None
                peak = buy
                for s in range(e + 1, last_i + 1):  # 進場日之後逐日檢查（與回測相同：收盤判斷）
                    peak = max(peak, rows[s][4])
                    if ind["rsi"][s] >= RSI_EXIT:
                        hit = {"why": "RSI", "d": rows[s][0]}
                        break
                    if rows[s][4] / buy - 1 >= TAKE_PROFIT:
                        hit = {"why": "TP", "d": rows[s][0]}
                        break
                row["exit"] = hit
            out[v].append(row)

    for v in out:
        out[v].sort(key=lambda r: (r["last"], r["streak"]), reverse=True)
    return {"ready": True, "date": dates[-1], "window": window, "have": len(days),
            "universe": {"twse": N_TWSE, "otc": N_OTC, "found": len(uni)},
            "strict": out["strict"], "loose": out["loose"], "stats": stats}


def run(out_dir):
    try:
        stats = json.loads((ROOT / "config" / "signal_stats.json").read_text("utf-8"))
    except Exception:  # noqa: BLE001
        stats = None
    res = build(stats)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "signals.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), "utf-8")
    if res.get("ready"):
        print(f"訊號股：{res['date']} 嚴格版 {len(res['strict'])} 檔、寬鬆版 {len(res['loose'])} 檔（歷史 {res['have']} 天）")
    else:
        print("訊號股：" + res.get("message", "尚未就緒"))
    return res


if __name__ == "__main__":
    import sys
    run(sys.argv[1] if len(sys.argv) > 1 else ROOT / "site" / "data")
