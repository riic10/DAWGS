// Touch sensor -> pet the dog: a happy hop and wiggle while touched, eased in
// and out. `canPet()` lets the fetch game veto it while the dog is busy.
const EASE_SECONDS = 0.2;

export function createPet(dog, input, canPet) {
  let envelope = 0;
  let t = 0;

  return {
    update(dt) {
      const want = input.state.touch && canPet() ? 1 : 0;
      envelope += (want - envelope) * (1 - Math.exp(-dt / EASE_SECONDS));
      if (envelope < 1e-3 && want === 0) {
        envelope = 0;
        t = 0;
      } else {
        t += dt;
      }
      dog.anim.petHop = envelope * 0.06 * dog.height * Math.abs(Math.sin(9 * t));
      dog.anim.petRoll = envelope * 0.12 * Math.sin(14 * t);
      dog.anim.petYaw = envelope * 0.08 * Math.sin(7 * t);
    },
  };
}
