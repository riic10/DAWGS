import assert from "node:assert/strict";
import { test } from "node:test";
import { createPet } from "../web/src/interactions/pet.js";

test("pet joystick preserves proportional strength, direction, press, and fetch gating", () => {
  const dog = { anim: { pet: 0, petPhase: 0, petYaw: 0, petPitch: 0 } };
  const input = { state: { touch: false, pet: { x: 0.3, y: 0.4, pressed: false } } };
  let available = true;
  const pet = createPet(dog, input, () => available);
  const settle = () => { for (let i = 0; i < 300; i++) pet.update(1 / 60); };
  settle();
  assert.ok(Math.abs(dog.anim.pet - 0.5) < 0.001);
  assert.ok(dog.anim.petYaw < 0 && dog.anim.petPitch > 0);
  input.state.pet.x = -0.3;
  input.state.pet.y = -0.4;
  settle();
  assert.ok(dog.anim.petYaw > 0 && dog.anim.petPitch < 0);
  input.state.pet = { x: 0, y: 0, pressed: true };
  settle();
  assert.ok(dog.anim.pet > 0.99);
  available = false;
  settle();
  assert.equal(dog.anim.pet, 0);
});

test("touch eases into a sustained response, releases gradually, and yields to fetching", () => {
  const dog = { anim: { pet: 0, petPhase: 0 } };
  const input = { state: { touch: true } };
  let available = true;
  const pet = createPet(dog, input, () => available);
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) pet.update(1 / 60);
  };
  pet.update(1 / 60);
  assert.ok(dog.anim.pet > 0 && dog.anim.pet < 0.1);
  advance(2);
  assert.ok(dog.anim.pet > 0.98);
  const held = dog.anim.pet;
  const phase = dog.anim.petPhase;
  advance(0.25);
  assert.ok(dog.anim.pet >= held);
  assert.notEqual(dog.anim.petPhase, phase);
  input.state.touch = false;
  pet.update(1 / 60);
  assert.ok(dog.anim.pet > 0.9);
  advance(5);
  assert.equal(dog.anim.pet, 0);
  assert.equal(dog.anim.petPhase, 0);
  input.state.touch = true;
  advance(2);
  available = false;
  advance(1.5);
  assert.equal(dog.anim.pet, 0);
  assert.equal(dog.anim.petPhase, 0);
});
