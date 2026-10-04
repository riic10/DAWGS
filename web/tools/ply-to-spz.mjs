// Convert a .ply splat file to .spz using Spark's own encoder.
// Usage: node tools/ply-to-spz.mjs <in.ply> <out.spz>
import { readFile, writeFile } from "node:fs/promises";
import { transcodeSpz } from "@sparkjsdev/spark";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node tools/ply-to-spz.mjs <in.ply> <out.spz>");
  process.exit(1);
}

const fileBytes = new Uint8Array(await readFile(input));
const { fileBytes: spz } = await transcodeSpz({
  inputs: [{ fileBytes, pathOrUrl: input }],
});
await writeFile(output, spz);
console.log(`${input} (${fileBytes.length} bytes) -> ${output} (${spz.length} bytes)`);
