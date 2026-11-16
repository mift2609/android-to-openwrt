// Panel OpenWrt untuk rolex — Tahap 1.
// Satu biner statis, stdlib saja. Berjalan di port sendiri (bawaan 8081),
// TIDAK menyentuh LuCI (uhttpd tetap di port 80).
package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const version = "1.0-tahap1"

var secret []byte

func main() {
	secret = loadSecret()
	port := os.Getenv("PANEL_PORT")
	if port == "" {
		port = "8081"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", index)
	mux.HandleFunc("/api/login", login)
	mux.HandleFunc("/api/logout", logout)
	mux.HandleFunc("/api/status", status)
	mux.HandleFunc("/api/service", service)
	mux.HandleFunc("/api/modem", modem)
	mux.HandleFunc("/api/wifi", wifi)
	srv := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { run(10, "mmcli", "-m", "any", "--signal-setup=5") }()
	logf("panel mulai di :%s (versi %s)", port, version)
	if err := srv.ListenAndServe(); err != nil {
		logf("gagal: %v", err)
	}
}

func logf(f string, a ...any) {
	os.Stdout.WriteString(time.Now().Format("15:04:05") + " " + fmt.Sprintf(f, a...) + "\n")
}

func sprintf(f string, a ...any) string { return fmt.Sprintf(f, a...) }

func timeoutCtx(secs int) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
}

// --- auth ---

func loadSecret() []byte {
	p := "/etc/panel.secret"
	if b, err := os.ReadFile(p); err == nil && len(b) >= 32 {
		return b
	}
	b := make([]byte, 32)
	rand.Read(b)
	os.WriteFile(p, []byte(hex.EncodeToString(b)), 0600)
	return []byte(hex.EncodeToString(b))
}

func password() string {
	if p := os.Getenv("PANEL_PASSWORD"); p != "" {
		return p
	}
	if out := run(6, "uci", "-q", "get", "panel.password"); out != "" {
		return out
	}
	return "rolex"
}

func sign(exp string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(exp))
	return exp + "|" + hex.EncodeToString(m.Sum(nil))
}

func authed(r *http.Request) bool {
	c, err := r.Cookie("panel_session")
	if err != nil {
		return false
	}
	parts := strings.SplitN(c.Value, "|", 2)
	if len(parts) != 2 {
		return false
	}
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(parts[0]))
	if subtle.ConstantTimeCompare([]byte(hex.EncodeToString(m.Sum(nil))), []byte(parts[1])) != 1 {
		return false
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	return err == nil && time.Now().Unix() < exp
}

func login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST saja", 405)
		return
	}
	var body struct{ Password string }
	json.NewDecoder(r.Body).Decode(&body)
	if subtle.ConstantTimeCompare([]byte(body.Password), []byte(password())) != 1 {
		time.Sleep(600 * time.Millisecond) // perlambat tebak-tebakan
		w.WriteHeader(401)
		json.NewEncoder(w).Encode(map[string]string{"error": "sandi salah"})
		return
	}
	exp := strconv.FormatInt(time.Now().Add(12*time.Hour).Unix(), 10)
	http.SetCookie(w, &http.Cookie{Name: "panel_session", Value: sign(exp), Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 12 * 3600})
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "panel_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// --- util ---

func run(secs int, name string, args ...string) string {
	ctx, cancel := timeoutCtx(secs)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return strings.TrimSpace(string(ee.Stderr) + string(out))
		}
		return strings.TrimSpace(string(out))
	}
	return strings.TrimSpace(string(out))
}

func kv(out string) map[string]string {
	m := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if i := strings.Index(line, "="); i > 0 {
			m[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
			continue
		}
		if i := strings.Index(line, ":"); i > 0 {
			k := strings.TrimSpace(line[:i])
			if k != "" && !strings.HasPrefix(k, "-") {
				m[k] = strings.TrimSpace(line[i+1:])
			}
		}
	}
	return m
}

// field mengambil "kunci: nilai" dari baris mmcli yang berbentuk "3GPP | kunci: nilai".
func field(line string) (string, string) {
	if i := strings.LastIndex(line, "|"); i >= 0 {
		line = line[i+1:]
	}
	i := strings.Index(line, ":")
	if i < 0 {
		return "", ""
	}
	return strings.TrimSpace(line[:i]), strings.TrimSpace(line[i+1:])
}

func readTrim(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func memMB() (used, total int) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	var tot, avail int
	for _, l := range strings.Split(string(b), "\n") {
		f := strings.Fields(l)
		if len(f) < 2 {
			continue
		}
		switch f[0] {
		case "MemTotal:":
			tot, _ = strconv.Atoi(f[1])
		case "MemAvailable:":
			avail, _ = strconv.Atoi(f[1])
		}
	}
	return (tot - avail) / 1024, tot / 1024
}

