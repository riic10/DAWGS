import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Matrix4, Vector3 } from "three";
import { DogRigFitError, fitDogRig } from "../lib/dog-rig-fit";

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

test("rejects missing and degenerate geometry with a recoverable fitting error", () => {
  assert.throws(() => fitDogRig([]), DogRigFitError);
  assert.throws(() => fitDogRig(Array.from({ length: 200 }, () => new Vector3())), DogRigFitError);
});
