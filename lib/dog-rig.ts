import { Matrix4, Vector3, Vector4 } from "three";
import { SplatSkinning, SplatSkinningMode, type SplatMesh } from "@sparkjsdev/spark";
import { fitDogProfile, type DogCalibration, type DogProfile } from "./dog-profile";
import { createDogAnimation, type DogAttention, type GroundHeight } from "./dog-animation";
import { profileSkinWeights } from "./dog-skin-weights";
import { createMouthInterior } from "./dog-mouth-interior";
import type { DogMotion } from "./dog-motion";
import { createDogRigOverlay } from "./dog-rig-overlay";

export { DogRigFitError } from "./dog-rig-fit";

export function sampleRigPoints(mesh: SplatMesh) {
  const points: Vector3[] = [];
  const interval = Math.max(1, Math.floor((mesh.splats?.getNumSplats() ?? 0) / 30_000));
  mesh.forEachSplat((index, p, _scale, _rotation, opacity) => {
    if (index % interval === 0 && opacity > 0.1) points.push(p.clone());
  });
  return points;
}

export function createDogRig(mesh: SplatMesh, groundHeight?: GroundHeight, calibration?: DogCalibration) {
  return rigDog(mesh, fitDogProfile(sampleRigPoints(mesh), calibration), groundHeight);
}

export function rigDog(mesh: SplatMesh, profile: DogProfile, groundHeight?: GroundHeight) {
  const pose = createDogAnimation(profile);
  const skin = new SplatSkinning({ mesh, numBones: profile.rest.length, mode: SplatSkinningMode.LINEAR_BLEND });
  const identity = new Matrix4(), world = new Matrix4(), raw = new Matrix4();
  profile.rest.forEach((_, i) => skin.setRestMatrix(i, identity));
  const indices = new Vector4(), weights = new Vector4(), canonical = new Vector3();
  mesh.forEachSplat((index, p) => {
    const influences = profileSkinWeights(canonical.copy(p).applyMatrix4(profile.toCanonical), profile);
    indices.set(influences[0][0], influences[1][0], influences[2][0], influences[3][0]);
    weights.set(influences[0][1], influences[1][1], influences[2][1], influences[3][1]);
    skin.setSplatBones(index, indices, weights);
  });
  skin.skinTexture.needsUpdate = true;
  mesh.skinning = skin;
  mesh.updateGenerator();
  const interior = createMouthInterior(pose);
  const overlay = createDogRigOverlay(pose);
  mesh.add(interior.root, overlay.root);
  return {
    fit: profile, pose,
    inspect: overlay.show,
    update(motion: DogMotion, dt = 1 / 60, attention?: DogAttention) {
      mesh.updateWorldMatrix(true, false);
      world.copy(mesh.matrixWorld).multiply(profile.fromCanonical);
      pose.update(motion, dt, world, attention, groundHeight);
      pose.matrices.forEach((matrix, i) => {
        raw.copy(profile.fromCanonical).multiply(matrix).multiply(profile.toCanonical);
        skin.setBoneMatrix(i, raw);
      });
      skin.updateBones();
      interior.update();
      overlay.update();
    },
    dispose() {
      if (mesh.skinning === skin) mesh.skinning = null;
      skin.skinTexture.dispose();
      skin.boneTexture.dispose();
      interior.dispose();
      overlay.dispose();
    },
  };
}
