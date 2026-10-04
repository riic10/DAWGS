import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { createShadow } from "./shadow.js";

// Rotation applied to every dog PLY (Euler XYZ, radians). TRELLIS writes them
// Y-down (usual 3DGS/COLMAP convention), so flip about X. Flipped, they face -X.
const FLIP = new THREE.Euler(Math.PI, 0, 0);

const UP = new THREE.Vector3(0, 1, 0);

// Standing on uneven ground (see stance() in loadDog).
export const GAIT = {
  footForward: 0.4, // paws (the four corners) from the centre, × the dog's length…
  footSide: 0.3, //   …and × its width
  lean: 0.5, // fraction of the slope the body leans into; dogs stay mostly upright
  maxTilt: 0.25, // rad cap on that lean
  sink: 0.02, // × height a paw may settle into loose ground (gravel, grass)
  easeSeconds: 0.06, // smoothing for height and tilt; hides height-map noise without lagging
};

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
// `groundAt` (a scene's ground.at) makes the dog stand on the ground under
// its paws wherever it is, every frame; without it, it stands at ground.y.
export async function loadDog(scene, { ground, normal = UP, facing, height }, shadowCfg, source, groundAt = null) {
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
    // Height and lean (pitch: nose up; roll: left side up), eased toward the
    // targets in update(dt) so uneven ground doesn't jolt the dog.
    pose: { y: ground.y, pitch: 0, roll: 0 },
    target: { y: ground.y, pitch: 0, roll: 0 },
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

    // Place the dog at `point` right away (no easing).
    setPose(point, newFacing = dog.facing, groundNormal = dog.groundNormal) {
      dog.facing = newFacing;
      dog.groundNormal.copy(groundNormal);
      root.position.x = point.x;
      root.position.z = point.z;
      Object.assign(dog.target, { y: point.y, pitch: 0, roll: 0 });
      stance();
      Object.assign(dog.pose, dog.target);
      applyPose();
    },

    setFacing(newFacing) {
      dog.facing = newFacing;
      applyPose();
    },

    // Move to (x, z); height and lean follow in update(dt).
    moveOnGround(x, z) {
      root.position.x = x;
      root.position.z = z;
    },

    // Turn the dog's resting direction, e.g. when a generated model faces
    // the wrong way.
    turn(radians) {
      dog.home.facing += radians;
      dog.setFacing(dog.facing + radians);
    },

    // Unit vector the dog faces, on the horizontal plane.
    forward(target = new THREE.Vector3()) {
      return target.set(Math.sin(dog.facing), 0, Math.cos(dog.facing));
    },

    update(dt = 0) {
      if (!shadow) return;
      stance();
      const k = dt > 0 ? 1 - Math.exp(-dt / GAIT.easeSeconds) : 0;
      for (const key of ["y", "pitch", "roll"]) dog.pose[key] += (dog.target[key] - dog.pose[key]) * k;
      applyPose();
      const { petHop, petRoll, petYaw, runHop } = dog.anim;
      const hop = petHop + runHop;
      body.position.y = hop;
      body.rotation.set(petRoll, petYaw, 0);
      shadow.place(root.position, dog.groundNormal);
      shadow.setStrength(1 - Math.min(1, hop / (height * 0.3)) * 0.5);
    },
  };

  // Stand on the ground under all four paws at the current spot and facing:
  // lean partly into the slope between them, at the height where none sinks.
  function stance() {
    if (!groundAt || !dog.length) return;
    const { x, z } = root.position;
    const fx = Math.sin(dog.facing), fz = Math.cos(dog.facing); // forward
    const rx = fz, rz = -fx; // right
    const center = groundAt(x, z);
    const fallback = center ? center.y : dog.target.y;
    const h = (dx, dz) => groundAt(x + dx, z + dz)?.y ?? fallback;
    const f = GAIT.footForward * dog.length, w = GAIT.footSide * dog.width;
    // Ground under each paw: front/back (s = ±1) × left/right (t = ±1).
    const paws = [];
    for (const s of [1, -1]) for (const t of [1, -1]) {
      paws.push({ s, t, y: h(s * fx * f - t * rx * w, s * fz * f - t * rz * w) });
    }
    const avg = (pick) => paws.filter(pick).reduce((sum, p) => sum + p.y, 0) / 2;
    const clamp = (a) => Math.max(-GAIT.maxTilt, Math.min(GAIT.maxTilt, a));
    const pitch = clamp(GAIT.lean * Math.atan2(avg((p) => p.s > 0) - avg((p) => p.s < 0), 2 * f));
    const roll = clamp(GAIT.lean * Math.atan2(avg((p) => p.t > 0) - avg((p) => p.t < 0), 2 * w));
    // Lowest height at which no paw is below the ground under that lean.
    const tp = Math.tan(pitch) * f, tr = Math.tan(roll) * w;
    dog.target.y = Math.max(...paws.map((p) => p.y - p.s * tp - p.t * tr)) - GAIT.sink * height;
    dog.target.pitch = pitch;
    dog.target.roll = roll;
    if (center) dog.groundNormal.copy(center.normal);
  }

  // Yaw about the world up, then lean: pitch about the dog's side axis
  // (local Z; negative raises the nose, since it faces -X), roll about its
  // length axis (local X). The pivot is the bottom centre, between the paws.
  function applyPose() {
    root.position.y = dog.pose.y;
    root.rotation.set(dog.pose.roll, dog.facing + Math.PI / 2, -dog.pose.pitch, "YZX");
  }

  dog.setPose(ground, facing, normal);
  await dog.setModel(source);
  dog.setPose(ground, facing, normal); // again, now that the paws' spacing is known
  return dog;
}

// Signed shortest angle from a to b, in (-π, π].
export function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
