/**
 * Minimal ZIP file generator — zero external dependencies.
 * Uses Node.js built-in zlib for deflate compression.
 * Generates a valid ZIP with files from an in-memory map.
 */

const zlib = require("node:zlib");

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeU16(buf, offset, val) { buf[offset] = val & 0xFF; buf[offset + 1] = (val >> 8) & 0xFF; }
function writeU32(buf, offset, val) { buf[offset] = val & 0xFF; buf[offset + 1] = (val >> 8) & 0xFF; buf[offset + 2] = (val >> 16) & 0xFF; buf[offset + 3] = (val >> 24) & 0xFF; }

/**
 * Generate a ZIP buffer from a map of { "path/to/file": "content" | Buffer }.
 * @param {Object<string, string|Buffer>} files
 * @returns {Buffer}
 */
function zipToBuffer(files) {
  const entries = [];
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const compressed = zlib.deflateRawSync(raw);
    // Use stored if compression doesn't help
    const useCompressed = compressed.length < raw.length;
    entries.push({
      name: Buffer.from(name, "utf8"),
      raw,
      compressed: useCompressed ? compressed : raw,
      method: useCompressed ? 8 : 0, // 8=deflate, 0=stored
      crc: crc32(raw),
      size: raw.length,
      compressedSize: useCompressed ? compressed.length : raw.length,
    });
  }

  // Calculate total size
  let offset = 0;
  for (const e of entries) {
    e.localHeaderOffset = offset;
    offset += 30 + e.name.length + e.compressed.length;
  }
  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const e of entries) {
    centralDirSize += 46 + e.name.length;
  }
  const totalSize = centralDirStart + centralDirSize + 22;

  const buf = Buffer.alloc(totalSize);
  let pos = 0;

  // Local file headers + data
  for (const e of entries) {
    writeU32(buf, pos, 0x04034b50); pos += 4;  // signature
    writeU16(buf, pos, 20); pos += 2;           // version needed
    writeU16(buf, pos, 0); pos += 2;            // flags
    writeU16(buf, pos, e.method); pos += 2;     // compression
    writeU16(buf, pos, 0); pos += 2;            // mod time
    writeU16(buf, pos, 0); pos += 2;            // mod date
    writeU32(buf, pos, e.crc); pos += 4;
    writeU32(buf, pos, e.compressedSize); pos += 4;
    writeU32(buf, pos, e.size); pos += 4;
    writeU16(buf, pos, e.name.length); pos += 2;
    writeU16(buf, pos, 0); pos += 2;            // extra length
    e.name.copy(buf, pos); pos += e.name.length;
    e.compressed.copy(buf, pos); pos += e.compressed.length;
  }

  // Central directory
  for (const e of entries) {
    writeU32(buf, pos, 0x02014b50); pos += 4;  // signature
    writeU16(buf, pos, 20); pos += 2;           // version made by
    writeU16(buf, pos, 20); pos += 2;           // version needed
    writeU16(buf, pos, 0); pos += 2;            // flags
    writeU16(buf, pos, e.method); pos += 2;
    writeU16(buf, pos, 0); pos += 2;            // mod time
    writeU16(buf, pos, 0); pos += 2;            // mod date
    writeU32(buf, pos, e.crc); pos += 4;
    writeU32(buf, pos, e.compressedSize); pos += 4;
    writeU32(buf, pos, e.size); pos += 4;
    writeU16(buf, pos, e.name.length); pos += 2;
    writeU16(buf, pos, 0); pos += 2;            // extra length
    writeU16(buf, pos, 0); pos += 2;            // comment length
    writeU16(buf, pos, 0); pos += 2;            // disk number
    writeU16(buf, pos, 0); pos += 2;            // internal attrs
    writeU32(buf, pos, 0); pos += 4;            // external attrs
    writeU32(buf, pos, e.localHeaderOffset); pos += 4;
    e.name.copy(buf, pos); pos += e.name.length;
  }

  // End of central directory
  writeU32(buf, pos, 0x06054b50); pos += 4;
  writeU16(buf, pos, 0); pos += 2;              // disk number
  writeU16(buf, pos, 0); pos += 2;              // disk with CD
  writeU16(buf, pos, entries.length); pos += 2; // entries on disk
  writeU16(buf, pos, entries.length); pos += 2; // total entries
  writeU32(buf, pos, centralDirSize); pos += 4;
  writeU32(buf, pos, centralDirStart); pos += 4;
  writeU16(buf, pos, 0); pos += 2;              // comment length

  return buf;
}

module.exports = { zipToBuffer };
