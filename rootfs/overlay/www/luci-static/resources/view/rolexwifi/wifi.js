'use strict';
'require view';
'require fs';
'require ui';

// Halaman Wireless untuk rolex. Halaman bawaan LuCI membaca keadaan radio dari netifd, dan di
// perangkat ini netifd/wpad tidak bisa memegang AP (driver wcn36xx) -> selalu tertulis
// "Device is not active / Wireless is disabled" walau AP hidup. Halaman ini membaca keadaan
// sebenarnya (rolex-wifi-ctl status) dan menyimpan setelan lewat skrip yang sama, yang menulis
// uci + menjalankan ulang hostapd.
return view.extend({
	load: function () {
		return fs.exec('/usr/bin/rolex-wifi-ctl', [ 'status' ]).catch(function () {
			return { stdout: '' };
		});
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
			return fs.exec('/usr/bin/rolex-wifi-ctl', urut[i]).then(function () {
				return jalankan(i + 1);
			});
		};

		return jalankan(0).then(function () {
			ui.addNotification(null, E('p', {}, _('Setelan dikirim. AP menjalankan ulang beberapa detik lagi.')), 'info');
			return new Promise(function (r) { setTimeout(r, 15000); });  // AP butuh ~10-14 s untuk naik ulang
		}).then(function () {
			return self.load().then(function (res) { return self.tampilkan(res, true); });
		});
	},

	tampilkan: function (res, gantiSaja) {
		var kv = {};
		String((res && res.stdout) || '').split('\n').forEach(function (l) {
			var i = l.indexOf('=');
			if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1);
		});
		var nilai = function (v) { return (v === undefined || v === null || v === '') ? '—' : v; };
		var baris = function (k, v, kuat) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, k),
				E('td', { 'class': 'td left' }, kuat ? E('strong', {}, nilai(v)) : nilai(v))
			]);
		};

		var isi = E('div', [
			E('h3', {}, _('Keadaan AP sebenarnya')),
			E('table', { 'class': 'table' }, [
				baris(_('Status AP'), kv.ap_state === 'jalan' ? _('jalan') : nilai(kv.ap_state), true),
				baris(_('SSID'), kv.ssid, true),
				baris(_('Channel'), kv.channel),
				baris(_('IP router WiFi'), nilai(kv.ip)),
				baris(_('Klien terhubung'), nilai(kv.clients)),
				baris(_('Sandi'), kv.key === 'tersimpan' ? _('tersimpan') : _('terbuka'))
			]),
			E('p', { 'class': 'cbi-value-description' },
				_('Halaman bawaan LuCI membaca radio dari netifd, sedangkan di perangkat ini netifd ' +
				  'tidak memegang AP (driver wcn36xx) — karena itu di sana tertulis "inactive/disabled" ' +
				  'padahal WiFi hidup. Tabel di atas membaca keadaan sebenarnya. Setelan di bawah ' +
				  'berlaku setelah AP dijalankan ulang (beberapa detik).')),
			E('h3', {}, _('Ubah setelan')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('SSID')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'type': 'text', 'id': 'rw-ssid', 'value': kv.ssid || '' })
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Sandi (kosongkan = jangan diubah)')),
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
						E('option', { 'value': 'HT40' }, _('HT40 (40 MHz, channel 1-9 saja)'))
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
			])
		]);

		if (!gantiSaja) this.node = isi;
		return isi;
	},

	render: function (res) {
		return this.tampilkan(res, false);
	}
});
