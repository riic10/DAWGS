import * as THREE from "three";

// Touch sensor or pet joystick -> pet the dog: a happy hop and wiggle, eased
// in and out. Touching or clicking the stick is a full pet; pushing the stick
// pets harder the further it goes, and the dog leans into the hand (left/right
// turns it towards that side of the screen, up/down tips its nose).
// `canPet()` lets the fetch game veto it while the dog is busy.
const EASE_SECONDS = 0.2;
const LEAN = { yaw: 0.3, pitch: 0.15 }; // rad at full deflection

const camRight = new THREE.Vector3();

export function createPet(dog, input, canPet, camera) {
  let envelope = 0;
  let t = 0;
  let leanX = 0;
  let leanY = 0;

  return {
    update(dt) {
      const stick = input.state.pet;
      const allowed = canPet();
      const push = Math.min(1, Math.hypot(stick.x, stick.y));
      const want = allowed ? Math.max(input.state.touch || stick.pressed ? 1 : 0, push) : 0;
      const k = 1 - Math.exp(-dt / EASE_SECONDS);
      envelope += (want - envelope) * k;
      leanX += ((allowed ? stick.x : 0) - leanX) * k;
      leanY += ((allowed ? stick.y : 0) - leanY) * k;
      if (envelope < 1e-3 && want === 0) {
        envelope = 0;
        t = 0;
      } else {
        t += dt;
      }
      dog.anim.petHop = envelope * 0.06 * dog.height * Math.abs(Math.sin(9 * t));
      dog.anim.petRoll = envelope * 0.12 * Math.sin(14 * t) + leanY * LEAN.pitch;
      // Screen right vs the dog's own right (facing f: forward (sin f, 0, cos f),
      // right (-cos f, 0, sin f)): +1 seen from behind, -1 when it faces us.
      camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      const side = -camRight.x * Math.cos(dog.facing) + camRight.z * Math.sin(dog.facing);
      dog.anim.petYaw = envelope * 0.08 * Math.sin(7 * t) - leanX * side * LEAN.yaw;
    },
  };
}
