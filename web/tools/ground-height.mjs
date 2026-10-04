// Measure the ground under a point of a Y-down splat PLY (3DGS/COLMAP axes).
// Fits a plane to the opaque splats of the lowest dense layer within a
// radius, and prints it in viewer (Y-up, flipped about X) coordinates.
// Usage: node tools/ground-height.mjs <scene.ply> <x> <z> [radius]
//   x, z are viewer coordinates (viewer z = -file z).
import { readPly, sigmoid } from "./ply.mjs";

const [file, vx, vz, r = "6"] = process.argv.slice(2);
if (!file || vx === undefined || vz === undefined) {
  console.error("Usage: node tools/ground-height.mjs <scene.ply> <x> <z> [radius]");
  process.exit(1);
}
const cx = Number(vx), cz = -Number(vz), radius = Number(r);

const { n, stride, P, f } = readPly(file);

const pts = [];
for (let i = 0; i < n; i++) {
  const o = i * stride;
  if (sigmoid(f[o + P.opacity]) < 0.5) continue;
  const dx = f[o + P.x] - cx, dz = f[o + P.z] - cz;
  if (dx * dx + dz * dz < radius * radius) pts.push([f[o + P.x], f[o + P.y], f[o + P.z]]);
}
if (pts.length < 50) throw new Error(`Only ${pts.length} opaque splats within radius ${radius}`);

// File is Y-down, so the ground is the dense layer with the largest y.
const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
const groundGuess = ys[Math.floor(0.9 * (ys.length - 1))];
const layer = pts.filter((p) => Math.abs(p[1] - groundGuess) < 2);

// Least-squares plane y = a*x + b*z + c over the ground layer.
let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sy = 0, sxy = 0, szy = 0;
for (const [x, y, z] of layer) {
  sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; sy += y; sxy += x * y; szy += z * y;
}
const m = layer.length;
const A = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, m]], B = [sxy, szy, sy];
const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
const D = det(A);
const solve = (k) => det(A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v)))) / D;
const [a, b, c] = [solve(0), solve(1), solve(2)];
const yAt = a * cx + b * cz + c;
const residual = Math.sqrt(layer.reduce((s, [x, y, z]) => s + (y - (a * x + b * z + c)) ** 2, 0) / m);

// Convert to viewer axes: (x, y, z) -> (x, -y, -z). Plane normal (up) there.
const up = [a, 1, -b]; // gradient of (-y) = -(a x + b z + c) w.r.t. viewer coords, normalised below
const len = Math.hypot(...up);
console.log(JSON.stringify({
  ground: +(-yAt).toFixed(3),
  up: up.map((v) => +(v / len).toFixed(4)),
  slopeDeg: +((Math.acos(1 / len) * 180) / Math.PI).toFixed(2),
  splatsInLayer: m,
  rmsResidual: +residual.toFixed(3),
}));
