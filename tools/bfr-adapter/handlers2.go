package main

// Handler tambahan: vnstat, ssh, kernel, proxy, tunnel, speedtest, files, NAS.

import (
	"bufio"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"syscall"
	"strings"
	"time"
)

/* ---------- vnstat ---------- */

func apiVnstatStats(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	raw := run(20, "vnstat", "--json")
	var v map[string]any
	if json.Unmarshal([]byte(raw), &v) != nil {
		jsonOut(w, map[string]any{"daily": emptyPeriod(), "last_updated": "vnstat belum ada data",
			"error": "vnstat tidak mengembalikan JSON"})
		return
	}
	ifaces, _ := v["interfaces"].([]any)
	period := func(key string) map[string]any {
		out := emptyPeriod()
		ifaceMap := out["interfaces"].(map[string]any)
		var sumRx, sumTx float64
		for _, ic := range ifaces {
			im, _ := ic.(map[string]any)
			if im == nil {
				continue
			}
			traffic, _ := im["traffic"].(map[string]any)
			if traffic == nil {
				continue
			}
			days, _ := traffic[key].([]any)
			var rx, tx float64
			for _, d := range days {
				dm, _ := d.(map[string]any)
				if dm == nil {
					continue
				}
				rx += numAny(dm["rx"])
				tx += numAny(dm["tx"])
			}
			name, _ := im["name"].(string)
			ifaceMap[name] = map[string]any{"rx_bytes": int64(rx), "tx_bytes": int64(tx)}
			sumRx += rx
			sumTx += tx
		}
		out["total"] = map[string]any{"rx_bytes": int64(sumRx), "tx_bytes": int64(sumTx), "total": int64(sumRx + sumTx)}
		return out
	}
	// histori harian: gabungkan semua antarmuka per tanggal
	hist := map[string][2]float64{}
	for _, ic := range ifaces {
		im, _ := ic.(map[string]any)
		traffic, _ := im["traffic"].(map[string]any)
		if traffic == nil {
			continue
		}
		days, _ := traffic["day"].([]any)
		for _, d := range days {
			dm, _ := d.(map[string]any)
			if dm == nil {
				continue
			}
			date := "hari ini"
			if dd, ok := dm["date"].(map[string]any); ok {
				date = strconv.Itoa(int(numAny(dd["year"]))) + "-" + pad2(int(numAny(dd["month"]))) + "-" + pad2(int(numAny(dd["day"])))
			}
			cur := hist[date]
			cur[0] += numAny(dm["rx"])
			cur[1] += numAny(dm["tx"])
			hist[date] = cur
		}
	}
	histList := []map[string]any{}
	for date, v2 := range hist {
		histList = append(histList, map[string]any{
			"date": date, "rx_bytes": int64(v2[0]), "tx_bytes": int64(v2[1]), "total": int64(v2[0] + v2[1]),
		})
	}
	sort.Slice(histList, func(i, j int) bool {
		return histList[i]["date"].(string) < histList[j]["date"].(string)
	})
	jsonOut(w, map[string]any{
		"daily": period("day"), "yesterday": period("day"),
		"weekly": period("month"), "monthly": period("month"),
		"daily_history": histList, "year": period("year"),
		"last_updated": time.Now().Format("15:04:05"),
	})
}

func emptyPeriod() map[string]any {
	return map[string]any{
		"total":      map[string]any{"rx_bytes": 0, "tx_bytes": 0, "total": 0},
		"interfaces": map[string]any{},
	}
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

func apiVnstatReset(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	run(20, "sh", "-c", "vnstat --reset --force 2>&1 | tail -2")
	jsonOut(w, map[string]any{"success": true, "message": "Statistik vnstat direset"})
}

/* ---------- ssh ---------- */

func apiSSHStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	port := run(5, "sh", "-c", "uci -q get dropbear.@dropbear[0].Port")
	if port == "" {
		port = "22"
	}
	running := run(5, "/etc/init.d/dropbear", "running") == "" && isServiceRunning("dropbear")
	jsonOut(w, map[string]any{
		"running": running, "port": atoiSafe(port), "pid": atoiSafe(run(5, "sh", "-c", "pidof dropbear | head -1")),
		"config": map[string]any{"port": atoiSafe(port), "enabled": true, "bind": "0.0.0.0",
			"key_auth_only": run(5, "sh", "-c", "uci -q get dropbear.@dropbear[0].PasswordAuth") == "off"},
		"authorized_keys": run(5, "sh", "-c", "wc -l < /etc/dropbear/authorized_keys 2>/dev/null"),
	})
}

