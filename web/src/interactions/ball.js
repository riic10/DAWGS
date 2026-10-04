import * as THREE from "three";
import { createShadow } from "../shadow.js";
import { angleDelta } from "../dog.js";
import { planDelivery } from "./delivery.js";

// Button -> fetch game. 1st press: a ball appears in "your hand" in front of
// the camera. 2nd press: throw it toward the dog. It bounces and rolls to a stop on the
// ground, then the dog fetches it and brings it to the viewer.
//
// Distances are in metres and scaled by the scene's units per metre.
export const BALL = {
  holdMeters: new THREE.Vector3(0.18, -0.15, -0.5), // camera space: right, up, forward
  // Aim at the dog and land this far past it (negative: short of it), so the
  // fetch stays on the path near the dog wherever the camera is.
  landPastDog: [-1, 2.5], // m, random in range
  minThrow: 1.5, // m
  maxThrowSpeed: 12, // m/s
  throwElevation: 0.5, // rad (~30°) above horizontal
  throwSpread: [0.15, 0.45], // rad either side of the dog, so it rarely hits it
  restitution: 0.45,
  bounceFriction: 0.6, // fraction of along-ground speed kept per bounce (grass, gravel)
  bounceSpeed: 0.6, // m/s into the ground; slower contacts roll instead of bounce
  rollingResistance: 0.6, // deceleration while rolling, as a fraction of g
  restSpeed: 0.08, // m/s; slower than this for restSeconds counts as stopped
  restSeconds: 0.25,
  maxFlightSeconds: 6,
  blockHeightMeters: 2.5, // blocked cells (trees, rocks) stop the ball below this height
  runSpeed: 1.5, // m/s, dog
  runAcceleration: 3, // m/s², dog
  turnSpeed: 5, // rad/s, dog
  noticeSeconds: 0.25, // pause before the dog sets off
  pickupSeconds: 0.65,
  gripSeconds: 0.14,
  liftSeconds: 0.45,
};

const UP = new THREE.Vector3(0, 1, 0);
const STEP = 1 / 120;

