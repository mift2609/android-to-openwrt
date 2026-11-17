package main

// Kontrol Modem LTE untuk UI: lock band, deteksi sel (PCI/EARFCN), rotasi IP, reboot modem.
// Semua memakai helper yang sudah terbukti di perangkat:
//   rolex-modem-ctl band "<daftar>" | auto      -> mmcli --set-current-bands + restart layanan
//   rolex-modem-ctl bands                       -> daftar band didukung/aktif
//   rolex-3ginfo-json                           -> pband/earfcn/pci/tac/rsrp (agak lambat, ~40 s)
//   rolex-modem-ctl netguard <cek> <gagal> <rotasi>
//   rolex-data-reset modem                      -> reboot modem MSS

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	cellMu  sync.Mutex
	cellVal map[string]any
	cellAt  time.Time
)

// baca 3ginfo (cached; pemanasan di latar oleh cellWarmer)
var g3Busy bool

func g3() map[string]any {
	cellMu.Lock()
	cached := cellVal
	fresh := cellVal != nil && time.Since(cellAt) < 90*time.Second
	busy := g3Busy
	cellMu.Unlock()
	if fresh {
		return cached
	}
	if cached == nil {
		// belum ada data: isi di latar, balas segera supaya UI tidak menggantung
		if !busy {
			cellMu.Lock()
			g3Busy = true
			cellMu.Unlock()
			go func() {
				out := map[string]any{}
				raw := run(60, "/usr/bin/rolex-3ginfo-json")
				if json.Unmarshal([]byte(raw), &out) != nil || out == nil {
					out = map[string]any{}
				}
				cellMu.Lock()
				cellVal, cellAt = out, time.Now()
				g3Busy = false
				cellMu.Unlock()
			}()
		}
		return map[string]any{}
	}
	return cached // basi sedikit tapi cepat; penyegaran di latar
}

func cellWarmer() {
	for {
		time.Sleep(2 * time.Minute)
		g3()
	}
}

func apiModemCell(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	d := g3()
	pick := func(keys ...string) any {
		for _, k := range keys {
			if v, ok := d[k]; ok && v != nil && v != "" {
				return v
			}
		}
		return nil
	}
	jsonOut(w, map[string]any{
		"pci":      pick("pci", "s_pci"),
		"earfcn":   pick("earfcn", "s_earfcn"),
		"band":     pick("pband", "band"),
		"cell_id": func() any {
			if v := pick("cell_id", "cell", "cellid"); v != nil {
				return v
			}
			return lteCached()["loc.cell"]
		}(),
		"tac":      pick("tac_d", "tac", "tac_dec"),
		"tac_hex":  pick("tac_hex", "tac_h"),
		"rsrp":     dec(pick("rsrp")),
		"rsrq":     dec(pick("rsrq")),
		"sinr":     dec(pick("snr", "sinr", "snr_db")),
		"rssi":     dec(pick("rssi")),
		"operator": pick("operator_name", "operator"),
		"mode":     pick("mode", "connt"),
		"ip":       pick("ip", "ipv4"),
		"fresh":    time.Since(cellAt).Seconds() < 120,
	})
}

// daftar band LTE yang didukung + yang terkunci sekarang
func apiModemBands(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	block := run(30, "/usr/bin/rolex-modem-ctl", "bands")
	supported := []string{}
	for _, tok := range strings.FieldsFunc(block, func(c rune) bool {
		return c == ',' || c == '\n' || c == '\t' || c == ' ' || c == '\'' || c == '"'
	}) {
		tok = strings.TrimSpace(tok)
		if tok == "" || strings.HasPrefix(tok, "bands_block") || tok == "EOF" {
			continue
		}
		if strings.HasPrefix(tok, "eutran-") || strings.HasPrefix(tok, "utran-") ||
			strings.HasPrefix(tok, "egsm") || strings.HasPrefix(tok, "dcs") ||
			strings.HasPrefix(tok, "pcs") || strings.HasPrefix(tok, "g850") {
			supported = append(supported, tok)
		}
	}
	lte := []map[string]any{}
	seen := map[string]bool{}
	for _, b := range supported {
		if !strings.HasPrefix(b, "eutran-") {
			continue
		}
		if seen[b] {
			continue
		}
		seen[b] = true
		n := strings.TrimPrefix(b, "eutran-")
		lte = append(lte, map[string]any{"id": b, "band": "B" + n, "num": atoiSafe(n)})
	}
	cur := g3()
	jsonOut(w, map[string]any{
		"supported": lte, "all_supported": supported,
		"locked":  run(6, "uci", "-q", "get", "rolexlte.main.band") != "",
		"lock":    run(6, "uci", "-q", "get", "rolexlte.main.band"),
		"active":  map[string]any{"band": cur["pband"], "earfcn": cur["earfcn"], "pci": cur["pci"]},
	})
}

