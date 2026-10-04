import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { mock, test } from "node:test";
import { Client } from "@gradio/client";
import sharp from "sharp";
import { createJob, jobFile, jobStatus, status } from "../lib/api";
import { verifyJob, SPACE_URL, signJob } from "../lib/jobs";
import { getJob, generationError, startGeneration } from "../lib/huggingface";

const ply = Buffer.from(
  "ply\nformat binary_little_endian 1.0\nproperty float f_dc_0\nproperty float opacity\nproperty float scale_0\nproperty float rot_0\nend_header\n",
);
const request = (body: unknown, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/jobs", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify(body),
  });
async function finished(id: string) {
  for (let i = 0; i < 100; i++) {
    const job = getJob(id);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Mock job did not finish");
}

test("validated uploads share one authenticated Gradio session, survive polling, and return Gaussian bytes", async () => {
  const originalToken = process.env.HF_TOKEN;
  process.env.HF_TOKEN = "hf_test_only";
  const pixel = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  let closed = false;
  const heartbeat = new AbortController();
  const connect = mock.method(
    Client,
    "connect",
    async (space: string, options: { token: string }) => {
      assert.equal(space, SPACE_URL);
      assert.equal(options.token, "hf_test_only");
      return {
        abort_controller: heartbeat,
        submit(
          this: { abort_controller: AbortController },
          endpoint: string,
          payload: Record<string, unknown>,
        ) {
          this.abort_controller = new AbortController();
          calls.push(endpoint);
          return {
            async *[Symbol.asyncIterator]() {
              if (endpoint === "/preprocess_image") {
                await held;
                yield {
                  type: "data",
                  data: [{ path: "/tmp/preprocessed.png" }],
                };
              } else if (endpoint === "/generate_and_extract_glb") {
                assert.deepEqual(payload.image, {
                  path: "/tmp/preprocessed.png",
                });
                assert.equal(payload.ss_sampling_steps, 12);
                assert.equal(payload.texture_size, 1024);
                assert.equal("is_multiimage" in payload, false);
                yield { type: "status", stage: "generating" };
                yield { type: "data", data: [null, null, null] };
              } else if (endpoint === "/extract_gaussian") {
                yield {
                  type: "data",
                  data: [
                    null,
                    { url: `${SPACE_URL}/gradio_api/file=/tmp/model.ply` },
                  ],
                };
              } else yield { type: "data", data: [] };
            },
            cancel: async () => {},
          };
        },
        close() {
          closed = true;
        },
      };
    },
  );
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      assert.equal(url, `${SPACE_URL}/gradio_api/file=/tmp/model.ply`);
      assert.equal(
        new Headers(options.headers).get("Authorization"),
        "Bearer hf_test_only",
      );
      assert.equal(options.redirect, "error");
      return new Response(ply);
    },
  );
  try {
    assert.equal(
      (await createJob(request({}, "https://another-site.test"))).status,
      403,
    );
    assert.equal((await createJob(request(null))).status, 400);
    assert.equal((await createJob(request([]))).status, 400);
    const previewRequest = new Request("http://localhost:3000/api/jobs", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
      body: "{}",
    });
    assert.equal((await createJob(previewRequest)).status, 400);
    for (const image of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,bm90LWFuLWltYWdl",
    ])
      assert.equal(
        (await createJob(request({ requestId: randomUUID(), image }))).status,
        400,
      );
    const body = {
      requestId: randomUUID(),
      image: `data:image/png;base64,${pixel.toString("base64")}`,
    };
    const [first, second] = await Promise.all([
      createJob(request(body)),
      createJob(request(body)),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const { token } = await first.json();
    assert.deepEqual({ token }, await second.json());
    const id = verifyJob(token, "hf_test_only");
    assert.equal(jobStatus(token).status, 200);
    assert.equal((await jobFile(token)).status, 409);
    assert.equal(
      (await createJob(request({ ...body, requestId: randomUUID() }))).status,
      429,
    );
    assert.equal(jobStatus("tampered").status, 403);
    assert.equal((await jobFile("tampered")).status, 403);
    assert.equal(connect.mock.callCount(), 1);
    release();
    assert.equal((await finished(id)).status, "succeeded");
    assert.deepEqual(calls, [
      "/start_session",
      "/preprocess_image",
      "/generate_and_extract_glb",
      "/extract_gaussian",
    ]);
    assert.equal(closed, true);
    assert.equal(heartbeat.signal.aborted, true);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(await jobStatus(token).json(), { status: "succeeded" });
    assert.deepEqual(
      Buffer.from(await (await jobFile(token)).arrayBuffer()),
      ply,
    );
    assert.equal(
      jobStatus(signJob("lost-on-restart", "hf_test_only")).status,
      410,
    );
    await rm(getJob(id).file!, { force: true });
    delete process.env.HF_TOKEN;
    assert.equal((await createJob(request(body))).status, 503);
  } finally {
    release();
    mock.restoreAll();
    if (originalToken === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = originalToken;
  }
});

