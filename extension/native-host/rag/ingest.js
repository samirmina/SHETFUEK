const fs = require('fs');
const path = require('path');
const ollama = require('../ollama_client');
const store = require('./store');
const logger = require('../logs/logger');

const SOP_DATA_PATH = path.resolve(__dirname, '..', '..', 'sop-data.json');
const FULL_MACROS_PATH = path.resolve(__dirname, '..', '..', 'Full Macros.json');
const REFERENCE_PATH = path.resolve(__dirname, '..', '..', 'SOP_Reference_Macros_IssueTypes.json');
const EMBEDDING_MODEL = 'mxbai-embed-large';
const MAX_CHUNK_CHARS = 2000;

function loadJson(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    logger.log({ phase: 'ingest', step: 'loadJson', status: 'error', error: e.message, file: path.basename(filePath) });
    return null;
  }
}

function loadFullMacros(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const macros = {};
    const lines = text.split(/\r?\n/);
    let current = null;
    let bodyLines = [];
    for (const line of lines) {
      if (current === null) {
        if (line.startsWith('{') && line.length > 1) {
          current = line.slice(1).trim();
          bodyLines = [];
        }
        continue;
      }
      if (line.endsWith('}')) {
        bodyLines.push(line.slice(0, -1));
        const title = current;
        const id = title.replace(/::/g, '_').replace(/[^a-zA-Z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
        if (id) {
          macros[id] = { id: id, title: title, body: bodyLines.join('\n').trim(), incomplete: false, variants: {} };
        }
        current = null;
        bodyLines = [];
        continue;
      }
      bodyLines.push(line);
    }
    return { macros: macros };
  } catch (e) {
    logger.log({ phase: 'ingest', step: 'loadFullMacros', status: 'error', error: e.message, file: path.basename(filePath) });
    return null;
  }
}

function chunkSopData(sopData) {
  const chunks = [];
  if (!sopData || !sopData.sops) return chunks;
  for (const sop of sopData.sops) {
    const sopText = 'SOP: ' + (sop.sopName || '') + '. Page: ' + (sop.pageLink || '') +
      '. Issue types: ' + (sop.issueTypes || []).join(', ') +
      '. Macros: ' + (sop.macros || []).join(', ') + '.';
    chunks.push({ id: 'sop_' + (sop.sopName || '').replace(/[^a-zA-Z0-9]/g, '_'), text: sopText.slice(0, MAX_CHUNK_CHARS), type: 'sop' });
  }
  return chunks;
}

function chunkIssueTypes(sopData) {
  const chunks = [];
  if (!sopData || !sopData.issueTypes) return chunks;
  for (const it of sopData.issueTypes) {
    const rules = it.rules || {};
    const subjectKw = (rules.subjectKeywords || []).join(', ');
    const bodyKw = (rules.bodyKeywords || []).join(', ');
    const tags = (rules.zendeskTags || []).join(', ');
    const fm = (rules.fmFlags || []).join(', ');
    const related = (it.relatedMacros || []).join(', ');
    const text = 'Issue type: ' + (it.id || '') + '. Name: ' + (it.name || '') +
      '. Rules - subject keywords: ' + subjectKw + '; body keywords: ' + bodyKw +
      '; zendesk tags: ' + tags + '; fm flags: ' + fm +
      '. Related macros: ' + related + '. Default macro: ' + (it.macroId || '') +
      '. Admin note template: ' + (it.adminNoteTemplate || '') +
      '. Supplement blocks: ' + JSON.stringify(it.supplementBlocks || []) + '.';
    chunks.push({ id: it.id, text: text.slice(0, MAX_CHUNK_CHARS), type: 'issueType' });
  }
  return chunks;
}

function chunkMacros(sopData, fullMacros) {
  const chunks = [];
  const macroMap = fullMacros && fullMacros.macros ? fullMacros.macros : {};
  const seen = new Set();

  function addMacro(id) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const macro = macroMap[id] || {};
    const title = macro.title || '';
    let body = macro.body || '';
    if (!body && title) {
      body = title;
    }
    const text = 'Macro: ' + id + '. Title: ' + title + '. Body: ' + body.slice(0, 2000) + '.';
    chunks.push({ id: id, text: text.slice(0, MAX_CHUNK_CHARS), type: 'macro' });
  }

  if (sopData && sopData.sops && Array.isArray(sopData.sops)) {
    for (const sop of sopData.sops) {
      if (sop.macros && Array.isArray(sop.macros)) {
        for (const id of sop.macros) addMacro(id);
      }
    }
  }

  if (sopData && sopData.issueTypes && Array.isArray(sopData.issueTypes)) {
    for (const it of sopData.issueTypes) {
      if (it.macroId) addMacro(it.macroId);
      if (it.relatedMacros && Array.isArray(it.relatedMacros)) {
        for (const id of it.relatedMacros) addMacro(id);
      }
    }
  }

  for (const id of Object.keys(macroMap)) {
    addMacro(id);
  }

  return chunks;
}

