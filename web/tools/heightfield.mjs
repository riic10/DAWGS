// Build a ground heightfield from a Y-down splat PLY (3DGS/COLMAP axes) for
// the viewer's ball physics and the dog's fetch run. Output is in viewer
// coordinates (file (x, y, z) -> viewer (x, -y, -z)).
//
// Usage: node tools/heightfield.mjs <scene.ply> <out.json> <x0> <x1> <z0> <z1> [cell] [unitsPerMeter]
//
// Per cell: the ground is the lowest dense layer of opaque splats (same idea
// as tools/ground-height.mjs). A cell is "blocked" (tree, rock, bush) when
// many opaque splats sit 0.3–2.5 m above that ground. Cells with too little
// data are blocked too.
import { writeFileSync } from "node:fs";
import { readPly, sigmoid } from "./ply.mjs";

const [file, out, ...rest] = process.argv.slice(2);
if (!file || !out || rest.length < 4) {
  console.error("Usage: node tools/heightfield.mjs <scene.ply> <out.json> <x0> <x1> <z0> <z1> [cell] [unitsPerMeter]");
  process.exit(1);
}
const [x0, x1, z0, z1] = rest.slice(0, 4).map(Number);
const cell = Number(rest[4] ?? 1);
const unitsPerMeter = Number(rest[5] ?? 10);
const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);

const MIN_SPLATS = 12; // fewer opaque splats than this in a cell: no data
const LAYER = 0.2 * unitsPerMeter; // ground layer half-thickness
const BLOCK_LOW = 0.3 * unitsPerMeter, BLOCK_HIGH = 2.5 * unitsPerMeter;
const BLOCK_SPLATS = 15; // this many splats in the band above ground: blocked

const { n, stride, P, f } = readPly(file);
const cells = Array.from({ length: nx * nz }, () => []);
for (let i = 0; i < n; i++) {
  const o = i * stride;
  if (sigmoid(f[o + P.opacity]) < 0.5) continue;
  const x = f[o + P.x], y = -f[o + P.y], z = -f[o + P.z];
  const cx = Math.floor((x - x0) / cell), cz = Math.floor((z - z0) / cell);
  if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
  cells[cz * nx + cx].push(y);
}

const heights = new Float32Array(nx * nz).fill(NaN);
const blocked = new Uint8Array(nx * nz);
for (let k = 0; k < cells.length; k++) {
  const ys = cells[k].sort((a, b) => a - b);
  if (ys.length < MIN_SPLATS) { blocked[k] = 1; continue; }
  // Viewer Y is up: the ground is the low end. Start from the 10th percentile
  // and take the median of the layer around it.
  const guess = ys[Math.floor(0.1 * (ys.length - 1))];
  const layer = ys.filter((y) => Math.abs(y - guess) < LAYER);
  const g = layer[Math.floor(layer.length / 2)];
  heights[k] = g;
  const above = ys.filter((y) => y > g + BLOCK_LOW && y < g + BLOCK_HIGH).length;
  if (above >= BLOCK_SPLATS) blocked[k] = 1;
}

// Fill holes from neighbours, then 3x3 median to knock out single-cell spikes.
function neighbours(src, cx, cz) {
  const v = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, z = cz + dz;
    if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
    const h = src[z * nx + x];
    if (!Number.isNaN(h)) v.push(h);
  }
  return v.sort((a, b) => a - b);
}
for (let pass = 0; pass < 3; pass++) {
  const src = heights.slice();
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) {
    if (!Number.isNaN(src[cz * nx + cx])) continue;
    const v = neighbours(src, cx, cz);
    if (v.length >= 3) heights[cz * nx + cx] = v[Math.floor(v.length / 2)];
  }
}
const filled = heights.slice();
for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) {
  if (Number.isNaN(filled[cz * nx + cx])) continue;
  const v = neighbours(filled, cx, cz);
  heights[cz * nx + cx] = v[Math.floor(v.length / 2)];
}

const missing = heights.reduce((s, h) => s + Number.isNaN(h), 0);
const nBlocked = blocked.reduce((s, b) => s + b, 0);
writeFileSync(out, JSON.stringify({
  x0, z0, cell, nx, nz,
  heights: Array.from(heights, (h) => (Number.isNaN(h) ? null : Math.round(h * 100) / 100)),
  blocked: Array.from(blocked).join(""),
}));
console.log(`${nx}x${nz} cells -> ${out}: ${missing} without height, ${nBlocked} blocked`);
