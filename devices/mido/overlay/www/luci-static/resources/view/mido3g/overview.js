'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var callStatus    = rpc.declare({ object: 'mido3g', method: 'status' });
var callApnSet    = rpc.declare({ object: 'mido3g', method: 'apn_set', params: [ 'apn', 'username', 'password', 'iptype' ] });
var callReconnect = rpc.declare({ object: 'mido3g', method: 'reconnect' });
var callRestart   = rpc.declare({ object: 'mido3g', method: 'modem_restart' });
var callSimSwitch = rpc.declare({ object: 'mido3g', method: 'sim_switch', params: [ 'slot' ] });
var callSimPower  = rpc.declare({ object: 'mido3g', method: 'sim_power', params: [ 'action' ] });
var callLogs      = rpc.declare({ object: 'mido3g', method: 'logs' });
var callPower     = rpc.declare({ object: 'mido3g', method: 'power' });

var PRESET = [
	[ 'Telkomsel',        'internet',    '',          '' ],
	[ 'XL / Axis',        'internet',    '',          '' ],
	[ 'Indosat / IM3',    'indosatgprs', '',          '' ],
	[ 'Tri (3)',          '3gprs',       '',          '' ],
	[ 'Smartfren',        'Smartfren4G', 'smartfren', 'smartfren' ],
	[ 'by.U',             'internet',    '',          '' ]
];

var qroot = null;   /* subtree halaman, dipakai sebelum node menempel di DOM */

function txt(id, v) {
	var el = qroot ? qroot.querySelector('#' + id) : null;
	if (el && v != null && v !== '')
		el.textContent = v;
}

function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

/* 5 bar dari RSRP: >-80 bagus sekali, <-110 jelek */
function bars(rsrp) {
	var r = num(rsrp), lvl = 0;
	if (r != null)
		lvl = r >= -80 ? 5 : r >= -90 ? 4 : r >= -100 ? 3 : r >= -110 ? 2 : 1;
	return lvl;
}

function barEl() {
	var wrap = E('div', { 'style': 'display:inline-flex;align-items:flex-end;gap:3px;height:26px;vertical-align:middle' });
	for (var i = 1; i <= 5; i++) {
		var h = 6 + i * 4;
		wrap.appendChild(E('div', {
			'id': 'bar' + i,
			'style': 'width:7px;height:' + h + 'px;border-radius:2px;background:#ccc'
		}));
	}
	return wrap;
}

function row(label, valueNode) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '38%' }, label),
		E('td', { 'class': 'td left' }, valueNode)
	]);
}

