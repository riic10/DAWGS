import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Matrix4, Vector3 } from "three";
import { DogRigFitError, dogSkinWeights, fitDogRig } from "../lib/dog-rig-fit";
import { createDogPose } from "../lib/dog-rig-pose";
import { createDogMotion, stepDog } from "../lib/dog-motion";

function readPoints(name: string) {
  const bytes = readFileSync(new URL(`../${name}.ply`, import.meta.url));
  const offset = bytes.indexOf("end_header\n") + 11;
  const header = bytes.subarray(0, offset).toString();
  const count = Number(header.match(/element vertex (\d+)/)![1]);
  const fields = [...header.matchAll(/property float (\w+)/g)].map(match => match[1]);
  const stride = fields.length * 4;
  const points: Vector3[] = [];
  for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 30_000))) {
    const start = offset + i * stride;
    const opacity = 1 / (1 + Math.exp(-bytes.readFloatLE(start + fields.indexOf("opacity") * 4)));
    if (opacity > 0.1) points.push(new Vector3(bytes.readFloatLE(start), bytes.readFloatLE(start + 4), bytes.readFloatLE(start + 8)));
  }
  return points;
}

const sitting = readPoints("dog_model"), standing = readPoints("standing_dog");

test("fits both native poses and finds the nose direction from geometry", () => {
  for (const [points, startsStanding] of [[sitting, false], [standing, true]] as const) {
    const fit = fitDogRig(points);
    assert.equal(fit.startsStanding, startsStanding);
    assert.ok(Math.abs(fit.heading) < 0.05);
    assert.equal(fit.rest.length, 13);
    assert.ok(fit.rest[1].end.x < fit.rest[0].start.x);
    assert.ok(fit.rest.every(b => b.start.distanceTo(b.end) > 0.01));
    for (const foot of [4, 7, 9, 12]) assert.equal(fit.rest[foot].end.y, 0);
  }
});

test("fitting is invariant to export translation, scale and horizontal rotation", () => {
  for (const source of [sitting, standing]) {
    const original = fitDogRig(source);
    for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const transform = new Matrix4().makeRotationY(angle).scale(new Vector3(2.7, 2.7, 2.7)).setPosition(3, -5, 2);
      const fitted = fitDogRig(source.map(p => p.clone().applyMatrix4(transform)));
      assert.equal(fitted.startsStanding, original.startsStanding);
      original.rest.forEach((b, i) => {
        assert.ok(b.start.distanceTo(fitted.rest[i].start) < 0.015);
        assert.ok(b.end.distanceTo(fitted.rest[i].end) < 0.015);
      });
      const rawNose = original.fromCanonical.clone().multiply(new Matrix4().makeTranslation(-1, 0, 0));
      const nose = new Vector3().setFromMatrixPosition(rawNose).applyMatrix4(transform).applyMatrix4(fitted.toCanonical);
      assert.ok(nose.x < -0.9);
    }
  }
});

test("native pose preserves the original splats and all skin weights are finite and normalized", () => {
  for (const points of [sitting, standing]) {
    const fit = fitDogRig(points), pose = createDogPose(fit), motion = createDogMotion();
    motion.stand = motion.target = Number(fit.startsStanding);
    pose.update(motion);
    for (const p of points.filter((_, i) => i % 17 === 0)) {
      const weights = dogSkinWeights(p.clone().applyMatrix4(fit.toCanonical), fit);
      assert.equal(weights.length, 4);
      assert.ok(Math.abs(weights.reduce((sum, [, w]) => sum + w, 0) - 1) < 1e-10);
      const deformed = new Vector3();
      for (const [bone, weight] of weights) {
        assert.ok(Number.isFinite(weight) && weight >= 0 && bone >= 0 && bone < 13);
        deformed.addScaledVector(p.clone().applyMatrix4(pose.matrices[bone]), weight);
      }
      assert.ok(deformed.distanceTo(p) < 1e-8);
    }
  }
});

test("walking deforms the legs, preserves joint connections, and never lowers paws through the floor", () => {
  for (const points of [sitting, standing]) {
    const fit = fitDogRig(points), pose = createDogPose(fit), motion = createDogMotion();
    motion.stand = motion.target = motion.stride = 1;
    motion.speed = 0.65;
    let maxLift = 0, minLift = 1;
    for (let frame = 0; frame < 120; frame++) {
      stepDog(motion, new Set(["KeyW"]), 1 / 60);
      pose.update(motion);
      for (const foot of [4, 7, 9, 12]) {
        const lift = -pose.posed[foot].end.y;
        assert.ok(lift >= -1e-10 && lift <= 0.061);
        maxLift = Math.max(maxLift, lift); minLift = Math.min(minLift, lift);
      }
      for (const [a, b] of [[3, 4], [5, 6], [6, 7], [8, 9], [10, 11], [11, 12]]) {
        assert.ok(pose.posed[a].end.distanceTo(pose.posed[b].start) < 1e-10);
      }
      for (const matrix of pose.matrices) assert.ok(matrix.elements.every(Number.isFinite));
    }
    assert.ok(maxLift > 0.05 && minLift === 0);
  }
});

test("sit and stand transitions are reversible without changing the fitted rest geometry", () => {
  for (const points of [sitting, standing]) {
    const fit = fitDogRig(points), pose = createDogPose(fit), motion = createDogMotion();
    const original = fit.rest.map(b => [b.start.toArray(), b.end.toArray()]);
    motion.stand = motion.target = Number(fit.startsStanding);
    for (const target of [1 - motion.target, motion.target]) {
      motion.target = target;
      for (let i = 0; i < 70; i++) {
        stepDog(motion, new Set(), 1 / 60); pose.update(motion);
        assert.ok(pose.matrices.every(m => m.elements.every(Number.isFinite)));
      }
      assert.equal(motion.stand, target);
    }
    assert.deepEqual(fit.rest.map(b => [b.start.toArray(), b.end.toArray()]), original);
    for (const matrix of pose.matrices) matrix.elements.forEach((v, i) => assert.ok(Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-8));
  }
});

test("rejects missing and degenerate geometry with a recoverable fitting error", () => {
  assert.throws(() => fitDogRig([]), DogRigFitError);
  assert.throws(() => fitDogRig(Array.from({ length: 200 }, () => new Vector3())), DogRigFitError);
});
