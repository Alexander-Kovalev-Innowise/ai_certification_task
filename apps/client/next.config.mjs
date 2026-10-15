import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Loads the root .env (project root, not per-app) so NEXT_PUBLIC_API_URL is in
// process.env before Next's own build-time env inlining runs — Next only
// auto-loads .env files from the app's own directory by default.
// fileURLToPath (not .pathname) is required for a valid Windows path: a
// file:// URL's .pathname is POSIX-style ("/D:/..."), which Node's fs calls
// on Windows don't resolve correctly.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
