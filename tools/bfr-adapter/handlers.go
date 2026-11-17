package main

// Handler API OpenWrt untuk tab-tab BFR (modem, jaringan, tethering, SMS, log, daya).
// Semua dijalankan di UI yang sama — tidak ada lompatan ke LuCI.

import (
	"encoding/json"
	"sync"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

/* ---------- modem ---------- */

func apiModemSignal(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	l := lteCached()
	band := run(6, "uci", "-q", "get", "rolexlte.main.band")
	if band == "" || band == "0" {
		band = "-"
	}
	// nilai angka saja: kartu bawaan menambahkan sendiri satuan (dBm/dB)
	solo := func(v string) string {
		f := strings.Fields(v)
		if len(f) == 0 {
			return ""
		}
		return f[0]
	}
	g := g3()
	jsonOut(w, map[string]any{
		"operator":     l["modem.3gpp.operator-name"],
		"state":        l["modem.generic.state"],
		"network_type": strings.ToUpper(l["modem.generic.access-technologies.value[1]"]),
		"registration": l["modem.3gpp.registration-state"],
		"ps_state":     l["modem.3gpp.packet-service-state"],
		"rssi":         solo(l["sig.rssi"]),
		"rsrp":         solo(l["sig.rsrp"]),
		"rsrq":         solo(l["sig.rsrq"]),
		"sinr": func() string {
			if v := solo(l["sig.snr"]); v != "" {
				return v
			}
			for _, k := range []string{"snr", "sinr", "snr_db"} {
				if v, ok := g[k]; ok && v != nil {
					if f := strings.Fields(toStr(v) + " "); len(f) > 0 && f[0] != "" {
						return f[0]
					}
				}
			}
			return ""
		}(),
		"band":         band,
		"sim":          l["modem.generic.sim"],
		"imei":         l["modem.3gpp.imei"],
		"signal_pct":   signalPct(l["sig.rsrp"]),
		"cell_id":      l["loc.cell"],
		"tac":          l["loc.tac"],
		// supaya kartu "Cell Identity & Info" bawaan ikut terisi
		"pci":    g["pci"],
		"earfcn": g["earfcn"],
		"pband":  g["pband"],
	})
}

func signalPct(rsrp string) int {
	v, err := strconv.ParseFloat(strings.TrimSpace(strings.Fields(rsrp + " ")[0]), 64)
	if err != nil || v == 0 {
		return 0
	}
	p := int((v + 120) * 100 / 50)
	if p < 0 {
		p = 0
	}
	if p > 100 {
		p = 100
	}
	return p
}

func apiModemSimStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	l := lteCached()
	op := l["modem.3gpp.operator-name"]
	jsonOut(w, map[string]any{
		"active_slot":   1,
		"active_sub_id": 1,
		"slots": []map[string]any{{
			"slot_index": 1, "sub_id": 1, "state": l["modem.generic.state"],
			"is_active": true, "is_esim": false, "carrier": op,
			"label": "SIM 1 • " + orDash(op),
			"rsrp":  l["sig.rsrp"], "rsrq": l["sig.rsrq"], "sinr": l["sig.snr"],
			"signal_strength": signalPct(l["sig.rsrp"]),
			"network_type":    "LTE", "operator": op,
		}},
	})
}

func apiModemThermal(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	jsonOut(w, map[string]any{"available": false, "error": "sensor thermal modem 5G tidak ada di rolex"})
}

func apiModemAT(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct{ Command string }
	json.NewDecoder(r.Body).Decode(&b)
	jsonOut(w, map[string]any{
		"command": b.Command, "success": false,
		"response": "Perintah AT tidak dijawab firmware MSS rolex (jalur QMI/ModemManager yang dipakai).",
	})
}

func apiModemUnsupported(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	jsonOut(w, map[string]any{"success": false, "error": "Fitur ini tidak ada di modem rolex (satu SIM, tanpa lock PLMN)."})
}

/* ---------- jaringan ---------- */

