// Offtext 桌面宿主（Wails v3）。
//
// 建置順序固定：先前端（npm run build）→ 再 go build。assets/ 是前端產物的
// 嵌入副本，不含資料；資料在執行檔旁的 data/ 子目錄，啟動時全部讀入記憶體。
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:assets
var embeddedAssets embed.FS

const (
	appName = "Offtext"
	appID   = "com.accelon.offtext"
)

// appVersion／buildTime 由建置腳本以 -ldflags -X 注入；不要用檔案 mtime。
var (
	appVersion = "0.2.0"
	buildTime  = "dev"
)

type cliOptions struct {
	dataDir  string
	version  bool
	selfTest bool
	report   string
}

func main() {
	opts := parseFlags()
	if opts.version {
		fmt.Println(versionText())
		return
	}

	closeLog := setupLogging()
	defer closeLog()
	defer func() {
		if r := recover(); r != nil {
			log.Printf("panic: %v\n%s", r, debug.Stack())
			fatalDialog(appName+" 啟動失敗", fmt.Sprintf("%v", r))
			os.Exit(1)
		}
	}()
	log.Printf("=== %s %s start build=%s go=%s os=%s/%s ===",
		appName, appVersion, buildTime, runtime.Version(), runtime.GOOS, runtime.GOARCH)

	dataDir, err := resolveDataDir(opts.dataDir)
	if err != nil {
		exitFatal(opts, "資料目錄", err)
	}
	data, err := loadDataDir(dataDir)
	if err != nil {
		exitFatal(opts, "載入資料", err)
	}
	for _, f := range data.Files {
		log.Printf("data: %-32s id=%-24s entries=%-4d bytes=%d", f.Name, f.ID, f.Entries, f.Bytes)
	}
	for _, p := range data.Problems {
		log.Printf("data warning: %s", p)
	}
	log.Printf("data: %d TSV loaded from %s", len(data.Files), data.Dir)

	web := webAssets()
	if opts.selfTest {
		report := runSelfTest(web, data)
		writeReport(opts.report, report)
		if !report.OK {
			os.Exit(1)
		}
		return
	}

	svc := &DataService{data: data}
	var win *application.WebviewWindow
	app := application.New(application.Options{
		Name:        appName,
		Description: "巢式文字 Offtext：以 ^[...] 標記的巢狀閱讀與編輯。",
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			// BundledAssetFileServer 才會提供 /wails/runtime.js；只服務檔案的
			// handler 會讓頁面能開、橋全斷。DataService.Handler 另外接上與
			// localhost serve.mjs 相同的 POST /api/tsv/<file> 存檔路徑。
			Handler: svc.assetHandler(application.BundledAssetFileServer(web)),
		},
		Windows:        windowsOptions(),
		SingleInstance: singleInstanceOptions(&win),
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "巢式文字 Offtext",
		Width:            1280,
		Height:           860,
		MinWidth:         720,
		MinHeight:        520,
		Hidden:           true, // 先隱藏，等 ApplicationStarted 有螢幕表再定位。
		BackgroundColour: application.NewRGB(250, 248, 244),
		// 與 localhost 的 ?edit=1 相同；index.html 只把 wails.localhost 視為本機。
		// 部署到網站的版本沒有這個 hostname，仍維持唯讀。
		URL: "/?edit=1",
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHiddenInset,
		},
	})

	win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		saveWindowState(app, win)
	})
	for _, ev := range []events.WindowEventType{
		events.Common.WindowDidMove,
		events.Common.WindowDidResize,
		events.Common.WindowMaximise,
		events.Common.WindowUnMaximise,
		events.Common.WindowRestore,
	} {
		win.OnWindowEvent(ev, func(*application.WindowEvent) {
			rememberWindow(app, win)
		})
	}
	app.OnShutdown(func() {
		saveWindowState(app, win)
	})

	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		placeWindow(app, win)
		win.Show()
		win.Focus()
		x, y := windowPos(win)
		w, h := windowSize(win)
		log.Printf("window shown: pos=(%d,%d) size=(%d,%d) screens=%d", x, y, w, h, len(app.Screen.GetAll()))
	})

	if err := app.Run(); err != nil {
		log.Printf("app.Run: %v", err)
		fatalDialog(appName+" 發生錯誤", err.Error())
	}
	log.Printf("=== %s stopped ===", appName)
}

