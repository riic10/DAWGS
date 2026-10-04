import { Matrix4, Quaternion, Vector3 } from "three";
import type { DogMotion } from "./dog-motion";

export type Segment = { start: Vector3; end: Vector3 };
export type DogAttention = { target?: Vector3 | null; pickup?: number };
export type GroundHeight = (point: Vector3) => number | undefined;
const point = (x: number, y: number, z = 0) => new Vector3(x, y, z);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const Y = point(0, 1), Z = point(0, 0, 1);
const FLOOR = 0.405;
const STANCE = 0.56;
const CYCLE_DISTANCE = 0.52;
export const LEG_BASES = [4, 7, 10, 13] as const;

// The landmarks use the sample scan's coordinates: forward is -X and down is +Y.
function sampleDogRest(): Segment[] {
  const rest = [
    { start: point(-0.14, -0.02), end: point(0.24, 0.23) },
    { start: point(-0.14, -0.02), end: point(-0.15, -0.13) },
    { start: point(-0.15, -0.13), end: point(-0.18, -0.32) },
    { start: point(0.34, 0.22), end: point(0.39, 0.42) },
  ];
  for (const side of [-1, 1]) {
    const z = side * 0.105;
    rest.push(
      { start: point(-0.15, 0.04, z), end: point(-0.185, 0.22, z) },
      { start: point(-0.185, 0.22, z), end: point(-0.265, 0.385, z) },
      { start: point(-0.265, 0.385, z), end: point(-0.27, FLOOR, z) },
      { start: point(0.24, 0.23, z), end: point(0.12, 0.32, z) },
      { start: point(0.12, 0.32, z), end: point(0.25, 0.385, z) },
      { start: point(0.25, 0.385, z), end: point(0.14, FLOOR, z) },
    );
  }
  return rest;
}

// Clamp reach and flexion before solving so an unreachable paw never stretches a limb.
export function solveLimb(root: Vector3, target: Vector3, a: number, b: number, pole: Vector3,
  joint: Vector3, end: Vector3) {
  const direction = target.clone().sub(root);
  const length = direction.length();
  direction.copy(length > 1e-8 ? direction.divideScalar(length) : Y);
  const reach = (bend: number) => Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(bend));
  const d = clamp(length, reach(2.85), reach(0.10));
  const along = (a * a - b * b + d * d) / (2 * d);
  const perpendicular = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (perpendicular.lengthSq() < 1e-8) perpendicular.copy(Z).addScaledVector(direction, -direction.z);
  perpendicular.normalize();
  joint.copy(root).addScaledVector(direction, along)
    .addScaledVector(perpendicular, Math.sqrt(Math.max(0, a * a - along * along)));
  end.copy(root).addScaledVector(direction, d);
}

