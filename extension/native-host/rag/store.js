const fs = require('fs');
const path = require('path');

const STORE_DIR = path.resolve(__dirname, '..', 'cache');
const EMBEDDINGS_FILE = path.join(STORE_DIR, 'embeddings.jsonl');
const METADATA_FILE = path.join(STORE_DIR, 'index_meta.json');

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function readEntries() {
  ensureStoreDir();
  if (!fs.existsSync(EMBEDDINGS_FILE)) return [];
  const text = fs.readFileSync(EMBEDDINGS_FILE, 'utf8');
  return text.split('\n').filter(Boolean).map(function(line) {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

function readMeta() {
  ensureStoreDir();
  if (!fs.existsSync(METADATA_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8')); }
  catch (e) { return null; }
}

function writeMeta(meta) {
  ensureStoreDir();
  fs.writeFileSync(METADATA_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

function writeEntries(entries) {
  ensureStoreDir();
  const text = entries.map(function(e) { return JSON.stringify(e); }).join('\n') + '\n';
  fs.writeFileSync(EMBEDDINGS_FILE, text, 'utf8');
}

function query(queryVector, topK, filterIds) {
  topK = topK || 5;
  filterIds = filterIds || [];
  const filterSet = new Set(filterIds.map(String));
  const entries = readEntries();
  const scored = [];
  for (const entry of entries) {
    if (!entry.vector || !Array.isArray(entry.vector)) continue;
    if (filterSet.size > 0 && !filterSet.has(String(entry.id))) continue;
    const sim = cosineSim(queryVector, entry.vector);
    scored.push({ id: entry.id, score: sim, text: entry.text || '', type: entry.type || '' });
  }
  scored.sort(function(a, b) { return b.score - a.score; });
  return scored.slice(0, topK);
}

function appendEntry(entry) {
  ensureStoreDir();
  const line = JSON.stringify(entry);
  fs.appendFileSync(EMBEDDINGS_FILE, line + '\n', 'utf8');
}

function replaceAll(entries) {
  ensureStoreDir();
  writeEntries(entries);
}

module.exports = {
  query: query,
  appendEntry: appendEntry,
  replaceAll: replaceAll,
  readMeta: readMeta,
  writeMeta: writeMeta,
  cosineSim: cosineSim
};
