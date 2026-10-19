# 巢式文字 Offtext：技術、格式與操作介面交接文件

> 用途：開新話題、全面改寫編輯器時的交接規格。  
> 專案根目錄：`D:\2026\offtext`  
> 文件版本：2026-10-19

---

## 1. 專案定位

- 單頁、無框架、無伺服器依賴的巢式文字閱讀器。
- 以 `^[...]` 引用串起多科目詞典；點引用可遞迴展開。
- 主要受眾：高中文化以上、財商起步者；內容包含自然科、近代中國史、經濟學、財商。
- 核心價值：用「引用網路」而不是線性文章來讀知識。

---

## 2. 技術架構

### 2.1 前端

- 原生 HTML / CSS / JavaScript。
- 經典 `<script>` 載入，沒有 bundler、沒有前端框架、沒有 npm 前端依賴。
- 可直接用 `file://` 開啟，也可用 HTTP 靜態伺服器。
- 檔案：

| 檔案 | 作用 |
| --- | --- |
| `src/index.html` | 頁面骨架、啟動頁、toolbar、設置頁 |
| `src/nestedtext-core.js` | 解析、查表、別名、循環、索引、排行 |
| `src/nestedtext.js` | 啟動、路由、渲染、搜尋、圖譜、編輯器、閱讀歷史 |
| `src/nestedtext.css` | 版面、深度色相、亮／暗／護眼主題、編輯器、設置頁、響應式 |
| `src/simplified-data.js` | 繁簡對照表（GENERATED，每兩個字一組） |
| `src/nestedtext-simplified.js` | 無損／強制簡體轉換、搜尋形式 |
| `src/nestedtext-settings.js` | 設置頁：主題與文字顯示三態、localStorage |
| `src/tools/serve.mjs` | 本機 HTTP 除錯伺服器：TSV 清單、靜態檔、寫回 API |

### 2.2 建置

- `src/tools/build.mjs` 只複製前端檔到 `build/`，並產生 `build/tsv-manifest.js`（只列檔名，不含 TSV 內容）。
- **不再產生 `build/data.js`**。
- `build/` 只有：

```text
build/
├─ index.html
├─ nestedtext-core.js
├─ nestedtext.css
├─ nestedtext.js
├─ simplified-data.js
├─ nestedtext-simplified.js
├─ nestedtext-settings.js
├─ tsv-manifest.js       # GENERATED，啟動頁清單
└─ shots/              # 展示截圖，不會被 build 清掉
```

### 2.3 Node 工具

| 檔案 | 作用 |
| --- | --- |
| `src/tools/tsv-data.mjs` | 直接從 `data/*.tsv` 載入 domain（含 `file`），供測試／健檢 |
| `src/tools/test-core.mjs` | 核心邏輯測試 |
| `src/tools/test-simplified.mjs` | 繁簡三態轉換測試 |
| `src/tools/gen-simplified.mjs` | 從 accelon26 的 `simplified-data.ts` 產生 `src/simplified-data.js` |
| `src/tools/serve.mjs` | 本機 HTTP 除錯伺服器；`GET /api/tsvs`、`POST /api/tsv/<檔名>` |
| `src/tools/http-test.mjs` | Edge 實測 HTTP 清單、記憶體編輯、未存檔、離開儲存 |
| `src/tools/deploy-offtext.mjs` | 部署 `build/` 與 `data/*.tsv` 到 `shutonggui.cn/offtext/` |
| `src/tools/live-check.mjs` | Edge 實測線上站清單與載入 |
| `src/tools/settings-test.mjs` | Edge 實測設置頁、主題、三態、搜尋、重載、手機寬度 |
| `src/tools/graph-test.mjs` | Edge 實測圖譜設定浮窗、線粗、節點換行／尺寸、Ctrl 重繪置中、手機寬度 |
| `src/tools/audit.mjs` | 斷鏈、循環、可達性 |
| `src/tools/click-test.mjs` | Edge DevTools 協定實際點擊測試 |
| `src/tools/layout-check.mjs` | 476px 水平溢出檢查 |
| `src/tools/link-audit.mjs` | 找未標記的詞目提及；可 `--orphans --fix` |
| `src/tools/dump.mjs` | 除錯用 DOM 狀態 dump |

