import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "public/styles"];
const ALLOWED_EXT = new Set([
  ".astro",
  ".vue",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".scss",
  ".json",
  ".md",
]);

const CDN = "https://cdn.probusiness.pe/landingconsolidado";

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

const files = [];
for (const dir of TARGET_DIRS) {
  walk(path.join(ROOT, dir), files);
}

let changed = 0;
for (const file of files) {
  const original = fs.readFileSync(file, "utf8");
  let content = original;

  content = content.replace(/\/images\/([^'"()\s]+?)\.(png|jpe?g)/gi, "/images/$1.webp");
  content = content.replace(/(["'(])\/images\//g, `$1${CDN}/images/`);
  content = content.replace(/(["'(])\/videos\//g, `$1${CDN}/videos/`);

  if (content !== original) {
    fs.writeFileSync(file, content, "utf8");
    changed += 1;
  }
}

console.log(`files_changed=${changed}`);
