// Shared dev-tooling helper for the capture scripts (NOT used by the app — the app reads
// process.env, which Vite/Vercel provide unquoted). Reads a key from .env.local and robustly
// strips surrounding quotes + whitespace. Closes the latent bug in the original per-script
// loaders (`/^["']|["']$/` without the `g`/`+` flag left a stray quote on a quoted value).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadEnvKey(name, envPath = join(repoRoot, ".env.local")) {
  const env = readFileSync(envPath, "utf8");
  const line = env.split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) return "";
  return line.slice(name.length + 1).trim().replace(/^["']+|["']+$/g, "");
}
