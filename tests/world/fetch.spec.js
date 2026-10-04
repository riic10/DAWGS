import { expect, test } from "@playwright/test";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const state = await page.evaluate(() => {
    if (!window.snoopy) return null;
    const { dog, ball, scene } = window.snoopy;
    const sphere = scene.children.find(object => object.geometry?.type === "SphereGeometry");
    return {
      state: ball.state, pickup: dog.pickup, attached: ball.attached,
      root: dog.root.position.toArray(), normal: dog.groundNormal.toArray(),
      target: sphere.position.clone().applyMatrix4(dog.splats.matrixWorld.clone().invert()).toArray(),
      mouth: dog.joints.mouth.toArray(), chest: dog.joints.posed[1].start.toArray(),
    };
  });
  await testInfo.attach("fetch-state", { body: JSON.stringify(state), contentType: "application/json" });
});

for (const scene of ["office", "woods"]) {
  test(`${scene}: the dog stands, animates the fetch, and sits after returning`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.fetchFrames = [];
      const requestFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => requestFrame(time => {
        callback(time);
        const state = window.snoopy;
        if (!state || window.fetchFrames.length >= 6000) return;
        const { dog, ball } = state;
        const { joints } = dog;
        const carried = state.scene.children.find(object => object.geometry?.type === "SphereGeometry");
        const mouth = dog.mouthWorld();
        window.fetchFrames.push({
          state: ball.state, stand: dog.motion.stand, phase: dog.motion.phase,
          speed: dog.motion.speed, x: dog.root.position.x, z: dog.root.position.z,
          boneError: Math.max(...joints.posed.map((bone, i) => Math.abs(bone.start.distanceTo(bone.end) - joints.rest[i].start.distanceTo(joints.rest[i].end)))),
          footError: Math.max(0, ...joints.feet.filter(foot => foot.planted).map(foot =>
            joints.posed[foot.base + 2].end.clone().applyMatrix4(dog.splats.matrixWorld).distanceTo(foot.anchor))),
          contacts: joints.feet.filter(foot => foot.planted).map(foot => foot.base),
          mouthHeight: mouth.y - dog.root.position.y,
          carryError: carried?.position.distanceTo(mouth),
          attached: ball.attached,
          ballPosition: carried?.position.toArray(),
          ballRadius: state.setup.ballRadius,
          pitch: joints.gaze.pitch,
          trot: joints.gait.trot,
        });
      });
    });
    await page.goto(`/?scene=${scene}`);
    await page.waitForFunction(() => Boolean(window.snoopy), undefined, { timeout: 60_000 });
    await expect(page.locator("#status")).toContainText(`${scene} · dog`);
    const start = await page.evaluate(() => {
      const { dog } = window.snoopy;
      return { x: dog.root.position.x, z: dog.root.position.z, bones: Array.from(dog.splats.skinning.boneData) };
    });
    await page.screenshot({ path: testInfo.outputPath(`${scene}-sitting.png`) });
    await page.keyboard.press("b");
    await expect(page.locator("#game")).toContainText("ready");
    await page.waitForTimeout(180);
    await page.keyboard.press("b");
    await expect(page.locator("#game")).toHaveText("dog: standing up");
    await page.waitForFunction(() => window.snoopy.dog.motion.stand >= 0.25);
    const standing = await page.evaluate(() => Array.from(window.snoopy.dog.splats.skinning.boneData));
    expect(standing.some((value, index) => Math.abs(value - start.bones[index]) > 0.01)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${scene}-standing.png`) });
    await page.waitForFunction(() => window.snoopy.dog.motion.speed > 0.1);
    const running = await page.evaluate(() => ({
      phase: window.snoopy.dog.motion.phase,
      bones: Array.from(window.snoopy.dog.splats.skinning.boneData),
    }));
    await expect.poll(() => page.evaluate(() => window.snoopy.dog.motion.phase)).toBeGreaterThan(running.phase + 0.1);
    const next = await page.evaluate(() => Array.from(window.snoopy.dog.splats.skinning.boneData));
    expect(next.some((value, index) => Math.abs(value - running.bones[index]) > 0.001)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${scene}-running.png`) });
    await expect(page.locator("#game")).toHaveText("dog: picking up ball");
    await page.waitForFunction(() => window.snoopy.dog.pickup > 0.8);
    await page.screenshot({ path: testInfo.outputPath(`${scene}-pickup.png`) });
    await expect(page.locator("#game")).toHaveText("ball: press button to get it ready");
    await page.waitForFunction(() => window.snoopy.dog.motion.stand === 0);
    const frames = await page.evaluate(() => window.fetchFrames);
    const standingFrames = frames.filter(frame => frame.state === "standing" && frame.stand > 0 && frame.stand < 1);
    expect(standingFrames.length).toBeGreaterThan(2);
    for (const frame of standingFrames) {
      expect(Math.hypot(frame.x - start.x, frame.z - start.z)).toBeLessThan(1e-8);
    }
    const movingFrames = frames.filter(frame => frame.speed > 0.01);
    expect(movingFrames.length).toBeGreaterThan(2);
    expect(movingFrames.every(frame => frame.stand === 1)).toBe(true);
    expect(frames.some(frame => frame.state === "returning")).toBe(true);
    expect(frames.some(frame => frame.state === "dropping")).toBe(true);
    expect(Math.max(...frames.map(frame => frame.boneError))).toBeLessThan(1e-8);
    expect(frames.some(frame => frame.state === "collecting" && frame.pitch > 1)).toBe(true);
    const pickupHeight = Math.min(...frames.filter(frame => frame.state === "collecting").map(frame => frame.mouthHeight));
    const runningHeight = Math.max(...movingFrames.map(frame => frame.mouthHeight));
    expect(pickupHeight).toBeLessThan(runningHeight * 0.7);
    expect(frames.filter(frame => frame.state === "returning").every(frame => frame.carryError < 1e-8)).toBe(true);
    const collection = frames.filter(frame => frame.state === "collecting");
    const grounded = collection[0].ballPosition;
    const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    expect(collection.filter(frame => !frame.attached).every(frame => distance(frame.ballPosition, grounded) < 1e-8)).toBe(true);
    const firstGrip = collection.find(frame => frame.attached);
    expect(firstGrip).toBeTruthy();
    expect(distance(firstGrip.ballPosition, grounded)).toBeLessThan(firstGrip.ballRadius * 0.08);
    const releaseIndex = frames.findIndex((frame, i) => i > 0 && frame.state === "dropping" && !frame.attached && frames[i - 1].attached);
    expect(releaseIndex).toBeGreaterThan(0);
    expect(distance(frames[releaseIndex].ballPosition, frames[releaseIndex - 1].ballPosition)).toBeLessThan(1e-8);
    const standingFramesWithContacts = frames.filter(frame => frame.stand === 1);
    expect(Math.max(...standingFramesWithContacts.map(frame => frame.footError))).toBeLessThan(1e-7);
    expect(new Set(movingFrames.flatMap(frame => frame.contacts)).size).toBe(4);
    expect(movingFrames.reduce((sum, frame) => sum + frame.contacts.length, 0) / movingFrames.length).toBeGreaterThan(1);
    const end = await page.evaluate(() => ({ x: window.snoopy.dog.root.position.x, z: window.snoopy.dog.root.position.z }));
    expect(end).toEqual({ x: start.x, z: start.z });
    await page.screenshot({ path: testInfo.outputPath(`${scene}-returned.png`) });
    expect(errors).toEqual([]);
  });
}