func apiNetworkTTL(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	cur := readTrim("/proc/sys/net/ipv4/ip_default_ttl")
	if r.Method == http.MethodPost {
		var b struct {
			Enable bool `json:"enable"`
			TTL    int  `json:"ttl"`
		}
		json.NewDecoder(r.Body).Decode(&b)
		val := 64
		if b.TTL > 0 && b.TTL < 256 {
			val = b.TTL
		}
		if err := os.WriteFile("/proc/sys/net/ipv4/ip_default_ttl", []byte(strconv.Itoa(val)), 0644); err != nil {
			jsonOut(w, map[string]any{"success": false, "error": err.Error()})
			return
		}
		cur = strconv.Itoa(val)
		// simpan agar ikut saat boot
		run(6, "sh", "-c", "echo 'net.ipv4.ip_default_ttl="+cur+"' > /etc/sysctl.d/99-ttl.conf")
		jsonOut(w, map[string]any{"success": true, "ttl": cur, "current_ttl": cur})
		return
	}
	jsonOut(w, map[string]any{"ttl": cur, "current_ttl": cur, "enable": cur != "64"})
}

func dnsPresets() []map[string]any {
	return []map[string]any{
		{"id": "adguard", "name": "AdGuard (lokal :5353)", "primary": "127.0.0.1#5353", "secondary": ""},
		{"id": "cloudflare", "name": "Cloudflare", "primary": "1.1.1.1", "secondary": "1.0.0.1"},
		{"id": "google", "name": "Google", "primary": "8.8.8.8", "secondary": "8.8.4.4"},
		{"id": "quad9", "name": "Quad9", "primary": "9.9.9.9", "secondary": "149.112.112.112"},
		{"id": "xl", "name": "XL (operator)", "primary": "112.215.198.248", "secondary": "112.215.198.254"},
	}
}

func currentDNS() (string, string) {
	out := run(5, "sh", "-c", "uci -q get dhcp.@dnsmasq[0].server | tr '\\n' ' '")
	f := strings.Fields(out)
	if len(f) == 0 {
		return "", ""
	}
	if len(f) == 1 {
		return f[0], ""
	}
	return f[0], f[1]
}

func apiNetworkDNS(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	if r.Method == http.MethodPost {
		var b struct{ Primary, Secondary string }
		json.NewDecoder(r.Body).Decode(&b)
		if strings.TrimSpace(b.Primary) == "" {
			jsonOut(w, map[string]any{"success": false, "error": "DNS utama kosong"})
			return
		}
		if out := run(15, "sh", "-c",
			"uci -q delete dhcp.@dnsmasq[0].server; "+
				"uci add_list dhcp.@dnsmasq[0].server='"+b.Primary+"'; "+
				"uci commit dhcp"); out != "" {
			// uci tidak mencetak apa pun kalau sukses
		}
		if b.Secondary != "" {
			run(15, "sh", "-c", "uci add_list dhcp.@dnsmasq[0].server='"+b.Secondary+"'; uci commit dhcp")
		}
		run(20, "/etc/init.d/dnsmasq", "restart")
		jsonOut(w, map[string]any{"success": true, "primary": b.Primary, "secondary": b.Secondary})
		return
	}
	p, s := currentDNS()
	jsonOut(w, map[string]any{"primary": p, "secondary": s, "dns1": p, "dns2": s, "presets": dnsPresets()})
}

func apiNetworkDNSReset(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	run(15, "sh", "-c", "uci -q delete dhcp.@dnsmasq[0].server; uci commit dhcp")
	run(20, "/etc/init.d/dnsmasq", "restart")
	jsonOut(w, map[string]any{"success": true, "primary": "", "secondary": ""})
}

func apiNetworkPing(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct{ Host string }
	json.NewDecoder(r.Body).Decode(&b)
	host := strings.TrimSpace(b.Host)
	if host == "" || strings.ContainsAny(host, ";|&$`\\\"' ") {
		jsonOut(w, map[string]any{"success": false, "output": "host tidak valid"})
		return
	}
	out := run(12, "ping", "-c", "3", "-W", "2", host)
	ok := strings.Contains(out, "0% packet loss") || strings.Contains(out, "1 received") ||
		strings.Contains(out, "2 received") || strings.Contains(out, "3 received")
	lat := 0.0
	for _, l := range strings.Split(out, "\n") {
		if strings.Contains(l, "min/avg/max") {
			parts := strings.Split(strings.Split(l, "=")[1], "/")
			if len(parts) > 1 {
				lat, _ = strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			}
		}
	}
	jsonOut(w, map[string]any{"host": host, "output": out, "success": ok, "latency_ms": lat})
}

