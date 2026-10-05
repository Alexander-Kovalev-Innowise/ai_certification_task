import { availableParallelism } from 'node:os';

// argon2id hashing/verification (login, registration, password change) runs on
// libuv's thread pool, which defaults to 4 threads regardless of core count -
// so at most 4 logins are ever being verified at once. Measured on a 24-core
// machine, 8 threads lifts sustained login throughput ~+40% (200 -> ~280/s)
// and shortens a 1,000-login burst by ~25%; going beyond 8 gave nothing more
// (the rest of the request path is single-threaded) while every in-flight
// argon2 costs ~19 MiB. An explicit UV_THREADPOOL_SIZE always wins.
//
// This module is imported FIRST by main.ts: the pool is sized when it is first
// used, so the variable must be set before any other module can trigger it.
const DEFAULT_THREADS = 4;
const MAX_THREADS = 8;

if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(Math.min(MAX_THREADS, Math.max(DEFAULT_THREADS, availableParallelism())));
}
