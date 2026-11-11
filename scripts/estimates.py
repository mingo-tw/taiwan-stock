#!/usr/bin/env python3
"""
抓分析師預估 EPS（Yahoo Finance 共識預估，透過 yfinance），存成 data/estimates.json。

挑選範圍：近 20 個交易日平均成交金額前 300 名上市 + 前 100 名上櫃，
再加上 config/extra_codes.txt 裡列的代號（一行一個）。
大約每週更新一次（檔案超過 6 天才會重抓），加 --force 立即重抓。
沒有分析師追蹤的股票就不會有資料。
"""
import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch  # noqa: E402

OUT = fetch.ROOT / "data" / "estimates.json"
EXTRA = fetch.ROOT / "config" / "extra_codes.txt"
TOP_TWSE, TOP_OTC = 300, 100


def pick_codes():
    files = sorted(fetch.RAW.glob("2*.json"))[-20:]
    amt, mkt = {}, {}
    for f in files:
        d = json.loads(f.read_text("utf-8"))
        for code, r in d.get("stocks", {}).items():
            if not fetch.OTC_CODE.match(code) or code.startswith("00"):  # ETF 沒有 EPS
                continue
            mkt[code] = r[1]
            if r[2] and r[4]:
                amt[code] = amt.get(code, 0) + r[2] * r[4]
    ranked = sorted(amt, key=amt.get, reverse=True)
    codes = [c for c in ranked if mkt[c] == "twse"][:TOP_TWSE] + [c for c in ranked if mkt[c] == "otc"][:TOP_OTC]
    if EXTRA.exists():
        for line in EXTRA.read_text("utf-8").splitlines():
            c = line.split("#")[0].strip()
            if c and c not in codes:
                codes.append(c)
    return codes, mkt


def val(df, period, col):
    try:
        v = df.loc[period, col]
        v = float(v)
        return None if v != v else round(v, 4)  # NaN
    except Exception:  # noqa: BLE001
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    try:
        old = json.loads(OUT.read_text("utf-8"))
    except Exception:  # noqa: BLE001
        old = {"items": {}}
    now = dt.datetime.now(fetch.TPE)
    if not a.force and old.get("updated"):
        age = now - dt.datetime.fromisoformat(old["updated"])
        if age < dt.timedelta(days=6):
            fetch.log(f"分析師預估 {age.days} 天前更新過，略過")
            return

    import yfinance as yf  # 只有需要時才載入

    codes, mkt = pick_codes()
    items = dict(old.get("items", {}))
    ok = fail = streak = 0
    for i, code in enumerate(codes):
        sym = f"{code}.{'TWO' if mkt.get(code) == 'otc' else 'TW'}"
        try:
            df = yf.Ticker(sym).earnings_estimate
            streak = 0
        except Exception as e:  # noqa: BLE001
            fail += 1
            streak += 1
            fetch.log(f"  {sym} 失敗：{e!r}"[:200])
            if streak >= 10:
                fetch.log("連續失敗 10 次，可能被 Yahoo 限流，先停止（保留舊資料）")
                break
            time.sleep(10)
            continue
        if df is None or getattr(df, "empty", True) or "0y" not in df.index:
            items.pop(code, None)
        else:
            items[code] = {
                "fy": now.year,  # 台股多為曆年制，0y = 今年
                "y0": val(df, "0y", "avg"), "y0_lo": val(df, "0y", "low"), "y0_hi": val(df, "0y", "high"),
                "y0_n": val(df, "0y", "numberOfAnalysts"),
                "y1": val(df, "+1y", "avg"), "y1_lo": val(df, "+1y", "low"), "y1_hi": val(df, "+1y", "high"),
                "y1_n": val(df, "+1y", "numberOfAnalysts"),
                "at": now.date().isoformat(),
            }
            ok += 1
        if (i + 1) % 50 == 0:
            fetch.log(f"  進度 {i + 1}/{len(codes)}，有預估 {ok} 檔")
        time.sleep(1.2)

    if ok == 0 and old.get("items"):
        fetch.log("這次一檔都沒抓到，不覆蓋舊資料")
        return
    OUT.write_text(json.dumps({"updated": now.isoformat(timespec="seconds"), "source": "Yahoo Finance",
                               "items": items}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    fetch.log(f"分析師預估：查詢 {len(codes)} 檔，有預估 {ok} 檔，失敗 {fail} 檔")


if __name__ == "__main__":
    main()