export function createBall({ scene, camera, dog, input, world, onState }) {
  const { ground, unitsPerMeter: upm, ballRadius: radius } = world;
  dog.mouthRadius = radius;
  const g = 9.8 * upm;

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xcfe23a, roughness: 0.75 }),
  );
  ball.visible = false;
  scene.add(ball);
  const shadowCfg = { ...world.shadow, lift: Math.min(world.shadow.lift ?? 0, radius * 0.3) };
  const shadow = createShadow(scene, shadowCfg, radius * 1.6, radius * 0.02);
  shadow.setVisible(false);

  const fallbackGround = { y: dog.home.ground.y, normal: UP, blocked: false };
  const groundAt = (x, z) => ground.at(x, z);

  const pos = ball.position;
  const prev = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const pickupStart = new THREE.Vector3();
  const dropTarget = new THREE.Vector3();
  const lastViewer = new THREE.Vector3(), lastViewDirection = new THREE.Vector3(), viewDirection = new THREE.Vector3();

  let state = "idle";
  let stateTime = 0;
  let slowTime = 0;
  let returnPose = dog.motion.target;
  let runSpeed = 0;
  let attached = false, closing = false, gripTime = 0, releasedAt = null;
  let delivery = null, waypoint = 0, plannedAt = -Infinity, deliveryBlocked = false;

  function setState(next) {
    state = next;
    stateTime = 0;
    runSpeed = 0;
    onState?.(next);
  }

  // --- Dog movement -----------------------------------------------------------
  // Turn toward an azimuth; true once facing it.
  function turnToward(azimuth, dt) {
    const d = angleDelta(dog.facing, azimuth);
    const stepAngle = Math.sign(d) * Math.min(Math.abs(d), BALL.turnSpeed * dt);
    dog.setPose(dog.root.position, dog.facing + stepAngle);
    return Math.abs(d) < 0.05;
  }

  // Wait for standing to finish before moving the dog along the fetch path.
  function runToward(x, z, dt, arrived, stopDistance = 0, followPath = false) {
    if (dog.motion.stand !== 1) return false;
    const p = dog.root.position;
    const azimuth = Math.atan2(x - p.x, z - p.z);
    if (arrived()) {
      runSpeed = 0;
      return true;
    }
    const facingOk = turnToward(azimuth, dt) || Math.abs(angleDelta(dog.facing, azimuth)) < (followPath ? 0.15 : 0.6);
    if (facingOk) {
      const remaining = Math.hypot(x - p.x, z - p.z);
      const travel = remaining - stopDistance;
      const brakingSpeed = Math.sqrt(2 * BALL.runAcceleration * Math.abs(travel) / upm);
      const targetSpeed = Math.min(travel < 0 ? 0.4 : BALL.runSpeed, Math.max(0.15, brakingSpeed));
      runSpeed += Math.sign(targetSpeed - runSpeed) * Math.min(Math.abs(targetSpeed - runSpeed), BALL.runAcceleration * dt);
      const stepLen = Math.sign(travel) * Math.min(Math.abs(travel), runSpeed * upm * dt);
      const heading = followPath ? azimuth : dog.facing;
      const nx = p.x + Math.sin(heading) * stepLen;
      const nz = p.z + Math.cos(heading) * stepLen;
      const G = groundAt(nx, nz) ?? fallbackGround;
      dog.setPose(tmp.set(nx, G.y, nz), dog.facing, G.normal);
    } else runSpeed = 0;
    return false;
  }

  function mouthWorld(target) {
    return dog.mouthWorld(target);
  }

  // --- Ball physics -----------------------------------------------------------
  function isWall(G, y) {
    return !G || (G.blocked && y - G.y < BALL.blockHeightMeters * upm);
  }

  function stepBall(dt) {
    vel.y -= g * dt;
    prev.copy(pos);
    pos.addScaledVector(vel, dt);

    // Walls: the edge of the known ground, or a blocked cell while low. Only
    // when entering one, so a throw that starts inside one can still leave.
    const prevG = groundAt(prev.x, prev.z);
    let G = groundAt(pos.x, pos.z);
    if (!isWall(prevG, prev.y) && isWall(G, pos.y)) {
      const hitX = isWall(groundAt(pos.x, prev.z), pos.y);
      const hitZ = isWall(groundAt(prev.x, pos.z), pos.y);
      if (hitX || !hitZ) { pos.x = prev.x; vel.x *= -BALL.restitution; }
      if (hitZ || !hitX) { pos.z = prev.z; vel.z *= -BALL.restitution; }
      G = groundAt(pos.x, pos.z);
    }
    G ??= prevG ?? fallbackGround;

    let onGround = false;
    if (pos.y - radius <= G.y) {
      onGround = true;
      pos.y = G.y + radius;
      const vn = vel.dot(G.normal);
      if (vn < -BALL.bounceSpeed * upm) {
        vel.addScaledVector(G.normal, -vn).multiplyScalar(BALL.bounceFriction); // along the ground
        vel.addScaledVector(G.normal, -BALL.restitution * vn); // back up
      } else {
        if (vn < 0) vel.addScaledVector(G.normal, -vn); // stay on the surface
        const speed = vel.length();
        const decel = BALL.rollingResistance * g * dt;
        if (speed <= decel) vel.set(0, 0, 0);
        else vel.multiplyScalar(1 - decel / speed);
      }
      // Roll: spin about the axis perpendicular to travel along the ground.
      tmp.crossVectors(G.normal, vel);
      const spin = tmp.length() * dt / radius;
      if (spin > 0) ball.rotateOnWorldAxis(tmp.normalize(), spin);
    }
    return { G, onGround };
  }

  function placeShadow(G) {
    shadow.place(tmp.set(pos.x, G.y, pos.z), G.normal);
    const height = pos.y - radius - G.y;
    shadow.setStrength(1 - Math.min(1, height / (1.5 * upm)));
  }

  // --- Button -----------------------------------------------------------------
  const removeButtonListener = input.on("buttonpress", () => {
    if (state === "idle") {
      returnPose = dog.motion.target;
      ball.visible = true;
      shadow.setVisible(false);
      setState("ready");
    } else if (state === "ready") {
      // Throw toward the dog, spread to one side, ~30° up, with the speed that
      // first lands it a little past or short of the dog. Solves for the
      // height drop to the aim point too: the ball starts at the camera,
      // usually well above the dog's ground, and the path slopes.
      const dogPosition = dog.root.position;
      const side = Math.random() < 0.5 ? -1 : 1;
      const heading = Math.atan2(dogPosition.x - pos.x, dogPosition.z - pos.z) + side * THREE.MathUtils.randFloat(...BALL.throwSpread);
      const range = Math.max(
        BALL.minThrow * upm,
        Math.hypot(dogPosition.x - pos.x, dogPosition.z - pos.z) + THREE.MathUtils.randFloat(...BALL.landPastDog) * upm,
      );
      const aimX = pos.x + Math.sin(heading) * range, aimZ = pos.z + Math.cos(heading) * range;
      const drop = pos.y - ((groundAt(aimX, aimZ) ?? fallbackGround).y + radius);
      const cos = Math.cos(BALL.throwElevation), tan = Math.tan(BALL.throwElevation);
      // drop + R·tanθ − g·R² / (2v²cos²θ) = 0
      const speed = Math.min(
        BALL.maxThrowSpeed * upm,
        Math.sqrt((g * range * range) / (2 * cos * cos * Math.max(drop + range * tan, 1e-3))),
      );
      vel.set(
        Math.sin(heading) * Math.cos(BALL.throwElevation),
        Math.sin(BALL.throwElevation),
        Math.cos(heading) * Math.cos(BALL.throwElevation),
      ).multiplyScalar(speed);
      slowTime = 0;
      shadow.setVisible(true);
      setState("flying");
    }
  });

  return {
    dispose() {
      removeButtonListener?.();
      ball.removeFromParent();
      ball.geometry.dispose();
      ball.material.dispose();
      shadow.dispose();
    },
    mesh: ball,
    get state() { return state; },
    get attached() { return attached; },
    get deliveryTarget() { return delivery?.points.at(-1) ?? null; },
    // Touch is available between fetches, wherever the last delivery finished.
    dogAtHome: () => state === "idle" || state === "ready",

    update(dt) {
      stateTime += dt;
      if (state === "ready") dog.lookAt(camera.position);
      else if (["flying", "standing", "fetching", "collecting"].includes(state)) dog.lookAt(pos);
      else if (state === "dropping") dog.lookAt(dropTarget);
      else dog.lookAt(null);
      if (state === "ready") {
        // Look at whoever is holding the ball.
        const p = dog.root.position;
        if (stateTime > 0.25) turnToward(Math.atan2(camera.position.x - p.x, camera.position.z - p.z), dt);
      } else if (state === "flying") {
        for (let left = dt; left > 1e-6; left -= STEP) {
          const { G, onGround } = stepBall(Math.min(STEP, left));
          placeShadow(G);
          slowTime = onGround && vel.length() < BALL.restSpeed * upm ? slowTime + STEP : 0;
        }
        // Watch it fly.
        const p = dog.root.position;
        if (stateTime > 0.16) turnToward(Math.atan2(pos.x - p.x, pos.z - p.z), dt);
        if (slowTime >= BALL.restSeconds || stateTime > BALL.maxFlightSeconds) {
          const G = groundAt(pos.x, pos.z) ?? fallbackGround;
          pos.y = G.y + radius;
          vel.set(0, 0, 0);
          placeShadow(G);
          dog.motion.target = 1;
          setState(dog.motion.stand === 1 ? "fetching" : "standing");
        }
      } else if (state === "standing") {
        if (dog.motion.stand === 1) setState("fetching");
      } else if (state === "fetching") {
        if (stateTime < BALL.noticeSeconds) return;
        const reach = dog.pickupDistance(pos);
        const done = runToward(pos.x, pos.z, dt, () => {
          const dx = pos.x - dog.root.position.x, dz = pos.z - dog.root.position.z;
          return Math.abs(Math.hypot(dx, dz) - reach) < 0.004 * upm
            && Math.abs(angleDelta(dog.facing, Math.atan2(dx, dz))) < 0.05;
        }, reach);
        if (done) {
          pickupStart.copy(pos);
          dog.reachMouth(pickupStart);
          closing = false;
          gripTime = 0;
          delivery = null;
          plannedAt = -Infinity;
          setState("collecting");
        }
      } else if (state === "collecting") {
        dog.pickup = Math.min(1, stateTime / BALL.pickupSeconds);
        dog.jawOpen = closing ? dog.gripAmount : 1;
        if (attached) gripTime += dt;
        if (gripTime >= BALL.gripSeconds) setState("returning");
      } else if (state === "returning") {
        dog.jawOpen = dog.gripAmount;
        dog.pickup = Math.max(0, dog.pickup - dt / BALL.liftSeconds);
        if (dog.pickup > 0) return;
        dog.reachMouth(null);
        camera.getWorldDirection(viewDirection);
        if (stateTime - plannedAt > 0.35 && (!delivery || camera.position.distanceTo(lastViewer) > 0.12 * upm
          || viewDirection.distanceTo(lastViewDirection) > 0.08)) {
          delivery = planDelivery({
            start: dog.root.position, camera, ground, unitsPerMeter: upm,
            clearance: Math.max(0.08 * upm, dog.width * 0.5),
            reach: dog.pickupPoint(tmp).sub(dog.root.position).setY(0).length(),
            height: dog.height,
          });
          waypoint = 0;
          plannedAt = stateTime;
          lastViewer.copy(camera.position);
          lastViewDirection.copy(viewDirection);
          if (deliveryBlocked !== !delivery) {
            deliveryBlocked = !delivery;
            onState?.(deliveryBlocked ? "deliveryBlocked" : "returning");
          }
        }
        if (!delivery) return;
        const destination = delivery.points[waypoint];
        const there = runToward(destination.x, destination.z, dt, () =>
          Math.hypot(dog.root.position.x - destination.x, dog.root.position.z - destination.z) < 0.004 * upm, 0, true);
        if (there && waypoint < delivery.points.length - 1) { waypoint++; return; }
        if (there && turnToward(delivery.facing, dt)) {
          const arrivalGround = groundAt(destination.x, destination.z);
          dog.setPose(destination, delivery.facing, arrivalGround.normal);
          dog.motion.speed = dog.motion.turn = dog.motion.stride = 0;
          dog.pickupPoint(dropTarget);
          const G = groundAt(dropTarget.x, dropTarget.z) ?? fallbackGround;
          dropTarget.y = G.y + radius + 0.07 * upm;
          dog.reachMouth(dropTarget);
          releasedAt = null;
          slowTime = 0;
          setState("dropping");
        }
      } else if (state === "dropping") {
        if (releasedAt === null) {
          dog.pickup = Math.min(1, stateTime / BALL.pickupSeconds);
          dog.jawOpen = stateTime < BALL.pickupSeconds ? dog.gripAmount : 1;
          if (stateTime >= BALL.pickupSeconds + BALL.gripSeconds && dog.releaseReady) {
            attached = false;
            releasedAt = stateTime;
            vel.set(0, 0, 0);
            shadow.setVisible(true);
          }
        } else {
          dog.pickup = Math.max(0, 1 - (stateTime - releasedAt) / BALL.liftSeconds);
          dog.jawOpen = stateTime - releasedAt < 0.16 ? 1 : 0;
          for (let left = dt; left > 1e-6; left -= STEP) {
            const step = Math.min(STEP, left);
            const { G, onGround } = stepBall(step);
            placeShadow(G);
            slowTime = onGround && vel.length() < BALL.restSpeed * upm ? slowTime + step : 0;
          }
        }
        if (releasedAt !== null && slowTime >= BALL.restSeconds && dog.pickup === 0) {
          dog.reachMouth(null);
          dog.jawOpen = 0;
          dog.motion.target = returnPose;
          setState("idle");
        }
      }
    },

    // After the dog and camera have moved this frame: carried/held positions.
    lateUpdate() {
      if (state === "ready") {
        camera.updateMatrixWorld();
        camera.localToWorld(pos.copy(BALL.holdMeters).multiplyScalar(upm));
      } else if (state === "collecting") {
        if (!attached && mouthWorld(tmp).distanceTo(pos) < radius * 0.08) {
          closing = true;
          if (dog.gripReady) {
            attached = true;
            shadow.setVisible(false);
          }
        }
      }
      if (attached) mouthWorld(pos);
    },
  };
}
