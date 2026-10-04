import { expect, test } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";

test("a D button click survives a delayed animation frame", async ({ page }) => {
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => requestFrame(time => {
      if (document.documentElement.hasAttribute("data-pause-animation")) {
        window.addEventListener("resume-animation", () => callback(performance.now()), { once: true });
      } else callback(time);
    });
  });
  await page.goto("/");
  const host = page.locator(".canvas-host");
  const status = page.locator(".dog-controls [role=status]");
  await page.getByRole("button", { name: "Stand up", exact: true }).click();
  await expect(status).toHaveText("Standing");
  const dogPixels = async () => {
    const image = sharp(await host.screenshot());
    const { width = 0, height = 0 } = await image.metadata();
    return image.extract({ left: Math.floor(width * 0.3), top: Math.floor(height * 0.25), width: Math.floor(width * 0.4), height: Math.floor(height * 0.5) }).removeAlpha().raw().toBuffer();
  };
  await page.waitForTimeout(200);
  const before = await dogPixels();
  const right = page.getByRole("button", { name: "Turn right (D)", exact: true });
  await right.hover();
  await page.evaluate(() => document.documentElement.setAttribute("data-pause-animation", ""));
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(host).toHaveAttribute("data-dog-yaw", "0.0000");
  await page.evaluate(() => {
    document.documentElement.removeAttribute("data-pause-animation");
    window.dispatchEvent(new Event("resume-animation"));
  });
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeLessThan(-0.15);
  await expect(status).toHaveText("Standing");
  await page.waitForTimeout(700);
  const after = await dogPixels();
  let changed = 0;
  for (let i = 0; i < before.length; i += 3) {
    if (Math.max(Math.abs(before[i] - after[i]), Math.abs(before[i + 1] - after[i + 1]), Math.abs(before[i + 2] - after[i + 2])) > 20) changed++;
  }
  expect(changed / (before.length / 3)).toBeGreaterThan(0.02);
});

test("standing WASD responds to brief key presses after using camera controls", async ({ page }) => {
  await page.goto("/");
  const host = page.locator(".canvas-host");
  const status = page.locator(".dog-controls [role=status]");
  await page.getByRole("button", { name: "Stand up", exact: true }).click();
  await expect(status).toHaveText("Standing");
  for (const key of ["w", "s", "a", "d"]) {
    await page.getByRole("button", { name: "Reset camera" }).click();
    const before = (await host.getAttribute("data-dog-position"))!.split(",").map(Number);
    const yaw = Number(await host.getAttribute("data-dog-yaw"));
    await page.keyboard.press(key);
    if (key === "w" || key === "s") {
      await expect.poll(async () => {
        const x = Number((await host.getAttribute("data-dog-position"))!.split(",")[0]);
        return (x - before[0]) * (key === "w" ? -1 : 1);
      }).toBeGreaterThan(0.005);
    } else {
      await expect.poll(async () => (Number(await host.getAttribute("data-dog-yaw")) - yaw) * (key === "a" ? 1 : -1)).toBeGreaterThan(0.15);
      await expect(host).toHaveAttribute("data-dog-position", before.map(n => n.toFixed(4)).join(","));
    }
    await expect(status).toHaveText("Standing");
  }
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Typing test");
    document.body.appendChild(input);
  });
  const stopped = await host.getAttribute("data-dog-position");
  const yaw = await host.getAttribute("data-dog-yaw");
  await page.getByRole("textbox", { name: "Typing test" }).pressSequentially("wasdc");
  await page.waitForTimeout(250);
  await expect(page.getByRole("textbox", { name: "Typing test" })).toHaveValue("wasdc");
  await expect(host).toHaveAttribute("data-dog-position", stopped!);
  await expect(host).toHaveAttribute("data-dog-yaw", yaw!);
  await expect(status).toHaveText("Standing");
});

