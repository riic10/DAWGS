// Minimal reader for binary little-endian splat PLYs with all-float vertex
// properties (the 3DGS layout). Returns the raw floats plus a name -> column map.
import { readFileSync } from "node:fs";

export function readPly(file) {
  const buf = readFileSync(file);
  const hdrEnd = buf.indexOf("end_header\n") + "end_header\n".length;
  const header = buf.subarray(0, hdrEnd).toString();
  if (!header.includes("binary_little_endian")) throw new Error("Only binary little-endian PLY is supported");
  const props = [...header.matchAll(/property (\w+) (\w+)/g)];
  if (props.some(([, type]) => type !== "float")) throw new Error("Only all-float vertex properties are supported");
  const P = Object.fromEntries(props.map(([, , name], i) => [name, i]));
  const stride = props.length;
  const n = Number(header.match(/element vertex (\d+)/)[1]);
  const f = new Float32Array(buf.buffer.slice(buf.byteOffset + hdrEnd, buf.byteOffset + hdrEnd + n * stride * 4));
  return { n, stride, P, f };
}

export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
