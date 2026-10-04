import { expect, test } from "@playwright/test";

test("six-column controller maps X1 to petting, Y1 to ball, and X2/Y2 to camera", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?scene=office");
  await page.waitForFunction(() => Boolean(window.snoopy));
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) window.snoopy.arduino.feedLine("512,512,0,512,512,0");
  });
  const cameraBefore = await page.evaluate(() => window.snoopy.camera.position.toArray());
  await page.evaluate(() => window.snoopy.arduino.feedLine("512,512,0,1023,0,0"));
  await expect.poll(() => page.evaluate(() => window.snoopy.camera.position.toArray())).not.toEqual(cameraBefore);
  expect(await page.evaluate(() => window.snoopy.ball.state)).toBe("idle");
  expect(await page.evaluate(() => window.snoopy.dog.anim.pet)).toBe(0);

  await page.evaluate(() => window.snoopy.arduino.feedLine("1023,512,0,512,512,0"));
  await expect.poll(() => page.evaluate(() => window.snoopy.dog.anim.pet)).toBeGreaterThan(0.5);
  expect(await page.evaluate(() => window.snoopy.ball.state)).toBe("idle");
  await page.evaluate(() => window.snoopy.arduino.feedLine("512,512,0,512,512,0"));
  await expect.poll(() => page.evaluate(() => window.snoopy.dog.anim.pet)).toBe(0);

  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.snoopy.arduino.feedLine("512,1023,0,512,512,0");
  });
  await expect(page.locator("#game")).toContainText("ready");
  expect(await page.evaluate(() => window.snoopy.arduino.state.pet.y)).toBe(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => {
    window.snoopy.arduino.feedLine("512,512,0,512,512,0");
    window.snoopy.arduino.feedLine("512,0,0,512,512,0");
  });
  await expect(page.locator("#game")).toHaveText("ball: thrown");
  expect(errors).toEqual([]);
});