test("all WASD keys and buttons stay locked while sitting", async ({ page }) => {
  await page.goto("/");
  const host = page.locator(".canvas-host");
  const status = page.locator(".dog-controls [role=status]");
  await expect(status).toHaveText("Sitting");
  for (const [key, label] of [["w", "Forward"], ["s", "Back up"], ["a", "Turn left"], ["d", "Turn right"]]) {
    await page.keyboard.press(key);
    await page.getByRole("button", { name: `${label} (${key.toUpperCase()})`, exact: true }).click();
  }
  await page.waitForTimeout(250);
  await expect(host).toHaveAttribute("data-dog-position", "0.0000,0.0000");
  await expect(host).toHaveAttribute("data-dog-yaw", "0.0000");
  await expect(status).toHaveText("Sitting");
  await page.getByRole("button", { name: "Stand up", exact: true }).click();
  await page.keyboard.press("d");
  await expect(status).toHaveText("Standing");
  await expect(host).toHaveAttribute("data-dog-yaw", "0.0000");
});

test("D responds to a click event without a preceding pointer event", async ({ page }) => {
  await page.goto("/");
  const host = page.locator(".canvas-host");
  const status = page.locator(".dog-controls [role=status]");
  await page.getByRole("button", { name: "Stand up", exact: true }).click();
  await expect(status).toHaveText("Standing");
  await page.getByRole("button", { name: "Turn right (D)", exact: true }).dispatchEvent("click", { detail: 1 });
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw")), { timeout: 3000 }).toBeLessThan(-0.15);
  await expect(status).toHaveText("Standing");
});

test("on-screen movement buttons respond to clicks and holds", async ({ page }) => {
  await page.goto("/");
  const host = page.locator(".canvas-host");
  const status = page.locator(".dog-controls [role=status]");
  await page.getByRole("button", { name: "Stand up", exact: true }).click();
  await expect(status).toHaveText("Standing");
  const right = page.getByRole("button", { name: "Turn right (D)", exact: true });
  await right.click();
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeLessThan(-0.15);
  await expect(status).toHaveText("Standing");
  const rightYaw = Number(await host.getAttribute("data-dog-yaw"));
  await page.getByRole("button", { name: "Turn left (A)", exact: true }).click();
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeGreaterThan(rightYaw + 0.15);
  await expect(status).toHaveText("Standing");
  const origin = await host.getAttribute("data-dog-position");
  await page.getByRole("button", { name: "Forward (W)", exact: true }).click();
  await expect(host).not.toHaveAttribute("data-dog-position", origin!);
  await expect(status).toHaveText("Standing");
  const forward = await host.getAttribute("data-dog-position");
  await page.getByRole("button", { name: "Back up (S)", exact: true }).click();
  await expect(host).not.toHaveAttribute("data-dog-position", forward!);
  await expect(status).toHaveText("Standing");
  const beforeHold = Number(await host.getAttribute("data-dog-yaw"));
  await right.hover();
  await page.mouse.down();
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeLessThan(beforeHold - 0.8);
  await page.mouse.move(10, 10);
  await page.mouse.up();
  await expect(status).toHaveText("Standing");
  const stopped = await host.getAttribute("data-dog-yaw");
  await page.waitForTimeout(250);
  await expect(host).toHaveAttribute("data-dog-yaw", stopped!);
  await right.hover();
  await page.mouse.down();
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeLessThan(Number(stopped) - 0.8);
  const beforeRelease = Number(await host.getAttribute("data-dog-yaw"));
  await page.mouse.up();
  await expect(status).toHaveText("Standing");
  const afterRelease = Number(await host.getAttribute("data-dog-yaw"));
  expect(Math.abs(afterRelease - beforeRelease)).toBeLessThan(0.15);
  await right.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeLessThan(afterRelease - 0.15);
  await expect(status).toHaveText("Standing");
  await page.getByRole("button", { name: "Sit / stand (C)", exact: true }).click();
  await expect(status).toHaveText("Sitting");
  const seatedYaw = await host.getAttribute("data-dog-yaw");
  await right.click();
  await page.waitForTimeout(250);
  await expect(host).toHaveAttribute("data-dog-yaw", seatedYaw!);
});

