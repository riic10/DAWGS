import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { createShadow } from "./shadow.js";

const DOG = {
  url: "/dog_model.spz", // built from dog_model.ply by tools/ply-to-spz.mjs
  // Rotation applied to the raw PLY (Euler XYZ, radians). The PLY is Y-down
  // (usual 3DGS/COLMAP convention), so flip it about X. Flipped, it faces -X.
  rotation: new THREE.Euler(Math.PI, 0, 0),
};

const UP = new THREE.Vector3(0, 1, 0);

// Loads the dog as root (position on the ground, yaw) -> body (animation
// offsets) -> splats (flip, scale, centring). The bottom centre of the dog
// sits at root's origin, and root's local -X is the way the dog faces.
//
// Facing is an azimuth in radians from +Z toward +X, the same convention as
// OrbitControls. Animation modules write `dog.anim`; `dog.update()` applies it.
export async function loadDog(scene, { ground, normal = UP, facing, height }, shadowCfg) {
  const splats = new SplatMesh({ url: DOG.url });
  await splats.initialized;

  splats.quaternion.setFromEuler(DOG.rotation);
  splats.updateMatrix();
  const box = splats.getBoundingBox(true).applyMatrix4(splats.matrix);
  const size = box.getSize(new THREE.Vector3());
  const scale = height / size.y;
  splats.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3());
  splats.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(splats);
  scene.add(root);

  const length = size.x * scale; // along the facing direction
  const width = size.z * scale;
  const shadowRadius = Math.max(length, width) * 0.55;
  const shadow = createShadow(scene, shadowCfg, shadowRadius, height * 0.0025);

  const dog = {
    root, body, splats, height, length, width,
    home: { ground: ground.clone(), normal: normal.clone(), facing },
    facing,
    groundNormal: normal.clone(),
    // Offsets from the animation modules, summed in update().
    anim: { petHop: 0, petRoll: 0, petYaw: 0, runHop: 0 },

    setPose(point, newFacing = dog.facing, groundNormal = dog.groundNormal) {
      dog.facing = newFacing;
      dog.groundNormal.copy(groundNormal);
      root.position.copy(point);
      root.rotation.set(0, newFacing + Math.PI / 2, 0);
    },

    // Unit vector the dog faces, on the horizontal plane.
    forward(target = new THREE.Vector3()) {
      return target.set(Math.sin(dog.facing), 0, Math.cos(dog.facing));
    },

    update() {
      const { petHop, petRoll, petYaw, runHop } = dog.anim;
      const hop = petHop + runHop;
      body.position.y = hop;
      body.rotation.set(petRoll, petYaw, 0);
      shadow.place(root.position, dog.groundNormal);
      shadow.setStrength(1 - Math.min(1, hop / (height * 0.3)) * 0.5);
    },
  };
  dog.setPose(ground, facing, normal);
  dog.update();
  return dog;
}

// Signed shortest angle from a to b, in (-π, π].
export function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