---

## 3. TSV 資料格式

### 3.1 檔案

```text
data/modern-chinese-history.tsv   id=modern-chinese-history, name=近代中國史
data/ancientchina.tsv            id=ancientchina, name=中國古代史
data/worldhistory.tsv            id=worldhistory, name=世界史
data/modernization.tsv           id=modernization, name=現代化歷程
data/chemistry.tsv                id=chemistry, name=化學
data/biology.tsv                  id=biology, name=生物
data/math.tsv                     id=math, name=數學
data/physics.tsv                  id=physics, name=物理
data/earthscience.tsv             id=earthscience, name=地球科學
data/chinese.tsv                  id=chinese, name=國語文
data/computing.tsv                id=computing, name=資訊科技
data/civics.tsv                   id=civics, name=公民與法治
data/art.tsv                      id=art, name=藝術
data/aijargon.tsv                 id=aijargon, name=AI 術語
data/economics.tsv                id=economics, name=經濟學
data/fq.tsv                       id=fq, name=財商
```

### 3.2 格式

第一行是 meta：

```text
{id:"biology",name:"生物"}
```

之後每行：

```text
key<TAB>value
```

- `key` 是詞目名稱。
- `value` 是單行純文字，內含 `^[...]` 引用。
- `_` 是該科首頁。
- 目前不支援多行 value、Tab 跳脫或引號跳脫。
- 重複 key 由後者覆蓋。

### 3.3 引用語法

```text
^[key]
^[顯示名|key]
^[key@domain]
^[顯示名|key@domain]
```

### 3.4 查表順序

1. 有 `@domain` 時，只在該科找。
2. 目前科目。
3. 其他已載入科目。

每個 TSV 自給自足：中英（未來中日）對照就是同科裡 value 以 `@` 開頭的轉址條目，例如 `llm	@大型語言模型`。value 可以是 `@target` 或 `@domain:key`，並有別名迴圈偵測。

---

## 4. 解析與索引

`NT.buildIndex(domains)` 會一次算好：

```js
index = {
  order,     // 可見 domain 順序
  byId,      // domain id -> domain
  links: {
    forward,   // 順鏈結：source -> targets
    backward,  // 逆鏈結：target -> sources
    backlinks  // 反鏈接來源，含 count
  },
  rankings   // Map<domainId, { important, core, hub }>
}
```

### 4.1 排行定義

- **重要**：順鏈數多。
- **核心**：逆鏈數多。
- **樞紐**：順鏈數 × 逆鏈數。
- 每個科目各自排名，各取前 12。
- 索引「全部」時沒有單一科目，三個下拉停用。

### 4.2 解析細節

- `NT.parse()`：切成 text / ref tokens。
- 200 字以內在點擊處內嵌展開；超過才放到段落之後。
- `?mode=inline|block` 可強制覆寫。
- 深度上限 6；循環引用顯示「↺ 循環」。
- 展開路徑用 `0.2.1` 這種引用序號鏈記錄。
- 深度色相：HSV 每層 +30°，暖橘到冷藍。

---

## 5. 啟動與檔案權限

### 5.1 一般啟動

打開 `build/index.html`（`file://` 或 HTTP）：

1. 顯示啟動頁「開啟 TSV 開始」。
2. 啟動頁清單由 `build/tsv-manifest.js` 提供（只含檔名、id、名稱、hidden、條目數；不含 TSV 內容）。目前 8 個檔，預設全勾。
3. **HTTP**：按「開啟選取的 TSV」直接 fetch `data/<檔名>`，不用開檔案選擇器。
4. **file://**：清單只供對照；按「選擇本機 TSV…」用 `showOpenFilePicker({ multiple: true })` 一次選多個檔。
5. 解析每個 TSV、檢查 meta id、建立索引。
6. 預設開第一個科目的首頁 `_`。
7. 使用者可再開其他 TSV。
8. 開檔只讀、不要求寫入權限；編輯先存在記憶體（見 §8）。

