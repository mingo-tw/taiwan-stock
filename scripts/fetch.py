#!/usr/bin/env python3
"""
抓取台股每日籌碼資料，存成 data/raw/YYYYMMDD.json 每日快照。

資料來源（皆為官方公開資料）：
  上市 TWSE
    - MI_INDEX  (type=ALLBUT0999)  大盤指數、成交金額、個股收盤價
    - BFI82U                       三大法人買賣金額統計（全市場）
    - T86       (ALLBUT0999)       三大法人個股買賣超（股數）
    - MI_MARGN  (ALL)              融資融券（全市場統計 + 個股）
  上櫃 TPEx（盡力而為，OpenAPI 只提供最新一日）
    - 收盤行情 / 三大法人 / 融資融券

用法：
  python scripts/fetch.py                 # 抓今天（台北時間）
  python scripts/fetch.py --days 60       # 回補最近 60 個平日，已完整的日子會跳過
  python scripts/fetch.py --date 20261110 # 抓指定日
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
HOLIDAYS = ROOT / "data" / "no_trading_days.json"
TPE = dt.timezone(dt.timedelta(hours=8))

TWSE = "https://www.twse.com.tw/rwd/zh"
TPEX_OPENAPI = "https://www.tpex.org.tw/openapi/v1"

SLEEP = float(os.environ.get("FETCH_SLEEP", "4"))  # 證交所約 5 秒 3 次以上會擋 IP
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")

session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept": "application/json,text/plain,*/*"})


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------- 小工具 ----------

def num(v):
    """'1,234.5' -> 1234.5；'--'、''、'X' -> None"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    s = re.sub(r"<[^>]+>", "", str(v)).replace(",", "").strip()
    if s in ("", "--", "---", "X", "-", "除權息", "除息", "除權"):
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() and "." not in s else f
    except ValueError:
        return None


def sign_of(v):
    """漲跌(+/-) 欄位可能是 '+'、'-'、'<p style=color:red>+</p>'、'X'、' '"""
    s = re.sub(r"<[^>]+>", "", str(v or "")).strip()
    if s.startswith("-"):
        return -1
    if s.startswith("+"):
        return 1
    return 0


def tables_of(resp):
    """把證交所新舊兩種 JSON 格式都整理成 [{title, fields, data}]"""
    if not isinstance(resp, dict):
        return []
    if isinstance(resp.get("tables"), list):
        return [t for t in resp["tables"] if isinstance(t, dict)]
    out = []
    if "fields" in resp and "data" in resp:
        out.append({"title": resp.get("title", ""), "fields": resp["fields"], "data": resp["data"]})
    for k in resp:
        m = re.fullmatch(r"fields(\d+)", k)
        if m and f"data{m.group(1)}" in resp:
            out.append({"title": resp.get(f"subtitle{m.group(1)}", ""), "fields": resp[k],
                        "data": resp[f"data{m.group(1)}"]})
    if "creditFields" in resp and "creditList" in resp:
        out.append({"title": resp.get("creditTitle", "信用交易統計"),
                    "fields": resp["creditFields"], "data": resp["creditList"]})
    return out


def idx(fields, *preds):
    """依欄位名稱找索引：每個 pred 可以是字串（完全相同）或 callable"""
    for p in preds:
        for i, f in enumerate(fields):
            f = str(f).strip()
            if (callable(p) and p(f)) or f == p:
                return i
    return None


def get_json(url, params=None, tries=3):
    for k in range(tries):
        try:
            r = session.get(url, params=params, timeout=30)
            if r.status_code == 200:
                time.sleep(SLEEP)
                return r.json()
            log(f"  HTTP {r.status_code} {r.url}")
        except Exception as e:  # noqa: BLE001
            log(f"  error {url}: {e}")
        time.sleep(SLEEP * (k + 2))
    return None


def ok(resp):
    return isinstance(resp, dict) and str(resp.get("stat", "")).upper() == "OK"


# ---------- 上市 TWSE ----------

