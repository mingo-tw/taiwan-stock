#!/usr/bin/env python3
"""
抓「訊號股」需要的每日開高低收＋三大法人（個股），存成 data/ohlc/YYYYMMDD.json。

為什麼另外存：data/raw 的個股資料只有收盤價（沒有最高、最低價），而且上櫃只有最新一日，
算不出 KD、RSI、週 K。這裡只存市值前 320 大上市 + 前 160 大上櫃（比網站實際用的前 200／前 100
多留一些，排名變動時歷史還在），每天約 20 KB。

檔案格式：
  {"date": "2026-11-12",
   "t": {"2330": [開, 高, 低, 收, 成交張數, 外資股數, 投信股數, 自營股數], ...},   # 上市
   "o": {"5274": [...同上...], ...}}                                              # 上櫃
  法人買賣超單位是「股」，成交量單位是「張」。

來源（皆為官方公開資料）：
  上市：MI_INDEX（開高低收）、T86（三大法人個股）
  上櫃：afterTrading/otc（開高低收）、insti/dailyTrade（三大法人個股），都可以指定日期

用法：
  python scripts/ohlc.py                    # 補最近 3 個平日（每天排程用）
  python scripts/ohlc.py --days 150         # 回補歷史（約 30 分鐘）
  python scripts/ohlc.py --days 150 --max-minutes 45   # 超過時間就先存檔結束，下次接著補
"""
import argparse
import datetime as dt
import json
import sys
import time

import fetch  # 同資料夾：共用抓取小工具與節流
from fetch import RAW, ROOT, TPE, TWSE, get_json, idx, log, num, ok, tables_of

OHLC = ROOT / "data" / "ohlc"
SHARES = ROOT / "data" / "shares.json"
EMPTY = OHLC / "_empty.json"          # 查無資料的過去日期（休市），不再重抓
TPEX = "https://www.tpex.org.tw/www/zh-tw"
N_TWSE, N_OTC = 320, 160
OTC_CODE = fetch.OTC_CODE
STOCK_CODE = __import__("re").compile(r"^\d{4}$")


