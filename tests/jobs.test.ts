import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, isOutputUrl, signJob, verifyJob } from "../lib/jobs";

test("job capabilities reject tampering, wrong keys, and expiration", () => {
  const token = signJob("test-prediction", "secret", 0);
  assert.equal(verifyJob(token, "secret", 1), "test-prediction");
  assert.throws(() => verifyJob(token, "another-key", 1), ApiError);
  assert.throws(() => verifyJob(`${token}tampered`, "secret", 1), ApiError);
  assert.throws(
    () => verifyJob(token, "secret", 3_600_000),
    (error: unknown) => error instanceof ApiError && error.status === 410,
  );
  assert.throws(
    () => verifyJob(signJob("../other-prediction", "secret"), "secret"),
    ApiError,
  );
});

test("file download accepts only the TRELLIS Space's file endpoints", () => {
  assert.equal(
    isOutputUrl(
      "https://trellis-community-trellis.hf.space/gradio_api/file=/tmp/a.ply",
    ),
    true,
  );
  assert.equal(
    isOutputUrl("https://trellis-community-trellis.hf.space/file=/tmp/a.ply"),
    true,
  );
  for (const url of [
    "http://trellis-community-trellis.hf.space/gradio_api/file=/a.ply",
    "https://trellis-community-trellis.hf.space.evil.test/gradio_api/file=/a.ply",
    "https://other.hf.space/gradio_api/file=/a.ply",
    "https://localhost/a",
    "https://user@trellis-community-trellis.hf.space/file=/a.ply",
    "https://trellis-community-trellis.hf.space:3000/file=/a.ply",
    "https://trellis-community-trellis.hf.space/config",
    undefined,
  ])
    assert.equal(isOutputUrl(url), false);
});