func apiModemLock(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		Bands []string `json:"bands"`
		Auto  bool     `json:"auto"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	if b.Auto || len(b.Bands) == 0 {
		out := run(40, "/usr/bin/rolex-modem-ctl", "band", "auto")
		run(6, "uci", "-q", "delete", "rolexlte.main.band")
		run(6, "uci", "commit", "rolexlte")
		jsonOut(w, map[string]any{"success": true, "message": "Lock band dilepas (semua band). " + orDash(out)})
		return
	}
	list := strings.Join(b.Bands, ",")
	out := run(60, "/usr/bin/rolex-modem-ctl", "band", list)
	run(6, "uci", "-q", "set", "rolexlte.main.band="+list)
	run(6, "uci", "commit", "rolexlte")
	jsonOut(w, map[string]any{"success": true, "message": "Lock ke " + list + ". " + orDash(out)})
}

// rotasi IP saat internet bengong: 0 = mati
func apiModemRotate(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) {
		return
	}
	if r.Method == http.MethodPost {
		var b struct {
			Mins int `json:"mins"`
		}
		json.NewDecoder(r.Body).Decode(&b)
		if b.Mins < 0 {
			b.Mins = 0
		}
		cek := run(6, "uci", "-q", "get", "rolexlte.main.check_secs")
		gagal := run(6, "uci", "-q", "get", "rolexlte.main.check_fails")
		if cek == "" {
			cek = "60"
		}
		if gagal == "" {
			gagal = "3"
		}
		out := run(30, "/usr/bin/rolex-modem-ctl", "netguard", cek, gagal, strconv.Itoa(b.Mins))
		jsonOut(w, map[string]any{"success": true, "mins": b.Mins,
			"message": "Rotasi IP: " + map[bool]string{true: "mati", false: strconv.Itoa(b.Mins) + " menit"}[b.Mins == 0] + ". " + orDash(out)})
		return
	}
	mins := atoiSafe(run(6, "uci", "-q", "get", "rolexlte.main.rotate_mins"))
	jsonOut(w, map[string]any{"mins": mins,
		"check_secs":  atoiSafe(run(6, "uci", "-q", "get", "rolexlte.main.check_secs")),
		"check_fails": atoiSafe(run(6, "uci", "-q", "get", "rolexlte.main.check_fails")),
		"reboot_after": atoiSafe(run(6, "uci", "-q", "get", "rolexlte.main.reboot_after_mss")),
	})
}

// aksi cepat: ganti IP sekarang / reboot modem
func apiModemAction(w http.ResponseWriter, r *http.Request) {
	if !guard(w, r) || r.Method != http.MethodPost {
		return
	}
	var b struct {
		Action string `json:"action"`
	}
	json.NewDecoder(r.Body).Decode(&b)
	switch b.Action {
	case "ipnow":
		run(6, "sh", "-c", "/etc/init.d/rolex-lte restart >/dev/null 2>&1 &")
		jsonOut(w, map[string]any{"success": true, "message": "Sesi LTE diulang; IP baru ±60–90 s"})
	case "rebootmodem":
		run(6, "sh", "-c", "/usr/bin/rolex-data-reset modem >/dev/null 2>&1 &")
		jsonOut(w, map[string]any{"success": true, "message": "Modem MSS di-reboot; tunggu ±40–60 s"})
	case "reboot":
		go func() { time.Sleep(700 * time.Millisecond); run(10, "reboot") }()
		jsonOut(w, map[string]any{"success": true, "message": "Perangkat reboot…"})
	case "softreset":
		run(6, "sh", "-c", "/usr/bin/rolex-data-reset soft >/dev/null 2>&1 &")
		jsonOut(w, map[string]any{"success": true, "message": "Reset ringan dijalankan (sesi data + driver)"})
	default:
		jsonOut(w, map[string]any{"success": false, "error": "aksi tidak dikenal: " + b.Action})
	}
}