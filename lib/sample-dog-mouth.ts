import { Vector3 } from "three";

export const JAW_HINGE = new Vector3(-0.26, -0.20, 0);
export const UPPER_LIP = new Vector3(-0.395, -0.213, 0);
const palate = UPPER_LIP.clone().sub(JAW_HINGE);
const down = new Vector3(palate.y, -palate.x, 0).normalize();

export function sampleDogGrip(radius: number) {
  const angle = 2 * Math.atan2(Math.max(0, radius), palate.length());
  return {
    center: UPPER_LIP.clone().addScaledVector(down, radius),
    angle,
    openAngle: Math.max(0.65, angle + 0.22),
  };
}