test("Arduino petting moves the head and tail with grounded paws, and camera distance still works", async ({ page }) => {
  await page.goto("/?scene=office");
  await page.waitForFunction(() => Boolean(window.snoopy));
  const before = await page.evaluate(() => ({
    distance: window.snoopy.camera.position.distanceTo(window.snoopy.controls.target),
    position: window.snoopy.dog.root.position.toArray(),
    body: window.snoopy.dog.body.matrix.toArray(),
    head: window.snoopy.dog.joints.posed[2].end.toArray(),
  }));
  await page.keyboard.type("wasdc");
  expect(await page.evaluate(() => window.snoopy.dog.root.position.toArray())).toEqual(before.position);
  expect(await page.evaluate(() => window.snoopy.dog.motion.target)).toBe(0);
  await page.evaluate(() => window.snoopy.arduino.feedLine("1,0,20"));
  await page.waitForFunction(() => window.snoopy.dog.anim.pet > 0.98);
  const touched = await page.evaluate(() => {
    const { dog } = window.snoopy;
    return {
      position: dog.root.position.toArray(), body: dog.body.matrix.toArray(),
      head: dog.joints.posed[2].end.toArray(), tail: dog.joints.posed[3].end.toArray(),
      feet: dog.joints.feet.map(foot => ({
        planted: foot.planted,
        error: dog.joints.posed[foot.base + 2].end.clone().applyMatrix4(dog.splats.matrixWorld).distanceTo(foot.anchor),
      })),
    };
  });
  expect(touched.position).toEqual(before.position);
  expect(touched.body).toEqual(before.body);
  expect(Math.hypot(...touched.head.map((v, i) => v - before.head[i]))).toBeGreaterThan(0.02);
  expect(touched.feet.every(foot => foot.planted && foot.error < 1e-7)).toBe(true);
  await expect.poll(() => page.evaluate(tail => {
    const current = window.snoopy.dog.joints.posed[3].end.toArray();
    return Math.hypot(...current.map((v, i) => v - tail[i]));
  }, touched.tail)).toBeGreaterThan(0.02);
  await expect.poll(() => page.evaluate(head => {
    const current = window.snoopy.dog.joints.posed[2].end.toArray();
    return Math.hypot(...current.map((v, i) => v - head[i]));
  }, touched.head)).toBeGreaterThan(0.006);
  await expect.poll(() => page.evaluate(() => window.snoopy.camera.position.distanceTo(window.snoopy.controls.target))).toBeLessThan(before.distance - 1);
  await page.evaluate(() => window.snoopy.arduino.feedLine("0,0,0"));
  await page.waitForFunction(() => window.snoopy.dog.anim.pet === 0);
  await expect.poll(() => page.evaluate(head => {
    const current = window.snoopy.dog.joints.posed[2].end.toArray();
    return Math.hypot(...current.map((v, i) => v - head[i]));
  }, before.head)).toBeLessThan(0.001);
});
