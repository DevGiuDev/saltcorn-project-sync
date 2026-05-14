/**
 * Read a client-side script file from ../scripts/
 */
const fs = require("node:fs");
const path = require("node:path");

function loadScript(name) {
  return fs.readFileSync(path.join(__dirname, "..", "scripts", name), "utf8");
}

module.exports = { loadScript };
