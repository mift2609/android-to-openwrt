// Penyesuaian tampilan untuk OpenWrt (dijalankan di browser, kode BFR tidak diubah):
//  1) sembunyikan hanya baris/tile kecil yang tak berlaku di router (jangan sampai kartunya ikut)
//  2) buang kata "Android" pada nilai yang tampil
(function () {
	const HIDE_LABELS = [
		'security patch', 'resolution & density', 'active governor policy',
		'zram', 'selinux', 'sdk', 'android api',
		'charge level', 'battery temp', 'battery level', 'health', 'voltage',
		'battery & power', 'battery status', 'battery'
	];
	// judul kartu yang seluruhnya tak berlaku -> sembunyikan kartunya
	const HIDE_CARDS = ['cpu scaling & scheduling policy', 'battery & power'];
	const HIDE_VALUES = ['n/a', '-', '--', '(-)', 'tidak ada baterai', 'standard android'];
	const HIDE_CHIPS = ['0%'];
	// menu/tab yang tidak mungkin di rolex (NAS & Scrcpy sengaja TIDAK dihapus)
	const HIDE_NAV = [
		'snapdragon qmi', 'samsung ril', 'google tensor',
		'charger', 'modules', 'partitions', 'telegram'
	];

	function len(x) { return (x.textContent || '').trim().length; }

	// Naik dari elemen ke wadah "baris ini saja": hanya selama isi wadah masih
	// seputar teks elemen itu (label + nilai), bukan wadah tetangga/kartu.
	function box(el) {
		let b = el;
		// naik hanya kalau wadah induk menambah sedikit teks (artinya cuma berisi nilai pendamping)
		while (b.parentElement && len(b.parentElement) <= len(b) + 30 && b.parentElement.children.length <= 4) {
			b = b.parentElement;
		}
		return b;
	}

	function hide(el) {
		const b = box(el);
		if (b && b.style.display !== 'none') b.style.display = 'none';
	}

	function tidy() {
		// halaman About memuat kredit pembuat asli: biarkan apa adanya
		if ((location.hash || '').indexOf('#about') === 0) return;
		for (const el of document.querySelectorAll('span, div, p, td, label')) {
			if (el.style.display === 'none') continue;
			const raw = (el.textContent || '').trim();
			if (!raw) continue;
			const low = raw.toLowerCase();

			if (HIDE_CARDS.some(h => low === h || low.startsWith(h))) {
				const card = el.closest('.bg-card, section, article') || box(el);
				if (card && card.style.display !== 'none') card.style.display = 'none';
				continue;
			}
			if (HIDE_LABELS.some(h => low === h || low.startsWith(h))) { hide(el); continue; }
			if (HIDE_VALUES.includes(low)) { hide(el); continue; }
			if (HIDE_CHIPS.includes(low) && el.children.length === 0) { hide(el); continue; }
			if (HIDE_NAV.includes(low)) {
				// item menu: sembunyikan tautan/kartu pilihannya, bukan seluruh dropdown
				const item = el.closest('a, button, [role="menuitem"], li') || el;
				item.style.display = 'none';
				continue;
			}

			if (el.children.length === 0) {
				// ganti istilah Android di teks bebas -> OpenWrt
				if (/\bAndroid\b/.test(raw)) {
					el.textContent = raw.replace(/\bAndroid\b/g, 'OpenWrt');
					continue;
				}
				if (/Logcat/i.test(raw)) {
					el.textContent = raw.replace(/Logcat/gi, 'log sistem');
					continue;
				}
				if (/\(API[^)]*\)/i.test(raw)) {
					const cleaned = raw.replace(/\s*\(API[^)]*\)/i, '').trim();
					if (cleaned !== raw) { el.textContent = cleaned; return; }
				}
				if (/android\s+openwrt/i.test(raw)) {
					el.textContent = raw.replace(/\s*android\s+/i, ' ').trim();
				} else if (/^android\b/i.test(raw)) {
					el.textContent = raw.replace(/^android\b\s*/i, '');
				}
			}
		}
	}

	let t = null;
	const debounce = () => { clearTimeout(t); t = setTimeout(tidy, 150); };

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', tidy);
	} else {
		tidy();
	}
	new MutationObserver(debounce).observe(document.documentElement, { childList: true, subtree: true });
})();