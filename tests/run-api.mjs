// Starts the SAAHI API on a throwaway libSQL database, runs tests/api.test.mjs, then stops it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saahi-api-"));
const db = path.join(dir, "test.db");
const port = 3100 + Math.floor(Math.random() * 800);
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-server.ts"], {
  env: { ...process.env, PORT: String(port), TURSO_DATABASE_URL: `file:${db}`, TURSO_AUTH_TOKEN: "", JWT_SECRET: "test-secret-for-ci-only", ANTHROPIC_API_KEY: "", SAAHI_DISABLE_PUSH: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const stop = () => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
};

let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try {
    up = (await fetch(`${base}/api/health`)).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (!up) {
  console.error("API server didn't start:\n" + log);
  stop();
  process.exit(1);
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["tests/api.test.mjs"];
let failed = false;
for (const f of files) {
  const code = await new Promise((res) => {
    const t = spawn(process.execPath, [f], { env: { ...process.env, BASE: base, TEST_DB: db }, stdio: "inherit" });
    t.on("exit", res);
  });
  if (code !== 0) failed = true;
}
if (failed && process.env.SHOW_SERVER_LOG) console.error(log);
stop();
process.exit(failed ? 1 : 0);
