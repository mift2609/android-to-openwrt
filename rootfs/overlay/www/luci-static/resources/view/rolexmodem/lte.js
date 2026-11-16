'use strict';
'require view';
'require fs';
'require ui';

function ctl(args) {
	return fs.exec('/usr/bin/rolex-modem-ctl', args);
}

function kv(text) {
	var out = {};
	(text || '').split('\n').forEach(function (line) {
		var i = line.indexOf('=');
		if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	});
	return out;
}

function bandsBlock(text) {
	var parts = (text || '').split('bands_block<<EOF');
	return parts.length > 1 ? parts[1].split('EOF')[0] : '';
}

function bandsFrom(block, which) {
	var lines = (block || '').split('\n'), take = false, out = [];
	for (var i = 0; i < lines.length; i++) {
		var l = lines[i].trim();
		if (l.indexOf(which + ':') >= 0) {
			take = true;
			out.push(l.slice(l.indexOf(which + ':') + which.length + 1));
			continue;
		}
		if (take) {
			// garis pemisah blok (mis. "------" / ",,,") bukan nama band -> berhenti
			if (/^[,\s-]+$/.test(l)) break;
			if (l !== '' && /^[ ,a-z0-9-]+$/i.test(l)) { out.push(l); continue; }
			break;
		}
	}
	return out.join(' ').replace(/\s+/g, ' ').trim();
}

function splitBands(s) {
	return (s || '').split(/[,\s]+/).filter(function (x) { return x !== ''; });
}

// Frekuensi band LTE (MHz) + penanda band yang dipakai operator Indonesia.
var LTE_FREQ = {
	1: '2100', 2: '1900', 3: '1800', 4: '1700/2100', 5: '850', 7: '2600', 8: '900',
	11: '1500', 12: '700', 13: '700', 17: '700', 18: '850', 19: '850', 20: '800',
	25: '1900', 26: '850', 28: '700', 30: '2300', 38: '2600 TDD', 39: '1900 TDD',
	40: '2300 TDD', 41: '2500 TDD', 42: '3500'
};
var ID_BANDS = [ 1, 3, 5, 8, 40 ];   // dipakai operator di Indonesia (Telkomsel/Indosat/XL/Tri/Smartfren)

function lteLabel(n) {
	var f = LTE_FREQ[n] ? ' (' + LTE_FREQ[n] + ' MHz)' : '';
	var id = (ID_BANDS.indexOf(parseInt(n, 10)) >= 0) ? ' ★' : '';
	return 'B' + n + f + id;
}

function bandLabel(tok) {
	var m = /^eutran-(\d+)$/.exec(tok);
	if (m) return 'B' + m[1] + (LTE_FREQ[m[1]] ? ' (' + LTE_FREQ[m[1]] + ')' : '');
	if (/^utran-/.test(tok)) return tok.replace('utran-', 'WCDMA B');
	return tok.toUpperCase();
}

function act(args, label) {
	ui.showModal(label + ' ...', [ E('p', { 'class': 'spinning' }, _('Menjalankan perintah')) ]);
	return ctl(args).then(function (res) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, (res.stdout || '') + (res.stderr || '')), 'info');
		window.setTimeout(function () { location.reload(); }, 2500);
	}).catch(function (e) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, String(e)), 'error');
	});
}

function row(label, value, cls) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '35%' }, label),
		E('td', { 'class': 'td left' + (cls ? ' ' + cls : '') }, value || '—')
	]);
}

// Aksi SMS: semuanya lewat /usr/bin/rolex-sms-ctl (QMI/ModemManager).
function smsAct(args) {
	return fs.exec('/usr/bin/rolex-sms-ctl', args).then(function (r) {
		return ((r && r.stdout) || '') + ((r && r.stderr) || '');
	});
}

