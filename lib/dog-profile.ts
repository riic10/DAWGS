import { Matrix4, Vector3 } from "three";
import { DogRigFitError, fitDogRig } from "./dog-rig-fit";

export type Segment = { start: Vector3; end: Vector3 };
export const LEG_BASES = [4, 7, 10, 13] as const;
export const SHOULDERS = [16, 17] as const;
export const PELVIS = 18;
export const JAW = 19;
export type DogMouth = { hinge: Vector3; upperLip: Vector3; lowerLip: Vector3; width: number; nativeAngle: number };
export type DogCalibration = {
  reverse?: boolean;
  startsStanding?: boolean;
  points?: Record<string, [number, number, number]>;
  mouthWidth?: number;
};
export type DogProfile = {
  rest: Segment[];
  sample: boolean;
  unit: number;
  floor: number;
  startsStanding: boolean;
  toCanonical: Matrix4;
  fromCanonical: Matrix4;
  heading: number;
  ground: number;
  height: number;
  sittingChest: Vector3;
  standingChest: Vector3;
  sittingAngle: number;
  standingAngle: number;
  pickupShift: Vector3;
  pickupAngle: number;
  sittingPaws: Vector3[];
  standingPaws: Vector3[];
  rearFootAngles: [number, number];
  gaitDrop: number;
  cycleScale: number;
  shoulderSwing: number;
  mouth: DogMouth;
  landmarks?: Record<string, Vector3>;
};

const bones = [
  ["chest", "hips"], ["chest", "neck"], ["neck", "head"], ["tailBase", "tailTip"],
  ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"], ["leftWrist", "leftFrontPaw"],
  ["leftHip", "leftKnee"], ["leftKnee", "leftHock"], ["leftHock", "leftRearPaw"],
  ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"], ["rightWrist", "rightFrontPaw"],
  ["rightHip", "rightKnee"], ["rightKnee", "rightHock"], ["rightHock", "rightRearPaw"],
  ["leftScapula", "leftShoulder"], ["rightScapula", "rightShoulder"],
  ["hips", "pelvisTip"], ["jawHinge", "lowerLip"],
];
const quantile = (values: number[], t: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * t)];
const point = (x: number, y: number, z = 0) => new Vector3(x, y, z);

