/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle for Docker deploys (node .next/standalone/server.js).
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  images: {
    remotePatterns: [
      // Steam CDN item icons referenced by inventory fixtures / live fetches.
      { protocol: 'https', hostname: 'community.cloudflare.steamstatic.com' },
      { protocol: 'https', hostname: 'steamcommunity-a.akamaihd.net' },
    ],
  },
};

export default nextConfig;