func apiNetworkTweaks(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	if r.Method == http.MethodPost {
		var b map[string]any
		json.NewDecoder(r.Body).Decode(&b)
		// hanya sysctl yang didukung
		if t, ok := b["ttl"]; ok {
			val := 64
			switch v := t.(type) {
			case float64:
				val = int(v)
			case string:
				val, _ = strconv.Atoi(v)
			}
			if val > 0 && val < 256 {
				os.WriteFile("/proc/sys/net/ipv4/ip_default_ttl", []byte(strconv.Itoa(val)), 0644)
			}
		}
		jsonOut(w, map[string]any{"success": true, "message": "Pengaturan jaringan diterapkan"})
		return
	}
	rx, tx := ifaceBytes("usb0")
	jsonOut(w, map[string]any{
		"interface": "usb0", "ip": strings.Split(ifaceIP("usb0"), "/")[0],
		"gateway_ip": ifaceIP("usb0"), "rx_bytes": rx, "tx_bytes": tx,
		"current_ttl": readTrim("/proc/sys/net/ipv4/ip_default_ttl"),
		"ttl":         readTrim("/proc/sys/net/ipv4/ip_default_ttl"),
	})
}

/* ---------- tethering / QoS ---------- */

func apiHotspotStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	st := kvOf(run(8, "/usr/bin/rolex-wifi-ctl", "status"))
	jsonOut(w, map[string]any{
		"enabled":      st["ap_state"] == "jalan",
		"ssid":         st["ssid"],
		"security_type": st["encryption"],
		"wifi_enabled": true, "usb_enabled": true, "ethernet_enabled": false,
		"active_interfaces": []string{"wlan0", "usb0"},
		"gateway_ip":        strings.Split(st["ip"], "/")[0],
		"subnet":            "255.255.255.0",
		"channel":           st["channel"],
		"clients":           clientCount(),
	})
}

func clientCount() int {
	n := 0
	for _, l := range strings.Split(run(6, "iw", "dev", "wlan0", "station", "dump"), "\n") {
		if strings.HasPrefix(strings.TrimSpace(l), "Station ") {
			n++
		}
	}
	return n
}

func apiHotspotClients(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	out := []map[string]any{}
	seen := map[string]bool{}
	// klien WiFi dari iw
	var mac string
	sig, rate := "", ""
	for _, l := range strings.Split(run(8, "iw", "dev", "wlan0", "station", "dump"), "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "Station ") {
			if mac != "" {
				out = append(out, clientRow(mac, sig, rate, "wlan0"))
				seen[mac] = true
			}
			f := strings.Fields(l)
			mac, sig, rate = strings.ToLower(f[1]), "", ""
			continue
		}
		if strings.HasPrefix(l, "signal:") {
			sig = strings.TrimSpace(strings.TrimPrefix(l, "signal:"))
		}
		if strings.HasPrefix(l, "rx bitrate:") && rate == "" {
			rate = strings.TrimSpace(strings.TrimPrefix(l, "rx bitrate:"))
		}
	}
	if mac != "" {
		out = append(out, clientRow(mac, sig, rate, "wlan0"))
		seen[mac] = true
	}
	// klien kabel/USB dari sewa DHCP
	for _, l := range strings.Split(readTrim("/tmp/dhcp.leases"), "\n") {
		f := strings.Fields(l)
		if len(f) < 4 {
			continue
		}
		m := strings.ToLower(f[1])
		if seen[m] {
			continue
		}
		out = append(out, map[string]any{
			"ip": f[2], "mac": m, "device": f[3], "state": "aktif",
			"interface": "usb0", "hostname": f[3], "signal": "-", "rate": "-",
		})
	}
	jsonOut(w, out)
}

