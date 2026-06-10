// Resolve ffmpeg/ffprobe binaries robustly — a
// distributable Mac app cannot assume the user has ffmpeg installed (a double-
// clicked app launches with a minimal PATH, and "users do not have developer
// tools installed"). So we prefer a binary BUNDLED with the app, and only fall
// back to the system.
//
// Resolution order:
//   1. explicit env override (JCUT_FFMPEG / JCUT_FFPROBE — set by the Electron
//      main process, which knows the bundle location)
//   2. a `bin/` dir shipped alongside the backend (the bundled binary)
//   3. common system install dirs
//   4. bare name (rely on PATH)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));      // …/dist/tools
const BACKEND_ROOT = path.resolve(HERE, "..", "..");            // backend root
const BUNDLED_BIN = path.join(BACKEND_ROOT, "bin");             // backend/bin/ffmpeg

const COMMON_DIRS = [
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
];

function resolve(name: string, envVar: string): string {
  const override = process.env[envVar];
  if (override && fs.existsSync(override)) return override;
  const bundled = path.join(BUNDLED_BIN, name);
  if (fs.existsSync(bundled)) return bundled;
  for (const dir of COMMON_DIRS) {
    const p = path.join(dir, name);
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  return name; // last resort: rely on PATH
}

export const FFMPEG = resolve("ffmpeg", "JCUT_FFMPEG");
export const FFPROBE = resolve("ffprobe", "JCUT_FFPROBE");
