import { test } from "node:test";
import assert from "node:assert/strict";
import { createDogMotion, dogPose, stepDog } from "../lib/dog-motion";

const advance = (dog: ReturnType<typeof createDogMotion>, codes: string[], frames = 60) => {
  for (let i = 0; i < frames; i++) stepDog(dog, new Set(codes), 1 / 60);
};
const standing = () => {
  const dog = createDogMotion();
  dog.stand = dog.target = 1;
  return dog;
};

test("WASD cannot move or turn the sitting dog or a transitioning dog", () => {
  for (const code of ["KeyW", "KeyA", "KeyS", "KeyD"]) {
    const dog = createDogMotion();
    advance(dog, [code]);
    assert.equal(dogPose(dog), "Sitting");
    assert.deepEqual([dog.x, dog.z, dog.yaw], [0, 0, 0]);
    dog.target = 1;
    advance(dog, [code], 20);
    assert.equal(dogPose(dog), "Standing up");
    assert.deepEqual([dog.x, dog.z, dog.yaw], [0, 0, 0]);
  }
});

test("A turns left and D turns right in place without sideways translation", () => {
  for (const [key, direction] of [["KeyA", 1], ["KeyD", -1]] as const) {
    const dog = standing();
    advance(dog, [key]);
    assert.deepEqual([dog.x, dog.z], [0, 0]);
    assert.ok(dog.yaw * direction > 1);
    assert.equal(dog.turn, direction);
    assert.equal(dogPose(dog), "Turning");
    assert.ok(dog.stride > 0, "pivoting should animate the feet");
  }
});

test("A and D turn equally in opposite directions from any heading and cancel together", () => {
  for (const yaw of [-Math.PI, 0, Math.PI / 2, Math.PI * 3]) {
    const left = standing(), right = standing();
    left.yaw = right.yaw = yaw;
    advance(left, ["KeyA"], 120);
    advance(right, ["KeyD"], 120);
    assert.ok(left.yaw > yaw);
    assert.ok(right.yaw < yaw);
    assert.ok(Math.abs((left.yaw - yaw) + (right.yaw - yaw)) < 1e-10);
    const both = standing();
    both.yaw = yaw;
    advance(both, ["KeyA", "KeyD"], 120);
    assert.equal(both.yaw, yaw);
    assert.equal(both.turn, 0);
    assert.equal(dogPose(both), "Standing");
  }
});

test("W follows the dog's nose and S backs up more slowly without turning around", () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const forward = standing();
    const backward = standing();
    forward.yaw = backward.yaw = yaw;
    advance(forward, ["KeyW"]);
    advance(backward, ["KeyS"]);
    assert.equal(forward.yaw, yaw);
    assert.equal(backward.yaw, yaw);
    assert.ok(forward.x * -Math.cos(yaw) + forward.z * Math.sin(yaw) > 0.5);
    assert.ok(backward.x * -Math.cos(yaw) + backward.z * Math.sin(yaw) < -0.2);
    assert.ok(Math.hypot(backward.x, backward.z) < Math.hypot(forward.x, forward.z));
    assert.ok(backward.phase < 0, "backing up reverses the gait");
  }
});

test("W+A and W+D steer along opposite arcs without a diagonal speed boost", () => {
  const left = standing();
  const right = standing();
  const straight = standing();
  advance(left, ["KeyW", "KeyA"]);
  advance(right, ["KeyW", "KeyD"]);
  advance(straight, ["KeyW"]);
  assert.ok(left.z > 0.2);
  assert.ok(right.z < -0.2);
  assert.equal(left.x, right.x);
  assert.equal(left.z, -right.z);
  assert.equal(left.yaw, -right.yaw);
  assert.ok(Math.hypot(left.x, left.z) <= Math.hypot(straight.x, straight.z));
});

test("W and S cancel and releasing input stops travel and turning immediately", () => {
  const dog = standing();
  advance(dog, ["KeyW", "KeyS"]);
  assert.deepEqual([dog.x, dog.z, dog.yaw], [0, 0, 0]);
  advance(dog, ["KeyW", "KeyA"]);
  const stopped = [dog.x, dog.z, dog.yaw];
  advance(dog, []);
  assert.deepEqual([dog.x, dog.z, dog.yaw], stopped);
  assert.equal(dogPose(dog), "Standing");
});

test("sitting stops translation and steering immediately and returns exactly to rest", () => {
  const dog = standing();
  advance(dog, ["KeyW", "KeyA"]);
  const stopped = [dog.x, dog.z, dog.yaw];
  dog.target = 0;
  advance(dog, ["KeyW", "KeyA"], 120);
  assert.deepEqual([dog.x, dog.z, dog.yaw], stopped);
  assert.equal(dog.stand, 0);
  assert.equal(dog.stride, 0);
  assert.equal(dogPose(dog), "Sitting");
});

test("a delayed frame cannot teleport or spin the dog", () => {
  const dog = standing();
  stepDog(dog, new Set(["KeyW", "KeyA"]), 20);
  assert.ok(Math.hypot(dog.x, dog.z) <= 0.65 * 0.05);
  assert.ok(Math.abs(dog.yaw) <= 2 * 0.05);
});
