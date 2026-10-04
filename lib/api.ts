import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import sharp from "sharp";
import { apiToken, getJob, startGeneration } from "./huggingface.ts";
import {
  ApiError,
  JOB_TTL_MS,
  MAX_IMAGE_BYTES,
  errorResponse,
  generationLimit,
  signJob,
  verifyJob,
} from "./jobs.ts";

// The Dog panel's photo -> 3D dog API. The woods viewer's server serves it at
// /api (web/vite.config.js), so HF_TOKEN never reaches the browser.

// Keep duplicate clicks on one server process from starting additional GPU jobs.
const submissions = new Map<
  string,
  { expires: number; result: Promise<{ token: string }> }
>();
let windowStart = Date.now();
let attempts = 0;

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("Choose an image first.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_IMAGE_BYTES * 1.4) {
      await reader.cancel();
      throw new ApiError("Choose an image smaller than 3 MB.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new ApiError("The upload could not be read.");
  }
}

// GET /api/status: lets the viewer point out a missing token before an upload.
export function status() {
  try {
    apiToken();
    if (generationLimit() === 0)
      throw new ApiError(
        "Photo generation is turned off (GENERATIONS_PER_HOUR=0).",
        503,
      );
    return Response.json(
      { ready: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/jobs: starts a generation and returns its signed job token.
export async function createJob(request: Request) {
  try {
    const url = new URL(request.url);
    // Compare with the host the browser asked for.
    const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
    if (request.headers.get("origin") !== origin)
      throw new ApiError("Submit your image from this website.", 403);
    const secret = apiToken();
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError("Invalid upload request.");
    if (
      typeof body.requestId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(body.requestId)
    )
      throw new ApiError("Invalid upload request.");
    for (const [key, entry] of submissions)
      if (entry.expires < Date.now()) submissions.delete(key);
    const existing = submissions.get(body.requestId);
    if (existing) return Response.json(await existing.result);
    if (
      typeof body.image !== "string" ||
      !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(body.image)
    )
      throw new ApiError("Choose a PNG or JPEG image.");
    const bytes = Buffer.from(body.image.split(",")[1], "base64");
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new ApiError("Choose an image smaller than 3 MB.", 413);
    if (Date.now() - windowStart > JOB_TTL_MS) {
      windowStart = Date.now();
      attempts = 0;
    }
    if (attempts >= generationLimit())
      throw new ApiError(
        "This demo has reached its generation limit. Please try the sample model.",
        429,
      );
    attempts++;
    const result = (async () => {
      let image: Buffer;
      try {
        const input = sharp(bytes, { limitInputPixels: 16_777_216 });
        const metadata = await input.metadata();
        if (!["jpeg", "png"].includes(metadata.format ?? "")) throw new Error();
        image = await input
          .rotate()
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();
      } catch {
        throw new ApiError(
          "This image could not be decoded. Use a PNG or JPEG under 16 megapixels.",
        );
      }
      const id = startGeneration(image, secret);
      return { token: signJob(id, secret) };
    })();
    submissions.set(body.requestId, {
      expires: Date.now() + JOB_TTL_MS,
      result,
    });
    return Response.json(await result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// GET /api/jobs/:token
export function jobStatus(token: string) {
  try {
    const job = getJob(verifyJob(token, apiToken()));
    return Response.json(
      { status: job.status, ...(job.error ? { error: job.error } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

// GET /api/jobs/:token/file: the generated Gaussian splat PLY.
export async function jobFile(token: string) {
  try {
    const job = getJob(verifyJob(token, apiToken()));
    if (job.status !== "succeeded" || !job.file)
      throw new ApiError("Your Gaussian model is not available yet.", 409);
    const info = await stat(job.file);
    return new Response(
      Readable.toWeb(createReadStream(job.file)) as ReadableStream,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(info.size),
          "Content-Disposition": 'attachment; filename="snoopygs-model.ply"',
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

// Routes a request for /api/... to its handler.
export async function handleApi(request: Request): Promise<Response> {
  const [resource, token, file, ...rest] = new URL(request.url).pathname
    .split("/")
    .slice(2);
  const { method } = request;
  if (resource === "status" && token === undefined && method === "GET")
    return status();
  if (resource === "jobs" && token === undefined && method === "POST")
    return createJob(request);
  if (resource === "jobs" && token && !rest.length && method === "GET") {
    let decoded: string;
    try {
      decoded = decodeURIComponent(token);
    } catch {
      return errorResponse(new ApiError("This job link is invalid.", 403));
    }
    if (file === undefined) return jobStatus(decoded);
    if (file === "file") return jobFile(decoded);
  }
  return errorResponse(new ApiError("There's no such API endpoint.", 404));
}
