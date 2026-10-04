import { createDogAnimation } from "./dog-animation";
import { sampleDogProfile } from "./sample-dog-profile";
export { solveLimb, smooth, LEG_BASES, SHOULDERS, PELVIS, JAW } from "./dog-animation";
export type { DogAttention, GroundHeight, Segment } from "./dog-animation";

export function createSampleDogPose() {
  return createDogAnimation(sampleDogProfile());
}
