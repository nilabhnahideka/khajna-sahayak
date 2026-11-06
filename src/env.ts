// Load .env for local development (Node >= 21.7). On the server, real env vars are used.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}
