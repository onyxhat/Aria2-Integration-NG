'use strict';

// Minimal in-memory stand-in for the parts of the WebExtension `browser`
// API that App/lib/tools.js touches. Supports promise and callback styles.
function makeBrowserStub(initial) {
	let data = clone(initial || {});

	function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

	function pick(keys) {
		if (keys === null || keys === undefined) return clone(data);
		if (typeof keys === 'string') keys = [keys];
		const out = {};
		if (Array.isArray(keys)) {
			for (const k of keys) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = clone(data[k]);
		} else {
			for (const k of Object.keys(keys)) {
				out[k] = Object.prototype.hasOwnProperty.call(data, k) ? clone(data[k]) : keys[k];
			}
		}
		return out;
	}

	const local = {
		get(keys, cb) { const r = pick(keys); if (typeof cb === 'function') { cb(r); return; } return Promise.resolve(r); },
		set(obj, cb) { Object.assign(data, clone(obj)); if (typeof cb === 'function') { cb(); return; } return Promise.resolve(); },
		remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete data[k]; }); if (typeof cb === 'function') { cb(); return; } return Promise.resolve(); },
		clear(cb) { data = {}; if (typeof cb === 'function') { cb(); return; } return Promise.resolve(); },
		_dump() { return clone(data); },
	};

	return {
		storage: { local },
		i18n: { getMessage: (k) => k },
	};
}

module.exports = { makeBrowserStub };
