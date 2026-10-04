import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("sidebar uploads and sample selection share the animated loader and joystick controls", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?scene=office");
  await page.waitForFunction(() => Boolean(window.snoopy));
  const encoded = (await readFile("standing_dog.ply")).toString("base64");
  await page.evaluate(encoded => {
    window.snoopy.dogs.setUploaded({
      id: "upload", name: "Test dog", age: "—", breed: "—", gender: "—",
      photo: "/dogs/snoopy.png", personality: "Test upload",
      splat: { fileBytes: Uint8Array.from(atob(encoded), character => character.charCodeAt(0)).buffer },
    });
  }, encoded);
  await expect(page.locator("#status")).toContainText("Test dog ·", { timeout: 60_000 });
  expect(await page.evaluate(() => window.snoopy.dog.motion.stand)).toBe(1);
  await page.evaluate(() => window.snoopy.dogs.show(0));
  await expect(page.locator("#status")).toContainText("Snoopy ·", { timeout: 60_000 });
  expect(await page.evaluate(() => window.snoopy.dog.motion.stand)).toBe(0);
  const position = await page.evaluate(() => window.snoopy.camera.position.toArray());
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => page.evaluate(() => window.snoopy.camera.position.toArray())).not.toEqual(position);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("l");
  await expect.poll(() => page.evaluate(() => window.snoopy.dog.anim.pet)).toBeGreaterThan(0.5);
  await page.keyboard.up("l");
  await expect.poll(() => page.evaluate(() => window.snoopy.dog.anim.pet)).toBe(0);
  expect(errors).toEqual([]);
});
