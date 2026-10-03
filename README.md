# TaiOne care · We care you

居護師的 AI 記錄助理：**匯入 PDF（全人評估、病摘）或錄音**，自動轉逐字稿、語意分析，一次產出 **護理紀錄、護理計畫、家屬衛教** 三份草稿；護理師核對後每份一鍵「確認並複製」，整段貼進中衛或院方系統、衛教直接分享到 LINE。

- 手機、平板、電腦同一份程式（響應式 PWA，可加入主畫面當 App 用，也可直接用瀏覽器）
- 資料留在裝置（IndexedDB）；伺服器只轉送 AI 請求、不保存內容
- 伺服器沒有 AI 金鑰時以示範模式運作，整個流程都能操作，輸出標示「示範資料」
- 真實個案連不上 AI 伺服器時，錄音與文件先存在裝置、標示「等網路」，恢復後自動接續（絕不改用示範內容）

## 文件

| 文件 | 內容 |
|---|---|
| [docs/01-research-summary.md](docs/01-research-summary.md) | 現況軟硬體架構、使用者優缺點整合（公開版） |
| [docs/02-user-flow.md](docs/02-user-flow.md) | 先想流程：三案評選後的最終流程規格（狀態機、AI 管線、輸出模板、剪貼簿格式） |
| [docs/03-design-system.md](docs/03-design-system.md) | 視覺系統：參考風格拆解、色票、角色圖示、元件 |
| [docs/04-care-record-export.md](docs/04-care-record-export.md) | 照護紀錄導出：HIS 照護紀錄結構拆解、複製轉發與 PDF 下載 |
| [docs/05-visits-and-assessment.md](docs/05-visits-and-assessment.md) | 初次訪視／再次訪視、全人評估 13 張表與依評估擬定護理計畫 |

## 快速開始

```bash
npm install
npm run dev          # 前端 http://localhost:5173 ＋ API http://localhost:8787
```

設定 AI（選用，未設定即為示範模式）：

```bash
# Claude（語意分析與三份文件撰寫）
export ANTHROPIC_API_KEY=...
# 語音轉文字：Azure Speech（zh-TW）或任何 Whisper 相容服務，擇一
export AZURE_SPEECH_ENDPOINT=https://<region>.api.cognitive.microsoft.com
export AZURE_SPEECH_KEY=...
# export WHISPER_BASE_URL=http://localhost:8000   WHISPER_API_KEY=...   WHISPER_MODEL=...
# 機構通行碼（建議正式環境設定）：除 /api/health 外，所有 /api 請求都要帶 X-Access-Code
export ACCESS_CODE=...
```

其他伺服器設定（皆為選用）：

| 變數 | 預設 | 說明 |
|---|---|---|
| `STT_PROVIDER` | 自動 | `azure` 或 `whisper`；指定了卻缺金鑰或網址時伺服器不會啟動 |
| `RATE_LIMIT_AI_PER_MIN` | 30 | 每個 IP 每分鐘的分析＋撰寫＋翻譯次數 |
| `RATE_LIMIT_TRANSCRIBE_PER_MIN` | 20 | 每個 IP 每分鐘的轉文字次數 |
| `TRUST_PROXY` | 0 | 前面有幾層反向代理；部署在代理後方務必設定，否則所有人共用同一個限流額度 |

伺服器拒絕跨站請求、只接受 PDF／JPEG／PNG／WebP／GIF 文件（並核對檔案內容與類型相符），單張照片上限 5 MB（App 會先縮圖）。

設定了 Claude 但沒有設定語音轉文字時，錄音會回報「尚未設定語音轉文字」，不會悄悄用示範逐字稿。
設定 `ACCESS_CODE` 後，護理師在 App 的「設定 → AI 服務 → 機構通行碼」輸入一次即可（只存在該裝置）。

正式部署：

```bash
npm run build && npm start   # Node 伺服器同時提供 dist/ 與 /api
```

只部署靜態檔（沒有 `/api`）時：示範個案用 App 內建示範引擎；真實個案會等到連上 AI 伺服器才處理。
教學或試用時可在「設定 → AI 服務 → 示範模式」開啟，所有新紀錄都用內建示範內容、不呼叫 AI。

## 架構

```
手機／電腦（React PWA，IndexedDB 本機保存）
  ├─ 錄音（MediaRecorder，每秒落地，可中斷續錄）
  ├─ 匯入 PDF／照片／音檔（拖放或選檔）
  └─ /api ──► Hono 伺服器（不保存內容、不記錄內文）
               ├─ /api/transcribe  STT adapter：Azure Speech zh-TW｜Whisper 相容｜示範
               │                   → OpenCC 轉台灣正體
               ├─ /api/analyze     Claude 結構化輸出：生命徵象（原句、信心、合理範圍）、
               │                   評估異動、計畫建議、文件重點（PDF 原生讀取）
               ├─ /api/generate    三份文件平行撰寫（紀錄／計畫／衛教），AI 不寫數字
               └─ /api/translate   衛教翻譯（印尼／越南／泰）
```

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發（前端＋API） |
| `npm run build` | 型別檢查＋建置 |
| `npm test` | 單元測試 |
| `npm start` | 正式伺服器 |
