// Photo -> Gaussian splat (.ply) through a TRELLIS Space on Hugging Face,
// called from the browser with the official Gradio client. No backend and no
// app token. Signed-out calls share the small anonymous ZeroGPU quota; with
// the user's own sign-in token (hf-auth.js) the Space charges their quota.
//
// Endpoints of trellis-community/TRELLIS, read from /gradio_api/info on
// 2026-10-04 (re-check with `(await Client.connect(id)).view_api()` if it breaks):
//   /start_session()                 -> (nothing)   sets up per-session state
//   /preprocess_image(image)         -> Image       background removed
//   /generate_and_extract_glb(image, multiimages=[], seed, ss_guidance_strength=7.5,
//       ss_sampling_steps=12, slat_guidance_strength=3.0, slat_sampling_steps=12,
//       multiimage_algo="stochastic", mesh_simplify=0.95, texture_size=1024)
//                                    -> [video, GLB, GLB download]
//   /extract_gaussian()              -> [extracted, Gaussian download] (file data
//                                       with a `url`); reads the session state
// The Space keeps state per session, so every call goes through one Client.
// microsoft/TRELLIS is broken (CONFIG_ERROR) and microsoft/TRELLIS.2 only
// exports meshes, so neither works here.
import { Client, handle_file } from "@gradio/client";

export const TRELLIS = {
  spaceId: "trellis-community/TRELLIS",
  endpoints: {
    start: "/start_session",
    preprocess: "/preprocess_image",
    generate: "/generate_and_extract_glb",
    extractGaussian: "/extract_gaussian",
  },
  settings: {
    seed: null, // null: a new random seed every run; a number: repeatable
    ss_guidance_strength: 7.5,
    ss_sampling_steps: 25, // stage 1; above the default 12 to cut extra-ear errors
    slat_guidance_strength: 3.0,
    slat_sampling_steps: 12,
    multiimage_algo: "stochastic", // unused with a single photo
    mesh_simplify: 0.95, // the GLB step runs too; these only affect the mesh
    texture_size: 1024,
  },
};

export class TrellisError extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.kind = kind; // "quota" | "auth" | "unavailable" | "network" | "endpoint" | "generation"
    this.cause = cause;
  }
}

// ZeroGPU quota messages look like:
//   signed out: "You have exceeded your ZeroGPU quota (120s requested vs. 155s left).
//                Try again in 23:54:17. Authenticate with a Hugging Face token for more quota"
//   signed in:  "You have exceeded your free ZeroGPU quota (120s requested vs. 0s left).
//                Try again in 0:00:00. Subscribe to Hugging Face PRO to get …"
// The countdown isn't reliable (signed-in users get 0:00:00 with nothing
// left), and per HF docs the daily allowance resets 24 hours after the first
// GPU use, so a missing or sub-minute countdown is reported as that.
function quotaMessage(text) {
  const signedIn = /free zerogpu quota|subscribe to hugging face pro/i.test(text);
  const used = signedIn
    ? "You've used today's free GPU allowance on your Hugging Face account (5 GPU minutes a day)."
    : "The shared GPU allowance for signed-out visitors is used up.";
  const m = text.match(/try again in (?:(\d+) days?, )?(\d+):(\d+):(\d+)/i);
  const seconds = m ? (Number(m[1] ?? 0) * 24 + Number(m[2])) * 3600 + Number(m[3]) * 60 + Number(m[4]) : 0;
  let when;
  if (seconds >= 3600) {
    const h = Math.round(seconds / 3600);
    when = `Try again in about ${h} hour${h === 1 ? "" : "s"}.`;
  } else if (seconds >= 60) {
    const min = Math.round(seconds / 60);
    when = `Try again in about ${min} minute${min === 1 ? "" : "s"}.`;
  } else {
    when = "It resets 24 hours after you first used it.";
  }
  const more = signedIn ? " Hugging Face PRO gives a much bigger daily allowance." : "";
  return `${used} ${when}${more}`;
}

export function classify(err) {
  if (err instanceof TrellisError) return err;
  const text = String(err?.message ?? err?.original_msg ?? err ?? "");
  if (/quota|exceeded your gpu|zerogpu|gpu task aborted|too many requests|rate limit/i.test(text)) {
    return new TrellisError("quota", quotaMessage(text), err);
  }
  if (/could not be accessed|space metadata could not be loaded/i.test(text)) {
    return new TrellisError("unavailable", `Couldn't find the TRELLIS Space "${TRELLIS.spaceId}" (removed, renamed or private). Check TRELLIS.spaceId in trellis.js.`, err);
  }
  if (/sleep|paused|building|runtime_error|config_error|not found|queue is full|space.*(error|unavailable)/i.test(text)) {
    return new TrellisError("unavailable", "The TRELLIS Space isn't available right now (asleep, restarting or busy). Try again in a minute.", err);
  }
  if (err instanceof TypeError || /network|failed to fetch|connection|load failed|aborted/i.test(text)) {
    return new TrellisError("network", "Couldn't reach Hugging Face. Check your connection and try again.", err);
  }
  return new TrellisError("generation", `Generation failed: ${text || "unknown error"}`, err);
}

