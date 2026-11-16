# Peta WebUI BFR → rencana panel "OpenWrt"

Sumber: `github.com/latifangren/BFR-WEBUI-GO` (branch `dev`, v1.2.8). Ditelusuri langsung dari
`frontend/src/stores/navigation.svelte.ts`, `frontend/src/components/tabs/**`, dan rute Go
(`/api/**`, 189 rute). Semua nama "BFR" di bawah sudah diganti "OpenWrt" sesuai permintaan;
nama asli dicatat di kolom catatan bila perlu.

Catatan penting: BFR adalah panel **Android root** (Magisk/KernelSU/APatch). Struktur menu dan
tampilannya bisa ditiru, tetapi banyak isinya memanggil jalur Android (`/data/adb`, `dumpsys`,
DIAG/EFS, `am`, sysfs charger). Kolom "rolex" menandai mana yang bisa dipakai apa adanya,
mana yang perlu adaptasi ke OpenWrt, mana yang tidak berlaku.

---

## 1. Halaman login (spesifikasi terukur dari tangkapan layar)

| Unsur | Nilai |
|---|---|
| Latar | `#080a0e` (navy hampir hitam) |
| Panel kartu | `#141822`, border `#272e3c`, radius 12px, glow `0 0 40px #9aa4b81a` |
| Field input | `#1a1f2b`, border `#2c3444`, tinggi 46px, radius 8px |
| Aksen utama | ungu `#5b21b6`, hover `#6d28d9` |
| Aksen status | hijau `#34d399` (pill "Custom Password Active") |
| Huruf | monospace (JetBrains/Roboto/IBM Plex Mono), label HURUF BESAR spasi 0.10–0.18em |
| Susunan | topbar (logo + nama + badge `PRO` + tombol `APPEARANCE`) · kartu tengah · footer |
| Isi kartu | logo 48px → judul → subjudul → label `ACCESS PASSWORD` → input + ikon mata → baris "Quick Access" + pill → tombol `SIGN IN →` → pemisah `CONNECT & COMMUNITY` → 3 tombol sosial |
| Footer | teks kecil tengah |

Versi OpenWrt: judul `OPENWRT CONTROL PANEL`, subjudul `Panel kendali router rolex (MSM8917)`,
badge `PRO` → `ROLEX`, footer `OpenWrt 24.10.5 • rolex • kernel 7.1.3`. Tombol sosial diganti
tautan dokumentasi repo + tombol `MASUK`.

---

## 2. Kerangka tampilan

- **Dua layout navigasi** (dipilih di Appearance):
  - `Classic Top Bar`: kategori di header, flyout dropdown di desktop; di HP jadi bottom-nav 5 kolom dengan popover.
  - `Modern Sidebar`: rail kiri dengan grup akordeon (Core, Network, System, Tools); di HP jadi drawer geser.
- **Appearance Studio** (modal): 9 palet (`Dark Navy`, `Pure AMOLED`, `Clean Light`, `Dracula`,
  `Nordic Frost`, `Cyberpunk 2077`, `Matrix Emerald`, `Retro Sunset`, `Retro Deck`) × 2 gaya
  (`Neobrutalism`: border 2px + shadow keras; `Modern Clean`: border 1px + bayangan halus).
- **Komponen khas**: kartu statistik dengan badge warna (mint/peach/ice/yellow/lavender/amber),
  pill status, tabel monospace, chip, modal, toast, dropzone unggah, grafik (vnstat).
- **Pola tiap halaman**: judul + badge → baris kartu ringkasan → panel/tabel → aksi tombol.

---

## 3. Menu lengkap (4 kategori, 27 tab)

### Core (4)
| Tab | Badge | Isi | rolex |
|---|---|---|---|
| Overview | PRO | Kartu ringkasan sistem: uptime, RAM/swap, suhu, beban, IP, status layanan, tombol cepat | ✅ adaptasi (data dari `/proc`, `ubus`, skrip `rolex-*`) |
| Sysinfo | CORE | Detail CPU/SoC, memori, penyimpanan, kernel, perangkat | ✅ adaptasi |
| Kernel | NEW | Governor CPU per-cluster, frekuensi, parameter kernel | ⚠️ governor OpenWrt beda (`/sys/devices/system/cpu/cpufreq`) |
| About | — | Versi, kredit, tautan proyek | ✅ ganti jadi info OpenWrt/rolex |

