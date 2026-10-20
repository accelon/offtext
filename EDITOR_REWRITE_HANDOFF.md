# 巢式文字 Offtext：技術、格式與操作介面交接文件

> 用途：開新話題、全面改寫編輯器時的交接規格。  
> 專案根目錄：`D:\2026\offtext`  
> 文件版本：2026-10-19
> **2026-10-19 更新：編輯器已改為 CodeMirror 6。閱讀與編輯共用同一個 `EditorView`；`src/editor/` 是原始碼，`src/offtext-cm.js` 是 esbuild 產生的 IIFE bundle。§8 已改寫；舊 textarea 編輯器只在 bundle 載入失敗時作為 fallback。**
> **後續更新：科目 id 已改為 kebab-case（`ancient-china`、`world-history`），顯示名改為「中國近代史」；`src/nestedtext.js` 已拆成 `src/app/*.ts`，由 `src/tools/build-app.mjs` 串成 `src/offtext-app.js`；前端原始碼已全面改為 TypeScript（產生檔仍是 `.js`）。本文部分舊檔名只保留歷史對照。**

---

## 1. 專案定位

- 單頁、無框架、無伺服器依賴的巢式文字閱讀器。
- 以 `^[...]` 引用串起多科目詞典；點引用可遞迴展開。
- 主要受眾：高中文化以上、財商起步者；內容包含自然科、近代中國史、經濟學、財商。
- 核心價值：用「引用網路」而不是線性文章來讀知識。

---

## 2. 技術架構

### 2.1 前端

- 原生 HTML / CSS / JavaScript；閱讀與編輯用 CodeMirror 6。
- `src/editor/*.js` 是 ESM 原始碼；`src/tools/build-editor.mjs` 用 esbuild 打包成 `src/offtext-cm.js`（IIFE，`window.OfftextCM`）。
- `src/index.html` 以經典 `<script>` 載入，沒有執行期 bundler；`file://` 可直接開啟。
- 檔案：

| 檔案 | 作用 |
| --- | --- |
| `src/index.html` | 頁面骨架、啟動頁、toolbar、設置頁 |
| `src/nestedtext-core.js` | 解析、查表、別名、循環、索引、排行 |
| `src/nestedtext.js` | 啟動、路由、渲染、搜尋、圖譜、草稿／存檔／孤兒節點 |
| `src/nestedtext.css` | 版面、深度色相、亮／暗／護眼主題、CM6、設置頁、響應式 |
| `src/editor/index.js` | CM6 EditorView、巢狀 widget、`^` 補全、括號規則 |
| `src/editor/parse.js` | 帶位置的 offtext 解析、16 字計算 |
| `src/offtext-cm.js` | GENERATED：CM6 IIFE bundle |
| `src/simplified-data.js` | 繁簡對照表（GENERATED，每兩個字一組） |
| `src/nestedtext-simplified.js` | 無損／強制簡體轉換、搜尋形式 |
| `src/nestedtext-settings.js` | 設置頁：主題與文字顯示三態、localStorage |
| `src/tools/serve.mjs` | 本機 HTTP 除錯伺服器：TSV 清單、靜態檔、寫回 API |

### 2.2 建置

- `src/tools/build-editor.mjs`：用 esbuild 把 `src/editor/index.js` 打包成 `src/offtext-cm.js`（IIFE，global `OfftextCM`）。因為要支援 `file://`，不能輸出 ESM 或動態 import。
- `src/tools/build.mjs` 複製前端檔到 `build/`，並產生 `build/tsv-manifest.js`（只列檔名，不含 TSV 內容）。
- **不再產生 `build/data.js`**。
- `build/` 只有：

```text
build/
├─ index.html
├─ offtext-cm.js          # GENERATED，CM6 bundle
├─ nestedtext-core.js
├─ nestedtext.css
├─ nestedtext.js
├─ simplified-data.js
├─ nestedtext-simplified.js
├─ nestedtext-settings.js
├─ tsv-manifest.js        # GENERATED，啟動頁清單
└─ shots/                 # 展示截圖，不會被 build 清掉
```