func tempC() string {
	best := 0.0
	ents, _ := os.ReadDir("/sys/class/thermal")
	for _, e := range ents {
		if !strings.HasPrefix(e.Name(), "thermal_zone") {
			continue
		}
		v := readTrim("/sys/class/thermal/" + e.Name() + "/temp")
		if v == "" {
			continue
		}
		mv, err := strconv.ParseFloat(v, 64)
		if err != nil {
			continue
		}
		c := mv / 1000.0
		if c > best {
			best = c
		}
	}
	if best == 0 {
		return "-"
	}
	return strconv.FormatFloat(best, 'f', 1, 64)
}

func uptime() string {
	s := strings.Fields(readTrim("/proc/uptime"))
	if len(s) == 0 {
		return "-"
	}
	f, _ := strconv.ParseFloat(s[0], 64)
	d := int(f) / 86400
	h := (int(f) % 86400) / 3600
	m := (int(f) % 3600) / 60
	return sprintf("%dd %02d:%02d", d, h, m)
}

func ifaceIP(dev string) string {
	out := run(5, "ip", "-4", "-o", "addr", "show", dev)
	f := strings.Fields(out)
	for i, x := range f {
		if x == "inet" && i+1 < len(f) {
			return f[i+1]
		}
	}
	return "-"
}

func ifaceStat(dev, which string) string {
	v := readTrim("/sys/class/net/" + dev + "/statistics/" + which + "_bytes")
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return "-"
	}
	switch {
	case n > 1073741824:
		return strconv.FormatFloat(n/1073741824, 'f', 2, 64) + " GiB"
	case n > 1048576:
		return strconv.FormatFloat(n/1048576, 'f', 1, 64) + " MiB"
	}
	return strconv.FormatFloat(n/1024, 'f', 0, 64) + " KiB"
}

// --- data ---

func wifiClients() []map[string]string {
	out := run(6, "iw", "dev", "wlan0", "station", "dump")
	list := []map[string]string{}
	var cur map[string]string
	for _, l := range strings.Split(out, "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "Station ") {
			if cur != nil {
				list = append(list, cur)
			}
			cur = map[string]string{"mac": strings.Fields(l)[1]}
			continue
		}
		if cur == nil {
			continue
		}
		f := strings.SplitN(l, ":", 2)
		if len(f) != 2 {
			continue
		}
		k := strings.TrimSpace(f[0])
		v := strings.TrimSpace(f[1])
		switch k {
		case "signal", "rx bitrate", "tx bitrate", "connected time", "inactive time":
			cur[k] = v
		}
	}
	if cur != nil {
		list = append(list, cur)
	}
	return list
}


// lteData(): jalur cepat lewat ModemManager (mmcli -K ~0 s, signal-setup + location-get).
// rolex-modem-ctl status dipakai sebagai cadangan saja karena butuh ~41 s.
func lteData() map[string]string {
	m := kv(run(8, "mmcli", "-m", "any", "-K"))
	sig := run(8, "mmcli", "-m", "any", "--signal-get")
	loc := run(8, "mmcli", "-m", "any", "--location-get")
	out := map[string]string{
		"operator": m["modem.3gpp.operator-name"],
		"ps":       m["modem.3gpp.packet-service-state"],
		"state":    m["modem.generic.state"],
		"network":  m["modem.generic.access-technologies.value[1]"],
		"apn":      run(5, "uci", "-q", "get", "rolexlte.main.apn"),
	}
	for _, f := range strings.Split(sig, "\n") {
		k, v := field(f)
		switch k {
		case "rssi":
			out["rssi"] = v
		case "rsrp":
			out["rsrp"] = v
		case "rsrq":
			out["rsrq"] = v
		case "s/n", "snr":
			out["sinr"] = v
		}
	}
	for _, f := range strings.Split(loc, "\n") {
		k, v := field(f)
		switch k {
		case "cell id":
			out["cell"] = v
		case "tracking area code":
			out["tac"] = v
		case "operator mcc":
			out["plmn"] = v
		case "operator mnc":
			out["plmn"] = out["plmn"] + v
		}
	}
	return out
}


// cpuPercent: selisih /proc/stat antara dua pembacaan (dipanggil tiap refresh).
var (
	cpuMu   sync.Mutex
	cpuPrev uint64
	cpuIdle uint64
	cpuPct  float64
)

func cpuPercent() float64 {
	cpuMu.Lock()
	defer cpuMu.Unlock()
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	line := strings.SplitN(string(b), "\n", 2)[0]
	f := strings.Fields(line)
	if len(f) < 5 {
		return cpuPct
	}
	var total, idle uint64
	for i, x := range f[1:] {
		v, _ := strconv.ParseUint(x, 10, 64)
		total += v
		if i == 3 || i == 4 {
			idle += v
		}
	}
	if cpuPrev > 0 && total > cpuPrev {
		dt := float64(total - cpuPrev)
		di := float64(idle - cpuIdle)
		cpuPct = (dt - di) / dt * 100
	}
	cpuPrev, cpuIdle = total, idle
	return cpuPct
}

func diskMB() (used, total int) {
	var st syscall.Statfs_t
	if syscall.Statfs("/", &st) != nil {
		return 0, 0
	}
	bs := uint64(st.Bsize)
	tot := st.Blocks * bs / 1048576
	free := st.Bavail * bs / 1048576
	return int(tot - free), int(tot)
}

