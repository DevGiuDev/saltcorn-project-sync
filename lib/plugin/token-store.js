const crypto = require("node:crypto");
const { optionalRequire } = require("../tenant-adapters");

const TABLE = "_sc_ps_api_tokens";
let activeTokens = [];

function getDb() {
  return optionalRequire(["@saltcorn/data/db", "@saltcorn/data/dist/db"]);
}

async function ensureTokenTable(db = getDb()) {
  await db.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    token_salt TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
  )`);
}

function digestToken(token, salt) {
  return crypto.createHash("sha256").update(salt).update("\0").update(token).digest("hex");
}

function safeEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function setTokenCache(rows = []) {
  activeTokens = rows
    .filter((row) => !row.revoked_at)
    .map((row) => ({ id: row.id, salt: row.token_salt, hash: row.token_hash }));
}

async function loadTokenCache(db = getDb()) {
  await ensureTokenTable(db);
  const result = await db.query(`SELECT id, token_salt, token_hash, revoked_at FROM ${TABLE}`);
  setTokenCache(result.rows || result);
  return activeTokens.length;
}

function verifyStoredToken(token) {
  if (!token || typeof token !== "string") return false;
  return activeTokens.some((entry) => safeEqualHex(digestToken(token, entry.salt), entry.hash));
}

function sanitizeTokenName(value) {
  const name = String(value || "CLI token").trim();
  if (!name || name.length > 120 || /[\0\r\n]/.test(name)) throw new Error("invalid token name");
  return name;
}

async function generateToken(name, db = getDb()) {
  await ensureTokenTable(db);
  const token = `scps_${crypto.randomBytes(32).toString("base64url")}`;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = digestToken(token, salt);
  const result = await db.query(
    `INSERT INTO ${TABLE} (name, token_prefix, token_salt, token_hash) VALUES ($1, $2, $3, $4)
     RETURNING id, name, token_prefix, created_at, revoked_at`,
    [sanitizeTokenName(name), token.slice(0, 12), salt, hash]
  );
  await loadTokenCache(db);
  const row = (result.rows || result)[0];
  return { ...row, token };
}

async function listTokens(db = getDb()) {
  await ensureTokenTable(db);
  const result = await db.query(`SELECT id, name, token_prefix, created_at, revoked_at FROM ${TABLE} ORDER BY id DESC`);
  return result.rows || result;
}

async function revokeToken(id, db = getDb()) {
  await ensureTokenTable(db);
  const result = await db.query(`UPDATE ${TABLE} SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 RETURNING id, name, token_prefix, created_at, revoked_at`, [id]);
  await loadTokenCache(db);
  return (result.rows || result)[0] || null;
}

module.exports = {
  TABLE,
  ensureTokenTable,
  digestToken,
  setTokenCache,
  loadTokenCache,
  verifyStoredToken,
  generateToken,
  listTokens,
  revokeToken,
};