func atoiSafe(s string) int {
	i, _ := strconv.Atoi(strings.TrimSpace(s))
	return i
}

func isServiceRunning(name string) bool {
	ctx, cancel := ctxTimeout(4)
	defer cancel()
	return exec.CommandContext(ctx, "/etc/init.d/"+name, "running").Run() == nil
}

/* ---------- kernel ---------- */

func apiKernelStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	clusters := []map[string]any{}
	ents, _ := filepath.Glob("/sys/devices/system/cpu/cpufreq/policy*")
	sort.Strings(ents)
	for _, p := range ents {
		id := atoiSafe(strings.TrimPrefix(filepath.Base(p), "policy"))
		cores := readTrim(p + "/related_cpus")
		gov := readTrim(p + "/scaling_governor")
		avail := strings.Fields(readTrim(p + "/scaling_available_governors"))
		freqs := []int{}
		for _, f := range strings.Fields(readTrim(p + "/scaling_available_frequencies")) {
			freqs = append(freqs, atoiSafe(f))
		}
		clusters = append(clusters, map[string]any{
			"policy_id": id, "cores": cores, "label": "Cluster " + strconv.Itoa(id),
			"governor": gov, "available_governors": avail,
			"min_freq": atoiSafe(readTrim(p + "/scaling_min_freq")),
			"max_freq": atoiSafe(readTrim(p + "/scaling_max_freq")),
			"cur_freq": atoiSafe(readTrim(p + "/scaling_cur_freq")),
			"available_frequencies": freqs,
		})
	}
	if clusters == nil {
		clusters = []map[string]any{}
	}
	vm := map[string]any{
		"swappiness":           atoiSafe(readTrim("/proc/sys/vm/swappiness")),
		"vfs_cache_pressure":   atoiSafe(readTrim("/proc/sys/vm/vfs_cache_pressure")),
		"dirty_ratio":          atoiSafe(readTrim("/proc/sys/vm/dirty_ratio")),
		"dirty_background_ratio": atoiSafe(readTrim("/proc/sys/vm/dirty_background_ratio")),
		"tcp_congestion":       readTrim("/proc/sys/net/ipv4/tcp_congestion_control"),
		"available_tcp_congestion": strings.Fields(readTrim("/proc/sys/net/ipv4/tcp_available_congestion_control")),
	}
	jsonOut(w, map[string]any{
		"clusters": clusters, "vm": vm,
		"config": map[string]any{"active_profile": "sekarang"},
		"active_profile": "sekarang", "kernel_release": readTrim("/proc/sys/kernel/osrelease"),
	})
}

