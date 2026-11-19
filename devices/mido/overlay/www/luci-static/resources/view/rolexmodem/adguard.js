"use strict";
"require view";
"require fs";
"require ui";

function kv(out) {
	var d = {};
	(out || '').split('\n').forEach(function (l) {
		var i = l.indexOf('=');
		if (i > 0) d[l.slice(0, i).trim()] = l.slice(i + 1).trim();
	});
	return d;
}
function row(k, v, cls) {
	return E('tr', { 'class': 'tr' + (cls ? ' ' + cls : '') }, [
		E('td', { 'class': 'td left', 'width': '34%' }, k),
		E('td', { 'class': 'td left' }, v || '—')
	]);
}
function act(args, label) {
	ui.showModal(label + '…', [ E('p', { 'class': 'spinning' }, _('Menunggu…')) ]);
	return fs.exec('/usr/bin/rolex-adguard-ctl', args).then(function (res) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, (res.stdout || res.stderr || '').trim() || (label + ' selesai')), 'info');
		window.setTimeout(function () { location.reload(); }, 1500);
	}).catch(function (e) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, e.message), 'error');
	});
}

return view.extend({
	load: function () { return fs.exec('/usr/bin/rolex-adguard-ctl', [ 'status' ]); },
	render: function (res) {
		var d = kv(res.stdout);
		var running = (d.running === 'jalan');
		var web = 'http://' + location.hostname + ':' + (d.web_port || 3000) + '/';
		return E('div', {}, [
			E('h2', {}, _('AdGuard Home (DNS penyaring iklan)')),
			E('div', { 'class': 'cbi-section' }, [
				E('table', { 'class': 'table' }, [
					row(_('Status'), running ? _('berjalan') : _('mati'), running ? 'success' : 'danger'),
					row(_('DNS di port'), d.dns_port || '53'),
					row(_('Panel web'), web),
					row(_('Upstream DNS'), '127.0.0.1:' + (d.dnsmasq_port || 5353) + ' — dnsmasq (nama lokal .lan + DNS operator)'),
					row(_('Daftar filter aktif'), d.filters || '—'),
					row(_('Jumlah aturan blokir'), d.rules || '—'),
					row(_('Total kueri DNS'), d.queries || '—'),
					row(_('Kueri diblokir'), d.blocked || '—')
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': function () { window.open(web, '_blank'); } }, _('Buka panel AdGuard Home')),
				' ',
				E('button', { 'class': 'btn cbi-button', 'click': function () { act([ 'update' ], _('Perbarui daftar filter')); } }, _('Perbarui daftar filter')),
				' ',
				E('button', { 'class': 'btn cbi-button cbi-button-reset', 'click': function () { if (confirm(_('Mulai ulang AdGuard Home?'))) act([ 'restart' ], _('Mulai ulang')); } }, _('Mulai ulang'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('p', { 'class': 'cbi-value-description' },
					_('Sandi panel: admin / rolex — ganti sesudah masuk pertama. Klien WiFi/LAN otomatis kena filter ini karena DHCP membagikan DNS = IP rolex.'))
			])
		]);
	}
});
