import assert from "node:assert/strict";
import { test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { planDelivery } from "../web/src/interactions/delivery.js";

test("delivery routes around blocked ground and stops on the viewer's side of the obstacle", () => {
  const start = new Vector3(0, 0, 0), camera = new PerspectiveCamera();
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 0, 1.5);
  const ground = { at: (x: number, z: number) => ({
    y: 0, normal: new Vector3(0, 1, 0), blocked: Math.abs(x) < 0.6 && z > 1 && z < 2,
  }) };
  const route = planDelivery({ start, camera, ground, unitsPerMeter: 1, clearance: 0.15, reach: 0.35 });
  assert.ok(route);
  assert.ok(route.points.at(-1)!.z > 2);
  const visible = route.points.at(-1)!.clone().add(new Vector3(0, 0, 0.35)).project(camera);
  assert.ok(visible.y > -0.8, "the delivered ball must remain in view");
  let previous = start;
  for (const point of route.points) {
    for (let t = 0; t <= 1; t += 0.01) {
      const p = previous.clone().lerp(point, t);
      assert.ok(!ground.at(p.x, p.z).blocked, "the return route must stay off blocked ground");
    }
    previous = point;
  }
});

test("a viewer outside the floor gets the nearest connected delivery point inside it", () => {
  const start = new Vector3(), camera = new PerspectiveCamera();
  camera.position.set(0, 2, 8);
  camera.lookAt(start);
  const ground = { at: (x: number, z: number) => Math.abs(x) <= 2 && Math.abs(z) <= 2
    ? { y: 0, normal: new Vector3(0, 1, 0), blocked: false } : null };
  const route = planDelivery({ start, camera, ground, unitsPerMeter: 1, clearance: 0.15, reach: 0.35 });
  assert.ok(route);
  const end = route.points.at(-1)!;
  assert.ok(end.z > 1.4 && end.z <= 1.65);
  assert.ok(ground.at(end.x, end.z + 0.35));
});

test("a pickup beside an obstacle can move away to regain paw clearance", () => {
  const start = new Vector3(0.64, 0, 0), camera = new PerspectiveCamera();
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 0, 1.5);
  const ground = { at: (x: number, z: number) => ({
    y: 0, normal: new Vector3(0, 1, 0), blocked: x >= 0.65 && x <= 1.2 && Math.abs(z) < 1,
  }) };
  const route = planDelivery({ start, camera, ground, unitsPerMeter: 1, clearance: 0.15, reach: 0.35 });
  assert.ok(route, "a clear center must be able to leave the obstacle's clearance margin");
  assert.ok(route.points[0].x < start.x);
});
