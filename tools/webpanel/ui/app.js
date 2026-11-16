let D = null;
let PAGE = (location.hash || '#ringkasan').replace('#', '') || 'ringkasan';
const T = { ringkasan: 'Ringkasan', sistem: 'Sistem', tentang: 'Tentang', seluler: 'Seluler (LTE)', wifi: 'WiFi / AP', layanan: 'Layanan' };
const $ = s => document.querySelector(s);
const HISTORY = {}; // 40 sampel terakhir untuk sparkline

function esc(v) {
  return String(v == null || v === '' ? '-' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- navigasi dropdown ---------- */
document.querySelectorAll('.navgroup').forEach(g => {
  const btn = g.querySelector('.navbtn');
  btn.onclick = e => {
    e.stopPropagation();
    const open = g.classList.contains('open');
    document.querySelectorAll('.navgroup').forEach(x => x.classList.remove('open'));
    if (!open) g.classList.add('open');
  };
});
document.addEventListener('click', () => document.querySelectorAll('.navgroup').forEach(x => x.classList.remove('open')));
document.querySelectorAll('.drop a[data-p]').forEach(a => {
  a.onclick = () => {
    PAGE = a.dataset.p;
    document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('on'));
    a.closest('.navgroup').querySelector('.navbtn').classList.add('on');
    gambar();
  };
});
$('#theme').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('panel-theme', next);
};
if (localStorage.getItem('panel-theme')) document.documentElement.setAttribute('data-theme', localStorage.getItem('panel-theme'));
$('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };

/* ---------- api ---------- */
async function api(url, opt) {
  const r = await fetch(url, opt);
  if (r.status === 401) { location.reload(); throw new Error('sesi habis'); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function muat(manual) {
  try {
    D = await api('/api/status');
  } catch (e) {
    toast('Gagal memuat: ' + e.message);
    return;
  }
  const s = D.sys, n = D.net;
  $('#ver').textContent = 'panel ' + D.panel.version + ' • :' + (D.panel.port || '8081');

  push('cpu', s.cpu);
  push('mem', Math.round(100 * s.mem_used / (s.mem_total || 1)));
  push('disk', Math.round(100 * s.disk_used / (s.disk_total || 1)));
  push('sig', sinyal());

  $('#chips').innerHTML =
    `<span class="chip ${n.internet ? 'ok' : 'bad'}"><span class="dot"></span><b>${n.internet ? 'online' : 'offline'}</b></span>` +
    `<span class="chip ${parseFloat(s.temp) > 70 ? 'warn' : ''}">${esc(s.temp)}°C</span>` +
    `<span class="chip">IP LTE <b>${esc(n.wwan_ip)}</b></span>` +
    `<span class="chip">Up <b>${esc(s.uptime)}</b></span>`;
  gambar();
  if (manual) toast('Data diperbarui');
}

function push(k, v) {
  if (v == null || isNaN(v)) return;
  (HISTORY[k] = HISTORY[k] || []).push(Number(v));
  if (HISTORY[k].length > 40) HISTORY[k].shift();
}
function sinyal() {
  const r = parseFloat(D && D.lte && D.lte.rsrp);
  if (isNaN(r)) return 0;
  return Math.max(0, Math.min(100, Math.round((r + 120) * 100 / 50))); // -120..-70 dBm
}

/* ---------- komponen ---------- */
function metric(o) {
  return `<div class="metric ${o.cls || ''}">
    <div class="head"><span>${esc(o.label)}</span><span>${esc(o.right || '')}</span></div>
    <div class="big">${esc(o.value)}${o.unit ? '<small>' + esc(o.unit) + '</small>' : ''}</div>
    <div class="sub">${esc(o.sub || '')}</div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(o.pct || 0)}"><i style="width:${Math.max(0, Math.min(100, o.pct || 0))}%"></i></div>
    ${spark(o.key)}
  </div>`;
}
function spark(key) {
  const h = HISTORY[key] || [];
  if (h.length < 2) return '<svg class="spark"></svg>';
  const max = Math.max(1, ...h), min = Math.min(...h);
  const pts = h.map((v, i) => {
    const x = (i / (h.length - 1)) * 100;
    const y = 32 - ((v - min) / Math.max(1, max - min)) * 28;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/></svg>`;
}
function fmtMB(mb) {
  if (mb == null) return '-';
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
}
function row(a, b) { return `<div><span>${esc(a)}</span><span class="mono">${esc(b)}</span></div>`; }
function pill(cls, text) { return `<span class="pill ${cls}"><span class="dot"></span>${esc(text)}</span>`; }
function shortcut(ic, nm, ds, href) {
  return `<a class="shortcut" href="${href}" target="_blank"><div class="ic">${ic}</div>
    <div><div class="nm">${esc(nm)}</div><div class="ds">${esc(ds)}</div></div></a>`;
}

/* ---------- halaman ---------- */
function gambar() {
  const v = $('#view');
  if (!D) return;
  const s = D.sys, n = D.net, l = D.lte, w = D.wifi;
  const memPct = Math.round(100 * s.mem_used / (s.mem_total || 1));
  const diskPct = Math.round(100 * s.disk_used / (s.disk_total || 1));

  if (PAGE === 'ringkasan') {
    v.innerHTML =
      '<div class="grid4">' +
      metric({ label: 'Beban CPU', value: s.cpu, unit: '%', sub: 'beban ' + s.load, pct: s.cpu, key: 'cpu', cls: 'violet' }) +
      metric({ label: 'Memori', value: memPct, unit: '%', sub: fmtMB(s.mem_used) + ' / ' + fmtMB(s.mem_total), pct: memPct, key: 'mem', cls: 'violet' }) +
      metric({ label: 'Penyimpanan', value: diskPct, unit: '%', sub: fmtMB(s.disk_used) + ' / ' + fmtMB(s.disk_total), pct: diskPct, key: 'disk', cls: 'ice' }) +
      metric({ label: 'Sinyal LTE', value: sinyal(), unit: '%', sub: 'RSRP ' + l.rsrp + ' • ' + (l.operator || '-'), pct: sinyal(), key: 'sig', cls: 'mint', right: esc(l.ps || '') }) +
      '</div>' +
      '<div class="panelbox"><h3>Pintasan aplikasi</h3><div class="body"><div class="shortcuts">' +
      shortcut('L', 'LuCI', 'antarmuka OpenWrt', '/cgi-bin/luci/') +
      shortcut('T', 'Terminal', 'ttyd root shell', 'http://192.168.42.1:7681') +
      shortcut('B', 'Bandix', 'pemakaian data', 'http://192.168.42.1:8686') +
      shortcut('A', 'AdGuard', 'DNS & filter', 'http://192.168.42.1:3000') +
      shortcut('P', 'OpenClash', 'panel proxy', 'http://192.168.42.1:9090') +
      '</div></div></div>' +
      '<div class="panelbox"><h3>Status layanan</h3><table><tbody>' +
      D.services.slice(0, 6).map(x =>
        '<tr><td class="mono">' + esc(x.name) + '</td><td style="width:120px">' +
        pill(x.state === 'jalan' ? 'ok' : (x.state === 'mati' ? 'bad' : ''), x.state) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  if (PAGE === 'sistem') {
    v.innerHTML = '<div class="panelbox"><h3>Perangkat</h3><div class="body"><div class="kv">' +
      row('Host', s.host) + row('Kernel', s.kernel) + row('Distro', s.version) +
      row('Uptime', s.uptime) + row('Beban', s.load) + row('Suhu', s.temp + '°C') +
      row('Memori', fmtMB(s.mem_used) + ' / ' + fmtMB(s.mem_total)) + row('Penyimpanan', fmtMB(s.disk_used) + ' / ' + fmtMB(s.disk_total)) +
      row('Panel', D.panel.version + ' di port ' + (D.panel.port || '8081')) +
      '</div></div></div>';
  }

  if (PAGE === 'tentang') {
    v.innerHTML = '<div class="panelbox"><h3>Tentang panel</h3><div class="body"><div class="kv">' +
      row('Panel', 'OpenWrt Control Panel ' + D.panel.version) +
      row('Perangkat', s.host + ' (MSM8917)') +
      row('LuCI', 'port 80, tidak diubah') +
      row('Sumber', 'tools/webpanel (Go, stdlib)') +
      row('Jalur data', 'mmcli, uci, rolex-*, /proc, /sys') +
      row('IP USB', n.usb_ip) + row('IP WiFi', n.wifi_ip) + row('IP LTE', n.wwan_ip) +
      '</div></div></div>';
  }

  if (PAGE === 'seluler') {
    v.innerHTML =
      '<div class="grid4">' +
      metric({ label: 'RSRP', value: l.rsrp, sub: 'sinyal utama', pct: sinyal(), key: 'sig', cls: 'mint' }) +
      metric({ label: 'SINR', value: l.sinr, sub: 'kualitas sinyal', pct: Math.max(0, Math.min(100, (parseFloat(l.sinr) || 0) * 5)), cls: 'ice' }) +
      metric({ label: 'Trafik turun', value: n.rx, sub: 'antarmuka usb0', pct: 0, cls: 'violet' }) +
      metric({ label: 'Trafik naik', value: n.tx, sub: 'antarmuka usb0', pct: 0, cls: 'peach' }) +
      '</div>' +
      '<div class="panelbox"><h3>Informasi LTE <span class="tag ice">QMI</span></h3><div class="body"><div class="kv">' +
      row('Operator', l.operator) + row('Status', (l.state || '') + ' / ' + (l.ps || '')) + row('RAT', l.network) +
      row('RSSI', l.rssi) + row('RSRQ', l.rsrq) + row('Cell ID', l.cell) + row('TAC', l.tac) +
      row('PLMN', l.plmn) + row('APN', l.apn) + row('IP', n.wwan_ip) + row('Denyut penjaga', n.beat >= 0 ? n.beat + ' s lalu' : '-') +
      '</div></div></div>' +
      '<div class="panelbox"><h3>Aksi modem</h3><div class="body actions">' +
      '<button class="btn primary" data-api="/api/modem" data-act="reconnect">Sambung ulang</button>' +
      '<button class="btn" data-api="/api/modem" data-act="restart">Restart layanan LTE</button>' +
      '<button class="btn danger" data-api="/api/modem" data-act="reset">Pemulihan bertingkat</button>' +
      '</div></div>';
  }

  if (PAGE === 'wifi') {
    const kl = w.clients || [];
    v.innerHTML =
      '<div class="panelbox"><h3>Access point</h3><div class="body"><div class="kv">' +
      row('SSID', w.ssid) + row('Status', w.state) + row('Enkripsi', w.encryption) +
      row('Kanal', w.channel) + row('IP', w.ip) + row('Klien', kl.length) +
      '</div></div></div>' +
      '<div class="panelbox"><h3>Klien terhubung (' + kl.length + ')</h3>' +
      '<table><thead><tr><th>MAC</th><th>Signal</th><th>RX</th><th>TX</th><th>Terhubung</th></tr></thead><tbody>' +
      (kl.length ? kl.map(c =>
        '<tr><td class="mono">' + esc(c.mac) + '</td><td class="mono">' + esc(c.signal) + '</td><td>' +
        esc(c['rx bitrate']) + '</td><td>' + esc(c['tx bitrate']) + '</td><td>' + esc(c['connected time']) + '</td></tr>').join('')
        : '<tr><td colspan="5" style="color:var(--muted)">belum ada klien</td></tr>') +
      '</tbody></table></div>' +
      '<div class="panelbox"><h3>Aksi WiFi</h3><div class="body actions">' +
      '<button class="btn primary" data-api="/api/wifi" data-act="apply">Terapkan pengaturan UCI</button>' +
      '<button class="btn" data-api="/api/wifi" data-act="restart">Restart AP</button>' +
      '<a class="btn" href="/cgi-bin/luci/admin/network/wireless" target="_blank">Edit di LuCI</a>' +
      '</div></div>';
  }

  if (PAGE === 'layanan') {
    v.innerHTML = '<div class="panelbox"><h3>Layanan init</h3><table><thead><tr><th>Layanan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' +
      D.services.map(x => {
        const jalan = x.state === 'jalan';
        return '<tr><td class="mono">' + esc(x.name) + '</td>' +
          '<td style="width:110px">' + pill(jalan ? 'ok' : (x.state === 'mati' ? 'bad' : ''), x.state) + '</td>' +
          '<td><div class="actions">' +
          '<button class="btn" data-svc="' + esc(x.name) + '" data-act="start"' + (jalan ? ' disabled' : '') + '>Start</button>' +
          '<button class="btn" data-svc="' + esc(x.name) + '" data-act="restart"' + (jalan ? '' : ' disabled') + '>Restart</button>' +
          '<button class="btn danger" data-svc="' + esc(x.name) + '" data-act="stop"' + (jalan ? '' : ' disabled') + '>Stop</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  v.querySelectorAll('[data-api]').forEach(b => {
    b.onclick = () => aksi(b.dataset.api, { action: b.dataset.act }, b);
  });
  v.querySelectorAll('[data-svc]').forEach(b => {
    b.onclick = () => aksi('/api/service', { name: b.dataset.svc, action: b.dataset.act }, b);
  });
}

async function aksi(url, body, btn) {
  const t = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const r = await api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
      body: JSON.stringify(body)
    });
    toast((r.out || 'selesai').slice(0, 600));
  } catch (e) {
    toast('Gagal: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = t;
  setTimeout(() => muat(false), 1800);
}

function toast(msg) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 6000);
}

muat(false);
setInterval(() => muat(false), 15000);
window.addEventListener('hashchange', () => {
  PAGE = (location.hash || '#ringkasan').replace('#', '');
  gambar();
});