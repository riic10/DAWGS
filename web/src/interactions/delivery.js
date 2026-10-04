import { Vector3 } from "three";

// Search only connected ground so a camera outside the scene still gets a reachable delivery.
export function planDelivery({ start, camera, ground, unitsPerMeter: upm, clearance, reach, height = 0.4 * upm }) {
  const cell = 0.2 * upm;
  const direction = camera.getWorldDirection(new Vector3());
  direction.y = 0;
  if (direction.lengthSq() < 1e-6) direction.subVectors(start, camera.position).setY(0);
  direction.normalize();
  camera.updateMatrixWorld();
  const projected = new Vector3();
  const inView = (x, y, z) => {
    projected.set(x, y, z).project(camera);
    return Math.abs(projected.x) < 0.82 && projected.y > -0.78 && projected.y < 0.82
      && projected.z > -1 && projected.z < 1;
  };
  const ideal = camera.position.clone().addScaledVector(direction, Math.max(0.9 * upm, reach + 0.45 * upm));
  const margin = 1.5 * upm;
  const minX = Math.floor((Math.min(start.x, ideal.x) - start.x - margin) / cell);
  const maxX = Math.ceil((Math.max(start.x, ideal.x) - start.x + margin) / cell);
  const minZ = Math.floor((Math.min(start.z, ideal.z) - start.z - margin) / cell);
  const maxZ = Math.ceil((Math.max(start.z, ideal.z) - start.z + margin) / cell);
  const samples = new Map();
  const key = (x, z) => `${x},${z}`;
  const free = (x, z, radius = clearance) => {
    const center = ground.at(x, z);
    if (!center || center.blocked || center.normal.y < 0.7) return null;
    for (let side = 0; side < 8 && radius > 0; side++) {
      const angle = side * Math.PI / 4;
      const edge = ground.at(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
      if (!edge || edge.blocked || Math.abs(edge.y - center.y) > radius * 0.8 + 0.04 * upm) return null;
    }
    return center;
  };
  const leavingEdge = Boolean(free(start.x, start.z, 0)) && !free(start.x, start.z);
  const sample = (i, k) => {
    const id = key(i, k);
    if (!samples.has(id)) {
      const x = start.x + i * cell, z = start.z + k * cell;
      const G = free(x, z);
      samples.set(id, G ? new Vector3(x, G.y, z) : null);
    }
    return samples.get(id);
  };
  const clearLine = (a, b) => {
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / (cell * 0.5)));
    let height = a.y;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      // A pickup beside furniture must be able to step out of its existing clearance overlap.
      const radius = leavingEdge ? Math.min(clearance, Math.hypot(x - start.x, z - start.z)) : clearance;
      const G = free(x, z, radius);
      if (!G || Math.abs(G.y - height) > 0.12 * upm) return false;
      height = G.y;
    }
    return true;
  };
  const queue = [{ i: 0, k: 0, point: start.clone(), parent: -1 }];
  const visited = new Set([key(0, 0)]);
  let best = -1, bestScore = Infinity;
  for (let index = 0; index < queue.length && index < 12000; index++) {
    const node = queue[index], p = node.point;
    const dx = camera.position.x - p.x, dz = camera.position.z - p.z;
    const distance = Math.hypot(dx, dz);
    const drop = distance > 1e-6 && free(p.x + dx / distance * reach, p.z + dz / distance * reach, 0);
    if (drop && free(p.x, p.z) && inView(p.x, p.y + height, p.z)
      && inView(p.x + dx / distance * reach, drop.y, p.z + dz / distance * reach)) {
      const score = (p.x - ideal.x) ** 2 + (p.z - ideal.z) ** 2;
      if (score < bestScore) { best = index; bestScore = score; }
    }
    for (const [di, dk] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const i = node.i + di, k = node.k + dk, id = key(i, k);
      if (i < minX || i > maxX || k < minZ || k > maxZ || visited.has(id)) continue;
      const point = sample(i, k);
      if (!point || clearLine(p, point)) {
        visited.add(id);
        if (point) queue.push({ i, k, point, parent: index });
      }
    }
  }
  if (best < 0) return null;
  const path = [];
  for (let index = best; index >= 0; index = queue[index].parent) path.push(queue[index].point);
  path.reverse();
  const points = [];
  for (let index = 0; index < path.length - 1;) {
    let next = path.length - 1;
    while (next > index + 1 && !clearLine(path[index], path[next])) next--;
    points.push(path[next]);
    index = next;
  }
  if (!points.length) points.push(path[0]);
  const end = points.at(-1);
  return { points, facing: Math.atan2(camera.position.x - end.x, camera.position.z - end.z) };
}
