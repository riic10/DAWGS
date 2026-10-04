import { Matrix4, Quaternion, Vector3 } from "three";
import type { DogMotion } from "./dog-motion";
import { smooth, type DogRigFit, type Segment } from "./dog-rig-fit";

export function createDogPose(fit: DogRigFit) {
  const posed: Segment[] = fit.rest.map(b => ({ start: b.start.clone(), end: b.end.clone() }));
  const matrices = fit.rest.map(() => new Matrix4());
  const from = new Vector3(), to = new Vector3(), unit = new Vector3(1, 1, 1);
  const rotation = new Quaternion(), stretch = new Matrix4(), translation = new Matrix4();
  const bodyLength = fit.standing[0].start.distanceTo(fit.standing[0].end);
  return {
    posed,
    matrices,
    update(motion: DogMotion) {
      const stand = smooth(0, 1, motion.stand);
      const gait = motion.stride * stand;
      const bob = Math.cos(motion.phase * 4) * 0.007 * gait;
      posed.forEach((b, i) => {
        b.start.copy(fit.sitting[i].start).lerp(fit.standing[i].start, stand);
        b.end.copy(fit.sitting[i].end).lerp(fit.standing[i].end, stand);
      });
      posed[0].start.y += bob; posed[0].end.y += bob;
      posed[1].start.y += bob; posed[1].end.y += bob;
      posed[2].start.y += bob; posed[2].end.y += bob;
      posed[2].end.z += Math.sin(motion.phase) * 0.035 * gait;
      for (let side = 0; side < 2; side++) {
        const base = 3 + side * 5;
        const direction = motion.speed === 0 && motion.turn !== 0 ? (side ? 1 : -1) * motion.turn : 1;
        const cycle = motion.phase * direction + side * Math.PI;
        for (const [start, count, offset] of [[base, 2, 0], [base + 2, 3, Math.PI / 2]]) {
          const t = (((cycle + offset) / (Math.PI * 2)) % 1 + 1) % 1;
          const travel = Math.min(0.22, bodyLength * 0.3) * gait;
          const swing = t < 0.6 ? (t / 0.6 - 0.5) * travel : (0.5 - smooth(0, 1, (t - 0.6) / 0.4)) * travel;
          const lift = t < 0.6 ? 0 : Math.sin((t - 0.6) / 0.4 * Math.PI) ** 2 * 0.06 * gait;
          for (let k = 0; k < count; k++) {
            const b = posed[start + k];
            const a = k / count, end = (k + 1) / count;
            b.start.x += swing * a; b.end.x += swing * end;
            b.start.y += bob * (1 - a) - lift * a;
            b.end.y += bob * (1 - end) - lift * end;
          }
        }
      }
      fit.rest.forEach((bone, i) => {
        from.subVectors(bone.end, bone.start);
        to.subVectors(posed[i].end, posed[i].start);
        const extension = to.length() / Math.max(from.length(), 1e-6) - 1;
        from.normalize(); to.normalize();
        rotation.setFromUnitVectors(from, to);
        const { x, y, z } = from;
        // Stretch only along a bone to keep its animated joints connected.
        stretch.set(1 + extension*x*x, extension*x*y, extension*x*z, 0,
          extension*y*x, 1 + extension*y*y, extension*y*z, 0,
          extension*z*x, extension*z*y, 1 + extension*z*z, 0,
          0, 0, 0, 1);
        matrices[i].compose(posed[i].start, rotation, unit).multiply(stretch)
          .multiply(translation.makeTranslation(-bone.start.x, -bone.start.y, -bone.start.z))
          .premultiply(fit.fromCanonical).multiply(fit.toCanonical);
      });
    },
  };
}
