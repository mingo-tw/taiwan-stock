#!/usr/bin/env python3
"""scripts/ohlc.py 解析測試（用模擬回應，欄位格式取自實際 API）：python tests/test_ohlc.py"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import fetch  # noqa: E402
import ohlc  # noqa: E402

MI = {"stat": "OK", "tables": [
    {"title": "價格指數", "fields": ["指數", "收盤指數"], "data": [["發行量加權股價指數", "43,091.87"]]},
    {"title": "每日收盤行情", "fields": ["證券代號", "證券名稱", "成交股數", "成交筆數", "成交金額", "開盤價", "最高價", "最低價", "收盤價",
                                   "漲跌(+/-)", "漲跌價差", "最後揭示買價", "最後揭示買量", "最後揭示賣價", "最後揭示賣量", "本益比"],
     "data": [["2330", "台積電", "34,359,285", "1", "1", "2,385.00", "2,395.00", "2,330.00", "2,340.00", "-", "55", "", "", "", "", "27"],
              ["1234", "停牌股", "0", "0", "0", "--", "--", "--", "--", " ", "0", "", "", "", "", ""],
              ["0050", "元大台灣50", "1,000,000", "1", "1", "100.00", "101.00", "99.00", "100.00", "+", "1", "", "", "", "", ""]]}]}
OTC_Q = {"stat": "ok", "tables": [{"fields": ["代號", "名稱", "收盤 ", "漲跌", "開盤 ", "最高 ", "最低", "成交股數  ", " 成交金額(元)"],
         "data": [["5274", "信驊", "11,955.00", "-600.00", "12,000.00", "12,590.00", "11,895.00", "433,000", "1"],
                  ["6488", "環球晶", "300.00", "+1", "299.00", "301.00", "298.00", "1,234,567", "1"],
                  ["70001", "權證", "1", "0", "1", "1", "1", "1", "1"]]}]}
row = lambda code, f, t, d: [code, "x"] + ["0", "0", "0"] * 7 + [str(f), "0", str(t), "0", str(d), "0"][:0]
OTC_I_FIELDS = ["代號", "名稱"] + ["買進股數", "賣出股數", "買賣超股數"] * 7 + ["三大法人買賣超股數合計"]


def insti_row(code, foreign, trust, dealer):
    r = [code, "x"] + ["0"] * 22
    r[4], r[7], r[13], r[22], r[23] = str(foreign), "0", str(trust), str(dealer), str(foreign + trust + dealer)
    return r


OTC_I = {"stat": "ok", "tables": [{"fields": OTC_I_FIELDS, "data": [insti_row("5274", "-78,565", "-17,924", "2,862")]}]}


def fake_get_json(url, params=None, tries=3):
    if "MI_INDEX" in url:
        return MI
    if "afterTrading/otc" in url:
        assert params["type"] == "EW" and params["date"] == "2026/11/11", params
        return OTC_Q
    if "insti/dailyTrade" in url:
        assert params["type"] == "Daily" and params["sect"] == "EW", params
        return OTC_I
    raise AssertionError(url)


def main():
    assert len(OTC_I_FIELDS) == 24
    ohlc.get_json = fake_get_json
    fetch.twse_inst_by_stock = lambda ymd: {"2330": {"foreign": -3955418, "trust": 119745, "dealer": -509842, "total": 0}}
    t = ohlc.twse_day("20261111")
    assert t["2330"] == [2385, 2395, 2330, 2340, 34359, -3955418, 119745, -509842], t["2330"]
    assert "1234" not in t, "停牌股不應收錄"
    assert t["0050"][5:] == [0, 0, 0]
    o = ohlc.otc_day("20261111")
    assert o["5274"] == [12000, 12590, 11895, 11955, 433, -78565, -17924, 2862], o["5274"]
    assert o["6488"][5:] == [0, 0, 0] and "70001" not in o
    shares = {"2330": [25_900_000_000], "0050": [1e9], "5274": [41_582_953], "6488": [480_000_000]}
    kt, ko = ohlc.pick_universe(t, o, shares)
    assert kt == {"2330"} and ko == {"5274", "6488"}, (kt, ko)
    fetch.twse_inst_by_stock = lambda ymd: {}
    assert ohlc.twse_day("20261111") is False, "法人未公布時不可存檔"
    fetch.twse_inst_by_stock = lambda ymd: {"2330": {"foreign": -3955418, "trust": 119745, "dealer": -509842, "total": 0}}
    # 整段流程：寫檔、重跑跳過
    tmp = Path(tempfile.mkdtemp())
    ohlc.OHLC = tmp / "ohlc"
    ohlc.SHARES = tmp / "shares.json"
    ohlc.SHARES.write_text(json.dumps({"items": shares}))
    ohlc.EMPTY = ohlc.OHLC / "_empty.json"
    fetch.HOLIDAYS = tmp / "closed.json"
    import datetime as dt
    class FakeNow(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 11, 12, 22, 0, tzinfo=tz)
    ohlc.dt.datetime = FakeNow
    calls = []
    orig = ohlc.twse_day
    def counting(ymd):
        calls.append(ymd)
        return orig(ymd) if ymd == "20261111" else None
    ohlc.twse_day = counting
    sys.argv = ["ohlc.py", "--days", "3"]
    ohlc.main()
    f = ohlc.OHLC / "20261111.json"
    d = json.loads(f.read_text())
    assert d["date"] == "2026-11-11" and "2330" in d["t"] and "5274" in d["o"], d
    assert json.loads(ohlc.EMPTY.read_text()) == ["20261110"], "過去查無資料的日子（20261110）應記為休市"
    # 20261112（今天）查無資料只是尚未公布：不能記成休市
    first = list(calls)
    ohlc.main()
    assert calls.count("20261111") == 1 and calls.count("20261112") == 2 and calls.count("20261110") == 1, calls
    print("OK ohlc 解析與流程", first)


if __name__ == "__main__":
    main()
