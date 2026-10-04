// Photo -> 3D dog through the API in lib/api.ts, which this viewer's server
// serves at /api (vite.config.js). The server keeps HF_TOKEN and runs TRELLIS
// on Hugging Face.
export const PHOTO = { types: ["image/png", "image/jpeg"], maxBytes: 3 * 1024 * 1024 };
const POLL_MS = 2500;

const OFFLINE = "Can't reach the server. Check that `npm run dev` is still running, then try again.";
const NO_ROUTE = "This page can't make dogs from photos. Open it with `npm run dev` in the repo root.";

export class GenerationError extends Error {
  // `retry`: worth asking again later (server stopped or busy).
  constructor(message, { status = 0, retry = false } = {}) {
    super(message);
    this.status = status;
    this.retry = retry;
  }
}

async function send(path, options) {
  try {
    return await fetch(path, { cache: "no-store", ...options });
  } catch {
    throw new GenerationError(OFFLINE, { retry: true });
  }
}

// The API answers with JSON, errors included. Anything else means the request
// never reached it.
async function apiJson(path, options) {
  const response = await send(path, options);
  const body = await response.json().catch(() => null);
  if (!body) {
    const missing = response.status === 404;
    throw new GenerationError(missing ? NO_ROUTE : OFFLINE, { status: response.status, retry: !missing });
  }
  if (!response.ok) {
    throw new GenerationError(body.error || `The server answered ${response.status}.`, {
      status: response.status,
      retry: response.status >= 500 || response.status === 429,
    });
  }
  return body;
}

// Resolves if photos can become dogs now; otherwise rejects with what to fix.
export function checkGeneration() {
  return apiJson("/api/status");
}

// Starts a generation and returns its job token.
export async function createJob(photo) {
  const image = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new GenerationError("Your photo couldn't be read. Choose it again."));
    reader.readAsDataURL(photo);
  });
  const { token } = await apiJson("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, requestId: uuid() }),
  });
  return token;
}

// Resolves once the job has succeeded and rejects if it fails or expires. A
// dropped connection or restarted server only delays it: onStatus hears
// "starting", "processing", or "reconnecting" with the reason.
export async function waitForJob(token, onStatus) {
  let failures = 0;
  for (;;) {
    try {
      const body = await apiJson(`/api/jobs/${encodeURIComponent(token)}`);
      failures = 0;
      if (body.status === "succeeded") return;
      if (body.status === "failed") throw new GenerationError(body.error || "This dog couldn't be finished. Try again or use another photo.");
      onStatus(body.status === "processing" ? "processing" : "starting");
    } catch (error) {
      if (!(error instanceof GenerationError) || !error.retry) throw error;
      failures++;
      onStatus("reconnecting", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, failures ? Math.min(2000 * failures, 15_000) : POLL_MS));
  }
}

// The generated Gaussian splat PLY.
export async function downloadJob(token) {
  const response = await send(`/api/jobs/${encodeURIComponent(token)}/file`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new GenerationError(body?.error || "Your 3D dog couldn't be downloaded. Try creating it again.", { status: response.status });
  }
  return new Uint8Array(await response.arrayBuffer());
}

// crypto.randomUUID only exists in secure contexts, which a phone opening the
// LAN address isn't.
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
