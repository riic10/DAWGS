import assert from "node:assert/strict";
import { test } from "node:test";
import { Matrix4, Vector3 } from "three";
import { createDogMotion } from "../lib/dog-motion";
import { createSampleDogPose, LEG_BASES, PELVIS, SHOULDERS, solveLimb } from "../lib/sample-dog-pose";

function checkSkeleton(pose: ReturnType<typeof createSampleDogPose>) {
  pose.posed.forEach((bone, i) => {
    assert.ok(Math.abs(bone.start.distanceTo(bone.end) - pose.rest[i].start.distanceTo(pose.rest[i].end)) < 1e-9, `bone ${i} stretched`);
    assert.ok(pose.matrices[i].elements.every(Number.isFinite));
    assert.ok(Math.abs(pose.matrices[i].determinant() - 1) < 1e-9);
  });
  for (const base of LEG_BASES) {
    assert.ok(pose.posed[base].end.distanceTo(pose.posed[base + 1].start) < 1e-9);
    assert.ok(pose.posed[base + 1].end.distanceTo(pose.posed[base + 2].start) < 1e-9);
    const a = pose.posed[base].end.clone().sub(pose.posed[base].start);
    const b = pose.posed[base + 1].end.clone().sub(pose.posed[base + 1].start);
    const bend = a.angleTo(b);
    assert.ok(bend >= 0.10 - 1e-9 && bend <= 2.85 + 1e-9, `joint ${base} bent ${bend}`);
  }
  assert.ok(pose.posed[1].end.equals(pose.posed[2].start));
}

test("sample joints preserve the native scan and bone lengths through sitting, standing and pickup", () => {
  const pose = createSampleDogPose(), motion = createDogMotion();
  pose.update(motion);
  const identity = new Matrix4();
  pose.matrices.forEach(matrix => matrix.elements.forEach((v, i) => assert.ok(Math.abs(v - identity.elements[i]) < 1e-9)));
  for (const target of [1, 0]) {
    motion.target = target;
    for (let frame = 0; frame <= 100; frame++) {
      motion.stand = target ? frame / 100 : 1 - frame / 100;
      pose.update(motion);
      checkSkeleton(pose);
      pose.feet.forEach(foot => assert.ok(pose.posed[foot.base + 2].end.y <= 0.405 + 1e-9));
    }
  }
  motion.stand = motion.target = 1;
  for (let frame = 0; frame <= 100; frame++) {
    pose.update(motion, 1 / 60, identity, { pickup: frame / 100 });
    checkSkeleton(pose);
  }
});

test("planted paws stay at their world contacts while the body travels forward, backward and turns", () => {
  for (const direction of [1, -1]) {
    const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
    motion.stand = motion.target = motion.stride = 1;
    motion.speed = direction * 0.65;
    let contacts = 0, lifts = 0;
    const previous = pose.feet.map(() => ({ planted: false, contact: -1, anchor: new Vector3() }));
    for (let frame = 0; frame < 300; frame++) {
      const yaw = frame / 300;
      world.makeRotationY(yaw).setPosition(-direction * frame * 0.012, 0, 0);
      pose.update(motion, 1 / 60, world);
      checkSkeleton(pose);
      for (const [i, foot] of pose.feet.entries()) {
        const paw = pose.posed[foot.base + 2].end.clone().applyMatrix4(world);
        if (foot.planted) {
          assert.ok(paw.distanceTo(foot.anchor) < 1e-7, `paw ${foot.base}, frame ${frame}: ${paw.distanceTo(foot.anchor)}`);
          if (previous[i].planted && previous[i].contact === foot.contact) assert.ok(foot.anchor.equals(previous[i].anchor));
          contacts++;
        } else if (pose.posed[foot.base + 2].end.y < 0.39) lifts++;
        previous[i] = { planted: foot.planted, contact: foot.contact, anchor: foot.anchor.clone() };
      }
    }
    assert.ok(contacts > 100 && lifts > 50);
  }
});

test("unreachable and coincident paw targets respect bend limits without NaNs or stretching", () => {
  const root = new Vector3(), joint = new Vector3(), end = new Vector3();
  for (const target of [new Vector3(), new Vector3(100, 0, 0), new Vector3(0, 100, 0)]) {
    solveLimb(root, target, 0.2, 0.18, new Vector3(1, 0, 0), joint, end);
    assert.ok(Math.abs(root.distanceTo(joint) - 0.2) < 1e-9);
    assert.ok(Math.abs(joint.distanceTo(end) - 0.18) < 1e-9);
    assert.ok([...joint.toArray(), ...end.toArray()].every(Number.isFinite));
  }
});

