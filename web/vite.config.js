import { defineConfig } from "vite";

export default defineConfig({
  resolve: { dedupe: ["three", "@sparkjsdev/spark"] },
  server: { fs: { allow: [".."] } },
});
