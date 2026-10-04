import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { JAW, type createDogAnimation } from "./dog-animation";

export function createMouthInterior(pose: ReturnType<typeof createDogAnimation>) {
  const { hinge, upperLip, lowerLip, width, nativeAngle } = pose.profile.mouth;
  const root = new Group(), upper = new Group(), lower = new Group();
  root.matrixAutoUpdate = false;
  root.matrix.copy(pose.profile.fromCanonical);
  root.visible = false;
  upper.matrixAutoUpdate = lower.matrixAutoUpdate = false;
  const geometry = new SphereGeometry(1, 20, 12);
  const material = new MeshBasicMaterial({ color: 0x241819 });
  const palate = upperLip.clone().sub(hinge), length = palate.length();
  for (const group of [upper, lower]) {
    const direction = (group === upper ? upperLip : lowerLip).clone().sub(hinge);
    const surface = new Mesh(geometry, material);
    surface.position.copy(hinge).addScaledVector(direction, 0.5);
    surface.scale.set(direction.length() * 0.49, width * 0.07, width * 0.5);
    surface.rotation.z = Math.atan2(direction.y, direction.x);
    group.add(surface);
    root.add(group);
  }
  const cavity = new Mesh(geometry, material);
  upper.add(cavity);
  const mid = new Vector3(), axis = new Vector3(0, 0, 1);
  return {
    root,
    update() {
      // Scans often lack the inner surfaces exposed by an opening jaw.
      const angle = pose.jaw.angle + nativeAngle;
      root.visible = angle > 0.035;
      upper.matrix.copy(pose.matrices[2]);
      lower.matrix.copy(pose.matrices[JAW]);
      mid.copy(palate).applyAxisAngle(axis, -angle * 0.5);
      cavity.position.copy(hinge).addScaledVector(mid, 0.45);
      cavity.rotation.z = Math.atan2(mid.y, mid.x);
      cavity.scale.set(length * 0.44, Math.sin(angle * 0.5) * length * 0.45, width * 0.49);
    },
    dispose() { geometry.dispose(); material.dispose(); root.removeFromParent(); },
  };
}
