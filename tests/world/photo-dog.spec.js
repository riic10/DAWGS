import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The photo API is mocked: a real generation needs HF_TOKEN and GPU quota.
const standingDog = readFileSync(path.resolve("standing_dog.ply"));
const SAMPLE_SPLATS = 357408, STANDING_SPLATS = 241056;
const photo = {
  name: "dog.png", mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCr8AAAAASUVORK5CYII=", "base64"),
};

async function mockApi(page, status) {
  const calls = { create: 0, poll: 0 };
  await page.route("**/api/status", route => route.fulfill({ json: { ready: true } }));
  await page.route("**/api/jobs", route => {
    calls.create++;
    return route.fulfill({ json: { token: "test-job" } });
  });
  await page.route("**/api/jobs/test-job", route => route.fulfill({ json: { status: status(++calls.poll) } }));
  await page.route("**/api/jobs/test-job/file", route => route.fulfill({ contentType: "application/octet-stream", body: standingDog }));
  return calls;
}

async function openScene(page) {
  await page.goto("/?scene=office");
  await page.waitForFunction(() => Boolean(window.snoopy));
  await expect(page.locator("#status")).toContainText(SAMPLE_SPLATS.toLocaleString("en-US"));
  await page.locator("#dog-panel > summary").click();
}

const splatCount = page => page.evaluate(() => window.snoopy.dog.splats.numSplats);

test("a photo becomes a fitted dog that stays in the Model list", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const calls = await mockApi(page, poll => (poll < 3 ? "processing" : "succeeded"));
  await openScene(page);
  await page.getByLabel("Dog photo").setInputFiles(photo);
  await expect(page.getByAltText("Selected dog photo")).toBeVisible();
  await page.getByRole("button", { name: "Create dog from photo" }).click();
  await expect(page.locator("#dog-create-status")).toHaveText("Your dog 1 is ready. Press B to play fetch.");
  expect(await splatCount(page)).toBe(STANDING_SPLATS);
  expect(await page.evaluate(() => window.snoopy.dog.profile.sample)).toBe(false);
  expect(calls.create).toBe(1);
  await expect(page.locator("#dog-model option:checked")).toHaveText("Your dog 1");
  await expect(page.getByRole("link", { name: "Download snoopygs-dog-1.ply" })).toBeVisible();
  await expect(page.getByText("Adjust dog fit", { exact: true })).toBeVisible();

  await page.locator("#dog-model").selectOption("sample");
  await expect(page.locator("#status")).toContainText(SAMPLE_SPLATS.toLocaleString("en-US"));
  await page.locator("#dog-model").selectOption({ label: "Your dog 1" });
  await expect(page.locator("#status")).toContainText(STANDING_SPLATS.toLocaleString("en-US"));
  expect(await page.evaluate(() => window.snoopy.scene.children.filter(object => object.geometry?.type === "SphereGeometry").length)).toBe(1);
  expect(errors).toEqual([]);
});

test("server problems are explained and the current dog stays", async ({ page }) => {
  const missingToken = "Generation needs a Hugging Face token. Add HF_TOKEN to .env.local in the repo root, then restart `npm run dev`.";
  await page.route("**/api/status", route => route.fulfill({ status: 503, json: { error: missingToken } }));
  await page.route("**/api/jobs", route => route.abort("connectionrefused"));
  await openScene(page);
  await page.getByLabel("Dog photo").setInputFiles(photo);
  await expect(page.locator("#dog-error")).toHaveText(missingToken);
  await page.getByRole("button", { name: "Create dog from photo" }).click();
  await expect(page.locator("#dog-create-status")).toHaveText("Dog creation stopped. Your current dog is still available.");
  await expect(page.locator("#dog-error")).toHaveText("Can't reach the server. Check that `npm run dev` is still running, then try again.");
  await expect(page.getByRole("button", { name: "Create dog from photo" })).toBeEnabled();
  expect(await splatCount(page)).toBe(SAMPLE_SPLATS);
});

test("a refresh picks up a running generation without starting another", async ({ page }) => {
  let done = false;
  const calls = await mockApi(page, () => (done ? "succeeded" : "processing"));
  await openScene(page);
  await page.getByLabel("Dog photo").setInputFiles(photo);
  await page.getByRole("button", { name: "Create dog from photo" }).click();
  await expect(page.locator("#dog-create-status")).toHaveText("Creating your 3D dog. This can take a few minutes…");
  done = true;
  await page.reload();
  await expect(page.locator("#dog-create-status")).toHaveText("Your dog 1 is ready. Press B to play fetch.");
  expect(calls.create).toBe(1);
  expect(await splatCount(page)).toBe(STANDING_SPLATS);
});

test("photos other than PNG or JPEG are refused before anything is sent", async ({ page }) => {
  const calls = await mockApi(page, () => "processing");
  await openScene(page);
  await page.getByLabel("Dog photo").setInputFiles({ name: "dog.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(page.locator("#dog-error")).toHaveText("Choose a PNG or JPEG image.");
  await expect(page.getByRole("button", { name: "Create dog from photo" })).toBeDisabled();
  expect(calls.create).toBe(0);
});
