import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Group, PerspectiveCamera, Scene, Vector3 } from "three";
import { createDogMotion, stepDog } from "../lib/dog-motion";
import { createBall } from "../web/src/interactions/ball.js";

function fetchGame(standing = false) {
  const root = new Group(), body = new Group();
  root.add(body);
  const up = new Vector3(0, 1, 0);
  const dog = {
    root, body, height: 0.8, length: 1, pickup: 0,
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
    lookAt(_point: Vector3 | null) {},
    mouthWorld(target: Vector3): Vector3 {
      root.updateMatrixWorld(true);
      return body.localToWorld(target.set(-0.42, 0.496, 0));
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
      ground: { at: () => ({ y: 0, normal: up, blocked: false }) },
      unitsPerMeter: 2, ballRadius: 0.067, shadow: { kind: "splat" },
    },
    onState: (state: string) => states.push(state),
  });
  const idle = new Set<string>();
  const tick = () => {
    stepDog(dog.motion, idle, 1 / 60);
    ball.update(1 / 60);
    ball.lateUpdate();
  };
  const until = (condition: () => boolean) => {
    for (let frame = 0; frame < 1800 && !condition(); frame++) tick();
    assert.ok(condition(), `fetch stalled in ${ball.state}`);
  };
  return { dog, ball, states, tick, until, press: () => press() };
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
  for (let frame = 0; frame < 1800 && ball.state !== "idle"; frame++) {
    tick();
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
  assert.equal(dog.pickup, 0);
  assert.deepEqual(states, ["ready", "flying", "standing", "fetching", "collecting", "returning", "idle"]);
  assert.ok(dog.root.position.equals(dog.home.ground));
  until(() => dog.motion.stand === 0);
  assert.equal(dog.facing, dog.home.facing);
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
