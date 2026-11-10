#!/usr/bin/env python3
"""
把 data/raw/*.json 每日快照整理成網站要讀的檔案，輸出到 site/：
  site/data/market.json   大盤 + 三大法人 + 融資融券（每日一列）
  site/data/latest.json   最新一日排行榜
  site/data/stocks.json   代號清單（搜尋用）
  site/data/s/<代號>.json 個股近 N 日籌碼
並把 web/ 的前端檔案複製過去。
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WEB = ROOT / "web"
OUT = ROOT / "site"
KEEP_DAYS_MARKET = 250
KEEP_DAYS_STOCK = 120

# 快照中個股陣列的欄位位置
NAME, MKT, CLOSE, CHG, VOL, FOR, TRU, DEA, TOT, FIN, FINP, SHO, SHOP = range(13)


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def diff(a, b):
    return None if a is None or b is None else a - b


def main():
    files = sorted(RAW.glob("*.json"))
    days = []
    for f in files:
        try:
            days.append(json.loads(f.read_text("utf-8")))
        except Exception as e:  # noqa: BLE001
            print("略過壞檔", f, e)
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(WEB, OUT)
    data = OUT / "data"
    data.mkdir(parents=True, exist_ok=True)

    if not days:
        dump(data / "market.json", {"days": []})
        dump(data / "latest.json", {})
        dump(data / "stocks.json", [])
        print("沒有資料，只輸出空殼")
        return

    # ---- 大盤 ----
    mrows = []
    for d in days[-KEEP_DAYS_MARKET:]:
        m, i, g = d.get("market") or {}, d.get("inst") or {}, d.get("margin") or {}
        mrows.append({
            "d": d["date"],
            "taiex": m.get("taiex"), "chg": m.get("taiex_chg"), "pct": m.get("taiex_pct"),
            "turnover": m.get("turnover"),
            "inst": {k: (i.get(k) or {}).get("net") for k in ("foreign", "trust", "dealer", "total")} if i else None,
            "fin_amt": g.get("fin_amt"), "fin_amt_prev": g.get("fin_amt_prev"),
            "fin": g.get("fin"), "fin_prev": g.get("fin_prev"),
            "short": g.get("short"), "short_prev": g.get("short_prev"),
        })
    dump(data / "market.json", {"updated": days[-1].get("fetched_at"), "days": mrows})

    # ---- 個股歷史 ----
    hist, names = {}, {}
    for d in days[-KEEP_DAYS_STOCK:]:
        for code, r in d.get("stocks", {}).items():
            names[code] = (r[NAME], r[MKT])
            hist.setdefault(code, []).append([
                d["date"], r[CLOSE], r[CHG], r[VOL], r[FOR], r[TRU], r[DEA], r[TOT],
                r[FIN], diff(r[FIN], r[FINP]), r[SHO], diff(r[SHO], r[SHOP]),
            ])
    for code, rows in hist.items():
        if not code.isalnum():
            continue
        dump(data / "s" / f"{code}.json",
             {"c": code, "n": names[code][0], "m": names[code][1], "rows": rows})
    dump(data / "stocks.json", sorted([[c, n, m] for c, (n, m) in names.items() if c.isalnum()]))

    # ---- 最新一日排行 ----
    last = days[-1]
    items = []
    for code, r in last.get("stocks", {}).items():
        close = r[CLOSE]
        def amt(sh):
            return None if sh is None or close is None else sh * close
        items.append({
            "c": code, "n": r[NAME], "m": r[MKT], "close": close, "chg": r[CHG],
            "tot": r[TOT], "for": r[FOR], "tru": r[TRU], "dea": r[DEA],
            "amt": amt(r[TOT]), "for_amt": amt(r[FOR]), "tru_amt": amt(r[TRU]),
            "fin": r[FIN], "fin_chg": diff(r[FIN], r[FINP]),
            "sho": r[SHO], "sho_chg": diff(r[SHO], r[SHOP]),
            "ratio": (r[SHO] / r[FIN] * 100) if r[FIN] and r[SHO] is not None and r[FIN] >= 1000 else None,
        })

    def top(key, n=20, reverse=True):
        xs = [x for x in items if x.get(key) is not None and (x[key] > 0 if reverse else x[key] < 0)]
        return sorted(xs, key=lambda x: x[key], reverse=reverse)[:n]

    dump(data / "latest.json", {
        "date": last["date"],
        "inst_buy": top("amt"), "inst_sell": top("amt", reverse=False),
        "for_buy": top("for_amt"), "for_sell": top("for_amt", reverse=False),
        "tru_buy": top("tru_amt"), "tru_sell": top("tru_amt", reverse=False),
        "fin_up": top("fin_chg"), "fin_down": top("fin_chg", reverse=False),
        "ratio": top("ratio"),
    })
    print(f"建置完成：{len(days)} 天、{len(hist)} 檔個股，最新 {last['date']}")


if __name__ == "__main__":
    main()
