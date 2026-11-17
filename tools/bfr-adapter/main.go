// Adaptor BFR-WEBUI-GO untuk OpenWrt.
// Menyajikan frontend BFR apa adanya (dist/) dan menerjemahkan API-nya
// ke data OpenWrt: /proc, /sys, uci, iw, mmcli, init.d.
// Berjalan di port sendiri (bawaan 8082); LuCI di 80 tidak diubah.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed dist
var distFS embed.FS

var secret []byte

func main() {
	secret = loadSecret()
	port := os.Getenv("BFR_PORT")
	if port == "" {
		port = "8082"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", apiLogin)
	mux.HandleFunc("/api/auth/logout", apiLogout)
	mux.HandleFunc("/api/auth/status", apiAuthStatus)
	mux.HandleFunc("/api/sysinfo", apiSysinfo)
	mux.HandleFunc("/api/stats", apiSysinfo)
	mux.HandleFunc("/api/shortcuts/", apiShortcuts)

	// modem
	mux.HandleFunc("/api/modem/signal", apiModemSignal)
	mux.HandleFunc("/api/modem/cell", apiModemCell)
	mux.HandleFunc("/api/modem/bands", apiModemBands)
	mux.HandleFunc("/api/modem/lock", apiModemLock)
	mux.HandleFunc("/api/modem/rotate", apiModemRotate)
	mux.HandleFunc("/api/modem/action", apiModemAction)
	mux.HandleFunc("/api/modem/sim/status", apiModemSimStatus)
	mux.HandleFunc("/api/modem/sim/switch", apiModemUnsupported)
	mux.HandleFunc("/api/modem/thermal", apiModemThermal)
	mux.HandleFunc("/api/modem/at", apiModemAT)
	mux.HandleFunc("/api/modem/plmn_lock", apiModemUnsupported)
	mux.HandleFunc("/api/modem/status", apiModemSignal)

	// jaringan
	mux.HandleFunc("/api/network/ttl", apiNetworkTTL)
	mux.HandleFunc("/api/network/dns", apiNetworkDNS)
	mux.HandleFunc("/api/network/dns/reset", apiNetworkDNSReset)
	mux.HandleFunc("/api/network/ping", apiNetworkPing)
	mux.HandleFunc("/api/network/tweaks", apiNetworkTweaks)

	// tethering & QoS
	mux.HandleFunc("/api/hotspot/status", apiHotspotStatus)
	mux.HandleFunc("/api/hotspot/clients", apiHotspotClients)
	mux.HandleFunc("/api/hotspot/settings", apiHotspotSettings)
	mux.HandleFunc("/api/hotspot/control", apiHotspotControl)
	mux.HandleFunc("/api/hotspot/mac-filter", apiHotspotMACFilter)
	mux.HandleFunc("/api/qos/status", apiQoSStatus)
	mux.HandleFunc("/api/qos/apply", apiQoSApply)

	// SMS, log, daya
	mux.HandleFunc("/api/sms/inbox", apiSMSInbox)
	mux.HandleFunc("/api/logs", apiLogs)
	mux.HandleFunc("/api/logs/clear", apiLogsClear)
	mux.HandleFunc("/api/power", apiPower)
	mux.HandleFunc("/api/power/schedule", apiPowerSchedule)

	// vnstat, ssh, kernel
	mux.HandleFunc("/api/vnstat/stats", apiVnstatStats)
	mux.HandleFunc("/api/vnstat/reset", apiVnstatReset)
	mux.HandleFunc("/api/ssh/status", apiSSHStatus)
	mux.HandleFunc("/api/kernel/status", apiKernelStatus)
	mux.HandleFunc("/api/kernel/profile", apiKernelProfile)
	mux.HandleFunc("/api/kernel/cluster", apiKernelCluster)
	mux.HandleFunc("/api/kernel/vm", apiKernelVM)

	// proxy, tunnel, speedtest
	mux.HandleFunc("/api/proxy/status", apiProxyStatus)
	mux.HandleFunc("/api/proxy/control", apiProxyControl)
	mux.HandleFunc("/api/proxy/settings", apiProxyMode)
	mux.HandleFunc("/api/proxy/subs", apiUnsupported)
	mux.HandleFunc("/api/proxy/apps", apiUnsupported)
	mux.HandleFunc("/api/proxy/hotspot", apiUnsupported)
	mux.HandleFunc("/api/tunnel/status", apiTunnelStatus)
	mux.HandleFunc("/api/tunnel/start", apiTunnelControl)
	mux.HandleFunc("/api/tunnel/stop", apiTunnelControl)
	mux.HandleFunc("/api/tunnel/upload", apiTunnelControl)
	mux.HandleFunc("/api/speedtest/run", apiSpeedtestRun)
	mux.HandleFunc("/api/speedtest", apiSpeedtestRun)

	// berkas
	mux.HandleFunc("/api/files/list", apiFilesList)
	mux.HandleFunc("/api/files/storage", apiFilesStorage)
	mux.HandleFunc("/api/files/read", apiFilesRead)
	mux.HandleFunc("/api/files/save", apiFilesWrite)
	mux.HandleFunc("/api/files/write", apiFilesWrite)
	mux.HandleFunc("/api/files/download", apiFilesDownload)
	mux.HandleFunc("/api/files/upload", apiFilesUpload)
	for _, a := range []string{"delete", "mkdir", "create", "rename", "move", "copy", "permissions",
		"compress", "extract", "search", "batch"} {
		mux.HandleFunc("/api/files/"+a, apiFilesAction)
	}

	// NAS
	mux.HandleFunc("/api/nas/status", apiNAS)
	mux.HandleFunc("/api/nas/start", apiNAS)
	mux.HandleFunc("/api/nas/stop", apiNAS)
	mux.HandleFunc("/api/nas/config", apiNAS)
	mux.HandleFunc("/api/", apiUnsupported)
	mux.HandleFunc("/", staticHandler)

	go func() { run(10, "mmcli", "-m", "any", "--signal-setup=5") }()
	go func() {
		time.Sleep(20 * time.Second)
		smsCacheSet(fetchInbox(8))
		go SMSWarmer()
	}()
	go func() { time.Sleep(5 * time.Second); g3(); go cellWarmer() }()
	logf("bfr-adapter di :%s", port)
	if err := (&http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 10 * time.Second}).ListenAndServe(); err != nil {
		logf("gagal: %v", err)
	}
}

