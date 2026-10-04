import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { ApiError, errorResponse, verifyJob } from "@/lib/jobs";
import { apiToken, getJob } from "@/lib/huggingface";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
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