// Run one endpoint and resolve with its data, reporting queue/progress status.
async function run(app, endpoint, data, phase, onStatus, startedAt) {
  const elapsed = () => (performance.now() - startedAt) / 1000;
  onStatus?.({ phase, queuePosition: null, eta: null, progress: null, elapsed: elapsed() });
  const job = app.submit(endpoint, data);
  let result = null;
  for await (const msg of job) {
    if (msg.type === "status") {
      if (msg.stage === "error") {
        throw classify(new Error(typeof msg.message === "string" ? msg.message : msg.original_msg ?? "error"));
      }
      const progress = msg.progress_data?.[0];
      onStatus?.({
        phase: msg.stage === "pending" && msg.position != null ? "queued" : phase,
        queuePosition: msg.position ?? null,
        eta: msg.eta ?? null,
        progress: progress && progress.length ? progress.index / progress.length : null,
        elapsed: elapsed(),
      });
      if (msg.stage === "complete" && result) break;
    } else if (msg.type === "data") {
      result = msg.data;
      break;
    }
  }
  if (!result) throw new TrellisError("generation", `${endpoint} finished without a result.`);
  return result;
}

function checkApi(info) {
  const named = info?.named_endpoints ?? {};
  for (const ep of Object.values(TRELLIS.endpoints)) {
    if (!named[ep]) throw new TrellisError("endpoint", `The TRELLIS Space no longer has ${ep}. Its API changed; update TRELLIS.endpoints in trellis.js.`);
  }
  const params = new Set(named[TRELLIS.endpoints.generate].parameters.map((p) => p.parameter_name));
  const missing = ["image", "seed", ...Object.keys(TRELLIS.settings).filter((k) => k !== "seed")].filter((k) => !params.has(k));
  if (missing.length) {
    throw new TrellisError("endpoint", `The TRELLIS generate step no longer takes ${missing.join(", ")}. Its API changed; update trellis.js.`);
  }
}

async function download(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new TrellisError("generation", `Couldn't download the splat (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(total ? received / total : null, received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes.buffer;
}

// file: a File/Blob photo. token: the user's HF access token, or null for an
// anonymous call. onStatus({ phase, queuePosition, eta, progress, elapsed }),
// phases: connecting, queued, preparing, generating, extracting, downloading.
// Resolves with { bytes: ArrayBuffer, filename }; rejects with a TrellisError.
export async function generateDogSplat(file, { onStatus, token = null } = {}) {
  const startedAt = performance.now();
  const status = (phase, extra = {}) =>
    onStatus?.({ phase, queuePosition: null, eta: null, progress: null, elapsed: (performance.now() - startedAt) / 1000, ...extra });

  let app;
  try {
    status("connecting");
    app = await Client.connect(TRELLIS.spaceId, {
      ...(token ? { token } : {}),
      events: ["data", "status"], // the default is data only: no queue position, no errors
      status_callback: (s) => { if (s.status === "sleeping" || s.status === "building") status("connecting", { note: "Space is waking up…" }); },
    });
    checkApi(await app.view_api());

    const { endpoints, settings } = TRELLIS;
    await run(app, endpoints.start, {}, "preparing", onStatus, startedAt);
    let prepared;
    try {
      [prepared] = await run(app, endpoints.preprocess, { image: handle_file(file) }, "preparing", onStatus, startedAt);
    } catch (err) {
      // This step only decodes the photo and cuts the dog out (no GPU), so a
      // generic failure here is about the photo.
      if (err.kind !== "generation") throw err;
      throw new TrellisError("generation", "TRELLIS couldn't read your photo or find the dog in it. Try a JPEG or PNG where the dog is clearly visible.", err);
    }

    const seed = settings.seed ?? Math.floor(Math.random() * (2 ** 31 - 1)); // Space max: int32
    await run(app, endpoints.generate, {
      image: prepared,
      multiimages: [],
      seed,
      ss_guidance_strength: settings.ss_guidance_strength,
      ss_sampling_steps: settings.ss_sampling_steps,
      slat_guidance_strength: settings.slat_guidance_strength,
      slat_sampling_steps: settings.slat_sampling_steps,
      multiimage_algo: settings.multiimage_algo,
      mesh_simplify: settings.mesh_simplify,
      texture_size: settings.texture_size,
    }, "generating", onStatus, startedAt);

    const out = await run(app, endpoints.extractGaussian, {}, "extracting", onStatus, startedAt);
    const gaussian = out?.[1] ?? out?.[0];
    if (!gaussian?.url) throw new TrellisError("endpoint", "The TRELLIS Space didn't return a Gaussian file. Its API may have changed.");

    status("downloading", { progress: 0 });
    const bytes = await download(gaussian.url, (progress) => status("downloading", { progress }));
    return { bytes, filename: gaussian.orig_name ?? "dog.ply", seed };
  } catch (err) {
    // A bad token isn't refused: the Space quietly treats the call as
    // anonymous, and its quota message then asks to "Authenticate with a
    // Hugging Face token". Seeing that while signed in means the sign-in
    // didn't count.
    const text = String(err?.cause?.message ?? err?.message ?? err);
    if (token && /authenticate with a hugging face token|\b401\b|invalid (user )?token|unauthori[sz]ed/i.test(text)) {
      throw new TrellisError("auth", "Your Hugging Face sign-in has expired or was revoked. Sign in again.", err);
    }
    throw classify(err);
  } finally {
    try { app?.close(); } catch { /* already closed */ }
  }
}
