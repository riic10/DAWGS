import { Matrix4, Quaternion, Vector3 } from "three";
import type { DogMotion } from "./dog-motion";
import { dogGrip } from "./dog-mouth";
import { LEG_BASES, SHOULDERS, PELVIS, JAW, type DogProfile, type Segment } from "./dog-profile";
export { LEG_BASES, SHOULDERS, PELVIS, JAW } from "./dog-profile";
export type { Segment } from "./dog-profile";

export type DogAttention = {
  target?: Vector3 | null; pickup?: number;
  pet?: number; petPhase?: number; petTarget?: Vector3 | null;
  petYaw?: number; petPitch?: number;
  mouthTarget?: Vector3 | null; mouthRadius?: number; jawOpen?: number;
};
export type GroundHeight = (point: Vector3) => number | undefined;
const point = (x: number, y: number, z = 0) => new Vector3(x, y, z);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const X = point(1, 0), Y = point(0, 1), Z = point(0, 0, 1);
// Lateral walking footfalls blend into diagonal trotting pairs as speed increases.
const WALK_OFFSETS = [0, 0.25, 0.5, 0.75];
const TROT_OFFSETS = [0, 0.5, 0.5, 1];

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

export function createDogAnimation(profile: DogProfile) {
  const { rest, floor: FLOOR, unit: u } = profile;
  const restAngle = Math.atan2(rest[0].end.y - rest[0].start.y, rest[0].end.x - rest[0].start.x);
  const posed = rest.map(b => ({ start: b.start.clone(), end: b.end.clone() }));
  const matrices = rest.map(() => new Matrix4());
  const rotations = rest.map(() => new Quaternion());
  const limbPoles = LEG_BASES.map(base => {
    const axis = rest[base + 1].end.clone().sub(rest[base].start).normalize();
    const bend = rest[base].end.clone().sub(rest[base].start);
    return bend.addScaledVector(axis, -bend.dot(axis)).normalize();
  });
  const inverse = new Matrix4(), translation = new Matrix4(), identity = new Matrix4();
  const from = new Vector3(), to = new Vector3(), unit = point(1, 1, 1);
  const bodyRotation = new Quaternion(), headLocalRotation = new Quaternion();
  const aimRotation = new Quaternion(), reachJoint = new Vector3(), reachEnd = new Vector3();
  const mouthRest = profile.mouth.upperLip.clone(), pickupGround = point(0, FLOOR);
  const upperContact = profile.mouth.upperLip.clone(), lowerContact = profile.mouth.lowerLip.clone();
  const pickupChest = profile.standingChest.clone().add(profile.pickupShift);
  const mouth = new Vector3();
  const jaw = { angle: 0, gripAngle: 0, openAngle: 0.65, upper: new Vector3(), lower: new Vector3() };
  let mouthRadius = -1;
  const feet = LEG_BASES.map((base, i) => ({
    base, rear: i % 2 === 1, offset: WALK_OFFSETS[i], correction: 0, cycle: 0, swing: 0,
    anchor: new Vector3(), start: new Vector3(), goal: new Vector3(),
    previousNeutral: new Vector3(), neutral: new Vector3(), travel: new Vector3(),
    local: rest[base + 2].end.clone(), transition: rest[base + 2].end.clone(),
    planted: true, contact: 0, lap: 0, initialized: false, settling: 1, recovering: false,
  }));
  let phase = 0.32, trot = 0, activity = 0, yaw = 0, pitch = 0;
  let previousStand = Number(profile.startsStanding), previousTarget = previousStand;
  let previousMoving = false;
  let petSide = 1;

  function pickupApproach(target: Vector3, result = new Vector3()) {
    // Leave neck extension available when the ball and paws rest at different ground heights.
    const reach = 0.94 * (rest[1].start.distanceTo(rest[1].end) + rest[2].start.distanceTo(mouthRest));
    const forward = Math.sqrt(Math.max((0.08 * u) ** 2, reach ** 2 - (target.y - pickupChest.y) ** 2 - target.z ** 2));
    return result.set(pickupChest.x - forward, target.y, target.z);
  }

  function transformBone(i: number) {
    matrices[i].compose(posed[i].start, rotations[i], unit)
      .multiply(translation.makeTranslation(-rest[i].start.x, -rest[i].start.y, -rest[i].start.z));
  }

  return {
    profile, rest, posed, matrices, feet, mouth, pickupGround, jaw, pickupApproach,
    get gaze() { return { yaw, pitch }; },
    get gait() { return { phase, trot, activity }; },
    update(motion: DogMotion, dt = 1 / 60, world = identity,
      attention: DogAttention = {}, groundHeight?: GroundHeight) {
      dt = clamp(dt, 0, 0.1);
      inverse.copy(world).invert();
      const stand = smooth(0, 1, motion.stand);
      const rise = smooth(0.18, 1, motion.stand);
      const pickup = smooth(0, 1, attention.pickup ?? 0) * stand;
      let travel = 0;
      const scale = from.setFromMatrixScale(world).x;
      for (const [i, foot] of feet.entries()) {
        foot.neutral.copy(profile.standingPaws[i]).applyMatrix4(world);
        foot.travel.subVectors(foot.neutral, foot.previousNeutral);
        if (foot.initialized) travel = Math.max(travel, foot.travel.length() / scale);
        else foot.travel.set(0, 0, 0);
      }
      const moving = motion.stand === 1 && motion.target === 1 && travel > 1e-6;
      const ease = 1 - Math.exp(-dt * 10);
      trot += (smooth(0.65, 1.25, Math.abs(motion.speed)) - trot) * ease;
      activity += ((moving ? 1 : 0) - activity) * ease;
      if (activity < 1e-4) activity = 0;
      const stance = 0.64 - 0.18 * trot;
      const cycleDistance = (0.48 + 0.20 * trot) * u * profile.cycleScale;
      const advance = moving ? travel / cycleDistance : 0;
      if (motion.stand < 1) phase = 0.32;
      phase += advance;
      const gait = activity * stand * (1 - pickup);
      const beat = phase * Math.PI * 2;
      const pet = clamp(attention.pet ?? 0, 0, 1) * (1 - pickup) * (1 - activity);
      let petYaw = 0.3;
      if (attention.petTarget) {
        to.copy(attention.petTarget).applyMatrix4(inverse).sub(posed[1].end);
        petYaw = clamp(Math.atan2(to.z, -to.x), -0.5, 0.5);
      }
      petSide += ((petYaw < 0 ? -1 : 1) - petSide) * (1 - Math.exp(-dt * 6));
      const petPhase = attention.petPhase ?? 0;
      const nuzzle = (1 - Math.cos(petPhase * 0.5)) * 0.5;
      const neckLean = pet * (0.30 + 0.16 * nuzzle);
      const bodyAngle = profile.sittingAngle * (1 - rise) + profile.standingAngle * rise + profile.pickupAngle * pickup
        + 0.009 * gait * Math.sin(beat * 2);
      bodyRotation.setFromAxisAngle(Z, bodyAngle - restAngle);
      posed[0].start.copy(profile.sittingChest).lerp(profile.standingChest, stand).addScaledVector(profile.pickupShift, pickup);
      posed[0].start.x -= 0.015 * u * Math.sin(stand * Math.PI);
      posed[0].start.y += gait * u * (0.008 + (0.002 + 0.003 * trot) * Math.cos(beat * 2 - stance * Math.PI * 2));
      posed[0].start.y += gait * profile.gaitDrop;
      posed[0].end.copy(rest[0].end).sub(rest[0].start).applyQuaternion(bodyRotation).add(posed[0].start);
      // Pivot the chest around the hips so a seated pet response keeps its weight on the ground.
      bodyRotation.premultiply(headLocalRotation.setFromAxisAngle(X, -0.02 * pet * petSide))
        .premultiply(headLocalRotation.setFromAxisAngle(Y, 0.035 * pet * petSide));
      posed[0].start.copy(rest[0].start).sub(rest[0].end).applyQuaternion(bodyRotation).add(posed[0].end);
      rotations[0].copy(bodyRotation);
      transformBone(0);

      posed[PELVIS].start.copy(posed[0].end);
      rotations[PELVIS].copy(bodyRotation)
        .multiply(headLocalRotation.setFromAxisAngle(X, 0.035 * gait * Math.sin(beat)))
        .multiply(headLocalRotation.setFromAxisAngle(Z, 0.025 * gait * Math.sin(beat * 2)));
      posed[PELVIS].end.copy(rest[PELVIS].end).sub(rest[PELVIS].start)
        .applyQuaternion(rotations[PELVIS]).add(posed[PELVIS].start);
      transformBone(PELVIS);

      let targetYaw = 0, targetPitch = 0;
      if (attention.target) {
        to.copy(attention.target).applyMatrix4(inverse).sub(posed[1].end);
        targetYaw = clamp(Math.atan2(to.z, -to.x), -1.15, 1.15);
        targetPitch = clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.45, 0.9);
      }
      targetYaw += (petYaw + (attention.petYaw ?? 0) - targetYaw) * pet;
      targetPitch += (-0.32 - 0.03 * nuzzle + (attention.petPitch ?? 0) - targetPitch) * pet;
      targetPitch += (1.45 - targetPitch) * pickup;
      const follow = 1 - Math.exp(-dt * 10);
      yaw += (targetYaw - yaw) * follow;
      pitch += (targetPitch - pitch) * follow;
      rotations[1].setFromAxisAngle(Y, yaw * 0.4)
        .multiply(headLocalRotation.setFromAxisAngle(Z, -pitch * 0.6 - neckLean));
      posed[1].start.copy(posed[0].start);
      posed[1].end.copy(rest[1].end).sub(rest[1].start).applyQuaternion(rotations[1]).add(posed[1].start);
      rotations[2].copy(rotations[1]).multiply(headLocalRotation.setFromAxisAngle(Y, yaw * 0.6))
        .multiply(headLocalRotation.setFromAxisAngle(Z, -pitch * 0.4 + neckLean))
        .multiply(headLocalRotation.setFromAxisAngle(X, -(0.24 + 0.04 * nuzzle) * pet * petSide));
      const radius = Math.max(0, attention.mouthRadius ?? 0) / scale;
      if (Math.abs(radius - mouthRadius) > 1e-8) {
        mouthRadius = radius;
        const grip = dogGrip(profile.mouth, radius);
        mouthRest.copy(grip.center);
        upperContact.copy(grip.upper); lowerContact.copy(grip.lower);
        jaw.gripAngle = grip.angle;
        jaw.openAngle = grip.openAngle;
        pickupGround.x = pickupApproach(to.set(0, FLOOR - radius, 0), from).x;
      }
      if (attention.mouthTarget && pickup > 0) {
        // Reach the grounded ball with fixed neck and skull lengths before attaching it.
        to.copy(attention.mouthTarget).applyMatrix4(inverse);
        solveLimb(posed[1].start, to, rest[1].start.distanceTo(rest[1].end),
          rest[2].start.distanceTo(mouthRest), point(0, -1), reachJoint, reachEnd);
        aimRotation.setFromUnitVectors(from.subVectors(rest[1].end, rest[1].start).normalize(),
          to.subVectors(reachJoint, posed[1].start).normalize());
        rotations[1].slerp(aimRotation, pickup);
        aimRotation.setFromUnitVectors(from.subVectors(mouthRest, rest[2].start).normalize(),
          to.subVectors(reachEnd, reachJoint).normalize());
        rotations[2].slerp(aimRotation, pickup);
        posed[1].end.copy(rest[1].end).sub(rest[1].start).applyQuaternion(rotations[1]).add(posed[1].start);
      }
      posed[2].start.copy(posed[1].end);
      posed[2].end.copy(rest[2].end).sub(rest[2].start).applyQuaternion(rotations[2]).add(posed[2].start);
      transformBone(1); transformBone(2);
      mouth.copy(mouthRest).applyMatrix4(matrices[2]);
      jaw.angle += (clamp(attention.jawOpen ?? 0, -profile.mouth.nativeAngle / jaw.openAngle, 1) * jaw.openAngle - jaw.angle) * (1 - Math.exp(-dt * 18));
      posed[JAW].start.copy(rest[JAW].start).applyMatrix4(matrices[2]);
      rotations[JAW].copy(rotations[2]).multiply(headLocalRotation.setFromAxisAngle(Z, -jaw.angle));
      posed[JAW].end.copy(rest[JAW].end).sub(rest[JAW].start).applyQuaternion(rotations[JAW]).add(posed[JAW].start);
      transformBone(JAW);
      jaw.upper.copy(upperContact).applyMatrix4(matrices[2]);
      jaw.lower.copy(lowerContact).applyMatrix4(matrices[JAW]);

      posed[3].start.copy(rest[3].start).applyMatrix4(matrices[PELVIS]);
      rotations[3].copy(rotations[PELVIS])
        .multiply(headLocalRotation.setFromAxisAngle(Z, -0.55 * pet))
        .multiply(headLocalRotation.setFromAxisAngle(X, Math.sin(petPhase) * 0.6 * pet + 0.08 * gait * Math.sin(beat)));
      posed[3].end.copy(rest[3].end).sub(rest[3].start).applyQuaternion(rotations[3]).add(posed[3].start);
      transformBone(3);

      if (motion.target !== previousTarget || (previousStand === 1 && motion.stand < 1)) {
        feet.forEach(foot => foot.transition.copy(foot.local));
      }

      for (const [index, foot] of feet.entries()) {
        const { base, rear } = foot;
        const toe = foot.local;
        const project = (p: Vector3) => {
          const height = groundHeight?.(p);
          if (height !== undefined) p.y = height;
          return p;
        };
        if (motion.stand < 1) {
          const t = rear ? smooth(0.06, 0.52, motion.stand) : stand;
          toe.copy(profile.sittingPaws[index]).lerp(profile.standingPaws[index], t);
          toe.y -= (rear ? 0.022 * u : 0) * Math.sin(t * Math.PI) ** 2;
          if (motion.target === 0) {
            toe.lerp(foot.transition, smooth(0.65, 1, motion.stand));
          }
          foot.anchor.copy(toe).applyMatrix4(world);
          foot.planted = true;
          foot.initialized = false;
          foot.correction = foot.swing = 0;
          foot.recovering = false;
        } else {
          // A reach-limited step rejoins the regular rhythm over the following strides.
          foot.correction = Math.max(0, foot.correction - advance * 0.25);
          foot.offset = WALK_OFFSETS[index] + (TROT_OFFSETS[index] - WALK_OFFSETS[index]) * trot + foot.correction;
          const cycle = (phase + foot.offset) % 1;
          const lap = Math.floor(phase + foot.offset);
          foot.cycle = cycle;
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
            if (cycle < stance) {
              if (!foot.planted || lap !== foot.lap) {
                // Account for travel after touchdown even when a slow frame skipped the swing.
                foot.anchor.copy(foot.neutral).addScaledVector(foot.travel.clone().normalize(),
                  cycleDistance * (stance * 0.5 - cycle) * scale);
                project(foot.anchor);
                foot.contact++;
              }
              foot.planted = true;
              foot.swing = 0;
              toe.copy(foot.anchor).applyMatrix4(inverse);
            } else {
              if (foot.planted) foot.start.copy(foot.anchor);
              foot.planted = false;
              foot.goal.copy(foot.neutral).addScaledVector(foot.travel.clone().normalize(), cycleDistance * stance * 0.5 * scale);
              project(foot.goal);
              const t = (cycle - stance) / (1 - stance);
              foot.swing = t;
              toe.copy(foot.start).lerp(foot.goal, smooth(0, 1, t)).applyMatrix4(inverse);
              toe.y -= Math.sin(Math.PI * t) ** 2 * (0.045 + 0.02 * trot) * u;
            }
          } else if (!foot.planted) {
            if (previousMoving) foot.start.copy(toe).applyMatrix4(world);
            foot.settling = Math.min(1, foot.settling + dt / 0.14);
            foot.goal.copy(foot.neutral); project(foot.goal);
            toe.copy(foot.start).lerp(foot.goal, smooth(0, 1, foot.settling)).applyMatrix4(inverse);
            if (foot.recovering) toe.y -= Math.sin(Math.PI * foot.settling) * 0.015 * u;
            foot.swing *= 1 - smooth(0, 1, foot.settling);
            if (foot.settling === 1) {
              foot.anchor.copy(foot.goal); foot.planted = true; foot.contact++; foot.recovering = false;
            }
          } else toe.copy(foot.anchor).applyMatrix4(inverse);
          foot.lap = lap;
        }

        const upper = posed[base], lower = posed[base + 1], paw = posed[base + 2];
        if (rear) upper.start.copy(rest[base].start).applyMatrix4(matrices[PELVIS]);
        else {
          const shoulder = SHOULDERS[index / 2];
          const reachForward = clamp((profile.standingPaws[index].x - toe.x) / (cycleDistance * stance * 0.5), -1, 1);
          posed[shoulder].start.copy(rest[shoulder].start).applyMatrix4(matrices[0]);
          rotations[shoulder].copy(bodyRotation).multiply(headLocalRotation.setFromAxisAngle(Z, profile.shoulderSwing * gait * reachForward));
          posed[shoulder].end.copy(rest[shoulder].end).sub(rest[shoulder].start)
            .applyQuaternion(rotations[shoulder]).add(posed[shoulder].start);
          transformBone(shoulder);
          upper.start.copy(posed[shoulder].end);
        }
        const push = foot.planted ? smooth(stance * 0.65, stance, foot.cycle) * gait : 0;
        const fold = Math.sin(Math.PI * foot.swing) * gait;
        const footRotation = rear ? profile.rearFootAngles[0] * (1 - stand) + profile.rearFootAngles[1] * stand - 0.24 * push + 0.55 * fold : 0.32 * push - 0.95 * fold;
        from.copy(rest[base + 2].end).sub(rest[base + 2].start).applyAxisAngle(Z, footRotation);
        to.copy(toe).sub(from);
        const a = rest[base].start.distanceTo(rest[base].end), b = rest[base + 1].start.distanceTo(rest[base + 1].end);
        const reach = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(0.10));
        if (moving && foot.planted && upper.start.distanceTo(to) > reach - 0.002 * u) {
          // A sharp turn can exhaust reach before the scheduled step, so lift this paw early.
          foot.start.copy(foot.anchor);
          foot.planted = false;
          foot.correction += stance - foot.cycle;
          foot.offset += stance - foot.cycle;
          foot.cycle = stance;
          foot.swing = 0;
          foot.lap = Math.floor(phase + foot.offset);
        } else if (motion.stand === 1 && foot.planted && upper.start.distanceTo(to) > reach + 1e-8) {
          // Settling a stride or bowing can also exhaust reach, so take a small recovery step.
          foot.planted = false;
          foot.recovering = true;
          foot.settling = 0;
        }
        solveLimb(upper.start, to, a, b, limbPoles[index], upper.end, lower.end);
        lower.start.copy(upper.end);
        paw.start.copy(lower.end);
        paw.end.copy(paw.start).add(from);
        if (foot.recovering && foot.settling === 0) foot.start.copy(paw.end).applyMatrix4(world);
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
