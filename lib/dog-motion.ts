export type DogPose = "Sitting" | "Standing up" | "Standing" | "Walking" | "Turning" | "Sitting down";

export function createDogMotion() {
  return { stand: 0, target: 0, phase: 0, stride: 0, speed: 0, turn: 0, x: 0, z: 0, yaw: 0 };
}

export type DogMotion = ReturnType<typeof createDogMotion>;

export function dogPose(motion: DogMotion): DogPose {
  if (motion.target === 0) return motion.stand === 0 ? "Sitting" : "Sitting down";
  if (motion.stand < 1) return "Standing up";
  if (motion.turn !== 0 && motion.speed === 0) return "Turning";
  return motion.stride > 0.01 ? "Walking" : "Standing";
}

export function stepDog(motion: DogMotion, keys: ReadonlySet<string>, dt: number) {
  dt = Math.max(0, Math.min(dt, 0.05));
  motion.stand += Math.sign(motion.target - motion.stand) * Math.min(Math.abs(motion.target - motion.stand), dt / 0.9);
  const enabled = motion.target === 1 && motion.stand === 1;
  const forward = enabled ? Number(keys.has("KeyW")) - Number(keys.has("KeyS")) : 0;
  motion.turn = enabled ? Number(keys.has("KeyA")) - Number(keys.has("KeyD")) : 0;
  const targetSpeed = forward * (forward > 0 ? 0.65 : 0.32);
  // Releasing input stops travel immediately; starting and reversing ease into the next step.
  motion.speed = forward === 0 ? 0 : motion.speed + Math.sign(targetSpeed - motion.speed) * Math.min(Math.abs(targetSpeed - motion.speed), dt * 2.4);
  const turning = motion.turn * 1.8 * dt;
  const heading = motion.yaw + turning / 2;
  motion.x -= Math.cos(heading) * motion.speed * dt;
  motion.z += Math.sin(heading) * motion.speed * dt;
  motion.yaw += turning;
  const active = forward !== 0 || motion.turn !== 0;
  motion.stride += ((active ? 1 : 0) - motion.stride) * (1 - Math.exp(-dt * 12));
  if (motion.stride < 0.001) motion.stride = 0;
  const gaitSpeed = motion.speed || (motion.turn !== 0 ? 0.23 : 0);
  motion.phase += gaitSpeed * dt * Math.PI * 2 / 0.4;
}
