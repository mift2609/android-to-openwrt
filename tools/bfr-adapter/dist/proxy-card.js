// build 261117-2242
// Halaman #proxy: dua aplikasi terpisah seperti di LuCI —
// OpenClash sendiri, Nikki/Mihomo sendiri. Masing-masing punya kartu, status,
// tombol mulai/stop/ulang, dan tautan ke halaman LuCI-nya.
// Isi bawaan halaman BFR tidak diubah; kartu ini berdiri sendiri.
(function () {
	const WADAH = 'proxy-apps';
	const PREFIX = 'px-app-';
	const onProxy = () => (location.hash || '').indexOf('#proxy') === 0
		&& !document.querySelector('input[type=password]');
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

	const kartuEl = key => document.getElementById(PREFIX + key);

	function say(key, m) {
		const el = kartuEl(key);
		const s = el && el.querySelector('[data-status]');
		if (s) s.textContent = m;
	}

	// kerangka kartu satu aplikasi
	function kerangka(e) {
		const el = document.createElement('section');
		el.id = PREFIX + e.key;
		el.setAttribute('data-app', e.key);
		el.style.cssText = 'margin:14px 0;padding:14px 16px;border:1px solid #272e3c;border-radius:10px;background:#141822;color:#e8eaf0;font:12px/1.6 ui-monospace,monospace';
		el.innerHTML = `
		  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
		    <strong style="letter-spacing:.12em;text-transform:uppercase;font-size:11px;color:#c8cdda">${e.name}</strong>
		    <span data-status style="color:#8b93a5;font-size:11px">memuat…</span>
		  </div>
		  <div data-body></div>`;
		return el;
	}

	// isi kartu: keterangan + tombol
	function isi(e) {
		const detail = [];
		if (e.mode) detail.push('mode ' + e.mode);
		if (e.profile) detail.push('profil ' + e.profile);
		if (e.config) detail.push('config ' + e.config);
		if (e.binary) detail.push('inti ' + e.binary);
		if (e.ports && e.ports.mixed) detail.push('port ' + [e.ports.http, e.ports.socks, e.ports.mixed].filter(Boolean).join('/'));
		const btn = (act, label, gaya) =>
			`<button data-engine="${e.key}" data-act="${act}" style="${gaya}">${label}</button>`;
		const abu = 'background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:6px;padding:6px 11px;font:600 11px ui-monospace,monospace;cursor:pointer';
		return `
		  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
		    <div style="color:#8b93a5;font-size:11px;line-height:1.6">
		      ${e.installed ? (detail.join(' · ') || 'terpasang') : 'tidak terpasang'}
		      ${e.enabled ? '<br>ikut dinyalakan saat boot' : ''}
		    </div>
		    <div style="display:flex;gap:6px;flex-wrap:wrap">
		      ${btn('start', 'Mulai', 'background:#5b21b6;border:0;color:#fff;border-radius:6px;padding:6px 11px;font:600 11px ui-monospace,monospace;cursor:pointer')}
		      ${btn('stop', 'Stop', abu)}
		      ${btn('restart', 'Ulang', abu)}
		      <a href="${e.luci}" style="background:#1a1f2b;border:1px solid #2c3444;color:#c8cdda;border-radius:6px;padding:6px 11px;font:600 11px ui-monospace,monospace;text-decoration:none">Buka di LuCI</a>
		    </div>
		  </div>`;
	}

	async function load() {
		const wadah = document.getElementById(WADAH);
		if (!wadah) return;
		try {
			const d = await api('/api/proxy/engine');
			for (const e of (d.engines || [])) {
				let card = kartuEl(e.key);
				if (!card) {
					card = kerangka(e);
					wadah.appendChild(card);
				}
				const body = card.querySelector('[data-body]');
				if (body) body.innerHTML = isi(e);
				say(e.key, e.running ? '● jalan' : '○ mati');
				body.querySelectorAll('button[data-engine]').forEach(b => {
					b.onclick = () => act(b.getAttribute('data-engine'), b.getAttribute('data-act'));
				});
			}
		} catch (e) { say('', 'gagal memuat: ' + e.message); }
	}

	async function act(engine, action) {
		if (busy) return;
		busy = true;
		say(engine, action + '…');
		try {
			const r = await post('/api/proxy/engine/action', { engine: engine, action: action });
			say(engine, r.message || r.error || 'selesai');
		} catch (e) { say(engine, 'gagal: ' + e.message); }
		busy = false;
		setTimeout(load, 6000);
		setTimeout(load, 20000);
	}

	function mount() {
		if (!onProxy()) {
			document.querySelectorAll('[data-app], #' + WADAH).forEach(e => e.remove());
			return;
		}
		const host = document.querySelector('main') || document.body;
		let wadah = document.getElementById(WADAH);
		if (!wadah) {
			wadah = document.createElement('div');
			wadah.id = WADAH;
			host.appendChild(wadah);
			load();
		} else if (wadah.parentElement !== host) {
			host.appendChild(wadah);
		}
	}

	setInterval(() => {
		if (!onProxy()) {
			document.querySelectorAll('[data-app], #' + WADAH).forEach(e => e.remove());
			return;
		}
		if (!document.getElementById(WADAH)) mount();
	}, 1200);
	setInterval(() => { if (onProxy()) load(); }, 15000);
	document.addEventListener('DOMContentLoaded', mount);
	window.addEventListener('hashchange', () => { mount(); setTimeout(mount, 1200); });
	if (document.readyState !== 'loading') mount();
})();