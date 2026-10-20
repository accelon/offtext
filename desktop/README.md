# Offtext 桌面版（Wails v3 / Windows）

這個目錄是 Wails v3 的 Go 宿主。前端仍是 `src/` 的 TypeScript 專案，建置後把 `build/`
的靜態檔同步到 `desktop/assets/`，用 `go:embed` 嵌進執行檔；資料不嵌入，執行檔啟動時
讀取自己旁邊的 `data/*.tsv`。

## 需求

- Windows 10/11（WebView2 Evergreen Runtime；安裝器另計，本版是 portable 單檔）
- Go 1.25+（實測 1.26.5）
- Node.js 20+ 與 npm
- Wails v3 CLI `v3.0.0-beta.3`（要與 `go.mod` 的 `github.com/wailsapp/wails/v3` 同版）
- 產生 syso 時需要 Windows；圖示與 manifest 在 `build/windows/`

## 建置

```powershell
npm install
npm run desktop:build
```

也可以用 Wails CLI 跑同一個流程：`cd desktop; wails3 task build`（Taskfile 只是包裝
`scripts/build-desktop.mjs`）。

固定順序（見 `scripts/build-desktop.mjs`）：

1. `src/tools/build-all.mjs`：TypeScript → 前端產物（含 `tsc` 型別檢查）
2. `scripts/sync-assets.mjs`：清空並同步 `desktop/assets/`
3. `wails3 generate syso -arch amd64 ...`：一定要有 `-arch`，且確認產物 > 1 KiB
4. `go build -trimpath -tags production -ldflags "... -H windowsgui"`：先前端、後 Go
5. 檢查執行檔旁有 `data/*.tsv`；沒有就從 repo 的 `data/` 複製

輸出：`offtext-desktop/offtext.exe`。repo 內的 `offtext-desktop/` 是 junction（實際位置
以 `Get-Item offtext-desktop` 為準）；`data/` 也必須在執行檔同層。要換位置可用：

```powershell
node desktop/scripts/build-desktop.mjs --out=D:\somewhere\offtext
```

除錯版（有 console subsystem，便於看 panic／stdout）：

```powershell
node desktop/scripts/build-desktop.mjs --skip-web --console
```

## 資料載入

- 啟動時掃描 `<exe>\data\*.tsv`，全部讀入 Go 記憶體，不逐檔走 IPC。
- 前端維持原本的 `fetch('data/data-index.txt')`、`fetch('data/<file>.tsv')`；Go 的
  `DataService` 的 `assetHandler` 在 `/data/` 直接回記憶體內容，其餘交給 `BundledAssetFileServer`。
- `data-index.txt` 只決定科目順序；放在 `data/` 但沒列到的 TSV 會自動接在後面。
- 新增／修改 TSV 後重新啟動即可；不需要重建執行檔。
- 可用 `-data-dir <path>` 或 `OFFTEXT_DATA_DIR` 覆寫資料目錄。

## 編輯與存檔

桌面版以 `/?edit=1` 開窗，並把 `wails.localhost` 視為本機，所以編輯介面與 localhost 一致：

- 存檔同樣呼叫前端既有的 `POST /api/tsv/<file>`；`DataService` 的 `assetHandler` 攔截這個路徑，
  用原子替換寫回 `data/<file>`，再更新 Go 記憶體快照。
- 只允許寫回啟動時已載入的 `.tsv`；會檢查 UTF-8、8 MiB 上限，以及 meta `id` 與檔名一致。
- 寫入失敗回 JSON `{ok:false,error}`，前端會顯示在存檔提示；舊檔不會被截斷。
- `data/` 必須可寫；放在 `Program Files` 或唯讀媒體時，存檔會失敗但不會破壞原檔。
- 部署到網站的版本沒有 `wails.localhost`，仍維持唯讀，即使手動加 `?edit=1` 也不會開啟編輯。

## 驗證

```powershell
npm run desktop:selftest   # 不開窗：內嵌 assets、data 檔數、/data/ 路由、runtime.js
npm run desktop:smoke      # 開窗：CDP 檢查頁面、服務橋、TSV 數量，存截圖
npm run test:save          # localhost：真實修改 TSV、存檔、檢查網站版唯讀
cd desktop; go test ./...  # 存檔 API 的原子寫入／路徑檢查
```

`desktop:selftest` 會呼叫 `offtext.exe -selftest -report <json>`；GUI 子系統沒有
stdout，正式版請以報告檔與 log 為準。

- log：`%LocalAppData%\Offtext\logs\offtext.log`
- 視窗狀態：`%AppData%\Offtext\window.json`（可用 `OFFTEXT_CONFIG_DIR` 覆寫）
- WebView2 資料：`%LocalAppData%\Offtext\WebView2`（可用 `OFFTEXT_WEBVIEW_DIR` 覆寫）

除錯埠只在明確設定時開啟，正式版預設不開：

```powershell
$env:OFFTEXT_DEBUG_PORT='9333'
$env:OFFTEXT_WEBVIEW_DIR='D:\tmp\offtext-webview'
.\offtext-desktop\offtext.exe
```

## 已套用的 Wails3 避坑點

- 前端先建、assets 非空，才 `go build`；不讓 `go:embed` 嵌入舊 UI。
- 用 `application.BundledAssetFileServer`，`/wails/runtime.js` 才有內容；否則頁面能開、橋全斷。
- `generate syso` 指定 `-arch amd64`，產物大小檢查；manifest 有 per-monitor v2 DPI、
  longPathAware、Windows 10/11 supportedOS。
- 視窗先用 `Hidden`，`ApplicationStarted` 有螢幕表後才定位、`Show`；定位只用 `app.Screen`，
  游標實體座標經 `ScreenNearestPhysicalRect` 換算，不混 Win32 邏輯座標。
- 視窗狀態存「相對工作區」並 clamp；`WindowClosing` 與 `OnShutdown` 都會嘗試寫入，原子替換。
- 單一實例：第二次啟動只喚醒第一個視窗；每個測試行程用獨立 `WebviewUserDataPath` 與 port。
- 正式版 `-tags production`、`-H windowsgui`；沒有把 DevTools／debug port 帶進預設啟動。
- 資料只從已載入的檔名表回傳，拒絕路徑分隔與 `.` 開頭，避免 traversal。

## macOS 介面（尚未建置）

- `platform_darwin.go` 已留 `nativeCursorPhysicalRect()`／`fatalDialog()`；目前游標回
  `false`，退回主螢幕，之後可接 `NSEvent.mouseLocation`。
- 視窗選項已使用 `application.MacWindow`（`MacTitleBarHiddenInset`）與
  `ApplicationShouldTerminateAfterLastWindowClosed`。
- 尚未做：`build/darwin/Info.plist`、`.icns`／`Assets.car`、Developer ID 簽章與公證、
  ARM64／x86_64 建置腳本。屆時另做 `scripts/build-darwin.mjs`，不要直接把 Windows
  的「換一顆 exe」更新邏輯搬過去。

## 發佈注意

- 目前**未簽章**；從網路下載後 SmartScreen 可能警告。這是聲譽／簽章問題，不是程式 bug。
  不要教使用者關閉 SmartScreen／Smart App Control／Defender。
- 未做自動更新、 installer、MSIX。要做時依 `wails3-pitfalls.md` §4–§5：先簽 exe 再打包、
  installer 也要簽、更新用 buildTime 而不是 mtime、更新檔先驗簽再執行。
- portable 版沒有 WebView2 bootstrapper；缺 runtime 時會是 `windowsgui` 下的無聲失敗，
  所以啟動期錯誤會寫 log 並用 MessageBox 顯示。