test("fast fetches retain paw contacts when a frame crosses touchdown or skips a swing", () => {
  for (const step of [0.055, 0.11, 0.28]) {
    const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
    motion.stand = motion.target = 1;
    motion.speed = 1.5;
    let x = 0, z = 0;
    for (let frame = 0; frame < 120; frame++) {
      const yaw = frame * 0.083;
      x -= Math.cos(yaw) * step; z += Math.sin(yaw) * step;
      world.makeRotationY(yaw).setPosition(x, 0, z);
      pose.update(motion, 1 / 30, world);
      for (const foot of pose.feet.filter(foot => foot.planted)) {
        const paw = pose.posed[foot.base + 2].end.clone().applyMatrix4(world);
        assert.ok(paw.distanceTo(foot.anchor) < 1e-7, `step ${step}, frame ${frame}, paw ${foot.base}`);
      }
    }
  }
});

test("head and neck share a bounded look direction and the mouth follows the head", () => {
  const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
  const restMouth = new Vector3(-0.395, -0.213, 0);
  for (const target of [new Vector3(-2, -1, 3), new Vector3(3, 1, -4)]) {
    for (let frame = 0; frame < 120; frame++) pose.update(motion, 1 / 60, world, { target });
    assert.ok(Math.abs(pose.gaze.yaw) <= 1.15);
    assert.ok(pose.gaze.pitch >= -0.45 && pose.gaze.pitch <= 0.9);
    assert.ok(pose.mouth.distanceTo(restMouth.clone().applyMatrix4(pose.matrices[2])) < 1e-9);
    assert.notDeepEqual(pose.matrices[1].elements, pose.matrices[2].elements);
    checkSkeleton(pose);
  }
  for (let frame = 0; frame < 120; frame++) pose.update(motion);
  assert.ok(Math.abs(pose.gaze.yaw) < 1e-7 && Math.abs(pose.gaze.pitch) < 1e-7);
});

test("pickup reaches a grounded ball through the neck and head at different world scales", () => {
  for (const scale of [0.75, 3]) {
    const pose = createSampleDogPose(), motion = createDogMotion();
    motion.stand = motion.target = 1;
    const world = new Matrix4().makeRotationY(0.8).multiply(new Matrix4().makeRotationX(Math.PI))
      .scale(new Vector3(scale, scale, scale)).setPosition(2, 0.405 * scale, -4);
    const radius = 0.074 * scale;
    const target = new Vector3(-0.54, 0.405 - radius / scale, 0).applyMatrix4(world);
    for (let frame = 0; frame < 90; frame++) {
      pose.update(motion, 1 / 60, world, { pickup: Math.min(1, frame / 45), mouthTarget: target, mouthRadius: radius });
      checkSkeleton(pose);
    }
    assert.ok(pose.mouth.clone().applyMatrix4(world).distanceTo(target) < 1e-7,
      "the mouth must reach the ball before the ball attaches");
    pose.feet.forEach(foot => assert.ok(pose.posed[foot.base + 2].end.clone().applyMatrix4(world).distanceTo(foot.anchor) < 1e-7));
  }
});

test("upper and lower lips contact the same ball at the grip angle across scales and radii", () => {
  for (const scale of [0.75, 3]) {
    for (const radius of [0.035, 0.074, 0.095]) {
      const pose = createSampleDogPose(), motion = createDogMotion();
      const world = new Matrix4().makeScale(scale, scale, scale);
      for (let frame = 0; frame < 90; frame++) pose.update(motion, 1 / 60, world, { mouthRadius: radius * scale, jawOpen: 1 });
      assert.ok(pose.jaw.angle > pose.jaw.gripAngle + 0.14);
      const amount = pose.jaw.gripAngle / pose.jaw.openAngle;
      for (let frame = 0; frame < 90; frame++) {
        pose.update(motion, 1 / 60, world, { mouthRadius: radius * scale, jawOpen: amount });
        checkSkeleton(pose);
      }
      assert.ok(Math.abs(pose.jaw.upper.distanceTo(pose.mouth) - radius) < 1e-8);
      assert.ok(Math.abs(pose.jaw.lower.distanceTo(pose.mouth) - radius) < 1e-8);
      for (let frame = 0; frame < 120; frame++) pose.update(motion, 1 / 60, world, { mouthRadius: radius * scale });
      assert.ok(pose.jaw.upper.distanceTo(pose.jaw.lower) < 1e-8);
    }
  }
});

