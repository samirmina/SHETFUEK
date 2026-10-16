const fs = require('fs');
const path = require('path');
const ollama = require('./ollama_client');
const rag = require('./rag/ingest');
const prompt = require('./rag/prompt');
const cache = require('./cache/ticket_cache');
const logger = require('./logs/logger');

logger.log({ phase: 'host', step: 'startup', status: 'start', ts: new Date().toISOString(), pid: process.pid });

const INPUT_SIZE_LIMIT = 8000;

function readExact(bytesNeeded) {
  return new Promise(function(resolve, reject) {
    const buf = Buffer.alloc(bytesNeeded);
    let totalRead = 0;

    function onData(chunk) {
      const copy = chunk;
      const remaining = bytesNeeded - totalRead;
      if (copy.length <= remaining) {
        copy.copy(buf, totalRead);
        totalRead += copy.length;
      } else {
        copy.copy(buf, totalRead, 0, remaining);
        totalRead = bytesNeeded;
        process.stdin.off('data', onData);
        process.stdin.off('end', onEnd);
        process.stdin.off('error', onError);
        if (totalRead < bytesNeeded) {
          return reject(new Error('Short read: expected ' + bytesNeeded + ' got ' + totalRead));
        }
        return resolve(buf);
      }
      if (totalRead >= bytesNeeded) {
        process.stdin.off('data', onData);
        process.stdin.off('end', onEnd);
        process.stdin.off('error', onError);
        return resolve(buf);
      }
    }

    function onEnd() {
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      if (totalRead < bytesNeeded) {
        return reject(new Error('Unexpected EOF: expected ' + bytesNeeded + ' bytes, got ' + totalRead));
      }
      return resolve(buf);
    }

    function onError(err) {
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      return reject(new Error('Stream error: ' + (err && err.message ? err.message : String(err))));
    }

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
  });
}

function readMessage() {
  return readExact(4).then(function(lengthBuf) {
    const msgLength = lengthBuf.readUInt32LE(0);
    if (msgLength === 0) return null;
    if (msgLength > 10 * 1024 * 1024) {
      throw new Error('Message too large: ' + msgLength);
    }
    return readExact(msgLength).then(function(bodyBuf) {
      const text = bodyBuf.toString('utf8');
      try { return JSON.parse(text); }
      catch (e) { throw new Error('JSON parse error: ' + e.message); }
    });
  });
}

function writeMessage(obj) {
  const text = JSON.stringify(obj);
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
  process.stdout.write(''); // flush
}

function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return null;
  const out = {};
  for (const key of Object.keys(context)) {
    if (key === 'body' || key === 'fullText' || key === 'rawText' || key === 'publicReply' || key === 'internalNote') {
      out[key] = typeof context[key] === 'string' ? context[key].slice(0, INPUT_SIZE_LIMIT) : context[key];
    } else if (key === 'structured') {
      out[key] = sanitizeContext(context[key]);
    } else {
      out[key] = context[key];
    }
  }
  return out;
}

