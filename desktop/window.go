package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	windowStateMu sync.Mutex
	lastNormal    *windowState
	lastState     *windowState
)

// windowState 存相對「所在螢幕工作區原點」的位置，換螢幕或改解析度才不會
// 把視窗丟到畫面外。ScreenID 只供診斷，不作唯一鍵。
type windowState struct {
	RelX     int    `json:"relX"`
	RelY     int    `json:"relY"`
	W        int    `json:"w"`
	H        int    `json:"h"`
	State    string `json:"state"` // normal | maximised
	ScreenID string `json:"screen,omitempty"`
}

func windowStatePath() string {
	return filepath.Join(configDir(), "window.json")
}

func readWindowState() *windowState {
	raw, err := os.ReadFile(windowStatePath())
	if err != nil {
		return nil
	}
	var st windowState
	if err := json.Unmarshal(raw, &st); err != nil {
		log.Printf("window state ignored: %v", err)
		return nil
	}
	if st.W <= 0 || st.H <= 0 {
		return nil
	}
	return &st
}

func writeWindowState(st windowState) {
	dir := filepath.Dir(windowStatePath())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("window state dir: %v", err)
		return
	}
	body, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return
	}
	tmp := windowStatePath() + ".tmp"
	if err := os.WriteFile(tmp, append(body, '\n'), 0o644); err != nil {
		log.Printf("window state write: %v", err)
		return
	}
	if err := os.Rename(tmp, windowStatePath()); err != nil {
		log.Printf("window state rename: %v", err)
		_ = os.Remove(tmp)
	}
}

func chooseScreen(app *application.App) *application.Screen {
	if app == nil || app.Screen == nil {
		return nil
	}
	// 啟動瞬間的游標所在螢幕，通常就是使用者點執行檔的那張。
	if rect, ok := nativeCursorPhysicalRect(); ok {
		if screen := app.Screen.ScreenNearestPhysicalRect(rect); screen != nil {
			return screen
		}
	}
	if screen := app.Screen.GetPrimary(); screen != nil {
		return screen
	}
	screens := app.Screen.GetAll()
	if len(screens) > 0 {
		return screens[0]
	}
	return nil
}

func placeWindow(app *application.App, win *application.WebviewWindow) {
	if app == nil || win == nil {
		return
	}
	screen := chooseScreen(app)
	if screen == nil {
		win.Center()
		return
	}
	work := screen.WorkArea
	st := readWindowState()

	w, h := 1280, 860
	relX, relY := 0, 0
	if st != nil {
		w, h = st.W, st.H
		relX, relY = st.RelX, st.RelY
	}
	if w > work.Width {
		w = work.Width
	}
	if h > work.Height {
		h = work.Height
	}
	if w < 320 {
		w = 320
	}
	if h < 240 {
		h = 240
	}
	x, y := work.X+relX, work.Y+relY
	x = clampInt(x, work.X, work.X+work.Width-w)
	y = clampInt(y, work.Y, work.Y+work.Height-h)

	win.SetSize(w, h)
	win.SetPosition(x, y)
	rememberWindow(app, win)
	if st != nil && st.State == "maximised" {
		win.Maximise()
		rememberWindow(app, win)
	}
	log.Printf("window placed: screen=%s work=%+v pos=(%d,%d) size=(%d,%d)", screen.ID, work, x, y, w, h)
}

// rememberWindow 在移動／縮放／最大化事件中記住幾何。關窗事件發生時視窗
// 可能已被標記銷毀（Position/Size 回 0），所以不要在關窗時才讀。
func rememberWindow(app *application.App, win *application.WebviewWindow) {
	if app == nil || win == nil || app.Screen == nil {
		return
	}
	x, y := win.Position()
	w, h := win.Size()
	if w <= 0 || h <= 0 {
		return
	}
	st := windowState{RelX: x, RelY: y, W: w, H: h, State: "normal"}
	if screen := app.Screen.ScreenNearestDipRect(application.Rect{X: x, Y: y, Width: w, Height: h}); screen != nil {
		work := screen.WorkArea
		st.RelX = x - work.X
		st.RelY = y - work.Y
		st.ScreenID = screen.ID
	}

	windowStateMu.Lock()
	defer windowStateMu.Unlock()
	if win.IsMaximised() {
		base := st
		if lastNormal != nil {
			base = *lastNormal
		}
		base.State = "maximised"
		lastState = &base
		return
	}
	lastNormal = &st
	snapshot := st
	lastState = &snapshot
}

func saveWindowState(app *application.App, win *application.WebviewWindow) {
	windowStateMu.Lock()
	st := lastState
	windowStateMu.Unlock()
	if st == nil {
		return
	}
	writeWindowState(*st)
	log.Printf("window state saved: %+v", *st)
}

func clampInt(v, lo, hi int) int {
	if hi < lo {
		return lo
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
