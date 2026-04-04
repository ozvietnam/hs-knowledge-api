/** @type {import('next').NextConfig} */
const nextConfig = {
  // Exclude data/ from serverless function bundle — use public/kg/ instead
  outputFileTracingExcludes: {
    '*': ['./data/**'],
  },
  async rewrites() {
    return [];
  },
};
module.exports = nextConfig;