async function classify(ticketContext, fmContext, options) {
  options = options || {};
  const ticketId = (ticketContext && ticketContext.ticketId) ? String(ticketContext.ticketId) : 'unknown';
  const model = options.model || ollama.DEFAULT_MODEL;
  const topK = options.topK || 5;
  const useCache = options.useCache !== false;

  const phaseStart = Date.now();
  logger.log({ ticketId: ticketId, phase: 'classify', step: 'start', status: 'start', model: model, topK: topK, useCache: useCache });

  const sanitizedTicket = sanitizeContext(ticketContext);
  const sanitizedFm = sanitizeContext(fmContext);

  if (useCache) {
    const cached = cache.get(sanitizedTicket);
    if (cached && cached.result) {
      logger.log({ ticketId: ticketId, phase: 'cache', step: 'hit', status: 'success', durationMs: 0 });
      return Object.assign({}, cached.result, { fromCache: true });
    }
    logger.log({ ticketId: ticketId, phase: 'cache', step: 'miss', status: 'success', durationMs: 0 });
  }

  logger.log({ ticketId: ticketId, phase: 'scrape', step: 'contextReady', status: 'success', ticketBodyLength: (sanitizedTicket && sanitizedTicket.body) ? sanitizedTicket.body.length : 0, fmRawLength: (sanitizedFm && sanitizedFm.rawText) ? sanitizedFm.rawText.length : 0, fmPageType: (sanitizedFm && sanitizedFm.pageType) || 'none', fmFlagsCount: (sanitizedFm && sanitizedFm.flags) ? sanitizedFm.flags.length : 0 });

  let ragChunks = [];
  try {
    await rag.ensureIndex();
    const queryText = ((sanitizedTicket && sanitizedTicket.subject) || '') + ' ' + ((sanitizedTicket && sanitizedTicket.body) || '').slice(0, 3000);
    ragChunks = await rag.query(queryText, topK);
    const topScore = ragChunks.length > 0 ? ragChunks[0].score : 0;
    if (topScore < 0.58) {
      logger.log({ ticketId: ticketId, phase: 'rag', step: 'lowScore', status: 'warning', durationMs: Date.now() - phaseStart, topScore: topScore, ragChunksCount: ragChunks.length });
      const fallback = {
        issueTypeId: 'general_info',
        macroId: null,
        dispositions: ['clarification_needed'],
        confidence: 0.3,
        adminNotes: { issue: '', solution: '', other: '', supportingDocumentation: '' },
        reasoning: 'Top RAG score ' + topScore.toFixed(3) + ' below threshold 0.58; no reliable SOP match.',
        ragChunks: ragChunks.map(function(c) { return { id: c.id, score: c.score }; }),
        durationMs: Date.now() - phaseStart,
        model: model,
        fromCache: false
      };
      try { cache.set(sanitizedTicket, fallback); } catch (e) { /* ignore */ }
      return fallback;
    }
    logger.log({ ticketId: ticketId, phase: 'rag', step: 'query', status: 'success', durationMs: Date.now() - phaseStart, ragChunksCount: ragChunks.length, topScore: topScore, ragScores: ragChunks.map(function(c) { return c.score; }) });
    if (ragChunks.length === 0) {
      logger.log({ ticketId: ticketId, phase: 'rag', step: 'empty', status: 'warning', durationMs: Date.now() - phaseStart });
    }
    logger.debugRag(ticketId, { queryText: queryText.slice(0, 500), chunks: ragChunks });
  } catch (e) {
    logger.log({ ticketId: ticketId, phase: 'rag', step: 'error', status: 'error', durationMs: Date.now() - phaseStart, error: e.message });
    ragChunks = [];
  }

  const messages = prompt.buildPrompt(sanitizedTicket, sanitizedFm, ragChunks, ticketId);
  let ollamaResult = null;
  try {
    ollamaResult = await ollama.chat(messages, model);
    logger.log({ ticketId: ticketId, phase: 'ollama', step: 'chat', status: 'success', durationMs: ollamaResult.durationMs, model: ollamaResult.model, inputTokens: ollamaResult.inputTokens, outputTokens: ollamaResult.outputTokens });
  } catch (e) {
    logger.log({ ticketId: ticketId, phase: 'ollama', step: 'chat', status: 'error', durationMs: Date.now() - phaseStart, error: e.message });
    return {
      issueTypeId: 'general_info',
      macroId: null,
      dispositions: ['clarification_needed'],
      confidence: 0.3,
      adminNotes: { issue: '', solution: '', other: '', supportingDocumentation: '' },
      reasoning: 'Ollama call failed: ' + e.message,
      error: 'OLLAMA_UNREACHABLE',
      errorDetail: e.message,
      ragChunks: ragChunks.map(function(c) { return { id: c.id, score: c.score }; }),
      durationMs: Date.now() - phaseStart,
      model: model,
      fromCache: false
    };
  }

  const result = prompt.parseAndValidate(ollamaResult.content, ragChunks, ticketId);
  result.ragChunks = ragChunks.map(function(c) { return { id: c.id, score: c.score }; });
  result.durationMs = Date.now() - phaseStart;
  result.model = ollamaResult.model;
  result.inputTokens = ollamaResult.inputTokens;
  result.outputTokens = ollamaResult.outputTokens;
  result.fromCache = false;
  result.ollamaRaw = (ollamaResult.content || '').slice(0, 2000);

  const hasInvalidMacro = result.validationError && result.validationError.indexOf('INVALID_MACRO_ID') !== -1;
  const hasInvalidIssueType = result.validationError && result.validationError.indexOf('INVALID_ISSUE_TYPE_ID') !== -1;
  if (result.parseError || (result.validationError && !hasInvalidMacro && !hasInvalidIssueType)) {
    result.error = 'LLM_OUTPUT_INVALID';
  }

  if (!result.error) {
    try { cache.set(sanitizedTicket, result); } catch (e) { /* cache errors are non-fatal */ }
  }

  logger.log({ ticketId: ticketId, phase: 'classify', step: 'complete', status: (!result.error) ? 'success' : 'error', durationMs: result.durationMs, issueTypeId: result.issueTypeId, macroId: result.macroId, dispositions: result.dispositions, confidence: result.confidence, error: result.error || null });
  return result;
}

async function handleMessage(message) {
  const action = (message && message.action) || '';

  if (action === 'classify') {
    const ticketContext = (message && message.ticketContext) || null;
    const fmContext = (message && message.fmContext) || null;
    const options = (message && message.options) || {};
    const result = await classify(ticketContext, fmContext, options);
    return { success: true, data: result };
  }

  if (action === 'ping') {
    return { success: true, data: { pong: true, model: ollama.DEFAULT_MODEL } };
  }

  if (action === 'ingest') {
    const force = (message && message.force) || false;
    const result = await rag.buildIndex(force);
    return { success: true, data: result };
  }

  if (action === 'cacheStats') {
    return { success: true, data: cache.stats() };
  }

  if (action === 'clearCache') {
    cache.clear();
    return { success: true, data: { cleared: true } };
  }

  return { success: false, error: 'UNKNOWN_ACTION: ' + action };
}

async function main() {
  let msg = null;
  try {
    msg = await readMessage();
  } catch (e) {
    logger.log({ phase: 'host', step: 'readMessage', status: 'error', error: e.message });
    try { writeMessage({ success: false, error: 'HOST_READ_ERROR: ' + e.message }); } catch (e2) { /* ignore */ }
    process.exit(1);
  }
  if (!msg) {
    process.exit(0);
  }

  let res = null;
  try {
    res = await handleMessage(msg);
  } catch (e) {
    logger.log({ phase: 'host', step: 'handleMessage', status: 'error', error: e.message });
    res = { success: false, error: 'HOST_HANDLE_ERROR: ' + e.message };
  }

  try { writeMessage(res); } catch (e) { /* ignore */ }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { classify: classify, handleMessage: handleMessage, main: main };
