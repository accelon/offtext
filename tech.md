# 技術實作

## 架構

```text
src/
├─ index.html                 頁面骨架、啟動頁、設置頁；線上只讀開關
├─ nestedtext-core.ts         解析、查表、索引、加權、DAG（瀏覽器與 Node 共用）
├─ app/                       應用程式原始碼（TypeScript），建置時依檔名串成一個 IIFE
│  ├─ 00-core.ts              共用狀態、設定、網域與小工具
│  ├─ 10-boot.ts              閱讀歷史、啟動頁、TSV 載入
│  ├─ 20-edit-legacy.ts       舊 textarea 編輯器與建議標記
│  ├─ 21-edit-cm.ts           CodeMirror 編輯、草稿、存檔
│  ├─ 22-orphans.ts           孤兒節點與缺目標
│  ├─ 30-route.ts             路由與導覽
│  ├─ 31-focus.ts             展開狀態與焦點
│  ├─ 40-read.ts              DOM 閱讀渲染與反鏈接
│  ├─ 41-hover.ts             Hover popup
│  ├─ 42-entry.ts             條目頁、文內搜尋插入與標記
│  ├─ 50-graph.ts             圖譜
│  ├─ 70-export.ts            Export 單一 HTML
│  ├─ 80-main.ts              初始化與事件接線
│  └─ 90-tour.ts              🦮 導覽：聚光燈、5 秒步進、選單與示範腳本
├─ offtext-app.js             app bundle（GENERATED，IIFE）
├─ nestedtext-settings.ts     主題與繁簡三態
├─ nestedtext-simplified.ts   無損／強制簡體
├─ simplified-data.js         繁簡對照表（GENERATED）
├─ editor/
│  ├─ index.ts                CodeMirror 6 桌面閱讀／編輯、巢狀 widget、補全、取消標記
│  └─ parse.ts                帶位置的 offtext 解析
├─ offtext-cm.js              CM6 bundle（GENERATED，IIFE，桌面按需載入）
├─ types/globals.d.ts         跨檔共享的瀏覽器全域（刻意寬鬆）
└─ tools/                     建置、測試、健檢、部署
```

- **TypeScript 策略**：原始碼是 `.ts`，但型別只求「能編譯、能檢查」，大量沿用原本的動態結構；`tsconfig.json` 不開 `strict`。app 區段以檔名順序串在同一個 IIFE，`build-app.mjs` 會另外產生 `src/.tmp/offtext-app.typecheck.ts` 供 `tsc` 檢查同一個作用域。
- **產生檔**：`src/*.js`（core／settings／simplified／offtext-app／offtext-cm）都是產物，仍留在版控，讓 `file://` 直接開 `src/index.html` 也能運作；改 `.ts` 後重跑 `npm run build`。
- **線上只讀**：`index.html` 設定 `window.OFFTEXT_READONLY_ONLY`；只有 `file://`、`127.0.0.1`、`localhost` 或 Wails 的 `wails.localhost` 加 `?edit=1` 才可編輯。部署到網站的版本無論有無 `?edit=1` 都只讀。
- **本機測試編輯**：`file://`／localhost 加 `?edit=1`；桌面版由 Go 以 `/?edit=1` 啟動，host 是 `wails.localhost`，所以行為與 localhost 一致。
- **桌面**：閱讀使用同一個 `EditorView`；閱讀只是 `EditorState.readOnly`，游標仍在。桌面版可編輯，存檔走與 localhost 相同的 `POST /api/tsv/<file>`。
- **巢狀**：展開的引用在 widget 內再掛一個唯讀 `EditorView`，共用同一組 decoration／theme／resolve 規則。
- **手機**：不載入 CM6，使用 DOM 渲染；HTTP(S) 啟動時同樣讀 `data-index.txt` 自動載入。
- **啟動載入**：HTTP(S) 讀 `data/data-index.txt`（一行一個 TSV）直接進主畫面；`file://` 才顯示本機選檔頁。`?data=id1,id2` 仍可指定科目。
- **桌面資料**：Wails 版啟動時掃描執行檔旁 `data/` 的所有 `*.tsv`，讀入 Go 記憶體，再由 `/data/` 路由供前端既有的 `fetch` 使用；`data-index.txt` 只決定順序。
- **桌面存檔**：`DataService` 的 `assetHandler` 攔截 `POST /api/tsv/<file>`，只允許啟動時載入的檔名，檢查 meta id 與檔名一致、UTF-8、8 MiB 上限，先寫 `.tmp` 再原子替換，並更新記憶體快照。錯誤會回 JSON `{ok:false,error}`，前端顯示在存檔提示。
- **導覽**：右上角 🦮 開三個項目；快速入門約 14 步 × 5 秒，點畫面可提前，Esc／× 可隨時結束，最後停在圖譜模式。進階設置與編輯文本先預留。
- **索引入口**：頂欄最左邊的單色小屋圖示；頂欄不再另設搜尋框，搜尋只在索引頁。
- **hover／export**：用 DOM renderer，不建 CM6 view；export runtime 自帶解析與渲染，不依賴外部檔案。手機與 hover 的 DOM 渲染沿用 `src/app/40-read.ts` 的 `renderDoc`／`renderRef`。
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