// apiKernelProfile: preset cepat (powersave / balanced / performance).
func apiKernelProfile(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		Profile string `json:"profile"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	var msg string
	switch strings.ToLower(b.Profile) {
	case "performance":
		writeAllGovernors("performance")
		run(8, "sh", "-c", "for p in /sys/devices/system/cpu/cpufreq/policy*; do cat $p/cpuinfo_max_freq > $p/scaling_max_freq; done")
		msg = "Profil PERFORMANCE: governor performance, frekuensi maksimum"
	case "powersave", "battery", "battery saver":
		writeAllGovernors("powersave")
		run(8, "sh", "-c", "for p in /sys/devices/system/cpu/cpufreq/policy*; do cat $p/cpuinfo_min_freq > $p/scaling_max_freq; done")
		msg = "Profil POWERSAVE: governor powersave, frekuensi minimum"
	case "balanced", "seimbang":
		writeAllGovernors("schedutil")
		run(8, "sh", "-c", "for p in /sys/devices/system/cpu/cpufreq/policy*; do cat $p/cpuinfo_max_freq > $p/scaling_max_freq; done")
		msg = "Profil BALANCED: governor schedutil, batas frekuensi penuh"
	default:
		jsonOut(w, map[string]any{"success": false, "error": "profil tidak dikenal: " + b.Profile})
		return
	}
	jsonOut(w, map[string]any{"success": true, "message": msg, "profile": strings.ToLower(b.Profile)})
}

func writeAllGovernors(gov string) {
	for _, p := range globPolicies() {
		os.WriteFile(p+"/scaling_governor", []byte(gov), 0644)
	}
}

func globPolicies() []string {
	ents, _ := filepath.Glob("/sys/devices/system/cpu/cpufreq/policy*")
	sort.Strings(ents)
	return ents
}

// apiKernelCluster: atur satu cluster (policy) — governor / min / max.
func apiKernelCluster(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		PolicyID int    `json:"policy_id"`
		Governor string `json:"governor"`
		MinFreq  int    `json:"min_freq"`
		MaxFreq  int    `json:"max_freq"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	base := "/sys/devices/system/cpu/cpufreq/policy" + strconv.Itoa(b.PolicyID)
	if _, err := os.Stat(base); err != nil {
		jsonOut(w, map[string]any{"success": false, "error": "cluster tidak ada: " + base})
		return
	}
	steps := []string{}
	if b.MaxFreq > 0 {
		writeSys(base+"/scaling_max_freq", strconv.Itoa(b.MaxFreq))
		steps = append(steps, "max="+strconv.Itoa(b.MaxFreq))
	}
	if b.MinFreq > 0 {
		writeSys(base+"/scaling_min_freq", strconv.Itoa(b.MinFreq))
		steps = append(steps, "min="+strconv.Itoa(b.MinFreq))
	}
	if b.Governor != "" {
		writeSys(base+"/scaling_governor", b.Governor)
		steps = append(steps, "governor="+b.Governor)
	}
	jsonOut(w, map[string]any{"success": true, "message": "Cluster " + strconv.Itoa(b.PolicyID) + ": " + strings.Join(steps, ", ")})
}

func writeSys(path, val string) {
	if err := os.WriteFile(path, []byte(val), 0644); err != nil {
		run(6, "sh", "-c", "echo "+san(val)+" > "+path)
	}
}

