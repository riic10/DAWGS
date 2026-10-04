import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { GenerationError, checkGeneration, createJob, downloadJob, waitForJob } from "../web/src/generation.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const unreachable = () => { throw new TypeError("Failed to fetch"); };

// Node has no FileReader; this one is enough for readAsDataURL.
globalThis.FileReader ??= class {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((bytes) => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
      this.onload?.();
    });
  }
} as unknown as typeof FileReader;

// Runs the polling loop with its timers fired immediately.
async function withoutWaiting<T>(promise: Promise<T>) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  while (!settled) {
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(15_000);
  }
  return promise;
}

test("server problems come back as their own messages instead of a generic failure", async (t) => {
  t.after(() => mock.restoreAll());
  const answers: (() => Response | Promise<Response>)[] = [
    unreachable,
    () => new Response("<h1>Internal Server Error</h1>", { status: 500 }),
    () => json({ error: "Generation needs a Hugging Face token. Add HF_TOKEN to .env.local in the repo root, then restart `npm run dev`." }, 503),
    () => new Response("", { status: 404 }),
    () => json({ ready: true }),
  ];
  mock.method(globalThis, "fetch", async () => answers.shift()!());
  for (const expected of [/Can't reach the server/, /Can't reach the server/, /HF_TOKEN/, /can't make dogs from photos/]) {
    await assert.rejects(checkGeneration(), (error: unknown) => error instanceof GenerationError && expected.test(error.message));
  }
  assert.deepEqual(await checkGeneration(), { ready: true });
});

test("a photo job is submitted once, survives a dropped connection while polling, and downloads the splat", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => { mock.timers.reset(); mock.restoreAll(); });
  const requests: { url: string; init?: RequestInit }[] = [];
  const answers: Record<string, (() => Response)[]> = {
    "/api/jobs": [() => json({ token: "job.token" })],
    "/api/jobs/job.token": [unreachable, () => json({ status: "starting" }), () => json({ status: "processing" }), () => json({ status: "succeeded" })],
    "/api/jobs/job.token/file": [() => new Response(new Uint8Array([112, 108, 121]))],
  };
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return answers[url].shift()!();
  });
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const token = await createJob(photo as File);
  assert.equal(token, "job.token");
  const body = JSON.parse(String(requests[0].init!.body));
  assert.equal(requests[0].init!.method, "POST");
  assert.equal(body.image, "data:image/jpeg;base64,/9j/");
  assert.match(body.requestId, /^[a-f0-9-]{36}$/);
  const heard: string[] = [];
  await withoutWaiting(waitForJob(token, (state: string, reason?: string) => heard.push(reason ? `${state}: ${reason}` : state)));
  assert.equal(heard.length, 3);
  assert.match(heard[0], /^reconnecting: Can't reach the server/);
  assert.deepEqual(heard.slice(1), ["starting", "processing"]);
  assert.deepEqual([...await downloadJob(token)], [112, 108, 121]);
});

test("failed and expired jobs stop polling with the server's reason", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => { mock.timers.reset(); mock.restoreAll(); });
  const answers = [
    json({ status: "processing" }),
    json({ status: "failed", error: "Your Hugging Face free GPU quota is exhausted or too small for this request. Wait for it to reset, then try again." }),
    json({ error: "This job expired or the server restarted. Generate a new model to continue." }, 410),
    json({ error: "This result has expired. Generate a new model to continue." }, 410),
  ];
  const fetchMock = mock.method(globalThis, "fetch", async () => answers.shift()!);
  await assert.rejects(withoutWaiting(waitForJob("job", () => {})), /GPU quota is exhausted/);
  await assert.rejects(withoutWaiting(waitForJob("job", () => {})), (error: unknown) => error instanceof GenerationError && error.status === 410 && !error.retry);
  await assert.rejects(downloadJob("job"), /result has expired/);
  assert.equal(fetchMock.mock.callCount(), 4);
});
