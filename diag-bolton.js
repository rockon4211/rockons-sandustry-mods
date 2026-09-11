
// =========================================================================
// TEMP DIAGNOSTIC (water recolor hunt) - remove after the test.
// The documented updateDefinition channel updates metaColor (grabber) but
// the world stays blue, so the live render scheme is somewhere else. This
// walks the sandkit object graph for every {scheme:{element:...}} it can
// reach and writes the orange variants straight into each, then reports
// where it found them (toast on main, console in the worker).
// =========================================================================
{
	const ORANGE = [[255, 140, 0, 255], [230, 126, 0, 255], [255, 157, 0, 255], [204, 112, 0, 255]];
	const found = [];   // {path, scheme}
	let hunted = 0, reported = false;

	function hunt() {
		found.length = 0;
		const seen = new Set();
		const stack = [];
		const roots = [];
		try { if (typeof sandkit !== "undefined" && sandkit) roots.push([sandkit, "sandkit"]); } catch (_) {}
		try { if (typeof sandkit !== "undefined" && sandkit && sandkit.state) roots.push([sandkit.state, "sandkit.state"]); } catch (_) {}
		for (const [o, p] of roots) stack.push([o, p, 0]);
		while (stack.length) {
			const [o, p, d] = stack.pop();
			if (!o || typeof o !== "object" || seen.has(o) || d > 4) continue;
			seen.add(o);
			try { if (o.nodeType) continue; } catch (_) { continue; }
			try {
				if (o.scheme && o.scheme.element && typeof o.scheme.element === "object") {
					found.push({ path: p + ".scheme", scheme: o.scheme });
					continue;
				}
				if (o.element && typeof o.element === "object" && o.soil) {
					found.push({ path: p, scheme: o });
					continue;
				}
			} catch (_) {}
			if (d >= 4) continue;
			let keys;
			try { keys = Object.keys(o); } catch (_) { continue; }
			if (keys.length > 400) continue;
			for (const k of keys) {
				let v;
				try { v = o[k]; } catch (_) { continue; }
				if (v && typeof v === "object") stack.push([v, p + "." + k, d + 1]);
			}
		}
		hunted++;
	}

	function paint() {
		const t = safe(() => api.elements.getTypeFromId("water"));
		if (typeof t !== "number") return;
		let n = 0;
		for (const f of found) {
			try { f.scheme.element[t] = { variants: ORANGE }; n++; } catch (_) {}
		}
		if (found.length && !reported) {
			reported = true;
			const msg = "diag: painted " + n + " scheme(s): " + found.map(f => f.path).join(" | ").slice(0, 160);
			console.log(`[${MOD_ID}] ${msg}`);
			safe(() => api.ui.toast(msg));
		}
	}

	function tick() { if (found.length === 0 || hunted % 5 === 0) hunt(); paint(); }
	tick();
	if (typeof setInterval === "function") setInterval(tick, 3000);
}
