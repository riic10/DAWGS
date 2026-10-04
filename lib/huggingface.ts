import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Client, handle_file } from "@gradio/client";
import { ApiError, isOutputUrl, JOB_TTL_MS, SPACE_URL } from "./jobs.ts";

type Job = {
  status: "starting" | "processing" | "succeeded" | "failed";
  expires: number;
  error?: string;
  file?: string;
};

// Next bundles routes separately, so they share this process-local job store.
const shared = globalThis as typeof globalThis & {
  trellisJobs?: Map<string, Job>;
};
const jobs = (shared.trellisJobs ??= new Map<string, Job>());
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;

export function apiToken(): `hf_${string}` {
  const token = process.env.HF_TOKEN?.trim();
  if (!token?.startsWith("hf_"))
    throw new ApiError(
      "Generation needs a Hugging Face token. Add HF_TOKEN to .env.local in the repo root, then restart `npm run dev`.",
      503,
    );
  return token as `hf_${string}`;
}

export function generationError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : String(error);
  if (/quota|exceeded.*GPU|GPU.*exceeded/i.test(message))
    return "Your Hugging Face free GPU quota is exhausted or too small for this request. Wait for it to reset, then try again.";
  if (/unauthorized|forbidden|401|403|invalid.*token/i.test(message))
    return "Hugging Face rejected the token. Check HF_TOKEN and its read access.";
  if (/timeout|timed out/i.test(message))
    return "The Hugging Face job timed out. It may still be finishing remotely; check the Space before retrying.";
  if (error instanceof ApiError) return error.message;
  return "The TRELLIS Space could not finish this job. It may be busy or unavailable. Try again later.";
}

function removeJob(id: string, job: Job) {
  jobs.delete(id);
  if (job.file)
    void rm(job.file, { force: true }).catch(() => {
      console.error("Could not remove a temporary Gaussian file.");
    });
}

export function getJob(id: string) {
  const job = jobs.get(id);
  if (!job || job.expires <= Date.now()) {
    if (job) removeJob(id, job);
    throw new ApiError(
      "This job expired or the server restarted. Generate a new model to continue.",
      410,
    );
  }
  return job;
}

export function startGeneration(image: Buffer, token: `hf_${string}`) {
  for (const [id, job] of jobs)
    if (job.expires <= Date.now()) removeJob(id, job);
  if (
    [...jobs.values()].some((job) =>
      ["starting", "processing"].includes(job.status),
    )
  )
    throw new ApiError(
      "A model is already being generated. Wait for it to finish before starting another.",
      429,
    );
  // Bound temporary disk usage while keeping recent downloads available.
  while (jobs.size >= 3) {
    const [oldId, oldJob] = jobs.entries().next().value!;
    removeJob(oldId, oldJob);
  }
  const id = randomUUID();
  const job: Job = { status: "starting", expires: Date.now() + JOB_TTL_MS };
  jobs.set(id, job);
  const cleanup = setTimeout(() => removeJob(id, job), JOB_TTL_MS);
  cleanup.unref();
  // This demo requires a persistent Node process to finish the Gradio session.
  void runGeneration(job, image, token);
  return id;
}

async function runGeneration(job: Job, image: Buffer, token: `hf_${string}`) {
  let client: Client | undefined;
  let heartbeat: AbortController | null | undefined;
  let active: ReturnType<Client["submit"]> | undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let temporaryFile: string | undefined;

  async function call(endpoint: string, payload: Record<string, unknown> = {}) {
    controller.signal.throwIfAborted();
    active = client!.submit(endpoint, payload);
    let data: unknown[] | undefined;
    for await (const event of active) {
      controller.signal.throwIfAborted();
      if (event.type === "status") {
        if (event.stage === "error")
          throw new Error(
            typeof event.message === "string"
              ? event.message
              : "Space input validation failed",
          );
        if (endpoint === "/generate_and_extract_glb")
          job.status = event.stage === "generating" ? "processing" : "starting";
      }
      if (event.type === "data" && Array.isArray(event.data)) data = event.data;
    }
    if (!data) throw new Error("The Space returned no result.");
    return data;
  }

  try {
    const work = async () => {
      client = await Client.connect(SPACE_URL, {
        token,
        events: ["data", "status"],
      });
      // Gradio replaces its controller for queue requests, leaving the heartbeat open.
      heartbeat = client.abort_controller;
      if (controller.signal.aborted) {
        client.close();
        heartbeat?.abort();
        controller.signal.throwIfAborted();
      }
      await call("/start_session");
      const prepared = await call("/preprocess_image", {
        image: handle_file(image),
      });
      if (!prepared[0]) throw new Error("Image preprocessing failed.");
      await call("/generate_and_extract_glb", {
        image: prepared[0],
        multiimages: [],
        seed: Math.floor(Math.random() * 2147483647),
        ss_guidance_strength: 7.5,
        ss_sampling_steps: 12,
        slat_guidance_strength: 3,
        slat_sampling_steps: 12,
        multiimage_algo: "stochastic",
        mesh_simplify: 0.95,
        texture_size: 1024,
      });
      job.status = "processing";
      const output = await call("/extract_gaussian");
      const file = output[1];
      const url =
        typeof file === "string"
          ? file
          : file && typeof file === "object" && "url" in file
            ? file.url
            : undefined;
      if (!isOutputUrl(url))
        throw new ApiError(
          "TRELLIS did not return a valid Gaussian file.",
          502,
        );
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new ApiError(
          "The Gaussian download is unavailable. Try generating again.",
          502,
        );
      temporaryFile = join(tmpdir(), `snoopygs-${randomUUID()}.ply`);
      let size = 0;
      let headerBytes = Buffer.alloc(0);
      async function* chunks() {
        const reader = response.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_FILE_BYTES)
              throw new ApiError(
                "This model exceeds the demo's 512 MB limit.",
                502,
              );
            if (headerBytes.length < 8192)
              headerBytes = Buffer.concat([
                headerBytes,
                value.subarray(0, 8192 - headerBytes.length),
              ]);
            yield value;
          }
        } finally {
          await reader.cancel();
        }
      }
      await pipeline(
        chunks(),
        createWriteStream(temporaryFile, { flags: "wx", mode: 0o600 }),
        { signal: controller.signal },
      );
      controller.signal.throwIfAborted();
      const header = headerBytes.toString();
      if (!header.startsWith("ply\n") && !header.startsWith("ply\r\n"))
        throw new ApiError("TRELLIS returned an invalid PLY file.", 502);
      if (
        !["f_dc_0", "opacity", "scale_0", "rot_0", "end_header"].every(
          (field) => header.includes(field),
        )
      )
        throw new ApiError(
          "TRELLIS returned a PLY without Gaussian splat data.",
          502,
        );
      job.file = temporaryFile;
      job.status = "succeeded";
    };
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Generation timed out"));
        }, TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    job.status = "failed";
    job.error = generationError(error);
    try {
      await active?.cancel();
    } catch {
      /* The remote session may already be closed. */
    }
  } finally {
    clearTimeout(timer);
    client?.close();
    heartbeat?.abort();
    if (temporaryFile && job.status !== "succeeded") {
      await rm(temporaryFile, { force: true }).catch(() => {
        console.error("Could not remove a failed Gaussian download.");
      });
    }
  }
}
