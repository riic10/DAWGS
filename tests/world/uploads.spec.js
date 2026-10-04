import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("local uploads can be calibrated, petted, sat, and replaced without leaving old dogs or balls", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?scene=office");
  await page.waitForFunction(() => Boolean(window.snoopy));
  await page.locator("#dog-panel > summary").click();
  await page.locator("#dog-upload").setInputFiles(path.resolve("standing_dog.ply"));
  await expect(page.locator("#status")).toContainText("241,056");
  expect(await page.evaluate(() => window.snoopy.dog.profile.sample)).toBe(false);
  expect(await page.evaluate(() => window.snoopy.dog.motion.stand)).toBe(1);
  await page.getByRole("button", { name: "Sit down", exact: true }).click();
  await page.waitForFunction(() => window.snoopy.dog.motion.stand === 0);
  await page.screenshot({ path: testInfo.outputPath("upload-sitting.png") });
  const before = await page.evaluate(() => window.snoopy.dog.joints.posed[2].end.toArray());
  await page.keyboard.down("t");
  await page.waitForFunction(() => window.snoopy.dog.anim.pet > 0.98);
  expect(await page.evaluate(before => window.snoopy.dog.joints.posed[2].end.distanceTo({ x: before[0], y: before[1], z: before[2] }), before)).toBeGreaterThan(0.02);
  await page.screenshot({ path: testInfo.outputPath("upload-petting.png") });
  await page.keyboard.up("t");
  await page.waitForFunction(() => window.snoopy.dog.anim.pet === 0);

  await page.getByText("Adjust dog fit", { exact: true }).click();
  const view = await page.evaluate(() => ({ camera: window.snoopy.camera.position.toArray(), target: window.snoopy.controls.target.toArray() }));
  await page.getByRole("button", { name: "Zoom to dog" }).click();
  const focused = await page.evaluate(() => {
    const { camera, controls, arduino } = window.snoopy;
    arduino.feedLine("0,0,80");
    return camera.position.distanceTo(controls.target);
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.snoopy.camera.position.distanceTo(window.snoopy.controls.target))).toBeCloseTo(focused, 6);
  await page.evaluate(view => {
    const { camera, controls, arduino } = window.snoopy;
    arduino.state.distanceAt = -Infinity;
    camera.position.fromArray(view.camera); controls.target.fromArray(view.target); controls.update();
  }, view);
  const lipBefore = await page.evaluate(() => window.snoopy.dog.profile.mouth.upperLip.y);
  const value = Number(await page.getByLabel("Height", { exact: true }).inputValue());
  await page.getByLabel("Height", { exact: true }).fill(String(value + 1));
  await page.getByRole("button", { name: "Apply joint adjustment" }).click();
  await expect(page.locator(".dog-calibration [role=status]")).toContainText("Fit applied");
  expect(await page.evaluate(() => window.snoopy.dog.profile.mouth.upperLip.y)).toBeCloseTo(lipBefore - 0.01, 3);
  await page.screenshot({ path: testInfo.outputPath("upload-calibration.png") });
  await page.getByRole("button", { name: "Reset automatic fit" }).click();
  await expect.poll(() => page.evaluate(() => window.snoopy.dog.profile.mouth.upperLip.y)).toBeCloseTo(lipBefore, 8);
  await page.locator("#dog-panel > summary").click();
  await expect(page.locator(".dog-calibration")).not.toHaveAttribute("open", "");
  await page.locator("#dog-panel > summary").click();
  await page.locator("#dog-model").selectOption("sample");
  await expect(page.locator("#status")).toContainText("357,408");
  expect(await page.evaluate(() => window.snoopy.dog.profile.sample)).toBe(true);

  await page.locator("#dog-upload").setInputFiles(path.resolve("dog_model.ply"));
  await page.waitForFunction(() => window.snoopy.dog.profile.sample === false && window.snoopy.dog.splats.numSplats === 357408);
  expect(await page.evaluate(() => window.snoopy.dog.motion.stand)).toBe(0);
  expect(await page.evaluate(() => window.snoopy.scene.children.filter(object => object.geometry?.type === "SphereGeometry").length)).toBe(1);
  await page.locator("#dog-panel > summary").click();
  await page.keyboard.press("b");
  await expect(page.locator("#game")).toContainText("ready");
  await page.waitForTimeout(180);
  await page.keyboard.press("b");
  await page.waitForFunction(() => window.snoopy.ball.state === "returning");
  await page.waitForFunction(() => window.snoopy.ball.state === "idle" && window.snoopy.dog.motion.stand === 0);
  expect(errors).toEqual([]);
});

test("an unriggable file leaves the current world dog usable and explains the failure", async ({ page }) => {
  await page.goto("/?scene=office&dog=standing");
  await page.waitForFunction(() => Boolean(window.snoopy));
  const bytes = readFileSync(path.resolve("standing_dog.ply"));
  const offset = bytes.indexOf("end_header\n") + 11;
  const header = bytes.subarray(0, offset).toString().replace(/element vertex \d+/, "element vertex 200");
  const stride = [...header.matchAll(/property float /g)].length * 4;
  const vertices = Buffer.from(bytes.subarray(offset, offset + 200 * stride));
  for (let i = 0; i < 200; i++) for (let axis = 0; axis < 3; axis++) vertices.writeFloatLE(0, i * stride + axis * 4);
  await page.locator("#dog-panel > summary").click();
  await page.locator("#dog-upload").setInputFiles({ name: "flat-dog.ply", mimeType: "application/octet-stream", buffer: Buffer.concat([Buffer.from(header), vertices]) });
  await expect(page.locator("#dog-error")).toContainText("too flat");
  expect(await page.evaluate(() => window.snoopy.dog.splats.numSplats)).toBe(241056);
  await page.getByRole("button", { name: "Sit down", exact: true }).click();
  await page.waitForFunction(() => window.snoopy.dog.motion.stand === 0);
});
