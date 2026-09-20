# Resource History (graph page)

Published artifact: https://claude.ai/artifact/8G8UUKqWRRMK3K4MkDjySS

`page.html` is the artifact source (`__EXAMPLE_JSON__` is replaced with
`example-export.json` at build time). It graphs the Sandbox Loop mod's history
export (`Balance ▸ History log ▸ Export` in game → `sandbox-loop-history-*.json`).

Export format (v1): `{ format, version, exportedAt, sampleMs, world, types{id→{name,color}},
loop{sources[],removers[]}, samples[{t, x(1=exact), c{type→count}, e{type→emit/s}, r{type→remove/s}, k(5-min keeper)}] }`
