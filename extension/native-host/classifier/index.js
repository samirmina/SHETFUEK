/**
 * Main classifier pipeline
 */

const ollama = require('../ollama_client');
const rag = require('../rag/ingest');
const prompt = require('../prompt');
const { parseAndValidate, buildFallbackResult } = require('./validate');
const { buildRetryPrompt } = require('./retry');
const cache = require('../cache/ticket_cache');
const logger = require('../logs/logger');
const { sanitizeForLog } = require('../../shared/utils');
const { RAG_CONFIG, LLM_CONFIG } = require('../../shared/constants');

const INPUT_SIZE_LIMIT = 8000;

function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return null;
  const out = {};
  for (const key of Object.keys(context)) {
    if (['body', 'fullText', 'rawText', 'publicReply', 'internalNote'].includes(key)) {
      out[key] = typeof context[key] === 'string' ? context[key].slice(0, INPUT_SIZE_LIMIT) : context[key];
    } else if (key === 'structured') {
      out[key] = sanitizeContext(context[key]);
    } else {
      out[key] = context[key];
    }
  }
  return out;
}

async function classify(ticketContext, fmContext, options = {}) {
  const ticketId = (ticketContext && ticketContext.ticketId) ? String(ticketContext.ticketId) : 'unknown';
  const model = options.model || LLM_CONFIG.defaultModel;
  const topK = options.topK || RAG_CONFIG.topK;
  const useCache = options.useCache !== false;
  const userDispositions = options.userDispositions || null;
  
  // Check cache
  if (useCache && !options.skipCache) {
    const cached = cache.get(sanitizeContext(ticketContext));
    if (cached && cached.result) {
      return Object.assign({}, cached.result, { fromCache: true });
    }
  }
  
  const sanitizedTicket = sanitizeContext(ticketContext);
  const sanitizedFm = sanitizeContext(fmContext);
  const allMacroBodies = options.allMacroBodies || null;
  
  // Query RAG
  let ragChunks = [];
  let topScore = 0;
  try {
    await rag.ensureIndex();
    const queryText = [
      sanitizedTicket?.subject || '',
      sanitizedTicket?.body || '',
      sanitizedTicket?.fullText || '',
      sanitizedTicket?.status || '',
      (sanitizedTicket?.tags || []).join(' '),
      sanitizedTicket?.requesterEmail || '',
      sanitizedTicket?.requesterPhone || '',
      sanitizedTicket?.userId || '',
      sanitizedTicket?.ivc || '',
      sanitizedTicket?.language || '',
      sanitizedTicket?.publicReply || '',
      sanitizedTicket?.internalNote || '',
      sanitizedTicket?.structured?.country || '',
      sanitizedTicket?.structured?.city || '',
      sanitizedTicket?.structured?.partner || '',
      sanitizedTicket?.structured?.compensation || '',
      sanitizedFm?.pageType || '',
      sanitizedFm?.entityId || '',
      (sanitizedFm?.flags || []).join(' '),
      sanitizedFm?.rawText || ''
    ].join(' ').slice(0, 4000);
    
    ragChunks = await rag.query(queryText, topK);
    topScore = ragChunks.length > 0 ? ragChunks[0].score : 0;
    if (topScore < RAG_CONFIG.minScore) {
      logger.log({ ticketId, phase: 'rag', step: 'lowScore', status: 'warning', topScore, ragChunksCount: ragChunks.length });
    }
  } catch (e) {
    ragChunks = [];
  }
  
  // Build prompts
  const issueTypeRagChunks = ragChunks.filter(c => c.type === 'issueType');
  const messages = prompt.buildPrompt(sanitizedTicket, sanitizedFm, issueTypeRagChunks, ticketId, allMacroBodies, userDispositions);
  
  // Add weak RAG score note
  if (topScore >= RAG_CONFIG.minScore && topScore < RAG_CONFIG.weakScoreThreshold) {
    messages.unshift({
      role: 'system',
      content: `NOTE: RAG match is weak (score: ${topScore.toFixed(3)}). The provided SOP chunks may not be fully relevant. The full issue type catalog is also provided below. Pick the best-matching issue type and assign confidence proportionally to evidence strength (${RAG_CONFIG.minScore}-${RAG_CONFIG.weakScoreThreshold} range).`
    });
  }
  
  // OLLAMA chat with retry
  let ollamaResult = null;
  let result = null;
  let attempt = 0;
  const maxAttempts = LLM_CONFIG.maxAttempts;
  let lastValidationError = null;
  
  do {
    attempt++;
    if (attempt > 1) {
      const originalSystemMsg = messages.find(m => m.role === 'system') || { role: 'system', content: '' };
      const retryMessages = [
        originalSystemMsg,
        { role: 'user', content: buildRetryPrompt(lastValidationError?.ollamaRaw || '', lastValidationError, sanitizedTicket, userDispositions) }
      ];
      ollamaResult = await ollama.chat(retryMessages, model);
    } else {
      ollamaResult = await ollama.chat(messages, model);
    }
    
    result = parseAndValidate(ollamaResult.content, ragChunks, ticketId, sanitizedTicket, userDispositions);
    lastValidationError = result.validationError ? { ...result, ollamaRaw: (ollamaResult.content || '').slice(0, 2000) } : null;
    
    if (!result.validationError || attempt >= maxAttempts) {
      break;
    }
  } while (attempt < maxAttempts);
  
  result.ragChunks = ragChunks.map(c => ({ id: c.id, score: c.score }));
  result.durationMs = 0;
  result.model = ollamaResult.model;
  result.inputTokens = ollamaResult.inputTokens;
  result.outputTokens = ollamaResult.outputTokens;
  result.fromCache = false;
  result.ollamaRaw = (ollamaResult.content || '').slice(0, 2000);
  
  const hasInvalidMacro = result.validationError && result.validationError.includes('INVALID_MACRO_ID');
  const hasInvalidIssueType = result.validationError && result.validationError.includes('INVALID_ISSUE_TYPE_ID');
  if (result.parseError || (result.validationError && !hasInvalidMacro && !hasInvalidIssueType)) {
    result.error = 'LLM_OUTPUT_INVALID';
  }
  
  if (!result.error) {
    try { cache.set(sanitizedTicket, result); } catch (e) {}
  }
  
  return result;
}

module.exports = {
  classify,
  sanitizeContext
};