// apiKernelVM: parameter VM + TCP, sekaligus dipersistensikan.
func apiKernelVM(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		Swappiness         *int   `json:"swappiness"`
		VFSCachePressure   *int   `json:"vfs_cache_pressure"`
		DirtyRatio         *int   `json:"dirty_ratio"`
		DirtyBackground    *int   `json:"dirty_background_ratio"`
		TCPCongestion      string `json:"tcp_congestion"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	saved := []string{}
	set := func(path, val string) {
		writeSys(path, val)
	}
	if b.Swappiness != nil {
		set("/proc/sys/vm/swappiness", strconv.Itoa(*b.Swappiness))
		saved = append(saved, "vm.swappiness="+strconv.Itoa(*b.Swappiness))
	}
	if b.VFSCachePressure != nil {
		set("/proc/sys/vm/vfs_cache_pressure", strconv.Itoa(*b.VFSCachePressure))
		saved = append(saved, "vm.vfs_cache_pressure="+strconv.Itoa(*b.VFSCachePressure))
	}
	if b.DirtyRatio != nil {
		set("/proc/sys/vm/dirty_ratio", strconv.Itoa(*b.DirtyRatio))
		saved = append(saved, "vm.dirty_ratio="+strconv.Itoa(*b.DirtyRatio))
	}
	if b.DirtyBackground != nil {
		set("/proc/sys/vm/dirty_background_ratio", strconv.Itoa(*b.DirtyBackground))
		saved = append(saved, "vm.dirty_background_ratio="+strconv.Itoa(*b.DirtyBackground))
	}
	if b.TCPCongestion != "" {
		set("/proc/sys/net/ipv4/tcp_congestion_control", san(b.TCPCongestion))
		saved = append(saved, "net.ipv4.tcp_congestion_control="+san(b.TCPCongestion))
	}
	if len(saved) > 0 {
		os.WriteFile("/etc/sysctl.d/98-bfr-kernel.conf", []byte(strings.Join(saved, "\n")+"\n"), 0644)
	}
	jsonOut(w, map[string]any{"success": true, "message": "Diterapkan & disimpan: " + strings.Join(saved, ", ")})
}

/* ---------- proxy (OpenClash / mihomo) ---------- */

func clashAPI(path string) string {
	sec := run(5, "sh", "-c", "uci -q get openclash.config.dashboard_password 2>/dev/null || grep -m1 secret /etc/openclash/config.yaml 2>/dev/null | awk '{print $2}'")
	hdr := "-H 'Content-Type: application/json'"
	if sec != "" {
		hdr += " -H 'Authorization: Bearer " + sec + "'"
	}
	return run(12, "sh", "-c", "curl -s -m 6 "+hdr+" http://127.0.0.1:9090"+path)
}

func apiProxyStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	running := isServiceRunning("openclash") || isServiceRunning("nikki")
	ver := clashAPI("/version")
	mode := ""
	cfg := clashAPI("/configs")
	if cfg != "" {
		var m map[string]any
		if json.Unmarshal([]byte(cfg), &m) == nil {
			if v, ok := m["mode"].(string); ok {
				mode = v
			}
			if p, ok := m["mixed-port"]; ok {
				_ = p
			}
		}
	}
	core := "mihomo (OpenClash)"
	if !strings.Contains(ver, "Meta") && ver != "" {
		core = "clash"
	}
	jsonOut(w, map[string]any{
		"running": running, "core": core, "version": strings.TrimSpace(strings.Trim(ver, "{}")),
		"mode": orDash(mode), "mixed_port": 7890, "api_port": 9090,
		"watchdog": isServiceRunning("openclash"), "uptime": orDash(readTrim("/proc/uptime")),
		"nodes": 0, "active_nodes": 0,
	})
}

func apiProxyControl(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct{ Action string `json:"action"` }
	json.NewDecoder(r.Body).Decode(&b)
	svc := "openclash"
	if _, err := os.Stat("/etc/init.d/" + svc); err != nil {
		svc = "nikki"
	}
	switch b.Action {
	case "start", "stop", "restart", "reload":
		act := b.Action
		if act == "reload" {
			act = "restart"
		}
		out := run(60, "/etc/init.d/"+svc, act)
		jsonOut(w, map[string]any{"success": true, "message": svc + " " + act + ": " + orDash(out)})
	default:
		jsonOut(w, map[string]any{"success": false, "error": "aksi tidak dikenal"})
	}
}

func apiProxyMode(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct{ Mode string `json:"mode"` }
	json.NewDecoder(r.Body).Decode(&b)
	out := run(12, "sh", "-c", "curl -s -m 6 -X PATCH -d '{\"mode\":\""+san(b.Mode)+"\"}' http://127.0.0.1:9090/configs")
	jsonOut(w, map[string]any{"success": out != "", "message": "Mode: " + b.Mode, "raw": out})
}

/* ---------- tunnel (tailscale) ---------- */

func apiTunnelStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	raw := run(15, "tailscale", "status", "--json")
	var st map[string]any
	if json.Unmarshal([]byte(raw), &st) != nil {
		jsonOut(w, map[string]any{"running": isServiceRunning("tailscale"), "peers": []any{},
			"error": "tailscale belum login / belum berjalan"})
		return
	}
	self := map[string]any{}
	if sc, ok := st["Self"].(map[string]any); ok {
		self = sc
	}
	ips := []string{}
	if a, ok := self["TailscaleIPs"].([]any); ok {
		for _, x := range a {
			if s, ok := x.(string); ok {
				ips = append(ips, s)
			}
		}
	}
	peers := []map[string]any{}
	if pm, ok := st["Peer"].(map[string]any); ok {
		for _, p := range pm {
			pmn, _ := p.(map[string]any)
			online, _ := pmn["Online"].(bool)
			peers = append(peers, map[string]any{
				"name": pmn["HostName"], "online": online, "os": pmn["OS"],
				"ip": firstString(pmn["TailscaleIPs"]), "last_seen": pmn["LastSeen"],
			})
		}
	}
	jsonOut(w, map[string]any{
		"running": isServiceRunning("tailscale"), "backend": st["BackendState"],
		"hostname": self["HostName"], "ip": strings.Join(ips, ", "), "ips": ips,
		"peers": peers, "online_peers": countOnline(peers),
	})
}

func firstString(v any) string {
	if a, ok := v.([]any); ok && len(a) > 0 {
		if s, ok := a[0].(string); ok {
			return s
		}
	}
	return "-"
}

func countOnline(peers []map[string]any) int {
	n := 0
	for _, p := range peers {
		if b, ok := p["online"].(bool); ok && b {
			n++
		}
	}
	return n
}

func apiTunnelControl(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct{ Action string `json:"action"` }
	json.NewDecoder(r.Body).Decode(&b)
	switch b.Action {
	case "start", "stop", "restart":
		out := run(45, "/etc/init.d/tailscale", b.Action)
		jsonOut(w, map[string]any{"success": true, "message": "tailscale " + b.Action + ": " + orDash(out)})
	case "up":
		out := run(60, "tailscale", "up")
		jsonOut(w, map[string]any{"success": true, "message": orDash(out)})
	default:
		jsonOut(w, map[string]any{"success": false, "error": "aksi tidak dikenal"})
	}
}

/* ---------- speedtest ---------- */

func apiSpeedtestRun(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	url := "https://speed.cloudflare.com/__down?bytes=10000000"
	start := time.Now()
	out := run(60, "sh", "-c", "curl -s -o /dev/null -w '%{size_download} %{speed_download}' -m 45 '"+url+"'")
	el := time.Since(start).Seconds()
	f := strings.Fields(out)
	bytes, bps := 0.0, 0.0
	if len(f) == 2 {
		bytes, _ = strconv.ParseFloat(f[0], 64)
		bps, _ = strconv.ParseFloat(f[1], 64)
	}
	jsonOut(w, map[string]any{
		"success": bps > 0, "download_mbps": bps * 8 / 1e6, "upload_mbps": 0,
		"ping_ms": 0, "bytes": bytes, "seconds": el, "server": "speed.cloudflare.com",
		"message": "Uji unduh 10 MB; uji unggah belum diimplementasikan",
	})
}

/* ---------- files ---------- */

func safePath(p string) (string, bool) {
	if p == "" {
		return "/", true
	}
	if strings.Contains(p, "..") {
		return "", false
	}
	if !strings.HasPrefix(p, "/") {
		return "", false
	}
	return filepath.Clean(p), true
}

func apiFilesList(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	p, ok := safePath(r.URL.Query().Get("path"))
	if !ok {
		jsonOut(w, map[string]any{"error": "path tidak valid", "files": []any{}})
		return
	}
	ents, err := os.ReadDir(p)
	if err != nil {
		jsonOut(w, map[string]any{"path": p, "current_path": p, "files": []any{}, "error": err.Error()})
		return
	}
	files := []map[string]any{}
	for _, e := range ents {
		info, err := e.Info()
		if err != nil {
			continue
		}
		isDir := e.IsDir()
		size := info.Size()
		if isDir {
			size = 0
		}
		files = append(files, map[string]any{
			"name": e.Name(), "path": filepath.Join(p, e.Name()), "size": size,
			"is_dir": isDir, "mod_time": info.ModTime().Format("2006-01-02 15:04"),
			"permissions": fs.FileMode(info.Mode()).Perm().String(),
		})
	}
	sort.Slice(files, func(i, j int) bool {
		di, _ := files[i]["is_dir"].(bool)
		dj, _ := files[j]["is_dir"].(bool)
		if di != dj {
			return di
		}
		return strings.ToLower(files[i]["name"].(string)) < strings.ToLower(files[j]["name"].(string))
	})
	parent := filepath.Dir(p)
	if p == "/" {
		parent = "/"
	}
	jsonOut(w, map[string]any{"path": p, "current_path": p, "parent": parent, "files": files})
}

func apiFilesStorage(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	var st sysStatfs
	total, free := 0.0, 0.0
	if statfs("/", &st) == 0 {
		total = float64(st.Blocks) * float64(st.Bsize)
		free = float64(st.Bavail) * float64(st.Bsize)
	}
	used := total - free
	pct := 0.0
	if total > 0 {
		pct = used / total * 100
	}
	jsonOut(w, map[string]any{"total": int64(total), "used": int64(used), "free": int64(free),
		"used_pct": pct, "mount": "/"})
}

func apiFilesRead(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	p, ok := safePath(r.URL.Query().Get("path"))
	if !ok {
		jsonOut(w, map[string]any{"error": "path tidak valid"})
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		jsonOut(w, map[string]any{"error": err.Error(), "path": p, "content": ""})
		return
	}
	if len(b) > 512*1024 {
		b = b[:512*1024]
	}
	jsonOut(w, map[string]any{"path": p, "content": string(b)})
}

func apiFilesWrite(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		Path, Content, Mode string
	}
	json.NewDecoder(r.Body).Decode(&b)
	p, ok := safePath(b.Path)
	if !ok {
		jsonOut(w, map[string]any{"success": false, "error": "path tidak valid"})
		return
	}
	if b.Mode != "" {
		os.Chmod(p, fs.FileMode(parseOctal(b.Mode)))
	}
	if err := os.WriteFile(p, []byte(b.Content), 0644); err != nil {
		jsonOut(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	jsonOut(w, map[string]any{"success": true, "message": "Tersimpan: " + p})
}

func parseOctal(s string) int64 {
	v, err := strconv.ParseInt(strings.TrimPrefix(s, "0o"), 8, 32)
	if err != nil {
		return 0644
	}
	return v
}

func apiFilesAction(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		Action  string   `json:"action"`
		Path    string   `json:"path"`
		Dest    string   `json:"destination"`
		Paths   []string `json:"paths"`
		Mode    string   `json:"mode"`
		Content string   `json:"content"`
		Query   string   `json:"query"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	p, ok := safePath(b.Path)
	if !ok && b.Action != "search" {
		jsonOut(w, map[string]any{"success": false, "error": "path tidak valid"})
		return
	}
	switch b.Action {
	case "delete":
		if err := os.RemoveAll(p); err != nil {
			jsonOut(w, map[string]any{"success": false, "error": err.Error()})
			return
		}
	case "mkdir":
		if err := os.MkdirAll(p, 0755); err != nil {
			jsonOut(w, map[string]any{"success": false, "error": err.Error()})
			return
		}
	case "create":
		os.WriteFile(p, []byte(b.Content), 0644)
	case "rename", "move":
		d, ok := safePath(b.Dest)
		if !ok {
			jsonOut(w, map[string]any{"success": false, "error": "tujuan tidak valid"})
			return
		}
		if err := os.Rename(p, d); err != nil {
			jsonOut(w, map[string]any{"success": false, "error": err.Error()})
			return
		}
	case "copy":
		d, ok := safePath(b.Dest)
		if !ok {
			jsonOut(w, map[string]any{"success": false, "error": "tujuan tidak valid"})
			return
		}
		if err := copyPath(p, d); err != nil {
			jsonOut(w, map[string]any{"success": false, "error": err.Error()})
			return
		}
	case "permissions":
		if err := os.Chmod(p, fs.FileMode(parseOctal(b.Mode))); err != nil {
			jsonOut(w, map[string]any{"success": false, "error": err.Error()})
			return
		}
	case "compress":
		dest := b.Dest
		if dest == "" {
			dest = p + ".tar.gz"
		}
		run(60, "sh", "-c", "tar -czf '"+san(dest)+"' -C '"+san(filepath.Dir(p))+"' '"+san(filepath.Base(p))+"'")
	case "extract":
		dest := b.Dest
		if dest == "" {
			dest = filepath.Dir(p)
		}
		run(60, "sh", "-c", "mkdir -p '"+san(dest)+"' && tar -xzf '"+san(p)+"' -C '"+san(dest)+"'")
	case "search":
		q := san(b.Query)
		if q == "" {
			q = san(b.Path)
			p = "/"
		}
		if p == "" {
			p = "/"
		}
		out := run(20, "sh", "-c", "find "+san(p)+" -maxdepth 4 -iname '*"+q+"*' 2>/dev/null | head -60")
		files := []map[string]any{}
		for _, l := range strings.Split(out, "\n") {
			if l == "" {
				continue
			}
			info, err := os.Stat(l)
			if err != nil {
				continue
			}
			files = append(files, map[string]any{"name": filepath.Base(l), "path": l,
				"size": info.Size(), "is_dir": info.IsDir(),
				"mod_time": info.ModTime().Format("2006-01-02 15:04"), "permissions": info.Mode().Perm().String()})
		}
		jsonOut(w, map[string]any{"success": true, "files": files, "path": p, "current_path": p})
		return
	case "batch":
		for _, x := range b.Paths {
			src, ok := safePath(x)
			if !ok {
				continue
			}
			dst, ok := safePath(filepath.Join(b.Dest, filepath.Base(src)))
			if !ok {
				continue
			}
			if b.Mode == "move" {
				os.Rename(src, dst)
			} else {
				copyPath(src, dst)
			}
		}
	default:
		jsonOut(w, map[string]any{"success": false, "error": "aksi tidak dikenal: " + b.Action})
		return
	}
	jsonOut(w, map[string]any{"success": true, "message": b.Action + " selesai: " + p})
}