test("sample dog steers, backs up, stops on blur, and locks controls while sitting", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.goto("/");
  const canvas = page.getByRole("application", { name: /Sample dog controls/ });
  const host = page.locator(".canvas-host");
  const status = page.locator(".dog-controls [role=status]");
  await expect(status).toHaveText("Sitting");
  await canvas.focus();
  const origin = await host.getAttribute("data-dog-position");
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  await expect(host).toHaveAttribute("data-dog-position", origin!);
  await page.keyboard.press("c");
  await expect(status).toHaveText("Standing");
  await expect(host).toHaveAttribute("data-dog-stand", "1.000");
  const initialYaw = Number(await host.getAttribute("data-dog-yaw"));
  await page.keyboard.down("a");
  await expect(status).toHaveText("Turning");
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeGreaterThan(initialYaw + 0.3);
  await page.keyboard.up("a");
  await expect(host).toHaveAttribute("data-dog-position", origin!);
  const leftYaw = Number(await host.getAttribute("data-dog-yaw"));
  await page.keyboard.down("d");
  await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeLessThan(leftYaw - 0.3);
  await page.keyboard.up("d");
  await expect(host).toHaveAttribute("data-dog-position", origin!);
  await expect(status).toHaveText("Standing");
  const heading = Number(await host.getAttribute("data-dog-yaw"));
  const beforeReverse = (await host.getAttribute("data-dog-position"))!.split(",").map(Number);
  await page.keyboard.down("s");
  await expect.poll(async () => {
    const position = (await host.getAttribute("data-dog-position"))!.split(",").map(Number);
    return (position[0] - beforeReverse[0]) * -Math.cos(heading) + (position[1] - beforeReverse[1]) * Math.sin(heading);
  }).toBeLessThan(-0.06);
  await page.keyboard.up("s");
  await expect(host).toHaveAttribute("data-dog-yaw", heading.toFixed(4));
  await page.keyboard.down("w");
  await expect(status).toHaveText("Walking");
  await expect(host).not.toHaveAttribute("data-dog-position", origin!);
  await page.getByRole("button", { name: "Reset camera" }).focus();
  await expect(status).toHaveText("Standing");
  const stopped = await host.getAttribute("data-dog-position");
  await page.waitForTimeout(200);
  await expect(host).toHaveAttribute("data-dog-position", stopped!);
  await page.keyboard.up("w");
  await canvas.focus();
  await page.keyboard.press("c");
  const sittingYaw = await host.getAttribute("data-dog-yaw");
  await page.keyboard.down("d");
  await expect(status).toHaveText("Sitting");
  await expect(host).toHaveAttribute("data-dog-stand", "0.000");
  await expect(host).toHaveAttribute("data-dog-position", stopped!);
  await page.keyboard.up("d");
  await expect(host).toHaveAttribute("data-dog-yaw", sittingYaw!);
  expect(errors).toEqual([]);
});

