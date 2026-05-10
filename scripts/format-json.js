const fs = require("node:fs");
const path = require("node:path");
const { canonicalStringify } = require("../lib/canonical-json");

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") return walk(p);
    return entry.isFile() && entry.name.endsWith(".json") ? [p] : [];
  });
}

for (const file of walk(process.cwd())) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, canonicalStringify(parsed));
}
