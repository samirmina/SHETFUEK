const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.resolve(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'ticket_cache.jsonl');
const MAX_ENTRIES = 50;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readAll() {
  ensureCacheDir();
  if (!fs.existsSync(CACHE_FILE)) return [];
  const lines = fs.readFileSync(CACHE_FILE, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch (e) { /* skip corrupt lines */ }
  }
  return entries;
}

function writeAll(entries) {
  ensureCacheDir();
  const data = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(CACHE_FILE, data, 'utf8');
}

function getTicketId(ticketContext) {
  return (ticketContext && ticketContext.ticketId) ? String(ticketContext.ticketId) : null;
}

function get(ticketContext) {
  const ticketId = getTicketId(ticketContext);
  if (!ticketId) return null;
  const entries = readAll();
  const now = Date.now();
  const valid = entries.filter(function(e) {
    return e.ticketId === ticketId && (now - e.cachedAt) < TTL_MS;
  });
  if (valid.length === 0) return null;
  valid.sort(function(a, b) { return b.cachedAt - a.cachedAt; });
  return valid[0];
}

function set(ticketContext, result) {
  const ticketId = getTicketId(ticketContext);
  if (!ticketId) return;
  let entries = readAll();
  entries = entries.filter(function(e) { return e.ticketId !== ticketId; });
  entries.push({
    ticketId: ticketId,
    cachedAt: Date.now(),
    ticketContext: ticketContext,
    result: result
  });
  while (entries.length > MAX_ENTRIES) entries.shift();
  writeAll(entries);
}

function clear() {
  ensureCacheDir();
  try { fs.writeFileSync(CACHE_FILE, '', 'utf8'); } catch (e) { /* ignore */ }
}

function stats() {
  const entries = readAll();
  return { total: entries.length, max: MAX_ENTRIES, ttlMs: TTL_MS };
}

module.exports = { get: get, set: set, clear: clear, stats: stats };