### 5.2 HTTP 模式

除錯伺服器：

```powershell
node src/tools/serve.mjs --port 8123
```

- 入口：`http://127.0.0.1:8123/build/index.html`（`/` 也會導到這裡）。
- `GET /api/tsvs`：列出 `data/*.tsv`。
- `POST /api/tsv/<檔名>`：寫回 TSV；檢查 meta `id` 與檔名一致。
- 靜態檔從專案根目錄提供，`cache-control: no-store`。

也可以跳過勾選，直接用 query：

```text
?data=chemistry,modern-chinese-history
```

- 依序 fetch `data/<id>.tsv`。
- 預設嘗試 `data/` 與 `../data/`。
- 可用 `?dataBase=/data` 指定目錄。
- HTTP 模式**可以編輯**：先改記憶體、toolbar 顯示未存檔；離開時走 `POST /api/tsv/`。若是一般靜態伺服器沒有 API，才退回 `showSaveFilePicker`。
- `?data=` 只在 http/https 有效；`file://` 會提示改用檔案選擇器。
- 頁面在 `/build/` 時會自動 fallback 到 `../data/`。

### 5.3 檔案 handle

- `fileHandles`：`Map<domainId, { handle, name, meta }>`。
- 啟動時取得的 handle 只用來讀取；**編輯不再先要求權限**。
- 按「離開」→「儲存並離開」時，才對該科 handle 呼叫：

```js
queryPermission({ mode: 'readwrite' })
requestPermission({ mode: 'readwrite' })
```

- 授權成功才寫回；拒絕就停在離開視窗，可重試或選「不儲存離開」。
- 之後同一科不再重複詢問，除非權限失效。
- HTTP 模式沒有 handle：優先 `POST /api/tsv/<檔名>`；沒有 API 時另存新檔。
- 多科同時儲存時，權限提示可能要多按幾次（瀏覽器需要使用者手勢）。

### 5.4 缺科引用

若只開了 `fq.tsv`，點「資產配置」：

1. 解析失敗。
2. 開「找不到『資產配置』」視窗。
3. 列出目前已載入科目。
4. 按「選擇其他 TSV…」。
5. 加入 `economics.tsv` 後：
   - 保留原科目。
   - 重建全索引。
   - 直接跳到目標條目。
6. 載入不要求寫入權限；之後編輯仍先存在記憶體。

### 5.5 部署到 shutonggui.cn/offtext

```powershell
node src/tools/build.mjs
node src/tools/deploy-offtext.mjs
```

- 目標 `/var/www/html/offtext`，URL `https://shutonggui.cn/offtext/`。
- 連線沿用 `D:\2026\adb-converter\.local\server.env`、`.local/hostkey.txt`；PuTTY `pscp`／`plink`，帳密不輸出。
- 先上傳到 `offtext.new`，完成後目錄切換；舊版留在 `offtext.prev`。
- 上傳內容：`build/` 根目錄的 `.html/.css/.js` ＋ `data/*.tsv`；不含 `build/shots/`。
- 線上為 Apache 靜態站，沒有 `serve.mjs` 的寫回 API；儲存會退回 `showSaveFilePicker`。

---

## 6. 路由與狀態

### 6.1 URL

```text
#/domain/key
#/index
#/index/<domain>
#/index/all
#/graph/<domain>/<key>
```

### 6.2 主要狀態

```js
state = {
  index,          // NT.buildIndex 結果
  mode: 'auto',
  expanded: Set,  // 展開路徑
  focusPath,
  backlink,       // 反鏈接來源標記
  view: 'entry' | 'index' | 'graph',
  indexDomain,
  readOnly,       // 保留欄位；新流程一律 false（編輯先進記憶體）
  graph: {
    depth: 2,
    forward: true,
    backward: true,
    fontSize: 12,
    edgeLength: 'medium',
    edgeWidth: 'thin' | 'medium' | 'thick',
    focus: null,
    recenter: false
  },
  root: { domain, key }
}
```

其他可變資料：

