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

// --- Remover: an OPEN TRAY — a thin solid floor (bottom 2 rows) with a bright
//     top surface line, no side walls and an open top, so a conveyor can slide
//     material straight on and it collects on the floor to be deleted. The floor
//     gives it a real footprint (so it renders and can be removed normally). ---
function buildTray(name) {
	const buf = blank();
	const GLOW = [255, 180, 120, 255], FLOOR = [170, 74, 74, 255], FLOOR_D = [110, 46, 46, 255], POST = [200, 96, 96, 255];
	const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(buf, x, y, c); };
	// floor = bottom 2 cells (rows 10-11 => px 40..47)
	rect(0, 40, W - 1, 47, FLOOR);
	rect(0, 46, W - 1, 47, FLOOR_D);        // darker underside
	rect(0, 40, W - 1, 41, GLOW);           // glowing top surface (where material lands / is eaten)
	// short corner posts so it reads as a tray, not a full slab (kept low: 3 cells)
	rect(0, 28, 2, 39, POST); rect(W - 3, 28, W - 1, 39, POST);
	return save(buf, name);
}

const SRC = [[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1,1],[0,0,0,0,1,1,1,1,0,0,0,0],[0,0,0,0,1,0,0,1,0,0,0,0]];
Promise.all([
	buildFromShape("source.png", SRC, [72,150,96,255], [44,96,60,255], [150,220,170,255]),
	buildTray("sink.png"),
]).then(() => console.log("wrote source.png + sink.png (passable zone)"));