export function fitDogProfile(points: readonly Vector3[], calibration: DogCalibration = {}): DogProfile {
  const fit = fitDogRig(points, calibration);
  const cloud = points.filter(p => Number.isFinite(p.x + p.y + p.z)).map(p => p.clone().applyMatrix4(fit.toCanonical));
  const { startsStanding } = fit;
  const u = 1 / 0.849;
  const chest = fit.rest[0].start.clone(), hips = fit.rest[0].end.clone();
  const span = hips.x - chest.x;
  const head = fit.rest[1].end.clone();
  const headPoints = cloud.filter(p => p.x < chest.x && p.y < -0.62);
  if (headPoints.length < 30) throw new DogRigFitError("We couldn't locate the muzzle. Use a full dog with its head facing forward.");
  const noseX = quantile(headPoints.map(p => p.x), 0.025);
  const muzzle = headPoints.filter(p => p.x < noseX + 0.09 * u);
  if (muzzle.length < 10) throw new DogRigFitError("There isn't enough muzzle geometry to fit the jaw.");
  const lip = point(noseX + 0.015 * u, quantile(muzzle.map(p => p.y), 0.68));
  const hinge = point(Math.min(head.x + 0.025 * u, lip.x + 0.19 * u), lip.y - 0.015 * u);
  const width = Math.max(0.035, Math.min(0.16, quantile(muzzle.map(p => Math.abs(p.z)), 0.8) * 2));
  const jawPoints = headPoints.filter(p => p.x < lip.x + 0.08 * u && p.y > lip.y + 0.02 * u
    && p.y < lip.y + 0.12 * u && Math.abs(p.z) < width * 0.45);
  const lowerLip = lip.clone();
  if (jawPoints.length > 20) {
    const front = quantile(jawPoints.map(p => p.x), 0.1);
    const tip = jawPoints.filter(p => p.x < front + 0.025 * u);
    lowerLip.set(front, quantile(tip.map(p => p.y), 0.5), 0);
  }
  const raisedTail = cloud.filter(p => p.x > hips.x - span * 0.35 && p.y < hips.y - 0.12 && Math.abs(p.z) < 0.1);
  const tailTip = fit.rest[2].end.clone();
  const hasRaisedTail = startsStanding && raisedTail.length > 30;
  if (hasRaisedTail) {
    const top = quantile(raisedTail.map(p => p.y), 0.1);
    const tip = raisedTail.filter(p => p.y <= top);
    tailTip.set(quantile(tip.map(p => p.x), 0.5), top, 0);
  }
  const landmarks: Record<string, Vector3> = {
    chest, hips, neck: fit.rest[1].start.clone(), head,
    tailBase: hips.clone().add(point(span * 0.10, hasRaisedTail ? -0.08 : 0.06)), tailTip,
    pelvisTip: hips.clone().add(point(0.08 * u, 0.01 * u)),
    jawHinge: hinge, upperLip: lip, lowerLip,
  };
  for (const [side, name] of ["left", "right"].entries()) {
    const base = 3 + side * 5;
    const shoulder = fit.rest[base].start.clone();
    const paw = fit.rest[base + 1].end.clone();
    const wrist = paw.clone().add(point(0.005 * u, -0.045 * u));
    const elbow = shoulder.clone().lerp(wrist, 0.5).add(point(0.045 * u, 0));
    Object.assign(landmarks, {
      [`${name}Scapula`]: shoulder.clone().add(point(0.08 * u, -0.07 * u)),
      [`${name}Shoulder`]: shoulder, [`${name}Elbow`]: elbow,
      [`${name}Wrist`]: wrist, [`${name}FrontPaw`]: paw,
      [`${name}Hip`]: fit.rest[base + 2].start.clone(),
      [`${name}Knee`]: fit.rest[base + 2].end.clone(),
      [`${name}Hock`]: fit.rest[base + 3].end.clone(),
      [`${name}RearPaw`]: fit.rest[base + 4].end.clone(),
    });
  }
  for (const [name, values] of Object.entries(calibration.points ?? {})) {
    if (!landmarks[name] || values.length !== 3 || !values.every(v => Number.isFinite(v) && Math.abs(v) <= 3)) {
      throw new DogRigFitError("Joint positions must be within three dog heights of the model.");
    }
    landmarks[name].fromArray(values);
  }
  const mouthWidth = calibration.mouthWidth ?? width;
  if (!Number.isFinite(mouthWidth) || mouthWidth < 0.01 || mouthWidth > 0.5) throw new DogRigFitError("Choose a mouth width between 1% and 50% of the dog's height.");
  const palate = landmarks.upperLip.clone().sub(landmarks.jawHinge);
  if (palate.length() < 0.03 || palate.x > -0.015) throw new DogRigFitError("Place the upper lip in front of the jaw hinge.");
  const lower = landmarks.lowerLip.clone().sub(landmarks.jawHinge);
  if (Math.abs(palate.z) > 1e-8 || Math.abs(lower.z) > 1e-8) throw new DogRigFitError("Keep the jaw hinge and both lips in the same side plane.");
  const nativeAngle = Math.atan2(palate.y * lower.x - palate.x * lower.y, palate.x * lower.x + palate.y * lower.y);
  if (lower.length() < 0.03 || lower.x > -0.015) throw new DogRigFitError("Place the lower lip in front of the jaw hinge.");
  if (nativeAngle < 0 || nativeAngle > 1) throw new DogRigFitError("Place the lower lip below the upper lip, with less than a 57 degree opening.");
  const rest = bones.map(([a, b]) => ({ start: landmarks[a].clone(), end: landmarks[b].clone() }));
  if (hips.x - chest.x < 0.1) throw new DogRigFitError("Place the hips behind the chest.");
  if (rest.some(b => b.start.distanceTo(b.end) < 0.008)) throw new DogRigFitError("Adjacent joints need some space between them.");
  for (const base of LEG_BASES) {
    const bend = rest[base].end.clone().sub(rest[base].start).angleTo(rest[base + 1].end.clone().sub(rest[base + 1].start));
    if (bend < 0.1 || bend > 2.85) throw new DogRigFitError("Give each elbow and knee a slight bend without folding the leg completely.");
  }
  const restAngle = Math.atan2(hips.y - chest.y, hips.x - chest.x);
  const length = chest.distanceTo(hips);
  const standingChest = chest.clone().add(startsStanding ? point(0, 0) : point(-0.10 * u, 0.045 * u));
  const sittingAngle = startsStanding ? Math.asin(Math.min(0.9, Math.max(0.15, (-0.16 - chest.y) / length))) : restAngle;
  const standingAngle = startsStanding ? restAngle : 0.17;
  const sittingPaws = LEG_BASES.map(base => rest[base + 2].end.clone());
  const standingPaws = sittingPaws.map(p => p.clone());
  const seatedHipX = chest.x + length * Math.cos(sittingAngle);
  for (const i of [1, 3]) {
    if (startsStanding) sittingPaws[i].x = seatedHipX - 0.13 * u;
    else standingPaws[i].x += 0.065 * u;
  }
  const reach = rest[1].start.distanceTo(rest[1].end) + rest[2].start.distanceTo(landmarks.upperLip);
  const rearFootAngles: [number, number] = startsStanding ? [0.875, 0] : [0, -0.875];
  const gaitDrop = 0.055 * u;
  const strideMargins = LEG_BASES.map((base, i) => {
    const root = rest[base].start.clone().sub(chest).applyAxisAngle(point(0, 0, 1), standingAngle - restAngle).add(standingChest);
    const toe = rest[base + 2].end.clone().sub(rest[base + 2].start).applyAxisAngle(point(0, 0, 1), i % 2 ? rearFootAngles[1] : 0);
    const ankle = standingPaws[i].clone().sub(toe);
    const length = rest[base].start.distanceTo(rest[base].end) + rest[base + 1].start.distanceTo(rest[base + 1].end);
    const vertical = ankle.y - root.y - gaitDrop + (i % 2 ? 0 : 0.018 * u);
    return Math.sqrt(Math.max(0, (length * 0.995) ** 2 - vertical ** 2 - (ankle.z - root.z) ** 2)) - Math.abs(ankle.x - root.x);
  });
  const cycleScale = Math.max(0.35, Math.min(1, Math.min(...strideMargins) * 0.72 / (0.16 * u)));
  return {
    rest, sample: false, unit: u, floor: 0, startsStanding,
    toCanonical: fit.toCanonical, fromCanonical: fit.fromCanonical,
    heading: fit.heading, ground: fit.ground, height: fit.height,
    sittingChest: chest.clone(), standingChest, sittingAngle, standingAngle,
    pickupShift: point(-0.04 * u, Math.min(0.28 * u, Math.max(length * Math.sin(0.12) + 0.08 * u, -0.82 * reach - standingChest.y))),
    pickupAngle: -0.12, sittingPaws, standingPaws,
    rearFootAngles, gaitDrop, cycleScale, shoulderSwing: 0.2,
    mouth: { hinge: landmarks.jawHinge, upperLip: landmarks.upperLip, lowerLip: landmarks.lowerLip, width: mouthWidth, nativeAngle },
    landmarks,
  };
}