func clientRow(mac, sig, rate, iface string) map[string]any {
	ip, host := "-", "-"
	for _, l := range strings.Split(readTrim("/tmp/dhcp.leases"), "\n") {
		f := strings.Fields(l)
		if len(f) >= 4 && strings.EqualFold(f[1], mac) {
			ip, host = f[2], f[3]
		}
	}
	return map[string]any{
		"ip": ip, "mac": mac, "device": host, "hostname": host, "state": "aktif",
		"interface": iface, "signal": orDash(sig), "rate": orDash(rate),
	}
}

func apiHotspotSettings(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	st := kvOf(run(8, "/usr/bin/rolex-wifi-ctl", "status"))
	if r.Method == http.MethodPost {
		var b struct {
			SSID, Password string
			Channel        any
		}
		json.NewDecoder(r.Body).Decode(&b)
		if b.SSID != "" {
			run(10, "sh", "-c", "uci set wireless.wifinet0.ssid='"+san(b.SSID)+"'; uci commit wireless")
		}
		if b.Password != "" {
			run(10, "sh", "-c", "uci set wireless.wifinet0.key='"+san(b.Password)+"'; uci commit wireless")
		}
		if b.Channel != nil {
			ch := strconv.Itoa(int(numAny(b.Channel)))
			run(10, "sh", "-c", "uci set wireless.radio0.channel='"+ch+"'; uci commit wireless")
		}
		run(30, "/usr/bin/rolex-wifi-ctl", "apply")
		jsonOut(w, map[string]any{"success": true, "message": "Pengaturan AP diterapkan"})
		return
	}
	jsonOut(w, map[string]any{
		"gateway_mode": "static", "gateway_ip": strings.Split(st["ip"], "/")[0],
		"subnet_mask": "255.255.255.0",
		"dhcp_start":  "192.168.43.100", "dhcp_end": "192.168.43.249", "lease_time": "12h",
		"dns_primary": "192.168.43.1", "dns_secondary": "",
		"band": "2", "ssid": st["ssid"], "channel": st["channel"], "security_type": st["encryption"],
	})
}