func logf(f string, a ...any) {
	os.Stdout.WriteString(time.Now().Format("15:04:05") + " " + fmtS(f, a...) + "\n")
}

/* ---------- util ---------- */

func run(secs int, name string, args ...string) string {
	ctx, cancel := ctxTimeout(secs)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return strings.TrimSpace(string(ee.Stderr))
		}
	}
	return strings.TrimSpace(string(out))
}

func ctxTimeout(secs int) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
}

func fmtS(f string, a ...any) string { return fmt.Sprintf(f, a...) }

func readTrim(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func num(v string) float64 {
	f := strings.Fields(v)
	if len(f) == 0 {
		return 0
	}
	x, _ := strconv.ParseFloat(f[0], 64)
	return x
}

func fieldOf(line string) (string, string) {
	if i := strings.LastIndex(line, "|"); i >= 0 {
		line = line[i+1:]
	}
	i := strings.Index(line, ":")
	if i < 0 {
		return "", ""
	}
	return strings.TrimSpace(line[:i]), strings.TrimSpace(line[i+1:])
}

/* ---------- auth ---------- */

func loadSecret() []byte {
	p := "/etc/bfr-adapter.secret"
	if b, err := os.ReadFile(p); err == nil && len(b) >= 32 {
		return b
	}
	b := make([]byte, 32)
	rand.Read(b)
	s := hex.EncodeToString(b)
	os.WriteFile(p, []byte(s), 0600)
	return []byte(s)
}

func password() string {
	if p := os.Getenv("BFR_PASSWORD"); p != "" {
		return p
	}
	if out := run(6, "uci", "-q", "get", "panel.password"); out != "" {
		return out
	}
	return "rolex"
}

func authed(r *http.Request) bool {
	c, err := r.Cookie("bfr_session")
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

func apiAuthStatus(w http.ResponseWriter, r *http.Request) {
	jsonOut(w, map[string]any{
		"authenticated":   authed(r),
		"is_default_pass": false,
	})
}

func apiLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST saja", 405)
		return
	}
	var b struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	if subtle.ConstantTimeCompare([]byte(b.Password), []byte(password())) != 1 {
		time.Sleep(500 * time.Millisecond)
		w.WriteHeader(401)
		jsonOut(w, map[string]any{"success": false, "message": "Kata sandi salah"})
		return
	}
	exp := strconv.FormatInt(time.Now().Add(12*time.Hour).Unix(), 10)
	http.SetCookie(w, &http.Cookie{Name: "bfr_session", Value: sign(exp), Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 12 * 3600})
	jsonOut(w, map[string]any{"success": true, "message": "Masuk"})
}

func apiLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "bfr_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	jsonOut(w, map[string]any{"success": true, "message": "Keluar"})
}

func sign(exp string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(exp))
	return exp + "|" + hex.EncodeToString(m.Sum(nil))
}

/* ---------- data OpenWrt ---------- */

var (
	cpuMu   sync.Mutex
	cpuPrev uint64
	idlePre uint64
	cpuPct  float64
)

func cpuPercent() float64 {
	cpuMu.Lock()
	defer cpuMu.Unlock()
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuPct
	}
	f := strings.Fields(strings.SplitN(string(b), "\n", 2)[0])
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
		cpuPct = (float64(total-cpuPrev) - float64(idle-idlePre)) / float64(total-cpuPrev) * 100
	}
	cpuPrev, idlePre = total, idle
	return cpuPct
}

func meminfo() map[string]int {
	m := map[string]int{}
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return m
	}
	for _, l := range strings.Split(string(b), "\n") {
		f := strings.Fields(l)
		if len(f) < 2 {
			continue
		}
		v, _ := strconv.Atoi(f[1])
		m[strings.TrimSuffix(f[0], ":")] = v / 1024
	}
	return m
}

func thermals() []map[string]any {
	var out []map[string]any
	ents, _ := os.ReadDir("/sys/class/thermal")
	best := 0.0
	for _, e := range ents {
		if !strings.HasPrefix(e.Name(), "thermal_zone") {
			continue
		}
		v := num(readTrim("/sys/class/thermal/" + e.Name() + "/temp"))
		if v == 0 {
			continue
		}
		c := v / 1000
		typ := readTrim("/sys/class/thermal/" + e.Name() + "/type")
		out = append(out, map[string]any{"name": typ, "temp": c})
		if c > best {
			best = c
		}
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out
}

func cpuCores() []map[string]any {
	var out []map[string]any
	for i := 0; i < 8; i++ {
		base := "/sys/devices/system/cpu/cpu" + strconv.Itoa(i)
		if _, err := os.Stat(base); err != nil {
			break
		}
		f := num(readTrim(base + "/cpufreq/scaling_cur_freq"))
		out = append(out, map[string]any{"core": i, "freq_mhz": int(f / 1000), "usage": cpuPercent()})
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out
}

var services = []string{"rolex-lte", "rolex-wifi", "rolex-nat", "dnsmasq", "adguardhome", "openclash", "nikki", "tailscale", "dropbear", "ttyd", "uhttpd", "bandix"}

func servicesStatus() []map[string]any {
	out := make([]map[string]any, 0, len(services))
	for _, s := range services {
		running := false
		detail := "tidak ada"
		if _, err := os.Stat("/etc/init.d/" + s); err == nil {
			detail = "mati"
			ctx, cancel := ctxTimeout(4)
			if exec.CommandContext(ctx, "/etc/init.d/"+s, "running").Run() == nil {
				running = true
				detail = "jalan"
			}
			cancel()
		}
		out = append(out, map[string]any{"name": s, "key": s, "running": running, "detail": detail})
	}
	return out
}

var (
	lteMu   sync.Mutex
	lteLast map[string]string
	lteAt   time.Time
)

func lteCached() map[string]string {
	lteMu.Lock()
	defer lteMu.Unlock()
	if time.Since(lteAt) < 20*time.Second && lteLast != nil {
		return lteLast
	}
	out := map[string]string{}
	for _, l := range strings.Split(run(6, "mmcli", "-m", "any", "-K"), "\n") {
		if i := strings.Index(l, ":"); i > 0 {
			out[strings.TrimSpace(l[:i])] = strings.TrimSpace(l[i+1:])
		}
	}
	for _, l := range strings.Split(run(6, "mmcli", "-m", "any", "--location-get"), "\n") {
		k, v := fieldOf(l)
		switch k {
		case "cell id":
			out["loc.cell"] = v
		case "tracking area code":
			out["loc.tac"] = v
		}
	}
	for _, l := range strings.Split(run(6, "mmcli", "-m", "any", "--signal-get"), "\n") {
		k, v := fieldOf(l)
		switch k {
		case "rssi":
			out["sig.rssi"] = v
		case "rsrp":
			out["sig.rsrp"] = v
		case "rsrq":
			out["sig.rsrq"] = v
		case "s/n", "snr":
			out["sig.sinr"] = v
		}
	}
	lteLast, lteAt = out, time.Now()
	return out
}

func ifaceIP(dev string) string {
	f := strings.Fields(run(4, "ip", "-4", "-o", "addr", "show", dev))
	for i, x := range f {
		if x == "inet" && i+1 < len(f) {
			return f[i+1]
		}
	}
	return ""
}

func ifaceBytes(dev string) (float64, float64) {
	rx := num(readTrim("/sys/class/net/" + dev + "/statistics/rx_bytes"))
	tx := num(readTrim("/sys/class/net/" + dev + "/statistics/tx_bytes"))
	return rx, tx
}

func apiSysinfo(w http.ResponseWriter, r *http.Request) {
	if !authed(r) {
		w.WriteHeader(401)
		jsonOut(w, map[string]any{"error": "belum masuk"})
		return
	}
	mi := meminfo()
	used := mi["MemTotal"] - mi["MemAvailable"]
	pct := 0.0
	if mi["MemTotal"] > 0 {
		pct = float64(used) / float64(mi["MemTotal"]) * 100
	}
	var st syscall.Statfs_t
	var dTotal, dFree, dUsed int
	var dPct float64
	if syscall.Statfs("/", &st) == nil {
		bs := float64(st.Bsize)
		dTotal = int(float64(st.Blocks) * bs / 1048576)
		dFree = int(float64(st.Bavail) * bs / 1048576)
		dUsed = dTotal - dFree
		if dTotal > 0 {
			dPct = float64(dUsed) / float64(dTotal) * 100
		}
	}
	load := strings.Fields(readTrim("/proc/loadavg"))
	ld := func(i int) float64 {
		if i < len(load) {
			return num(load[i])
		}
		return 0
	}
	up := num(readTrim("/proc/uptime"))
	rx, tx := ifaceBytes("usb0")
	lte := lteCached()
	th := thermals()
	temp := 0.0
	for _, x := range th {
		if v, ok := x["temp"].(float64); v > temp && ok {
			temp = v
		}
	}
	clients := 0
	for _, l := range strings.Split(run(5, "iw", "dev", "wlan0", "station", "dump"), "\n") {
		if strings.HasPrefix(strings.TrimSpace(l), "Station ") {
			clients++
		}
	}
	wifiSSID := ""
	for _, l := range strings.Split(run(5, "iw", "dev", "wlan0", "info"), "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "ssid ") {
			wifiSSID = strings.TrimSpace(strings.TrimPrefix(l, "ssid"))
		}
	}
	gw := ""
	for _, l := range strings.Split(run(5, "ip", "route"), "\n") {
		if strings.HasPrefix(l, "default") {
			f := strings.Fields(l)
			for i, x := range f {
				if x == "via" && i+1 < len(f) {
					gw = f[i+1]
				}
			}
			break
		}
	}
	dns := []string{}
	for _, l := range strings.Split(readTrim("/etc/resolv.conf"), "\n") {
		if strings.HasPrefix(l, "nameserver") {
			dns = append(dns, strings.TrimSpace(strings.TrimPrefix(l, "nameserver")))
		}
	}
	openwrt := ""
	if b, err := os.ReadFile("/etc/openwrt_release"); err == nil {
		for _, l := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(l, "DISTRIB_DESCRIPTION=") {
				openwrt = strings.Trim(strings.TrimPrefix(l, "DISTRIB_DESCRIPTION="), "'")
			}
		}
	}
	rsrp := num(lte["sig.rsrp"])
	sigPct := 0
	if rsrp != 0 {
		sigPct = int(((rsrp + 120) * 100) / 50)
		if sigPct < 0 {
			sigPct = 0
		}
		if sigPct > 100 {
			sigPct = 100
		}
	}
	b := func(mb int) int64 { return int64(mb) * 1048576 }
	resp := map[string]any{
		"cpu_usage":     cpuPercent(),
		"cpu_cores":     cpuCores(),
		"cpu_temp":      temp,
		"mem_total":     b(mi["MemTotal"]), "mem_free": b(mi["MemFree"]), "mem_available": b(mi["MemAvailable"]),
		"mem_used": b(used), "mem_used_pct": pct,
		"swap_total": b(mi["SwapTotal"]), "swap_free": b(mi["SwapFree"]),
		"swap_used": b(mi["SwapTotal"] - mi["SwapFree"]),
		"swap_used_pct": func() float64 {
			if mi["SwapTotal"] == 0 {
				return 0
			}
			return float64(mi["SwapTotal"]-mi["SwapFree"]) / float64(mi["SwapTotal"]) * 100
		}(),
		"load_avg":         map[string]any{"one": ld(0), "five": ld(1), "fifteen": ld(2)},
		"active_services":  servicesStatus(),
		"uptime":           int(up),
		"battery_level":    0,
		"battery_status":   "Tidak ada baterai",
		"battery_temp":     0,
		"thermals":         th,
		"disk_total":       b(dTotal),
		"disk_free":        b(dFree),
		"disk_used":        b(dUsed),
		"disk_used_pct":    dPct,
		"disks":            []map[string]any{{"path": "/", "total": b(dTotal), "used": b(dUsed), "free": b(dFree), "used_pct": dPct}},
		"model":            "Redmi 4A (rolex)",
		"android_ver":      openwrt,
		"selinux":          "n/a",
		"security_patch":   "-",
		"sdk_ver":          "-",
		"resolution":       "-",
		"density":          "-",
		"mtu":              readTrim("/sys/class/net/usb0/mtu"),
		"default_ttl":      readTrim("/proc/sys/net/ipv4/ip_default_ttl"),
		"kernel":           readTrim("/proc/sys/kernel/osrelease"),
		"soc":              "MSM8917 (Snapdragon 425)",
		"governor":         readTrim("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"),
		"rom":              openwrt,
		"root_type":        "sistem OpenWrt",
		"chipset":          "MSM8917",
		"device_name":      "rolex",
		"webui_version":    "BFR frontend + adaptor OpenWrt",
		"net_rx":           int(rx),
		"net_tx":           int(tx),
		"network_detail": map[string]any{
			"interface": "wwan0", "ip": strings.Split(ifaceIP("wwan0"), "/")[0],
			"ip_addresses": []string{ifaceIP("wwan0"), ifaceIP("usb0"), ifaceIP("wlan0")},
			"gateway":      gw, "dns": dns,
			"wifi_ssid": wifiSSID, "hotspot_clients": clients,
			"sim_slots": []map[string]any{{
				"slot": 1, "operator": lte["modem.3gpp.operator-name"],
				"network_type": "LTE", "signal_strength": sigPct,
				"rsrp": lte["sig.rsrp"], "rsrq": lte["sig.rsrq"], "sinr": lte["sig.sinr"],
			}},
		},
	}
	resp["network"] = resp["network_detail"]
	jsonOut(w, resp)
}


