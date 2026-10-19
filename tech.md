# 技術實作

## 架構

```text
src/
├─ index.html                 頁面骨架、啟動頁、設置頁；線上只讀開關
├─ nestedtext-core.js         解析、查表、索引、加權、DAG（瀏覽器與 Node 共用）
├─ app/                       應用程式原始碼，建置時依檔名串成一個 IIFE
│  ├─ 00-core.js              共用狀態、設定、網域與小工具
│  ├─ 10-boot.js              閱讀歷史、啟動頁、TSV 載入
│  ├─ 20-edit-legacy.js       舊 textarea 編輯器與建議標記
│  ├─ 21-edit-cm.js           CodeMirror 編輯、草稿、存檔
│  ├─ 22-orphans.js           孤兒節點與缺目標
│  ├─ 30-route.js             路由與導覽
│  ├─ 31-focus.js             展開狀態與焦點
│  ├─ 40-read.js              DOM 閱讀渲染與反鏈接
│  ├─ 41-hover.js             Hover popup
│  ├─ 42-entry.js             條目頁、文內搜尋插入與標記
│  ├─ 50-graph.js             圖譜
│  ├─ 60-search.js            搜尋
│  ├─ 70-export.js            Export 單一 HTML
│  └─ 80-main.js              初始化與事件接線
├─ offtext-app.js             app bundle（GENERATED，IIFE）
├─ nestedtext-settings.js     主題與繁簡三態
├─ nestedtext-simplified.js   無損／強制簡體
├─ simplified-data.js         繁簡對照表（GENERATED）
├─ editor/
│  ├─ index.js                CodeMirror 6 桌面閱讀／編輯、巢狀 widget、補全、取消標記
│  └─ parse.js                帶位置的 offtext 解析
├─ offtext-cm.js              CM6 bundle（GENERATED，IIFE，桌面按需載入）
└─ tools/                     建置、測試、健檢、部署
```

- **線上只讀**：`index.html` 設定 `window.OFFTEXT_READONLY_ONLY`；部署到非 localhost 時永遠只讀。桌面與手機都只閱讀，不顯示編輯、存檔、孤兒、Export。
- **本機測試編輯**：只有 `file://` 或 `localhost` 加 `?edit=1` 才會載入編輯功能，供測試與日後 EXE 版沿用。
- **桌面**：閱讀使用同一個 `EditorView`；閱讀只是 `EditorState.readOnly`，游標仍在。編輯只在 `?edit=1` 的本機模式啟用。
- **巢狀**：展開的引用在 widget 內再掛一個唯讀 `EditorView`，共用同一組 decoration／theme／resolve 規則。
- **手機**：不載入 CM6，使用 DOM 渲染；啟動時自動載入 manifest 全部科目。
- **hover／export**：用 DOM renderer，不建 CM6 view；export runtime 自帶解析與渲染，不依賴外部檔案。手機與 hover 的 DOM 渲染沿用 `src/app/40-read.js` 的 `renderDoc`／`renderRef`。
- **lazy CM6**：`index.html` 不直接載入 `offtext-cm.js`；桌面 boot 時才由 `ensureCM()` 注入。手機完全不下载。

## 閱讀與編輯

- `^[...]` 以 replace/block widget 呈現；游標移入 offtag 時顯示原始碼，移出時隱藏控制代碼。
- `^` 自動補成 `^[]`，游標停在括號內並列出可插入條目；打字即時過濾。
- Backspace／Delete 在括號邊界會一次刪除 `[` 與 `]`。
- 夾文最多 16 字。
- 編輯改動只進 `drafts`，不呼叫 `NT.buildIndex()`；存檔才 commit、validate、rebuild 一次。
- 存檔計數是「有變更的條目數」，不是按鍵次數。

## 文內搜尋

- 編輯 A 時，反鏈區的「文內搜尋」列出本科提到 A、但尚未加連結的條目。
- 點「前往」跳到 B，插入 `^[A]`；CM6 的 `insertedField` 在標記旁顯示「取消」。
- 取消只移除這次插入的範圍；若使用者已改動該範圍，標記會自動失效。
- B 的反鏈區用 draft 暫時顯示 A（`新` 標籤），不重建全域索引；存檔後才變成正式反鏈。

## 索引、加權與 DAG

- `buildIndex()` 一次算好 links、weights、rankings；UI 不重掃全部條目。
- 加權是衰減 BFS：直接 1、間接 0.5、二跳 0.25，最多 6 跳；同節點取最短距離一次。
- `buildDag()` 用 Tarjan SCC 找環，再將分量縮成 DAG 分層；`inversions` 用「基礎度」找基礎概念回頭定義高階概念的邊。
- `node src/tools/knowledge-audit.mjs` 輸出樞紐、基礎節點、環與反轉候選。

## 建置

```powershell
npm install
npm run build        # build:app → build:editor → build（複製前端檔、manifest）
node src/tools/serve.mjs --port 8123
```

- 改 `src/app/*.js` 時跑 `npm run build:app`；只改 CSS 時跑 `node src/tools/build.mjs`。
- 改 `src/editor/*.js` 時要先跑 `npm run build:editor`。
- `src/offtext-app.js`、`src/offtext-cm.js` 是產物，但保留在版本庫，讓 `file://` 直接開 `src/index.html` 也能運作。
- `build/` 頂層每次重建；`build/shots/` 保留。

## 測試

```powershell
node src/tools/test-core.mjs
node src/tools/test-simplified.mjs
node src/tools/cm-test.mjs
node src/tools/cm-file-test.mjs
node src/tools/cm-block-test.mjs
node src/tools/http-test.mjs
node src/tools/boot-test.mjs
node src/tools/hover-test.mjs
node src/tools/intext-test.mjs
node src/tools/mobile-test.mjs
node src/tools/export-test.mjs
node src/tools/contrast-test.mjs
node src/tools/topbar-test.mjs
node src/tools/click-test.mjs
node src/tools/settings-test.mjs
node src/tools/graph-test.mjs
node src/tools/layout-check.mjs
node src/tools/audit.mjs
node src/tools/knowledge-audit.mjs
```

## 已知限制

- 展開狀態只存在記憶體，沒有寫進 URL。
- 行內巢狀在 CM6 是 inline-block；較長的展開會佔滿一行。
- TSV 還沒有多行 value 的跳脫規則；value 必須是單行。
- 顯示名只做「名字 → key」的單向解析，不會自動改寫顯示成中文。
- 對照頁不進索引、搜尋、歷史與 export。
- 圖譜是靜態佈局，沒有拖曳、縮放或動畫；節點上限 48。
- 手機模式固定簡化介面；桌面可在設置頁切換，手機不能切回桌面。
- export 只包含目前條目可達的內容，不含索引、搜尋、圖譜與編輯功能。

## 部署

```powershell
npm run build
node src/tools/deploy-offtext.mjs --check
node src/tools/deploy-offtext.mjs
```

目標是 `https://shutonggui.cn/offtext/`；連線憑證沿用 `D:\2026\adb-converter\.local\server.env` 與 `hostkey.txt`，不會印出。