func apiHotspotControl(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		Action string `json:"action"`
		Enable *bool  `json:"enable"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	act := b.Action
	if b.Enable != nil {
		if *b.Enable {
			act = "start"
		} else {
			act = "stop"
		}
	}
	switch act {
	case "start", "on", "enable":
		out := run(40, "/etc/init.d/rolex-wifi", "restart")
		jsonOut(w, map[string]any{"success": true, "message": "AP dinyalakan: " + orDash(out)})
	case "stop", "off", "disable":
		out := run(30, "/etc/init.d/rolex-wifi", "stop")
		jsonOut(w, map[string]any{"success": true, "message": "AP dimatikan: " + orDash(out)})
	case "apply":
		out := run(40, "/usr/bin/rolex-wifi-ctl", "apply")
		jsonOut(w, map[string]any{"success": true, "message": orDash(out)})
	default:
		jsonOut(w, map[string]any{"success": false, "error": "aksi tidak dikenal: " + act})
	}
}

func apiHotspotMACFilter(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	file := "/etc/bfr-macfilter.json"
	cfg := map[string]any{"mode": "disabled", "blocked_macs": []string{}, "allowed_macs": []string{}}
	if b, err := os.ReadFile(file); err == nil {
		json.Unmarshal(b, &cfg)
	}
	if r.Method == http.MethodPost {
		var in map[string]any
		json.NewDecoder(r.Body).Decode(&in)
		if m, ok := in["mode"]; ok {
			cfg["mode"] = m
		}
		if v, ok := in["blocked_macs"]; ok {
			cfg["blocked_macs"] = v
		}
		if v, ok := in["allowed_macs"]; ok {
			cfg["allowed_macs"] = v
		}
		b, _ := json.Marshal(&cfg)
		os.WriteFile(file, b, 0644)
		applyMACFilter(cfg)
	}
	jsonOut(w, map[string]any{
		"config": cfg,
		"status": map[string]any{"active_mode": cfg["mode"], "blocked_count": listLen(cfg["blocked_macs"]),
			"allowed_count": listLen(cfg["allowed_macs"]), "rules_count": 0},
	})
}

func listLen(v any) int {
	if a, ok := v.([]any); ok {
		return len(a)
	}
	if a, ok := v.([]string); ok {
		return len(a)
	}
	return 0
}

func applyMACFilter(cfg map[string]any) {
	run(10, "sh", "-c", "iptables-legacy -D FORWARD -i wlan0 -j MACFILTER 2>/dev/null; iptables-legacy -F MACFILTER 2>/dev/null")
	mode, _ := cfg["mode"].(string)
	if mode != "blacklist" && mode != "whitelist" {
		return
	}
	run(10, "sh", "-c", "iptables-legacy -N MACFILTER 2>/dev/null")
	if mode == "whitelist" {
		run(10, "sh", "-c", "iptables-legacy -A MACFILTER -j DROP")
	}
	var list []string
	if a, ok := cfg["blocked_macs"].([]any); ok && mode == "blacklist" {
		for _, x := range a {
			list = append(list, strings.ToLower(strings.TrimSpace(x.(string))))
		}
	}
	if a, ok := cfg["allowed_macs"].([]any); ok && mode == "whitelist" {
		for _, x := range a {
			list = append(list, strings.ToLower(strings.TrimSpace(x.(string))))
		}
	}
	for _, m := range list {
		if m == "" {
			continue
		}
		if mode == "whitelist" {
			run(8, "sh", "-c", "iptables-legacy -I MACFILTER -m mac --mac-source "+m+" -j RETURN")
		} else {
			run(8, "sh", "-c", "iptables-legacy -A MACFILTER -m mac --mac-source "+m+" -j DROP")
		}
	}
	run(8, "sh", "-c", "iptables-legacy -C FORWARD -i wlan0 -j MACFILTER 2>/dev/null || iptables-legacy -I FORWARD -i wlan0 -j MACFILTER")
}

func apiQoSStatus(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	q := run(6, "tc", "qdisc", "show", "dev", "usb0")
	jsonOut(w, map[string]any{
		"enabled": strings.Contains(q, "htb") || strings.Contains(q, "fq_codel"),
		"qdisc":   orDash(q), "profiles": []string{"Gaming Anti-Lag", "Fair Share", "Quota Saver"},
	})
}

func apiQoSApply(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		Profile     string  `json:"profile"`
		DownloadMbps float64 `json:"download_mbps"`
		UploadMbps   float64 `json:"upload_mbps"`
		Enable      *bool   `json:"enable"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	if b.Enable != nil && !*b.Enable {
		run(8, "tc", "qdisc", "del", "dev", "usb0", "root")
		jsonOut(w, map[string]any{"success": true, "message": "Pembatasan trafik dimatikan"})
		return
	}
	mbps := b.UploadMbps
	if mbps <= 0 {
		mbps = 20
	}
	rate := strconv.Itoa(int(mbps)) + "mbit"
	run(8, "tc", "qdisc", "del", "dev", "usb0", "root")
	if out := run(10, "tc", "qdisc", "add", "dev", "usb0", "root", "handle", "1:", "htb", "default", "10"); out != "" {
		jsonOut(w, map[string]any{"success": false, "error": out})
		return
	}
	run(10, "tc", "class", "add", "dev", "usb0", "parent", "1:", "classid", "1:10", "htb", "rate", rate)
	jsonOut(w, map[string]any{"success": true, "message": "QoS diterapkan: " + b.Profile + " (" + rate + ")"})
}

/* ---------- SMS ---------- */

func sanitize(v string) string { return strings.TrimSpace(v) }

func apiSMSInbox(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 20 {
		limit = 8
	}
	if v := smsCacheGet(limit); v != nil {
		jsonOut(w, v)
		return
	}
	out := fetchInbox(limit)
	smsCacheSet(out)
	jsonOut(w, out)
}

