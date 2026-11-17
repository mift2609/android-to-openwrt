// Kartu "Kontrol Modem LTE" untuk halaman Cellular (#modem):
// lock band, deteksi sel (PCI/EARFCN), rotasi IP saat bengong, reboot modem.
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

	function box() {
		let el = document.getElementById(ID);
		if (el) return el;
		el = document.createElement('section');
		el.id = ID;
		el.style.cssText = 'margin:14px 0;padding:14px 16px;border:1px solid #272e3c;border-radius:10px;background:#141822;color:#e8eaf0;font:12px/1.6 ui-monospace,monospace';
		el.innerHTML = `
		  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
		    <strong style="letter-spacing:.12em;text-transform:uppercase;font-size:11px;color:#c8cdda">Kontrol Modem LTE</strong>
		    <span id="mc-status" style="color:#8b93a5;font-size:11px">memuat…</span>
		  </div>

		  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px" id="mc-cell"></div>

		  <div style="border-top:1px dashed #272e3c;padding-top:10px;margin-bottom:10px">
		    <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8b93a5;margin-bottom:6px">Lock band LTE</div>
		    <div id="mc-bands" style="display:flex;flex-wrap:wrap;gap:10px"></div>
		    <div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap">
		      <button id="mc-lock" style="background:#5b21b6;border:0;color:#fff;border-radius:7px;padding:7px 12px;font:600 11px ui-monospace,monospace;cursor:pointer">Kunci band terpilih</button>
		      <button id="mc-auto" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:7px 12px;font:600 11px ui-monospace,monospace;cursor:pointer">Lepas lock (auto)</button>
		    </div>
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
			await act('lock', { bands: sel }, 'Mengunci band… (±60–90 s)');
		};
		el.querySelector('#mc-auto').onclick = () => act('lock', { auto: true }, 'Melepas lock band…');
		el.querySelector('#mc-save').onclick = () => act('rotate', { mins: parseInt(el.querySelector('#mc-mins').value, 10) }, 'Menyimpan pengaturan');
		el.querySelector('#mc-ipnow').onclick = () => act('action', { action: 'ipnow' }, 'Mengulang sesi LTE…');
		el.querySelector('#mc-rebootmodem').onclick = () => act('action', { action: 'rebootmodem' }, 'Reboot modem MSS…');
		el.querySelector('#mc-soft').onclick = () => act('action', { action: 'softreset' }, 'Reset ringan…');

		// taruh di BAWAH semua info halaman (bukan di atas)
		const host = document.querySelector('main') || document.body;
		host.appendChild(el);
		return el;
	}

	// Ganti isi kartu "Cellular Radio Signal" bawaan dengan bar kekuatan sinyal + persentase
	// (PCI/EARFCN/band sudah ada di kartu Kontrol Modem LTE di bawah, jadi tidak diulang).
	function strengthBar(pct, rsrp, rsrq, sinr) {
		if ((location.hash || '').indexOf('#modem') !== 0) return;
		const head = [...document.querySelectorAll('h1,h2,h3,h4,div,span')]
			.find(e => /cellular radio signal/i.test((e.textContent || '').trim()) && e.children.length === 0);
		if (!head) return;
		// naik sampai ketemu kotak berkartu (punya garis tepi), bukan sampai ke header halaman
		let card = head;
		for (let i = 0; i < 12; i++) {
			const cs = getComputedStyle(card);
			const tebal = parseFloat(cs.borderTopWidth) || 0;
			const radius = parseFloat(cs.borderTopLeftRadius) || 0;
			if (tebal > 0 && radius > 3 && card.querySelectorAll('div').length < 40) break;
			if (!card.parentElement) break;
			card = card.parentElement;
		}
		if (!card || card.querySelector('#mc-bar')) return;
		const n = Number(pct);
		const warna = n >= 70 ? '#34d399' : n >= 45 ? '#fbbf24' : n >= 20 ? '#fb923c' : '#f87171';
		const label = n >= 70 ? 'kuat' : n >= 45 ? 'sedang' : n >= 20 ? 'lemah' : 'sangat lemah';
		const el = document.createElement('div');
		el.id = 'mc-bar';
		el.style.cssText = 'padding:4px 0 10px';
		el.innerHTML =
			`<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b93a5;margin-bottom:5px">
			   <span>Kekuatan Sinyal</span><span style="color:${warna};font-weight:800">${n}% · ${label}</span></div>
			 <div style="height:12px;background:#10141d;border:1px solid #272e3c;border-radius:7px;overflow:hidden">
			   <div style="height:100%;width:${n}%;background:${warna};transition:width .4s ease"></div></div>
			 <div style="margin-top:6px;font-size:11px;color:#8b93a5">RSRP ${rsrp || '-'} dBm · RSRQ ${rsrq || '-'} dB · SINR ${sinr || '-'} dB</div>`;
		// taruh tepat di atas baris kotak nilai (RSRP (POWER)) — jadi persis di bawah judul
		const petak = [...card.querySelectorAll('*')].find(e => /rsrp \(power\)/i.test((e.textContent || '').trim()) && e.children.length === 0);
		if (petak) {
			let atas = petak;
			while (atas.parentElement && atas.parentElement !== card) atas = atas.parentElement;
			if (atas.parentElement === card) card.insertBefore(el, atas);
			else card.insertBefore(el, card.firstChild);
		} else {
			card.insertBefore(el, card.firstChild);
		}
	}

	function updateBar(s) {
		const el = document.getElementById('mc-bar');
		if (!el || !s) return;
		const n = Number(s.signal_pct);
		if (!isFinite(n)) return;
		const warna = n >= 70 ? '#34d399' : n >= 45 ? '#fbbf24' : n >= 20 ? '#fb923c' : '#f87171';
		const label = n >= 70 ? 'kuat' : n >= 45 ? 'sedang' : n >= 20 ? 'lemah' : 'sangat lemah';
		const fill = el.querySelector('div > div');
		const txt = el.querySelector('span:last-child');
		const det = el.lastElementChild;
		if (fill) { fill.style.width = n + '%'; fill.style.background = warna; }
		if (txt) { txt.textContent = n + '% · ' + label; txt.style.color = warna; }
		if (det) det.textContent = `RSRP ${s.rsrp || '-'} dBm · RSRQ ${s.rsrq || '-'} dB · SINR ${s.sinr || '-'} dB`;
	}

	// perbarui hanya angka yang berubah cepat (RSRP/RSRQ/SINR) tiap 2 detik
	async function liveSignal() {
		if ((location.hash || '').indexOf('#modem') !== 0) return;
		const grid = document.querySelector('#mc-cell');
		if (!grid) return;
		try {
			const s = await api('/api/modem/signal');
			const set = (label, val) => {
				// kalau modem sesaat tidak melaporkan (kosong), pertahankan nilai terakhir
				if (val == null || val === '' || val === '-') return;
				const box = [...grid.children].find(c => (c.firstElementChild || {}).textContent === label);
				if (box && box.lastElementChild) box.lastElementChild.textContent = String(val);
			};
			set('RSRP', s.rsrp);
			set('RSRQ', s.rsrq);
			set('SINR', s.sinr);
			strengthBar(s.signal_pct, s.rsrp, s.rsrq, s.sinr);
			updateBar(s);
			const st = document.getElementById('mc-status');
			if (st && /memuat/.test(st.textContent)) st.textContent = 'data sinyal langsung';
		} catch (e) { /* diamkan */ }
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

	const FIELDS = ['PCI', 'EARFCN', 'BAND', 'CELL ID', 'TAC', 'RSRP', 'RSRQ', 'SINR', 'OPERATOR'];

	// buat kotak nilai sekali saja; setelah itu hanya angkanya yang diperbarui
	function ensureGrid() {
		const grid = document.querySelector('#mc-cell');
		if (!grid) return null;
		if (grid.children.length !== FIELDS.length) {
			grid.innerHTML = FIELDS.map(k =>
				`<div style="background:#10141d;border:1px solid #272e3c;border-radius:7px;padding:6px 8px">
				   <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8b93a5">${k}</div>
				   <div style="font-weight:700">-</div></div>`).join('');
		}
		return grid;
	}

	function put(grid, label, val) {
		if (val == null || val === '' || val === '-') return; // kosong sesaat: jangan hapus angka lama
		const box = [...grid.children].find(c => (c.firstElementChild || {}).textContent === label);
		if (box && box.lastElementChild) box.lastElementChild.textContent = String(val);
	}

	async function refresh() {
		const el = document.getElementById(ID);
		if (!el) return;
		const grid = ensureGrid();
		if (!grid) return;
		try {
			const c = await api('/api/modem/cell');
			put(grid, 'PCI', c.pci);
			put(grid, 'EARFCN', c.earfcn);
			put(grid, 'BAND', c.band);
			put(grid, 'CELL ID', c.cell_id);
			put(grid, 'TAC', c.tac_hex || c.tac);
			put(grid, 'RSRP', c.rsrp);
			put(grid, 'RSRQ', c.rsrq);
			put(grid, 'SINR', c.sinr);
			put(grid, 'OPERATOR', c.operator);
			const rot = await api('/api/modem/rotate');
			el.querySelector('#mc-mins').value = String(rot.mins || 0);
			say('data ' + (c.fresh ? 'segar' : 'cache') + ' • ' + (rot.mins ? 'rotasi ' + rot.mins + ' mnt' : 'rotasi mati'));
		} catch (e) { say('gagal memuat: ' + e.message); }
	}

	function mount() {
		if ((location.hash || '').indexOf('#modem') !== 0) {
			const old = document.getElementById(ID);
			if (old) old.remove();
			return;
		}
		const el = box();
		const host = document.querySelector('main') || document.body;
		strengthBar(null, null, null, null);
		if (el.parentElement !== host || host.lastElementChild !== el) host.appendChild(el);
		refresh();
	}

	// jaga agar kartu selalu jadi elemen terakhir (Svelte bisa menyisipkan isi halaman setelahnya)
	function keepLast() {
		if ((location.hash || '').indexOf('#modem') !== 0) return;
		const host = document.querySelector('main') || document.body;
		const el = document.getElementById(ID);
		if (host && el && host.lastElementChild !== el) host.appendChild(el);
	}

	// Tab Cellular bawaan BFR tidak punya polling sendiri: klik "Refresh All"
	// secara berkala, dan sekali setiap kali tab ini dibuka dari menu lain.
	function autoRefresh() {
		if ((location.hash || '').indexOf('#modem') !== 0) return;
		const btn = [...document.querySelectorAll('button')].find(b => /refresh all/i.test((b.textContent || '').trim()));
		if (btn) btn.click();
		refresh();
	}
	setInterval(autoRefresh, 20000);      // segarkan seluruh halaman tiap 20 s
	setInterval(liveSignal, 10000);       // nilai sinyal tiap 10 s (cukup: modem sendiri memperbarui ~beberapa detik)
	document.addEventListener('visibilitychange', () => { if (!document.hidden) autoRefresh(); });

	document.addEventListener('DOMContentLoaded', () => { mount(); keepLast(); });
	window.addEventListener('hashchange', () => {
		mount(); keepLast();
		setTimeout(autoRefresh, 1200); // data segar begitu masuk tab Cellular
	});
	new MutationObserver(keepLast).observe(document.body, { childList: true, subtree: true });
	setInterval(() => { mount(); keepLast(); }, 2500);
})();