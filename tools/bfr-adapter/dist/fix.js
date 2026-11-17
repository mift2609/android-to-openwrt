// Penyesuaian tampilan untuk OpenWrt (dijalankan di browser, kode BFR tidak diubah):
//  1) sembunyikan hanya baris/tile kecil yang tak berlaku di router (jangan sampai kartunya ikut)
//  2) buang kata "Android" pada nilai yang tampil
(function () {
	document.documentElement.setAttribute('data-fix', '1');
	const HIDE_LABELS = [
		'active band', 'bandwidth',
		'security patch', 'resolution & density', 'active governor policy',
		'zram', 'selinux', 'sdk', 'android api',
		'charge level', 'battery temp', 'battery level', 'health', 'voltage',
		'battery & power', 'battery status'
	];
	// judul kartu yang seluruhnya tak berlaku -> sembunyikan kartunya
	const HIDE_CARDS = ['cpu scaling & scheduling policy', 'battery & power',
		// tab Cellular: kartu vendor Android yang tidak berlaku untuk rolex
		'target architecture & hardware compatibility', 'hardware band locking',
		'carrier telemetry integration'];
	// sub-tab Cellular yang tidak berlaku (modem rolex: satu SIM, tanpa sensor 5G, tanpa AT)
	const HIDE_TABS = ['sim', 'sim slot', 'dual sim routing', 'thermal', '5g thermal telemetry',
		'at', 'at terminal', 'at console', 'at console terminal'];
	// pola teks yang menandakan baris kosong (mis. "N/A (No TA broadcast)")
	const HIDE_PATTERNS = [/\bno ta broadcast\b/i, /\bn\/a \(/i, /\bmasked$/i];
	const HIDE_VALUES = ['n/a', '-', '--', '(-)', 'tidak ada baterai', 'standard android',
		'android 16 masked', 'android 16', 'masked'];
	const HIDE_CHIPS = []; // sengaja kosong: chip persen jangan disembunyikan (risiko kena kartu lain)
	// menu/tab yang tidak mungkin di rolex (NAS & Scrcpy sengaja TIDAK dihapus)
	const HIDE_NAV = [
		'snapdragon qmi', 'samsung ril', 'google tensor',
		'charger', 'modules', 'partitions'
	];

	function len(x) { return (x.textContent || '').trim().length; }

	// Naik dari elemen ke wadah "baris ini saja": hanya selama isi wadah masih
	// seputar teks elemen itu (label + nilai), bukan wadah tetangga/kartu.
	function box(el) {
		let b = el;
		let naik = 0;
		// naik hanya kalau wadah induk menambah sedikit teks (cuma nilai pendamping), maksimum 3 tingkat
		while (b.parentElement && naik < 3 && len(b.parentElement) <= len(b) + 12 && b.parentElement.children.length <= 4) {
			b = b.parentElement;
			naik++;
		}
		return b;
	}

	// Untuk judul kartu: naik selama wadah masih diawali judul itu, lalu sembunyikan wadah terluarnya.
	function cardBox(el, title) {
		let b = el, best = el;
		for (let i = 0; i < 8 && b.parentElement; i++) {
			b = b.parentElement;
			const t = (b.textContent || '').trim().toLowerCase();
			if (!t.startsWith(title)) break;
			best = b;
			if (t.length > 1200) break;
		}
		return best;
	}

	function hide(el, why) {
		const b = box(el);
		if (b && b.style.display !== 'none') {
			b.style.display = 'none';
			b.setAttribute('data-why', why + ' :: ' + (el.textContent || '').trim().slice(0, 30));
		}
	}

	function tidy(root) {
		// halaman About memuat kredit pembuat asli: biarkan apa adanya
		if ((location.hash || '').indexOf('#about') === 0) return;
		const scope = root && root.querySelectorAll ? root : document;
		for (const el of scope.querySelectorAll('span, div, p, td, label')) {
			if (el.style.display === 'none') continue;
			const raw = (el.textContent || '').trim();
			if (!raw) continue;
			const low = raw.toLowerCase();

			// pola hanya untuk elemen kecil (jangan pernah mengenai pembungkus halaman)
			if (raw.length <= 120 && el.children.length <= 2) {
				const pat = HIDE_PATTERNS.find(rx => rx.test(raw));
				if (pat) { hide(el, 'pola'); continue; }
			}
			if (HIDE_TABS.includes(low)) {
				const btn = el.closest('button, [role="tab"], li') || el;
				btn.style.display = 'none';
				btn.setAttribute('data-why', 'subtab :: ' + low.slice(0, 24));
				continue;
			}
			const cardHit = HIDE_CARDS.find(h => low === h || low.startsWith(h));
			if (cardHit) {
				// sembunyikan SEMUA wadah yang teksnya masih diawali judul kartu itu
				let b = el;
				for (let i = 0; i < 8 && b; i++) {
					const t = (b.textContent || '').trim().toLowerCase();
					if (!t.startsWith(cardHit)) break;
					if (b.style) { b.style.display = 'none'; b.setAttribute('data-why', 'kartu :: ' + cardHit.slice(0, 24)); }
					b = b.parentElement;
				}
				const wrap = el.closest('section, article');
				if (wrap && wrap.style && wrap.style.display !== 'none') wrap.style.display = 'none';
				continue;
			}
			if (raw.length <= 120 && el.children.length <= 2) {
				const lab = HIDE_LABELS.find(h => low === h || low.startsWith(h));
				if (lab) { hide(el, 'label:' + lab.slice(0, 16)); continue; }
				// di halaman Cellular jangan sembunyikan nilai kosong: kotak "--" itu nanti
				// diisi oleh adaptor (RSRP/EARFCN/PCI) -> kalau disembunyikan, angkanya tak terlihat
				const diModem = (location.hash || '').indexOf('#modem') === 0;
				if (HIDE_VALUES.includes(low) && !diModem) { hide(el, 'nilai'); continue; }
			}
			if (HIDE_CHIPS.includes(low) && el.children.length === 0) {
				const chip = el.closest('span, div') || el;
				if (chip.style) { chip.style.display = 'none'; chip.setAttribute('data-why', 'chip'); }
				else if (el.style) el.style.display = 'none';
				continue;
			}
			if (HIDE_NAV.includes(low)) {
				// hanya berlaku untuk item MENU (bukan tombol biasa seperti tautan Telegram di login)
				const item = el.closest('a, button, [role="menuitem"], li') || el;
				const inMenu = !!item.closest('nav, [role="menu"], [role="menubar"], header, .drop, .dropdown');
				if (inMenu) { item.style.display = 'none'; item.setAttribute('data-why', 'menu'); }
				continue;
			}

			if (el.children.length === 0) {
				// ganti istilah Android di teks bebas -> OpenWrt
				if (/\bAndroid\b/.test(raw)) {
					el.textContent = raw.replace(/\bAndroid\b/g, 'OpenWrt');
					continue;
				}
				if (raw.indexOf('/data/adb/') === 0 || raw.indexOf('Persistent in /data/adb') === 0) {
					el.textContent = raw.replace(/\/data\/adb\/bfr_webui_go\/data\/kernel_config\.json/, '/etc/sysctl.d/98-bfr-kernel.conf')
						.replace(/\/data\/adb\/bfr_webui_go\/data\//, '/etc/');
					continue;
				}
				if (/dual-sim routing/i.test(raw)) {
					el.textContent = raw
						.replace(/,\s*Dual-SIM routing,?\s*and thermal telemetry\.?/i, '.')
						.replace(/Dual-SIM routing,?\s*/i, '')
						.replace(/,\s*\./g, '.')
						.trim();
					continue;
				}
				if (/^Carrier Telemetry Integration$/i.test(raw)) {
					el.textContent = 'Pengukuran Sinyal Radio';
					continue;
				}
				if (/OpenWrt\s+OpenWrt/i.test(raw)) {
					el.textContent = raw.replace(/OpenWrt\s+OpenWrt/gi, 'OpenWrt');
					continue;
				}
				if (/Logcat/i.test(raw)) {
					el.textContent = raw.replace(/Logcat/gi, 'log sistem');
					continue;
				}
				if (/\(API[^)]*\)/i.test(raw)) {
					const cleaned = raw.replace(/\s*\(API[^)]*\)/i, '').trim();
					if (cleaned !== raw) { el.textContent = cleaned; continue; }
				}
				if (/android\s+openwrt/i.test(raw)) {
					el.textContent = raw.replace(/\s*android\s+/i, ' ').trim();
				} else if (/^android\b/i.test(raw)) {
					el.textContent = raw.replace(/^android\b\s*/i, '');
				}
			}
		}
	}

	// Tanpa setTimeout: MutationObserver berjalan sebagai microtask, yaitu SEBELUM browser
	// menggambar. Jadi item yang disembunyikan tidak pernah sempat terlihat (tidak berkedip).
	function scan(node) {
		if (!node || node.nodeType !== 1) return;
		tidy(node);
		if (node.parentElement) tidy(node.parentElement);
	}

	new MutationObserver(muts => {
		for (const m of muts) for (const n of m.addedNodes) scan(n);
	}).observe(document.documentElement, { childList: true, subtree: true });

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => tidy(document));
	} else {
		tidy(document);
	}
	window.addEventListener('hashchange', () => tidy(document));
	setInterval(() => tidy(document), 5000); // sapuan penuh berkala
})();