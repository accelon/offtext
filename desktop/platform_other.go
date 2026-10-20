//go:build !windows && !darwin

package main

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func nativeCursorPhysicalRect() (application.Rect, bool) {
	return application.Rect{}, false
}

func fatalDialog(title, message string) {
	log.Printf("%s: %s", title, message)
}