async function embed(text) {
  try {
    const result = await ollama.embeddings(text, EMBEDDING_MODEL);
    if (result && Array.isArray(result)) return result;
    return null;
  } catch (e) {
    logger.log({ phase: 'ingest', step: 'embed', status: 'error', error: e.message });
    return null;
  }
}

async function buildIndex(force) {
  const start = Date.now();
  logger.log({ phase: 'ingest', step: 'start', status: 'start' });

  const sopData = loadJson(SOP_DATA_PATH);
  if (!sopData) return { success: false, error: 'Failed to load sop-data.json' };

  const fullMacros = loadFullMacros(FULL_MACROS_PATH);
  const reference = loadJson(REFERENCE_PATH);

  const sourceMtimes = {
    sop: fs.existsSync(SOP_DATA_PATH) ? fs.statSync(SOP_DATA_PATH).mtimeMs : 0,
    macros: fs.existsSync(FULL_MACROS_PATH) ? fs.statSync(FULL_MACROS_PATH).mtimeMs : 0,
    reference: fs.existsSync(REFERENCE_PATH) ? fs.statSync(REFERENCE_PATH).mtimeMs : 0
  };

  const meta = store.readMeta();
  const needsRebuild = force || !meta || meta.sourceMtimes.sop !== sourceMtimes.sop || meta.sourceMtimes.macros !== sourceMtimes.macros || meta.sourceMtimes.reference !== sourceMtimes.reference;

  if (!needsRebuild) {
    logger.log({ phase: 'ingest', step: 'skip', status: 'success', durationMs: Date.now() - start, message: 'Index up to date' });
    return { success: true, skipped: true, durationMs: Date.now() - start };
  }

  const chunks = [].concat(chunkSopData(sopData), chunkIssueTypes(sopData), chunkMacros(sopData, fullMacros));
  logger.log({ phase: 'ingest', step: 'chunked', status: 'success', durationMs: Date.now() - start, chunksCount: chunks.length });

  const entries = [];
  let embedded = 0;
  let failed = 0;
  for (const chunk of chunks) {
    const vec = await embed(chunk.text);
    if (vec) {
      entries.push({ id: chunk.id, text: chunk.text, type: chunk.type, vector: vec });
      embedded++;
    } else {
      failed++;
    }
  }

  store.replaceAll(entries);
  store.writeMeta({ builtAt: Date.now(), sourceMtimes: sourceMtimes, totalChunks: entries.length, embeddingModel: EMBEDDING_MODEL });

  const durationMs = Date.now() - start;
  logger.log({ phase: 'ingest', step: 'complete', status: 'success', durationMs: durationMs, embedded: embedded, failed: failed, totalChunks: entries.length });
  return { success: true, skipped: false, embedded: embedded, failed: failed, totalChunks: entries.length, durationMs: durationMs };
}

async function ensureIndex() {
  return buildIndex(false);
}

function getMeta() {
  return store.readMeta();
}

let lastQueryText = null;
let lastQueryScores = [];
let lastQueryTopK = 0;

async function query(text, topK) {
  topK = topK || 5;
  if (!text || !text.trim()) return [];
  // Truncate text to prevent Ollama embedding context length overflow
  const maxEmbeddingText = 4000;
  const truncatedText = text.trim().slice(0, maxEmbeddingText);
  const vec = await embed(truncatedText);
  if (!vec) return [];
  const results = store.query(vec, topK);
  lastQueryText = text.trim();
  lastQueryScores = results.map(function(r) { return r.score; });
  lastQueryTopK = topK;
  return results;
}

function getLastQuery() {
  return { text: lastQueryText, scores: lastQueryScores, topK: lastQueryTopK };
}

module.exports = { buildIndex: buildIndex, ensureIndex: ensureIndex, getMeta: getMeta, query: query, getLastQuery: getLastQuery, run: buildIndex };
