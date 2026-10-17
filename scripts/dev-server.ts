// Runs the whole of SAAHI on your computer: the web app from dist/ plus the API.
//   npm run build:web && npm run dev      ->  http://localhost:3000
// Uses TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env if set, otherwise a local
// database file (saahi-local.db), so it works with no setup at all.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { handle as Handle } from "../server/app";

if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.TURSO_DATABASE_URL) process.env.TURSO_DATABASE_URL = `file:${path.resolve("saahi-local.db")}`;
if (!process.env.TURSO_AUTH_TOKEN && !process.env.JWT_SECRET) process.env.JWT_SECRET = "local-development-only-secret";

const PORT = Number(process.env.PORT ?? 3000);
const SITE = path.resolve("dist");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

async function main() {
  // Loaded after .env so the database settings are in place first.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handle } = require("../server/app") as { handle: typeof Handle };
  if (!fs.existsSync(path.join(SITE, "index.html"))) {
    console.log("No web build found. Run `npm run build:web` first, then `npm run dev`.");
  }
  http
    .createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const r = await handle(
          new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks) }),
        );
        res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      // Same routing as vercel.json: real files first, then the app.
      let file = path.join(SITE, decodeURIComponent(url.pathname));
      if (!file.startsWith(SITE)) file = path.join(SITE, "index.html");
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file)) file = path.join(SITE, "index.html");
      if (!fs.existsSync(file)) {
        res.writeHead(404).end("Run `npm run build:web` first.");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(PORT, () => console.log(`SAAHI running at http://localhost:${PORT}  (database: ${process.env.TURSO_DATABASE_URL})`));
}

main();
