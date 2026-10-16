const fs = require('fs');
const path = require('path');
const logger = require('../logs/logger');

const ALLOWED_DISPOSITIONS = ['customer_favorable', 'system_favorable', 'clarification_needed', 'wrong_email'];
const MAX_TICKET_BODY_CHARS = 2000;
const MAX_RAG_CHUNKS = 5;
const SOP_DATA_PATH = path.resolve(__dirname, '..', '..', 'sop-data.json');

let cachedSopData = null;
function getSopData() {
  if (cachedSopData) return cachedSopData;
  try {
    cachedSopData = JSON.parse(fs.readFileSync(SOP_DATA_PATH, 'utf8'));
  } catch (e) {
    cachedSopData = null;
  }
  return cachedSopData;
}

// Simple heuristic to detect if text is primarily English
// Returns true if text appears to be English (contains common English words, low non-ASCII ratio)
function isEnglishText(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  
  // Count non-ASCII characters (common in French, German, etc.)
  let nonAsciiCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) > 127) nonAsciiCount++;
  }
  const nonAsciiRatio = nonAsciiCount / trimmed.length;
  
  // Check for common English words
  const englishWords = /\b(the|and|or|but|is|are|was|were|has|have|had|will|would|could|should|this|that|with|from|for|about|into|through|during|before|after|above|below|between|among|under|over|again|further|then|once|here|there|when|where|why|how|all|any|both|each|few|more|most|other|some|such|only|own|same|than|too|very|can|just|now|also|even|still|may|must|might|need|shall|will)\b/i;
  const hasEnglishWords = englishWords.test(trimmed);
  
  // Check for common French words (to detect French admin notes)
  const frenchWords = /\b(le|la|les|un|une|des|du|de|et|ou|mais|est|sont|était|étaient|a|ont|avait|aurait|devrait|ce|cette|ces|avec|pour|sur|dans|sous|entre|par|pour|comme|que|qui|dont|où|quand|comment|pourquoi|très|plus|moins|aussi|donc|alors|maintenant|ici|là|tout|tous|chaque|plusieurs|certain|certain|même|autre|tel|telle|tels|telles)\b/i;
  const hasFrenchWords = frenchWords.test(trimmed);
  
  // If high non-ASCII ratio and French words detected, likely not English
  if (nonAsciiRatio > 0.15 && hasFrenchWords) return false;
  
  // If has English words and low non-ASCII, likely English
  if (hasEnglishWords && nonAsciiRatio < 0.1) return true;
  
// Default: allow if unsure (conservative)
  return true;
}

function sanitizeForLog(obj) {
  if (!obj) return obj;
  try {
    const clone = JSON.parse(JSON.stringify(obj));
    if (clone.ollamaRaw && clone.ollamaRaw.length > 1000) clone.ollamaRaw = clone.ollamaRaw.slice(0, 1000) + '...';
    if (clone.rawResponse && clone.rawResponse.length > 1000) clone.rawResponse = clone.rawResponse.slice(0, 1000) + '...';
    return clone;
  } catch (e) {
    return obj;
  }
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (e2) {
        logger.log({ phase: 'prompt', step: 'extractJson', status: 'error', error: e2.message, textPreview: trimmed.slice(0, 100) });
        return null;
      }
    }
    logger.log({ phase: 'prompt', step: 'extractJson', status: 'error', error: e.message, textPreview: trimmed.slice(0, 100) });
    return null;
  }
}

