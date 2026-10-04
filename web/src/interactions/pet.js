export function createPet(dog, input, canPet, target = null) {
  let envelope = 0;
  let phase = 0;

  return {
    update(dt) {
      dt = Math.max(0, Math.min(dt, 0.1));
      const available = canPet();
      const stick = input.state.pet;
      const push = stick ? Math.min(1, Math.hypot(stick.x, stick.y)) : 0;
      const want = available ? Math.max(input.state.touch || stick?.pressed ? 1 : 0, push) : 0;
      const easeSeconds = !available ? 0.18 : want ? 0.28 : 0.55;
      envelope += (want - envelope) * (1 - Math.exp(-dt / easeSeconds));
      if (envelope < 1e-3 && want === 0) {
        envelope = 0;
        phase = 0;
      } else {
        phase = (phase + dt * Math.PI * 2 * 1.35) % (Math.PI * 4);
      }
      dog.anim.pet = envelope;
      dog.anim.petPhase = phase;
      dog.anim.petTarget = target;
    },
  };
}
