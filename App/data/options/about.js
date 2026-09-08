'use strict';

function restore() {
	document.querySelectorAll('[data-message]').forEach(n => {
		n.textContent = browser.i18n.getMessage(n.dataset.message);
	});
	document.body.style = "direction: " + browser.i18n.getMessage("direction");

	// Connection Status
	getServers().then(function (servers) {
		var box = document.getElementById('serverStatus');
		box.textContent = '';
		servers.forEach(function (s) {
			var p = document.createElement('p');
			var label = document.createElement('span');
			label.textContent = ((s.name && s.name.trim()) || (s.host + ':' + s.port)) + ': ';
			var val = document.createElement('i');
			val.textContent = '...';
			p.appendChild(label);
			p.appendChild(val);
			box.appendChild(p);

			var proto = (s.protocol || '').toLowerCase();
			var sec = proto == 'https' || proto == 'wss';
			var aria2 = new Aria2({ host: s.host, port: s.port, secure: sec, secret: s.token, path: '/' + s.interf });
			aria2.getVersion().then(
				function (res) { val.textContent = 'version ' + res.version + ' detected'; },
				function (err) { val.textContent = String((err && err.message) || err); }
			);
		});
	});
}

document.addEventListener('DOMContentLoaded', restore);