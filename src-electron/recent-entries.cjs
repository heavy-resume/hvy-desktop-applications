const path = require('node:path');

const RECENT_LIMIT = 12;

/** Newest first: the entry just opened goes to the front, any earlier copy of it is dropped. */
function pushRecent(entries, entryPath) {
  const normalized = path.resolve(entryPath);
  return [normalized, ...entries.filter((entry) => path.resolve(entry) !== normalized)].slice(0, RECENT_LIMIT);
}

module.exports = { RECENT_LIMIT, pushRecent };