def twse_index_and_quotes(ymd):
    r = get_json(f"{TWSE}/afterTrading/MI_INDEX",
                 {"date": ymd, "type": "ALLBUT0999", "response": "json"})
    if not ok(r):
        return None
    market, quotes = {}, {}
    for t in tables_of(r):
        f, data = t.get("fields") or [], t.get("data") or []
        title = str(t.get("title", ""))
        # 價格指數表
        if f and "指數" in str(f[0]) and idx(f, "收盤指數") is not None:
            ic, isg, ich, ipc = idx(f, "收盤指數"), idx(f, "漲跌(+/-)"), idx(f, "漲跌點數"), \
                idx(f, "漲跌百分比(%)", lambda x: x.startswith("漲跌百分比"))
            for row in data:
                if str(row[0]).strip() == "發行量加權股價指數":
                    s = sign_of(row[isg]) if isg is not None else 1
                    market["taiex"] = num(row[ic])
                    market["taiex_chg"] = abs(num(row[ich]) or 0) * s
                    pct = num(row[ipc]) if ipc is not None else None
                    if pct is not None:
                        market["taiex_pct"] = abs(pct) * s
        # 大盤成交統計
        if f and "成交統計" in str(f[0]):
            ia = idx(f, "成交金額(元)", lambda x: x.startswith("成交金額"))
            for row in data:
                if str(row[0]).startswith("總計") and ia is not None:
                    market["turnover"] = num(row[ia])
        # 個股收盤
        ic = idx(f, "證券代號")
        if ic is not None and idx(f, "收盤價") is not None:
            iname, iclose = idx(f, "證券名稱"), idx(f, "收盤價")
            isg, idiff = idx(f, "漲跌(+/-)"), idx(f, "漲跌價差")
            ivol, iamt = idx(f, "成交股數"), idx(f, "成交金額")
            for row in data:
                code = str(row[ic]).strip()
                diff = num(row[idiff]) if idiff is not None else None
                s = sign_of(row[isg]) if isg is not None else 0
                quotes[code] = {
                    "name": str(row[iname]).strip(),
                    "close": num(row[iclose]),
                    "chg": (diff * s) if (diff is not None) else None,
                    "vol": num(row[ivol]) if ivol is not None else None,
                    "amt": num(row[iamt]) if iamt is not None else None,
                }
        _ = title
    return {"market": market, "quotes": quotes}


def twse_inst_total(ymd):
    r = get_json(f"{TWSE}/fund/BFI82U",
                 {"type": "day", "dayDate": ymd, "response": "json"})
    if not ok(r):
        return None
    tbl = tables_of(r)
    if not tbl:
        return None
    f = tbl[0]["fields"]
    ib, isell, inet = idx(f, "買進金額"), idx(f, "賣出金額"), idx(f, "買賣差額")
    out = {k: {"buy": 0, "sell": 0, "net": 0} for k in ("foreign", "trust", "dealer", "total")}
    for row in tbl[0]["data"]:
        name = str(row[0]).strip()
        if name.startswith("外資"):
            k = "foreign"
        elif name.startswith("投信"):
            k = "trust"
        elif name.startswith("自營商"):
            k = "dealer"
        elif name.startswith("合計"):
            k = "total"
        else:
            continue
        out[k]["buy"] += num(row[ib]) or 0
        out[k]["sell"] += num(row[isell]) or 0
        out[k]["net"] += num(row[inet]) or 0
    return out


def twse_inst_by_stock(ymd):
    r = get_json(f"{TWSE}/fund/T86",
                 {"date": ymd, "selectType": "ALLBUT0999", "response": "json"})
    if not ok(r):
        return None
    tbl = tables_of(r)
    if not tbl:
        return None
    f = [str(x).strip() for x in tbl[0]["fields"]]
    ic = idx(f, "證券代號")
    i_for = idx(f, lambda x: x.startswith("外陸資買賣超股數"), lambda x: x.startswith("外資買賣超股數"))
    i_fdl = idx(f, "外資自營商買賣超股數")
    i_tr = idx(f, "投信買賣超股數")
    i_dl = idx(f, "自營商買賣超股數")
    if i_dl is None:  # 舊格式只有自行買賣 + 避險
        i_dl_a = idx(f, lambda x: x.startswith("自營商買賣超股數(自行買賣)"))
        i_dl_b = idx(f, lambda x: x.startswith("自營商買賣超股數(避險)"))
    i_tot = idx(f, "三大法人買賣超股數")
    out = {}
    for row in tbl[0]["data"]:
        code = str(row[ic]).strip()
        foreign = (num(row[i_for]) or 0) + ((num(row[i_fdl]) or 0) if i_fdl is not None else 0)
        trust = num(row[i_tr]) or 0
        if i_dl is not None:
            dealer = num(row[i_dl]) or 0
        else:
            dealer = (num(row[i_dl_a]) or 0) + (num(row[i_dl_b]) or 0)
        total = num(row[i_tot]) if i_tot is not None else foreign + trust + dealer
        out[code] = {"foreign": foreign, "trust": trust, "dealer": dealer, "total": total or 0}
    return out


