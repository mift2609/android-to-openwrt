'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var callBandGet = rpc.declare({ object: 'mido3g', method: 'band_get' });
var callBandSet = rpc.declare({ object: 'mido3g', method: 'band_set', params: [ 'bands', 'mode' ] });

/* band LTE yang didukung modem mido (dms-get-band-capabilities):
   B1 2100, B3 1800, B5 850, B7 2600, B38/B39/B40/B41 TDD */
var LTE_BANDS = [
	[ 1,  'B1  2100 MHz' ],
	[ 3,  'B3  1800 MHz' ],
	[ 5,  'B5  850 MHz' ],
	[ 7,  'B7  2600 MHz' ],
	[ 38, 'B38 2600 TDD' ],
	[ 39, 'B39 1900 TDD' ],
	[ 40, 'B40 2300 TDD' ],
	[ 41, 'B41 2500 TDD' ]
];

var MODES = [
	[ '',            '— jangan ubah mode —' ],
	[ 'lte',         'LTE saja (4G)' ],
	[ 'lte,umts',    '4G + 3G' ],
	[ 'umts',        '3G saja' ],
	[ 'gsm',         '2G saja' ],
	[ 'automatic',   'Otomatis (semua)' ]
];

var qroot = null;
function txt(id, v) {
	var el = qroot ? qroot.querySelector('#' + id) : null;
	if (el && v != null && v !== '') el.textContent = v;
}

function row(label, node) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '38%' }, label),
		E('td', { 'class': 'td left' }, node)
	]);
}

return view.extend({
	load: function() {
		return L.resolveDefault(callBandGet(), {});
	},

	render: function(b) {
		b = b || {};

		var boxes = {};
		var grid = E('div', { 'style': 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px' });
		LTE_BANDS.forEach(function(band) {
			var cb = E('input', { 'type': 'checkbox', 'id': 'cb' + band[0], 'value': String(band[0]) });
			boxes[band[0]] = cb;
			grid.appendChild(E('label', { 'style': 'display:flex;align-items:center;gap:6px;font-weight:normal' }, [ cb, band[1] ]));
		});

		var modeSel = E('select', { 'class': 'cbi-input-select', 'id': 'in-mode' },
			MODES.map(function(m) { return E('option', { 'value': m[0] }, m[1]); }));

		var info = E('table', { 'class': 'table' }, [
			row(_('Band aktif sekarang'), E('strong', { 'id': 'f-active' }, '–')),
			row(_('Kanal (EARFCN)'), E('code', { 'id': 'f-chan' }, '–')),
			row(_('Teknologi'), E('span', { 'id': 'f-tech' }, '–')),
			row(_('Band disetel'), E('span', { 'id': 'f-current' }, '–')),
			row(_('Mode preference'), E('span', { 'id': 'f-mode' }, '–')),
			row(_('Didukung modem'), E('span', { 'id': 'f-supported' }, '–'))
		]);

		var btnApply = E('button', { 'class': 'cbi-button cbi-button-apply', 'style': 'margin-right:8px' }, _('Terapkan'));
		var btnAuto  = E('button', { 'class': 'cbi-button cbi-button-reset' }, _('Kembali otomatis (semua band)'));

		function selected() {
			return LTE_BANDS.filter(function(band) { return boxes[band[0]].checked; })
				.map(function(band) { return 'eutran-' + band[0]; }).join(',');
		}

		btnApply.addEventListener('click', function() {
			var bands = selected();
			if (!bands) {
				ui.addNotification(null, E('p', {}, _('Pilih minimal satu band LTE, atau pakai tombol "Kembali otomatis".')), 'warning');
				return;
			}
			if (!confirm(_('Kunci ke band: ') + bands + _(' ? Koneksi data akan disambung ulang.'))) return;
			btnApply.disabled = true;
			callBandSet(bands, modeSel.value).then(function(r) {
				btnApply.disabled = false;
				ui.addNotification(null, E('p', {}, (r && r.msg) || '–'), r && r.ok ? 'info' : 'error');
			});
		});

		btnAuto.addEventListener('click', function() {
			if (!confirm(_('Buka semua band (eutran-1,3,5,7,38,39,40,41) dan mode otomatis?'))) return;
			btnAuto.disabled = true;
			callBandSet('eutran-1,eutran-3,eutran-5,eutran-7,eutran-38,eutran-39,eutran-40,eutran-41', 'automatic').then(function(r) {
				btnAuto.disabled = false;
				ui.addNotification(null, E('p', {}, (r && r.msg) || '–'), r && r.ok ? 'info' : 'error');
				LTE_BANDS.forEach(function(band) { boxes[band[0]].checked = false; });
			});
		});

		var root = E('div', {}, [
			E('h2', {}, _('Lock Band')),
			E('p', { 'class': 'cbi-section-descr' }, _('Batasi modem ke band LTE tertentu supaya tidak pindah-pindah sel (misal mau nahan di B3 1800 MHz). Setelah diterapkan, data disambung ulang otomatis.')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Status band')),
				E('div', { 'class': 'cbi-section-node' }, info)
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Pilih band LTE')),
				E('div', { 'class': 'cbi-section-node' }, [
					grid,
					E('div', { 'style': 'margin-top:12px' }, [
						E('label', { 'style': 'font-weight:normal' }, _('Mode jaringan: ')), modeSel
					]),
					E('div', { 'style': 'margin-top:12px' }, [ btnApply, btnAuto ])
				])
			])
		]);

		function paint(s) {
			if (!s) return;
			txt('f-active', s.active_band || '–');
			txt('f-chan', s.channel);
			txt('f-tech', s.tech);
			txt('f-current', s.current);
			txt('f-mode', s.mode);
			txt('f-supported', s.supported);
			if (!s.bands_loaded) {
				s.bands_loaded = true;
				var cur = (s.current || '');
				LTE_BANDS.forEach(function(band) {
					if (new RegExp('(^|[^0-9])' + band[0] + '([^0-9]|$)').test(cur) && cur.split(',').length === LTE_BANDS.filter(function(x) {
						return new RegExp('(^|[^0-9])' + x[0] + '([^0-9]|$)').test(cur);
					}).length)
						boxes[band[0]].checked = true;
				});
			}
		}

		qroot = root;
		paint(b);

		poll.add(function() {
			return L.resolveDefault(callBandGet(), {}).then(paint);
		}, 10);

		return root;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});