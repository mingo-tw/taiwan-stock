# 台股籌碼追蹤

每個交易日晚間自動抓取證交所／櫃買中心公開資料，部署成 GitHub Pages 靜態網站：

- **總覽**：加權指數、成交金額、三大法人合計、融資餘額、券資比
- **三大法人**：外資／投信／自營商每日買賣超、5 日與 20 日累計
- **融資融券**：融資餘額（金額、張數）、融券餘額、券資比走勢
- **個股查詢**：輸入代號或名稱，看收盤價、法人買賣超（張）、估算資金流入流出、融資融券、券資比；可加入自選
- **估值**（個股頁）：本益比、近 3 年平均／最低／最高本益比、分析師預估 EPS 與前瞻本益比、便宜／合理／昂貴價
- **排行**：法人／外資／投信買賣超、融資增減、券資比

## 架構

```
scripts/fetch.py   抓資料 → data/raw/YYYYMMDD.json（會 commit 進 repo，累積歷史）
scripts/build.py   整理 → site/（不 commit，由 Actions 直接部署）
web/               前端（純 HTML/CSS/JS，無外部套件）
.github/workflows/update.yml  平日 21:47、23:17（台北）自動執行
```

## 第一次設定

1. 把這個資料夾推到一個 GitHub repo 的 `main` 分支。
2. repo → **Settings → Pages → Source** 選 **GitHub Actions**。
3. **Actions → 每日更新台股籌碼 → Run workflow**，`days` 填 `60` 回補歷史（約 15–20 分鐘，證交所有限速）。
4. 完成後網址為 `https://<帳號>.github.io/<repo>/`。

## 資料說明

| 項目 | 來源 | 單位 |
|---|---|---|
| 加權指數、個股收盤 | TWSE MI_INDEX | 點／元 |
| 三大法人（全市場） | TWSE BFI82U | 元（網頁顯示億） |
| 三大法人（個股） | TWSE T86 | 股（網頁顯示張） |
| 融資融券 | TWSE MI_MARGN | 張；融資金額為仟元 |
| 上櫃個股 | TPEx OpenAPI（只有最新一日，盡力而為） | |
| 本益比、淨值比、殖利率 | TWSE BWIBBU_d、TPEx peratio_analysis | 倍／% |
| 近 3 年本益比（僅上市） | 每月最後交易日 BWIBBU_d（scripts/pe_history.py） | 倍 |
| 分析師預估 EPS | Yahoo Finance 共識（yfinance，scripts/estimates.py，每週） | 元 |

- 外資 = 外資及陸資（不含外資自營商），與證交所三大法人合計口徑一致（外資自營商已含在自營商內）。
- 估算資金流 = 三大法人買賣超股數 × 當日收盤價，是概估，不是實際成交金額。
- 券資比 = 融券餘額 ÷ 融資餘額。
- 近四季 EPS = 收盤價 ÷ 本益比。未來 12 個月 EPS = 今年預估 × 今年剩餘月數/12 ＋ 明年預估 × 其餘月數/12。
- 上市：便宜／合理／昂貴價 = EPS × 近 3 年月底本益比的最低／平均／最高。
- 上櫃：沒有官方歷史本益比，不用 3 年本益比；合理價 = 未來 12 個月預估 EPS × 目前本益比。
- 分析師預估只抓成交金額前 300 名上市＋前 100 名上櫃，另可在 `config/extra_codes.txt` 加代號。
- 快照中個股陣列：`[名稱, 市場, 收盤, 漲跌, 成交股數, 外資, 投信, 自營, 法人合計, 融資餘額, 融資前日, 融券餘額, 融券前日]`

## 本機測試

```
python tests/mock_run.py /tmp/demo     # 用模擬資料產生 /tmp/demo/data/raw
```

## Key 登入（Cloudflare Worker）

網站同時部署在 GitHub Pages（永遠開放）與 Cloudflare Workers（可啟用 Key 登入）。

- `worker/index.js`：登入、單一裝置限制、資料存取控管、管理 API；`worker/schema.sql`：D1 資料表
- 使用者用「名稱＋自訂 4 位數密碼」申請，管理員核准後用同一組名稱和密碼登入（內部仍以 Key 管理，使用者看不到）
- 管理頁：`https://<worker 網址>/admin`（用 GitHub secret `ADMIN_PASSWORD` 登入）
  - 切換「開放／需要登入」、審核申請（預設效期 1 年）、直接新增使用者、改到期日、重設密碼、停用／刪除、強制登出、看誰在使用與登入紀錄（時間、裝置、IP）
- 一個帳號同一時間只能一台裝置使用；舊裝置登出、或閒置超過設定時間（預設 3 分鐘）後才能換裝置
- 防猜密碼：同一帳號 1 小時內錯 10 次鎖住（重設密碼即解除）；同一 IP 10 分鐘內錯 20 次暫停
- 資料庫欄位異動放在 `worker/migrate.sh`，部署時自動執行
- 第一次設定：在 repo secrets 加 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_PASSWORD`，再手動執行「Cloudflare 一次性設定」
- 正式啟用 Key 前：把 repo 改成私人並關閉 GitHub Pages，否則資料仍可從 GitHub 取得
