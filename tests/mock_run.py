"""用模擬的證交所/櫃買 JSON 測試 fetch.py 解析器，產生示範資料。
用法：python tests/mock_run.py [輸出資料夾]  （預設寫到 tests/_mock_root）"""
import datetime as dt
import importlib.util
import random
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("fetch", HERE.parent / "scripts" / "fetch.py")
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)

random.seed(7)
STOCKS = [("2330", "台積電", 1050), ("2317", "鴻海", 210), ("2454", "聯發科", 1350), ("2881", "富邦金", 88),
          ("2890", "永豐金", 26), ("0050", "元大台灣50", 195), ("2603", "長榮", 210), ("3231", "緯創", 120),
          ("2382", "廣達", 290), ("6669", "緯穎", 2800)] + [(str(1100 + i), f"測試{i}", 30 + i) for i in range(40)]
OTC = [("6488", "環球晶", 480), ("5347", "世界", 95)]
price = {c: p for c, _, p in STOCKS + OTC}
taiex = [22000.0]
fin_bal = {c: random.randint(1000, 40000) for c, _, _ in STOCKS}
sho_bal = {c: random.randint(10, 3000) for c, _, _ in STOCKS}
mkt = {"fin": 7_400_000, "short": 260_000, "amt": 330_000_000}
cache = {}


def c(n, d=0):
    return f"{n:,.{d}f}"


def sign(x):
    return "<p style= color:red>+</p>" if x > 0 else "<p style= color:green>-</p>" if x < 0 else " "


def day_data(ymd):
    if ymd in cache:
        return cache[ymd]
    ch = random.gauss(0, 150)
    prev = taiex[-1]; taiex.append(prev + ch)
    quotes, t86, margin = [], [], []
    for code, name, _ in STOCKS:
        p0 = price[code]; p1 = round(p0 * (1 + random.gauss(0, 0.015)), 1); price[code] = p1
        vol = random.randint(1_000_000, 40_000_000)
        quotes.append([code, name, c(vol), "1,234", c(vol * p1), c(p0, 2), c(p1, 2), c(p0, 2), c(p1, 2),
                       sign(p1 - p0), c(abs(p1 - p0), 2), "", "", "", "", "0.00"])
        f, fd, t, d = (random.randint(-3_000_000, 3_000_000), random.randint(-2000, 2000),
                       random.randint(-500_000, 500_000), random.randint(-300_000, 300_000))
        t86.append([code, name, "0", "0", c(f), "0", "0", c(fd), "0", "0", c(t), c(d), "0", "0", "0", "0", "0", "0", c(f + fd + t + d)])
        fp, sp = fin_bal[code], sho_bal[code]
        fin_bal[code] = max(0, fp + random.randint(-800, 800)); sho_bal[code] = max(0, sp + random.randint(-200, 200))
        margin.append([code, name, "1", "1", "0", c(fp), c(fin_bal[code]), "999", "1", "1", "0", c(sp), c(sho_bal[code]), "999", "0", ""])
    fp, sp, ap = mkt["fin"], mkt["short"], mkt["amt"]
    mkt["fin"] += random.randint(-40000, 40000); mkt["short"] += random.randint(-8000, 8000); mkt["amt"] += random.randint(-3_000_000, 3_000_000)
    fi, tr, de = random.gauss(0, 1.5e10), random.gauss(0, 3e9), random.gauss(0, 2e9)
    cache[ymd] = {
        "MI_INDEX": {"stat": "OK", "date": ymd, "tables": [
            {"title": "價格指數(臺灣證券交易所)", "fields": ["指數", "收盤指數", "漲跌(+/-)", "漲跌點數", "漲跌百分比(%)", "特殊處理註記"],
             "data": [["寶島股價指數", "1", " ", "0", "0", ""],
                      ["發行量加權股價指數", c(taiex[-1], 2), sign(ch), c(abs(ch), 2), c(abs(ch) / prev * 100, 2), ""]]},
            {"title": "大盤統計資訊", "fields": ["成交統計", "成交金額(元)", "成交股數(股)", "成交筆數"],
             "data": [["1.一般股票", "1", "1", "1"], ["總計(1~15)", c(random.uniform(3e11, 6e11)), "1", "1"]]},
            {"title": "每日收盤行情(全部(不含權證、牛熊證))", "fields": ["證券代號", "證券名稱", "成交股數", "成交筆數", "成交金額", "開盤價", "最高價", "最低價", "收盤價", "漲跌(+/-)", "漲跌價差", "最後揭示買價", "最後揭示買量", "最後揭示賣價", "最後揭示賣量", "本益比"],
             "data": quotes}]},
        "BFI82U": {"stat": "OK", "tables": [{"fields": ["單位名稱", "買進金額", "賣出金額", "買賣差額"], "data": [
            ["自營商(自行買賣)", "1", "1", c(de * 0.4)], ["自營商(避險)", "1", "1", c(de * 0.6)], ["投信", "1", "1", c(tr)],
            ["外資及陸資(不含外資自營商)", "1", "1", c(fi)], ["外資自營商", "0", "0", "0"], ["合計", "1", "1", c(fi + tr + de)]]}]},
        "T86": {"stat": "OK", "tables": [{"fields": ["證券代號", "證券名稱", "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)", "外陸資買賣超股數(不含外資自營商)", "外資自營商買進股數", "外資自營商賣出股數", "外資自營商買賣超股數", "投信買進股數", "投信賣出股數", "投信買賣超股數", "自營商買賣超股數", "自營商買進股數(自行買賣)", "自營商賣出股數(自行買賣)", "自營商買賣超股數(自行買賣)", "自營商買進股數(避險)", "自營商賣出股數(避險)", "自營商買賣超股數(避險)", "三大法人買賣超股數"], "data": t86}]},
        "MI_MARGN": {"stat": "OK", "tables": [
            {"title": "信用交易統計", "fields": ["項目", "買進", "賣出", "現金(券)償還", "前日餘額", "今日餘額"], "data": [
                ["融資(交易單位)", "1", "1", "1", c(fp), c(mkt["fin"])], ["融券(交易單位)", "1", "1", "1", c(sp), c(mkt["short"])],
                ["融資金額(仟元)", "1", "1", "1", c(ap), c(mkt["amt"])]]},
            {"title": "融資融券彙總", "fields": ["代號", "名稱", "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額", "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額", "資券互抵", "註記"], "data": margin}]},
    }
    return cache[ymd]