for (const [model, initialPose, count] of [["standing_dog", "Standing", "241,056"], ["dog_model", "Sitting", "357,408"]] as const) {
  test(`uploaded ${model} animates, D turns right, and C returns to its native pose`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.route("**/api/jobs", route => route.fulfill({ json: { token: "rigged-dog" } }));
    await page.route("**/api/jobs/rigged-dog", route => route.fulfill({ json: { status: "succeeded" } }));
    await page.route("**/api/jobs/rigged-dog/file", route => route.fulfill({ contentType: "application/octet-stream", path: path.resolve(`${model}.ply`) }));
    await page.goto("/");
    await expect(page.locator(".dog-controls [role=status]")).toHaveText("Sitting");
    await page.getByLabel("Upload an image").setInputFiles({
      name: "dog.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCr8AAAAASUVORK5CYII=", "base64"),
    });
    await page.getByRole("button", { name: "Make it 3D" }).click();
    await expect(page.getByText("YOUR CREATION", { exact: true })).toBeVisible();
    await expect(page.getByText(`${count} Gaussian splats`)).toBeVisible();
    const canvas = page.getByRole("application", { name: /^Dog controls/ });
    const host = page.locator(".canvas-host");
    const status = page.locator(".dog-controls [role=status]");
    await expect(status).toHaveText(initialPose);
    await page.locator(".viewer-stage").screenshot({ path: `/private/tmp/${model}-auto-native.png` });
    await canvas.focus();
    if (initialPose === "Sitting") await page.keyboard.press("c");
    await expect(status).toHaveText("Standing");
    await page.locator(".viewer-stage").screenshot({ path: `/private/tmp/${model}-auto-first-standing.png` });
    const origin = await host.getAttribute("data-dog-position");
    await page.keyboard.down("d");
    await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeLessThan(-0.8);
    await page.keyboard.up("d");
    await expect(host).toHaveAttribute("data-dog-position", origin!);
    const afterD = Number(await host.getAttribute("data-dog-yaw"));
    await page.keyboard.down("a");
    await expect.poll(async () => Number(await host.getAttribute("data-dog-yaw"))).toBeGreaterThan(afterD + 0.15);
    await page.keyboard.up("a");
    await expect(status).toHaveText("Standing");
    await expect(host).toHaveAttribute("data-dog-position", origin!);
    await page.keyboard.down("w");
    await expect(status).toHaveText("Walking");
    await expect(host).not.toHaveAttribute("data-dog-position", origin!);
    for (let frame = 0; frame < 4; frame++) {
      await page.waitForTimeout(110);
      await page.locator(".viewer-stage").screenshot({ path: `/private/tmp/${model}-auto-walk-${frame}.png` });
    }
    await page.keyboard.up("w");
    await expect(status).toHaveText("Standing");
    await page.keyboard.down("s");
    await expect(status).toHaveText("Walking");
    await page.getByRole("button", { name: "Reset camera" }).focus();
    await expect(status).toHaveText("Standing");
    await page.keyboard.up("s");
    await canvas.focus();
    await page.keyboard.press("c");
    await expect(status).toHaveText("Sitting");
    const seated = await host.getAttribute("data-dog-position");
    await page.keyboard.down("d");
    await page.waitForTimeout(200);
    await page.keyboard.up("d");
    await expect(host).toHaveAttribute("data-dog-position", seated!);
    await page.locator(".viewer-stage").screenshot({ path: `/private/tmp/${model}-auto-sitting.png` });
    await page.keyboard.press("c");
    await expect(status).toHaveText("Standing");
    await page.locator(".viewer-stage").screenshot({ path: `/private/tmp/${model}-auto-standing.png` });
    await page.reload();
    await expect(page.getByText("YOUR CREATION", { exact: true })).toBeVisible();
    await expect(status).toHaveText(initialPose);
    await page.getByRole("button", { name: "Show sample dog" }).click();
    await expect(page.getByRole("application", { name: /Sample dog controls/ })).toBeVisible();
    await expect(status).toHaveText("Sitting");
    expect(errors).toEqual([]);
  });
}

test("an unriggable upload remains viewable and downloadable", async ({ page }) => {
  const source = readFileSync(path.resolve("standing_dog.ply"));
  const offset = source.indexOf("end_header\n") + 11;
  const header = source.subarray(0, offset).toString().replace(/element vertex \d+/, "element vertex 200");
  const fields = [...header.matchAll(/property float (\w+)/g)].map(match => match[1]);
  const stride = fields.length * 4;
  const vertices = Buffer.from(source.subarray(offset, offset + 200 * stride));
  for (let i = 0; i < 200; i++) {
    vertices.writeFloatLE((i % 20) / 20, i * stride);
    vertices.writeFloatLE(0, i * stride + 4);
    vertices.writeFloatLE(Math.floor(i / 20) / 10, i * stride + 8);
    vertices.writeFloatLE(10, i * stride + fields.indexOf("opacity") * 4);
  }
  await page.addInitScript(() => localStorage.setItem("snoopygs-hf-job", "flat-model"));
  await page.route("**/api/jobs/flat-model", route => route.fulfill({ json: { status: "succeeded" } }));
  await page.route("**/api/jobs/flat-model/file", route => route.fulfill({ contentType: "application/octet-stream", body: Buffer.concat([Buffer.from(header), vertices]) }));
  await page.goto("/");
  await expect(page.getByText("200 Gaussian splats")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("too flat");
  await expect(page.getByRole("img", { name: /Interactive Gaussian model/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download .ply" })).toHaveAttribute("aria-disabled", "false");
  await expect(page.getByRole("button", { name: "Reload viewer" })).toHaveCount(0);
});
