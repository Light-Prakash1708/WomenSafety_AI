// Adds the contact tracking page to the web build: dist/track/index.html
import fs from "node:fs";
fs.mkdirSync("dist/track", { recursive: true });
fs.copyFileSync("web/track/index.html", "dist/track/index.html");
console.log("Added dist/track/index.html");