test("quota failures stop the pipeline and never return a sample as a result", async () => {
  const calls: string[] = [];
  let closed = false;
  mock.method(Client, "connect", async () => ({
    submit(endpoint: string) {
      calls.push(endpoint);
      return {
        async *[Symbol.asyncIterator]() {
          if (endpoint === "/generate_and_extract_glb")
            yield {
              type: "status",
              stage: "error",
              message: "You have exceeded your GPU quota",
            };
          else yield { type: "data", data: [{ path: "/tmp/image.png" }] };
        },
        cancel: async () => {},
      };
    },
    close() {
      closed = true;
    },
  }));
  try {
    const job = await finished(
      startGeneration(Buffer.from("mock image"), "hf_test_only"),
    );
    assert.equal(job.status, "failed");
    assert.match(job.error!, /free GPU quota/);
    assert.equal(job.file, undefined);
    assert.equal(calls.includes("/extract_gaussian"), false);
    assert.equal(closed, true);
    assert.match(
      generationError(new Error("401 unauthorized hf_secret")),
      /rejected the token/,
    );
    assert.equal(
      generationError(new Error("hf_secret internal traceback")).includes(
        "hf_secret",
      ),
      false,
    );
  } finally {
    mock.restoreAll();
  }
});

test("untrusted Gaussian URLs never receive the account token", async () => {
  mock.method(Client, "connect", async () => ({
    submit(endpoint: string) {
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "data",
            data:
              endpoint === "/extract_gaussian"
                ? [null, { url: "https://evil.test/model.ply" }]
                : [{ path: "/tmp/image.png" }],
          };
        },
        cancel: async () => {},
      };
    },
    close() {},
  }));
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected fetch");
  });
  try {
    const job = await finished(
      startGeneration(Buffer.from("mock image"), "hf_test_only"),
    );
    assert.equal(job.status, "failed");
    assert.match(job.error!, /valid Gaussian file/);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    mock.restoreAll();
  }
});

test("Gaussian exports larger than 100 MB stream to disk", async () => {
  mock.method(Client, "connect", async () => ({
    submit(endpoint: string) {
      return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "data",
            data:
              endpoint === "/extract_gaussian"
                ? [null, { url: `${SPACE_URL}/gradio_api/file=/tmp/large.ply` }]
                : [{ path: "/tmp/image.png" }],
          };
        },
        cancel: async () => {},
      };
    },
    close() {},
  }));
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (sent === 0) controller.enqueue(ply);
            else if (sent <= 101) controller.enqueue(chunk);
            else controller.close();
            sent++;
          },
        }),
      ),
  );
  let file: string | undefined;
  try {
    const job = await finished(
      startGeneration(Buffer.from("mock image"), "hf_test_only"),
    );
    file = job.file;
    assert.equal(job.status, "succeeded");
    assert.equal(typeof file, "string");
    const { stat } = await import("node:fs/promises");
    assert.equal((await stat(file!)).size, 101 * 1024 * 1024 + ply.length);
  } finally {
    if (file) await rm(file, { force: true });
    mock.restoreAll();
  }
});

test("status tells the viewer whether generation is configured", async (t) => {
  const saved = { HF_TOKEN: process.env.HF_TOKEN, GENERATIONS_PER_HOUR: process.env.GENERATIONS_PER_HOUR };
  t.after(() => {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  delete process.env.HF_TOKEN;
  delete process.env.GENERATIONS_PER_HOUR;
  let response = status();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /HF_TOKEN/);
  process.env.HF_TOKEN = "hf_test_only";
  response = status();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: true });
  process.env.GENERATIONS_PER_HOUR = "0";
  response = status();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /turned off/);
});