// fetchInbox: baca SMS dari perangkat. Satu panggilan rolex-sms-ctl ≈ 20 s,
// jadi hasilnya dicache dan dipanaskan di latar (SMSWarmer).
func fetchInbox(limit int) map[string]any {
	ids := []string{}
	for _, l := range strings.Split(run(45, "/usr/bin/rolex-sms-ctl", "list"), "\n") {
		if strings.HasPrefix(l, "id=") {
			ids = append(ids, strings.Fields(l)[0][3:])
		}
	}
	if len(ids) > limit {
		ids = ids[:limit]
	}
	// baca paralel supaya tidak satu per satu
	type hasil struct {
		idx int
		id  string
		kv  map[string]string
	}
	ch := make(chan hasil, len(ids))
	for i, id := range ids {
		go func(i int, id string) {
			ch <- hasil{i, id, kvOf(run(40, "/usr/bin/rolex-sms-ctl", "read", id))}
		}(i, id)
	}
	got := make([]hasil, 0, len(ids))
	for range ids {
		got = append(got, <-ch)
	}
	for i := 0; i < len(got); i++ {
		for j := i + 1; j < len(got); j++ {
			if got[j].idx < got[i].idx {
				got[i], got[j] = got[j], got[i]
			}
		}
	}
	msgs := []map[string]any{}
	for _, h := range got {
		kv := h.kv
		if kv["text"] == "" && kv["number"] == "" {
			continue
		}
		ts := parseTS(kv["timestamp"])
		idn, _ := strconv.Atoi(h.id)
		msgs = append(msgs, map[string]any{
			"id": idn, "address": kv["number"], "body": kv["text"], "date": ts,
			"date_sent": ts, "read": 1, "type": 1, "state": kv["state"],
		})
	}
	return map[string]any{"messages": msgs, "total": len(ids), "offset": 0, "limit": limit}
}

// SMSWarmer mengisi cache SMS di latar supaya tab SMS langsung tampil.
func SMSWarmer() {
	for {
		time.Sleep(3 * time.Minute)
		smsCacheSet(fetchInbox(8))
	}
}

var (
	smsMu    sync.Mutex
	smsVal   map[string]any
	smsAt    time.Time
)

func smsCacheGet(limit int) map[string]any {
	smsMu.Lock()
	defer smsMu.Unlock()
	if smsVal != nil && time.Since(smsAt) < 4*time.Minute {
		out := map[string]any{}
		for k, v := range smsVal {
			out[k] = v
		}
		if msgs, ok := out["messages"].([]map[string]any); ok && len(msgs) > limit {
			out["messages"] = msgs[:limit]
		}
		return out
	}
	return nil
}

func smsCacheSet(v map[string]any) {
	smsMu.Lock()
	defer smsMu.Unlock()
	smsVal, smsAt = v, time.Now()
}

func parseTS(s string) int64 {
	if s == "" {
		return time.Now().Unix()
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.Unix()
	}
	return time.Now().Unix()
}

/* ---------- log ---------- */

func apiLogs(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 150
	}
	cat := strings.ToLower(sanitize(r.URL.Query().Get("category")))
	lines := strings.Split(run(12, "logread"), "\n")
	entries := []map[string]any{}
	for i := len(lines) - 1; i >= 0 && len(entries) < limit; i-- {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			continue
		}
		e := parseLog(l)
		if cat != "" && cat != "all" && !strings.Contains(strings.ToLower(e["category"].(string)+" "+e["message"].(string)), cat) {
			continue
		}
		entries = append(entries, e)
	}
	jsonOut(w, map[string]any{"entries": entries, "total": len(entries)})
}

func parseLog(line string) map[string]any {
	lvl, cat, msg, ts := "INFO", "system", line, ""
	// format: Mon Nov 16 22:33:06 2026 user.notice panel: pesan
	f := strings.SplitN(line, " ", 6)
	if len(f) >= 6 {
		ts = strings.Join(f[0:5], " ")
		rest := f[5]
		if i := strings.Index(rest, ":"); i > 0 {
			who := strings.TrimSpace(rest[:i])
			msg = strings.TrimSpace(rest[i+1:])
			segs := strings.Split(who, ".")
			if len(segs) >= 2 {
				cat = segs[0]
				switch segs[1] {
				case "err", "crit", "alert", "emerg":
					lvl = "ERROR"
				case "warn", "warning", "notice":
					lvl = "WARN"
				case "debug":
					lvl = "DEBUG"
				}
			} else {
				cat = who
			}
		} else {
			msg = rest
		}
	}
	return map[string]any{"timestamp": ts, "time": ts, "level": lvl, "category": cat, "message": msg}
}

