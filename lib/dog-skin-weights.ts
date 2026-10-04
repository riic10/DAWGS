import { Vector3 } from "three";
import { smooth } from "./dog-animation";
import { LEG_BASES, SHOULDERS, PELVIS, JAW, type DogProfile, type Segment } from "./dog-profile";

const delta = new Vector3(), closest = new Vector3();
function distance(p: Vector3, bone: Segment) {
  delta.subVectors(bone.end, bone.start);
  const t = Math.max(0, Math.min(1, closest.subVectors(p, bone.start).dot(delta) / Math.max(delta.lengthSq(), 1e-10)));
  return closest.copy(bone.start).addScaledVector(delta, t).distanceToSquared(p);
}

function sampleWeights(p: Vector3, rest: Segment[]): [number, number][] {
  const head = 1 - smooth(-0.17, -0.09, p.y);
  const lipLine = -0.213 + (p.x + 0.395) * 0.10;
  const jaw = smooth(lipLine - 0.002, lipLine + 0.002, p.y) * (1 - smooth(-0.29, -0.25, p.x))
    * (1 - smooth(0.07, 0.09, Math.abs(p.z))) * (1 - smooth(-0.165, -0.145, p.y));
  const neck = (1 - head) * (1 - smooth(-0.06, 0.045, p.y)) * (1 - smooth(-0.08, 0.04, p.x));
  const tail = smooth(0.32, 0.365, p.x) * smooth(0.12, 0.24, p.y);
  const front = (1 - smooth(-0.19, -0.105, p.x)) * smooth(0.055, 0.17, p.y);
  const rear = smooth(-0.005, 0.09, p.x) * smooth(0.16, 0.29, p.y) * (1 - tail);
  const side = smooth(-0.035, 0.035, p.z);
  const torso = Math.max(0.001, (1 - head - neck) * (1 - front) * (1 - rear) * (1 - tail));
  const shoulder = (1 - smooth(-0.075, 0.05, p.x)) * smooth(-0.10, -0.03, p.y) * (1 - smooth(0.06, 0.12, p.y));
  const pelvis = smooth(0.08, 0.24, p.x) * smooth(0.10, 0.20, p.y);
  const scores: [number, number][] = [
    [0, torso * (1 - shoulder) * (1 - pelvis)], [1, neck * (1 - jaw)], [2, head * (1 - jaw)], [3, tail], [JAW, (head + neck) * jaw],
    [SHOULDERS[0], torso * shoulder * (1 - side)], [SHOULDERS[1], torso * shoulder * side],
    [PELVIS, torso * (1 - shoulder) * pelvis],
  ];
  for (let s = 0; s < 2; s++) {
    for (const [start, strength] of [[LEG_BASES[s * 2], front], [LEG_BASES[s * 2 + 1], rear]]) {
      const values = Array.from({ length: 3 }, (_, k) => 1 / (0.0006 + distance(p, rest[start + k])) ** 2);
      const total = values.reduce((a, b) => a + b, 0);
      values.forEach((v, k) => scores.push([start + k, strength * (s ? side : 1 - side) * v / total]));
    }
  }
  scores.sort((a, b) => b[1] - a[1]);

  return scores.slice(0, 4);
}

export function profileSkinWeights(p: Vector3, profile: DogProfile): [number, number][] {
  if (profile.sample) return normalize(sampleWeights(p, profile.rest));
  const { rest, unit: u, mouth } = profile;
  const chest = rest[0].start, hip = rest[0].end, neck = rest[1].end;
  const span = hip.x - chest.x;
  const head = smooth(neck.y + 0.06 * u, neck.y - 0.07 * u, p.y)
    * (1 - smooth(neck.x + 0.07 * u, chest.x + span * 0.25, p.x));
  const neckWeight = (1 - head) * (1 - smooth(chest.y - 0.02 * u, chest.y + 0.10 * u, p.y))
    * (1 - smooth(chest.x, chest.x + span * 0.25, p.x));
  const seamX = mouth.upperLip.x * 0.55 + mouth.lowerLip.x * 0.45;
  const seamY = mouth.upperLip.y * 0.55 + mouth.lowerLip.y * 0.45;
  const lipLine = seamY + (mouth.hinge.y - seamY) * (p.x - seamX) / (mouth.hinge.x - seamX);
  const jaw = smooth(lipLine - 0.003 * u, lipLine + 0.003 * u, p.y)
    * (1 - smooth(mouth.hinge.x - 0.02 * u, mouth.hinge.x + 0.02 * u, p.x))
    * (1 - smooth(mouth.width * 0.5, mouth.width * 0.75, Math.abs(p.z)))
    * (1 - smooth(lipLine + 0.05 * u, lipLine + 0.075 * u, p.y));
  const tailFront = Math.min(hip.x, rest[3].end.x) - 0.12 * u;
  const raisedTail = rest[3].end.y < hip.y - 0.1 * u
    ? smooth(hip.y - 0.03 * u, hip.y - 0.20 * u, p.y) : 0;
  const tail = smooth(tailFront, tailFront + 0.10 * u, p.x)
    * (1 - smooth(0.05 * u, 0.085 * u, Math.abs(p.z)))
    * Math.max(raisedTail, 1 - smooth(0.002 * u * u, 0.01 * u * u, distance(p, rest[3])));
  const frontRegion = 1 - smooth(chest.x + span * 0.2, chest.x + span * 0.6, p.x);
  const front = frontRegion * smooth(chest.y + 0.07 * u, chest.y + 0.25 * u, p.y) * (1 - head) * (1 - tail);
  const rear = (1 - frontRegion) * smooth(hip.y + 0.06 * u, hip.y + 0.25 * u, p.y) * (1 - tail);
  const side = smooth(-0.035 * u, 0.035 * u, p.z);
  const torso = Math.max(0.001, (1 - head - neckWeight) * (1 - front) * (1 - rear) * (1 - tail));
  const shoulder = frontRegion * (1 - smooth(0.005 * u * u, 0.035 * u * u, Math.min(distance(p, rest[16]), distance(p, rest[17]))));
  const pelvis = smooth(chest.x + span * 0.65, hip.x, p.x) * (1 - tail);
  const scores: [number, number][] = [
    [0, torso * (1 - shoulder) * (1 - pelvis)], [1, neckWeight * (1 - jaw)], [2, head * (1 - jaw)],
    [3, tail], [JAW, (head + neckWeight) * jaw], [PELVIS, torso * (1 - shoulder) * pelvis],
    [16, torso * shoulder * (1 - side)], [17, torso * shoulder * side],
  ];
  for (let s = 0; s < 2; s++) {
    for (const [base, strength] of [[LEG_BASES[s * 2], front], [LEG_BASES[s * 2 + 1], rear]]) {
      const values = [0, 1, 2].map(k => 1 / (0.0006 * u * u + distance(p, rest[base + k])) ** 2);
      const total = values.reduce((a, b) => a + b, 0);
      values.forEach((v, k) => scores.push([base + k, strength * (s ? side : 1 - side) * v / total]));
    }
  }
  return normalize(scores.sort((a, b) => b[1] - a[1]).slice(0, 4));
}

function normalize(scores: [number, number][]): [number, number][] {
  const total = scores.reduce((sum, [, weight]) => sum + weight, 0);
  return scores.map(([bone, weight]) => [bone, weight / total]);
}