export function createSampleDogPose() {
  const rest = sampleDogRest();
  const posed = rest.map(b => ({ start: b.start.clone(), end: b.end.clone() }));
  const matrices = rest.map(() => new Matrix4());
  const rotations = rest.map(() => new Quaternion());
  const inverse = new Matrix4(), translation = new Matrix4(), identity = new Matrix4();
  const from = new Vector3(), to = new Vector3(), unit = point(1, 1, 1);
  const bodyRotation = new Quaternion(), headLocalRotation = new Quaternion();
  const mouth = new Vector3();
  const feet = LEG_BASES.map((base, i) => ({
    base, rear: i % 2 === 1, offset: [0, 0.5, 0.5, 0][i],
    anchor: new Vector3(), start: new Vector3(), goal: new Vector3(),
    previousNeutral: new Vector3(), neutral: new Vector3(), travel: new Vector3(),
    local: rest[base + 2].end.clone(), transition: rest[base + 2].end.clone(),
    planted: true, contact: 0, lap: 0, initialized: false, settling: 1,
  }));
  let phase = STANCE / 2, yaw = 0, pitch = 0, previousStand = 0, previousTarget = 0;
  let previousMoving = false;

  function transformBone(i: number) {
    matrices[i].compose(posed[i].start, rotations[i], unit)
      .multiply(translation.makeTranslation(-rest[i].start.x, -rest[i].start.y, -rest[i].start.z));
  }

  return {
    rest, posed, matrices, feet, mouth,
    get gaze() { return { yaw, pitch }; },
    update(motion: DogMotion, dt = 1 / 60, world = identity,
      attention: DogAttention = {}, groundHeight?: GroundHeight) {
      dt = clamp(dt, 0, 0.1);
      inverse.copy(world).invert();
      const stand = smooth(0, 1, motion.stand);
      const rise = smooth(0.18, 1, motion.stand);
      const pickup = smooth(0, 1, attention.pickup ?? 0) * stand;
      const bodyAngle = Math.atan2(0.25, 0.38) * (1 - rise) + 0.17 * rise - 0.33 * pickup;
      bodyRotation.setFromAxisAngle(Z, bodyAngle - Math.atan2(0.25, 0.38));
      posed[0].start.set(-0.14 - 0.10 * stand - 0.015 * Math.sin(stand * Math.PI),
        -0.02 + 0.045 * stand + 0.16 * pickup, 0);
      posed[0].end.copy(rest[0].end).sub(rest[0].start).applyQuaternion(bodyRotation).add(posed[0].start);
      rotations[0].copy(bodyRotation);
      transformBone(0);

      let targetYaw = 0, targetPitch = 0;
      if (attention.target) {
        to.copy(attention.target).applyMatrix4(inverse).sub(posed[1].end);
        targetYaw = clamp(Math.atan2(to.z, -to.x), -1.15, 1.15);
        targetPitch = clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.45, 0.9);
      }
      targetPitch += (1.45 - targetPitch) * pickup;
      const follow = 1 - Math.exp(-dt * 10);
      yaw += (targetYaw - yaw) * follow;
      pitch += (targetPitch - pitch) * follow;
      rotations[1].setFromAxisAngle(Y, yaw * 0.4)
        .multiply(headLocalRotation.setFromAxisAngle(Z, -pitch * 0.6));
      posed[1].start.copy(posed[0].start);
      posed[1].end.copy(rest[1].end).sub(rest[1].start).applyQuaternion(rotations[1]).add(posed[1].start);
      rotations[2].copy(rotations[1]).multiply(headLocalRotation.setFromAxisAngle(Y, yaw * 0.6))
        .multiply(headLocalRotation.setFromAxisAngle(Z, -pitch * 0.4));
      posed[2].start.copy(posed[1].end);
      posed[2].end.copy(rest[2].end).sub(rest[2].start).applyQuaternion(rotations[2]).add(posed[2].start);
      transformBone(1); transformBone(2);
      mouth.set(-0.31, -0.17, 0).applyMatrix4(matrices[2]);

      posed[3].start.copy(rest[3].start).applyMatrix4(matrices[0]);
      rotations[3].copy(bodyRotation).multiply(headLocalRotation.setFromAxisAngle(Y, Math.sin(motion.phase) * 0.15 * motion.stride));
      posed[3].end.copy(rest[3].end).sub(rest[3].start).applyQuaternion(rotations[3]).add(posed[3].start);
      transformBone(3);

      let travel = 0;
      const scale = from.setFromMatrixScale(world).x;
      for (const foot of feet) {
        foot.neutral.set(foot.rear ? 0.205 : -0.27, FLOOR, rest[foot.base + 2].end.z).applyMatrix4(world);
        foot.travel.subVectors(foot.neutral, foot.previousNeutral);
        if (foot.initialized) travel = Math.max(travel, foot.travel.length() / scale);
        else foot.travel.set(0, 0, 0);
      }
      const moving = motion.stand === 1 && motion.target === 1 && travel > 1e-6;
      if (motion.stand < 1) phase = STANCE / 2;
      if (moving) phase += travel / CYCLE_DISTANCE;
      if (motion.target !== previousTarget || (previousStand === 1 && motion.stand < 1)) {
        feet.forEach(foot => foot.transition.copy(foot.local));
      }

      for (const foot of feet) {
        const { base, rear } = foot;
        const toe = foot.local;
        const project = (p: Vector3) => {
          const height = groundHeight?.(p);
          if (height !== undefined) p.y = height;
          return p;
        };
        if (motion.stand < 1) {
          const t = rear ? smooth(0.06, 0.52, motion.stand) : stand;
          toe.copy(rest[base + 2].end);
          toe.x += (rear ? 0.065 : 0) * t;
          toe.y -= (rear ? 0.022 : 0) * Math.sin(t * Math.PI) ** 2;
          if (motion.target === 0) {
            toe.lerp(foot.transition, smooth(0.65, 1, motion.stand));
          }
          foot.anchor.copy(toe).applyMatrix4(world);
          foot.planted = true;
          foot.initialized = false;
        } else {
          const cycle = (phase + foot.offset) % 1;
          const lap = Math.floor(phase + foot.offset);
          const stance = cycle < STANCE;
          if (!foot.initialized) {
            toe.copy(foot.neutral).applyMatrix4(inverse);
            foot.anchor.copy(foot.neutral);
            project(foot.anchor);
            foot.planted = true;
            foot.lap = lap;
            foot.initialized = true;
          }
          if (moving) {
            foot.settling = 0;
            if (stance) {
              if (!foot.planted || lap !== foot.lap) {
                // Account for travel after touchdown even when a slow frame skipped the swing.
                foot.anchor.copy(foot.neutral).addScaledVector(foot.travel.clone().normalize(),
                  CYCLE_DISTANCE * (STANCE * 0.5 - cycle) * scale);
                project(foot.anchor);
                foot.contact++;
              }
              foot.planted = true;
              toe.copy(foot.anchor).applyMatrix4(inverse);
            } else {
              if (foot.planted) foot.start.copy(foot.anchor);
              foot.planted = false;
              foot.goal.copy(foot.neutral).addScaledVector(foot.travel.clone().normalize(), CYCLE_DISTANCE * STANCE * 0.5 * scale);
              project(foot.goal);
              const t = (cycle - STANCE) / (1 - STANCE);
              toe.copy(foot.start).lerp(foot.goal, smooth(0, 1, t)).applyMatrix4(inverse);
              toe.y -= Math.sin(Math.PI * t) ** 2 * 0.055;
            }
          } else if (!foot.planted) {
            if (previousMoving) foot.start.copy(toe).applyMatrix4(world);
            foot.settling = Math.min(1, foot.settling + dt / 0.14);
            foot.goal.copy(foot.neutral); project(foot.goal);
            toe.copy(foot.start).lerp(foot.goal, smooth(0, 1, foot.settling)).applyMatrix4(inverse);
            if (foot.settling === 1) {
              foot.anchor.copy(foot.goal); foot.planted = true; foot.contact++;
            }
          } else toe.copy(foot.anchor).applyMatrix4(inverse);
          foot.lap = lap;
        }

        const upper = posed[base], lower = posed[base + 1], paw = posed[base + 2];
        upper.start.copy(rest[base].start).applyMatrix4(matrices[0]);
        const footRotation = rear ? -0.875 * stand : 0;
        from.copy(rest[base + 2].end).sub(rest[base + 2].start).applyAxisAngle(Z, footRotation);
        to.copy(toe).sub(from);
        const a = rest[base].start.distanceTo(rest[base].end), b = rest[base + 1].start.distanceTo(rest[base + 1].end);
        const reach = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(0.10));
        if (moving && foot.planted && upper.start.distanceTo(to) > reach - 0.002) {
          // A sharp turn can exhaust reach before the scheduled step, so lift this paw early.
          foot.start.copy(foot.anchor);
          foot.planted = false;
          foot.offset = (STANCE - phase % 1 + 1) % 1;
          foot.lap = Math.floor(phase + foot.offset);
        }
        solveLimb(upper.start, to, a, b, point(rear ? -1 : 1, 0), upper.end, lower.end);
        lower.start.copy(upper.end);
        paw.start.copy(lower.end);
        paw.end.copy(paw.start).add(from);
        for (let i = base; i < base + 3; i++) {
          rotations[i].setFromUnitVectors(from.subVectors(rest[i].end, rest[i].start).normalize(),
            to.subVectors(posed[i].end, posed[i].start).normalize());
          transformBone(i);
        }
        foot.previousNeutral.copy(foot.neutral);
      }
      previousMoving = moving;
      previousStand = motion.stand;
      previousTarget = motion.target;
    },
  };
}
