import * as THREE from "three";

// Ultrasonic distance -> camera distance: the closer the person stands to the
// sensor, the closer the camera gets to the dog. The mouse still orbits; if
// the sensor goes quiet, the mouse wheel takes over again.
export const CAMERA_DISTANCE = {
  nearCm: 10, // at or under this: camera at controls.minDistance
  farCm: 80, // at or over this: camera at controls.maxDistance
  smoothingSeconds: 0.3,
  staleMs: 1000, // no valid reading for this long: stop overriding
};

const dir = new THREE.Vector3();

export function createCameraDistance(input, camera, controls) {
  let radius = null;

  return {
    // Call after controls.update().
    update(dt) {
      const { distance, distanceAt } = input.state;
      if (distance === null || performance.now() - distanceAt > CAMERA_DISTANCE.staleMs) {
        radius = null;
        return;
      }
      const { nearCm, farCm, smoothingSeconds } = CAMERA_DISTANCE;
      const t = THREE.MathUtils.clamp((distance - nearCm) / (farCm - nearCm), 0, 1);
      const want = THREE.MathUtils.lerp(controls.minDistance, controls.maxDistance, t);
      dir.subVectors(camera.position, controls.target);
      if (radius === null) radius = dir.length();
      radius += (want - radius) * (1 - Math.exp(-dt / smoothingSeconds));
      camera.position.copy(controls.target).addScaledVector(dir.normalize(), radius);
    },
  };
}
