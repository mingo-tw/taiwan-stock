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
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WEB = ROOT / "web"
OUT = ROOT / "site"
KEEP_DAYS_MARKET = 250
KEEP_DAYS_STOCK = 120
OTC_CODE = re.compile(r"^(\d{4}|00\d{2,4}[A-Z]?)$")

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
    # 加版本號，避免瀏覽器快取到舊的 JS/CSS
    import time
    ver = str(int(time.time()))
    idx = OUT / "index.html"
    idx.write_text(idx.read_text("utf-8").replace('href="style.css"', f'href="style.css?v={ver}"')
                   .replace('src="app.js"', f'src="app.js?v={ver}"'), "utf-8")
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

    official = {f"{f.stem[:4]}-{f.stem[4:]}" for f in (ROOT / "data" / "pe_monthly").glob("*.json")}
    # ---- 本益比：月資料（官方月底）＋ 每日快照補缺 ----
    monthly = {}  # "YYYY-MM" -> {code: pe}
    for f in sorted((ROOT / "data" / "pe_monthly").glob("*.json")):
        try:
            monthly[f"{f.stem[:4]}-{f.stem[4:]}"] = json.loads(f.read_text("utf-8")).get("pe", {})
        except Exception:  # noqa: BLE001
            pass
    for d in days:  # 快照依日期排序，後面的覆蓋前面 → 每月最後一天
        ym = d["date"][:7]
        for code, v in (d.get("pe") or {}).items():
            if v and v[0]:
                monthly.setdefault(ym, {})
                if ym not in official:
                    monthly[ym][code] = v[0]
    months = sorted(monthly)[-37:]
    cur_month = days[-1]["date"][:7]
    latest_pe = days[-1].get("pe") or {}
    try:
        est = json.loads((ROOT / "data" / "estimates.json").read_text("utf-8"))
    except Exception:  # noqa: BLE001
        est = {"items": {}}

    def valuation(code):
        hist = [[ym, monthly[ym][code]] for ym in months if monthly[ym].get(code)]
        past = [v for ym, v in hist if ym != cur_month][-36:]
        v = latest_pe.get(code) or [None, None, None]
        out = {"pe": v[0], "pb": v[1], "yld": v[2], "hist": hist[-37:], "n": len(past),
               "pe_why": None if (v[0] or 0) > 0 else ("loss" if code in latest_pe else "na")}
        if names.get(code, ("", ""))[1] == "otc":
            # 上櫃沒有官方歷史本益比：不用 3 年本益比，合理價改用「預估 EPS × 目前本益比」
            out.pop("hist")
            out["n"] = 0
            out["mode"] = "otc"
        elif past:
            out.update(avg=round(sum(past) / len(past), 2), min=min(past), max=max(past))
        e = est.get("items", {}).get(code)
        if e:
            out["est"] = e
        return out

    # ---- 個股歷史 ----
    hist, names = {}, {}
    for d in days[-KEEP_DAYS_STOCK:]:
        for code, r in d.get("stocks", {}).items():
            if r[MKT] == "otc" and not OTC_CODE.match(code):  # 早期快照誤收的上櫃權證
                continue
            names[code] = (r[NAME], r[MKT])
            hist.setdefault(code, []).append([
                d["date"], r[CLOSE], r[CHG], r[VOL], r[FOR], r[TRU], r[DEA], r[TOT],
                r[FIN], diff(r[FIN], r[FINP]), r[SHO], diff(r[SHO], r[SHOP]),
            ])
    for code, rows in hist.items():
        if not code.isalnum():
            continue
        dump(data / "s" / f"{code}.json",
             {"c": code, "n": names[code][0], "m": names[code][1], "rows": rows, "v": valuation(code)})
    dump(data / "stocks.json", sorted([[c, n, m] for c, (n, m) in names.items() if c.isalnum()]))

    # ---- 估值排行：上市市值前 200、上櫃市值前 100 ----
    try:
        shares = json.loads((ROOT / "data" / "shares.json").read_text("utf-8"))["items"]
    except Exception:  # noqa: BLE001
        shares = {}
    last_stocks = days[-1].get("stocks", {})
    yy, mm = int(days[-1]["date"][:4]), int(days[-1]["date"][5:7])

    def fwd_eps(e):
        if not e or e.get("y0") is None:
            return None
        if yy == e["fy"]:
            f = (12 - mm + 1) / 12
            return f * e["y0"] + (1 - f) * e["y1"] if e.get("y1") is not None else e["y0"]
        if yy == e["fy"] + 1:
            return e.get("y1")
        return None

    def pos(x):
        return x is not None and x > 0

    caps = {c: r[CLOSE] * shares[c][0] for c, r in last_stocks.items()
            if c in shares and r[CLOSE] and not c.startswith("00")}
    rank_v = {}
    for mk, n in (("twse", 200), ("otc", 100)):
        codes = sorted([c for c in caps if last_stocks[c][MKT] == mk], key=caps.get, reverse=True)[:n]
        rows = []
        for i, c in enumerate(codes):
            r, v = last_stocks[c], valuation(c)
            close = r[CLOSE]
            ttm = close / v["pe"] if pos(v.get("pe")) else None
            fe = fwd_eps(v.get("est"))
            fpe = close / fe if pos(fe) else None
            avg = v.get("avg")
            if mk == "otc":  # 合理價 = 預估 EPS × 目前本益比
                fair_t = None
                fair_f = fe * v["pe"] if pos(fe) and pos(v.get("pe")) else None
            else:
                fair_t = ttm * avg if pos(ttm) and avg else None
                fair_f = fe * avg if pos(fe) and avg else None
            rows.append({
                "c": c, "n": r[NAME], "close": close, "chg": r[CHG], "cap": round(caps[c] / 1e8), "cap_rank": i + 1,
                "pe": v.get("pe"), "fpe": round(fpe, 2) if fpe else None, "avg": avg, "hist_n": v.get("n"),
                "ttm": round(ttm, 2) if ttm else None, "feps": round(fe, 2) if fe else None,
                "fair_t": round(fair_t, 1) if fair_t else None, "fair_f": round(fair_f, 1) if fair_f else None,
                "gap_t": round((close / fair_t - 1) * 100, 1) if fair_t else None,
                "gap_f": round((close / fair_f - 1) * 100, 1) if fair_f else None,
                "an": (v.get("est") or {}).get("y1_n") or (v.get("est") or {}).get("y0_n"),
                # 空白原因：loss=近四季虧損、na=無本益比資料；no_est=無分析師預估、est_loss=預估虧損
                "pe_why": None if pos(v.get("pe")) else ("loss" if c in latest_pe else "na"),
                "fpe_why": None if fpe else ("est_loss" if v.get("est") and v["est"].get("y0") is not None else "no_est"),
            })
        rank_v[mk] = rows
    dump(data / "valuation.json", {"date": days[-1]["date"], **rank_v})

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