function card(title, children) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title),
		E('div', { 'class': 'cbi-section-node' }, children)
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callPower(), {})
		]);
	},

	render: function(data) {
		var st = (data && data[0]) || {};
		var pw = (data && data[1]) || {};

		var self = this;

		/* ---------- kartu sinyal ---------- */
		var sigTable = E('table', { 'class': 'table' }, [
			row(_('Operator'), E('strong', { 'id': 'f-op' }, '–')),
			row(_('PLMN'), E('span', { 'id': 'f-plmn' }, '–')),
			row(_('Teknologi'), E('span', { 'id': 'f-tech' }, '–')),
			row(_('Kualitas sinyal'), E('span', {}, [
				barEl(), ' ',
				E('strong', { 'id': 'f-rsrp' }, '–'), ' ',
				E('small', { 'id': 'f-qual', 'class': 'ifacebadge' }, '')
			])),
			row('RSSI / RSRQ', E('span', {}, [
				E('code', { 'id': 'f-rssi' }, '–'), ' / ', E('code', { 'id': 'f-rsrq' }, '–')
			])),
			row('SNR', E('code', { 'id': 'f-snr' }, '–')),
			row(_('Band / kanal'), E('span', {}, [
				E('code', { 'id': 'f-band' }, '–'), ' / ', E('code', { 'id': 'f-chan' }, '–')
			])),
			row(_('Cell ID / TAC'), E('span', {}, [
				E('code', { 'id': 'f-cell' }, '–'), ' / ', E('code', { 'id': 'f-tac' }, '–')
			])),
			row(_('Registrasi'), E('span', {}, [
				E('span', { 'id': 'f-state' }, '–'),
				E('span', { 'id': 'f-roam', 'class': 'ifacebadge', 'style': 'margin-left:6px' }, '')
			]))
		]);

		/* ---------- kartu data ---------- */
		var dataTable = E('table', { 'class': 'table' }, [
			row('APN aktif', E('code', { 'id': 'f-apn' }, '–')),
			row(_('IP / prefix'), E('span', {}, [
				E('code', { 'id': 'f-ip' }, '–'), ' / ', E('code', { 'id': 'f-pfx' }, '–')
			])),
			row(_('Gateway'), E('code', { 'id': 'f-gw' }, '–')),
			row('DNS', E('code', { 'id': 'f-dns' }, '–')),
			row('MTU', E('code', { 'id': 'f-mtu' }, '–')),
			row(_('Trafik') + ' (rx/tx)', E('span', {}, [
				E('code', { 'id': 'f-rx' }, '–'), ' / ', E('code', { 'id': 'f-tx' }, '–')
			])),
			row(_('Durasi koneksi'), E('span', { 'id': 'f-dur' }, '–'))
		]);

		/* ---------- APN ---------- */
		var apnInput = E('input', {
			'id': 'in-apn', 'class': 'cbi-input-text', 'style': 'width:100%',
			'placeholder': 'internet', 'list': 'apn-list'
		});
		var userInput = E('input', { 'id': 'in-user', 'class': 'cbi-input-text', 'style': 'width:100%', 'placeholder': '(kosong)' });
		var passInput = E('input', { 'id': 'in-pass', 'class': 'cbi-input-text', 'style': 'width:100%', 'placeholder': '(kosong)' });
		var iptSel = E('select', { 'id': 'in-ipt', 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'ipv4' }, 'IPv4'),
			E('option', { 'value': 'ipv6' }, 'IPv6'),
			E('option', { 'value': 'ipv4v6' }, 'IPv4/IPv6')
		]);
		var dl = E('datalist', { 'id': 'apn-list' });
		PRESET.forEach(function(p) {
			dl.appendChild(E('option', { 'value': p[1] }, p[0]));
		});

		var apnTable = E('table', { 'class': 'table' }, [
			row('Preset', E('select', { 'id': 'in-preset', 'class': 'cbi-input-select' }, [ E('option', { 'value': '' }, '— pilih operator —') ].concat(
				PRESET.map(function(p, i) { return E('option', { 'value': i }, p[0] + ' (' + p[1] + ')'); })
			))),
			row('APN', apnInput),
			row('Username', userInput),
			row('Password', passInput),
			row('Tipe IP', iptSel)
		]);

		apnTable.querySelector('#in-preset').addEventListener('change', function(ev) {
			var i = ev.target.value;
			if (i === '' || PRESET[i] == null) return;
			var p = PRESET[i];
			apnInput.value = p[1]; userInput.value = p[2]; passInput.value = p[3];
		});

		var btnApn = E('button', { 'class': 'cbi-button cbi-button-apply', 'style': 'margin-right:8px' }, _('Simpan & sambungkan ulang'));
		btnApn.addEventListener('click', function() {
			var apn = (apnInput.value || '').trim();
			if (!apn) { ui.addNotification(null, E('p', {}, _('APN tidak boleh kosong')), 'warning'); return; }
			btnApn.disabled = true;
			callApnSet(apn, userInput.value || '', passInput.value || '', iptSel.value).then(function(r) {
				btnApn.disabled = false;
				ui.addNotification(null, E('p', {}, (r && r.msg) || 'APN disimpan, reconnect berjalan'), 'info');
			}).catch(function(e) {
				btnApn.disabled = false;
				ui.addNotification(null, E('p', {}, 'Gagal: ' + e), 'error');
			});
		});

		/* ---------- SIM ---------- */
		var simTable = E('table', { 'class': 'table' }, [
			row(_('Status SIM'), E('strong', { 'id': 'f-simstat' }, '–')),
			row(_('Kartu terpasang'), E('span', {}, [
				E('span', { 'id': 'f-slot1' }, '–'),
				E('small', { 'style': 'color:#888' }, ' (slot 1)')
			])),
			row('ICCID', E('code', { 'id': 'f-iccid' }, '–')),
			row('IMSI', E('code', { 'id': 'f-imsi' }, '–')),
			row(_('Nomor'), E('code', { 'id': 'f-msisdn' }, '–')),
			row('PIN1', E('span', { 'id': 'f-pin' }, '–'))
		]);

		var btnPw = E('button', { 'class': 'cbi-button cbi-button-reset' }, _('Siklus daya SIM'));
		btnPw.addEventListener('click', function() {
			if (!confirm(_('Matikan lalu hidupkan SIM slot 1, provisioning ulang, sambung data. Lanjut?')))
				return;
			btnPw.disabled = true;
			callSimPower('cycle').then(function(r) {
				btnPw.disabled = false;
				ui.addNotification(null, E('p', {}, (r && r.msg) || 'SIM dipowerkan ulang'), 'info');
			});
		});

		/* ---------- daya / baterai ---------- */
		var powerTable = E('table', { 'class': 'table' }, [
			row(_('Baterai'), E('strong', { 'id': 'f-bat' }, '–')),
			row(_('Tegangan / suhu'), E('span', {}, [
				E('code', { 'id': 'f-batv' }, '–'), ' / ', E('code', { 'id': 'f-batt' }, '–')
			])),
			row(_('Arus baterai'), E('code', { 'id': 'f-bati' }, '–')),
			row(_('Kesehatan baterai'), E('span', { 'id': 'f-bath' }, '–')),
			row(_('Adaptor terpasang'), E('span', { 'id': 'f-chgon' }, '–')),
			row(_('Status charger'), E('span', {}, [
				E('span', { 'id': 'f-chgst' }, '–'),
				E('small', { 'id': 'f-chgtype', 'style': 'color:#888;margin-left:6px' }, '')
			])),
			row(_('Arus masuk / cas / terminasi'), E('span', {}, [
				E('code', { 'id': 'f-chgic' }, '–'), ' / ',
				E('code', { 'id': 'f-chgcc' }, '–'), ' / ',
				E('code', { 'id': 'f-chgtc' }, '–')
			]))
		]);

		/* ---------- modem ---------- */
		var modTable = E('table', { 'class': 'table' }, [
			row('IMEI', E('code', { 'id': 'f-imei' }, '–')),
			row('Firmware modem', E('span', { 'id': 'f-fw' }, '–')),
			row(_('Uptime router'), E('span', { 'id': 'f-up' }, '–'))
		]);

		var btnRec = E('button', { 'class': 'cbi-button cbi-button-action', 'style': 'margin-right:8px' }, _('Reconnect data'));
		btnRec.addEventListener('click', function() {
			btnRec.disabled = true;
			callReconnect().then(function(r) {
				btnRec.disabled = false;
				ui.addNotification(null, E('p', {}, (r && r.msg) || 'Reconnect berjalan'), 'info');
			});
		});

		var btnRst = E('button', { 'class': 'cbi-button cbi-button-negative', 'style': 'margin-right:8px' }, _('Restart modem'));
		btnRst.addEventListener('click', function() {
			if (!confirm(_('Restart modem (MPSS) ±60-90 detik. Koneksi seluler putus sementara. Lanjut?')))
				return;
			btnRst.disabled = true;
			callRestart().then(function(r) {
				ui.addNotification(null, E('p', {}, (r && r.msg) || 'Restart berjalan'), 'info');
				window.setTimeout(function() { btnRst.disabled = false; }, 90000);
			});
		});

		var btnLog = E('button', { 'class': 'cbi-button' }, _('Lihat log'));
		var logBox = E('pre', {
			'id': 'logbox',
			'style': 'display:none;max-height:320px;overflow:auto;background:#111;color:#9f9;padding:8px;border-radius:4px;font-size:11px;margin-top:8px'
		});
		btnLog.addEventListener('click', function() {
			callLogs().then(function(r) {
				logBox.textContent = (r && r.data) || '(kosong)';
				logBox.style.display = logBox.style.display === 'none' ? 'block' : 'none';
			});
		});

		var updated = E('small', { 'id': 'f-updated', 'style': 'color:#888' }, '');

		var root = E('div', {}, [
			E('h2', {}, _('Modem Manager')),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Status sinyal, APN, SIM, dan kontrol modem langsung dari QMI (qmicli) / ModemManager. '),
				updated
			]),
			E('div', { 'class': 'cbi-grid-2' }, [
				card(_('Sinyal & jaringan'), sigTable),
				card(_('Data seluler'), dataTable)
			]),
			card(_('APN'), [ apnTable, dl, E('div', { 'style': 'margin-top:10px' }, btnApn) ]),
			card(_('SIM'), [
				simTable,
				E('div', { 'style': 'margin-top:10px' }, [ btnPw ]),
				E('p', { 'class': 'cbi-section-descr' }, _('Modem MPSS ini hanya mengenal satu slot SIM, jadi tidak ada pilihan pindah slot. Kalau kartu tidak terbaca setelah dicabut-pasang, pakai "Siklus daya SIM" (power off → on → provisioning ulang → data disambung ulang).'))
			]),
			card(_('Daya & baterai'), [
				powerTable,
				E('p', { 'class': 'cbi-section-descr', 'id': 'f-batnote' }, '')
			]),
			card(_('Modem'), [ modTable, E('div', { 'style': 'margin-top:10px' }, [ btnRec, btnRst, btnLog ]), logBox ])
		]);

		function paint(s) {
			if (!s || !s.signal) return;
			txt('f-op', s.net && s.net.operator);
			txt('f-plmn', s.net && s.net.plmn);
			txt('f-tech', s.signal.tech);
			txt('f-rsrp', (s.signal.rsrp ? s.signal.rsrp + ' dBm' : '–'));
			txt('f-rssi', (s.signal.rssi ? s.signal.rssi + ' dBm' : '–'));
			txt('f-rsrq', (s.signal.rsrq ? s.signal.rsrq + ' dB' : '–'));
			txt('f-snr', (s.signal.snr ? s.signal.snr + ' dB' : '–'));
			txt('f-band', s.signal.band);
			txt('f-chan', s.signal.channel);
			txt('f-qual', s.signal.quality);
			txt('f-cell', s.net && s.net.cell);
			txt('f-tac', s.net && s.net.tac);
			txt('f-state', s.net && s.net.state);
			txt('f-roam', s.net && s.net.roaming === 'off' ? '' : (s.net && s.net.roaming ? 'roaming' : ''));

			var lvl = bars(s.signal.rsrp);
			var col = lvl >= 4 ? '#2ecc71' : lvl === 3 ? '#f1c40f' : lvl === 2 ? '#e67e22' : '#e74c3c';
			for (var i = 1; i <= 5; i++) {
				var b = qroot.querySelector('#bar' + i);
				if (b) b.style.background = (i <= lvl ? col : '#ccc');
			}

			txt('f-apn', s.data && s.data.apn);
			txt('f-ip', s.data && s.data.ip);
			txt('f-pfx', s.data && s.data.prefix);
			txt('f-gw', s.data && s.data.gw);
			txt('f-dns', s.data && s.data.dns);
			txt('f-mtu', s.data && s.data.mtu);
			txt('f-rx', s.data && s.data.rx ? (Math.round(s.data.rx / 1024) + ' KiB') : '–');
			txt('f-tx', s.data && s.data.tx ? (Math.round(s.data.tx / 1024) + ' KiB') : '–');
			txt('f-dur', s.data && s.data.duration ? (s.data.duration + ' s') : '–');

			var apnIn = qroot.querySelector('#in-apn');
			if (apnIn && !apnIn.value && s.data && s.data.apn)
				apnIn.value = s.data.apn;

			var ss = (s.sim && s.sim.status) || '';
			txt('f-simstat', ss);
			var statEl = qroot.querySelector('#f-simstat');
			if (statEl) statEl.style.color = ss === 'hidup' ? '#2ecc71' :
				(ss ? '#e67e22' : '#e74c3c');

			txt('f-slot1', s.sim && s.sim.slot1);
			txt('f-iccid', s.sim && s.sim.iccid);
			txt('f-imsi', s.sim && s.sim.imsi);
			txt('f-msisdn', s.sim && s.sim.msisdn);
			txt('f-pin', s.sim && s.sim.pin);
			txt('f-imei', s.modem && s.modem.imei);
			txt('f-fw', s.modem && s.modem.firmware);
			txt('f-up', s.modem && s.modem.uptime ? (Math.round(s.modem.uptime / 60) + ' menit') : '–');
			txt('f-updated', '(' + new Date().toLocaleTimeString() + ')');
		}

		function mA(v) {
			var n = num(v);
			return n == null ? '–' : ((n / 1000).toFixed(1) + ' mA');
		}

		function paintPower(p) {
			if (!p) return;
			var c = p.charger || {}, b = p.battery || {};
			var plug = c.online === '1' || c.online === 1;
			var el = qroot.querySelector('#f-chgon');
			if (el) {
				el.textContent = plug ? 'ya (USB)' : 'tidak (jalan dari baterai)';
				el.style.color = plug ? '#2ecc71' : '#e67e22';
			}
			txt('f-chgst', c.status || '–');
			txt('f-chgtype', c.type ? '[' + c.type.trim() + ']' : '');
			txt('f-chgic', mA(c.input_current));
			txt('f-chgcc', mA(c.charge_current));
			txt('f-chgtc', mA(c.term_current));

			var batEl = qroot.querySelector('#f-bat');
			if (b.available) {
				var cap = num(b.capacity);
				var stt = b.status || '';
				if (batEl) {
					batEl.textContent = (cap == null ? '–' : cap + '%') +
						(stt ? ' — ' + stt : '') +
						(b.present === '0' ? ' (baterai tidak terpasang)' : '');
					batEl.style.color = cap == null ? '' : (cap <= 15 ? '#e74c3c' : cap <= 40 ? '#e67e22' : '#2ecc71');
				}
				txt('f-batv', b.voltage ? ((num(b.voltage) / 1000000).toFixed(2) + ' V') : '–');
				txt('f-batt', b.temp ? (num(b.temp) / 10).toFixed(1) + ' °C' : '–');
				txt('f-bati', mA(b.current));
				txt('f-bath', b.health || '–');
			} else {
				if (batEl) { batEl.textContent = 'tidak terbaca'; batEl.style.color = '#888'; }
				txt('f-batv', '–'); txt('f-batt', '–'); txt('f-bati', '–'); txt('f-bath', '–');
				var note = qroot.querySelector('#f-batnote');
				if (note) note.textContent = 'Persentase dan status baterai belum tersedia: driver fuel-gauge (CONFIG_BATTERY_PMI8994_FG) belum aktif di kernel ini. Yang terbaca hanya sisi adaptor/charger.';
			}
		}

		qroot = root;
		paint(st);
		paintPower(pw);

		poll.add(function() {
			return Promise.all([
				L.resolveDefault(callStatus(), {}),
				L.resolveDefault(callPower(), {})
			]).then(function(r) { paint(r[0]); paintPower(r[1]); });
		}, 10);

		return root;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});