- `buildIndex()` 一次算好 links、weights；UI 不重掃全部條目。
- 加權是衰減 BFS：直接 1、間接 0.5、二跳 0.25，最多 6 跳；同節點取最短距離一次。
- `buildDag()` 用 Tarjan SCC 找環，再將分量縮成 DAG 分層；`inversions` 用「基礎度」找基礎概念回頭定義高階概念的邊。
- `node src/tools/knowledge-audit.mjs` 輸出樞紐、基礎節點、環與反轉候選。
- 圖譜選取節點後顯示「設成中心」，以 `navigateGraph(..., { recenter: true })` 留在圖譜模式換根。
- 圖譜邊線使用 SVG marker `graph-arrow`，順鏈（實線）與逆鏈（虛線）都指向目標。
- `buildGraph` 以 `from→to` 去重，同時有 forward／back 時保留 forward，避免後畫的逆鏈虛線蓋住順鏈實線；聚焦逆鏈時加 `.is-inverse` 顯示虛線。
- 圖譜節點可切圓形／矩形；矩形依文字寬高計算尺寸，碰撞改用 AABB，畫布高度再乘 0.8，節點多時更緊湊。
- 圖譜的層數、連線長度、線粗、節點形狀是 `.seg` 多態按鈕：群組 id 如 `#graphDepth`，按鈕用 `data-value` 與 `aria-pressed` 表示選取，不再使用 `<select>`。
- 圖譜設定浮在畫布右側；捲過畫布頂端後改成 fixed，背景 80% 不透明且不模糊，節點仍可見。畫布高度依節點數縮短，減少上下留白。

## 建置

```powershell
npm install
npm run build        # build-lib → build-app → tsc → build-editor → build.mjs
npm run typecheck    # 只跑 tsc
node src/tools/serve.mjs --port 8123
```

- `npm run build` 的順序：`src/*.ts` 轉成瀏覽器 `.js` → 串 app bundle → `tsc --noEmit` → CM6 bundle → 複製到 `build/` 並產生 `tsv-manifest.js`。型別檢查失敗會讓建置失敗。
- 改 `src/app/*.ts` 時跑 `npm run build:app`（只轉譯，不檢查）；要完整驗證就重跑 `npm run build`。
- 改 `src/editor/*.ts` 時要先跑 `npm run build:editor`。
- `src/nestedtext-core.js`、`nestedtext-settings.js`、`nestedtext-simplified.js` 由 `build-lib.mjs` 從同名 `.ts` 產生；`src/offtext-app.js`、`src/offtext-cm.js` 也是產物，但保留在版本庫，讓 `file://` 直接開 `src/index.html` 也能運作。
- HTTP(S) 要載入哪些科目由 `data/data-index.txt` 決定；改完直接重新整理即可，不用重建。
- `build/` 頂層每次重建；`build/shots/` 保留。
- 桌面版：`npm run desktop:build`（固定「先前端、後 `go build`」），詳見 [desktop/README.md](desktop/README.md)。

## 測試

瀏覽器測試需要先跑 `node src/tools/serve.mjs --port 8123`。桌面版另外有 headless 自檢與
CDP 煙霧測試。

```powershell
npm run typecheck
node src/tools/test-core.mjs
node src/tools/test-simplified.mjs
node src/tools/cm-test.mjs
node src/tools/cm-file-test.mjs
node src/tools/cm-block-test.mjs
node src/tools/http-test.mjs
node src/tools/boot-test.mjs
node src/tools/tour-test.mjs
node src/tools/hover-test.mjs
node src/tools/intext-test.mjs
node src/tools/mobile-test.mjs
node src/tools/export-test.mjs
node src/tools/save-test.mjs
node src/tools/contrast-test.mjs
node src/tools/topbar-test.mjs
node src/tools/click-test.mjs
node src/tools/settings-test.mjs
node src/tools/graph-test.mjs
node src/tools/layout-check.mjs
node src/tools/audit.mjs
node src/tools/knowledge-audit.mjs

npm run desktop:selftest
npm run desktop:smoke
cd desktop; go test ./...
```

## 設置

- `offtext.theme.v1`：亮底／暗底／護眼。
- `offtext.simmode.v1`：0 原樣、1 無損簡體、2 強制簡體。
- `offtext.fontsize.v1`：12–24，預設 17；寫入 `--reading-size`，控制標題、正文、CM6 內容與反鏈接。圖譜節點字級仍是 `state.graph.fontSize`，兩者獨立。

## 已知限制

- 展開狀態只存在記憶體，沒有寫進 URL。
- 行內巢狀在 CM6 是 inline-block；較長的展開會佔滿一行。
- TSV 還沒有多行 value 的跳脫規則；value 必須是單行。
- 顯示名只做「名字 → key」的單向解析，不會自動改寫顯示成中文。
- 對照頁不進索引、搜尋、歷史與 export。
- 圖譜是靜態佈局，沒有拖曳、縮放或動畫；節點上限 48。
- 手機模式固定簡化介面；桌面可在設置頁切換，手機不能切回桌面。
- export 只包含目前條目可達的內容，不含索引、搜尋、圖譜與編輯功能。
- 網站部署一律唯讀：只有本機 host（含 `wails.localhost`）加 `?edit=1` 才會載入編輯與存檔；不要把 `wails.localhost` 的判斷放寬成任何 `*.localhost` 或內網 IP。

## 部署

```powershell
npm run build
node src/tools/deploy-offtext.mjs --check
node src/tools/deploy-offtext.mjs
```

目標是 `https://shutonggui.cn/offtext/`；連線憑證沿用 `D:\2026\adb-converter\.local\server.env` 與 `hostkey.txt`，不會印出。