- `DATA`：目前載入的所有 domain。
- `domains`：可見 domain。
- `entries`：搜尋用扁平清單。
- `readHistory`：閱讀歷史，存在 localStorage。
- `fileHandles`：每科檔案 handle。
- `dirtyDomains`：模組層 `Set<domainId>`，只存在記憶體、尚未寫回 TSV 的科目；toolbar 與科目下拉的 `●` 由它驅動。

### 6.3 重建索引

任何編輯或加入新科目後：

```js
state.index = NT.buildIndex(DATA);
domains = 可見科目;
rebuildSearchEntries();
updateStats();
fillSubjectSelect();
updateRankNav();
render();
```

---

## 7. 操作介面

### 7.1 頂欄

順序：

```text
⌂ 科目選單 [● 未存檔]  重要  核心  樞紐  閱讀歷史  搜尋  文字｜圖譜  索引  [離開]  🔧
```

- 沒有品牌字樣。
- 沒有「200 字內嵌」模式選單。
- 三個排行下拉的顯示文字只有「重要／核心／樞紐」。
- 下拉第一筆不再重複顯示下拉名稱；placeholder 用 `hidden`，關閉時仍顯示標籤。
- 每個選項只顯示詞目，鏈結數放在 `option.title`：
  - `順鏈 5`
  - `逆鏈 20`
  - `順鏈 3、逆鏈 5、乘積 15`
- `dirtyBtn` 只在有科目未存檔時出現，文字是「● 科目名 未存檔」或「● N 科未存檔」；點一下開儲存視窗。
- 科目下拉中，未存檔科目名稱後面加 `●`。
- 離開圖示在扳手左邊，執行「未存檔 → 儲存／不儲存 → 回啟動頁」流程。
- 扳手固定放在 toolbar 最右邊，開啟設置頁。

### 7.2 閱讀歷史

- 位於排行下拉右側。
- 保留最近 **15 筆**實際開啟的條目。
- 最新一筆排最前。
- 重複閱讀會移到最前，不重複。
- 不記錄科目首頁 `_`、索引頁、圖譜頁。
- 存在 `localStorage`：`offtext.readHistory.v1`。
- 舊 `history` domain 會自動遷移到 `modern-chinese-history`。
- 選到未載入科目的舊紀錄時，會開「載入其他 TSV」視窗。
- 選單 placeholder 為「閱讀歷史」。

### 7.3 條目頁

- 單欄流式，桌面最大 760px，手機全寬。
- 標題列右側是反鏈接。
- 正文引用是彩色文字＋實線底線，無底色、無箭頭。
- 點引用：展開／收合。
- `Ctrl`／`⌘` + 點擊：直接替換閱讀頁到該條目。
- 展開時有焦點模式：只保留該路徑清楚，其餘淡化。
- 鍵盤：
  - `/` 聚焦搜尋
  - `g` 文字／圖譜切換
  - `Esc` 關閉搜尋／編輯器

### 7.4 反鏈接

- 標題右側。
- **前 4 筆直接顯示**。
- 第 5 筆起收進 `+N` 下拉。
- 不再使用水平捲動、漸層遮罩。
- 下拉用 `<details>`，選一筆跳到來源，並用粗底線＋外框標出來源中的引用。
- 再點該引用可回到原條目。

### 7.5 索引頁

- 科目分頁。
- 預設目前科目，可切「全部」或指定科目。
- 每科一張卡片清單，含首頁與內容條目；`@` 對照頁不列入。
- 總數 949 條（不含各科首頁與對照頁）。

### 7.6 圖譜

