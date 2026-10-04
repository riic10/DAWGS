import { Vector3 } from "three";
import type { DogMouth } from "./dog-profile";

export function dogGrip(mouth: DogMouth, radius: number) {
  const palate = mouth.upperLip.clone().sub(mouth.hinge);
  const down = new Vector3(palate.y, -palate.x, 0).normalize();
  const length = Math.min(palate.length(), mouth.lowerLip.distanceTo(mouth.hinge));
  const upper = palate.clone().setLength(length).add(mouth.hinge);
  const lower = mouth.lowerLip.clone().sub(mouth.hinge).setLength(length).add(mouth.hinge);
  const angle = 2 * Math.atan2(Math.max(0, radius), length);
  return {
    center: upper.clone().addScaledVector(down, radius), upper, lower,
    angle: angle - mouth.nativeAngle,
    openAngle: Math.max(0.65, angle + 0.22, mouth.nativeAngle + 0.22) - mouth.nativeAngle,
  };
}
