import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import type { createDogAnimation } from "./dog-animation";

export function createDogRigOverlay(pose: ReturnType<typeof createDogAnimation>) {
  const root = new Group();
  root.visible = false;
  root.matrixAutoUpdate = false;
  root.matrix.copy(pose.profile.fromCanonical);
  const positions = new BufferAttribute(new Float32Array(pose.rest.length * 6), 3);
  const geometry = new BufferGeometry().setAttribute("position", positions);
  const material = new LineBasicMaterial({ color: 0x38f8db, depthTest: false, transparent: true });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 1000;
  const marker = new Mesh(new SphereGeometry(0.014 * pose.profile.unit, 12, 8),
    new MeshBasicMaterial({ color: 0xffde59, depthTest: false, transparent: true }));
  marker.renderOrder = 1001;
  root.add(lines, marker);
  let selected = "upperLip";
  return {
    root,
    show(visible: boolean, key = selected) { root.visible = visible; selected = key; },
    update() {
      if (!root.visible) return;
      pose.posed.forEach((bone, i) => {
        positions.setXYZ(i * 2, bone.start.x, bone.start.y, bone.start.z);
        positions.setXYZ(i * 2 + 1, bone.end.x, bone.end.y, bone.end.z);
      });
      positions.needsUpdate = true;
      const point = pose.profile.landmarks?.[selected];
      marker.visible = Boolean(point);
      if (point) {
        const bone = selected === "upperLip" || selected === "jawHinge" ? 2
          : pose.rest.findIndex(b => b.end.equals(point));
        marker.position.copy(point).applyMatrix4(pose.matrices[Math.max(0, bone)]);
      }
    },
    dispose() {
      root.removeFromParent(); geometry.dispose(); material.dispose();
      marker.geometry.dispose(); marker.material.dispose();
    },
  };
}
