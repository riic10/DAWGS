import { createHmac, timingSafeEqual } from "node:crypto";

export const SPACE_URL = "https://trellis-community-trellis.hf.space";
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const JOB_TTL_MS = 60 * 60 * 1000;

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function signJob(id: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ id, expires: now + JOB_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyJob(
  token: string,
  secret: string,
  now = Date.now(),
): string {
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error();
    const expected = createHmac("sha256", secret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error();
    const { id, expires } = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      typeof expires !== "number"
    )
      throw new Error();
    if (expires <= now)
      throw new ApiError(
        "This result has expired. Generate a new model to continue.",
        410,
      );
    return id;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("This job link is invalid.", 403);
  }
}

export function isOutputUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.origin === SPACE_URL &&
      (url.pathname.startsWith("/gradio_api/file=") ||
        url.pathname.startsWith("/file="))
    );
  } catch {
    return false;
  }
}

export function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof ApiError
          ? error.message
          : "Something went wrong. Please try again.",
    },
    {
      status: error instanceof ApiError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