func apiLogsClear(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	run(8, "sh", "-c", "> /tmp/log/messages 2>/dev/null; logread -c 2>/dev/null")
	jsonOut(w, map[string]any{"success": true, "message": "Log dibersihkan (riwayat lanjutan datang dari ring buffer kernel)."})
}

/* ---------- daya ---------- */

func apiPower(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct{ Action string }
	json.NewDecoder(r.Body).Decode(&b)
	switch b.Action {
	case "reboot":
		go func() { time.Sleep(800 * time.Millisecond); run(10, "reboot") }()
		jsonOut(w, map[string]any{"success": true, "message": "Perangkat reboot dalam beberapa detik…"})
	case "poweroff":
		go func() { time.Sleep(800 * time.Millisecond); run(10, "poweroff") }()
		jsonOut(w, map[string]any{"success": true, "message": "Perangkat dimatikan…"})
	default:
		jsonOut(w, map[string]any{"success": false, "error": "rolex tidak punya mode recovery/bootloader dari sistem ini"})
	}
}

const schedFile = "/etc/bfr-schedule.json"

func apiPowerSchedule(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	cfg := map[string]any{"enabled": false, "mode": "disabled", "interval_hours": 24, "clock_time": "04:00"}
	if b, err := os.ReadFile(schedFile); err == nil {
		json.Unmarshal(b, &cfg)
	}
	if r.Method == http.MethodPost {
		var in map[string]any
		json.NewDecoder(r.Body).Decode(&in)
		for k, v := range in {
			cfg[k] = v
		}
		b, _ := json.Marshal(&cfg)
		os.WriteFile(schedFile, b, 0644)
		applySchedule(cfg)
	}
	up := int64(num(readTrim("/proc/uptime")))
	jsonOut(w, map[string]any{
		"config":            cfg,
		"uptime_seconds":    up,
		"next_reboot_in_sec": 0, "next_reboot_time": "-",
		"description":       "Jadwal reboot disimpan; aktif setelah layanan cron memuatnya.",
	})
}

func applySchedule(cfg map[string]any) {
	enabled, _ := cfg["enabled"].(bool)
	run(6, "sh", "-c", "sed -i '/bfr-reboot/d' /etc/crontabs/root 2>/dev/null")
	if !enabled {
		return
	}
	mode, _ := cfg["mode"].(string)
	line := ""
	switch mode {
	case "interval":
		h := int(numAny(cfg["interval_hours"]))
		if h < 1 {
			h = 24
		}
		line = "0 */" + strconv.Itoa(h%24) + " * * * /sbin/reboot # bfr-reboot"
	case "clock":
		t, _ := cfg["clock_time"].(string)
		p := strings.Split(t, ":")
		if len(p) == 2 {
			line = p[1] + " " + p[0] + " * * * /sbin/reboot # bfr-reboot"
		}
	}
	if line != "" {
		run(6, "sh", "-c", "echo '"+line+"' >> /etc/crontabs/root")
		run(10, "/etc/init.d/cron", "restart")
	}
}

/* ---------- util kecil ---------- */

func toStr(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', 1, 64)
	case int:
		return strconv.Itoa(x)
	}
	return ""
}

func guard(w http.ResponseWriter, r *http.Request) bool {
	if !authed(r) {
		w.WriteHeader(401)
		jsonOut(w, map[string]any{"error": "belum masuk"})
		return false
	}
	return true
}

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}

func san(s string) string { return strings.ReplaceAll(strings.ReplaceAll(s, "'", ""), "\n", "") }

func numAny(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	}
	return 0
}

func kvOf(out string) map[string]string {
	m := map[string]string{}
	for _, l := range strings.Split(out, "\n") {
		if i := strings.Index(l, "="); i > 0 {
			m[strings.TrimSpace(l[:i])] = strings.TrimSpace(l[i+1:])
		}
	}
	return m
}