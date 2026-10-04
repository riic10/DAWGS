import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { JAW, type createSampleDogPose } from "./sample-dog-pose";
import { JAW_HINGE, UPPER_LIP } from "./sample-dog-mouth";

export function createMouthInterior(pose: ReturnType<typeof createSampleDogPose>) {
  const root = new Group(), upper = new Group(), lower = new Group();
  root.visible = false;
  upper.matrixAutoUpdate = lower.matrixAutoUpdate = false;
  const geometry = new SphereGeometry(1, 20, 12);
  const material = new MeshBasicMaterial({ color: 0x241819 });
  const palate = UPPER_LIP.clone().sub(JAW_HINGE), length = palate.length();
  for (const group of [upper, lower]) {
    const surface = new Mesh(geometry, material);
    surface.position.copy(JAW_HINGE).addScaledVector(palate, 0.5);
    surface.scale.set(length * 0.49, 0.006, 0.043);
    surface.rotation.z = Math.atan2(palate.y, palate.x);
    group.add(surface);
    root.add(group);
  }
  const cavity = new Mesh(geometry, material);
  upper.add(cavity);
  const mid = new Vector3(), axis = new Vector3(0, 0, 1);
  return {
    root,
    update() {
      // The closed scan has no inner surfaces to expose when its lower jaw opens.
      root.visible = pose.jaw.angle > 0.035;
      upper.matrix.copy(pose.matrices[2]);
      lower.matrix.copy(pose.matrices[JAW]);
      mid.copy(palate).applyAxisAngle(axis, -pose.jaw.angle * 0.5);
      cavity.position.copy(JAW_HINGE).addScaledVector(mid, 0.45);
      cavity.rotation.z = Math.atan2(mid.y, mid.x);
      cavity.scale.set(length * 0.44, Math.sin(pose.jaw.angle * 0.5) * length * 0.45, 0.042);
    },
    dispose() { geometry.dispose(); material.dispose(); root.removeFromParent(); },
  };
}
