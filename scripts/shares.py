#!/usr/bin/env python3
"""
抓上市／上櫃公司的已發行普通股數（算市值用），存成 data/shares.json。
來源：TWSE OpenAPI t187ap03_L、TPEx OpenAPI mopsfin_t187ap03_O。約每週更新一次。
"""
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch  # noqa: E402

OUT = fetch.ROOT / "data" / "shares.json"


def main():
    force = "--force" in sys.argv
    now = dt.datetime.now(fetch.TPE)
    try:
        old = json.loads(OUT.read_text("utf-8"))
        if not force and now - dt.datetime.fromisoformat(old["updated"]) < dt.timedelta(days=6):
            fetch.log("股數資料一週內更新過，略過")
            return
    except Exception:  # noqa: BLE001
        old = {"items": {}}
    items = dict(old.get("items", {}))
    n = 0
    for url, mkt in (("https://openapi.twse.com.tw/v1/opendata/t187ap03_L", "twse"),
                     (f"{fetch.TPEX_OPENAPI}/mopsfin_t187ap03_O", "otc")):
        rows = fetch.get_json(url) or []
        for d in rows:
            code = str(fetch._pick(d, r"^公司代號$", r"SecuritiesCompanyCode") or "").strip()
            sh = fetch.num(fetch._pick(d, r"已發行普通股數", r"IssueShares"))
            ind = str(fetch._pick(d, r"^產業別$", r"SecuritiesIndustryCode") or "").strip()
            if code and sh:
                items[code] = [sh, ind, mkt]
                n += 1
        fetch.log(f"{mkt} 公司基本資料 {len(rows)} 筆")
    if n:
        OUT.write_text(json.dumps({"updated": now.isoformat(timespec="seconds"), "items": items},
                                  ensure_ascii=False, separators=(",", ":")), "utf-8")
    fetch.log(f"股數資料更新 {n} 檔")


if __name__ == "__main__":
    main()
