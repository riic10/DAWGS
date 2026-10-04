import * as THREE from "three";
import { createShadow } from "../shadow.js";
import { angleDelta } from "../dog.js";

// Button -> fetch game. 1st press: a ball appears in "your hand" in front of
// the camera. 2nd press: throw it toward the dog. It bounces and rolls to a stop on the
// ground, then the dog fetches it and drops it back at its spot.
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
  turnSpeed: 5, // rad/s, dog
  hopsPerSecond: 2.5,
  noticeSeconds: 0.25, // pause before the dog sets off
  mouth: { forward: 0.42, up: 0.62 }, // from the dog's centre, × its length / height
};

const UP = new THREE.Vector3(0, 1, 0);
const STEP = 1 / 120;

export function createBall({ scene, camera, dog, input, world, onState }) {
  const { ground, unitsPerMeter: upm, ballRadius: radius } = world;
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

  let state = "idle";
  let stateTime = 0;
  let slowTime = 0;
  let runTime = 0;

  function setState(next) {
    state = next;
    stateTime = 0;
    onState?.(next);
  }

  // --- Dog movement -----------------------------------------------------------
  // Turn toward an azimuth; true once facing it.
  function turnToward(azimuth, dt) {
    const d = angleDelta(dog.facing, azimuth);
    const stepAngle = Math.sign(d) * Math.min(Math.abs(d), BALL.turnSpeed * dt);
    dog.setFacing(dog.facing + stepAngle);
    return Math.abs(d) < 0.05;
  }

  // Hop-glide toward (x, z), stopping when `arrived()` says so. Stands and turns
  // first if the target is well off to the side.
  function runToward(x, z, dt, arrived) {
    const p = dog.root.position;
    const azimuth = Math.atan2(x - p.x, z - p.z);
    if (arrived()) {
      dog.anim.runHop = 0;
      return true;
    }
    const facingOk = turnToward(azimuth, dt) || Math.abs(angleDelta(dog.facing, azimuth)) < 0.6;
    if (facingOk) {
      const remaining = Math.hypot(x - p.x, z - p.z);
      const stepLen = Math.min(remaining, BALL.runSpeed * upm * dt);
      const nx = p.x + Math.sin(dog.facing) * stepLen;
      const nz = p.z + Math.cos(dog.facing) * stepLen;
      dog.moveOnGround(nx, nz); // the dog keeps all four paws on the ground and leans with the slope
      runTime += dt;
      // sin², not |sin|: lands softly instead of bouncing off a hard corner.
      dog.anim.runHop = 0.06 * dog.height * Math.sin(Math.PI * BALL.hopsPerSecond * runTime) ** 2;
    }
    return false;
  }

  // From the dog's current size, so it follows model swaps.
  function mouthWorld(target) {
    dog.root.updateMatrixWorld(true);
    return dog.body.localToWorld(target.set(-BALL.mouth.forward * dog.length, BALL.mouth.up * dog.height, 0));
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

  function dropInFrontOfDog() {
    dog.forward(tmp).multiplyScalar(BALL.mouth.forward * dog.length + radius * 2).add(dog.root.position);
    const G = groundAt(tmp.x, tmp.z) ?? fallbackGround;
    pos.set(tmp.x, G.y + radius, tmp.z);
    vel.set(0, 0, 0);
    shadow.setVisible(true);
    placeShadow(G);
  }

  // --- Button -----------------------------------------------------------------
  input.on("buttonpress", () => {
    if (state === "idle") {
      ball.visible = true;
      shadow.setVisible(false);
      setState("ready");
    } else if (state === "ready") {
      // Throw toward the dog, spread to one side, ~30° up, with the speed that
      // first lands it a little past or short of the dog. Solves for the
      // height drop to the aim point too: the ball starts at the camera,
      // usually well above the dog's ground, and the path slopes.
      const home = dog.home.ground;
      const side = Math.random() < 0.5 ? -1 : 1;
      const heading = Math.atan2(home.x - pos.x, home.z - pos.z) + side * THREE.MathUtils.randFloat(...BALL.throwSpread);
      const range = Math.max(
        BALL.minThrow * upm,
        Math.hypot(home.x - pos.x, home.z - pos.z) + THREE.MathUtils.randFloat(...BALL.landPastDog) * upm,
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
    get state() { return state; },

    // Back to idle with no ball, and the dog home and still: used when the dog
    // model is swapped mid-game.
    reset() {
      ball.visible = false;
      shadow.setVisible(false);
      vel.set(0, 0, 0);
      dog.anim.runHop = 0;
      dog.setPose(dog.home.ground, dog.home.facing, dog.home.normal);
      setState("idle");
    },
    // The dog can be petted while it's sitting at home.
    dogAtHome: () => state === "idle" || state === "ready",

    update(dt) {
      stateTime += dt;
      if (state === "ready") {
        // Look at whoever is holding the ball.
        const p = dog.root.position;
        turnToward(Math.atan2(camera.position.x - p.x, camera.position.z - p.z), dt);
      } else if (state === "flying") {
        for (let left = dt; left > 1e-6; left -= STEP) {
          const { G, onGround } = stepBall(Math.min(STEP, left));
          placeShadow(G);
          slowTime = onGround && vel.length() < BALL.restSpeed * upm ? slowTime + STEP : 0;
        }
        // Watch it fly.
        const p = dog.root.position;
        turnToward(Math.atan2(pos.x - p.x, pos.z - p.z), dt);
        if (slowTime >= BALL.restSeconds || stateTime > BALL.maxFlightSeconds) {
          const G = groundAt(pos.x, pos.z) ?? fallbackGround;
          pos.y = G.y + radius;
          vel.set(0, 0, 0);
          placeShadow(G);
          runTime = 0;
          setState("fetching");
        }
      } else if (state === "fetching") {
        if (stateTime < BALL.noticeSeconds) return;
        const reach = radius + 0.08 * dog.length;
        const done = runToward(pos.x, pos.z, dt, () => {
          const m = mouthWorld(tmp);
          const close = Math.hypot(m.x - pos.x, m.z - pos.z) < reach;
          // Ball under the dog's chest: no room to reach it with the mouth.
          const tooClose = Math.hypot(dog.root.position.x - pos.x, dog.root.position.z - pos.z)
            < BALL.mouth.forward * dog.length;
          return close || (tooClose && stateTime > BALL.noticeSeconds + 0.3);
        });
        if (done) {
          shadow.setVisible(false);
          runTime = 0;
          setState("returning");
        }
      } else if (state === "returning") {
        const home = dog.home.ground;
        const there = runToward(home.x, home.z, dt, () =>
          Math.hypot(dog.root.position.x - home.x, dog.root.position.z - home.z) < 0.02 * dog.length);
        if (there && turnToward(dog.home.facing, dt)) {
          dog.moveOnGround(home.x, home.z); // eases into its home stance instead of snapping
          dog.anim.runHop = 0;
          dropInFrontOfDog();
          setState("idle");
        }
      }
    },

    // After the dog and camera have moved this frame: carried/held positions.
    lateUpdate() {
      if (state === "ready") {
        camera.updateMatrixWorld();
        camera.localToWorld(pos.copy(BALL.holdMeters).multiplyScalar(upm));
      } else if (state === "returning") {
        mouthWorld(pos);
      }
    },
  };
}
