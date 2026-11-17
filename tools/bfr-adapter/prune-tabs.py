#!/usr/bin/env python3
"""Buang tab yang tidak berlaku di rolex dari bundel frontend BFR.

Bukan menyembunyikan lewat DOM, tapi menghapus definisinya dari bundel:
- entri tab (objek {id:`x`,label:...}) di index-*.js
- id tab di daftar kategori (tabs:[...])
- berkas chunk lazy (TabXxx-*.js) + tautan modulepreload-nya di index.html

Jalankan: prune-tabs.py <dir-dist>
"""
import re
import sys
from pathlib import Path

REMOVE = [
    # id tab, nama berkas chunk
    ("qualcomm", "TabQualcomm"),
    ("samsung", "TabSamsung"),
    ("shannon", "TabShannon"),
    ("charger", "TabCharger"),
    ("modules", "TabModules"),
    ("partitions", "TabPartitions"),
]

# sub-tab yang tidak berlaku (di dalam chunk TabModem)
SUBTABS = [
    "{id:`sim`,label:`Dual SIM Routing`,icon:h}",
    "{id:`thermal`,label:`5G Thermal Telemetry`,icon:w}",
    "{id:`at`,label:`AT Console Terminal`,icon:S}",
]

# baris <div ...>label<span class="text-muted">LABEL</span> ... </div> yang tidak berlaku
# dihapus dari bundel (bukan disembunyikan lewat JS)
BARIS_BUANG = []  # pemotongan markup merusak komponen Svelte -> kosongkan


def _blok_div(js: str, pos: int) -> tuple:
    """cari blok <div ...> ... </div> yang membungkus posisi pos (pencocokan bersarang)"""
    awal = js.rfind("<div", 0, pos)
    if awal < 0:
        return (-1, -1)
    i = awal
    depth = 0
    while i < len(js):
        nxt_open = js.find("<div", i)
        nxt_close = js.find("</div>", i)
        if nxt_close < 0:
            return (-1, -1)
        if 0 <= nxt_open < nxt_close:
            depth += 1
            i = nxt_open + 4
        else:
            depth -= 1
            i = nxt_close + 6
            if depth == 0:
                return (awal, i)
    return (-1, -1)


def hapus_baris(d: Path) -> list:
    hasil = []
    for f in d.glob("assets/TabModem-*.js"):
        js = f.read_text()
        for label in BARIS_BUANG:
            n = 0
            for _ in range(4):  # beberapa kemungkinan salinan
                pos = js.find('<span class="text-muted">' + label + "</span>")
                if pos < 0:
                    break
                a, b = _blok_div(js, pos)
                if a < 0:
                    break
                js = js[:a] + js[b:]
                n += 1
            hasil.append(f"  {label:20} dihapus={n}")
        f.write_text(js)
    return hasil


def prune_subtabs(d: Path) -> int:
    n = 0
    for f in d.glob("assets/TabModem-*.js"):
        js = f.read_text()
        for frag in SUBTABS:
            if frag in js:
                js = js.replace(frag + ",", "").replace(frag, "")
                n += 1
        f.write_text(js)
    return n


def main(dist: str) -> int:
    d = Path(dist)
    idx = next(d.glob("assets/index-*.js"), None)
    if not idx:
        print("index-*.js tidak ditemukan di", d)
        return 1
    js = idx.read_text()
    laporan = []

    for tid, chunk in REMOVE:
        # 1) objek entri tab
        pat_obj = re.compile(r"\{id:`" + re.escape(tid) + r"`,[^{}]*?\},")
        js, n1 = pat_obj.subn("", js)
        # 2) id di dalam daftar tabs:[...]
        pat_list = re.compile(r"`" + re.escape(tid) + r"`\s*,\s*")
        js, n2 = pat_list.subn("", js)
        # 3) rujukan impor dinamis ke chunk-nya
        pat_imp = re.compile(r"[`\"](\./" + re.escape(chunk) + r"-[A-Za-z0-9_-]+\.js)[`\"]\s*:\s*\(\)\s*=>[^,}]*,\s*")
        js, n3 = pat_imp.subn("", js)
        laporan.append(f"  {tid:11} entri={n1} daftar={n2} impor={n3}")

    idx.write_text(js)

    # 4) hapus berkas chunk + tautan modulepreload
    html = d / "index.html"
    if html.exists():
        h = html.read_text()
        for _, chunk in REMOVE:
            for f in d.glob(f"assets/{chunk}-*.js"):
                f.unlink()
                h = re.sub(r"\s*<link[^>]*" + re.escape(f.name) + r"[^>]*>", "", h)
                h = re.sub(r"\s*<link[^>]*" + re.escape(chunk) + r"-[A-Za-z0-9_-]+\.css[^>]*>", "", h)
            for f in d.glob(f"assets/{chunk}-*.css"):
                f.unlink()
        html.write_text(h)

    nsub = prune_subtabs(d)
    for baris in hapus_baris(d):
        print("baris", baris)
    print("buang sub-tab Cellular:", nsub, "entri")
    print("buang tab dari bundel:")
    print("\n".join(laporan))
    print("  sisa chunk:", len(list(d.glob('assets/Tab*.js'))), "berkas")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "dist"))