test("pickup preserves planted paws when the preceding stride stops at different phases", () => {
  for (let stop = 0; stop < 24; stop++) {
    const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
    motion.stand = motion.target = 1;
    motion.speed = 1.5;
    for (let frame = 0; frame < 180 + stop; frame++) {
      world.makeTranslation(-frame * 0.025, 0, 0);
      pose.update(motion, 1 / 60, world);
    }
    motion.speed = 0;
    const target = new Vector3(-0.60, 0.331, 0).applyMatrix4(world);
    for (let frame = 0; frame < 90; frame++) {
      pose.update(motion, 1 / 60, world, { pickup: Math.min(1, frame / 39), mouthTarget: target, mouthRadius: 0.074 });
      checkSkeleton(pose);
      for (const foot of pose.feet.filter(foot => foot.planted)) {
        assert.ok(pose.posed[foot.base + 2].end.clone().applyMatrix4(world).distanceTo(foot.anchor) < 1e-7,
          `paw ${foot.base} slipped during pickup after stop ${stop}`);
      }
    }
  }
});

test("changing from a pivot to a run releases a paw before the limb overextends", () => {
  const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
  motion.stand = motion.target = 1;
  let x = 0, z = 0, yaw = 0;
  for (let frame = 0; frame < 180; frame++) {
    if (frame < 30) x -= 0.055;
    else if (frame >= 60) {
      if (frame < 70) yaw += 0.083;
      if (frame > 63) { x -= Math.cos(yaw) * 0.055; z += Math.sin(yaw) * 0.055; }
    }
    world.makeRotationY(yaw).setPosition(x, 0, z);
    pose.update(motion, 1 / 60, world);
    for (const foot of pose.feet.filter(foot => foot.planted)) {
      assert.ok(pose.posed[foot.base + 2].end.clone().applyMatrix4(world).distanceTo(foot.anchor) < 1e-7, `frame ${frame}, foot ${foot.base}`);
    }
  }
});

test("paw contacts use terrain height with the flipped and scaled viewer coordinates", () => {
  const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
  motion.stand = motion.target = 1;
  const scale = new Vector3(2, 2, 2);
  const height = (p: Vector3) => 0.03 * p.x;
  for (let frame = 0; frame < 160; frame++) {
    const x = -frame * 0.035;
    world.makeRotationX(Math.PI).scale(scale).setPosition(x, 0.81 + x * 0.03, 0);
    pose.update(motion, 1 / 60, world, {}, height);
    for (const foot of pose.feet.filter(foot => foot.planted)) {
      const paw = pose.posed[foot.base + 2].end.clone().applyMatrix4(world);
      assert.ok(paw.distanceTo(foot.anchor) < 1e-7);
      assert.ok(Math.abs(paw.y - height(paw)) < 1e-7);
    }
  }
});

test("stopping settles lifted paws and sitting restores the scan after a moving gait", () => {
  const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
  motion.stand = motion.target = 1;
  for (let frame = 0; frame < 35; frame++) {
    world.makeTranslation(-frame * 0.025, 0, 0);
    pose.update(motion, 1 / 60, world);
  }
  for (let frame = 0; frame < 30; frame++) pose.update(motion, 1 / 60, world);
  assert.ok(pose.feet.every(foot => foot.planted));
  motion.target = 0;
  for (let frame = 0; frame <= 100; frame++) {
    motion.stand = 1 - frame / 100;
    pose.update(motion, 1 / 60, world);
    checkSkeleton(pose);
  }
  const identity = new Matrix4();
  pose.matrices.forEach(matrix => matrix.elements.forEach((value, i) => assert.ok(Math.abs(value - identity.elements[i]) < 1e-9)));
});

test("petting holds the hips and paws in place while the neck leans and the tail moves independently", () => {
  for (const stand of [0, 1]) {
    const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
    motion.stand = motion.target = stand;
    pose.update(motion);
    const paws = pose.feet.map(foot => pose.posed[foot.base + 2].end.clone());
    const hip = pose.posed[0].end.clone(), head = pose.posed[2].end.clone();
    const tailPositions: number[] = [];
    for (let frame = 0; frame < 180; frame++) {
      pose.update(motion, 1 / 60, world, { pet: Math.min(1, frame / 60), petPhase: frame / 60 * Math.PI * 2 * 1.15 });
      checkSkeleton(pose);
      assert.ok(pose.posed[0].end.distanceTo(hip) < 1e-9);
      pose.feet.forEach((foot, i) => assert.ok(pose.posed[foot.base + 2].end.distanceTo(paws[i]) < 1e-9));
      if (frame > 60) tailPositions.push(pose.posed[3].end.z);
    }
    assert.ok(pose.posed[2].end.distanceTo(head) > 0.02);
    assert.ok(Math.max(...tailPositions) - Math.min(...tailPositions) > 0.1);
    for (let frame = 0; frame < 120; frame++) pose.update(motion);
    assert.ok(pose.posed[2].end.distanceTo(head) < 1e-8);
  }
});