### 2.3 Node 工具

| 檔案 | 作用 |
| --- | --- |
| `src/tools/build-editor.mjs` | esbuild 打包 CM6；由 Node 寫檔避開 Windows 子程序權限 |
| `src/tools/tsv-data.mjs` | 直接從 `data/*.tsv` 載入 domain（含 `file`），供測試／健檢 |
| `src/tools/test-core.mjs` | 核心邏輯測試 |
| `src/tools/test-simplified.mjs` | 繁簡三態轉換測試 |
| `src/tools/gen-simplified.mjs` | 從 accelon26 的 `simplified-data.ts` 產生 `src/simplified-data.js` |
| `src/tools/serve.mjs` | 本機 HTTP 除錯伺服器；`GET /api/tsvs`、`POST /api/tsv/<檔名>` |
| `src/tools/cm-test.mjs` | Edge 實測 CM6 閱讀／編輯、巢狀、`^` 補全、刪括號、孤兒、16 字、手機 |
| `src/tools/cm-file-test.mjs` | Edge 實測 `file://` 直接載入與編輯 |
| `src/tools/cm-block-test.mjs` | Edge 實測 block widget 巢狀 |
| `src/tools/http-test.mjs` | Edge 實測 HTTP 清單、CM6 編輯、存檔／重建、離開、寫回 API |
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
data/computing.tsv                id=computing, name=信息技術
data/civics.tsv                   id=civics, name=公民與法治
data/art.tsv                      id=art, name=藝術
data/aijargon.tsv                 id=aijargon, name=AI 術語
data/economics.tsv                id=economics, name=經濟學
data/fq.tsv                       id=fq, name=財商
```

### 3.2 格式

第一行是 meta：

```text
{id:"biology",name:"生物",group:"理科"}
```

`group` 可省略；目前用「文科／理科／進階」三類，只影響啟動頁清單的分組。

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
    backlinks, // 反鏈接來源，含 count
    incoming   // 所有被引用的 target（含首頁來源），孤兒判定用
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
8. 開檔只讀、不要求寫入權限；編輯先存在草稿（見 §7.8、§8）。

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
- `dirtyBtn` 只在有科目已套用但未寫檔時出現，文字是「● 科目名 未存檔」或「● N 科未存檔」；點一下開儲存視窗；若有草稿，點一下先存草稿。
- 科目下拉中，未存檔科目名稱後面加 `●`。
- 搜尋右側有「編輯」／「完成」、「孤兒 N」與「存檔（N）」：
  - 「編輯」把同一個 CM6 view 從唯讀切成可編輯，游標保留；再按變「完成」。
  - 「存檔（N）」只在有草稿時出現，N 是變更的條目數；按下才檢查、重建索引、必要時寫檔。
  - 「孤兒 N」只在編輯態出現，列出本科沒有反鏈接的條目。
- 離開圖示在扳手左邊，執行「草稿確認 → 未存檔 → 儲存／不儲存 → 回啟動頁」流程。
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
- 標題列右側是反鏈接；正文是 CM6 EditorView。
- 閱讀態：`EditorState.readOnly=true`，但保留 contenteditable 讓游標可見；輸入被阻擋。
- 編輯態：同一個 EditorView 取消 readOnly，游標位置不變，不換窗、不彈 modal。
- 正文引用是彩色文字＋實線底線，無底色、無箭頭。
- 點引用：展開／收合；編輯態點引用會把游標移進 `^[...]`，顯示控制代碼。
- `Ctrl`／`⌘` + 點擊：直接替換閱讀頁到該條目。
- 展開時有焦點模式：只保留該路徑清楚，其餘淡化。
- 鍵盤：
  - `/` 聚焦搜尋（CM6 聚焦時不攔）
  - `g` 文字／圖譜切換（CM6 聚焦時不攔）
  - `Ctrl/⌘+S`、`Ctrl/⌘+Enter` 存檔
  - `Esc` 關閉搜尋／孤兒浮窗／設定頁

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

### 7.8 草稿、存檔與離開

編輯採「草稿優先」：

1. 進入編輯**不再**要求寫入權限。
2. 打字只更新 `drafts`（`domain:key → {value, base}`）；**不重建索引、不重算反鏈接**。
3. 右上「存檔（N）」的 N 是草稿條目數，不是按鍵次數；toolbar／科目下拉的 `●` 只代表「已套用但未寫檔」。
4. 按「存檔」才：
   - 驗證空值、Tab、`@` 對照頁、新條目名稱（≤16 字、不能含 `@ | [ ]`）、引用長度（≤16 字）。
   - 把草稿寫入 `DATA`，`markDirty()`，重建一次全科目索引。
   - 若 HTTP 有 `POST /api/tsv/`，直接寫回；有 file handle 且已授權也直接寫；否則停在 dirty，等離開。
5. 存檔失敗（驗證錯誤）開檢查視窗，草稿保留。
6. `dirtyBtn` 若有草稿，先存草稿；否則開「儲存未存檔的科目」。
7. 直接關閉分頁／重新載入時，若有草稿或 dirty，`beforeunload` 會警告；不會自動儲存。

離開流程：

- toolbar 的離開圖示（扳手左邊）呼叫 `leaveSystem()`。
- 有草稿：先 `confirm()` 問「要先存檔再離開嗎？」；確定才 `saveDrafts()`，取消則留下。
- 沒有草稿、沒有 dirty：直接 `resetToBoot()`。
- 有 dirty：開「儲存後離開」視窗，列出未存檔科目（可勾選）：
  - `儲存並離開`：逐科 `saveDomain()`；成功後清 dirty、回啟動頁。
  - `不儲存離開`：`confirm()` 後丟棄記憶體修改、回啟動頁。
  - `取消`：留在原頁。
- `saveDomain()`：
  - 有 `fileHandles` → `saveFileSession()`，此時才 `queryPermission`／`requestPermission({mode:'readwrite'})`。
  - HTTP 且 dev server 有 API → `POST /api/tsv/<檔名>`。
  - 以上都沒有 → `showSaveFilePicker()` 另存新檔。
- `resetToBoot()` 會清空 `DATA`、索引、domains、drafts、dirty、fileHandles，移除 hash，重新顯示啟動頁清單。

---

## 8. 編輯器：CodeMirror 6

### 8.1 進入編輯

1. 條目頁右上按「編輯」，或選取正文後按「＋ 新增詞目」／「編輯詞目」。
2. 同一窗區的 CM6 view 取消 `readOnly`；不換頁、不彈 modal。
3. 新條目以選取文字為 key，最多 16 字；不能含 `@ | [ ]`。
4. 寫入權限延到「存檔」有 API／handle 時，或「離開」↔「儲存並離開」才要求（見 §7.8）。

### 8.2 CM6 結構

- `src/editor/index.js`：`createEntry({parent,text,domain,key,editing,host})` 回傳 controller。
- 根 view 與每個展開的巢狀 view 共用 `extensionsFor()`：`lineWrapping`、`drawSelection`、`bracketMatching`、`EditorView.theme`、`decorationField`。
- 根 view 額外有：`history()`、`closeBrackets()`、`autocompletion()`、keymap（Backspace/Delete 的括號規則、`Mod-s`、`Mod-Enter`）、`caretInput`。
- 巢狀 view：`EditorState.readOnly=true`，但 `editable=true`，游標可見；不可編輯。
- 閱讀態根 view：`readOnly=true`、`editable=true`；游標仍在，輸入被阻擋。
- 編輯態根 view：`readOnly=false`；用 `Compartment` 切換，不重建 view。

### 8.3 裝飾與巢狀

- `buildDecorations()` 用 `parseSpans()` 取得帶位置的 text/ref token。
- 游標在 `^[...]` 內且為編輯態：不替換，顯示原始碼並加 `.cm-offtag-active`。
- 游標在 offtag 外：整個 token 換成 `RefWidget`（裝飾文字＋底線）。
- 展開且短（`NT.chooseMode` 回 inline）：`RefWidget` 內再掛一個唯讀 CM6 view（`.cm-nested-inline`）。
- 展開且長（block）：原位置留 label，行尾加 `BlockWidget`（`.cm-exp-block`），內含另一個唯讀 CM6 view。
- 深度、焦點、反鏈接來源都轉成 widget／wrapper class，不再掃 DOM。
- `RefWidget.eq()` 比較 path、label、expanded、value、status、focus、displayVersion；打字時沒變的巢狀 widget 不會重建。
- 焦點模式：`is-focus-current`／`is-dim` class 由 `focusClass(path, focusPath)` 計算。
- 簡體顯示：閱讀態用 `TextWidget` 換掉有差異的 text token；編輯態強制原樣（設定頁切換時會退出編輯）。

### 8.4 鍵盤與括號

- 輸入 `^`：插入 `^[]`，游標停在 `[` 後，`setTimeout(startCompletion)`。
- 補全：`^[` 之後列出所有可插入條目，輸入文字即時過濾；Enter 插入 key；重名跨科時可插入 `key@domain`。
- 游標在 `^[` 後按 Backspace：一次 transaction 刪 `[` 和對應 `]`。
- 游標在 `^` 後、`[]` 前按 Backspace：刪整個空 `[]`。
- 游標在 `^[` 前按 Delete：刪 `^[` 和對應 `]`。
- 左括號被選取刪除（非 collapsed）目前交給 CM6 預設行為；主要規則是 collapsed Backspace/Delete。

### 8.5 孤兒節點

- 編輯態 toolbar「孤兒 N」開啟浮窗；桌面右上、手機底部。
- 孤兒＝本科沒有反鏈接的內容條目（不含 `_`、`@` 對照頁）。
- 點一項：關閉浮窗、導到該條目、直接進編輯。
- 同面板列「缺目標引用」；點一項可直接建立新條目並編輯。
- 面板可勾「全部科目」。

### 8.6 限制

- 一次存檔是整個 domain 序列化，不是局部 patch。
- value 只能是單行；CM6 中的換行存檔時轉空白。
- 沒有外部檔案變更偵測／衝突處理、版本歷史。
- 行內展開的巢狀 CM6 是 inline-block，較長時會佔一行；不再是舊版那種文字繞排。
- 夾文 16 字限制套用在新條目名稱與所有引用 inner text；既有資料目前最大 14 字。
- 未套用草稿只在分頁記憶體；直接關閉或當掉不會保留。
- 簡體顯示時不能選取新增／編輯；要切回「保持原樣」。

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
| 物理 | `physics.tsv` | 84 |
| 地球科學 | `earthscience.tsv` | 105 |
| 國語文 | `chinese.tsv` | 140 |
| 信息技術 | `computing.tsv` | 112 |
| 公民與法治 | `civics.tsv` | 109 |
| 藝術 | `art.tsv` | 91 |
| AI 術語 | `aijargon.tsv` | 193 |
| 經濟學 | `economics.tsv` | 141 |
| 財商 | `fq.tsv` | 118 |

- 索引總計：1,830 條（不含首頁與 `@` 對照頁）。
- 全資料 audit：1,830 內容條目＋290 對照頁、2,322 個引用。
- 斷鏈：0。
- 壞別名：0。
- 引用圖中回到自己的條目：556。

---

## 10. 已知限制／改寫時要保留的決策

### 10.1 必須保留

- TSV meta 格式與單行 value。
- `^[...]`、`^[...|...]`、`^[...@domain]` 語法。
- 查表順序：本科 → 其他科；同一科的中英對照是 value 以 `@` 開頭的轉址頁。
- 啟動頁列出 `data/` 所有 TSV（manifest），HTTP 可勾選直接載入；file:// 仍用選檔。
- 開檔只讀；編輯不先要求寫入權限。
- 編輯先存在 `drafts`（草稿），按「存檔」才寫入 `DATA`、標 dirty、重建索引。
- `dirtyDomains` 只代表「已套用但未寫檔」，驅動 toolbar 與科目下拉的 `●`。
- 按「離開」時才要求 file handle 的 `readwrite` 權限；HTTP 有 API 時「存檔」可直接寫。
- 不使用 localStorage 當資料來源；草稿與未存檔只在分頁記憶體。
- 儲存後重建全科目索引。
- 反鏈接前 4 筆＋`+N` 下拉。
- 排行標籤「重要／核心／樞紐」，計數只在 hover hint。
- 閱讀歷史 15 筆、最新在前。
- HTTP 不再是唯讀；`?data=` 仍可直接載入。
- `src/tools/serve.mjs` 的 `GET /api/tsvs`、`POST /api/tsv/<檔名>` 是除錯用寫回管道。
- `modern-chinese-history` 的 id、檔名與顯示名。
- 設置頁扳手固定在頂欄最右邊；離開圖示在它左邊；編輯／存檔／孤兒在搜尋右側。
- 主題三態：亮底／暗底／護眼；`localStorage['offtext.theme.v1']`，沒選過跟隨系統。
- 繁簡文字顯示三態：原樣／無損簡體／強制簡體；`localStorage['offtext.simmode.v1']`。
- 無損簡體只轉一對一，合併字保留；轉換只影響畫面，不改 TSV 與索引。
- 搜尋索引同時收原文與簡體形式。
- 編輯器是 CM6，不是 textarea；閱讀／編輯共用同一個 view。

### 10.2 建議後續處理

- 把 `drafts` 的提交、驗證、持久化再抽成 `draft-store`，讓 UI 只訂閱狀態。
- 增加外部檔案變更偵測／衝突處理與版本歷史。
- 推薦標記（未標記提及）目前沒有入口；若要恢復，應以草稿形式加入，不要每次掃描重建索引。
- 逐 occurrence 勾選推薦，而不是以來源條目為單位。
- 若要做富文字／Markdown，先決定 TSV value 的跳脫與多行規則。
- 保留 `NT.buildIndex()` 作為唯一索引來源，不要在 UI 重掃全部條目。
- 巢狀 CM6 view 目前每個展開各一個 EditorView；展開樹很大時可考慮共用 view 或虛擬化。

### 10.3 目前不存在的東西

- `build/data.js` 已移除。
- 沒有後端、資料庫、登入、協作。
- 沒有自動儲存。
- 沒有版本控制整合。
- 沒有 Safari／Firefox 的檔案寫入支援保證。

---

## 11. CM6 編輯器邊界

`src/editor/index.js` 的實際契約：

```text
createEntry({
  parent,          // 掛載點
  text,            // 目前 value
  domain, key,
  editing,         // 根 view 初始是否可編輯
  maxDepth,        // 巢狀深度上限
  host: {
    hue(depth), display(text), simMode(),
    resolve(ref, domain, contextDomain),
    chooseMode(value), isExpanded(path), toggleExpanded(path),
    focusPath(), navigate(domain,key), showMissing(tok, ctxDomain),
    isBacklinkSource(res), navigateBacklink(),
    requestEdit(domain,key), completions(query, contextDomain),
    onChange(text), saveShortcut()
  }
})
→ {
  view,
  setEditing(flag), setText(text), refresh(), focus(),
  getSelectionInfo(), scrollToPath(path), destroy()
}
```

外部負責：

- 取得／請求寫入權限。
- 將 value 序列化回 TSV。
- 重建 `NT.buildIndex()`。
- 更新閱讀頁、反鏈接、排行、閱讀歷史。
- 草稿驗證、存檔、孤兒清單。

編輯器本身只負責「文字、引用與巢狀顯示」，不直接碰資料載入與全域渲染。
