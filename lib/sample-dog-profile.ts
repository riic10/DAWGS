import { Matrix4, Vector3 } from "three";
import type { DogProfile, Segment } from "./dog-profile";
const JAW_HINGE = new Vector3(-0.26, -0.20, 0);
const UPPER_LIP = new Vector3(-0.395, -0.213, 0);
const point = (x: number, y: number, z = 0) => new Vector3(x, y, z);
const FLOOR = 0.405;

// The landmarks use the sample scan's coordinates: forward is -X and down is +Y.
function sampleDogRest(): Segment[] {
  const rest = [
    { start: point(-0.14, -0.02), end: point(0.24, 0.23) },
    { start: point(-0.14, -0.02), end: point(-0.15, -0.13) },
    { start: point(-0.15, -0.13), end: point(-0.18, -0.32) },
    { start: point(0.34, 0.22), end: point(0.39, 0.42) },
  ];
  for (const side of [-1, 1]) {
    const z = side * 0.105;
    rest.push(
      { start: point(-0.15, 0.04, z), end: point(-0.185, 0.22, z) },
      { start: point(-0.185, 0.22, z), end: point(-0.265, 0.385, z) },
      { start: point(-0.265, 0.385, z), end: point(-0.27, FLOOR, z) },
      { start: point(0.24, 0.23, z), end: point(0.12, 0.32, z) },
      { start: point(0.12, 0.32, z), end: point(0.25, 0.385, z) },
      { start: point(0.25, 0.385, z), end: point(0.14, FLOOR, z) },
    );
  }
  for (const side of [-1, 1]) {
    rest.push({ start: point(-0.07, -0.04, side * 0.105), end: point(-0.15, 0.04, side * 0.105) });
  }
  rest.push({ start: point(0.24, 0.23), end: point(0.31, 0.24) });
  rest.push({ start: JAW_HINGE.clone(), end: UPPER_LIP.clone() });
  return rest;
}

export function sampleDogProfile(): DogProfile {
  const rest = sampleDogRest();
  return {
    rest, sample: true, unit: 1, floor: FLOOR, startsStanding: false,
    toCanonical: new Matrix4(), fromCanonical: new Matrix4(),
    heading: 0, ground: FLOOR, height: 0.849,
    sittingChest: rest[0].start.clone(),
    standingChest: rest[0].start.clone().add(point(-0.10, 0.045)),
    sittingAngle: Math.atan2(0.25, 0.38), standingAngle: 0.17,
    pickupShift: point(-0.04, 0.10), pickupAngle: -0.12,
    sittingPaws: [6, 9, 12, 15].map(i => rest[i].end.clone()),
    standingPaws: [6, 9, 12, 15].map((i, n) => point(n % 2 ? 0.205 : -0.27, FLOOR, rest[i].end.z)),
    rearFootAngles: [0, -0.875],
    gaitDrop: 0, cycleScale: 1, shoulderSwing: 0.3,
    mouth: { hinge: JAW_HINGE.clone(), upperLip: UPPER_LIP.clone(), lowerLip: UPPER_LIP.clone(), width: 0.086, nativeAngle: 0 },
  };
}