func parseFlags() cliOptions {
	var opts cliOptions
	flag.StringVar(&opts.dataDir, "data-dir", "", "TSV 資料目錄（預設：執行檔旁的 data）")
	flag.BoolVar(&opts.version, "version", false, "印出版本與 buildTime 後結束")
	flag.BoolVar(&opts.selfTest, "selftest", false, "不開視窗，檢查內嵌前端與 data/*.tsv 後結束")
	flag.StringVar(&opts.report, "report", "", "selftest 的 JSON 報告輸出路徑")
	flag.Parse()
	return opts
}

func versionText() string {
	return fmt.Sprintf("%s %s\nbuildTime: %s\ngo: %s\nplatform: %s/%s",
		appName, appVersion, buildTime, runtime.Version(), runtime.GOOS, runtime.GOARCH)
}

// exitFatal 在 GUI 子系統沒有 stdout；selftest 直接寫 stderr／退出碼，
// 一般啟動才用 message box，避免自動化被 modal 對話框卡住。
func exitFatal(opts cliOptions, what string, err error) {
	log.Printf("%s: %v", what, err)
	if opts.selfTest {
		fmt.Fprintf(os.Stderr, "%s: %v\n", what, err)
		os.Exit(1)
	}
	fatalDialog(appName+" 無法啟動", what+"："+err.Error())
	os.Exit(1)
}

func webAssets() fs.FS {
	sub, err := fs.Sub(embeddedAssets, "assets")
	if err != nil {
		panic("embedded assets: " + err.Error())
	}
	return sub
}

func singleInstanceOptions(win **application.WebviewWindow) *application.SingleInstanceOptions {
	return &application.SingleInstanceOptions{
		UniqueID: appID,
		OnSecondInstanceLaunch: func(application.SecondInstanceData) {
			if *win != nil {
				(*win).Show()
				(*win).Focus()
			}
		},
	}
}

func windowsOptions() application.WindowsOptions {
	opts := application.WindowsOptions{}
	if dir := os.Getenv("OFFTEXT_WEBVIEW_DIR"); dir != "" {
		opts.WebviewUserDataPath = dir
	} else {
		opts.WebviewUserDataPath = filepath.Join(localAppDataDir(), "Offtext", "WebView2")
	}
	// 除錯埠只在明確設定環境變數時開啟；正式版預設不開。
	if port := strings.TrimSpace(os.Getenv("OFFTEXT_DEBUG_PORT")); port != "" {
		opts.AdditionalBrowserArgs = []string{
			"--remote-debugging-port=" + port,
			"--remote-allow-origins=*",
		}
		log.Printf("WARNING: remote debugging enabled on port %s", port)
	}
	return opts
}

func resolveDataDir(explicit string) (string, error) {
	if explicit != "" {
		return checkDataDir(explicit)
	}
	if env := os.Getenv("OFFTEXT_DATA_DIR"); env != "" {
		return checkDataDir(env)
	}
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "data"))
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "data"))
	}
	for _, dir := range candidates {
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			return filepath.Abs(dir)
		}
	}
	return "", fmt.Errorf("找不到 data 子目錄（找過：%s）。請把 TSV 放在執行檔旁的 data/。", strings.Join(candidates, "、"))
}

func checkDataDir(dir string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("資料目錄不存在：%s", abs)
	}
	if !st.IsDir() {
		return "", fmt.Errorf("資料目錄不是目錄：%s", abs)
	}
	return abs, nil
}

func localAppDataDir() string {
	if dir, err := os.UserCacheDir(); err == nil {
		return dir
	}
	if dir, err := os.UserConfigDir(); err == nil {
		return dir
	}
	return os.TempDir()
}

func configDir() string {
	if dir := os.Getenv("OFFTEXT_CONFIG_DIR"); dir != "" {
		return dir
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base = localAppDataDir()
	}
	return filepath.Join(base, "Offtext")
}

func setupLogging() func() {
	dir := filepath.Join(localAppDataDir(), "Offtext", "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.SetOutput(os.Stderr)
		return func() {}
	}
	path := filepath.Join(dir, "offtext.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 4<<20 {
		_ = os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		log.SetOutput(os.Stderr)
		return func() {}
	}
	log.SetOutput(f)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Printf("log file: %s", path)
	return func() { _ = f.Close() }
}

type selfTestReport struct {
	OK        bool              `json:"ok"`
	App       string            `json:"app"`
	Version   string            `json:"version"`
	BuildTime string            `json:"buildTime"`
	Go        string            `json:"go"`
	OS        string            `json:"os"`
	DataDir   string            `json:"dataDir"`
	Files     []DataFile        `json:"files"`
	Assets    []string          `json:"assets"`
	Checks    map[string]string `json:"checks"`
	Problems  []string          `json:"problems,omitempty"`
}

