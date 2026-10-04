import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ARDUINO, createArduinoInput } from "../web/src/input/arduino.js";

function controller(t: TestContext) {
  for (const [key, value] of [["window", new EventTarget()], ["navigator", {}]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  return createArduinoInput();
}

test("six-column joystick samples calibrate both sticks without activating sensor controls", t => {
  const input = controller(t);
  let buttonPresses = 0;
  input.on("buttonpress", () => buttonPresses++);
  for (let i = 0; i < ARDUINO.stick.calibrateSamples; i++) {
    assert.equal(input.feedLine("512,500,0,340,400,0\r\n"), true);
  }
  assert.deepEqual(input.state.rest, { camX: 340, camY: 400, petX: 512, petY: 500 });
  assert.deepEqual(input.state.pet.raw, [512, 500]);
  assert.deepEqual(input.state.cam.raw, [340, 400]);
  assert.equal(input.state.cam.x, 0);
  assert.equal(input.state.cam.y, 0);
  assert.equal(input.state.touch, false);
  assert.equal(input.state.button, false);
  assert.equal(input.state.distance, null);
  assert.equal(buttonPresses, 0);
  input.feedLine("512,500,0,680,0,0");
  assert.equal(input.state.cam.x, 1);
  assert.equal(input.state.cam.y, -1);
  assert.equal(buttonPresses, 0);
});

test("legacy sensor and nine-column controller samples remain supported", t => {
  const input = controller(t);
  input.feedLine("1,0,42");
  assert.equal(input.state.touch, true);
  assert.equal(input.state.distance, 42);
  assert.equal(input.state.rest, null);
  for (let i = 0; i < ARDUINO.stick.calibrateSamples; i++) input.feedLine("0,0,42,512,512,0,340,340,0");
  input.feedLine("0,0,42,1023,0,1,0,680,1");
  assert.ok(input.state.cam.x > 0.99);
  assert.equal(input.state.cam.y, -1);
  assert.equal(input.state.pet.x, -1);
  assert.equal(input.state.pet.y, 1);
  assert.equal(input.state.cam.pressed, true);
  assert.equal(input.state.pet.pressed, true);
});

test("joystick 1 separates horizontal petting from one ball action per vertical push", t => {
  const input = controller(t);
  let presses = 0;
  input.on("buttonpress", () => presses++);
  for (let i = 0; i < ARDUINO.stick.calibrateSamples; i++) input.feedLine("512,512,0,512,512,0");
  input.feedLine("1023,512,0,512,512,0");
  assert.ok(input.state.pet.x > 0.99);
  assert.equal(input.state.pet.y, 0);
  assert.equal(presses, 0);
  for (let i = 0; i < 20; i++) input.feedLine("512,1023,0,512,512,0");
  assert.equal(presses, 1);
  assert.equal(input.state.pet.x, 0);
  assert.equal(input.state.pet.y, 0);
  assert.ok(input.state.ballAxis > 0.99);
  input.feedLine("512,850,0,512,512,0");
  input.feedLine("512,1023,0,512,512,0");
  assert.equal(presses, 1, "jitter must not repeat the action");
  input.feedLine("512,512,0,512,512,0");
  input.feedLine("512,0,0,512,512,0");
  assert.equal(presses, 2, "either direction triggers after returning to centre");
  assert.equal(input.state.cam.x, 0);
  assert.equal(input.state.cam.y, 0);
});

test("malformed or incomplete CSV cannot change controller state", t => {
  const input = controller(t);
  const before = structuredClone(input.state);
  for (const line of ["", "X1,Y1,R3_1,X2,Y2,R3_2", "512,512,0,512", "512,512,0,512,512", "512,512,0,512,512,0,0", "512,,0,512,512,0", "NaN,512,0,512,512,0", "Infinity,512,0,512,512,0"]) {
    assert.equal(input.feedLine(line), false, line);
    assert.deepEqual(input.state, before);
  }
});
