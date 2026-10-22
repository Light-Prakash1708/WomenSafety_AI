// Builds the web app if needed, serves app + API on a throwaway database, and drives it in
// Chromium at phone and laptop size (tests/e2e/ui_test.py). Needs: pip install playwright && playwright install chromium
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!fs.existsSync("dist/index.html") || process.env.REBUILD) execSync("npm run -s build:web", { stdio: "inherit" });
const out = path.resolve(process.env.TEST_OUT ?? "test-results");
fs.mkdirSync(out, { recursive: true });
const viewports = (process.env.VIEWPORTS ?? "phone,desktop").split(",");
let failed = false;

for (const vp of viewports) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saahi-e2e-"));
  const db = path.join(dir, "e2e.db");
  const port = 3900 + Math.floor(Math.random() * 90);
  const app = `http://localhost:${port}`;
  const server = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-server.ts"], {
    env: { ...process.env, PORT: String(port), TURSO_DATABASE_URL: `file:${db}`, TURSO_AUTH_TOKEN: "", JWT_SECRET: "e2e-secret", ANTHROPIC_API_KEY: "", SAAHI_PUSH_MODE: "disabled" },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try {
      up = (await fetch(`${app}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const code = up
    ? await new Promise((res) => {
        const t = spawn(process.env.PYTHON ?? "python3", ["tests/e2e/ui_test.py"], { env: { ...process.env, VP: vp, APP: app, TEST_DB: db, TEST_OUT: out }, stdio: "inherit" });
        t.on("exit", res);
      })
    : 1;
  if (code !== 0) failed = true;
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
