import * as THREE from "three";

// Ground queries over a heightfield written by tools/heightfield.mjs.
// at(x, z) -> { y, normal, blocked } in viewer coordinates, or null outside
// the grid or where there's no ground data (treated as a wall).
export async function loadHeightfield(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  const { x0, z0, cell, nx, nz, heights, blocked } = await res.json();

  const h = (i, k) => (i < 0 || k < 0 || i >= nx || k >= nz ? null : heights[k * nx + i]);

  // Bilinear between cell centres, skipping cells without data.
  function heightAt(x, z) {
    const fx = (x - x0) / cell - 0.5;
    const fz = (z - z0) / cell - 0.5;
    const i = Math.floor(fx), k = Math.floor(fz);
    const tx = fx - i, tz = fz - k;
    let sum = 0, wsum = 0;
    for (const [di, dk, w] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]]) {
      const v = h(i + di, k + dk);
      if (v === null || w === 0) continue;
      sum += v * w;
      wsum += w;
    }
    return wsum > 0 ? sum / wsum : null;
  }

  return {
    at(x, z) {
      const i = Math.floor((x - x0) / cell), k = Math.floor((z - z0) / cell);
      if (h(i, k) === null) return null;
      const y = heightAt(x, z);
      const e = cell;
      const slope = (a, b) => (a === null || b === null ? 0 : (a - b) / (2 * e));
      const hx = slope(heightAt(x + e, z), heightAt(x - e, z));
      const hz = slope(heightAt(x, z + e), heightAt(x, z - e));
      return {
        y,
        normal: new THREE.Vector3(-hx, 1, -hz).normalize(),
        blocked: blocked[k * nx + i] === "1",
      };
    },
  };
}