def twse_day(ymd):
    """上市：{code: [開, 高, 低, 收, 張, 外資, 投信, 自營]}；沒有行情回傳 None（休市），有行情但法人未公布回傳 False"""
    r = get_json(f"{TWSE}/afterTrading/MI_INDEX",
                 {"date": ymd, "type": "ALLBUT0999", "response": "json"})
    if not ok(r):
        return None
    quotes = {}
    for t in tables_of(r):
        f = [str(x).strip() for x in (t.get("fields") or [])]
        ic, io_, ih, il, icl, iv = (idx(f, "證券代號"), idx(f, "開盤價"), idx(f, "最高價"),
                                    idx(f, "最低價"), idx(f, "收盤價"), idx(f, "成交股數"))
        if ic is None or icl is None or io_ is None:
            continue
        for row in t.get("data") or []:
            code = str(row[ic]).strip()
            o, c = num(row[io_]), num(row[icl])
            if not code or not o or not c:  # 停牌或當天沒成交：略過
                continue
            h = num(row[ih]) if ih is not None else None
            lo = num(row[il]) if il is not None else None
            v = num(row[iv]) if iv is not None else 0
            quotes[code] = [o, h or o, lo or o, c, int((v or 0) // 1000)]
    if not quotes:
        return None
    by = fetch.twse_inst_by_stock(ymd) or {}
    if not by:  # 有行情但法人還沒公布：不存，免得把「0」當成真的
        log(f"[{ymd}] 上市三大法人尚未公布")
        return False
    out = {}
    for code, q in quotes.items():
        i = by.get(code)
        out[code] = q + ([i["foreign"], i["trust"], i["dealer"]] if i else [0, 0, 0])
    return out


def tpex_table(path, ymd):
    r = get_json(f"{TPEX}/{path}", {"date": f"{ymd[:4]}/{ymd[4:6]}/{ymd[6:]}",
                                    "type": "Daily" if "insti" in path else "EW",
                                    **({"sect": "EW"} if "insti" in path else {}),
                                    "response": "json"})
    if not isinstance(r, dict) or str(r.get("stat", "")).lower() != "ok":
        return None
    for t in r.get("tables") or []:
        if t.get("data"):
            return t
    return None


def otc_day(ymd):
    """上櫃：同上格式。行情與法人任一抓不到，回傳 None（下次再試）"""
    q = tpex_table("afterTrading/otc", ymd)
    if not q:
        return None
    f = [str(x).strip() for x in q["fields"]]
    ic, io_, ih, il, icl, iv = (idx(f, "代號"), idx(f, "開盤"), idx(f, "最高"), idx(f, "最低"),
                                idx(f, "收盤"), idx(f, "成交股數"))
    if None in (ic, io_, icl):
        log(f"  TPEx 行情欄位不符：{f[:8]}")
        return None
    quotes = {}
    for row in q["data"]:
        code = str(row[ic]).strip()
        if not OTC_CODE.match(code):
            continue
        o, c = num(row[io_]), num(row[icl])
        if not o or not c:
            continue
        h = num(row[ih]) if ih is not None else None
        lo = num(row[il]) if il is not None else None
        v = num(row[iv]) if iv is not None else 0
        quotes[code] = [o, h or o, lo or o, c, int((v or 0) // 1000)]
    if not quotes:
        return None
    ins = tpex_table("insti/dailyTrade", ymd)
    if not ins:
        return None
    # 欄位名稱重複（買進股數、賣出股數…），只能用位置：
    # 4 外資及陸資(不含自營) 7 外資自營商 13 投信 22 自營商合計 23 三大法人合計
    if len(ins["fields"]) < 24:
        log(f"  TPEx 法人欄位數不符：{len(ins['fields'])}")
        return None
    by = {}
    for row in ins["data"]:
        by[str(row[0]).strip()] = [(num(row[4]) or 0) + (num(row[7]) or 0), num(row[13]) or 0, num(row[22]) or 0]
    return {code: qv + by.get(code, [0, 0, 0]) for code, qv in quotes.items()}


def pick_universe(day_t, day_o, shares):
    """依市值（收盤 × 已發行股數）挑前 N 大；00 開頭的 ETF 不收"""
    def top(day, n, only):
        caps = []
        for code, r in day.items():
            if code.startswith("00") or not only.match(code) or code not in shares:
                continue
            caps.append((r[3] * shares[code][0], code))
        caps.sort(reverse=True)
        return {c for _, c in caps[:n]}
    keep_t = top(day_t, N_TWSE, STOCK_CODE) if day_t else set()
    keep_o = top(day_o, N_OTC, STOCK_CODE) if day_o else set()
    return keep_t, keep_o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args()

    OHLC.mkdir(parents=True, exist_ok=True)
    try:
        shares = json.loads(SHARES.read_text("utf-8"))["items"]
    except Exception:  # noqa: BLE001
        shares = {}
    if not shares:
        log("找不到 data/shares.json，無法依市值挑選，先跑 scripts/shares.py")
        sys.exit(0)
    try:
        closed = set(json.loads(fetch.HOLIDAYS.read_text("utf-8")))
    except Exception:  # noqa: BLE001
        closed = set()
    try:
        empty = set(json.loads(EMPTY.read_text("utf-8")))
    except Exception:  # noqa: BLE001
        empty = set()

    now = dt.datetime.now(TPE)
    today = now.strftime("%Y%m%d")
    days, d = [], now.date()
    while len(days) < a.days:
        if d.weekday() < 5:
            days.append(d.strftime("%Y%m%d"))
        d -= dt.timedelta(days=1)
    t0 = time.time()
    got = 0
    for ymd in days:  # 由新到舊：最近的資料最重要
        if a.max_minutes and (time.time() - t0) / 60 > a.max_minutes:
            log(f"已超過 {a.max_minutes} 分鐘，先存檔結束（再執行一次會接著補）")
            break
        if ymd in closed or ymd in empty:
            continue
        path = OHLC / f"{ymd}.json"
        old = {}
        if path.exists():
            try:
                old = json.loads(path.read_text("utf-8"))
            except Exception:  # noqa: BLE001
                old = {}
        if old.get("t") and old.get("o"):
            continue
        log(f"[{ymd}] 抓取中…")
        day_t = None if old.get("t") else twse_day(ymd)
        if day_t is False:
            continue
        if not old.get("t") and day_t is None:
            if ymd < today:
                empty.add(ymd)
                log(f"[{ymd}] 無行情（休市）")
            else:
                log(f"[{ymd}] 無行情（尚未公布）")
            continue
        day_o = None if old.get("o") else otc_day(ymd)
        # 篩選時，已存在的一邊用舊資料（補抓上櫃時不必重抓上市）
        full_t = day_t or {}
        keep_t, keep_o = pick_universe(full_t, day_o or {}, shares)
        out = {
            "date": f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}",
            "t": old.get("t") or {c: full_t[c] for c in keep_t},
            "o": old.get("o") or ({c: day_o[c] for c in keep_o} if day_o else {}),
        }
        path.write_text(json.dumps(out, separators=(",", ":")), "utf-8")
        got += 1
        log(f"[{ymd}] 上市 {len(out['t'])} 檔、上櫃 {len(out['o'])} 檔"
            + ("" if out["o"] else "（上櫃抓不到，下次再補）"))
    EMPTY.write_text(json.dumps(sorted(empty)), "utf-8")
    log(f"共更新 {got} 天")


if __name__ == "__main__":
    main()