- 以目前條目為起點，預設 2 層，可選 1–3 層。
- 深度 HSV 色，節點大小依總連結數。
- 順鏈實線、逆鏈虛線；可開關方向。
- 字級滑桿 12–24px，step 0.1；`change` 後套用。
- 連線長度三級：短／中／長。
- 連線粗細三級：細 1.2px／中 2.4px／粗 4px；預設中。`Ctrl` 高亮時為目前粗細 × 1.7。
- 節點標籤：中文 4 字以內一行，5 字起換行（最多 3 行）；英文優先依複合詞尾換行，不把單字切一半。
- 節點半徑：最小約 18px（字級 12）、一般樞紐最大約 46px；`graphRadius()` 以連結數、標籤行寬與行高計算。
- 節點上限 48，超過顯示前 48 並提示。
- 節點文字軟換行；hover 顯示釋文、順／逆鏈數、深度。
- 跨科目節點加虛線外環與科目徽章。
- 圖譜設定（層數、字級、連線、方向、重設、圖例）是半透明浮窗，浮在畫布右上角，可收合成一行；收合狀態存在 `localStorage['offtext.graphPanel.v1']`。
- `Ctrl`／`⌘`+點擊節點：以該節點為新起點重繪。新根節點固定在 viewBox 正中央（`x = width/2`、`y = height/2`）；若放大後有節點超出畫布，再以根節點為中心等比縮小。重繪後會把畫布中心對到視窗中心。
- canvas 動態向下變長；不使用水平捲動。
- 沒有拖曳、縮放、動畫。

### 7.7 設置頁

toolbar 最右邊的扳手（`#settingsBtn`）開啟模態設置頁（`#settingsBox`／`#settingsBackdrop`），Esc、`✕`、`關閉`、點背景都可關閉。

**主題**（`#themeSeg`）三態：

```text
亮底 light    暗底 dark    護眼 eye
```

- 存在 `localStorage['offtext.theme.v1']`。
- 沒有存值時跟隨系統 `prefers-color-scheme`；設定頁標示目前實際套用的那一種。
- `<head>` 有一段先行 script，載入前就套 `data-theme`，避免閃色。
- 只換 CSS 變數，不動版面；護眼是偏暖、低藍光紙色（比亮底更黃，降低藍色成分）。
- 暗底元件（引用色、圖譜節點、搜尋結果陰影）同時支援明確 `data-theme="dark"` 與系統暗色。
- `?theme=light|dark|eye` 可指定本次主題（優先於 localStorage，但不寫入）。

**繁簡文字顯示**（`#simSeg`）三態：

```text
0 保持原樣    1 無損簡體    2 強制簡體
```

- 存在 `localStorage['offtext.simmode.v1']`。
- 無損簡體只轉「一對一」的字；發／髮、乾／幹、裡／裏、臺／檯、後／后等合併字保留原樣。
- 強制簡體用 Unihan `kSimplifiedVariant` 全轉。
- 對照表在 `src/simplified-data.js`（無損 2,641 組、強制 2,810 組），由 `src/tools/gen-simplified.mjs` 從 accelon26 的 `simplified-data.ts` 產生。
- 轉換只作用在畫面：正文、標題、反鏈接、索引、搜尋結果、排行、閱讀歷史、圖譜標籤與 tooltip；**不動** TSV、`NT.buildIndex()`、搜尋原文。
- 搜尋索引會同時收原文、無損、強制三種寫法，所以顯示簡體時打簡體也找得到原文條目。
- 設置頁用同一句範例並列三態，不同的字加虛線；目前選的那列突顯。
- 簡體顯示時禁止用畫面選取新增／編輯詞目，避免把簡體字寫成 key；要編輯先切回「保持原樣」。

### 7.8 未存檔與離開

編輯採「記憶體優先」：

1. 進入編輯器**不再**要求寫入權限。
2. 儲存（`Ctrl/⌘+Enter` 或按鈕）只更新記憶體中的 `domain.entries`，加入 `dirtyDomains`，重建索引。
3. `dirtyBtn` 出現；科目下拉的該科名稱加 `●`；footer 顯示「未存檔 N 科」。
4. 推薦標記（自動加 `^[...]`）也先改記憶體，同樣標 dirty。

離開流程：

- toolbar 的離開圖示（扳手左邊）呼叫 `leaveSystem()`。
- 沒有 dirty：直接 `resetToBoot()` 回啟動頁。
- 有 dirty：開「儲存後離開」視窗，列出未存檔科目（可勾選）：
  - `儲存並離開`：逐科 `saveDomain()`；成功後清 dirty、回啟動頁。
  - `不儲存離開`：`confirm()` 後丟棄記憶體修改、回啟動頁。
  - `取消`：留在原頁。
