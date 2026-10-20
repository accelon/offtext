# macOS 建置（待辦）

目前只留了 Go 介面（`desktop/platform_darwin.go`）與 Wails 的 `MacWindow` 選項，
尚未產生 `.app`。之後要做的事：

1. 在 macOS 上安裝同版本 Wails CLI 與 Go。
2. 用 `wails3 generate icons` 產生 `build/darwin/icons.icns`（本目錄已有 appicon.png）。
3. 建立 `Info.plist`（bundle id `com.accelon.offtext`、版本、LSMinimumSystemVersion）。
4. 建置：先前端、再 `go build`；arm64 原生、x86_64 用 `CGO_ENABLED=1 GOARCH=amd64`，
   universal 用 `lipo`。
5. 簽章：Developer ID Application + `notarytool` 公證 + `stapler`；用
   `spctl --assess --type execute -vv` 驗證。ad-hoc 簽章只適合本機測試。
6. 更新流程要換整個 `.app` bundle，不能沿用 Windows 的單 exe 換檔邏輯。

資料夾佈局：macOS 從 Finder 啟動時工作目錄是 `/`，資料路徑要用 `os.Executable()` 或
`os.UserConfigDir()`；本專案目前以執行檔旁的 `data/` 為預設，打包 `.app` 時要決定
資料放在 bundle 內（唯讀）還是 `~/Library/Application Support/Offtext/data`。