test("held petting faces the viewer and keeps a slow neck response after the initial lean", () => {
  for (const side of [-1, 1]) {
    const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
    const heads: Vector3[] = [];
    for (let frame = 0; frame < 360; frame++) {
      pose.update(motion, 1 / 60, world, {
        pet: 1, petPhase: frame / 60 * Math.PI * 2 * 1.35,
        petTarget: new Vector3(-1, -0.5, side),
      });
      checkSkeleton(pose);
      if (frame > 180) heads.push(pose.posed[2].end.clone());
    }
    assert.ok(pose.gaze.yaw * side > 0.2, "the head should turn toward the viewer's side");
    assert.ok(Math.max(...heads.map(head => head.distanceTo(heads[0]))) > 0.01,
      "holding touch should retain a visible, slow neck response");
  }
});

test("walking uses four lateral footfalls and trotting uses diagonal pairs with shorter ground contact", () => {
  const duty: number[] = [];
  for (const speed of [0.4, 1.5]) {
    const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
    motion.stand = motion.target = motion.stride = 1;
    motion.speed = speed;
    let planted = 0, diagonalMismatch = 0;
    const landings: number[] = [];
    const previousContact = [0, 0, 0, 0];
    for (let frame = 0; frame < 1440; frame++) {
      world.makeTranslation(-frame * speed / 120, 0, 0);
      pose.update(motion, 1 / 240, world);
      checkSkeleton(pose);
      if (frame > 240) {
        for (const [i, foot] of pose.feet.entries()) {
          if (foot.planted) {
            planted++;
            assert.ok(pose.posed[foot.base + 2].end.clone().applyMatrix4(world).distanceTo(foot.anchor) < 1e-7);
          }
          if (foot.contact > previousContact[i]) landings.push(i);
        }
        if (pose.feet[0].planted !== pose.feet[3].planted || pose.feet[1].planted !== pose.feet[2].planted) diagonalMismatch++;
      }
      pose.feet.forEach((foot, i) => { previousContact[i] = foot.contact; });
    }
    duty.push(planted / (1199 * 4));
    if (speed < 1) {
      assert.ok(diagonalMismatch > 500);
      for (let i = 1; i < landings.length; i++) {
        const next = [3, 0, 1, 2][landings[i - 1]];
        assert.equal(landings[i], next, `unexpected walk footfall ${landings[i - 1]} -> ${landings[i]}`);
      }
    } else assert.ok(diagonalMismatch < 40, `diagonal pairs disagreed on ${diagonalMismatch} frames`);
  }
  assert.ok(duty[0] > 0.58 && duty[0] < 0.69);
  assert.ok(duty[1] > 0.40 && duty[1] < 0.50);
});

test("shoulders, pelvis, wrists and hocks articulate through a trot without stretching", () => {
  const pose = createSampleDogPose(), motion = createDogMotion(), world = new Matrix4();
  motion.stand = motion.target = motion.stride = 1;
  motion.speed = 1.5;
  const angles = [SHOULDERS[0], PELVIS, 6, 9].map(() => [] as number[]);
  for (let frame = 0; frame < 360; frame++) {
    world.makeTranslation(-frame * 0.025, 0, 0);
    pose.update(motion, 1 / 120, world);
    checkSkeleton(pose);
    assert.ok(pose.posed[SHOULDERS[0]].end.equals(pose.posed[4].start));
    assert.ok(pose.posed[SHOULDERS[1]].end.equals(pose.posed[10].start));
    assert.ok(pose.posed[PELVIS].start.equals(pose.posed[0].end));
    if (frame > 120) [SHOULDERS[0], PELVIS, 6, 9].forEach((bone, i) => {
      const v = pose.posed[bone].end.clone().sub(pose.posed[bone].start);
      angles[i].push(Math.atan2(v.y, v.x));
    });
  }
  angles.forEach((values, i) => assert.ok(Math.max(...values) - Math.min(...values) > [0.4, 0.03, 0.7, 0.4][i]));
});