### Network (10)
| Tab | Badge | Isi | rolex |
|---|---|---|---|
| Network | NET | Interface, IP, rute, DNS, TTL hotspot, reset DNS | ✅ adaptasi (uci/`network`, `nft`/`iptables`) |
| Tethering & QoS | ROUTER | Sub-tab: Kontrol tethering, Klien terhubung, Filter MAC, QoS (TC HTB) | ✅ adaptasi — padanan: AP `rolex-hotspot`, daftar klien via `iw`/DHCP lease, QoS `tc` |
| Proxy | CLASH | Sub-tab: Hero status, Aplikasi/per-app, Node, Routing (TPROXY/REDIRECT/TUN/MIXED), Log, Langganan + GeoIP/GeoSite | ✅ adaptasi — padanan: OpenClash/nikki yang sudah jalan; per-app routing ✗ (Android) |
| Cellular Dashboard | CELL | Sinyal, operator, band, CA, IP, trafik, kunci RAT, cell lock | ✅ adaptasi — data dari `rolex-modem-ctl`, `rolex-3ginfo-json`; cell lock ✗ (QMI tolak, err 71) |
| Snapdragon QMI | QCOM | 9 sub-tab: Band Locking, Cell & Tower Lock, Searcher & Extra Locks, RRC Capabilities, MBN/PDC, Hardware & Profiles, EFS & NV Browser, NV Manager, IMEI Tool | ⚠️ sebagian: band lock via ModemManager ✅; EFS/NV/IMEI/DIAG ✗ (firmware MSS tidak membuka DIAG) |
| Samsung RIL | SEC | Band manager Samsung | ✗ tidak berlaku |
| Google Tensor | PIXEL | Shannon modem, editor CA | ✗ tidak berlaku |
| SMS | SMS | Daftar/baca/kirim/hapus SMS | ✅ sudah ada di LuCI (`rolex-sms-ctl`, tab SMS) |
| VnStat | — | Kartu ringkasan, tabel interface, grafik harian/bulanan, kuota siklus tagihan | ⚠️ di rolex dipakai Bandix (vnstat dimatikan) |
| Tunnel | — | Terowongan/port forwarding (tailscale/cloudflared) | ✅ adaptasi — tailscale 1.80.3 sudah ada |

### System (4)
| Tab | Badge | Isi | rolex |
|---|---|---|---|
| Power | PWR | Reboot/jadwal reboot, power off, recovery/bootloader | ⚠️ reboot ✅, recovery/bootloader ✗ (mainline) |
| Charger | BATT | Batas arus pengisian (sysfs PMIC Android) | ✗ tidak berlaku (board tanpa baterai/charger Android) |
| Modules | ROOT | Modul Magisk: pasang/aktifkan/hapus | ✗ → padanan OpenWrt: manajemen paket `opkg` |
| Partitions | — | Tabel partisi, backup, flash image, aksi cepat | ⚠️ berbahaya; padanan: `dd`/backup yang sudah dipakai manual |

### Tools (9)
| Tab | Badge | Isi | rolex |
|---|---|---|---|
| Terminal | — | Terminal PTY root lewat WebSocket (xterm.js) | ✅ sudah ada ttyd (`/bin/login -f root`) |
| SSH | — | Status dropbear, kunci, sandi | ✅ adaptasi (dropbear sudah jalan) |
| Scrcpy | — | Mirroring layar Android via WebCodecs (butuh HTTPS) | ✗ tidak berlaku |
| Files | — | File manager dua panel, bookmark, unggah drag&drop, editor kode, chmod, zip/tar | ✅ adaptasi (root filesystem OpenWrt) |
| Logs | — | logread/logcat, filter | ✅ adaptasi (`logread`) |
| NAS | — | Berbagi folder (Samba/NFS) | ⚠️ perlu paket `ksmbd`/`nfs` |
| Speedtest | — | Uji kecepatan unduh/unggah | ⚠️ perlu biner speedtest (aarch64) |
| Tools | — | Kumpulan utilitas (ping, DNS, port scan, dll) | ✅ adaptasi |
| Telegram | — | Bot remote: /stats, /reboot, notifikasi | ⚠️ perlu bot sendiri (token) |

---

## 4. Skala backend (kenapa ini bukan pekerjaan kecil)

189 rute `/api/**` dikelompokkan: `efs` 30, `shannon` 20, `files` 17, `modem` 13, `qualcomm` 13,
`proxy` 12, `partitions` 7, `samsung` 6, `hotspot` 5, `auth` 4, `backup` 4, `kernel` 4,
`modules` 4, `network` 4, `speedtest` 4, `theme` 4, `tunnel` 4, `charger` 3, `logs` 3, `nas` 3,
`power` 3, `qos` 3, `shortcuts` 3, `ssh` 3, `telegram` 3, `sysinfo` 2, `vnstat` 2, `governor` 1,
`protected` 1, `scrcpy` 1, `sms` 1, `stats` 1, `terminal` 1.

---

## 5. Rencana bertahap (tanpa mengganggu LuCI)

Prinsip: **LuCI tetap di port 80 dan tidak diubah**. Panel baru berjalan di port sendiri
(usul: `8081`), memakai skrip `rolex-*` yang sudah ada. Kalau panel mati, LuCI tidak terpengaruh.

- **Tahap 1** — kerangka: biner Go statis (linux/arm64), login ala BFR (sandi dari uci), tema
  navy+ungu+mono, layout sidebar, halaman *Overview* + *Cellular* (data `rolex-modem-ctl`,
  `rolex-3ginfo-json`) + *WiFi* (`rolex-wifi-ctl`) + *Services* (start/stop layanan).
- **Tahap 2** — *SMS* (pakai `rolex-sms-ctl`), *Files* (root fs), *Logs* (`logread`), *Terminal* (tautan ke ttyd).
- **Tahap 3** — *Proxy* (status OpenClash/nikki), *Tunnel* (tailscale), *VnStat/Bandix*, *Network* (uci).
- **Tidak diambil**: Qualcomm DIAG/EFS/IMEI/NV, Samsung RIL, Tensor Shannon, Charger, Modules (Magisk), Scrcpy, per-app routing.

Nama: `BFR WEBUI` → `OPENWRT`, `BFR Control Panel` → `Panel OpenWrt`, footer
`OpenWrt 24.10.5 • rolex • MSM8917`.