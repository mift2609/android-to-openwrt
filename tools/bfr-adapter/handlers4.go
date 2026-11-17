package main

// Panel Proxy: OpenClash + Nikki/Mihomo (status + mulai/stop/ulang).
// Keduanya sudah terpasang di rolex; modul ini hanya membaca keadaan dan
// menjalankan init script-nya, tidak menyentuh konfigurasi.

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

var proxyEngines = []struct {
	Key   string // nama init script
	Nama  string // nama tampil
	LuCI  string // halaman LuCI-nya
	Profil string // kunci uci untuk profil (kalau ada)
}{
	{"openclash", "OpenClash", "/cgi-bin/luci/admin/services/openclash", "openclash"},
	{"nikki", "Nikki (Mihomo)", "/cgi-bin/luci/admin/services/nikki", "nikki"},
}

func ok(secs int, sh string) bool {
	return strings.TrimSpace(run(secs, "sh", "-c", sh+" >/dev/null 2>&1 && echo ya || echo tidak")) == "ya"
}

func uciGet(k string) string {
	v := strings.TrimSpace(run(6, "uci", "-q", "get", k))
	if v == "" || v == "nil" {
		return ""
	}
	return v
}

func engineStatus(e struct {
	Key   string
	Nama  string
	LuCI  string
	Profil string
}) map[string]any {
	init := "/etc/init.d/" + e.Key
	_, err := os.Stat(init)
	out := map[string]any{
		"key":       e.Key,
		"name":      e.Nama,
		"luci":      e.LuCI,
		"installed": err == nil,
		"running":   err == nil && ok(8, init+" running"),
	}
	if err != nil {
		return out
	}
	switch e.Key {
	case "openclash":
		out["enabled"] = uciGet("openclash.config.enable") == "1"
		out["mode"] = uciGet("openclash.config.mode")
		out["core"] = uciGet("openclash.config.core_version")
		out["ports"] = map[string]string{
			"http":  uciGet("openclash.config.http_port"),
			"socks": uciGet("openclash.config.socks_port"),
			"mixed": uciGet("openclash.config.mixed_port"),
		}
		out["config"] = uciGet("openclash.config.config_path")
	case "nikki":
		out["enabled"] = uciGet("nikki.config.enabled") == "1"
		out["profile"] = uciGet("nikki.config.profile")
		out["mode"] = uciGet("nikki.config.mode")
		out["core"] = "mihomo"
	}
	// versi biner (dipanggil sekali, cepat)
	if v := strings.TrimSpace(run(8, "sh", "-c", "ls /usr/bin/mihomo /etc/openclash/core/clash_meta 2>/dev/null | head -1")); v != "" {
		out["binary"] = v
	}
	return out
}

func apiProxyEngineStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	list := []map[string]any{}
	for _, e := range proxyEngines {
		list = append(list, engineStatus(e))
	}
	jsonOut(w, map[string]any{
		"engines": list,
		"uptime":  strings.TrimSpace(run(4, "sh", "-c", "cut -d. -f1 /proc/uptime")),
	})
}

func apiProxyEngineAction(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		jsonOut(w, map[string]any{"error": "POST saja"})
		return
	}
	var body struct {
		Engine string `json:"engine"`
		Action string `json:"action"` // start | stop | restart
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		jsonOut(w, map[string]any{"error": "body tidak valid"})
		return
	}
	found := false
	for _, e := range proxyEngines {
		if e.Key == body.Engine {
			found = true
			break
		}
	}
	if !found {
		jsonOut(w, map[string]any{"error": "engine tidak dikenal"})
		return
	}
	switch body.Action {
	case "start", "stop", "restart":
	default:
		jsonOut(w, map[string]any{"error": "aksi harus start/stop/restart"})
		return
	}
	init := "/etc/init.d/" + body.Engine
	if _, err := os.Stat(init); err != nil {
		jsonOut(w, map[string]any{"error": body.Engine + " tidak terpasang"})
		return
	}
	pesan := map[string]string{
		"start":   "menjalankan " + body.Engine + "…",
		"stop":    "menghentikan " + body.Engine + "…",
		"restart": "mengulang " + body.Engine + "…",
	}[body.Action]
	// jalankan di latar: start/stop bisa 10–30 detik dan UI tidak perlu menunggu
	go run(120, "sh", "-c", init+" "+body.Action)
	time.Sleep(700 * time.Millisecond)
	jsonOut(w, map[string]any{
		"ok":      true,
		"message": pesan + " (status menyusul ±10–30 s)",
	})
}