/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Security-advisory reminders during dev/build and the default for `next upgrade --agent`
    // (the Next.js default, set explicitly by the 16.4.3 -> 16.4.6 security upgrade)
    agentUpgrade: 'security',
  },
  turbopack: {
    // The repo root has a stray package-lock.json; pin the root to this folder
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