func runSelfTest(web fs.FS, data *DataSet) selfTestReport {
	r := selfTestReport{
		OK: true, App: appName, Version: appVersion, BuildTime: buildTime,
		Go: runtime.Version(), OS: runtime.GOOS + "/" + runtime.GOARCH,
		DataDir: data.Dir, Files: data.Files, Checks: map[string]string{},
		Problems: append([]string{}, data.Problems...),
	}
	fail := func(key, detail string) {
		r.OK = false
		r.Checks[key] = "FAIL: " + detail
	}
	pass := func(key, detail string) { r.Checks[key] = "ok: " + detail }

	if len(data.Files) == 0 {
		fail("data", "no TSV loaded")
	} else {
		pass("data", fmt.Sprintf("%d TSV, %d bytes", len(data.Files), data.TotalBytes()))
	}
	for _, f := range data.Files {
		if f.Bytes == 0 {
			fail("data/"+f.Name, "empty file")
		}
		if f.Entries == 0 {
			fail("data/"+f.Name, "no entries")
		}
	}
	if len(data.Files) != len(data.ByName) {
		fail("data/unique", "duplicate names")
	} else {
		pass("data/unique", "names are unique")
	}

	required := []string{"index.html", "offtext-app.js", "offtext-cm.js", "nestedtext-core.js", "nestedtext.css"}
	for _, name := range required {
		st, err := fs.Stat(web, name)
		if err != nil || st.Size() == 0 {
			fail("asset/"+name, "missing or empty in embedded assets")
			continue
		}
		pass("asset/"+name, fmt.Sprintf("%d bytes", st.Size()))
		r.Assets = append(r.Assets, name)
	}

	// 直接打資料 handler，確認前端啟動時真的拿得到 data-index.txt 與每個 TSV。
	service := &DataService{data: data}
	server := httptest.NewServer(service.assetHandler(application.BundledAssetFileServer(web)))
	defer server.Close()
	checkURL := func(key, suffix string, wantContains string) {
		resp, err := http.Get(server.URL + suffix)
		if err != nil {
			fail(key, err.Error())
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		if resp.StatusCode != http.StatusOK {
			fail(key, fmt.Sprintf("status %d", resp.StatusCode))
			return
		}
		if wantContains != "" && !strings.Contains(string(body), wantContains) {
			fail(key, "body does not contain "+wantContains)
			return
		}
		pass(key, fmt.Sprintf("200, %d bytes", len(body)))
	}
	checkURL("http/data-index.txt", "/data/data-index.txt", data.Files[0].Name)
	for _, f := range data.Files {
		checkURL("http/"+f.Name, "/data/"+f.Name, "")
	}
	checkURL("http/runtime.js", "/wails/runtime.js", "runtime")

	// 存檔路由必須存在；用不存在的檔名確認它會拒絕，不會碰到真實資料。
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/tsv/__selftest_missing__.tsv", strings.NewReader("x"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fail("http/save-route", err.Error())
	} else {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode == http.StatusBadRequest {
			pass("http/save-route", "rejects unknown file")
		} else {
			fail("http/save-route", fmt.Sprintf("unexpected status %d", resp.StatusCode))
		}
	}

	// 資料索引必須列出所有載入的 TSV。
	for _, f := range data.Files {
		if !strings.Contains(string(data.IndexText), f.Name) {
			fail("index/"+f.Name, "not listed in generated data-index.txt")
		}
	}
	if r.OK && len(r.Problems) > 0 {
		r.OK = false
	}
	return r
}

func writeReport(path string, report selfTestReport) {
	out, _ := json.MarshalIndent(report, "", "  ")
	if path == "" {
		path = filepath.Join(os.TempDir(), "offtext-selftest.json")
	}
	if err := os.WriteFile(path, append(out, '\n'), 0o644); err != nil {
		log.Printf("selftest report: %v", err)
	}
	fmt.Println(string(out))
	fmt.Fprintf(os.Stderr, "selftest report: %s\n", path)
}

func windowPos(win *application.WebviewWindow) (int, int) {
	if win == nil {
		return 0, 0
	}
	return win.Position()
}

func windowSize(win *application.WebviewWindow) (int, int) {
	if win == nil {
		return 0, 0
	}
	return win.Size()
}
