function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const v = value[key];
        if (v !== undefined) acc[key] = sortValue(v);
        return acc;
      }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function parseJson(text, source = "JSON") {
  try {
    return JSON.parse(text);
  } catch (err) {
    err.message = `${source}: ${err.message}`;
    throw err;
  }
}

module.exports = { sortValue, canonicalStringify, parseJson };
