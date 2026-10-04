import type { SplatMesh } from "@sparkjsdev/spark";
import { rigDog } from "./dog-rig";
import { sampleDogProfile } from "./sample-dog-profile";
import type { GroundHeight } from "./dog-animation";

export function createSampleDogRig(mesh: SplatMesh, groundHeight?: GroundHeight) {
  return rigDog(mesh, sampleDogProfile(), groundHeight);
}