/* ---------- pintasan (shortcuts) ---------- */

type shortcut struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Icon        string `json:"icon,omitempty"`
	Category    string `json:"category,omitempty"`
	Description string `json:"description,omitempty"`
}

const shortcutsFile = "/etc/bfr-shortcuts.json"

func defaultShortcuts() []shortcut {
	return []shortcut{
		{ID: "luci", Name: "LuCI", URL: "/cgi-bin/luci/", Icon: "router", Category: "sistem", Description: "antarmuka OpenWrt"},
		{ID: "terminal", Name: "Terminal", URL: "http://192.168.42.1:7681", Icon: "terminal", Category: "alat", Description: "ttyd root shell"},
		{ID: "bandix", Name: "Bandix", URL: "http://192.168.42.1:8686", Icon: "chart", Category: "jaringan", Description: "pemakaian data"},
		{ID: "adguard", Name: "AdGuard", URL: "http://192.168.42.1:3000", Icon: "shield", Category: "jaringan", Description: "DNS & filter"},
		{ID: "openclash", Name: "OpenClash", URL: "http://192.168.42.1:9090", Icon: "globe", Category: "jaringan", Description: "panel proxy"},
	}
}

func loadShortcuts() []shortcut {
	b, err := os.ReadFile(shortcutsFile)
	if err != nil {
		return defaultShortcuts()
	}
	var out []shortcut
	if json.Unmarshal(b, &out) != nil || out == nil {
		return defaultShortcuts()
	}
	return out
}

