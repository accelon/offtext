//go:build darwin

package main

import (
	"log"
	"os/exec"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// darwin 介面先留著：之後補上 NSEvent.mouseLocation 取得游標，再交給
// app.Screen 換算。目前一律回 false，讓 chooseScreen 退回主螢幕。
func nativeCursorPhysicalRect() (application.Rect, bool) {
	return application.Rect{}, false
}

func fatalDialog(title, message string) {
	log.Printf("%s: %s", title, message)
	script := `display alert "Offtext" message "` + escapeAppleScript(message) + `" as critical`
	_ = exec.Command("osascript", "-e", script).Run()
}

func escapeAppleScript(s string) string {
	out := ""
	for _, r := range s {
		switch r {
		case '\\':
			out += `\\`
		case '"':
			out += `\"`
		default:
			out += string(r)
		}
	}
	return out
}