- `dirtyBtn` 點一下可開「儲存未存檔的科目」，只儲存、不離開。
- `saveDomain()`：
  - 有 `fileHandles` → `saveFileSession()`，此時才 `queryPermission`／`requestPermission({mode:'readwrite'})`。
  - HTTP 且 dev server 有 API → `POST /api/tsv/<檔名>`。
  - 以上都沒有 → `showSaveFilePicker()` 另存新檔。
- 直接關閉分頁／重新載入時，若有 dirty，`beforeunload` 會跳瀏覽器原生警告；但不會自動儲存。
- `resetToBoot()` 會清空 `DATA`、索引、domains、dirty、fileHandles，移除 hash，重新顯示啟動頁清單。

---

## 8. 編輯器現況

### 8.1 進入編輯

1. 在正文選取一段未標記文字。
2. 浮出「＋ 新增詞目」或「編輯詞目」。
3. `ensureEditAccess()` 只檢查科目存在，**不要求寫入權限**，直接開編輯器。
4. 若該科有 file handle，標題顯示「檔名 · 離開時儲存」；沒有 handle 顯示「記憶體編輯 · 離開時儲存」。
5. 寫入權限延到「離開」↔「儲存並離開」才要求（見 §7.8）。

### 8.2 編輯器介面

- 左側：可過濾的現有名詞清單。
  - 過濾 key 或 value 內文。
  - 點一下在游標位置插入 `^[名詞]`。
- 右側：純文字 `<textarea>`。
- 底部：
  - 取消
  - 存入記憶體並找可標記處
- 檔案名稱與「離開時儲存」顯示在標題下方。
- `Ctrl`／`⌘` + Enter 儲存（存記憶體）。
- `Esc` 關閉。

### 8.3 儲存流程

1. 新 value 寫入記憶體 domain。
2. `markDirty(domainId)`；toolbar／科目下拉顯示未存檔。
3. 重建全科目索引。
4. 導到該條目。
5. 掃描同科其他條目中的未標記提及。
6. 顯示勾選清單：
   - 每個來源條目一列
   - 顯示 context
   - 預設全選
7. 使用者按「加入選取項目」：
   - 插入 `^[...]` 到記憶體
   - 再次 `markDirty()`
   - 再次重建索引。
8. **不寫檔**；等使用者在離開視窗按「儲存並離開」或 dirty badge 按「儲存全部」才呼叫 `saveDomain()`。

### 8.4 編輯器限制

目前是「簡單純文字編輯器」：

- 沒有語法高亮。
- 沒有即時引用驗證。
- 沒有 undo 歷史（只有瀏覽器 textarea 原生 undo）。
- 有 `beforeunload` 警告，但沒有完整的「離開前自動存」。
- 沒有外部檔案變更偵測／衝突處理。
- value 只能是單行；換行會轉成空白。
- 一次儲存整個 domain，不是局部 patch。
- 推薦標記以「來源條目」為單位，不是逐 occurrence 勾選。
- 沒有版本歷史或備份。
- 儲存失敗會停在離開視窗並顯示錯誤，可重試或選「不儲存離開」。
- 編輯器只處理目前載入的 domain；跨科引用仍依查表順序。
- 文字顯示切到簡體時，畫面選取無法用來新增／編輯詞目（選到的不是原文）；必須先切回「保持原樣」。
- 未存檔只在分頁記憶體；直接關閉分頁或當掉不會保留。

---

## 9. 目前資料規模

| 科目 | 檔案 | 內容條目 |
| --- | --- | --- |
| 近代中國史 | `modern-chinese-history.tsv` | 141 |
| 中國古代史 | `ancientchina.tsv` | 99 |
| 世界史 | `worldhistory.tsv` | 112 |
| 現代化歷程 | `modernization.tsv` | 101 |
| 化學 | `chemistry.tsv` | 91 |
| 生物 | `biology.tsv` | 106 |
| 數學 | `math.tsv` | 87 |
| 物理 | `physics.tsv` | 82 |
| 地球科學 | `earthscience.tsv` | 105 |
| 國語文 | `chinese.tsv` | 140 |
| 資訊科技 | `computing.tsv` | 112 |
| 公民與法治 | `civics.tsv` | 109 |
| 藝術 | `art.tsv` | 91 |
| AI 術語 | `aijargon.tsv` | 193 |
| 經濟學 | `economics.tsv` | 136 |
| 財商 | `fq.tsv` | 113 |

