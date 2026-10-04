import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import viteConfig, { serveApi } from "../web/vite.config.js";

test("the viewer's own server answers /api, in dev and in preview", async (t) => {
  const plugin = viteConfig.plugins!.find((p) => (p as { name?: string }).name === "snoopygs-photo-api") as { configureServer?: unknown; configurePreviewServer?: unknown };
  assert.ok(plugin.configureServer && plugin.configurePreviewServer);
  const savedToken = process.env.HF_TOKEN;
  const server = createServer((req, res) => serveApi(req, res, () => { res.writeHead(418); res.end("the page"); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
    if (savedToken === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = savedToken;
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  delete process.env.HF_TOKEN;
  let response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /HF_TOKEN to \.env\.local/);
  process.env.HF_TOKEN = "hf_test_only";
  assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { ready: true });

  // Uploads have to come from the page's own origin, and their body reaches the API.
  const upload = (origin: string) => fetch(`${base}/api/jobs`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "not-a-uuid" }) });
  assert.equal((await upload("https://another-site.test")).status, 403);
  response = await upload(base);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Invalid upload request.");

  assert.equal((await fetch(`${base}/api/jobs/tampered`)).status, 403);
  assert.equal((await fetch(`${base}/api/jobs/tampered/file`)).status, 403);
  assert.equal((await fetch(`${base}/api/nothing-here`)).status, 404);
  response = await fetch(`${base}/index.html`);
  assert.equal(response.status, 418);
  assert.equal(await response.text(), "the page");
});