// Bar sinyal sederhana (persen dari QMI) — halaman ala "4G Connection".
function signalBar(pct) {
	var p = parseInt(pct, 10);
	if (isNaN(p)) return '\u2014';
	var col = p > 60 ? '#2e7d32' : (p > 35 ? '#f9a825' : '#c62828');
	return E('span', {}, [
		E('span', {
			'style': 'display:inline-block; vertical-align:middle; width:110px; height:10px; ' +
			         'background:#d8d8d8; border-radius:5px; overflow:hidden; margin-right:8px'
		}, E('span', {
			'style': 'display:block; height:100%; width:' + Math.max(3, Math.min(100, p)) + '%; background:' + col
		})),
		E('strong', {}, p + '%')
	]);
}

function val(x) {
	return (x === undefined || x === null || x === '') ? '\u2014' : x;
}

return view.extend({
	load: function () {
		// status dari rolex-modem-ctl + info 4G lengkap dari QMI.
		// (pengganti halaman 3ginfo-lite — app itu butuh AT yang di modem ini tidak menjawab)
		return Promise.all([
			ctl(['status']),
			fs.exec('/usr/bin/rolex-3ginfo-json', []),
			fs.exec('/usr/bin/rolex-sms-ctl', [ 'list' ]).catch(function () { return { stdout: '' }; })
		]);
	},

	render: function (res) {
		var st = (res && res[0]) || {};
		var d = kv(st.stdout);
		var block = bandsBlock(st.stdout);
		var g = {};
		try { g = JSON.parse((res && res[1] && res[1].stdout) || '{}'); } catch (e) { g = {}; }
		var sms = ((res && res[2] && res[2].stdout) || '').split('\n').map(function (l) {
			var m = /^id=(\d+)\s+state=(\S+)/.exec(l.trim());
			return m ? { id: m[1], state: m[2] } : null;
		}).filter(function (x) { return x; });
		var bandsCur = bandsFrom(block, 'current');
		var bandsSup = bandsFrom(block, 'supported');

		function signalQuality() {
			var rsrp = parseFloat(d.RSRP);
			if (isNaN(rsrp)) return '—';
			if (rsrp > -80) return _('sangat baik');
			if (rsrp > -90) return _('baik');
			if (rsrp > -100) return _('cukup');
			if (rsrp > -110) return _('lemah');
			return _('sangat lemah');
		}

		// Satu tabel info saja: modem + jaringan + SIM + sinyal (dulu terpisah 3 tabel -> dobel).
		// Nilai dari /usr/bin/rolex-3ginfo-json (QMI) + rolex-modem-ctl status.
		function mm(v) { return v ? v + ' dBm' : '\u2014'; }
		var infoRows = [
			row(_('Kekuatan sinyal'), signalBar(g.signal)),
			row(_('Operator'), val(g.operator_name) + (g.operator_mcc ? ' (' + g.operator_mcc + '/' + g.operator_mnc + ')' : '')),
			row(_('Status SIM'), g.imsi ? _('siap (IMSI terbaca)') : '\u2014'),
			row(_('Teknologi / registrasi'), val(g.mode) + ' / ' + val(g.registration)),
			row(_('Layanan LTE / PS'), val(d.lte_service) + ' / ' + val(d.ps)),
			row(_('APN'), E('strong', {}, d.apn || '\u2014')),
			row(_('IP / gateway'), val(d.ip) + (d.gateway ? ' (gw ' + d.gateway + ')' : '')),
			row(_('IP modem / internet'), val(d.io)),
			row(_('Sinyal'), _('RSRP ') + mm(g.rsrp) + ' / ' + _('RSRQ ') + (val(g.rsrq) === '\u2014' ? '\u2014' : g.rsrq + ' dB') +
				' / ' + _('SINR ') + (val(g.sinr) === '\u2014' ? '\u2014' : g.sinr + ' dB') +
				(d.RSRP ? '  (' + signalQuality() + ')' : '')),
			row(_('RSSI / CSQ'), (val(g.rssi) === '\u2014' ? '\u2014' : g.rssi + ' dBm') + ' / ' + val(g.csq)),
			row(_('Pita / PCI / EARFCN'), val(g.pband) + '  \u2014 PCI ' + val(g.pci) + ', EARFCN ' + val(g.earfcn), 'important'),
			row(_('Cell ID / TAC / LAC'), val(g.cid_dec) + (g.cid_hex ? ' (' + g.cid_hex + ')' : '') + ' / ' + val(g.tac_dec) + ' / ' + val(g.lac_dec)),
			row(_('Statistik koneksi'), val(g.conn_time) + (g.rx ? '  \u2014 rx ' + g.rx + ' / tx ' + g.tx : '')),
			row(_('Tipe modem'), val(g.modem)),
			row(_('Firmware'), val(g.firmware)),
			row(_('IMEI / IMSI'), val(g.imei) + ' / ' + val(g.imsi)),
			row(_('ICCID'), val(g.iccid)),
			row(_('Suhu modem'), g.mtemp ? g.mtemp + ' \u00b0C' : '\u2014'),
			row(_('ModemManager'), val(d.mm_state)),
			row(_('Band prefs sekarang'), splitBands(bandsCur).map(bandLabel).join(', ') || '\u2014'),
			row(_('Band didukung'), splitBands(bandsSup).map(bandLabel).join(', ') || '\u2014')
		];
		if (!d.RSRP && !d.RSSI && !g.rsrp) {
			infoRows.unshift(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'colspan': '2' }, [
					E('strong', {}, _('Modem belum siap: nilai sinyal belum bisa dibaca.')),
					E('br'),
					_('Biasanya 1–2 menit setelah boot (mencari jaringan). Tunggu lalu tekan Segarkan, ' +
					  'atau jalankan /usr/bin/rolex-watchdog di System → Terminal.')
				])
			]));
		}

		var apnInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': d.apn || '' });
		var famSelect = E('select', { 'class': 'cbi-input-select' },
			['ipv4', 'ipv6', 'ipv4v6'].map(function (v) {
				return E('option', { 'value': v, 'selected': (d.ipfam === v) ? '' : null }, v);
			}));
		// --- pilihan band: centang saja, tak perlu hafal "eutran-3" --------
		var boxes = [];
		function bandBox(tok, cur) {
			var m = /^eutran-(\d+)$/.exec(tok);
			var cb = E('input', { 'type': 'checkbox', 'data-band': tok, 'checked': (cur || '').indexOf(tok) >= 0 ? '' : null });
			boxes.push(cb);
			return E('label', {
				'style': 'display:inline-block; min-width:170px; margin:2px 10px 2px 0; font-weight:normal'
			}, [ cb, ' ', m ? lteLabel(m[1]) : bandLabel(tok) ]);
		}
		var curList = splitBands(bandsCur);
		var lteTok = splitBands(bandsSup).filter(function (t) { return /^eutran-\d+$/.test(t); })
			.sort(function (a, b) { return parseInt(a.split('-')[1], 10) - parseInt(b.split('-')[1], 10); });
		var otherTok = splitBands(bandsSup).filter(function (t) { return !/^eutran-\d+$/.test(t); });
		var lteBoxes = lteTok.map(function (t) { return bandBox(t, curList); });
		var otherBoxes = otherTok.map(function (t) { return bandBox(t, curList); });

		function selectedBands() {
			return boxes.filter(function (cb) { return cb.checked; })
				.map(function (cb) { return cb.getAttribute('data-band'); });
		}
		function applyBands(sel, label) {
			if (!sel.length) {
				ui.addNotification(null, E('p', {}, _('Pilih minimal satu band dulu.')), 'error');
				return;
			}
			act([ 'band', sel.join(',') ], label);
		}
		function bandsIndonesia() {
			var ID = [ 'eutran-1', 'eutran-3', 'eutran-5', 'eutran-8', 'eutran-40' ];   // dipakai operator ID
			var sel = [];
			boxes.forEach(function (cb) {
				var tok = cb.getAttribute('data-band');
				if (ID.indexOf(tok) >= 0 || !/^eutran-\d+$/.test(tok)) {   // LTE ID + 2G/3G cadangan
					cb.checked = (ID.indexOf(tok) >= 0);
					if (cb.checked) sel.push(tok);
				}
			});
			// 2G/3G tetap aktif (cadangan kalau 4G hilang)
			boxes.forEach(function (cb) {
				var tok = cb.getAttribute('data-band');
				if (!/^eutran-\d+$/.test(tok)) { cb.checked = true; sel.push(tok); }
			});
			applyBands(sel, _('Lock band operator Indonesia'));
		}

		var controls = E('div', {}, [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('APN')),
				E('div', { 'class': 'cbi-value-field' }, [
					apnInput,
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': function () { act(['apn', apnInput.value], _('Set APN')); }
					}, _('Simpan APN'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('IP family')),
				E('div', { 'class': 'cbi-value-field' }, [
					famSelect,
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': function () { act(['ipfam', famSelect.value], _('Set IP family')); }
					}, _('Simpan'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Lock band')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('span', { 'class': 'cbi-value-description' },
						_('Centang band yang diinginkan — tak perlu hafal kode "eutran-3". ') +
						_('★ = band yang dipakai operator Indonesia (Telkomsel/Indosat/XL/Tri/Smartfren). ') +
						_('Biarkan 2G/3G tercentang sebagai cadangan kalau 4G hilang.')),
					E('br'),
					E('div', { 'style': 'font-weight:600; margin-top:6px' }, _('LTE (4G)')),
					E('div', {}, lteBoxes),
					E('div', { 'style': 'font-weight:600; margin-top:6px' }, _('2G / 3G (cadangan)')),
					E('div', {}, otherBoxes),
					E('br'),
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': function () { applyBands(selectedBands(), _('Lock band')); }
					}, _('Terapkan pilihan')),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': function () { bandsIndonesia(); }
					}, _('Band Indonesia (B1,B3,B5,B8,B40)')),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'click': function () { act([ 'band', 'auto' ], _('Band auto')); }
					}, _('Auto (lepas lock)'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Restart modem')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('span', { 'class': 'cbi-value-description' },
						_('Modem MSS + layanan LTE dimulai ulang. IP kembali dalam 60–90 s.')),
					E('br'),
					E('button', {
						'class': 'btn cbi-button cbi-button-action important',
						'click': function () {
							if (confirm(_('Restart modem sekarang? Sambungan internet akan putus sementara.')))
								act(['reboot'], _('Restart modem'));
						}
					}, _('Restart modem sekarang'))
				])
			])
		]);

		// --- SMS: widget + aksi lewat /usr/bin/rolex-sms-ctl (QMI/ModemManager) --------
		function bacaSms(id) {
			smsAct([ 'read', id ]).then(function (out) {
				var m = {};
				(out || '').split('\n').forEach(function (l) {
					var i = l.indexOf('=');
					if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim();
				});
				ui.showModal(_('SMS ') + id, [
					E('p', {}, [ E('strong', {}, _('Dari: ')), m.number || '\u2014' ]),
					E('p', {}, [ E('strong', {}, _('Waktu: ')), m.timestamp || '\u2014' ]),
					E('pre', { 'style': 'white-space:pre-wrap; margin:8px 0' }, m.text || '\u2014'),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': function () { ui.hideModal(); } }, _('Tutup'))
					])
				]);
			});
		}
		function hapusSms(id) {
			if (!confirm(_('Hapus SMS ') + id + '?')) return;
			smsAct([ 'delete', id ]).then(function () { location.reload(); });
		}
		var smsNum = E('input', { 'class': 'cbi-input-text', 'placeholder': '+62812xxxxxxx' });
		var smsTxt = E('input', { 'class': 'cbi-input-text', 'placeholder': _('Isi SMS') });
		var smsRows = sms.map(function (m) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, m.id),
				E('td', { 'class': 'td left' }, m.state),
				E('td', { 'class': 'td left' }, [
					E('button', { 'class': 'btn cbi-button', 'click': function () { bacaSms(m.id); } }, _('Baca')),
					' ',
					E('button', { 'class': 'btn cbi-button cbi-button-reset', 'click': function () { hapusSms(m.id); } }, _('Hapus'))
				])
			]);
		});
		if (!smsRows.length)
			smsRows = [ E('tr', { 'class': 'tr' }, E('td', { 'class': 'td left', 'colspan': '3' }, _('Tidak ada SMS.'))) ];

		// --- isi tiap tab ------------------------------------------------------
		var modemSection = E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Informasi Modem dan Jaringan')),
				E('p', { 'class': 'cbi-value-description' },
					_('Dibaca lewat QMI (qmicli/ModemManager) — modem ini tidak melayani perintah AT.')),
				E('table', { 'class': 'table' }, infoRows),
				E('button', { 'class': 'btn cbi-button', 'click': function () { location.reload(); } }, _('Segarkan'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Pengaturan')),
				controls
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('WiFi')),
				E('p', {}, [
					_('Pengaturan WiFi (SSID, sandi, channel) ada di menu terpisah: '),
					E('a', { 'href': L.env.cgi_base + '/admin/network/wireless' }, _('Network → Wireless'))
				])
			])
		]);

		var smsSection = E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Pesan')),
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr' }, [
						E('th', { 'class': 'th' }, _('ID')),
						E('th', { 'class': 'th' }, _('Status')),
						E('th', { 'class': 'th' }, _('Aksi'))
					])
				].concat(smsRows))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Kirim SMS')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Nomor')),
					E('div', { 'class': 'cbi-value-field' }, smsNum)
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Isi')),
					E('div', { 'class': 'cbi-value-field' }, smsTxt)
				]),
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': function () {
						if (!smsNum.value || !smsTxt.value) {
							ui.addNotification(null, E('p', {}, _('Nomor dan isi harus diisi.')), 'error');
							return;
						}
						smsAct([ 'send', smsNum.value, smsTxt.value ]).then(function (out) {
							ui.addNotification(null, E('p', {}, out.trim() || _('terkirim')), 'info');
							smsNum.value = ''; smsTxt.value = '';
						});
					}
				}, _('Kirim')),
				' ',
				E('button', { 'class': 'btn cbi-button', 'click': function () { location.reload(); } }, _('Segarkan')),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-reset',
					'click': function () { if (confirm(_('Hapus semua SMS?'))) smsAct([ 'delete-all' ]).then(function () { location.reload(); }); }
				}, _('Hapus semua'))
			]),
			E('p', { 'class': 'cbi-value-description' },
				_('SMS dibaca/dikirim lewat QMI (ModemManager), bukan AT.'))
		]);

		// --- tab: Modem | SMS --------------------------------------------------
		var smsCount = sms.length ? ' (' + sms.length + ')' : '';
		var pane = E('div', {});
		var tabs = {};
		function showTab(which) {
			which = (which === 'sms') ? 'sms' : 'modem';
			if (pane.firstChild) pane.removeChild(pane.firstChild);
			pane.appendChild(which === 'sms' ? smsSection : modemSection);
			[ 'modem', 'sms' ].forEach(function (k) {
				if (tabs[k]) tabs[k].setAttribute('class', 'cbi-tab' + (k === which ? ' cbi-tab-active' : ''));
			});
			if (location.hash !== '#' + which) history.replaceState(null, '', '#' + which);
		}
		[ [ 'modem', _('Modem') ], [ 'sms', _('SMS') + smsCount ] ].forEach(function (t) {
			tabs[t[0]] = E('li', {
				'class': 'cbi-tab',
				'style': 'cursor:pointer',
				'click': function () { showTab(t[0]); }
			}, t[1]);
		});
		showTab((location.hash || '').replace('#', ''));

		return E('div', {}, [
			E('h2', {}, _('Modem LTE')),
			E('ul', { 'class': 'cbi-tabmenu' }, [ tabs.modem, tabs.sms ]),
			pane
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