- 索引總計：1,818 條（不含首頁與 `@` 對照頁）。
- 全資料 audit：1,818 內容條目＋222 對照頁、2,165 個引用。
- 斷鏈：0。
- 壞別名：0。
- 引用圖中回到自己的條目：401。

---

## 10. 已知限制／改寫時要保留的決策

### 10.1 必須保留

- TSV meta 格式與單行 value。
- `^[...]`、`^[...|...]`、`^[...@domain]` 語法。
- 查表順序：本科 → 其他科；同一科的中英對照是 value 以 `@` 開頭的轉址頁。
- 啟動頁列出 `data/` 所有 TSV（manifest），HTTP 可勾選直接載入；file:// 仍用選檔。
- 開檔只讀；編輯不先要求寫入權限。
- 編輯先存在記憶體，`dirtyDomains` 驅動 toolbar 與科目下拉的「未存檔」。
- 按「離開」時才儲存；file handle 才要求 `readwrite` 權限。
- 不使用 localStorage 當資料來源；未存檔只在分頁記憶體。
- 儲存後重建全科目索引。
- 反鏈接前 4 筆＋`+N` 下拉。
- 排行標籤「重要／核心／樞紐」，計數只在 hover hint。
- 閱讀歷史 15 筆、最新在前。
- HTTP 不再是唯讀；`?data=` 仍可直接載入。
- `src/tools/serve.mjs` 的 `GET /api/tsvs`、`POST /api/tsv/<檔名>` 是除錯用寫回管道。
- `modern-chinese-history` 的 id、檔名與顯示名。
- 設置頁扳手固定在頂欄最右邊；離開圖示在它左邊。
- 主題三態：亮底／暗底／護眼；`localStorage['offtext.theme.v1']`，沒選過跟隨系統。
- 繁簡文字顯示三態：原樣／無損簡體／強制簡體；`localStorage['offtext.simmode.v1']`。
- 無損簡體只轉一對一，合併字保留；轉換只影響畫面，不改 TSV 與索引。
- 搜尋索引同時收原文與簡體形式。

### 10.2 建議改寫時處理

- 把編輯器抽成獨立 module／元件，定義：
  - `open({ domain, key, value })`
  - `save()` 回傳 `{ ok, value, fileWritten }`
  - `recommend()` 回傳 recommendations
- 將「檔案權限」「TSV 序列化」「索引重建」與編輯器 UI 解耦。
- 增加 dirty state、離開確認、錯誤重試、外部變更偵測。
- 增加引用插入搜尋、游標位置保留、鍵盤操作。
- 推薦標記可改成逐 occurrence 勾選。
- 若要做富文字／Markdown，先決定 TSV value 的跳脫與多行規則。
- 保留 `NT.buildIndex()` 作為唯一索引來源，不要在 UI 重掃全部條目。

### 10.3 目前不存在的東西

- `build/data.js` 已移除。
- 沒有後端、資料庫、登入、協作。
- 沒有自動儲存。
- 沒有版本控制整合。
- 沒有 Safari／Firefox 的檔案寫入支援保證。

---

## 11. 建議的新編輯器邊界

若要全面改寫編輯器，最小契約可以是：

```text
Input:
  domainId
  key
  initialValue
  fileHandle?            可寫入的檔案 handle
  existingEntries        左側快速插入清單
  allDomains             跨科目插入

Output:
  savedValue
  insertedLinkTargets
  recommendations
  fileWritten: boolean
```

外部負責：

- 取得／請求寫入權限。
- 將 value 序列化回 TSV。
- 重建 `NT.buildIndex()`。
- 更新閱讀頁、反鏈接、排行、閱讀歷史。

編輯器本身只負責「文字與引用編輯」，不要直接碰資料載入與全域渲染，會比目前單一 IIFE 內的實作容易測試與替換。