def twse_margin(ymd):
    r = get_json(f"{TWSE}/marginTrading/MI_MARGN",
                 {"date": ymd, "selectType": "ALL", "response": "json"})
    if not ok(r):
        return None
    summary, stocks = {}, {}
    for t in tables_of(r):
        f = [str(x).strip() for x in (t.get("fields") or [])]
        data = t.get("data") or []
        if f and f[0] == "項目":
            ip, it = idx(f, "前日餘額"), idx(f, "今日餘額")
            for row in data:
                name = str(row[0])
                if name.startswith("融資金額"):
                    summary["fin_amt_prev"], summary["fin_amt"] = num(row[ip]), num(row[it])  # 仟元
                elif name.startswith("融資"):
                    summary["fin_prev"], summary["fin"] = num(row[ip]), num(row[it])  # 張
                elif name.startswith("融券"):
                    summary["short_prev"], summary["short"] = num(row[ip]), num(row[it])  # 張
        elif f and "代號" in f[0] and len(f) >= 13:
            # 欄位：代號 名稱 | 融資 買進 賣出 現金償還 前日餘額 今日餘額 限額 | 融券 買進 賣出 現券償還 前日餘額 今日餘額 限額 | 資券互抵 註記
            for row in data:
                code = str(row[0]).strip()
                stocks[code] = {
                    "fin": num(row[6]), "fin_prev": num(row[5]),
                    "short": num(row[12]), "short_prev": num(row[11]),
                }
    if not summary and not stocks:
        return None
    return {"summary": summary, "stocks": stocks}


# ---------- 上櫃 TPEx（盡力而為） ----------

def _pick(d, *pats):
    for p in pats:
        for k, v in d.items():
            if re.search(p, k, re.I):
                return v
    return None


def _roc_to_ymd(s):
    s = re.sub(r"\D", "", str(s or ""))
    if len(s) == 7:
        return f"{int(s[:3]) + 1911}{s[3:]}"
    if len(s) == 8:
        return s
    return None


def tpex_latest(ymd):
    """TPEx OpenAPI 只給最新交易日；日期不符就不用。任何欄位對不上都安靜跳過。"""
    out = {}
    try:
        q = get_json(f"{TPEX_OPENAPI}/tpex_mainboard_daily_close_quotes") or []
        if q and _roc_to_ymd(_pick(q[0], r"^Date$", "日期")) == ymd:
            for d in q:
                code = str(_pick(d, r"SecuritiesCompanyCode", r"^Code$", "代號") or "").strip()
                if not code:
                    continue
                close = num(_pick(d, r"^Close$", "收盤"))
                out[code] = {"name": str(_pick(d, r"CompanyName", r"^Name$", "名稱") or "").strip(),
                             "close": close, "chg": num(_pick(d, r"^Change$", "漲跌")),
                             "vol": num(_pick(d, r"TradingShares", r"TradeVolume", "成交股數")),
                             "mkt": "otc"}
        elif q:
            log(f"  TPEx quotes 日期不符或格式不同，keys={list(q[0].keys())[:12]}")
    except Exception as e:  # noqa: BLE001
        log("  TPEx quotes 失敗", e)

    try:
        ins = get_json(f"{TPEX_OPENAPI}/tpex_3insti_daily_trading") or []
        if ins and _roc_to_ymd(_pick(ins[0], r"^Date$", "日期")) == ymd:
            for d in ins:
                code = str(_pick(d, r"SecuritiesCompanyCode", r"^Code$", "代號") or "").strip()
                if code in out:
                    foreign = num(_pick(d, r"Foreign.*Difference", r"外資.*買賣超")) or 0
                    trust = num(_pick(d, r"Investment\s*Trust.*Difference", r"投信.*買賣超")) or 0
                    dealer = num(_pick(d, r"^Dealers.*Difference$", r"Dealer.*Total.*Difference", r"自營商.*買賣超")) or 0
                    total = num(_pick(d, r"TotalDifference", r"三大法人.*買賣超"))
                    out[code]["inst"] = {"foreign": foreign, "trust": trust, "dealer": dealer,
                                         "total": total if total is not None else foreign + trust + dealer}
        elif ins:
            log(f"  TPEx 法人 日期不符或格式不同，keys={list(ins[0].keys())[:12]}")
    except Exception as e:  # noqa: BLE001
        log("  TPEx 法人 失敗", e)

    try:
        mg = get_json(f"{TPEX_OPENAPI}/tpex_mainboard_margin_balance") or []
        if mg and _roc_to_ymd(_pick(mg[0], r"^Date$", "日期")) == ymd:
            for d in mg:
                code = str(_pick(d, r"SecuritiesCompanyCode", r"^Code$", "代號") or "").strip()
                if code in out:
                    out[code]["margin"] = {
                        "fin": num(_pick(d, r"MarginPurchaseBalance$", r"MarginPurchase.*Today", "資餘額")),
                        "fin_prev": num(_pick(d, r"MarginPurchase.*Previous", "前資餘額")),
                        "short": num(_pick(d, r"ShortSaleBalance$", r"ShortSale.*Today", "券餘額")),
                        "short_prev": num(_pick(d, r"ShortSale.*Previous", "前券餘額")),
                    }
        elif mg:
            log(f"  TPEx 融資券 日期不符或格式不同，keys={list(mg[0].keys())[:12]}")
    except Exception as e:  # noqa: BLE001
        log("  TPEx 融資券 失敗", e)
    return out