def roc(ymd):
    return f"{int(ymd[:4]) - 1911}{ymd[4:]}"


def fake_get_json(url, params=None, tries=3):
    p = params or {}
    ymd = p.get("date") or p.get("dayDate")
    if "openapi" in url:
        today = dt.datetime.now(fetch.TPE).strftime("%Y%m%d")
        if url.endswith("daily_close_quotes"):
            return [{"Date": roc(today), "SecuritiesCompanyCode": cd, "CompanyName": n, "Close": str(pz), "Change": "+1.5", "TradingShares": "123456"} for cd, n, pz in OTC]
        if url.endswith("3insti_daily_trading"):
            return [{"Date": roc(today), "SecuritiesCompanyCode": cd, "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference": "120000",
                     "Securities Investment Trust Companies-Difference": "-30000", "Dealers-Difference": "5000", "TotalDifference": "95000"} for cd, _, _ in OTC]
        if url.endswith("margin_balance"):
            return [{"Date": roc(today), "SecuritiesCompanyCode": cd, "MarginPurchaseBalance": "5000", "MarginPurchaseBalancePreviousDay": "4800",
                     "ShortSaleBalance": "300", "ShortSaleBalancePreviousDay": "320"} for cd, _, _ in OTC]
        return []
    if dt.datetime.strptime(ymd, "%Y%m%d").strftime("%m%d") == "1010":  # 模擬國慶休市
        return {"stat": "很抱歉，沒有符合條件的資料!"}
    key = url.rsplit("/", 1)[1]
    return day_data(ymd)[key]


if __name__ == "__main__":
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "_mock_root"
    if root.exists():
        shutil.rmtree(root)
    (root / "data").mkdir(parents=True)
    fetch.RAW = root / "data" / "raw"
    fetch.HOLIDAYS = root / "data" / "no_trading_days.json"
    fetch.get_json = fake_get_json
    sys.argv = ["fetch.py", "--days", "70"]
    fetch.main()
