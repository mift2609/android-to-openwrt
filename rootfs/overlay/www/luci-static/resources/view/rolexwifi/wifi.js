'use strict';
'require view';
'require fs';
'require ui';

// Halaman Network -> Wireless untuk rolex.
// Bentuknya meniru "Wireless Overview" bawaan LuCI (radio + SSID + Associated Stations), tetapi
// membaca keadaan SEBENARNYA dari perangkat (iw / rolex-wifi-ctl), bukan dari netifd — sebab di
// driver wcn36xx netifd tidak pernah berhasil memegang AP, sehingga halaman bawaan selalu menulis
// "Device is not active / Wireless is disabled" padahal AP hidup dan melayani klien.
return view.extend({
	load: function () {
		return Promise.all([
			fs.exec('/usr/bin/rolex-wifi-ctl', [ 'status' ]).catch(function () { return { stdout: '' }; }),
			fs.exec('/usr/sbin/iw', [ 'dev', 'wlan0', 'station', 'dump' ]).catch(function () { return { stdout: '' }; }),
			fs.exec('/usr/sbin/iw', [ 'dev', 'wlan0', 'info' ]).catch(function () { return { stdout: '' }; })
		]);
	},

	pakai: function (nilai) {
		var self = this;
		var urut = [];
		if (nilai.ssid) urut.push([ 'ssid', nilai.ssid ]);
		if (nilai.key) urut.push([ 'key', nilai.key ]);
		if (nilai.channel) urut.push([ 'channel', nilai.channel ]);
		if (nilai.htmode) urut.push([ 'htmode', nilai.htmode ]);
		urut.push([ 'apply' ]);

		var jalankan = function (i) {
			if (i >= urut.length) return Promise.resolve();
			return fs.exec('/usr/bin/rolex-wifi-ctl', urut[i]).then(function () { return jalankan(i + 1); });
		};

		return jalankan(0).then(function () {
			ui.addNotification(null, E('p', {}, _('Setelan dikirim — AP menjalankan ulang dalam beberapa detik.')), 'info');
			return new Promise(function (r) { setTimeout(r, 15000); });
		}).then(function () {
			return self.load().then(function (res) { return self.tampilkan(res); });
		});
	},

	tampilkan: function (res) {
		var kv = {};
		String((res && res[0] && res[0].stdout) || '').split('\n').forEach(function (l) {
			var i = l.indexOf('=');
			if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1);
		});

		// daftar klien dari 'iw dev wlan0 station dump'
		var klien = [];
		String((res && res[1] && res[1].stdout) || '').split('Station ').slice(1).forEach(function (b) {
			klien.push({
				mac: b.split(' ')[0],
				sinyal: (b.match(/signal:\s*(-?[0-9]+)/) || [])[1] || '',
				rx: (b.match(/rx bytes:\s*([0-9]+)/) || [])[1] || '',
				tx: (b.match(/tx bytes:\s*([0-9]+)/) || [])[1] || ''
			});
		});

		// info radio dari 'iw dev wlan0 info' (channel + frekuensi, BSSID)
		var info = String((res && res[2] && res[2].stdout) || '');
		var bssid = (info.match(/addr\s+([0-9a-f:]{17})/i) || [])[1] || '';
		var chInfo = (info.match(/channel\s+([0-9]+)\s*\(([0-9]+)\s*MHz\)/) || []);
		var labelKanal = chInfo.length ? (chInfo[1] + ' (' + (parseInt(chInfo[2], 10) / 1000).toFixed(3) + ' GHz)') : kv.channel;

		var jalan = kv.ap_state === 'jalan';
		var nilai = function (v) { return (v === undefined || v === null || v === '') ? '—' : v; };
		var kib = function (b) {
			if (!b) return '—';
			var n = parseInt(b, 10) / 1024;
			return n > 1024 ? (n / 1024).toFixed(1) + ' MiB' : n.toFixed(1) + ' KiB';
		};

		// Susunan mengikuti halaman bawaan LuCI (lihat rolex vs mido): baris radio (nama, deskripsi,
		// channel) + tombol, lalu baris jaringan (SSID/Mode/BSSID/Encryption), lalu Associated Stations.
		var radio = E('div', { 'class': 'cbi-section' }, [
			E('h2', {}, _('Wireless Overview')),
			E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, 'radio0'),
					E('th', { 'class': 'th right' }, '')
				]),
				E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
					E('td', { 'class': 'td' }, [
						E('em', {}, 'Generic MAC80211 802.11b/g/n'),
						E('br'),
						_('Channel') + ' ' + nilai(labelKanal),
						E('br'),
						_('Bitrate') + ' ? Mbit/s'
					]),
					E('td', { 'class': 'td right', 'style': 'white-space:nowrap;vertical-align:top' }, [
						E('button', {
							'class': 'btn cbi-button',
							'click': ui.createHandlerFn(this, function () {
								return fs.exec('/etc/init.d/rolex-wifi', [ 'restart' ]).then(function () {
									ui.addNotification(null, E('p', {}, _('AP dijalankan ulang.')), 'info');
								});
							})
						}, _('Restart'))
					])
				]),
				jalan ? E('tr', { 'class': 'tr cbi-rowstyle-2' }, [
					E('td', { 'class': 'td', 'colspan': '2' }, [
						E('div', {}, [
							E('strong', {}, _('SSID') + ': ' + nilai(kv.ssid)),
							' · ' + _('Mode') + ': Master',
							' · ' + _('BSSID') + ': ' + nilai(bssid),
							' · ' + _('Encryption') + ': ' +
								((kv.encryption === 'none' || !kv.encryption) ? 'None' : 'WPA2-PSK')
						]),
						E('div', { 'class': 'cbi-value-description' },
							_('Signal') + ': — dBm / — dBm · ' +
							(klien.length ? (klien.length + ' ' + _('klien terhubung')) : _('belum ada klien'))),
						E('div', {}, [
							E('button', {
								'class': 'btn cbi-button',
								'click': function () {
									var f = document.getElementById('rw-ssid');
									if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.focus(); }
								}
							}, _('Edit'))
						])
					])
				]) : E('tr', { 'class': 'tr cbi-rowstyle-2' }, [
					E('td', { 'class': 'td', 'colspan': '2' }, [
						E('em', {}, _('Device is not active')),
						E('div', { 'class': 'cbi-value-description' },
							_('hostapd tidak berjalan. Tekan Restart, atau periksa /tmp/wifi.log.'))
					])
				])
			])
		]);

		var ssid = null;

		var stations = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Associated Stations')),
			E('table', { 'class': 'table' },
				[ E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('MAC address')),
					E('th', { 'class': 'th' }, _('Signal')),
					E('th', { 'class': 'th' }, _('RX / TX'))
				]) ].concat(klien.length ? klien.map(function (k, i) {
					return E('tr', { 'class': 'tr cbi-rowstyle-' + (i % 2 + 1) }, [
						E('td', { 'class': 'td' }, k.mac),
						E('td', { 'class': 'td' }, k.sinyal ? k.sinyal + ' dBm' : '—'),
						E('td', { 'class': 'td' }, kib(k.rx) + ' / ' + kib(k.tx))
					]);
				}) : [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'colspan': '3' }, E('em', {}, _('No information available')))
					])
				]))
		]);

		var ubah = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Ubah setelan')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('SSID')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'type': 'text', 'id': 'rw-ssid', 'value': kv.ssid || '' })
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Sandi baru (kosongkan = tetap)')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'type': 'text', 'id': 'rw-key', 'placeholder': _('biarkan kosong') })
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Channel')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('select', { 'id': 'rw-ch' }, (function () {
						var out = [];
						for (var i = 1; i <= 13; i++)
							out.push(E('option', { 'value': String(i), 'selected': String(i) === String(kv.channel) ? 'selected' : null }, String(i)));
						return out;
					})())
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Lebar kanal')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('select', { 'id': 'rw-ht' }, [
						E('option', { 'value': 'HT20' }, _('HT20 (20 MHz)')),
						E('option', { 'value': 'HT40' }, _('HT40 (40 MHz, channel 1-9)'))
					])
				])
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': ui.createHandlerFn(this, function () {
						return this.pakai({
							ssid: document.getElementById('rw-ssid').value.trim(),
							key: document.getElementById('rw-key').value,
							channel: document.getElementById('rw-ch').value,
							htmode: document.getElementById('rw-ht').value
						});
					})
				}, _('Simpan & jalankan ulang AP'))
			]),
			E('p', { 'class': 'cbi-value-description' },
				_('Halaman bawaan LuCI membaca radio dari netifd; di perangkat ini netifd tidak bisa ' +
				  'memegang AP (driver wcn36xx), sehingga di sana tertulis "inactive/disabled" padahal ' +
				  'AP hidup. Semua nilai di halaman ini dibaca langsung dari perangkat.'))
		]);

		return E([], [ radio, stations, ubah ]);
	},

	render: function (res) {
		return this.tampilkan(res);
	}
});
