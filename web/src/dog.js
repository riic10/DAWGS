import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { createShadow } from "./shadow.js";

// Rotation applied to every dog PLY (Euler XYZ, radians). TRELLIS writes them
// Y-down (usual 3DGS/COLMAP convention), so flip about X. Flipped, they face -X.
const FLIP = new THREE.Euler(Math.PI, 0, 0);

const UP = new THREE.Vector3(0, 1, 0);

function splatSource(source) {
  if (source.url) return { url: source.url };
  // Copy: Spark may hand the buffer to a worker, and the caller keeps the
  // original for downloads and re-selecting this dog.
  if (source.fileBytes) return { fileBytes: source.fileBytes.slice(0), fileType: "ply" };
  throw new Error("Dog model needs a url or fileBytes");
}

// Loads the dog as root (position on the ground, yaw) -> body (animation
// offsets) -> splats (flip, scale, centring). The bottom centre of the dog
// sits at root's origin, and root's local -X is the way the dog faces.
//
// Facing is an azimuth in radians from +Z toward +X, the same convention as
// OrbitControls. Animation modules write `dog.anim`; `dog.update()` applies it.
// `source` is { url } or { fileBytes }; `dog.setModel()` swaps it later while
// root, body, home and anim (and everything holding the dog) stay the same.
export async function loadDog(scene, { ground, normal = UP, facing, height }, shadowCfg, source) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  scene.add(root);

  let shadow = null;

  const dog = {
    root, body, height,
    splats: null,
    length: 0, // along the facing direction
    width: 0,
    home: { ground: ground.clone(), normal: normal.clone(), facing },
    facing,
    groundNormal: normal.clone(),
    // Offsets from the animation modules, summed in update().
    anim: { petHop: 0, petRoll: 0, petYaw: 0, runHop: 0 },

    // Load a model and swap it in, scaled to `height` with its paws at
    // root's origin. The old model is disposed once the new one is ready.
    async setModel(src) {
      const splats = new SplatMesh(splatSource(src));
      await splats.initialized;
      splats.quaternion.setFromEuler(FLIP);
      splats.updateMatrix();
      const box = splats.getBoundingBox(true).applyMatrix4(splats.matrix);
      const size = box.getSize(new THREE.Vector3());
      if (!(size.y > 0)) {
        splats.dispose();
        throw new Error("That model has no splats");
      }
      const scale = height / size.y;
      splats.scale.setScalar(scale);
      const center = box.getCenter(new THREE.Vector3());
      splats.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

      const old = dog.splats;
      body.add(splats);
      dog.splats = splats;
      dog.length = size.x * scale;
      dog.width = size.z * scale;
      if (old) {
        body.remove(old);
        old.dispose();
      }
      const shadowRadius = Math.max(dog.length, dog.width) * 0.55;
      if (shadow) shadow.setSize(shadowRadius);
      else shadow = createShadow(scene, shadowCfg, shadowRadius, height * 0.0025);
      dog.update();
      return dog;
    },

    setPose(point, newFacing = dog.facing, groundNormal = dog.groundNormal) {
      dog.facing = newFacing;
      dog.groundNormal.copy(groundNormal);
      root.position.copy(point);
      root.rotation.set(0, newFacing + Math.PI / 2, 0);
    },

    // Turn the dog's resting direction, e.g. when a generated model faces
    // the wrong way.
    turn(radians) {
      dog.home.facing += radians;
      dog.setPose(root.position, dog.facing + radians);
    },

    // Unit vector the dog faces, on the horizontal plane.
    forward(target = new THREE.Vector3()) {
      return target.set(Math.sin(dog.facing), 0, Math.cos(dog.facing));
    },

    update() {
      if (!shadow) return;
      const { petHop, petRoll, petYaw, runHop } = dog.anim;
      const hop = petHop + runHop;
      body.position.y = hop;
      body.rotation.set(petRoll, petYaw, 0);
      shadow.place(root.position, dog.groundNormal);
      shadow.setStrength(1 - Math.min(1, hop / (height * 0.3)) * 0.5);
    },
  };
  dog.setPose(ground, facing, normal);
  await dog.setModel(source);
  return dog;
}

// Signed shortest angle from a to b, in (-π, π].
export function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
