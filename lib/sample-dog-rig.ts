import { Matrix4, Vector3, Vector4 } from "three";
import { SplatSkinning, SplatSkinningMode, type SplatMesh } from "@sparkjsdev/spark";
import type { DogMotion } from "./dog-motion";
import { createSampleDogPose, LEG_BASES, smooth, type DogAttention, type GroundHeight, type Segment } from "./sample-dog-pose";

export function createSampleDogRig(mesh: SplatMesh, groundHeight?: GroundHeight) {
  const pose = createSampleDogPose();
  const { rest } = pose;
  const skin = new SplatSkinning({ mesh, numBones: rest.length, mode: SplatSkinningMode.LINEAR_BLEND });
  const identity = new Matrix4();
  rest.forEach((_, i) => skin.setRestMatrix(i, identity));
  const indices = new Vector4();
  const weights = new Vector4();
  const delta = new Vector3();
  const closest = new Vector3();
  const distance = (p: Vector3, bone: Segment) => {
    delta.subVectors(bone.end, bone.start);
    const t = Math.max(0, Math.min(1, closest.subVectors(p, bone.start).dot(delta) / delta.lengthSq()));
    return closest.copy(bone.start).addScaledVector(delta, t).distanceToSquared(p);
  };
  mesh.forEachSplat((index, p) => {
    const head = 1 - smooth(-0.17, -0.09, p.y);
    const neck = (1 - head) * (1 - smooth(-0.06, 0.045, p.y)) * (1 - smooth(-0.08, 0.04, p.x));
    const tail = smooth(0.32, 0.365, p.x) * smooth(0.12, 0.24, p.y);
    const front = (1 - smooth(-0.19, -0.105, p.x)) * smooth(0.055, 0.17, p.y);
    const rear = smooth(-0.005, 0.09, p.x) * smooth(0.16, 0.29, p.y) * (1 - tail);
    const side = smooth(-0.035, 0.035, p.z);
    const scores: [number, number][] = [[0, Math.max(0.001, (1 - head - neck) * (1 - front) * (1 - rear) * (1 - tail))], [1, neck], [2, head], [3, tail]];
    for (let s = 0; s < 2; s++) {
      for (const [start, strength] of [[LEG_BASES[s * 2], front], [LEG_BASES[s * 2 + 1], rear]]) {
        const values = Array.from({ length: 3 }, (_, k) => 1 / (0.0006 + distance(p, rest[start + k])) ** 2);
        const total = values.reduce((a, b) => a + b, 0);
        values.forEach((v, k) => scores.push([start + k, strength * (s ? side : 1 - side) * v / total]));
      }
    }
    scores.sort((a, b) => b[1] - a[1]);
    const total = scores.slice(0, 4).reduce((sum, item) => sum + item[1], 0);
    indices.set(...scores.slice(0, 4).map(([i]) => i) as [number, number, number, number]);
    weights.set(...scores.slice(0, 4).map(([, w]) => w / total) as [number, number, number, number]);
    skin.setSplatBones(index, indices, weights);
  });
  skin.skinTexture.needsUpdate = true;
  mesh.skinning = skin;
  mesh.updateGenerator();
  return {
    pose,
    update(motion: DogMotion, dt = 1 / 60, attention?: DogAttention) {
      mesh.updateWorldMatrix(true, false);
      pose.update(motion, dt, mesh.matrixWorld, attention, groundHeight);
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
