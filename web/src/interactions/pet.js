import * as THREE from "three";

const LEAN = { yaw: 0.3, pitch: 0.15 };
const DOWN = new THREE.Vector3(0, -1, 0);

export function createPet(dog, input, canPet, target = null) {
  let envelope = 0;
  let phase = 0;
  let leanX = 0, leanY = 0;
  const cameraRight = new THREE.Vector3();

  return {
    // 0..1: how much the dog is being petted right now (eased), e.g. for sound.
    get amount() { return envelope; },
    update(dt) {
      dt = Math.max(0, Math.min(dt, 0.1));
      const available = canPet();
      const stick = input.state.pet;
      const push = stick ? Math.min(1, Math.hypot(stick.x, stick.y)) : 0;
      const want = available ? Math.max(input.state.touch || stick?.pressed ? 1 : 0, push) : 0;
      const easeSeconds = !available ? 0.18 : want ? 0.28 : 0.55;
      envelope += (want - envelope) * (1 - Math.exp(-dt / easeSeconds));
      const ease = 1 - Math.exp(-dt / 0.2);
      leanX += ((available ? stick?.x ?? 0 : 0) - leanX) * ease;
      leanY += ((available ? stick?.y ?? 0 : 0) - leanY) * ease;
      if (envelope < 1e-3 && want === 0) {
        envelope = 0;
        phase = 0;
      } else {
        phase = (phase + dt * Math.PI * 2 * 1.35) % (Math.PI * 4);
      }
      dog.anim.pet = envelope;
      dog.anim.petPhase = phase;
      dog.anim.petTarget = target;
      let side = 1;
      if (target && dog.root) {
        cameraRight.subVectors(target, dog.root.position).cross(DOWN).normalize();
        side = -cameraRight.x * Math.cos(dog.facing) + cameraRight.z * Math.sin(dog.facing);
      }
      dog.anim.petYaw = -leanX * side * LEAN.yaw;
      dog.anim.petPitch = leanY * LEAN.pitch;
    },
  };
}
