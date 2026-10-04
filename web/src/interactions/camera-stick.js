import * as THREE from "three";

// Camera joystick -> orbit around the dog: left/right swings the camera round,
// up/down tilts it. Speed grows with how far the stick is pushed. Clicking the
// stick puts the camera back where the scene started. The mouse keeps working
// alongside, and the distance sensor still sets how far away the camera is.
export const CAMERA_STICK = {
  orbitSpeed: 1.6, // rad/s at full deflection, left/right
  tiltSpeed: 0.9, // rad/s at full deflection, up/down
  responseSeconds: 0.12, // smoothing, so a flick doesn't jerk the view
  resetSeconds: 0.5,
};

const offset = new THREE.Vector3();
const spherical = new THREE.Spherical();

// `home`: { radius, phi, theta } of the starting view.
export function createCameraStick(input, camera, controls, home) {
  let vTheta = 0;
  let vPhi = 0;
  let reset = null; // { from: Spherical, t } while easing back to the start

  input.on("camerapress", () => {
    offset.subVectors(camera.position, controls.target);
    reset = { from: new THREE.Spherical().setFromVector3(offset), t: 0 };
  });

  return {
    // Call after controls.update(), before the distance sensor.
    update(dt) {
      const { x, y } = input.state.cam;
      const k = 1 - Math.exp(-dt / CAMERA_STICK.responseSeconds);
      vTheta += (-x * CAMERA_STICK.orbitSpeed - vTheta) * k;
      vPhi += (y * CAMERA_STICK.tiltSpeed - vPhi) * k;
      if (x !== 0 || y !== 0) reset = null; // the stick wins over a reset in progress

      offset.subVectors(camera.position, controls.target);
      spherical.setFromVector3(offset);
      if (reset) {
        reset.t = Math.min(1, reset.t + dt / CAMERA_STICK.resetSeconds);
        const e = THREE.MathUtils.smootherstep(reset.t, 0, 1);
        const dTheta = Math.atan2(Math.sin(home.theta - reset.from.theta), Math.cos(home.theta - reset.from.theta));
        spherical.theta = reset.from.theta + dTheta * e;
        spherical.phi = THREE.MathUtils.lerp(reset.from.phi, home.phi, e);
        spherical.radius = THREE.MathUtils.lerp(reset.from.radius, home.radius, e);
        if (reset.t === 1) reset = null;
      } else if (Math.abs(vTheta) > 1e-4 || Math.abs(vPhi) > 1e-4) {
        spherical.theta += vTheta * dt;
        spherical.phi += vPhi * dt;
      } else {
        return;
      }
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, Math.max(controls.minPolarAngle, 1e-3), Math.min(controls.maxPolarAngle, Math.PI - 1e-3));
      spherical.theta = THREE.MathUtils.clamp(spherical.theta, controls.minAzimuthAngle, controls.maxAzimuthAngle);
      camera.position.setFromSpherical(spherical).add(controls.target);
      camera.lookAt(controls.target);
    },
  };
}
