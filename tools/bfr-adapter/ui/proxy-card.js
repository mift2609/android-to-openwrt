// Kartu "Mesin Proxy" untuk halaman #proxy: OpenClash & Nikki/Mihomo
// (status, profil, port, tombol mulai/stop/ulang, tautan ke halaman LuCI-nya).
// Kartu ini berdiri sendiri; isi bawaan halaman tidak diubah.
(function () {
	const ID = 'proxy-engine-card';
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

	function build() {
		const el = document.createElement('section');
		el.id = ID;
		el.style.cssText = 'margin:14px 0;padding:14px 16px;border:1px solid #272e3c;border-radius:10px;background:#141822;color:#e8eaf0;font:12px/1.6 ui-monospace,monospace';
		el.innerHTML = `
		  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">
		    <strong style="letter-spacing:.12em;text-transform:uppercase;font-size:11px;color:#c8cdda">Mesin Proxy</strong>
		    <span id="px-status" style="color:#8b93a5;font-size:11px">memuat…</span>
		  </div>
		  <div id="px-list" style="display:grid;gap:10px"></div>`;
		return el;
	}

	function kartu(e) {
		const nyala = !!e.running;
		const warna = nyala ? '#34d399' : '#8b93a5';
		const detail = [];
		if (e.mode) detail.push('mode ' + e.mode);
		if (e.profile) detail.push('profil ' + e.profile);
		if (e.config) detail.push('config ' + e.config);
		if (e.ports && e.ports.mixed) detail.push('port ' + [e.ports.http, e.ports.socks, e.ports.mixed].filter(Boolean).join('/'));
		return `
		  <div style="border:1px solid #272e3c;border-radius:8px;padding:10px 12px;background:#10141d">
		    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
		      <div>
		        <div style="font-weight:700">${e.name}
		          <span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${warna}">${nyala ? '● jalan' : '○ mati'}</span>
		          ${e.enabled ? '<span style="font-size:10px;color:#8b93a5">(ikut boot)</span>' : ''}
		        </div>
		        <div style="color:#8b93a5;font-size:11px">${e.installed ? (detail.join(' · ') || 'terpasang') : 'tidak terpasang'}</div>
		      </div>
		      <div style="display:flex;gap:6px;flex-wrap:wrap">
		        <button data-engine="${e.key}" data-act="start" style="background:#5b21b6;border:0;color:#fff;border-radius:6px;padding:6px 11px;font:600 11px ui-monospace,monospace;cursor:pointer">Mulai</button>
		        <button data-engine="${e.key}" data-act="stop" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:6px;padding:6px 11px;font:600 11px ui-monospace,monospace;cursor:pointer">Stop</button>
		        <button data-engine="${e.key}" data-act="restart" style="background:#272c38;border:1px solid #3a4152;color:#e8eaf0;border-radius:6px;padding:6px 11px;font:600 11px ui-monospace,monospace;cursor:pointer">Ulang</button>
		        <a href="${e.luci}" style="background:#1a1f2b;border:1px solid #2c3444;color:#c8cdda;border-radius:6px;padding:6px 11px;font:600 11px ui-monospace,monospace;text-decoration:none">LuCI</a>
		      </div>
		    </div>
		  </div>`;
	}

	function say(m) {
		const s = document.getElementById('px-status');
		if (s) s.textContent = m;
	}

	async function load() {
		const el = document.getElementById(ID);
		if (!el) return;
		try {
			const d = await api('/api/proxy/engine');
			const list = el.querySelector('#px-list');
			if (list) list.innerHTML = (d.engines || []).map(kartu).join('') || '<div style="color:#8b93a5">tidak ada mesin proxy terpasang</div>';
			const nyala = (d.engines || []).filter(e => e.running).map(e => e.name);
			say(nyala.length ? 'aktif: ' + nyala.join(', ') : 'keduanya mati');
			list.querySelectorAll('button[data-engine]').forEach(b => {
				b.onclick = () => act(b.getAttribute('data-engine'), b.getAttribute('data-act'));
			});
		} catch (e) { say('gagal memuat: ' + e.message); }
	}

	async function act(engine, act) {
		if (busy) return;
		busy = true;
		say(act + ' ' + engine + '…');
		try {
			const r = await post('/api/proxy/engine/action', { engine: engine, action: act });
			say(r.message || r.error || 'selesai');
		} catch (e) { say('gagal: ' + e.message); }
		busy = false;
		setTimeout(load, 6000);
		setTimeout(load, 20000);
	}

	function mount() {
		if (!onProxy()) {
			const old = document.getElementById(ID);
			if (old) old.remove();
			return;
		}
		const host = document.querySelector('main') || document.body;
		let el = document.getElementById(ID);
		if (!el) {
			el = build();
			host.appendChild(el);
			load();
		} else if (el.parentElement !== host) {
			host.appendChild(el);
		}
	}

	setInterval(() => {
		if (!onProxy()) {
			const c = document.getElementById(ID);
			if (c) c.remove();
			return;
		}
		if (!document.getElementById(ID)) mount();
	}, 1200);
	setInterval(() => { if (onProxy()) load(); }, 15000);
	document.addEventListener('DOMContentLoaded', mount);
	window.addEventListener('hashchange', () => { mount(); setTimeout(mount, 1200); });
	if (document.readyState !== 'loading') mount();
})();