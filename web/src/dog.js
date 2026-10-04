import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { createShadow } from "./shadow.js";
import { createDogMotion, stepDog } from "../../lib/dog-motion.ts";
import { createSampleDogRig } from "../../lib/sample-dog-rig.ts";

const DOG = {
  url: "/dog_model.spz", // built from dog_model.ply by tools/ply-to-spz.mjs
  // Rotation applied to the raw PLY (Euler XYZ, radians). The PLY is Y-down
  // (usual 3DGS/COLMAP convention), so flip it about X. Flipped, it faces -X.
  rotation: new THREE.Euler(Math.PI, 0, 0),
};

const UP = new THREE.Vector3(0, 1, 0);

// Loads the dog as root (position on the ground, yaw) -> body (terrain
// alignment) -> splats (flip, scale, centring). The bottom centre of the dog
// sits at root's origin, and root's local -X is the way the dog faces.
//
// Facing is an azimuth in radians from +Z toward +X, the same convention as
// OrbitControls. Animation modules write `dog.anim`; `dog.update()` applies it.
export async function loadDog(scene, { ground, normal = UP, facing, height, unitsPerMeter, groundHeight }, shadowCfg) {
  const splats = new SplatMesh({ url: DOG.url, lod: false, enableLod: false, extSplats: true, covSplats: true });
  await splats.initialized;
  const rig = createSampleDogRig(splats, groundHeight);
  const motion = createDogMotion();
  const noKeys = new Set();
  const previousPosition = ground.clone();
  let previousFacing = facing;
  const attention = { target: null, pickup: 0, pet: 0, petPhase: 0, petTarget: null, mouthTarget: null, mouthRadius: 0, jawOpen: 0 };
  const lookTarget = new THREE.Vector3();
  const mouthTarget = new THREE.Vector3(), pickupPoint = new THREE.Vector3(), forward = new THREE.Vector3();
  const localBall = new THREE.Vector3(), inverseWorld = new THREE.Matrix4();
  const localUp = new THREE.Vector3();
  const terrainTilt = new THREE.Quaternion();
  const targetTilt = new THREE.Quaternion();

  splats.quaternion.setFromEuler(DOG.rotation);
  splats.updateMatrix();
  const box = splats.getBoundingBox(true).applyMatrix4(splats.matrix);
  const size = box.getSize(new THREE.Vector3());
  const scale = height / size.y;
  splats.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3());
  // The rig plants its paws at raw Y = 0.405, above the outliers in the bounds.
  splats.position.set(-center.x * scale, 0.405 * scale, -center.z * scale);

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
    root, body, splats, height, length, width, motion, joints: rig.pose,
    pickup: 0,
    mouthRadius: 0, jawOpen: 0,
    home: { ground: ground.clone(), normal: normal.clone(), facing },
    facing,
    groundNormal: normal.clone(),
    anim: { pet: 0, petPhase: 0, petTarget: null },

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

    lookAt(point) {
      attention.target = point ? lookTarget.copy(point) : null;
    },

    mouthWorld(target = new THREE.Vector3()) {
      splats.updateWorldMatrix(true, false);
      return target.copy(rig.pose.mouth).applyMatrix4(splats.matrixWorld);
    },

    reachMouth(point) {
      attention.mouthTarget = point ? mouthTarget.copy(point) : null;
    },

    pickupPoint(target = new THREE.Vector3()) {
      splats.updateWorldMatrix(true, false);
      return target.copy(rig.pose.pickupGround).applyMatrix4(splats.matrixWorld);
    },

    pickupDistance(point) {
      splats.updateWorldMatrix(true, false);
      localBall.copy(point).applyMatrix4(inverseWorld.copy(splats.matrixWorld).invert());
      return rig.pose.pickupApproach(localBall, pickupPoint).applyMatrix4(splats.matrixWorld)
        .sub(root.position).dot(dog.forward(forward));
    },

    prepareFrame(dt) {
      stepDog(motion, noKeys, dt);
    },

    update(dt = 0) {
      const distance = Math.hypot(root.position.x - previousPosition.x, root.position.z - previousPosition.z) / unitsPerMeter;
      const turn = angleDelta(previousFacing, dog.facing);
      if (motion.stand === 1 && motion.target === 1 && dt > 0) {
        motion.speed = distance / dt;
        motion.turn = distance > 1e-6 ? 0 : Math.abs(turn) > 1e-6 ? Math.sign(turn) : 0;
        if (distance > 1e-6 || motion.turn) motion.stride = 1;
        // Animate from actual fetch travel so the gait follows the existing path motion.
        motion.phase += (distance || Math.abs(turn) * 0.23 / 1.8) * Math.PI * 2 / 0.4;
      }
      previousPosition.copy(root.position);
      previousFacing = dog.facing;
      localUp.copy(dog.groundNormal).applyAxisAngle(UP, -root.rotation.y);
      targetTilt.setFromUnitVectors(UP, localUp);
      terrainTilt.slerp(targetTilt, 1 - Math.exp(-dt * 10));
      body.quaternion.copy(terrainTilt);
      attention.pickup = dog.pickup;
      attention.mouthRadius = dog.mouthRadius;
      attention.jawOpen = dog.jawOpen;
      attention.pet = dog.anim.pet;
      attention.petPhase = dog.anim.petPhase;
      attention.petTarget = dog.anim.petTarget;
      rig.update(motion, dt, attention);
      shadow.place(root.position, dog.groundNormal);
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
