import { Readable, pipeline } from "node:stream";
import { handleApi } from "../lib/api.ts";

// The photo -> 3D API reads HF_TOKEN (and GENERATIONS_PER_HOUR) from
// .env.local or .env at the repo root. Variables already set win.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(new URL(`../${file}`, import.meta.url));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

// Serves the Dog panel's photo -> 3D API (lib/api.ts) at /api from this
// server, so the page's requests are same-origin and the token stays here.
export async function serveApi(req, res, next) {
  if (!req.url?.startsWith("/api/")) return next();
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (!name.startsWith(":") && value !== undefined) headers.set(name, String(value));
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const response = await handleApi(new Request(`${req.socket.encrypted ? "https" : "http"}://${req.headers.host}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: "half",
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) pipeline(Readable.fromWeb(response.body), res, () => {});
    else res.end();
  } catch (error) {
    next(error);
  }
}

const photoApi = {
  name: "snoopygs-photo-api",
  configureServer(server) { server.middlewares.use(serveApi); },
  configurePreviewServer(server) { server.middlewares.use(serveApi); },
};

// A plain object rather than defineConfig, so tests can import it without Vite installed.
/** @type {import("vite").UserConfig} */
export default {
  plugins: [photoApi],
  resolve: { dedupe: ["three", "@sparkjsdev/spark"] },
  server: { fs: { allow: [".."] } },
};
