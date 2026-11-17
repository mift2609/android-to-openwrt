// Halaman Cellular (#modem) versi OpenWrt.
// Isi bawaan BFR disembunyikan, diganti SATU kartu milik kita sendiri:
// kekuatan sinyal (bar + %), identitas sel, lock band, rotasi IP.
// Semua angka ditulis ke elemen milik kita -> tidak ada yang menimpa, tidak ada info dobel.
(function () {
	const BANDS = ['B1', 'B3', 'B4', 'B5', 'B7', 'B8', 'B20', 'B40', 'B41'];
	const ID = 'mm-page';
	const HIDE = 'mm-hide'; // penanda anak halaman bawaan yang disembunyikan
	let busy = false;
	const last = { cell: null, sig: null, bands: null, rot: null };

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

	function leaf(rx) {
		return [...document.querySelectorAll('div,span,td,p,strong,h2,h3,h4,button')]
			.find(e => e.children.length <= 2 && rx.test((e.textContent || '').trim()));
	}

	// wadah isi halaman = elemen yang memuat judul halaman DAN tombol "Refresh All"
	// (jangan naik sampai ke bingkai aplikasi: di situ ada menu atas)
	function pageBody() {
		const head = leaf(/cellular & radio telemetry/i) || leaf(/signal & radio/i);
		if (!head) return null;
		let el = head;
		for (let i = 0; i < 6; i++) {
			if (!el.parentElement) break;
			el = el.parentElement;
			if (/refresh all/i.test((el.textContent || ''))) break;
		}
		return el;
	}

	const esc = v => (v == null || v === '' ? '-' : String(v));

	function build() {
		const b = Math.round(Number(last.sig && last.sig.signal_pct) || 0);
		const warna = b >= 70 ? '#34d399' : b >= 45 ? '#fbbf24' : b >= 20 ? '#fb923c' : '#f87171';
		const label = b >= 70 ? 'kuat' : b >= 45 ? 'sedang' : b >= 20 ? 'lemah' : 'sangat lemah';
		const c = last.cell || {};
		const s = last.sig || {};
		const kotak = (k, v) =>
			`<div style="background:#10141d;border:1px solid #272e3c;border-radius:7px;padding:7px 9px">
			   <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8b93a5">${k}</div>
			   <div style="font-weight:700" data-f="${k}">${esc(v)}</div></div>`;

		const el = document.createElement('section');
		el.id = ID;
		el.style.cssText = 'margin:14px 0;padding:16px 18px;border:1px solid #272e3c;border-radius:12px;background:#141822;color:#e8eaf0;font:12px/1.6 ui-monospace,monospace';
		el.innerHTML = `
		  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
		    <strong style="letter-spacing:.14em;text-transform:uppercase;font-size:12px;color:#c8cdda">Modem LTE</strong>
		    <span id="mm-status" style="color:#8b93a5;font-size:11px">memuat…</span>
		  </div>

		  <div style="margin-bottom:14px">
		    <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8b93a5;margin-bottom:7px">Jaringan &amp; SIM</div>
		    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px">
		      ${kotak('Band', c.band || c.pband)}
		      ${kotak('IP modem', c.ip)}
		      ${kotak('Gateway', c.gateway)}
		      ${kotak('DNS', c.dns)}
		      ${kotak('IMEI', s.imei)}
		      ${kotak('Registrasi', s.registration)}
		      ${kotak('Data (PS)', s.ps_state)}
		    </div>
		  </div>

		  <div style="border-top:1px dashed #272e3c;padding-top:12px;margin-bottom:12px">
		    <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8b93a5;margin-bottom:7px">Lock band LTE</div>
		    <div id="mm-bands" style="display:flex;flex-wrap:wrap;gap:10px"></div>
		    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
		      <button id="mm-lock" style="background:#5b21b6;border:0;color:#fff;border-radius:7px;padding:8px 13px;font:600 11px ui-monospace,monospace;cursor:pointer">Kunci band terpilih</button>
		      <button id="mm-auto" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:8px 13px;font:600 11px ui-monospace,monospace;cursor:pointer">Lepas lock (auto)</button>
		      <span id="mm-bandaktif" style="color:#8b93a5;font-size:10.5px"></span>
		    </div>
		  </div>

		  <div style="border-top:1px dashed #272e3c;padding-top:12px">
		    <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8b93a5;margin-bottom:7px">Ganti IP saat internet bengong</div>
		    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
		      <select id="mm-mins" style="background:#1a1f2b;border:1px solid #2c3444;color:#e8eaf0;border-radius:7px;padding:7px 9px;font:12px ui-monospace,monospace">
		        <option value="0">Mati</option><option value="5">tiap 5 menit</option>
		        <option value="15">tiap 15 menit</option><option value="30">tiap 30 menit</option>
		      </select>
		      <button id="mm-save" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:8px 13px;font:600 11px ui-monospace,monospace;cursor:pointer">Simpan</button>
		      <button id="mm-ipnow" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:8px 13px;font:600 11px ui-monospace,monospace;cursor:pointer">Ganti IP sekarang</button>
		      <button id="mm-reboot" style="background:#2a1216;border:1px solid #5a2330;color:#fca5a5;border-radius:7px;padding:8px 13px;font:600 11px ui-monospace,monospace;cursor:pointer">Reboot modem</button>
		      <button id="mm-soft" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:7px;padding:8px 13px;font:600 11px ui-monospace,monospace;cursor:pointer">Reset ringan</button>
		    </div>
		    <div style="color:#8b93a5;font-size:10.5px;margin-top:9px">Rotasi IP bertingkat: cek 60 s, gagal 3× → sesi ulang → RF → modem restart → reboot.</div>
		  </div>`;

		const bands = el.querySelector('#mm-bands');
		BANDS.forEach(nm => {
			const l = document.createElement('label');
			l.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11.5px';
			l.innerHTML = `<input type="checkbox" value="${nm.slice(1)}" style="accent-color:#6d28d9"> ${nm}`;
			bands.appendChild(l);
		});

		el.querySelector('#mm-lock').onclick = () => {
			const sel = [...el.querySelectorAll('#mm-bands input:checked')].map(i => 'eutran-' + i.value);
			if (!sel.length) return say('Pilih minimal satu band dulu');
			act('lock', { bands: sel }, 'Mengunci band… (±60–90 s)');
		};
		el.querySelector('#mm-auto').onclick = () => act('lock', { auto: true }, 'Melepas lock band…');
		el.querySelector('#mm-save').onclick = () => act('rotate', { mins: parseInt(el.querySelector('#mm-mins').value, 10) }, 'Menyimpan pengaturan');
		el.querySelector('#mm-ipnow').onclick = () => act('action', { action: 'ipnow' }, 'Mengulang sesi LTE…');
		el.querySelector('#mm-reboot').onclick = () => act('action', { action: 'rebootmodem' }, 'Reboot modem MSS…');
		el.querySelector('#mm-soft').onclick = () => act('action', { action: 'softreset' }, 'Reset ringan…');
		return el;
	}

	// bar kekuatan sinyal disisipkan ke kartu bawaan "Cellular Radio Signal"
	// (tepat di bawah judul, sebelum kotak RSRP/RSRQ/SINR)
	function cardOf(rx) {
		const head = leaf(rx);
		if (!head) return null;
		let card = head;
		for (let i = 0; i < 12; i++) {
			const cs = getComputedStyle(card);
			if ((parseFloat(cs.borderTopWidth) || 0) > 0 && (parseFloat(cs.borderTopLeftRadius) || 0) > 3) return card;
			if (!card.parentElement) break;
			card = card.parentElement;
		}
		return null;
	}

	function barBawaan() {
		if (!onModem()) return;
		const card = cardOf(/^cellular radio signal$/i);
		if (!card || document.getElementById('mm-bar')) return;
		const el = document.createElement('div');
		el.id = 'mm-bar';
		el.style.cssText = 'padding:2px 0 10px';
		el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b93a5;margin-bottom:5px">
		    <span>Kekuatan sinyal</span><span id="mm-bar-pct" style="color:#8b93a5;font-weight:800">-</span></div>
		  <div style="height:13px;background:#10141d;border:1px solid #272e3c;border-radius:8px;overflow:hidden">
		    <div id="mm-bar-fill" style="height:100%;width:0%;background:#8b93a5;transition:width .5s ease"></div></div>`;
		const petak = [...card.querySelectorAll('*')].find(e => e.children.length <= 2 && /rsrp \(power\)/i.test((e.textContent || '').trim()));
		let atas = petak;
		while (atas && atas.parentElement && atas.parentElement !== card) atas = atas.parentElement;
		if (atas && atas.parentElement === card) card.insertBefore(el, atas);
		else card.appendChild(el);
	}

	function say(msg) {
		const s = document.getElementById('mm-status');
		if (s) s.textContent = msg;
	}

	function fill() {
		const el = document.getElementById(ID);
		if (!el) return;
		const c = last.cell || {}, s = last.sig || {};
		const set = (k, v) => {
			const box = el.querySelector('[data-f="' + k + '"]');
			if (!box) return;
			const t = (v == null || v === '') ? '-' : String(v);
			if (box.textContent !== t) box.textContent = t;
		};
		set('Mode', s.network_type);
		set('Band', c.band || c.pband);
		set('IP modem', c.ip);
		set('Gateway', c.gateway);
		set('DNS', c.dns);
		set('IMEI', s.imei);
		set('Registrasi', s.registration);
		set('Data (PS)', s.ps_state);

		const b = Math.round(Number(s.signal_pct) || 0);
		const warna = b >= 70 ? '#34d399' : b >= 45 ? '#fbbf24' : b >= 20 ? '#fb923c' : '#f87171';
		const label = b >= 70 ? 'kuat' : b >= 45 ? 'sedang' : b >= 20 ? 'lemah' : 'sangat lemah';
		const f = el.querySelector('#mm-fill'), p = el.querySelector('#mm-pct');
		const f2 = document.getElementById('mm-bar-fill'), p2 = document.getElementById('mm-bar-pct');
		if (f2) { f2.style.width = b + '%'; f2.style.background = warna; }
		if (p2) { p2.textContent = b + '% · ' + label; p2.style.color = warna; }
		if (f) { f.style.width = b + '%'; f.style.background = warna; }
		if (p) { p.textContent = b + '% · ' + label; p.style.color = warna; }

		const bd = last.bands;
		if (bd) {
			const aktif = (bd.active || []).map(x => String(x).replace(/^B/i, ''));
			el.querySelectorAll('#mm-bands input').forEach(i => { i.checked = aktif.indexOf(i.value) >= 0; });
			const info = el.querySelector('#mm-bandaktif');
			if (info) info.textContent = bd.locked
				? 'Lock aktif: ' + (bd.selected_bands || []).join(', ')
				: (aktif.length ? 'Band aktif (auto): ' + aktif.map(x => 'B' + x).join(' ') : '');
		}
		const sel = el.querySelector('#mm-mins');
		if (sel && last.rot) sel.value = String(last.rot.mins || 0);
	}

	// setiap panggilan diberi batas waktu: satu endpoint lambat tidak boleh membuat
	// seluruh kartu tetap kosong ("memuat…")
	const batas = (p, ms) => Promise.race([
		p.catch(() => null),
		new Promise(r => setTimeout(() => r(null), ms))
	]);

	async function load() {
		if (!onModem()) return;
		try {
			const c = await batas(api('/api/modem/cell'), 8000);
			const s = await batas(api('/api/modem/signal'), 8000);
			if (c) last.cell = c;
			if (s) last.sig = s;
			barBawaan();
			fill();
			say('diperbarui ' + new Date().toLocaleTimeString('id-ID', { hour12: false }) +
				(last.rot && last.rot.mins ? ' • rotasi ' + last.rot.mins + ' mnt' : ' • rotasi mati'));

			// data tambahan (lebih lambat) menyusul, tanpa menahan tampilan
			batas(api('/api/modem/bands'), 20000).then(b => { if (b) { last.bands = b; fill(); } });
			batas(api('/api/modem/rotate'), 8000).then(r => { if (r) { last.rot = r; fill(); } });
		} catch (e) { say('gagal memuat: ' + e.message); }
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
		setTimeout(load, 2500);
	}

	// isi bawaan halaman tetap tampil (kartunya terisi sendiri dari adaptor);
	// kita hanya MENAMBAH: bar kekuatan sinyal di kartu bawaan + kartu kontrol di bawahnya.
	function mount() {
		if (!onModem()) {
			const old = document.getElementById(ID);
			if (old) old.remove();
			const bar = document.getElementById('mm-bar');
			if (bar) bar.remove();
			return;
		}
		// kartu dipasang di wadah utama aplikasi (bukan di dalam isi halaman yang
		// suka digambar ulang Svelte) supaya tidak pernah ikut terhapus
		const host = document.querySelector('main') || document.body;
		let el = document.getElementById(ID);
		if (!el) {
			el = build();
			host.appendChild(el);
			load();
		} else if (el.parentElement !== host) {
			host.appendChild(el);
		}
		barBawaan(); // bar di kartu "Cellular Radio Signal"
	}

	setInterval(() => { if (onModem()) load(); }, 10000); // nilai sinyal tiap 10 detik
	// halaman digambar ulang oleh Svelte -> coba pasang lagi secara berkala
	setInterval(() => {
		if (!onModem()) return;
		if (!document.getElementById(ID)) mount();
		if (!document.getElementById('mm-bar')) barBawaan();
	}, 1500);
	new MutationObserver(() => { if (onModem() && (!document.getElementById(ID) || !document.getElementById('mm-bar'))) mount(); })
		.observe(document.body, { childList: true, subtree: true });
	function pasang() {
		if (!onModem()) return;
		mount();
		[300, 1000, 2500, 5000].forEach(t => setTimeout(() => { if (onModem() && !document.getElementById(ID)) mount(); }, t));
	}
	document.addEventListener('DOMContentLoaded', pasang);
	window.addEventListener('hashchange', pasang);
	document.addEventListener('visibilitychange', () => { if (!document.hidden) pasang(); });
	if (document.readyState !== 'loading') pasang();
})();
