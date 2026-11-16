"use strict";
"require view";
"require fs";
"require ui";

function act(args, label) {
	return fs.exec('/usr/bin/rolex-sms-ctl', args).then(function (res) {
		return (res.stdout || '') + (res.stderr || '');
	});
}
function parseList(out) {
	return (out || '').split('\n').map(function (l) {
		var m = /^id=(\d+)\s+state=(\S+)/.exec(l.trim());
		return m ? { id: m[1], state: m[2] } : null;
	}).filter(function (x) { return x; });
}
function kv(out) {
	var d = {};
	(out || '').split('\n').forEach(function (l) {
		var i = l.indexOf('=');
		if (i > 0) d[l.slice(0, i).trim()] = l.slice(i + 1).trim();
	});
	return d;
}

return view.extend({
	load: function () {
		return fs.exec('/usr/bin/rolex-sms-ctl', [ 'list' ]);
	},
	render: function (res) {
		var msgs = parseList(res.stdout);
		var box = E('div', { 'class': 'cbi-section' });
		var numIn = E('input', { 'class': 'cbi-input-text', 'placeholder': '+62812xxxxxxx' });
		var txtIn = E('input', { 'class': 'cbi-input-text', 'placeholder': _('Isi SMS') });

		function baca(id) {
			act([ 'read', id ], _('Baca SMS')).then(function (out) {
				var d = kv(out);
				ui.showModal(_('SMS ') + id, [
					E('p', {}, [ E('strong', {}, _('Dari: ')), d.number || '—' ]),
					E('p', {}, [ E('strong', {}, _('Waktu: ')), d.timestamp || '—' ]),
					E('pre', { 'style': 'white-space:pre-wrap' }, d.text || '—'),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': function () { ui.hideModal(); } }, _('Tutup'))
					])
				]);
			});
		}
		function hapus(id) {
			if (!confirm(_('Hapus SMS ') + id + '?')) return;
			act([ 'delete', id ]).then(function () { ui.addNotification(null, E('p', {}, _('SMS dihapus')), 'info'); location.reload(); });
		}

		var rows = msgs.map(function (m) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, m.id),
				E('td', { 'class': 'td left' }, m.state),
				E('td', { 'class': 'td left' }, [
					E('button', { 'class': 'btn cbi-button', 'click': function () { baca(m.id); } }, _('Baca')),
					' ',
					E('button', { 'class': 'btn cbi-button cbi-button-reset', 'click': function () { hapus(m.id); } }, _('Hapus'))
				])
			]);
		});
		if (!rows.length) rows = [ E('tr', { 'class': 'tr' }, E('td', { 'class': 'td left', 'colspan': '3' }, _('Tidak ada SMS.'))) ];

		return E('div', {}, [
			E('h2', {}, _('SMS (lewat QMI / ModemManager)')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'class': 'cbi-value-description' },
					_('Port AT modem tidak menjawab di firmware ini, jadi SMS dibaca lewat QMI (ModemManager) — bukan lewat AT/sms-tool.')),
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr' }, [
						E('th', { 'class': 'th' }, _('ID')),
						E('th', { 'class': 'th' }, _('Status')),
						E('th', { 'class': 'th' }, _('Aksi'))
					])
				].concat(rows))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h4', {}, _('Kirim SMS')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Nomor')),
					E('div', { 'class': 'cbi-value-field' }, numIn)
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Isi')),
					E('div', { 'class': 'cbi-value-field' }, txtIn)
				]),
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': function () {
						if (!numIn.value || !txtIn.value) { ui.addNotification(null, E('p', {}, _('Nomor dan isi harus diisi.')), 'error'); return; }
						act([ 'send', numIn.value, txtIn.value ]).then(function (out) {
							ui.addNotification(null, E('p', {}, out.trim() || _('perintah dikirim')), 'info');
							numIn.value = ''; txtIn.value = '';
						});
					}
				}, _('Kirim')),
				' ',
				E('button', { 'class': 'btn cbi-button', 'click': function () { location.reload(); } }, _('Segarkan')),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-reset',
					'click': function () { if (confirm(_('Hapus semua SMS?'))) act([ 'delete-all' ]).then(function () { location.reload(); }); }
				}, _('Hapus semua'))
			])
		]);
	}
});
