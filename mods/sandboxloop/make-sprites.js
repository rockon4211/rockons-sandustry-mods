// Source (green hopper, emits) + Remover (passable red "delete zone" frame —
// no collision, so conveyors can slide material straight into it and it's eaten
// as it passes through). Both 48x48 = 12x12 cells.
const sharp = require("sharp");
const CW = 12, CH = 12, P = 4, W = CW * P, H = CH * P;

function blank() { return Buffer.alloc(W * H * 4, 0); }
function px(buf, x, y, c) { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = 4 * (x + y * W); buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = c[3]; }
function save(buf, name) { return sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(name); }

// --- Source: solid hopper stamped from its shape (unchanged look) ------------
function buildFromShape(name, shape, body, dark, accent) {
	const buf = blank();
	for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
		if (!shape[cy][cx]) continue;
		for (let py = 0; py < P; py++) for (let qx = 0; qx < P; qx++) {
			const x = cx * P + qx, y = cy * P + py;
			const outer = (qx === 0 || py === 0 || qx === P - 1 || py === P - 1);
			px(buf, x, y, outer ? dark : body);
		}
		px(buf, cx * P + 1, cy * P + 1, accent);
	}
	return save(buf, name);
}

// --- Remover: an open, passable frame — corner brackets + a bright top bar,
//     hollow interior, so it reads as a "zone" material flows THROUGH, not a
//     wall it piles against. -------------------------------------------------
function buildZone(name) {
	const buf = blank();
	const GLOW = [255, 180, 120, 255], EDGE = [210, 96, 96, 255], EDGE_D = [150, 60, 60, 255], DASH = [150, 60, 60, 200];
	const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(buf, x, y, c); };
	const B = 10; // bracket arm length in px
	// bright top bar (the "mouth" the conveyor feeds into)
	rect(0, 0, W - 1, 2, GLOW);
	// four corner L-brackets
	// top-left
	rect(0, 0, B, 3, EDGE); rect(0, 0, 3, B, EDGE);
	// top-right
	rect(W - 1 - B, 0, W - 1, 3, EDGE); rect(W - 4, 0, W - 1, B, EDGE);
	// bottom-left
	rect(0, H - 4, B, H - 1, EDGE_D); rect(0, H - 1 - B, 3, H - 1, EDGE_D);
	// bottom-right
	rect(W - 1 - B, H - 4, W - 1, H - 1, EDGE_D); rect(W - 4, H - 1 - B, W - 1, H - 1, EDGE_D);
	// faint dashed side hints so the box shape reads, but clearly open
	for (let y = 6; y < H - 6; y += 6) { rect(0, y, 1, y + 2, DASH); rect(W - 2, y, W - 1, y + 2, DASH); }
	return save(buf, name);
}

const SRC = [[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[0,0,0,0,1,1,1,1,0,0,0,0],[0,0,0,0,1,0,0,1,0,0,0,0]];
Promise.all([
	buildFromShape("source.png", SRC, [72,150,96,255], [44,96,60,255], [150,220,170,255]),
	buildZone("sink.png"),
]).then(() => console.log("wrote source.png + sink.png (passable zone)"));
