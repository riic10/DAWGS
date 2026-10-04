import { test } from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Vector3 } from "three";
import { readPly, sigmoid } from "../web/tools/ply.mjs";
import { fitDogProfile, LEG_BASES } from "../lib/dog-profile";
import { profileSkinWeights } from "../lib/dog-skin-weights";
import { createDogAnimation } from "../lib/dog-animation";
import { createDogMotion } from "../lib/dog-motion";
import { DogRigFitError } from "../lib/dog-rig-fit";

function readPoints(name: string) {
  const { n, stride, P, f } = readPly(new URL(`../${name}.ply`, import.meta.url));
  const points: Vector3[] = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 30_000))) {
    const offset = i * stride;
    if (sigmoid(f[offset + P.opacity]) > 0.1) points.push(new Vector3(f[offset], f[offset + 1], f[offset + 2]));
  }
  return points;
}

for (const [name, standing] of [["dog_model", false], ["standing_dog", true]] as const) {
  const points = readPoints(name);
  test(`${name}: the shared rig preserves the native scan and has finite normalized weights`, () => {
    const profile = fitDogProfile(points), pose = createDogAnimation(profile), motion = createDogMotion();
    assert.equal(profile.startsStanding, standing);
    motion.stand = motion.target = Number(standing);
    pose.update(motion);
    for (const matrix of pose.matrices) matrix.elements.forEach((value, i) => assert.ok(Math.abs(value - Number(i % 5 === 0)) < 1e-8));
    for (const raw of points.filter((_, i) => i % 13 === 0)) {
      const canonical = raw.clone().applyMatrix4(profile.toCanonical);
      const weights = profileSkinWeights(canonical, profile);
      assert.ok(Math.abs(weights.reduce((sum, [, w]) => sum + w, 0) - 1) < 1e-9);
      assert.ok(weights.every(([i, w]) => i >= 0 && i < 20 && Number.isFinite(w) && w >= 0));
      if (canonical.y > -0.08 && Math.abs(canonical.z) > 0.1) {
        assert.ok((weights.find(([bone]) => bone === 3)?.[1] ?? 0) < 0.05, "the tail must not pull the paws");
      }
    }
  });

  test(`${name}: pose changes and corrected joints preserve the calibrated rest shape`, () => {
    const original = fitDogProfile(points);
    const elbow = original.landmarks!.leftElbow.clone().add(new Vector3(0.008, 0, 0.006));
    const profile = fitDogProfile(points, { points: { leftElbow: elbow.toArray() } });
    const pose = createDogAnimation(profile), motion = createDogMotion();
    motion.stand = motion.target = Number(standing);
    for (const target of [1 - motion.target, motion.target]) {
      motion.target = target;
      for (let frame = 0; frame <= 90; frame++) {
        motion.stand = target ? frame / 90 : 1 - frame / 90;
        pose.update(motion);
        assert.ok(pose.matrices.every(m => m.elements.every(Number.isFinite)));
      }
    }
    for (let frame = 0; frame < 120; frame++) pose.update(motion);
    for (const matrix of pose.matrices) matrix.elements.forEach((value, i) => assert.ok(Math.abs(value - Number(i % 5 === 0)) < 1e-7));
    assert.ok(profile.landmarks!.leftElbow.equals(elbow));
    assert.throws(() => fitDogProfile(points, { mouthWidth: NaN }), DogRigFitError);
    assert.throws(() => fitDogProfile(points, { points: { upperLip: [0, 0, 0] } }), DogRigFitError);
  });

  test(`${name}: fitted limbs keep their lengths and paw contacts through movement and pickup`, () => {
    for (const step of [0.015, 0.07]) for (let stop = 0; stop < 12; stop++) {
      const profile = fitDogProfile(points), pose = createDogAnimation(profile), motion = createDogMotion();
      const world = new Matrix4();
      motion.stand = motion.target = 1;
      motion.speed = step > 0.02 ? 1.5 : 0.65;
      const contacts = [0, 0, 0, 0];
      for (let frame = 0; frame < 240 + stop; frame++) {
        if (frame < 180 + stop) world.makeRotationY(frame * 0.004).setPosition(-frame * step, 0, 0);
        const pickup = frame < 180 + stop ? 0 : Math.min(1, (frame - 180 - stop) / 39);
        pose.update(motion, 1 / 60, world, { pickup, mouthRadius: 0.08 });
        if (frame < 180 + stop) pose.feet.forEach((foot, i) => { if (foot.planted) contacts[i]++; });
        pose.posed.forEach((bone, i) => assert.ok(Math.abs(bone.start.distanceTo(bone.end) - pose.rest[i].start.distanceTo(pose.rest[i].end)) < 1e-8));
        for (const foot of pose.feet.filter(f => f.planted)) {
          const error = pose.posed[foot.base + 2].end.clone().applyMatrix4(world).distanceTo(foot.anchor);
          assert.ok(error < 1e-7, `step ${step}, stop ${stop}, frame ${frame}, pickup ${pickup}, paw ${foot.base}, error ${error}`);
        }
      }
      assert.ok(contacts.every(count => count > 10), `missing paw contacts: ${contacts}`);
    }
  });

  test(`${name}: fitted mouth reaches the ball and both lips hold it across export transforms`, () => {
    const transform = new Matrix4().makeRotationY(1.2).scale(new Vector3(2.4, 2.4, 2.4)).setPosition(4, -5, 2);
    for (const cloud of [points, points.map(p => p.clone().applyMatrix4(transform))]) {
      const profile = fitDogProfile(cloud), pose = createDogAnimation(profile), motion = createDogMotion();
      motion.stand = motion.target = 1;
      const radius = 0.08;
      pose.update(motion, 1 / 60, new Matrix4(), { mouthRadius: radius });
      const target = pose.pickupGround.clone().setY(-radius);
      for (let i = 0; i < 90; i++) pose.update(motion, 1 / 60, new Matrix4(), {
        pickup: 1, mouthTarget: target, mouthRadius: radius, jawOpen: pose.jaw.gripAngle / pose.jaw.openAngle,
      });
      assert.ok(pose.mouth.distanceTo(target) < 1e-7, `${pose.mouth.distanceTo(target)} from ball`);
      assert.ok(Math.abs(pose.jaw.upper.distanceTo(pose.mouth) - radius) < 1e-7);
      assert.ok(Math.abs(pose.jaw.lower.distanceTo(pose.mouth) - radius) < 1e-7);
      assert.ok(LEG_BASES.every(base => pose.posed[base + 2].end.y <= 1e-8));
    }
  });
}
