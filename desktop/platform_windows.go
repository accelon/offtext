//go:build windows

package main

import (
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sys/windows"
)

var (
	user32           = windows.NewLazySystemDLL("user32.dll")
	procGetCursorPos = user32.NewProc("GetCursorPos")
	procMessageBoxW  = user32.NewProc("MessageBoxW")
)

type winPoint struct {
	X int32
	Y int32
}

// nativeCursorPhysicalRect 只回傳游標的實體座標；換算交給 app.Screen，
// 不把 Win32 座標直接塞進 Wails 的邏輯座標。
func nativeCursorPhysicalRect() (application.Rect, bool) {
	var p winPoint
	ret, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	if ret == 0 {
		return application.Rect{}, false
	}
	return application.Rect{X: int(p.X), Y: int(p.Y), Width: 1, Height: 1}, true
}

func fatalDialog(title, message string) {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(message)
	const mbOK = 0x00000000
	const mbIconError = 0x00000010
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbOK|mbIconError)
}
