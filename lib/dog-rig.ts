import { Matrix4, Vector3, Vector4 } from "three";
import { SplatSkinning, SplatSkinningMode, type SplatMesh } from "@sparkjsdev/spark";
import { dogSkinWeights, fitDogRig } from "./dog-rig-fit";
import { createDogPose } from "./dog-rig-pose";
import type { DogMotion } from "./dog-motion";

export { DogRigFitError } from "./dog-rig-fit";

export function createDogRig(mesh: SplatMesh) {
  const points: Vector3[] = [];
  const interval = Math.max(1, Math.floor((mesh.splats?.getNumSplats() ?? 0) / 30_000));
  mesh.forEachSplat((index, p, _scale, _rotation, opacity) => {
    if (index % interval === 0 && opacity > 0.1) points.push(p.clone());
  });
  const fit = fitDogRig(points);
  const pose = createDogPose(fit);
  const skin = new SplatSkinning({ mesh, numBones: fit.rest.length, mode: SplatSkinningMode.LINEAR_BLEND });
  const identity = new Matrix4();
  fit.rest.forEach((_, i) => skin.setRestMatrix(i, identity));
  const indices = new Vector4(), weights = new Vector4(), canonical = new Vector3();
  mesh.forEachSplat((index, p) => {
    const influences = dogSkinWeights(canonical.copy(p).applyMatrix4(fit.toCanonical), fit);
    indices.set(influences[0][0], influences[1][0], influences[2][0], influences[3][0]);
    weights.set(influences[0][1], influences[1][1], influences[2][1], influences[3][1]);
    skin.setSplatBones(index, indices, weights);
  });
  skin.skinTexture.needsUpdate = true;
  mesh.skinning = skin;
  mesh.updateGenerator();
  return {
    fit,
    update(motion: DogMotion) {
      pose.update(motion);
      pose.matrices.forEach((matrix, i) => skin.setBoneMatrix(i, matrix));
      skin.updateBones();
    },
    dispose() {
      mesh.skinning = null;
      skin.skinTexture.dispose();
      skin.boneTexture.dispose();
    },
  };
}
