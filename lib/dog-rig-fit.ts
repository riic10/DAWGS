import { Matrix4, Vector3 } from "three";

export type Segment = { start: Vector3; end: Vector3 };
export class DogRigFitError extends Error {}
export type DogRigFit = {
  toCanonical: Matrix4;
  fromCanonical: Matrix4;
  heading: number;
  ground: number;
  height: number;
  startsStanding: boolean;
  rest: Segment[];
};

export const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const quantile = (values: number[], amount: number) => {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * amount)];
};
const median = (points: Vector3[], axis: "x" | "y" | "z") => quantile(points.map(p => p[axis]), 0.5);
const bone = (start: Vector3, end: Vector3): Segment => ({ start: start.clone(), end: end.clone() });

// Fit in a height-normalized frame so the same animation works across export sizes and headings.
export function fitDogRig(input: readonly Vector3[], options: { reverse?: boolean; startsStanding?: boolean } = {}): DogRigFit {
  const points = input.filter(p => Number.isFinite(p.x + p.y + p.z));
  if (points.length < 100) throw new DogRigFitError("There isn't enough dog geometry to fit an animation.");
  const ground = quantile(points.map(p => p.y), 0.995);
  const top = quantile(points.map(p => p.y), 0.005);
  const height = ground - top;
  if (height < 1e-6) throw new DogRigFitError("The model is too flat to fit a dog skeleton.");
  const origin = points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(points.length).setY(ground);
  let xx = 0, zz = 0, xz = 0;
  for (const p of points) {
    const x = p.x - origin.x, z = p.z - origin.z;
    xx += x * x; zz += z * z; xz += x * z;
  }
  let heading = 0.5 * Math.atan2(2 * xz, xx - zz);
  const along = (p: Vector3) => (p.x - origin.x) * Math.cos(heading) + (p.z - origin.z) * Math.sin(heading);
  const upper = points.filter(p => p.y < top + height * 0.35);
  // A head contributes more upper-body mass than a thin raised tail.
  if (upper.reduce((sum, p) => sum + along(p), 0) > 0) heading += Math.PI;
  if (options.reverse) heading += Math.PI;
  const c = Math.cos(heading), s = Math.sin(heading);
  const toCanonical = new Matrix4().set(
    c / height, 0, s / height, -(c * origin.x + s * origin.z) / height,
    0, 1 / height, 0, -ground / height,
    -s / height, 0, c / height, (s * origin.x - c * origin.z) / height,
    0, 0, 0, 1,
  );
  const cloud = points.map(p => p.clone().applyMatrix4(toCanonical));
  const feet = cloud.filter(p => p.y > -0.09);
  let frontX = quantile(feet.map(p => p.x), 0.2);
  let rearX = quantile(feet.map(p => p.x), 0.8);
  for (let iteration = 0; iteration < 8; iteration++) {
    const split = (frontX + rearX) / 2;
    const front = feet.filter(p => p.x < split), rear = feet.filter(p => p.x >= split);
    if (!front.length || !rear.length) break;
    frontX = median(front, "x"); rearX = median(rear, "x");
  }
  const span = rearX - frontX;
  if (span < 0.18) throw new DogRigFitError("We couldn't separate the front and back legs. Try a full-body side view.");
  const bodyHeight = (x: number, percentile = 0.5) => {
    const slice = cloud.filter(p => Math.abs(p.x - x) < span * 0.13 && p.y < -0.06 && p.y > -0.8);
    return slice.length > 10 ? quantile(slice.map(p => p.y), percentile) : -0.48;
  };
  const shoulder = new Vector3(frontX + span * 0.08, bodyHeight(frontX + span * 0.15), 0);
  const hip = new Vector3(rearX - span * 0.12, bodyHeight(rearX - span * 0.15), 0);
  const startsStanding = options.startsStanding ?? hip.y - shoulder.y < 0.12;
  shoulder.y = bodyHeight(frontX + span * 0.15, 0.3);
  if (startsStanding) hip.y = bodyHeight(rearX - span * 0.15, 0.3);
  if (!startsStanding) hip.x = rearX + span * 0.08;
  const headPoints = cloud.filter(p => p.x < shoulder.x + span * 0.12 && p.y < -0.65);
  if (headPoints.length < 30) throw new DogRigFitError("We couldn't locate the dog's head. Try a clearer full-body photo.");
  const head = new Vector3(median(headPoints, "x"), median(headPoints, "y"), 0);
  const neck = new Vector3(shoulder.x - span * 0.05, Math.min(shoulder.y - 0.12, head.y + 0.22), 0);
  const tailPoints = cloud.filter(p => p.x > hip.x + span * 0.15 && Math.abs(p.z) < 0.12);
  const tailTip = tailPoints.length > 20
    ? new Vector3(quantile(tailPoints.map(p => p.x), 0.8), median(tailPoints, "y"), 0)
    : hip.clone().add(new Vector3(span * 0.25, 0.1, 0));
  const rest = [bone(shoulder, hip), bone(neck, head), bone(hip, tailTip)];
  const split = (frontX + rearX) / 2;
  for (const side of [-1, 1]) {
    const sideFeet = feet.filter(p => p.z * side > 0);
    const z = side * Math.max(0.055, sideFeet.length ? Math.abs(median(sideFeet, "z")) : 0.1);
    const paw = (front: boolean) => {
      const group = sideFeet.filter(p => front ? p.x < split : p.x >= split);
      const x = group.length ? quantile(group.map(p => p.x), !front && !startsStanding ? 0.2 : 0.5) : front ? frontX : rearX;
      return new Vector3(x, 0, z);
    };
    const frontPaw = paw(true), rearPaw = paw(false);
    const root = shoulder.clone().setZ(z), rearRoot = hip.clone().setZ(z);
    const elbow = root.clone().lerp(frontPaw, 0.5);
    const knee = rearRoot.clone().lerp(rearPaw, 0.42);
    knee.x -= span * (startsStanding ? 0.1 : 0.24);
    const hock = rearRoot.clone().lerp(rearPaw, 0.8);
    hock.x += span * 0.04;
    if (!startsStanding) hock.set(hip.x, -0.035, z);
    rest.push(bone(root, elbow), bone(elbow, frontPaw), bone(rearRoot, knee), bone(knee, hock), bone(hock, rearPaw));
  }
  return { toCanonical, fromCanonical: toCanonical.clone().invert(), heading, ground, height, startsStanding, rest };
}
