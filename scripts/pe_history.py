#!/usr/bin/env python3
"""
回補上市股票「每月最後一個交易日」的本益比，存成 data/pe_monthly/YYYYMM.json
（{"date": "2026-10-30", "pe": {代號: 本益比}}），供計算 3 年平均本益比。
只抓還沒有的月份；當月尚未結束不抓（當月改用每日快照）。
上櫃沒有官方歷史本益比，靠每日快照自行累積。

用法：python scripts/pe_history.py [--months 37]
"""
import argparse
import calendar
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch  # noqa: E402

OUT = fetch.ROOT / "data" / "pe_monthly"


def month_list(n):
    today = dt.datetime.now(fetch.TPE).date()
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append((y, m))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=37)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    got = 0
    for y, m in month_list(a.months):
        path = OUT / f"{y}{m:02d}.json"
        if path.exists():
            continue
        last = calendar.monthrange(y, m)[1]
        for back in range(0, 10):  # 從月底往前找最後一個交易日
            d = dt.date(y, m, last) - dt.timedelta(days=back)
            if d.weekday() >= 5:
                continue
            ymd = d.strftime("%Y%m%d")
            pe = fetch.twse_pe(ymd)
            if pe:
                path.write_text(json.dumps({"date": d.isoformat(),
                                            "pe": {c: v[0] for c, v in pe.items() if v[0]}},
                                           ensure_ascii=False, separators=(",", ":")), "utf-8")
                fetch.log(f"[{y}-{m:02d}] 以 {d} 本益比存檔：{len(pe)} 檔")
                got += 1
                break
        else:
            fetch.log(f"[{y}-{m:02d}] 找不到資料")
    fetch.log(f"月本益比新增 {got} 個月")


if __name__ == "__main__":
    main()
