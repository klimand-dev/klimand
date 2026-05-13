/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing TypeScript sources from the parent project (../src/process-runner.ts etc.)
  experimental: {
    externalDir: true
  },
  // Server bundling can be picky about node-side deps; mark them external so they aren't bundled.
  serverExternalPackages: ["@openai/agents"]
};

export default nextConfig;
