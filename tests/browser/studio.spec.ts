import { expect, test } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCr8AAAAASUVORK5CYII=",
  "base64",
);

test("renders the real sample, allows orbit/reset and downloads its PLY", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("357,408 Gaussian splats")).toBeVisible();
  await expect(page.getByRole("button", { name: "Make it 3D" })).toBeDisabled();
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 100,
    box.y + box.height / 2 + 30,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "Reset camera" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download .ply" }).click();
  expect((await download).suggestedFilename()).toBe("snoopygs-sample.ply");
  await page.screenshot({
    path: "/private/tmp/snoopygs-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("shows provider failure without replacing the sample or losing the upload", async ({
  page,
}) => {
  await page.route("**/api/jobs", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Generation needs a Hugging Face token." },
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("Upload an image")
    .setInputFiles({ name: "object.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Make it 3D" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Hugging Face token" }),
  ).toBeVisible();
  await expect(page.getByAltText("Your uploaded image")).toBeVisible();
  await expect(page.getByText("SAMPLE MODEL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make it 3D" })).toBeEnabled();
});

test("resumes an existing job after refresh and renders the successful result", async ({
  page,
}) => {
  let creates = 0;
  let status = "processing";
  await page.route("**/api/jobs", (route) => {
    creates++;
    return route.fulfill({ json: { token: "test-job" } });
  });
  await page.route("**/api/jobs/test-job", (route) =>
    route.fulfill({ json: { status } }),
  );
  await page.route("**/api/jobs/test-job/file", async (route) => {
    const sample = await page.request.get("/api/sample");
    await route.fulfill({
      contentType: "application/octet-stream",
      body: await sample.body(),
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Upload an image")
    .setInputFiles({ name: "object.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Make it 3D" }).click();
  await expect(page.getByText("Generating your model")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Creating your model" }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByText("Generating your model")).toBeVisible();
  expect(creates).toBe(1);
  status = "succeeded";
  await expect(page.getByText("YOUR CREATION", { exact: true })).toBeVisible();
  await expect(page.getByText("357,408 Gaussian splats")).toBeVisible();
  await expect(page.getByText(/Results are temporary/)).toBeVisible();
  expect(creates).toBe(1);
});

test("handles an expired saved result and fits a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem("snoopygs-hf-job", "expired-job"),
  );
  await page.route("**/api/jobs/expired-job", (route) =>
    route.fulfill({
      status: 410,
      json: {
        error: "This result has expired. Generate a new model to continue.",
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("alert").filter({ hasText: "expired" }),
  ).toBeVisible();
  await expect(page.getByText("357,408 Gaussian splats")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/snoopygs-mobile.png",
    fullPage: true,
  });
});
