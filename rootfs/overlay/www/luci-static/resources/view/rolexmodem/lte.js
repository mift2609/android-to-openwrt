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
			fs.exec('/usr/bin/rolex-sms-ctl', [ 'list' ]).catch(function () { return { stdout: '' }; }),
			fs.exec('/usr/bin/rolex-wifi-ctl', [ 'status' ]).catch(function () { return { stdout: '' }; })
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
		var wifi = kv((res && res[3] && res[3].stdout) || '');
		var bandsCur = bandsFrom(block, 'current');
		var bandsSup = bandsFrom(block, 'supported');

		function signalQuality(dd) {
			var rsrp = parseFloat(dd.RSRP);
			if (isNaN(rsrp)) return '\u2014';
			if (rsrp > -80) return _('sangat baik');
			if (rsrp > -90) return _('baik');
			if (rsrp > -100) return _('cukup');
			if (rsrp > -110) return _('lemah');
			return _('sangat lemah');
		}

		// Baris tabel "Informasi Modem dan Jaringan" — dipakai saat render awal maupun saat
		// auto refresh (hanya tabel ini yang dibangun ulang, jadi isian lain tak terganggu).
		function mm(v) { return v ? v + ' dBm' : '\u2014'; }
		function rowsFrom(dd, gg, cur, sup) {
			var rows = [
				row(_('Kekuatan sinyal'), signalBar(gg.signal)),
				row(_('Operator'), val(gg.operator_name) + (gg.operator_mcc ? ' (' + gg.operator_mcc + '/' + gg.operator_mnc + ')' : '')),
				row(_('Status SIM'), gg.imsi ? _('siap (IMSI terbaca)') : '\u2014'),
				row(_('Teknologi / registrasi'), val(gg.mode) + ' / ' + val(gg.registration)),
				row(_('Layanan LTE / PS'), val(dd.lte_service) + ' / ' + val(dd.ps)),
				row(_('APN'), E('strong', {}, dd.apn || '\u2014')),
				row(_('IP / gateway'), val(dd.ip) + (dd.gateway ? ' (gw ' + dd.gateway + ')' : '')),
				row(_('IP modem / internet'), val(dd.io)),
				row(_('Sinyal'), _('RSRP ') + mm(gg.rsrp) + ' / ' + _('RSRQ ') + (val(gg.rsrq) === '\u2014' ? '\u2014' : gg.rsrq + ' dB') +
					' / ' + _('SINR ') + (val(gg.sinr) === '\u2014' ? '\u2014' : gg.sinr + ' dB') +
					(dd.RSRP ? '  (' + signalQuality(dd) + ')' : '')),
				row(_('RSSI / CSQ'), (val(gg.rssi) === '\u2014' ? '\u2014' : gg.rssi + ' dBm') + ' / ' + val(gg.csq)),
				row(_('Pita / PCI / EARFCN'), val(gg.pband) + '  \u2014 PCI ' + val(gg.pci) + ', EARFCN ' + val(gg.earfcn), 'important'),
				row(_('PCI tetangga'), val(gg.neighbors) + (gg.neighbors && gg.neighbors !== '\u2014' ? '  ' + _('(sel layan = baris pertama)') : '')),
				row(_('Cell ID / TAC / LAC'), val(gg.cid_dec) + (gg.cid_hex ? ' (' + gg.cid_hex + ')' : '') + ' / ' + val(gg.tac_dec) + ' / ' + val(gg.lac_dec)),
				row(_('Statistik koneksi'), val(gg.conn_time) + (gg.rx ? '  \u2014 rx ' + gg.rx + ' / tx ' + gg.tx : '')),
				row(_('Tipe modem'), val(gg.modem)),
				row(_('Firmware'), val(gg.firmware)),
				row(_('IMEI / IMSI'), val(gg.imei) + ' / ' + val(gg.imsi)),
				row(_('ICCID'), val(gg.iccid)),
				row(_('Suhu modem'), gg.mtemp ? gg.mtemp + ' \u00b0C' : '\u2014'),
				row(_('ModemManager'), val(dd.mm_state)),
				row(_('Band prefs sekarang'), splitBands(cur).map(bandLabel).join(', ') || '\u2014'),
				row(_('Band didukung'), splitBands(sup).map(bandLabel).join(', ') || '\u2014')
			];
			if (!dd.RSRP && !dd.RSSI && !gg.rsrp) {
				rows.unshift(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td left', 'colspan': '2' }, [
						E('strong', {}, _('Modem belum siap: nilai sinyal belum bisa dibaca.')),
						E('br'),
						_('Biasanya 1–2 menit setelah boot (mencari jaringan). Tunggu lalu tekan Segarkan, ' +
						  'atau jalankan /usr/bin/rolex-watchdog di System → Terminal.')
					])
				]));
			}
			return rows;
		}

		var infoTable = E('table', { 'class': 'table' }, rowsFrom(d, g, bandsCur, bandsSup));
		var refreshIn = E('input', {
			'class': 'cbi-input-text', 'type': 'number', 'min': '0', 'step': '5',
			'style': 'width:6em', 'value': d.refresh || '0'
		});
		var lastRefresh = E('span', { 'class': 'cbi-value-description' }, '');

		// --- penjaga internet (auto ganti IP) ---
		function guardRow(label, input, step) {
			if (step) input.setAttribute('type', 'number');
			input.setAttribute('style', 'width:7em');
			if (step) input.setAttribute('step', String(step));
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, label),
				E('div', { 'class': 'cbi-value-field' }, input)
			]);
		}
		var guardCheck = E('input', { 'class': 'cbi-input-text', 'value': d.check_secs || '60' });
		var guardFails = E('input', { 'class': 'cbi-input-text', 'value': d.check_fails || '3' });
		var guardRotate = E('input', { 'class': 'cbi-input-text', 'value': d.rotate_mins || '0' });
		var guardRestart = E('input', { 'class': 'cbi-input-text', 'value': d.restart_after || '2' });
		var guardTarget = E('input', { 'class': 'cbi-input-text', 'value': d.ping_target || '8.8.8.8' });
		var guardReboot = E('input', { 'class': 'cbi-input-text', 'value': d.reboot_after_mss || '2' });

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
				infoTable,
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Auto refresh (detik)')),
					E('div', { 'class': 'cbi-value-field' }, [
						refreshIn, ' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-apply',
							'click': function () { act([ 'refresh', String(parseInt(refreshIn.value, 10) || 0) ], _('Simpan auto refresh')); }
						}, _('Simpan')),
						' ',
						E('button', { 'class': 'btn cbi-button', 'click': function () { location.reload(); } }, _('Segarkan')),
						' ', lastRefresh,
						E('br'),
						E('span', { 'class': 'cbi-value-description' },
							_('0 = mati. Hanya tabel ini yang diperbarui otomatis (isian APN/band Anda tidak terganggu).'))
					])
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Pengaturan')),
				controls
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Penjaga internet (auto ganti IP)')),
				E('p', { 'class': 'cbi-value-description' },
					_('Kalau internet hang — IP masih terpasang tapi tak ada jawaban ping — sesi data diulang ' +
					  'otomatis supaya dapat IP baru, jadi tak perlu restart modem manual. Kalau berulang terus, ' +
					  'modem MSS di-restart (usaha terakhir).')),
				guardRow(_('Cek tiap (detik)'), guardCheck, 5),
				guardRow(_('Gagal berturut-turut'), guardFails, 1),
				guardRow(_('Ganti IP berkala (menit, 0 = mati)'), guardRotate, 1),
				guardRow(_('Restart modem setelah N kali gagal'), guardRestart, 1),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Alamat yang di-ping')),
					E('div', { 'class': 'cbi-value-field' }, guardTarget)
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Reboot perangkat setelah N restart modem')),
					E('div', { 'class': 'cbi-value-field' }, [ guardReboot, ' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-apply',
							'click': function () { act([ 'rebootpolicy', String(parseInt(guardReboot.value, 10) || 0) ], _('Simpan kebijakan reboot')); }
						}, _('Simpan')),
						' ',
						E('span', { 'class': 'cbi-value-description' },
							_('Usaha terakhir kalau modem tetap bengong (0 = jangan pernah).'))
					])
				]),
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': function () {
						act([ 'netguard', String(parseInt(guardCheck.value, 10) || 60),
						      String(parseInt(guardFails.value, 10) || 3),
						      String(parseInt(guardRotate.value, 10) || 0),
						      String(parseInt(guardRestart.value, 10) || 3),
						      guardTarget.value.trim() ], _('Simpan penjaga internet'));
					}
				}, _('Simpan penjaga internet')),
				' ',
				E('button', {
					'class': 'btn cbi-button',
					'click': function () {
						if (confirm(_('Ganti IP sekarang? Sambungan putus sebentar.')))
							act([ 'lte-restart' ], _('Ganti IP sekarang'));
					}
				}, _('Ganti IP sekarang')),
				' ',
				E('span', { 'class': 'cbi-value-description' },
					_('Target ping diubah lewat uci rolexlte.main.ping_target (kosong = 8.8.8.8).'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('WiFi (AP rolex)')),
				E('table', { 'class': 'table' }, [
					row(_('Status AP'), wifi.ap_state === 'jalan' ? _('jalan') : val(wifi.ap_state)),
					row(_('SSID'), E('strong', {}, val(wifi.ssid))),
					row(_('Sandinya'), wifi.key ? _('disimpan (lihat rolex-wifi-ctl status)') : _('terbuka')),
					row(_('Channel'), val(wifi.channel)),
					row(_('IP router WiFi'), val(wifi.ip)),
					row(_('Klien terhubung'), val(wifi.clients))
				]),
				E('p', { 'class': 'cbi-value-description' },
					_('AP ini dijaga /usr/bin/rolex-wifi-ctl (hostapd + IP statis), bukan netifd — karena itu ' +
					  'LuCI Network → Wireless memperlihatkan radio sebagai tidak aktif, padahal AP jalan.')),
				E('p', {}, [
					_('Ganti SSID/sandi/channel: '),
					E('code', {}, '/usr/bin/rolex-wifi-ctl ssid <nama> | key <sandi> | channel <1-13> | apply')
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

		// --- auto refresh (interval dari uci rolexlte.main.refresh) ---------------
		var refreshSecs = parseInt(d.refresh, 10) || 0;
		if (refreshSecs > 0) {
			window.setInterval(function () {
				Promise.all([
					ctl([ 'status' ]),
					fs.exec('/usr/bin/rolex-3ginfo-json', [])
				]).then(function (r) {
					var nd = kv(r[0] && r[0].stdout);
					var ng = {};
					try { ng = JSON.parse((r[1] && r[1].stdout) || '{}'); } catch (e) { ng = {}; }
					var nblk = bandsBlock(r[0] && r[0].stdout);
					var rows = rowsFrom(nd, ng, bandsFrom(nblk, 'current'), bandsFrom(nblk, 'supported'));
					infoTable.replaceChildren.apply(infoTable, rows);
					lastRefresh.textContent = _('diperbarui ') + new Date().toLocaleTimeString();
				}).catch(function () { /* diamkan, coba lagi di siklus berikutnya */ });
			}, refreshSecs * 1000);
			lastRefresh.textContent = _('auto refresh tiap ') + refreshSecs + _(' detik');
		}

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
