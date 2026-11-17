// Kartu "Kontrol Modem LTE" untuk halaman Cellular (#modem):
// lock band, rotasi IP saat bengong, reboot modem.
// Nilai sel (PCI/EARFCN/band/cell id/TAC/sinyal) TIDAK dipasang di sini —
// sudah ada di kartu "Cellular Radio Signal" dan "Cell Identity & Info" di atas.
// Memakai endpoint adaptor sendiri; tidak mengubah kode BFR.
(function () {
	const BANDS = ['B1', 'B3', 'B4', 'B5', 'B7', 'B8', 'B20', 'B40', 'B41'];
	const ID = 'modem-ctl-card';
	let busy = false;

	const api = async (url, opt) => {
		const r = await fetch(url, Object.assign({ credentials: 'include' }, opt || {}));
		if (!r.ok) throw new Error('HTTP ' + r.status);
		return r.json();
	};
	const post = (url, body) => api(url, {
		method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
		body: JSON.stringify(body || {})
	});

	const onModem = () => (location.hash || '').indexOf('#modem') === 0;

	// cari elemen daun yang teksnya cocok
	function leaf(rx) {
		return [...document.querySelectorAll('div,span,td,p,strong,h2,h3,h4')]
			.find(e => e.children.length === 0 && rx.test((e.textContent || '').trim()));
	}

	// naik dari judul sampai kotak berkartu (punya garis tepi + sudut membulat)
	function cardOf(rx) {
		const head = leaf(rx);
		if (!head) return null;
		let card = head;
		for (let i = 0; i < 12; i++) {
			const cs = getComputedStyle(card);
			if ((parseFloat(cs.borderTopWidth) || 0) > 0 && (parseFloat(cs.borderTopLeftRadius) || 0) > 3
				&& card.querySelectorAll('div').length < 40) return card;
			if (!card.parentElement) break;
			card = card.parentElement;
		}
		return null;
	}

	// ambil kotak nilai milik sebuah label di dalam kartu (nilai = tetangga label)
	function valueBox(card, rx) {
		if (!card) return null;
		const lab = [...card.querySelectorAll('*')].find(e => e.children.length === 0 && rx.test((e.textContent || '').trim()));
		if (!lab) return null;
		const row = lab.parentElement;
		if (!row) return null;
		const val = [...row.children].reverse().find(e => e !== lab);
		return val || lab;
	}

	function setVal(el, v) {
		if (!el || v == null || v === '' || v === '-') return; // kosong sesaat: jangan hapus nilai lama
		el.textContent = String(v);
	}

	// ---------- bar kekuatan sinyal di kartu "Cellular Radio Signal" ----------
	function strengthBar(pct) {
		if (!onModem()) return;
		const card = cardOf(/cellular radio signal/i);
		if (!card || card.querySelector('#mc-bar')) return;
		const n = Number(pct);
		const warna = n >= 70 ? '#34d399' : n >= 45 ? '#fbbf24' : n >= 20 ? '#fb923c' : '#f87171';
		const label = n >= 70 ? 'kuat' : n >= 45 ? 'sedang' : n >= 20 ? 'lemah' : 'sangat lemah';
		const el = document.createElement('div');
		el.id = 'mc-bar';
		el.style.cssText = 'padding:2px 0 10px';
		el.innerHTML =
			`<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b93a5;margin-bottom:5px">
			   <span>Kekuatan Sinyal</span><span id="mc-bar-txt" style="color:#8b93a5;font-weight:800">-</span></div>
			 <div style="height:12px;background:#10141d;border:1px solid #272e3c;border-radius:7px;overflow:hidden">
			   <div id="mc-bar-fill" style="height:100%;width:0%;background:${warna};transition:width .4s ease"></div></div>`;
		// tepat di atas baris kotak nilai (RSRP (POWER)) -> persis di bawah judul kartu
		const petak = valueBox(card, /rsrp \(power\)/i);
		const atas = petak ? (function () { let a = petak; while (a.parentElement && a.parentElement !== card) a = a.parentElement; return a; })() : null;
		if (atas && atas.parentElement === card) card.insertBefore(el, atas);
		else card.insertBefore(el, card.firstChild);
	}

	function updateBar(pct) {
		const n = Number(pct);
		if (!isFinite(n)) return;
		const fill = document.getElementById('mc-bar-fill');
		const txt = document.getElementById('mc-bar-txt');
		if (!fill || !txt) return;
		const warna = n >= 70 ? '#34d399' : n >= 45 ? '#fbbf24' : n >= 20 ? '#fb923c' : '#f87171';
		const label = n >= 70 ? 'kuat' : n >= 45 ? 'sedang' : n >= 20 ? 'lemah' : 'sangat lemah';
		fill.style.width = n + '%';
		fill.style.background = warna;
		txt.textContent = n + '% · ' + label;
		txt.style.color = warna;
	}

	// ---------- kartu kontrol (bawah halaman) ----------
	function box() {
		let el = document.getElementById(ID);
		if (el) return el;
		el = document.createElement('section');
		el.id = ID;
		el.style.cssText = 'margin:14px 0;padding:14px 16px;border:1px solid #272e3c;border-radius:10px;background:#141822;color:#e8eaf0;font:12px/1.6 ui-monospace,monospace';
		el.innerHTML = `
		  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
		    <strong style="letter-spacing:.12em;text-transform:uppercase;font-size:11px;color:#c8cdda">Kontrol Modem LTE</strong>
		    <span id="mc-status" style="color:#8b93a5;font-size:11px">memuat...</span>
		  </div>

		  <div style="border-top:1px dashed #272e3c;padding-top:10px;margin-bottom:10px">
		    <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8b93a5;margin-bottom:6px">Lock band LTE</div>
		    <div id="mc-bands" style="display:flex;flex-wrap:wrap;gap:10px"></div>
		    <div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap">
		      <button id="mc-lock" style="background:#5b21b6;border:0;color:#fff;border-radius:7px;padding:7px 12px;font:600 11px ui-monospace,monospace;cursor:pointer">Kunci band terpilih</button>
		      <button id="mc-auto" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:7px 12px;font:600 11px ui-monospace,monospace;cursor:pointer">Lepas lock (auto)</button>
		    </div>
		    <div id="mc-bandaktif" style="color:#8b93a5;font-size:10.5px;margin-top:7px"></div>
		  </div>

		  <div style="border-top:1px dashed #272e3c;padding-top:10px">
		    <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8b93a5;margin-bottom:6px">Ganti IP saat internet bengong</div>
		    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
		      <select id="mc-mins" style="background:#1a1f2b;border:1px solid #2c3444;color:#e8eaf0;border-radius:7px;padding:6px 8px;font:12px ui-monospace,monospace">
		        <option value="0">Mati</option><option value="5">tiap 5 menit</option>
		        <option value="15">tiap 15 menit</option><option value="30">tiap 30 menit</option>
		      </select>
		      <button id="mc-save" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:7px 12px;font:600 11px ui-monospace,monospace;cursor:pointer">Simpan</button>
		      <button id="mc-ipnow" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:7px 12px;font:600 11px ui-monospace,monospace;cursor:pointer">Ganti IP sekarang</button>
		      <button id="mc-rebootmodem" style="background:#2a1216;border:1px solid #5a2330;color:#fca5a5;border-radius:7px;padding:7px 12px;font:600 11px ui-monospace,monospace;cursor:pointer">Reboot modem</button>
		      <button id="mc-soft" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:7px 12px;font:600 11px ui-monospace,monospace;cursor:pointer">Reset ringan</button>
		    </div>
		    <div id="mc-note" style="color:#8b93a5;font-size:10.5px;margin-top:8px">Rotasi IP bertingkat: cek 60 s, gagal 3× → sesi ulang → RF → modem restart → reboot.</div>
		  </div>`;

		const bands = el.querySelector('#mc-bands');
		BANDS.forEach(b => {
			const n = b.slice(1);
			const label = document.createElement('label');
			label.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11.5px';
			label.innerHTML = `<input type="checkbox" value="${n}" style="accent-color:#6d28d9"> ${b}`;
			bands.appendChild(label);
		});

		el.querySelector('#mc-lock').onclick = async () => {
			const sel = [...el.querySelectorAll('#mc-bands input:checked')].map(i => 'eutran-' + i.value);
			if (!sel.length) return say('Pilih minimal satu band');
			await act('lock', { bands: sel }, 'Mengunci band... (±60–90 s)');
		};
		el.querySelector('#mc-auto').onclick = () => act('lock', { auto: true }, 'Melepas lock band...');
		el.querySelector('#mc-save').onclick = () => act('rotate', { mins: parseInt(el.querySelector('#mc-mins').value, 10) }, 'Menyimpan pengaturan');
		el.querySelector('#mc-ipnow').onclick = () => act('action', { action: 'ipnow' }, 'Mengulang sesi LTE...');
		el.querySelector('#mc-rebootmodem').onclick = () => act('action', { action: 'rebootmodem' }, 'Reboot modem MSS...');
		el.querySelector('#mc-soft').onclick = () => act('action', { action: 'softreset' }, 'Reset ringan...');

		// taruh di BAWAH semua info halaman (bukan di atas)
		const host = document.querySelector('main') || document.body;
		host.appendChild(el);
		return el;
	}

	function say(msg) {
		const s = document.getElementById('mc-status');
		if (s) s.textContent = msg;
	}

	async function act(kind, body, msg) {
		if (busy) return;
		busy = true;
		say(msg);
		try {
			const url = kind === 'lock' ? '/api/modem/lock' : kind === 'rotate' ? '/api/modem/rotate' : '/api/modem/action';
			const r = await post(url, body);
			say(r.message || r.error || 'selesai');
		} catch (e) { say('gagal: ' + e.message); }
		busy = false;
		setTimeout(refresh, 2500);
	}

	// isi kartu bawaan halaman (jangan menambah baris: barisnya sudah lengkap di BFR)
	const KOSONG = /^(-{1,2}|n\/a|)$/i;

	function tempatkan(c) {
		const sig = cardOf(/cellular radio signal/i);
		if (sig) {
			setVal(valueBox(sig, /rsrp \(power\)/i), c.rsrp && c.rsrp + ' dBm');
			setVal(valueBox(sig, /rsrq \(quality\)/i), c.rsrq && c.rsrq + ' dB');
			setVal(valueBox(sig, /sinr \(snr\)/i), c.sinr && c.sinr + ' dB');
		}
		const info = cardOf(/cell identity & info/i);
		if (!info) return;
		const isi = (rx, v) => {
			const box = valueBox(info, rx);
			if (box && KOSONG.test((box.textContent || '').trim())) setVal(box, v);
		};
		isi(/^operator$/i, c.operator);
		isi(/^active band$/i, c.band);
		isi(/earfcn/i, c.earfcn);
		isi(/physical cell id/i, c.pci);
	}

	async function refresh() {
		const el = document.getElementById(ID);
		if (!el) return;
		try {
			const c = await api('/api/modem/cell');
			tempatkan(c);
			const b = await api('/api/modem/bands').catch(() => null);
			if (b) {
				const aktif = (b.active || []).join(' ');
				const line = el.querySelector('#mc-bandaktif');
				if (line) line.textContent = b.locked
					? 'Lock aktif: ' + (b.selected_bands || []).join(', ')
					: (aktif ? 'Band aktif (auto): ' + aktif : '');
			}
			const rot = await api('/api/modem/rotate');
			el.querySelector('#mc-mins').value = String(rot.mins || 0);
			say('data ' + (c.fresh ? 'segar' : 'cache') + ' • ' + (rot.mins ? 'rotasi ' + rot.mins + ' mnt' : 'rotasi mati'));
		} catch (e) { say('gagal memuat: ' + e.message); }
	}

	// nilai yang cepat berubah: bar + kotak bawaan, tiap 10 detik
	async function liveSignal() {
		if (!onModem()) return;
		try {
			const s = await api('/api/modem/signal');
			strengthBar(s.signal_pct);
			updateBar(s.signal_pct);
			const sig = cardOf(/cellular radio signal/i);
			if (sig) {
				setVal(valueBox(sig, /rsrp \(power\)/i), s.rsrp && s.rsrp + ' dBm');
				setVal(valueBox(sig, /rsrq \(quality\)/i), s.rsrq && s.rsrq + ' dB');
				setVal(valueBox(sig, /sinr \(snr\)/i), s.sinr && s.sinr + ' dB');
			}
		} catch (e) { /* diamkan */ }
	}

	function mount() {
		if (!onModem()) {
			const old = document.getElementById(ID);
			if (old) old.remove();
			return;
		}
		const el = box();
		const host = document.querySelector('main') || document.body;
		strengthBar(null);
		if (el.parentElement !== host || host.lastElementChild !== el) host.appendChild(el);
		refresh();
	}

	// jaga agar kartu selalu jadi elemen terakhir (Svelte bisa menyisipkan isi halaman setelahnya)
	function keepLast() {
		if (!onModem()) return;
		const host = document.querySelector('main') || document.body;
		const el = document.getElementById(ID);
		if (host && el && host.lastElementChild !== el) host.appendChild(el);
	}

	// Tab Cellular bawaan BFR tidak punya polling sendiri: klik "Refresh All" berkala,
	// dan sekali setiap kali tab ini dibuka dari menu lain.
	function autoRefresh() {
		if (!onModem()) return;
		const btn = [...document.querySelectorAll('button')].find(b => /refresh all/i.test((b.textContent || '').trim()));
		if (btn) btn.click();
		refresh();
	}
	setInterval(autoRefresh, 20000);  // seluruh halaman
	setInterval(liveSignal, 10000);   // bar + angka sinyal
	document.addEventListener('visibilitychange', () => { if (!document.hidden) autoRefresh(); });

	document.addEventListener('DOMContentLoaded', () => { mount(); keepLast(); });
	window.addEventListener('hashchange', () => {
		mount(); keepLast();
		setTimeout(autoRefresh, 1200);
	});
	new MutationObserver(keepLast).observe(document.body, { childList: true, subtree: true });
	setInterval(() => { mount(); keepLast(); }, 2500);
})();
