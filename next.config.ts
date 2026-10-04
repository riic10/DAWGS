import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: { "/api/sample": ["./dog_model.ply"] },
};

export default config;
