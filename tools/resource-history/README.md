# Resource History (graph page)

Published artifact: https://claude.ai/artifact/8G8UUKqWRRMK3K4MkDjySS

`page.html` is the artifact source (`__EXAMPLE_JSON__` is replaced with
`example-export.json` at build time). It graphs the Sandbox Loop mod's history
export (`Balance ▸ History log ▸ Export` in game → `sandbox-loop-history-*.json`).

Export format (v1): `{ format, version, exportedAt, sampleMs, world, types{id→{name,color}},
loop{sources[],removers[]}, samples[{t, st, x(1=exact), c{type→count}, e{type→emit/s}, r{type→remove/s}, k(5-min keeper)}] }`

- `t` — wall-clock ms (Date.now()) when the sample was taken.
- `st` — game-time ms: the sim clock, which stops while the game is paused. Older
  exports lack it; the mod backfills it on load, and the page falls back to `t`
  (the "game time" x-axis needs `st`).
- `types[id].color` must be `#rrggbb`; anything else is drawn grey. Names and rates
  are HTML-escaped, since the file is untrusted input.
