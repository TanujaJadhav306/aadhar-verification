import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

async function sleep(ms) {
  return await new Promise((r) => setTimeout(r, ms));
}

async function rmWithRetries(p, { tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      await fs.rm(p, { recursive: true, force: true });
    } catch {
      // ignore and retry
    }
    try {
      await fs.access(p);
      // still exists
      await sleep(200 + i * 150);
      continue;
    } catch {
      // deleted
      return true;
    }
  }
  return false;
}

const root = process.cwd();
const nextDir = path.join(root, ".next");
const cacheDir = path.join(root, "node_modules", ".cache");

// On Windows + OneDrive, `.next` can contain reparse points that make Node/Next cleanup flaky.
// Use native `cmd rmdir` which is often more robust for these cases.
if (process.platform === "win32") {
  // First try Node deletion with retries (sometimes works better on Win11).
  await rmWithRetries(nextDir);
  await rmWithRetries(cacheDir);

  // Fallback to cmd.exe rmdir if folders still exist.
  try {
    execFileSync("cmd.exe", ["/c", "rmdir", "/s", "/q", nextDir], { stdio: "ignore" });
  } catch {
    // ignore
  }
  try {
    execFileSync("cmd.exe", ["/c", "rmdir", "/s", "/q", cacheDir], { stdio: "ignore" });
  } catch {
    // ignore
  }

  // Final verification: if `.next` remains, fail fast so we don't start Next.js with stale output.
  const ok = await rmWithRetries(nextDir, { tries: 2 });
  if (!ok) {
    process.stderr.write(
      "ERROR: Could not fully delete .next. Stop any running `next dev`, then delete .next manually.\n" +
        "On some machines, OneDrive/AV locks files—moving the project to a non-OneDrive folder helps.\n"
    );
    process.exit(1);
  }
} else {
  await rmWithRetries(nextDir);
  await rmWithRetries(cacheDir);
}

process.stdout.write("Cleaned .next and node_modules/.cache\n");