func saveShortcuts(list []shortcut) {
	b, _ := json.MarshalIndent(list, "", " ")
	os.WriteFile(shortcutsFile, b, 0644)
}

func apiShortcuts(w http.ResponseWriter, r *http.Request) {
	if !authed(r) {
		w.WriteHeader(401)
		jsonOut(w, map[string]any{"error": "belum masuk"})
		return
	}
	list := loadShortcuts()
	switch {
	case strings.HasSuffix(r.URL.Path, "/list"):
		jsonOut(w, list)
	case strings.HasSuffix(r.URL.Path, "/save"):
		var in struct {
			Shortcuts []shortcut `json:"shortcuts"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		if in.Shortcuts != nil {
			for i := range in.Shortcuts {
				if in.Shortcuts[i].ID == "" {
					in.Shortcuts[i].ID = strconv.FormatInt(time.Now().UnixNano(), 36)
				}
			}
			saveShortcuts(in.Shortcuts)
			list = in.Shortcuts
		}
		jsonOut(w, map[string]any{"success": true, "shortcuts": list})
	case strings.HasSuffix(r.URL.Path, "/delete"):
		var in struct{ ID string `json:"id"` }
		json.NewDecoder(r.Body).Decode(&in)
		keep := make([]shortcut, 0, len(list))
		for _, x := range list {
			if x.ID != in.ID {
				keep = append(keep, x)
			}
		}
		saveShortcuts(keep)
		jsonOut(w, map[string]any{"success": true, "shortcuts": keep})
	default:
		http.NotFound(w, r)
	}
}

func apiUnsupported(w http.ResponseWriter, r *http.Request) {
	jsonOut(w, map[string]any{
		"error":  "belum didukung di OpenWrt: " + r.URL.Path,
		"status": "unsupported",
	})
}

/* ---------- static ---------- */

func staticHandler(w http.ResponseWriter, r *http.Request) {
	up := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if up == "" {
		up = "index.html"
	}
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		http.Error(w, "aset tidak ada", 500)
		return
	}
	data, err := fs.ReadFile(sub, up)
	if err != nil {
		data, err = fs.ReadFile(sub, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		up = "index.html"
	}
	if ct := mime.TypeByExtension(path.Ext(up)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	// no-cache: nama berkas aset tidak berubah walau isinya kita sesuaikan (rebrand.sh),
	// jadi jangan biarkan browser memakai salinan lama.
	w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	w.Write(data)
}

func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}