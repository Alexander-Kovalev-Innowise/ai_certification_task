import { config } from 'dotenv';

// Loads the root .env (project root, not per-app) so NEXT_PUBLIC_API_URL is in
// process.env before Next's own build-time env inlining runs — Next only
// auto-loads .env files from the app's own directory by default.
config({ path: new URL('../../.env', import.meta.url).pathname });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