# ---------- 組合一天 ----------

def complete(path):
    try:
        d = json.loads(path.read_text("utf-8"))
        return bool(d.get("stocks")) and d.get("margin") and d.get("inst")
    except Exception:  # noqa: BLE001
        return False


def fetch_day(ymd, with_tpex):
    log(f"[{ymd}] 抓取中…")
    iq = twse_index_and_quotes(ymd)
    if iq is None or not iq["quotes"]:
        log(f"[{ymd}] 無行情資料（休市或尚未公布）")
        return None
    inst = twse_inst_total(ymd)
    by = twse_inst_by_stock(ymd) or {}
    mg = twse_margin(ymd)

    stocks = {}
    for code, q in iq["quotes"].items():
        i = by.get(code)
        m = (mg or {}).get("stocks", {}).get(code)
        # 陣列格式見 README：
        # [名稱, 市場, 收盤, 漲跌, 成交股數, 外資, 投信, 自營, 三大法人合計, 融資餘額, 融資前日, 融券餘額, 融券前日]
        stocks[code] = [q["name"], "twse", q["close"], q["chg"], q["vol"],
                        i and i["foreign"], i and i["trust"], i and i["dealer"], i and i["total"],
                        m and m["fin"], m and m["fin_prev"], m and m["short"], m and m["short_prev"]]

    if with_tpex:
        for code, q in tpex_latest(ymd).items():
            i, m = q.get("inst"), q.get("margin")
            stocks[code] = [q["name"], "otc", q["close"], q["chg"], q["vol"],
                            i and i["foreign"], i and i["trust"], i and i["dealer"], i and i["total"],
                            m and m["fin"], m and m["fin_prev"], m and m["short"], m and m["short_prev"]]

    return {
        "date": f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}",
        "fetched_at": dt.datetime.now(TPE).isoformat(timespec="seconds"),
        "market": iq["market"],
        "inst": inst,
        "margin": mg and mg["summary"],
        "stocks": stocks,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--days", type=int, default=1)
    ap.add_argument("--no-tpex", action="store_true")
    a = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    try:
        closed = set(json.loads(HOLIDAYS.read_text("utf-8")))
    except Exception:  # noqa: BLE001
        closed = set()

    now = dt.datetime.now(TPE)
    if a.date:
        days = [a.date]
    else:
        days, d = [], now.date()
        while len(days) < a.days:
            if d.weekday() < 5:
                days.append(d.strftime("%Y%m%d"))
            d -= dt.timedelta(days=1)
    today = now.strftime("%Y%m%d")

    got = 0
    for ymd in sorted(days):
        path = RAW / f"{ymd}.json"
        if ymd in closed or complete(path):
            continue
        # TPEx OpenAPI 只有最新一日，所以只有抓當天才順便抓上櫃
        day = fetch_day(ymd, with_tpex=(not a.no_tpex and ymd == today))
        if day is None:
            if ymd < today:  # 過去的日子查無資料 = 休市
                closed.add(ymd)
            continue
        # 已存在的上櫃資料不要被回補覆蓋掉
        if path.exists():
            try:
                old = json.loads(path.read_text("utf-8"))
                for code, row in old.get("stocks", {}).items():
                    if row[1] == "otc" and code not in day["stocks"]:
                        day["stocks"][code] = row
            except Exception:  # noqa: BLE001
                pass
        path.write_text(json.dumps(day, ensure_ascii=False, separators=(",", ":")), "utf-8")
        got += 1
        log(f"[{ymd}] 完成：{len(day['stocks'])} 檔，"
            f"法人={'有' if day['inst'] else '無'}，融資券={'有' if day['margin'] else '無'}")

    HOLIDAYS.write_text(json.dumps(sorted(closed)), "utf-8")
    log(f"共更新 {got} 天")


if __name__ == "__main__":
    main()
