import sharp from "sharp";
import {
  ApiError,
  JOB_TTL_MS,
  MAX_IMAGE_BYTES,
  errorResponse,
  signJob,
} from "@/lib/jobs";
import { apiToken, startGeneration } from "@/lib/huggingface";

export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    // Next may normalize the URL hostname, so retain the browser's request host.
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
    const configuredLimit = Number(process.env.GENERATIONS_PER_HOUR ?? 20);
    const limit = Number.isFinite(configuredLimit)
      ? Math.max(0, configuredLimit)
      : 20;
    if (attempts >= limit)
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