var serviceList = []string{"rolex-lte", "rolex-wifi", "rolex-nat", "dnsmasq", "adguardhome", "openclash", "nikki", "tailscale", "dropbear", "ttyd", "uhttpd", "bandix"}

func services() []map[string]string {
	var out []map[string]string
	for _, s := range serviceList {
		st := "tidak ada"
		if _, err := os.Stat("/etc/init.d/" + s); err == nil {
			st = "mati"
			if isRunning(s) {
				st = "jalan"
			}
		}
		out = append(out, map[string]string{"name": s, "state": st})
	}
	return out
}

func isRunning(s string) bool {
	ctx, cancel := timeoutCtx(5)
	defer cancel()
	return exec.CommandContext(ctx, "/etc/init.d/"+s, "running").Run() == nil
}

func internetOK() bool {
	ctx, cancel := timeoutCtx(4)
	defer cancel()
	return exec.CommandContext(ctx, "ping", "-c", "1", "-W", "2", "8.8.8.8").Run() == nil
}

func status(w http.ResponseWriter, r *http.Request) {
	if !authed(r) {
		w.WriteHeader(401)
		json.NewEncoder(w).Encode(map[string]string{"error": "belum masuk"})
		return
	}
	used, total := memMB()
	du, dt := diskMB()
	load := strings.Fields(readTrim("/proc/loadavg"))
	md := lteData()
	wf := kv(run(8, "/usr/bin/rolex-wifi-ctl", "status"))
	beat, _ := os.Stat("/tmp/rolex-lte.beat")
	beatAgo := -1
	if beat != nil {
		beatAgo = int(time.Since(beat.ModTime()).Seconds())
	}
	resp := map[string]any{
		"sys": map[string]any{
			"uptime": uptime(), "version": readTrim("/etc/openwrt_release"),
			"kernel": readTrim("/proc/sys/kernel/osrelease"),
			"host":   readTrim("/proc/sys/kernel/hostname"),
			"mem_used": used, "mem_total": total, "temp": tempC(),
			"cpu": int(cpuPercent()), "disk_used": du, "disk_total": dt,
			"load": strings.Join(load[:min(3, len(load))], " "),
		},
		"net": map[string]any{
			"internet": internetOK(), "usb_ip": ifaceIP("usb0"), "wwan_ip": ifaceIP("wwan0"),
			"wifi_ip": ifaceIP("wlan0"), "beat": beatAgo,
			"rx": ifaceStat("usb0", "rx"), "tx": ifaceStat("usb0", "tx"),
		},
		"lte": md,
		"wifi": map[string]any{
			"ssid": wf["ssid"], "channel": wf["channel"], "state": wf["ap_state"],
			"encryption": wf["encryption"], "ip": wf["ip"], "clients": wifiClients(),
		},
		"services": services(),
		"panel":    map[string]string{"version": version, "port": os.Getenv("PANEL_PORT")},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func service(w http.ResponseWriter, r *http.Request) {
	if !authed(r) {
		http.Error(w, "belum masuk", 401)
		return
	}
	if r.Method != http.MethodPost || r.Header.Get("X-Panel") != "1" {
		http.Error(w, "POST + header X-Panel", 405)
		return
	}
	var b struct{ Name, Action string }
	json.NewDecoder(r.Body).Decode(&b)
	ok := false
	for _, s := range serviceList {
		if s == b.Name {
			ok = true
		}
	}
	switch b.Action {
	case "start", "stop", "restart":
	default:
		ok = false
	}
	if !ok {
		http.Error(w, "tidak diizinkan", 403)
		return
	}
	out := run(45, "/etc/init.d/"+b.Name, b.Action)
	json.NewEncoder(w).Encode(map[string]string{"out": out})
}

func modem(w http.ResponseWriter, r *http.Request) {
	if !authed(r) || r.Method != http.MethodPost || r.Header.Get("X-Panel") != "1" {
		http.Error(w, "tidak diizinkan", 403)
		return
	}
	var b struct{ Action string }
	json.NewDecoder(r.Body).Decode(&b)
	var out string
	switch b.Action {
	case "restart":
		out = run(90, "/etc/init.d/rolex-lte", "restart")
	case "reset":
		out = run(120, "/usr/bin/rolex-data-reset", "auto")
	case "reconnect":
		out = run(60, "/usr/bin/rolex-modem-ctl", "netguard")
	default:
		http.Error(w, "aksi tidak dikenal", 400)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"out": out})
}

func wifi(w http.ResponseWriter, r *http.Request) {
	if !authed(r) || r.Method != http.MethodPost || r.Header.Get("X-Panel") != "1" {
		http.Error(w, "tidak diizinkan", 403)
		return
	}
	var b struct{ Action string }
	json.NewDecoder(r.Body).Decode(&b)
	var out string
	switch b.Action {
	case "restart":
		out = run(60, "/etc/init.d/rolex-wifi", "restart")
	case "apply":
		out = run(60, "/usr/bin/rolex-wifi-ctl", "apply")
	default:
		http.Error(w, "aksi tidak dikenal", 400)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"out": out})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}