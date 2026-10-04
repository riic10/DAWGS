import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";

export async function GET() {
  const file = path.join(process.cwd(), "dog_model.ply");
  const info = await stat(file);
  return new Response(
    Readable.toWeb(createReadStream(file)) as ReadableStream,
    {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(info.size),
        "Content-Disposition": 'attachment; filename="snoopygs-sample.ply"',
        "Cache-Control": "public, max-age=86400",
      },
    },
  );
}
