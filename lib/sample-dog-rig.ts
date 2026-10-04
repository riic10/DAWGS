import { Matrix4, Quaternion, Vector3, Vector4 } from "three";
import { SplatSkinning, SplatSkinningMode, type SplatMesh } from "@sparkjsdev/spark";
import type { DogMotion } from "./dog-motion";

type Segment = { start: Vector3; end: Vector3 };
const point = (x: number, y: number, z = 0) => new Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// These landmarks belong to dog_model.ply with forward along negative X and down along positive Y.
export function createSampleDogRig(mesh: SplatMesh) {
  const rest: Segment[] = [
    { start: point(-0.14, -0.02), end: point(0.24, 0.23) },
    { start: point(-0.15, -0.13), end: point(-0.18, -0.32) },
    { start: point(0.34, 0.22), end: point(0.39, 0.42) },
  ];
  for (const side of [-1, 1]) {
    const z = side * 0.105;
    rest.push(
      { start: point(-0.15, 0.04, z), end: point(-0.185, 0.22, z) },
      { start: point(-0.185, 0.22, z), end: point(-0.27, 0.405, z) },
      { start: point(0.24, 0.23, z), end: point(0.12, 0.32, z) },
      { start: point(0.12, 0.32, z), end: point(0.25, 0.385, z) },
      { start: point(0.25, 0.385, z), end: point(0.14, 0.405, z) },
    );
  }
  const skin = new SplatSkinning({ mesh, numBones: rest.length, mode: SplatSkinningMode.LINEAR_BLEND });
  const identity = new Matrix4();
  rest.forEach((_, i) => skin.setRestMatrix(i, identity));
  const indices = new Vector4();
  const weights = new Vector4();
  const delta = new Vector3();
  const closest = new Vector3();
  const distance = (p: Vector3, bone: Segment) => {
    delta.subVectors(bone.end, bone.start);
    const t = Math.max(0, Math.min(1, closest.subVectors(p, bone.start).dot(delta) / delta.lengthSq()));
    return closest.copy(bone.start).addScaledVector(delta, t).distanceToSquared(p);
  };
  mesh.forEachSplat((index, p) => {
    const head = 1 - smooth(-0.14, -0.055, p.y);
    const tail = smooth(0.32, 0.365, p.x) * smooth(0.12, 0.24, p.y);
    const front = (1 - smooth(-0.19, -0.105, p.x)) * smooth(0.055, 0.17, p.y);
    const rear = smooth(-0.005, 0.09, p.x) * smooth(0.16, 0.29, p.y) * (1 - tail);
    const side = smooth(-0.035, 0.035, p.z);
    const scores: [number, number][] = [[0, Math.max(0.001, (1 - head) * (1 - front) * (1 - rear) * (1 - tail))], [1, head], [2, tail]];
    for (let s = 0; s < 2; s++) {
      const base = 3 + s * 5;
      for (const [start, count, strength] of [[base, 2, front], [base + 2, 3, rear]]) {
        const values = Array.from({ length: count }, (_, k) => 1 / (0.0006 + distance(p, rest[start + k])) ** 2);
        const total = values.reduce((a, b) => a + b, 0);
        values.forEach((v, k) => scores.push([start + k, strength * (s ? side : 1 - side) * v / total]));
      }
    }
    scores.sort((a, b) => b[1] - a[1]);
    const total = scores.slice(0, 4).reduce((sum, item) => sum + item[1], 0);
    indices.set(...scores.slice(0, 4).map(([i]) => i) as [number, number, number, number]);
    weights.set(...scores.slice(0, 4).map(([, w]) => w / total) as [number, number, number, number]);
    skin.setSplatBones(index, indices, weights);
  });
  skin.skinTexture.needsUpdate = true;
  mesh.skinning = skin;
  mesh.updateGenerator();
  const posed = rest.map(b => ({ start: b.start.clone(), end: b.end.clone() }));
  const rotation = new Quaternion();
  const transform = new Matrix4();
  const stretch = new Matrix4();
  const translation = new Matrix4();
  const unit = new Vector3(1, 1, 1);
  const from = new Vector3();
  const to = new Vector3();
  const set = (i: number, start: Vector3, end: Vector3, amount: number) => {
    posed[i].start.copy(rest[i].start).lerp(start, amount);
    posed[i].end.copy(rest[i].end).lerp(end, amount);
  };
  return {
    update(motion: DogMotion) {
      const stand = smooth(0, 1, motion.stand);
      const gait = motion.stride * stand;
      const bob = Math.cos(motion.phase * 4) * 0.003 * gait;
      set(0, point(-0.14, -0.02 + bob), point(0.315, -0.02 + bob), stand);
      set(1, point(-0.15, -0.13 + bob), point(-0.20, -0.31 + bob), stand);
      set(2, point(0.395, -0.015 + bob), point(0.49, 0.12 + bob, Math.sin(motion.phase) * 0.035 * gait), stand);
      for (let s = 0; s < 2; s++) {
        const z = (s ? 1 : -1) * 0.105;
        const base = 3 + s * 5;
        const direction = motion.speed === 0 && motion.turn !== 0 ? (s ? 1 : -1) * motion.turn : 1;
        const cycle = motion.phase * direction + s * Math.PI;
        const step = (phase: number) => {
          const t = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
          // Keep each paw on the floor through the longer stance, then lift it for the return.
          if (t < 0.6) return { swing: (t / 0.6 - 0.5) * 0.15 * gait, lift: 0 };
          const swing = (t - 0.6) / 0.4;
          return { swing: (0.5 - smooth(0, 1, swing)) * 0.15 * gait, lift: Math.sin(swing * Math.PI) ** 2 * 0.035 * gait };
        };
        const { swing: frontSwing, lift: frontLift } = step(cycle);
        const { swing: rearSwing, lift: rearLift } = step(cycle + Math.PI / 2);
        const shoulder = point(-0.15, 0.04 + bob, z);
        const elbow = point(-0.18 + frontSwing * 0.5, 0.22 - frontLift * 0.5, z);
        const frontPaw = point(-0.255 + frontSwing, 0.405 - frontLift, z);
        const hip = point(0.315, -0.02 + bob, z);
        const knee = point(0.205 + rearSwing * 0.5, 0.14 - rearLift * 0.5, z);
        const hock = point(0.32 + rearSwing, 0.30 - rearLift, z);
        const rearPaw = point(0.25 + rearSwing, 0.405 - rearLift, z);
        set(base, shoulder, elbow, stand);
        set(base + 1, elbow, frontPaw, stand);
        set(base + 2, hip, knee, stand);
        set(base + 3, knee, hock, stand);
        set(base + 4, hock, rearPaw, stand);
      }
      rest.forEach((bone, i) => {
        from.subVectors(bone.end, bone.start);
        to.subVectors(posed[i].end, posed[i].start);
        const extension = to.length() / from.length() - 1;
        from.normalize();
        to.normalize();
        rotation.setFromUnitVectors(from, to);
        const { x, y, z } = from;
        // Stretch along the bone so reconstructed short limbs reach their animated joints.
        stretch.set(1 + extension*x*x, extension*x*y, extension*x*z, 0,
          extension*y*x, 1 + extension*y*y, extension*y*z, 0,
          extension*z*x, extension*z*y, 1 + extension*z*z, 0,
          0, 0, 0, 1);
        transform.compose(posed[i].start, rotation, unit).multiply(stretch)
          .multiply(translation.makeTranslation(-bone.start.x, -bone.start.y, -bone.start.z));
        skin.setBoneMatrix(i, transform);
      });
      skin.updateBones();
    },
    dispose() {
      mesh.skinning = null;
      skin.skinTexture.dispose();
      skin.boneTexture.dispose();
    },
  };
}
