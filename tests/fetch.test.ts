import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Group, Mesh, PerspectiveCamera, Scene, Vector3 } from "three";
import { createDogMotion, stepDog } from "../lib/dog-motion";
import { createSampleDogPose } from "../lib/sample-dog-pose";
import { createBall } from "../web/src/interactions/ball.js";

function fetchGame(standing = false, dt = 1 / 60, groundHeight = (_x: number, _z: number) => 0) {
  const root = new Group(), body = new Group(), splats = new Group();
  root.add(body);
  body.add(splats);
  splats.rotation.x = Math.PI;
  splats.scale.setScalar(0.9);
  splats.position.y = 0.405 * 0.9;
  const joints = createSampleDogPose();
  let lookTarget: Vector3 | null = null, mouthTarget: Vector3 | null = null;
  const previousPosition = new Vector3();
  const up = new Vector3(0, 1, 0);
  const dog = {
    root, body, height: 0.8, length: 1, pickup: 0, mouthRadius: 0, jawOpen: 0, joints,
    motion: createDogMotion(),
    home: { ground: new Vector3(), normal: up.clone(), facing: 0.3 },
    facing: 0.3,
    groundNormal: up.clone(),
    setPose(point: Vector3, facing?: number, normal?: Vector3): void {
      root.position.copy(point);
      dog.facing = facing ?? dog.facing;
      root.rotation.set(0, dog.facing + Math.PI / 2, 0);
      dog.groundNormal.copy(normal ?? dog.groundNormal);
    },
    forward(target = new Vector3()): Vector3 {
      return target.set(Math.sin(dog.facing), 0, Math.cos(dog.facing));
    },
    lookAt(point: Vector3 | null) { lookTarget = point?.clone() ?? null; },
    reachMouth(point: Vector3 | null) { mouthTarget = point?.clone() ?? null; },
    mouthWorld(target = new Vector3()): Vector3 {
      root.updateMatrixWorld(true);
      return target.copy(joints.mouth).applyMatrix4(splats.matrixWorld);
    },
    pickupPoint(target = new Vector3()): Vector3 {
      root.updateMatrixWorld(true);
      return target.copy(joints.pickupGround).applyMatrix4(splats.matrixWorld);
    },
    pickupDistance(point: Vector3): number {
      root.updateMatrixWorld(true);
      const local = point.clone().applyMatrix4(splats.matrixWorld.clone().invert());
      return joints.pickupApproach(local).applyMatrix4(splats.matrixWorld).sub(root.position).dot(dog.forward());
    },
    update(dt: number) {
      dog.motion.speed = dt ? root.position.distanceTo(previousPosition) / dt / 2 : 0;
      previousPosition.copy(root.position);
      root.updateMatrixWorld(true);
      joints.update(dog.motion, dt, splats.matrixWorld, {
        target: lookTarget, mouthTarget, pickup: dog.pickup, mouthRadius: dog.mouthRadius, jawOpen: dog.jawOpen,
      });
    },
  };
  dog.setPose(dog.home.ground);
  dog.motion.stand = dog.motion.target = Number(standing);
  const scene = new Scene();
  scene.add(root);
  const camera = new PerspectiveCamera();
  camera.position.set(2, 2, 4);
  camera.lookAt(0, 0.4, 0);
  let press = () => {};
  const states: string[] = [];
  const ball = createBall({
    scene, camera, dog,
    input: { on: (_event: string, callback: () => void) => { press = callback; } },
    world: {
      ground: { at: (x: number, z: number) => ({ y: groundHeight(x, z), normal: up, blocked: false }) },
      unitsPerMeter: 2, ballRadius: 0.067, shadow: { kind: "splat" },
    },
    onState: (state: string) => states.push(state),
  });
  const idle = new Set<string>();
  dog.update(0);
  const tick = () => {
    stepDog(dog.motion, idle, dt);
    ball.update(dt);
    dog.update(dt);
    ball.lateUpdate();
  };
  const until = (condition: () => boolean) => {
    for (let frame = 0; frame < 1800 && !condition(); frame++) tick();
    assert.ok(condition(), `fetch stalled in ${ball.state}`);
  };
  const sphere = scene.children.find(object => (object as Mesh).geometry?.type === "SphereGeometry")!;
  return { dog, ball, sphere, states, tick, until, press: () => press() };
}

