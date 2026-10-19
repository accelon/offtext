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
| [datastructure.md](datastructure.md) | TSV、引用、對照頁、索引與存檔格式 |
| [tech.md](tech.md) | CM6、DOM renderer、lazy load、建置與測試 |
| [ui.md](ui.md) | 啟動、閱讀、編輯、索引、圖譜、hover、手機、export |
| [basicofftag.md](basicofftag.md) | offtag 基本語法 |
| [planning.md](planning.md) | 本次重構的原始規劃 |

## 快速開始

```powershell
npm install
npm run build
node src/tools/serve.mjs --port 8123
```

HTTP 開 `http://127.0.0.1:8123/build/index.html`；啟動頁勾選科目後按「開啟選定的科目」。`file://` 直接開 `build/index.html`，用「選擇本機 TSV…」載入。

- 桌面閱讀與編輯共用同一個 CodeMirror 6 view；閱讀只是唯讀，游標仍在。
- 手機／平板不載入 CM6，使用簡化介面，啟動時自動載入全部科目。
- 改動先存在草稿；按「存檔（N）」才檢查、重建索引，並在可用時寫回 TSV。
- 桌面編輯模式的 Export 會把目前條目與可達引用打包成單一 HTML，不含 CM6。

## 資料

`data/` 目前有 16 個科目、1,818 個內容條目。科目清單與統計見 [knowledge.md](knowledge.md)。資料檔不預先打包；啟動頁只讀 `data/` 的檔名與 meta，載入後才 fetch 內容。

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
```

完整的測試與部署說明見 [tech.md](tech.md)。部署前先跑 `node src/tools/deploy-offtext.mjs --check`。
