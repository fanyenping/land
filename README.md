# TaiOne care · We care

居護師的 AI 記錄助理：**匯入 PDF（全人評估、病摘）或錄音**，自動轉逐字稿、語意分析，一次產出 **護理紀錄、護理計畫、家屬衛教** 三份草稿；護理師核對後每份一鍵「確認並複製」，整段貼進中衛或院方系統、衛教直接分享到 LINE。

- 手機、平板、電腦同一份程式（響應式 PWA，可加入主畫面當 App 用，也可直接用瀏覽器）
- 資料留在裝置（IndexedDB）；伺服器只轉送 AI 請求、不保存內容
- 沒有 AI 金鑰時自動進入示範模式，整個流程都能操作，輸出標示「示範資料」

## 文件

| 文件 | 內容 |
|---|---|
| [docs/01-research-summary.md](docs/01-research-summary.md) | 現況軟硬體架構、使用者優缺點整合（公開版） |
| [docs/02-user-flow.md](docs/02-user-flow.md) | 先想流程：三案評選後的最終流程規格（狀態機、AI 管線、輸出模板、剪貼簿格式） |
| [docs/03-design-system.md](docs/03-design-system.md) | 視覺系統：參考風格拆解、色票、角色圖示、元件 |

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
```

正式部署：

```bash
npm run build && npm start   # Node 伺服器同時提供 dist/ 與 /api
```

只部署靜態檔（沒有 `/api`）時，App 會自動改用內建示範引擎。

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
