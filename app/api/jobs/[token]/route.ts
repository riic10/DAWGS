import { errorResponse, verifyJob } from "@/lib/jobs";
import { apiToken, getJob } from "@/lib/huggingface";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const job = getJob(verifyJob(token, apiToken()));
    return Response.json(
      { status: job.status, ...(job.error ? { error: job.error } : {}) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
