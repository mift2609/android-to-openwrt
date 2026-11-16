package main

import (
	"embed"
	"net/http"
)

//go:embed ui
var uiFS embed.FS

func uiFile(name string) string {
	b, err := uiFS.ReadFile("ui/" + name)
	if err != nil {
		return ""
	}
	return string(b)
}

func index(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/":
		if !authed(r) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(uiFile("login.html")))
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(uiFile("app.html")))
	case "/s.css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Write([]byte(uiFile("style.css")))
	case "/a.js":
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Write([]byte(uiFile("app.js")))
	default:
		http.NotFound(w, r)
	}
}