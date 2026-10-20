# 巢式文字 Offtext

Offtext 是一種以 `^[...]` 標記的巢狀文字：正文保持可讀，引用可以在原處展開，展開的內容本身也可以再引用，實現「注中有注」。

- 目標：兼顧入門與進階閱讀，讓讀者自己決定閱讀洞線。
- 不熟的名詞可以展開；已熟悉的可以跳過。
- 一份 plain text 加 offtag，適合序列化、合併與轉成 Obsidian backlink 文件。
- 詞典網路以 DAG 為理想：高階概念由基本概念組成，不用高階概念回頭定義基本概念。

## 文件

| 文件 | 內容 |
| --- | --- |
| [goal.md](goal.md) | 設計目標 |
| [knowledge.md](knowledge.md) | 科目介紹、知識網路加權、DAG 規範與 pilot |
| [knowledge-pilot.md](knowledge-pilot.md) | 物理科 DAG pilot：分層、樞紐與第一批編輯建議 |
| [knowledge-pilot-math.md](knowledge-pilot-math.md) | 數學科 DAG pilot：拆環、補鏈、分層與樞紐 |
| [math-expand-plan.md](math-expand-plan.md) | 數學擴寫計畫：線性代數、微積分、大陸術語與 `@tw` 對照 |
| [editorial-guide.md](editorial-guide.md) | 編輯指南：新增科目或大修訂時，如何把引用編成 DAG |
| [datastructure.md](datastructure.md) | TSV、引用、對照頁、索引與存檔格式 |
| [tech.md](tech.md) | CM6、DOM renderer、lazy load、建置與測試 |
| [ui.md](ui.md) | 啟動、閱讀、編輯、索引、圖譜、hover、手機、export |
| [basicofftag.md](basicofftag.md) | offtag 基本語法 |
| [planning.md](planning.md) | 本次重構的原始規劃 |
| [CONTENT_TODO.md](CONTENT_TODO.md) | 內容 DAG 待辦、token 與工時估算 |

## 快速開始

```powershell
npm install
npm run build
node src/tools/serve.mjs --port 8123
```

HTTP 開 `http://127.0.0.1:8123/`（會轉到 `build/index.html`）；它會讀 `data/data-index.txt` 自動載入列出的科目，直接進主畫面。`file://` 直接開 `build/index.html`，才顯示「選擇本機 TSV…」載入頁。

- 線上版只提供閱讀：桌面與手機都能展開、hover、索引、搜尋與圖譜，不顯示編輯／存檔／孤兒／Export。
- 本機 `file://` 或 `localhost` 加 `?edit=1` 才開啟編輯，供測試與日後單機 EXE 版沿用；部署網域即使加 `?edit=1` 仍只讀。
- 桌面閱讀使用 CodeMirror 6；閱讀只是唯讀，游標仍在。手機不載入 CM6。
- 本機編輯模式的改動先存在草稿；按「存檔（N）」才檢查、重建索引，並在可用時寫回 TSV。
- 設置可調閱讀字級 12–24px（標題、正文、輸入區、反鏈接）；圖譜節點字級在圖譜面板另設。
- 右上角 🦮 導覽：快速入門約一分鐘，帶過介面、索引排序與展開引用；進階設置與編輯文本先預留。
- 文字／圖譜用單一 toggle；圖譜選取節點後可用「設成中心」換根，不必按 Ctrl。

## 資料

`data/` 目前有 16 個科目、1,830 個內容條目。科目清單與統計見 [knowledge.md](knowledge.md)。資料檔不預先打包；HTTP 啟動時只讀 `data/data-index.txt` 的清單，再逐一 fetch TSV 內容。要改載入哪些科目，編輯 `data/data-index.txt` 即可（一行一個檔名，`#` 開頭是註解）。

## 建置與驗證

```powershell
npm run build
node src/tools/test-core.mjs
node src/tools/test-simplified.mjs
node src/tools/knowledge-audit.mjs
node src/tools/boot-test.mjs
node src/tools/cm-test.mjs
node src/tools/cm-file-test.mjs
node src/tools/hover-test.mjs
node src/tools/intext-test.mjs
node src/tools/mobile-test.mjs
node src/tools/export-test.mjs
node src/tools/topbar-test.mjs
```

完整的測試與部署說明見 [tech.md](tech.md)。部署前先跑 `node src/tools/deploy-offtext.mjs --check`。