test("a sitting dog finishes standing before fetch movement and sits again on return", (t) => {
  const random = mock.method(Math, "random", () => 0.5);
  t.after(() => random.mock.restore());
  const { dog, ball, states, tick, until, press } = fetchGame();
  press();
  tick();
  assert.equal(states.at(-1), "ready");
  assert.equal(dog.motion.target, 0);
  press();
  until(() => ball.state === "standing");
  assert.equal(dog.motion.stand, 0);
  const before = dog.root.position.clone();
  const facing = dog.facing;
  while (dog.motion.stand < 1) {
    tick();
    assert.ok(dog.root.position.equals(before));
    assert.equal(dog.facing, facing);
  }
  let moved = false;
  let collectingAt: Vector3 | undefined;
  let crouched = false;
  const outboundSpeeds: number[] = [];
  for (let frame = 0; frame < 1800 && ball.state !== "idle"; frame++) {
    const position = dog.root.position.clone();
    tick();
    const speed = dog.root.position.distanceTo(position) * 60 / 2;
    if (ball.state === "fetching" && speed > 1e-6) outboundSpeeds.push(speed);
    if (ball.state === "collecting") {
      collectingAt ??= dog.root.position.clone();
      assert.ok(dog.root.position.equals(collectingAt));
      if (dog.pickup > 0.95) crouched = true;
    }
    if (dog.root.position.distanceTo(before) > 0.001) {
      moved = true;
      assert.equal(dog.motion.stand, 1);
    }
  }
  assert.equal(ball.state, "idle");
  assert.ok(moved);
  assert.ok(crouched);
  assert.ok(outboundSpeeds[0] < 0.1);
  assert.ok(Math.max(...outboundSpeeds) > 1.25);
  assert.ok(outboundSpeeds.at(-1)! < 0.65);
  assert.equal(dog.pickup, 0);
  assert.deepEqual(states, ["ready", "flying", "standing", "fetching", "collecting", "returning", "dropping", "idle"]);
  assert.ok(dog.root.position.equals(dog.home.ground));
  until(() => dog.motion.stand === 0);
  assert.equal(dog.facing, dog.home.facing);
});

test("the mouth contacts the stationary ball before gripping, then releases it into gravity at home", (t) => {
  const random = mock.method(Math, "random", () => 0.5);
  t.after(() => random.mock.restore());
  const { dog, ball, sphere, tick, until, press } = fetchGame();
  press(); tick(); press();
  until(() => ball.state === "collecting");
  const grounded = sphere.position.clone();
  let attached = false;
  for (let frame = 0; frame < 180 && ball.state === "collecting"; frame++) {
    tick();
    if (!ball.attached) assert.ok(sphere.position.distanceTo(grounded) < 1e-9, "the ball moved before mouth contact");
    else if (!attached) {
      assert.ok(sphere.position.distanceTo(grounded) < 0.067 * 0.08);
      assert.ok(sphere.position.distanceTo(dog.mouthWorld()) < 1e-9);
      attached = true;
    }
  }
  assert.ok(attached);
  assert.equal(ball.state, "returning");
  until(() => ball.state === "dropping");
  until(() => !ball.attached);
  const release = sphere.position.clone();
  assert.ok(release.distanceTo(dog.mouthWorld()) < 0.015, "release should start at the mouth");
  assert.ok(release.y > 0.067);
  tick();
  assert.ok(sphere.position.y < release.y, "the released ball should fall under gravity");
  until(() => ball.state === "idle");
  assert.ok(Math.abs(sphere.position.y - 0.067) < 1e-9);
});

test("an already standing dog fetches without a sit transition and stays standing", (t) => {
  const random = mock.method(Math, "random", () => 0.5);
  t.after(() => random.mock.restore());
  const { dog, ball, states, tick, until, press } = fetchGame(true);
  for (let round = 0; round < 2; round++) {
    press(); tick(); press();
    until(() => ball.state === "idle");
    assert.equal(dog.motion.target, 1);
    assert.equal(dog.motion.stand, 1);
    assert.ok(dog.root.position.equals(dog.home.ground));
  }
  assert.ok(!states.includes("standing"));
  assert.equal(states.filter(state => state === "returning").length, 2);
});

test("a ball close to the chest gets a backward approach and remains reachable on slow frames", (t) => {
  const random = mock.method(Math, "random", () => 0.5);
  t.after(() => random.mock.restore());
  for (const dt of [1 / 60, 0.1]) {
    const { dog, ball, sphere, tick, until, press } = fetchGame(true, dt);
    press(); tick(); press();
    until(() => ball.state === "fetching");
    sphere.position.copy(dog.root.position).addScaledVector(dog.forward(), 0.1);
    sphere.position.y = 0.067;
    const start = dog.root.position.clone();
    until(() => ball.state === "collecting");
    assert.ok(dog.root.position.clone().sub(start).dot(dog.forward()) < -0.2);
    until(() => ball.attached);
    assert.ok(sphere.position.distanceTo(dog.mouthWorld()) < 1e-9);
    until(() => ball.state === "idle");
  }
});

test("pickup approaches closer when the ball rests below the dog's ground level", (t) => {
  const random = mock.method(Math, "random", () => 0.5);
  t.after(() => random.mock.restore());
  const height = (x: number, z: number) => x * Math.sin(0.3) + z * Math.cos(0.3) > 0.6 ? -0.1 : 0;
  const { dog, ball, sphere, tick, until, press } = fetchGame(true, 1 / 60, height);
  press(); tick(); press();
  until(() => ball.state === "fetching");
  sphere.position.copy(dog.root.position).addScaledVector(dog.forward(), 0.7);
  sphere.position.y = -0.1 + 0.067;
  until(() => ball.attached);
  assert.ok(sphere.position.distanceTo(dog.mouthWorld()) < 1e-9);
  until(() => ball.state === "idle");
});