function normalizeMacroId(rawId) {
  if (!rawId) return null;
  return String(rawId)
    .replace(/::/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function isChatMacroId(id) {
  return /^livechat/i.test(String(id || '')) || /^live_chat/i.test(String(id || ''));
}

function findClosestIssueType(invalidId, ticketContext, sopData) {
  if (!sopData || !sopData.issueTypes || !Array.isArray(sopData.issueTypes)) return null;
  const validIds = sopData.issueTypes.map(it => it.id).filter(Boolean);
  if (validIds.length === 0) return null;
  
  const invalidLower = invalidId.toLowerCase();
  const ticketText = ticketContext ? ((ticketContext.subject || '') + ' ' + (ticketContext.body || '')).toLowerCase() : '';
  
  // Category-based mapping: extract category prefix from invalid ID (e.g., 'payments_' from 'payments_debtinrelatedaccount')
  const categoryMatch = invalidLower.match(/^([a-z]+)_/);
  const category = categoryMatch ? categoryMatch[1] : null;
  
  // Filter valid IDs by category if detected
  let candidates = validIds;
  if (category) {
    const categoryCandidates = validIds.filter(id => id.toLowerCase().startsWith(category + '_'));
    if (categoryCandidates.length > 0) candidates = categoryCandidates;
  }
  
  // Score candidates based on keyword overlap with ticket text and invalid ID
  let bestMatch = null;
  let bestScore = -1;
  
  for (const validId of candidates) {
    let score = 0;
    const validLower = validId.toLowerCase();
    
    // Keyword overlap with invalid ID (e.g., 'debt' in both)
    const invalidKeywords = invalidLower.split(/[_\-]/);
    for (const kw of invalidKeywords) {
      if (kw.length > 2 && validLower.includes(kw)) score += 2;
    }
    
    // Keyword overlap with ticket text
    const ticketKeywords = ticketText.split(/[\s\-,\.]/);
    for (const kw of ticketKeywords) {
      if (kw.length > 3 && validLower.includes(kw)) score += 1;
    }
    
    // Prefer shorter, more specific IDs
    score -= validId.length * 0.01;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = validId;
    }
  }
  
  return bestMatch;
}

function buildSystemPrompt(sopData, ragChunks, ticketContext, fmContext, allMacroBodies, userDispositions) {
  const issueTypeRagChunks = (ragChunks || []).filter(function(c) { return c.type === 'issueType'; });
  const macroRagChunks = (ragChunks || []).filter(function(c) { return c.type === 'macro'; });
  const ragIds = issueTypeRagChunks.map(function(c) { return c.id; }).join(', ');
  
  // Extract categories from RAG chunks (both issueType and macro) to filter valid issue types
  const ragCategories = new Set();
  [...issueTypeRagChunks, ...macroRagChunks].forEach(function(c) {
    const catMatch = c.id.match(/^([a-z]+)_/);
    if (catMatch) ragCategories.add(catMatch[1]);
  });
  
  // Build list of valid issue type IDs for LLM guidance, filtered by RAG categories
  const allValidIssueTypes = sopData && sopData.issueTypes ? sopData.issueTypes.map(it => it.id).filter(Boolean) : [];
  let validIssueTypes = allValidIssueTypes;
  if (ragCategories.size > 0) {
    validIssueTypes = allValidIssueTypes.filter(function(id) {
      return Array.from(ragCategories).some(function(cat) { return id.toLowerCase().startsWith(cat + '_'); });
    });
    // Fallback to all if filtering leaves nothing
    if (validIssueTypes.length === 0) validIssueTypes = allValidIssueTypes;
  }
  const issueTypesList = validIssueTypes.length > 0 ? 
    'Valid issueTypeId values (prioritized by RAG relevance): ' + validIssueTypes.join(', ') + '\n' : 
    '';
  
  // Also include macro categories for reference
  const macroCategoriesList = ragCategories.size > 0 ? 
    'RAG-detected categories: ' + Array.from(ragCategories).join(', ') + '\n' : 
    '';
  
  // Minimum admin notes lengths — enforced by parseAndValidate
  const MIN_ISSUE = 100;
  const MIN_SOLUTION = 100;
  const MIN_OTHER = 50;
  const MIN_SUPPORTING = 50;
  
  // Extract helpful context for admin notes generation
  const ticketSummaryHint = ticketContext ? 
    `Ticket ID: ${ticketContext.ticketId || 'unknown'}, User ID: ${ticketContext.userId || 'none'}, ` +
    `IVC: ${ticketContext.ivc || 'none'}, Language: ${ticketContext.language || 'unknown'}` : 
    'No ticket context available';
  
  // Analyze ticket body for key topics to guide classification
  const ticketBody = ticketContext && ticketContext.body ? String(ticketContext.body).toLowerCase() : '';
  const topicHints = [];
  if (/\b(debt|owe|payment|charge|refund|eur|€|\$|money|bill|invoice)\b/i.test(ticketBody)) topicHints.push('PAYMENTS/DEBT');
  if (/\b(abandon|park|vehicle|scooter|bike)\b/i.test(ticketBody)) topicHints.push('PARKING/VEHICLE');
  if (/\b(login|password|account|access|verify)\b/i.test(ticketBody)) topicHints.push('ACCOUNT/LOGIN');
  if (/\b(ride|trip|journey|start|end|unlock)\b/i.test(ticketBody)) topicHints.push('RIDING');
  if (/\b(helmet|safety|accident|damage|broken)\b/i.test(ticketBody)) topicHints.push('HARDWARE/SAFETY');
  const topicHintStr = topicHints.length > 0 ? 'Ticket topics detected: ' + topicHints.join(', ') + '\n' : '';
  
  // User-selected dispositions — if provided, the LLM MUST use these and generate admin notes accordingly
  let userDispositionsStr = '';
  if (userDispositions && Array.isArray(userDispositions) && userDispositions.length > 0) {
    const validUserDispositions = userDispositions.filter(function(d) { return ALLOWED_DISPOSITIONS.indexOf(d) !== -1; });
    if (validUserDispositions.length > 0) {
      userDispositionsStr = 'USER-SELECTED DISPOSITIONS (MANDATORY — use these exact values in the "dispositions" field of your JSON response): ' + validUserDispositions.join(', ') + '\n' +
        'Generate admin notes (issue, solution, other, supportingDocumentation) that are CONSISTENT with the selected disposition(s).\n' +
        'Disposition guidance:\n' +
        '- customer_favorable: Resolution favors the customer (refund, credit, exception, waiver). Admin notes should reflect customer-friendly outcome.\n' +
        '- system_favorable: Resolution favors the system/company (policy enforcement, no refund, standard process). Admin notes should reflect company policy adherence.\n' +
        '- clarification_needed: More information required from customer. Admin notes should specify what clarification is needed.\n' +
        '- wrong_email: Ticket submitted to wrong queue/email. Admin notes should note misrouting and correct destination.\n';
    }
  }
  
  // Admin notes requirements — forcefully stated at the TOP of the system prompt
  const adminNotesRequirements = [
    'REQUIRED: issue must be a clear description of the problem, at least ' + MIN_ISSUE + ' characters.',
    'REQUIRED: solution must be a suggested resolution or next steps, at least ' + MIN_SOLUTION + ' characters.',
    'REQUIRED: other must contain additional case-specific context or user details, at least ' + MIN_OTHER + ' characters.',
    'REQUIRED: supportingDocumentation must briefly note user-provided evidence (screenshots, references, etc.), at least ' + MIN_SUPPORTING + ' characters.'
  ].join('\n');
  
  return adminNotesRequirements + '\n' +
    'You are a Zendesk ticket classifier. Return ONLY valid JSON matching this schema: {"issueTypeId":"string","macroId":"string","responseFormat":"chat|email","extractedLines":["string"],"greeting":"string|null","signOff":"string|null","dispositions":["customer_favorable","system_favorable","clarification_needed","wrong_email"],"confidence":0-1,"adminNotes":{"issue":"string","solution":"string","other":"string","supportingDocumentation":"string"},"reasoning":"string"}\n' +
    'Rules: never return "general_info" as issueTypeId. For live chat, responseFormat="chat", greeting=null, signOff=null. Otherwise email with greeting/signOff.\n' +
    // CRITICAL: Admin notes MUST be in English regardless of ticket language - internal teams use English
    'CRITICAL: adminNotes.issue, adminNotes.solution, adminNotes.other, and adminNotes.supportingDocumentation MUST be in English. Even if the ticket is in French or other languages, admin notes are for internal Zendesk teams who use English. Do NOT write admin notes in the ticket language.\n' +
    // CRITICAL: Choose the BEST matching issue type based on ticket content, not the first or default
    'CRITICAL: Analyze the CUSTOMER MESSAGE (the ticket body) and select the MOST RELEVANT issue type from the valid list provided. Do not choose a default or first item. Match the issue type that best describes the actual problem the CUSTOMER is reporting.\n' +
    // CRITICAL: The ticket body may contain existing admin notes from previous classifications. IGNORE those. Read the CUSTOMER'S original message only.
    'CRITICAL: The ticket body provided may contain existing admin notes, macros, or internal notes from previous agent actions. You MUST read and analyze the CUSTOMER\'S ORIGINAL MESSAGE (the ticket description/comments from the requester), NOT the existing admin notes. Admin notes are internal and written by agents — they do not represent the customer\'s problem.\n' +
    issueTypesList +
    macroCategoriesList +
    'CRITICAL: The RAG chunks below may include macro IDs and SOP IDs. Do NOT use macro IDs (e.g., payments_debtinrelatedaccount) or SOP IDs as issueTypeId. Only use IDs from the "Valid issueTypeId values" list above.\n' +
    topicHintStr +
    'ADMIN NOTES REQUIREMENTS (re-iterated):\n' +
    '- issue: Clear description of the problem (~100 characters minimum) in English\n' +
    '- solution: Suggested resolution or next steps (~100 characters minimum) in English\n' +
    '- other: Additional case-specific context or user details (~50 characters minimum) in English\n' +
    '- supportingDocumentation: Brief note about user-provided evidence (~50 characters minimum) in English\n' +
    'Use the ticket context below to generate relevant, specific admin notes.\n' +
    ticketSummaryHint + '\n' +
    'RAG chunks: ' + ragIds + '\n' +
    userDispositionsStr;
}

function buildFallbackResult(error, ragChunks) {
  return {
    issueTypeId: '',
    macroId: null,
    responseFormat: 'chat',
    extractedLines: [],
    greeting: null,
    signOff: null,
    dispositions: ['clarification_needed'],
    confidence: 0.3,
    adminNotes: { issue: '', solution: '', other: '', supportingDocumentation: '' },
    reasoning: error ? 'Parse/validation failed: ' + error : 'No valid result',
    parseError: error || 'UNKNOWN_ERROR',
    validationError: null,
    ragChunks: (ragChunks || []).map(function(c) { return { id: c.id, score: c.score }; })
  };
}

function parseAndValidate(rawResponse, ragChunks, ticketId, ticketContext, userDispositions) {
  const logPayload = { phase: 'prompt', step: 'parseAndValidate', ticketId: ticketId };
  logger.log(Object.assign({}, logPayload, { status: 'start', hasRaw: !!rawResponse, ragCount: (ragChunks || []).length }));

  const parsed = extractJson(rawResponse);
  if (!parsed) {
    const res = buildFallbackResult('INVALID_JSON', ragChunks);
    logger.log(Object.assign({}, logPayload, { status: 'error', error: 'INVALID_JSON', result: sanitizeForLog(res) }));
    return res;
  }

  const result = {
    issueTypeId: parsed.issueTypeId || '',
    macroId: parsed.macroId || null,
    responseFormat: parsed.responseFormat === 'email' ? 'email' : 'chat',
    extractedLines: Array.isArray(parsed.extractedLines) ? parsed.extractedLines.filter(function(x) { return x && String(x).trim(); }).map(function(x) { return String(x).trim(); }) : [],
    greeting: parsed.greeting === null ? null : (parsed.greeting ? String(parsed.greeting) : null),
    signOff: parsed.signOff === null ? null : (parsed.signOff ? String(parsed.signOff) : null),
    dispositions: [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : parseFloat(parsed.confidence) || 0,
    adminNotes: {
      issue: (parsed.adminNotes && parsed.adminNotes.issue) ? String(parsed.adminNotes.issue) : '',
      solution: (parsed.adminNotes && parsed.adminNotes.solution) ? String(parsed.adminNotes.solution) : '',
      other: (parsed.adminNotes && parsed.adminNotes.other) ? String(parsed.adminNotes.other) : '',
      supportingDocumentation: (parsed.adminNotes && parsed.adminNotes.supportingDocumentation) ? String(parsed.adminNotes.supportingDocumentation) : ''
    },
    reasoning: parsed.reasoning ? String(parsed.reasoning) : '',
    parseError: null,
    validationError: null
  };

  if (result.confidence < 0) result.confidence = 0;
  if (result.confidence > 1) result.confidence = 1;

  if (Array.isArray(parsed.dispositions)) {
    for (var i = 0; i < parsed.dispositions.length; i++) {
      if (ALLOWED_DISPOSITIONS.indexOf(parsed.dispositions[i]) !== -1 && result.dispositions.indexOf(parsed.dispositions[i]) === -1) {
        result.dispositions.push(parsed.dispositions[i]);
      }
    }
  }
  // If user provided dispositions, use those instead of LLM-generated ones
  if (userDispositions && Array.isArray(userDispositions) && userDispositions.length > 0) {
    const validUserDispositions = userDispositions.filter(function(d) { return ALLOWED_DISPOSITIONS.indexOf(d) !== -1; });
    if (validUserDispositions.length > 0) {
      result.dispositions = validUserDispositions;
    }
  }
  if (result.dispositions.length === 0) result.dispositions.push('clarification_needed');

  const sopData = getSopData();
  const allValidIssueTypes = sopData && sopData.issueTypes ? sopData.issueTypes.map(it => it.id).filter(Boolean) : [];
  
  // Extract categories from RAG chunks to filter valid issue types (same logic as buildSystemPrompt)
  const ragCategories = new Set();
  if (ragChunks && Array.isArray(ragChunks)) {
    ragChunks.forEach(function(c) {
      const catMatch = c.id.match(/^([a-z]+)_/);
      if (catMatch) ragCategories.add(catMatch[1]);
    });
  }
  
  // Filter valid issue types by RAG categories
  let filteredValidIssueTypes = allValidIssueTypes;
  if (ragCategories.size > 0) {
    filteredValidIssueTypes = allValidIssueTypes.filter(function(id) {
      return Array.from(ragCategories).some(function(cat) { return id.toLowerCase().startsWith(cat + '_'); });
    });
    if (filteredValidIssueTypes.length === 0) filteredValidIssueTypes = allValidIssueTypes;
  }
  
  const issueTypeSet = new Set(filteredValidIssueTypes);

  let validationErrors = [];

  const normalizedIssueType = result.issueTypeId ? result.issueTypeId.trim() : '';
  if (normalizedIssueType.toLowerCase() === 'general_info') {
    validationErrors.push('FORBIDDEN_ISSUE_TYPE_GENERAL_INFO');
    result.issueTypeId = '';
  } else if (normalizedIssueType && !issueTypeSet.has(normalizedIssueType)) {
    validationErrors.push('INVALID_ISSUE_TYPE_ID');
    // Fallback: try to map invalid issueTypeId to closest valid one from FILTERED list
    const fallback = findClosestIssueType(normalizedIssueType, ticketContext, { issueTypes: filteredValidIssueTypes.map(id => ({ id })) });
    if (fallback) {
      result.issueTypeId = fallback;
      // Remove the validation error since we have a valid fallback
      validationErrors = validationErrors.filter(e => e !== 'INVALID_ISSUE_TYPE_ID');
    }
  } else if (normalizedIssueType) {
    result.issueTypeId = normalizedIssueType;
  }

  // Handle missing ticketContext gracefully
  const ticketBody = (ticketContext && ticketContext.body) ? String(ticketContext.body) : '';
  const ticketSubject = (ticketContext && ticketContext.subject) ? String(ticketContext.subject) : '';
  const ticketText = (ticketSubject + ' ' + ticketBody).toLowerCase();
  const isLivechat = isChatMacroId(result.macroId) || 
                    /livechat|live chat|chat/i.test(ticketText) || 
                    (ticketContext && ticketContext.ticketType === 'chat');

  if (isLivechat) {
    result.responseFormat = 'chat';
    result.greeting = null;
    result.signOff = null;
  }

  const normalizedMacro = normalizeMacroId(result.macroId);
  if (result.macroId && !normalizedMacro) {
    validationErrors.push('INVALID_MACRO_ID');
  } else if (normalizedMacro) {
    result.macroId = normalizedMacro;
  }

  if (validationErrors.length > 0) {
    result.validationError = validationErrors.join(';');
  }

  // Validate admin notes minimum lengths
  const adminNotesErrors = [];
  if (result.adminNotes.issue.length < 100) {
    adminNotesErrors.push('ADMIN_NOTES_ISSUE_TOO_SHORT');
    // Don't clear - let retry see previous attempt
  }
  if (result.adminNotes.solution.length < 100) {
    adminNotesErrors.push('ADMIN_NOTES_SOLUTION_TOO_SHORT');
    // Don't clear - let retry see previous attempt
  }
  if (result.adminNotes.other.length < 50) {
    adminNotesErrors.push('ADMIN_NOTES_OTHER_TOO_SHORT');
    // Don't clear - let retry see previous attempt
  }
  if (result.adminNotes.supportingDocumentation.length < 50) {
    adminNotesErrors.push('ADMIN_NOTES_SUPPORTING_DOC_TOO_SHORT');
    // Don't clear - let retry see previous attempt
  }
  if (adminNotesErrors.length > 0) {
    const existing = result.validationError ? result.validationError + ';' : '';
    result.validationError = existing + adminNotesErrors.join(';');
  }

  // Fallback for supportingDocumentation if still too short after retries
  if (result.adminNotes.supportingDocumentation.length < 50) {
    result.adminNotes.supportingDocumentation = 'No supporting documentation provided by customer. Ticket based on customer statement only.';
    // Remove the validation error since we have a fallback
    if (result.validationError && result.validationError.includes('ADMIN_NOTES_SUPPORTING_DOC_TOO_SHORT')) {
      result.validationError = result.validationError.replace(/;?ADMIN_NOTES_SUPPORTING_DOC_TOO_SHORT/, '');
      if (result.validationError.startsWith(';')) result.validationError = result.validationError.slice(1);
      if (result.validationError.endsWith(';')) result.validationError = result.validationError.slice(0, -1);
    }
  }
  
  // Fallback for other if still too short after retries
  if (result.adminNotes.other.length < 50) {
    result.adminNotes.other = 'No additional context provided by customer.';
    // Remove the validation error since we have a fallback
    if (result.validationError && result.validationError.includes('ADMIN_NOTES_OTHER_TOO_SHORT')) {
      result.validationError = result.validationError.replace(/;?ADMIN_NOTES_OTHER_TOO_SHORT/, '');
      if (result.validationError.startsWith(';')) result.validationError = result.validationError.slice(1);
      if (result.validationError.endsWith(';')) result.validationError = result.validationError.slice(0, -1);
    }
  }

  // Validate admin notes are in English
  const englishErrors = [];
  if (result.adminNotes.issue && !isEnglishText(result.adminNotes.issue)) {
    englishErrors.push('ADMIN_NOTES_ISSUE_NOT_ENGLISH');
    result.adminNotes.issue = '';
  }
  if (result.adminNotes.solution && !isEnglishText(result.adminNotes.solution)) {
    englishErrors.push('ADMIN_NOTES_SOLUTION_NOT_ENGLISH');
    result.adminNotes.solution = '';
  }
  if (result.adminNotes.other && !isEnglishText(result.adminNotes.other)) {
    englishErrors.push('ADMIN_NOTES_OTHER_NOT_ENGLISH');
    result.adminNotes.other = '';
  }
  if (result.adminNotes.supportingDocumentation && !isEnglishText(result.adminNotes.supportingDocumentation)) {
    englishErrors.push('ADMIN_NOTES_SUPPORTING_DOC_NOT_ENGLISH');
    result.adminNotes.supportingDocumentation = '';
  }
  if (englishErrors.length > 0) {
    const existing = result.validationError ? result.validationError + ';' : '';
    result.validationError = existing + englishErrors.join(';');
  }

  logger.log(Object.assign({}, logPayload, { status: 'complete', validationError: result.validationError, parseError: result.parseError, issueTypeId: result.issueTypeId, macroId: result.macroId }));
  return result;
}

module.exports = {
  buildSystemPrompt: buildSystemPrompt,
  parseAndValidate: parseAndValidate,
  extractJson: extractJson,
  normalizeMacroId: normalizeMacroId,
  isChatMacroId: isChatMacroId,
  getSopData: getSopData,
  buildRetryPrompt: buildRetryPrompt
};

// Build a corrective prompt for a failed validation pass.
function buildRetryPrompt(previousRaw, validationErrors, ticketContext, userDispositions) {
  const sopData = getSopData();
  const validIssueTypes = sopData && sopData.issueTypes ? sopData.issueTypes.map(it => it.id).filter(Boolean) : [];
  const validIssueTypesList = validIssueTypes.length > 0 ? 
    'Valid issueTypeId values (ONLY use these): ' + validIssueTypes.join(', ') : 
    'No valid issue types available';
  
  const summary = ticketContext ?
    `Ticket ID: ${ticketContext.ticketId || 'unknown'}, User ID: ${ticketContext.userId || 'none'}, ` +
    `IVC: ${ticketContext.ivc || 'none'}, Language: ${ticketContext.language || 'unknown'}` :
    'No ticket context available';

  // User-selected dispositions for retry guidance
  let userDispositionsStr = '';
  if (userDispositions && Array.isArray(userDispositions) && userDispositions.length > 0) {
    const validUserDispositions = userDispositions.filter(function(d) { return ALLOWED_DISPOSITIONS.indexOf(d) !== -1; });
    if (validUserDispositions.length > 0) {
      userDispositionsStr = '\nUSER-SELECTED DISPOSITIONS (MANDATORY — use these exact values in the "dispositions" field): ' + validUserDispositions.join(', ') + '\n' +
        'Generate admin notes consistent with the selected disposition(s).\n' +
        'Disposition guidance:\n' +
        '- customer_favorable: Resolution favors the customer (refund, credit, exception, waiver). Admin notes should reflect customer-friendly outcome.\n' +
        '- system_favorable: Resolution favors the system/company (policy enforcement, no refund, standard process). Admin notes should reflect company policy adherence.\n' +
        '- clarification_needed: More information required from customer. Admin notes should specify what clarification is needed.\n' +
        '- wrong_email: Ticket submitted to wrong queue/email. Admin notes should note misrouting and correct destination.\n';
    }
  }

  const errs = Array.isArray(validationErrors) ? validationErrors.join('; ') : String(validationErrors || 'unknown');

  return [
    'Your previous response was rejected for the following reasons:',
    errs,
    '',
    'Previous response (for reference):',
    String(previousRaw || '').slice(0, 1500),
    '',
    'CRITICAL: The issueTypeId MUST be from the valid list below. DO NOT use macro IDs (like payments_debtinrelatedaccount, hardware_scooterissue_0charge, etc.) as issueTypeId. Macro IDs are for the macroId field only.',
    validIssueTypesList,
    '',
    'Please regenerate the JSON. STRICTLY enforce these minimum character counts:',
    '- adminNotes.issue: at least 100 characters (clear description of the problem)',
    '- adminNotes.solution: at least 100 characters (suggested resolution or next steps)',
    '- adminNotes.other: at least 50 characters (additional case-specific context or user details)',
    '- adminNotes.supportingDocumentation: at least 50 characters (brief note about user-provided evidence)',
    '',
    'CRITICAL: ALL adminNotes fields MUST be in English. Even if the ticket is in French or another language, admin notes are for internal teams who use English.',
    '',
    'For supportingDocumentation: If the customer provided NO screenshots, photos, or documents, write: "No supporting documentation provided by customer. Ticket based on customer statement only." (this meets 70 char minimum). If evidence exists, describe it briefly.',
    '',
    'Ticket context: ' + summary,
    userDispositionsStr,
    '',
    'Return ONLY valid JSON matching the schema. No extra text.'
  ].join('\n');
}

function buildPrompt(ticketContext, fmContext, ragChunks, ticketId, allMacroBodies, userDispositions) {
  const sopData = getSopData();
  const systemPrompt = buildSystemPrompt(sopData, ragChunks, ticketContext, fmContext, allMacroBodies, userDispositions);
  const userPrompt = buildUserPrompt(ticketContext, fmContext, ragChunks, allMacroBodies, userDispositions);
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

function buildUserPrompt(ticketContext, fmContext, ragChunks, allMacroBodies, userDispositions) {
  const ticketSummary = ticketContext ? JSON.stringify({
    ticketId: ticketContext.ticketId,
    subject: ticketContext.subject,
    body: (ticketContext.body || '').slice(0, MAX_TICKET_BODY_CHARS),
    requesterEmail: ticketContext.requesterEmail,
    requesterPhone: ticketContext.requesterPhone,
    userId: ticketContext.userId,
    ivc: ticketContext.ivc,
    language: ticketContext.language,
    status: ticketContext.status,
    tags: ticketContext.tags,
    structured: ticketContext.structured,
    contactSummary: ticketContext.contactSummary,
    publicReply: ticketContext.publicReply,
    internalNote: ticketContext.internalNote
  }, null, 2) : '{}';

  const fmSummary = fmContext ? JSON.stringify(fmContext, null, 2).slice(0, 2000) : 'null';

  let macroBodiesText = '';
  if (allMacroBodies && typeof allMacroBodies === 'object') {
    const keys = Object.keys(allMacroBodies).slice(0, 15);
    macroBodiesText = keys.map(function(k) {
      const m = allMacroBodies[k];
      const body = (m && m.body) ? m.body : '';
      return k + ':\n' + body.slice(0, 150) + '\n---\n';
    }).join('\n');
  }

  // Add explicit language instruction
  const langInstruction = ticketContext && ticketContext.language 
    ? '\nCRITICAL LANGUAGE INSTRUCTIONS:\n' +
      '- The ticket language is ' + ticketContext.language + '. You MUST read and understand the ticket body in this language.\n' +
      '- ALL adminNotes fields (issue, solution, other, supportingDocumentation) MUST be written in English. Internal teams use English.\n' +
      '- The ticket body may contain existing admin notes from previous agents. IGNORE those — they are internal and not the customer\'s problem.\n' +
      '- Analyze the CUSTOMER\'S ORIGINAL MESSAGE (the ticket description/requester comments) to classify the issue type and generate admin notes.'
    : '';

  // User-selected dispositions for user prompt reinforcement
  let userDispositionsStr = '';
  if (userDispositions && Array.isArray(userDispositions) && userDispositions.length > 0) {
    const validUserDispositions = userDispositions.filter(function(d) { return ALLOWED_DISPOSITIONS.indexOf(d) !== -1; });
    if (validUserDispositions.length > 0) {
      userDispositionsStr = '\n\nUSER-SELECTED DISPOSITIONS (MANDATORY — use these exact values in the "dispositions" field of your JSON response): ' + validUserDispositions.join(', ') + '\n' +
        'Generate admin notes (issue, solution, other, supportingDocumentation) that are CONSISTENT with the selected disposition(s).\n' +
        'Disposition guidance:\n' +
        '- customer_favorable: Resolution favors the customer (refund, credit, exception, waiver). Admin notes should reflect customer-friendly outcome.\n' +
        '- system_favorable: Resolution favors the system/company (policy enforcement, no refund, standard process). Admin notes should reflect company policy adherence.\n' +
        '- clarification_needed: More information required from customer. Admin notes should specify what clarification is needed.\n' +
        '- wrong_email: Ticket submitted to wrong queue/email. Admin notes should note misrouting and correct destination.\n';
    }
  }

  return 'TICKET:\n' + ticketSummary + '\n\nFM CONTEXT:\n' + fmSummary + '\n\nMACRO BODIES (sample):\n' + macroBodiesText + '\n\nReturn valid JSON only as per schema.' + langInstruction + userDispositionsStr;
}

module.exports.buildPrompt = buildPrompt; module.exports.buildUserPrompt = buildUserPrompt;


if (typeof module.exports.buildPrompt !== 'function') { module.exports.buildPrompt = buildPrompt; }
if (typeof module.exports.buildUserPrompt !== 'function') { module.exports.buildUserPrompt = buildUserPrompt; }