func copyPath(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			rel, _ := filepath.Rel(src, p)
			target := filepath.Join(dst, rel)
			if d.IsDir() {
				return os.MkdirAll(target, info.Mode().Perm())
			}
			return copyFile(p, target, info.Mode().Perm())
		})
	}
	return copyFile(src, dst, info.Mode().Perm())
}

func copyFile(src, dst string, mode fs.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	os.MkdirAll(filepath.Dir(dst), 0755)
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	io.Copy(out, in)
	return os.Chmod(dst, mode)
}

func apiFilesDownload(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	p, ok := safePath(r.URL.Query().Get("path"))
	if !ok {
		http.Error(w, "path tidak valid", 400)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.Error(w, err.Error(), 404)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filepath.Base(p)+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, f)
}

func apiFilesUpload(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	dir, ok := safePath(r.URL.Query().Get("path"))
	if !ok {
		http.Error(w, "path tidak valid", 400)
		return
	}
	f, hdr, err := r.FormFile("file")
	if err != nil {
		jsonOut(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	defer f.Close()
	dst := filepath.Join(dir, filepath.Base(hdr.Filename))
	out, err := os.Create(dst)
	if err != nil {
		jsonOut(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	defer out.Close()
	n, _ := io.Copy(out, f)
	jsonOut(w, map[string]any{"success": true, "message": "Terunggah " + strconv.FormatInt(n, 10) + " byte ke " + dst})
}

/* ---------- NAS (samba4) ---------- */

func apiNAS(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	installed := false
	if _, err := os.Stat("/usr/sbin/smbd"); err == nil {
		installed = true
	}
	running := isServiceRunning("samba4")
	shares := []map[string]any{}
	out := run(8, "sh", "-c", "uci show samba4 2>/dev/null | grep -c '=samba4' ")
	_ = out
	// daftar share dari uci
	names := []string{}
	for _, l := range strings.Split(run(8, "sh", "-c", "uci show samba4 2>/dev/null | sed -n \"s/^samba4\\.\\([^.]*\\)\\.name='\\(.*\\)'/\\1|\\2/p\""), "\n") {
		if l == "" {
			continue
		}
		f := strings.SplitN(l, "|", 2)
		path := run(6, "uci", "-q", "get", "samba4."+f[0]+".path")
		names = append(names, f[1])
		shares = append(shares, map[string]any{"name": f[1], "path": path, "read_only": false})
	}
	if r.Method == http.MethodPost {
		var b struct {
			Action, Name, Path string
		}
		json.NewDecoder(r.Body).Decode(&b)
		switch b.Action {
		case "start":
			out := run(40, "/etc/init.d/samba4", "start")
			jsonOut(w, map[string]any{"success": true, "message": "Samba dimulai: " + orDash(out)})
			return
		case "stop":
			out := run(30, "/etc/init.d/samba4", "stop")
			jsonOut(w, map[string]any{"success": true, "message": "Samba dihentikan: " + orDash(out)})
			return
		case "add_share":
			if b.Name == "" || b.Path == "" {
				jsonOut(w, map[string]any{"success": false, "error": "nama & path wajib"})
				return
			}
			run(10, "sh", "-c", "uci -q delete samba4."+san(b.Name)+" 2>/dev/null; "+
				"uci set samba4."+san(b.Name)+"=samba4; "+
				"uci set samba4."+san(b.Name)+".name='"+san(b.Name)+"'; "+
				"uci set samba4."+san(b.Name)+".path='"+san(b.Path)+"'; "+
				"uci set samba4."+san(b.Name)+".browseable='yes'; "+
				"uci set samba4."+san(b.Name)+".read_only='no'; "+
				"uci set samba4."+san(b.Name)+".guest_ok='yes'; uci commit samba4; /etc/init.d/samba4 restart")
			jsonOut(w, map[string]any{"success": true, "message": "Share " + b.Name + " ditambahkan"})
			return
		}
	}
	jsonOut(w, map[string]any{
		"installed": installed, "running": running, "shares": shares, "share_count": len(names),
		"version": orDash(run(6, "sh", "-c", "smbd -V 2>/dev/null | head -1")),
		"package": "samba4-server", "protocol": "SMB2/3",
	})
}

/* ---------- util ---------- */

type sysStatfs = syscall.Statfs_t

func statfs(path string, st *sysStatfs) int {
	if err := syscall.Statfs(path, st); err != nil {
		return -1
	}
	return 0
}

var _ = bufio.NewReader
