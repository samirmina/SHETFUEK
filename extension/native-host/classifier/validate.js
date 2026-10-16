/**
 * Parse and validate LLM output
 */

const { extractJson, findClosestIssueType, isEnglishText, sanitizeForLog, normalizeMacroId } = require('../../shared/utils');
const { MIN_ADMIN_NOTES_LENGTH, ADMIN_NOTES_FALLBACKS, ALLOWED_DISPOSITIONS } = require('../../shared/constants');
const issueTypesModule = require('../data/issue-types');

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
    adminNotes: {
      issue: '',
      solution: '',
      other: '',
      supportingDocumentation: ''
    },
    reasoning: error ? 'Parse/validation failed: ' + error : 'No valid result',
    parseError: error || 'UNKNOWN_ERROR',
    validationError: null,
    ragChunks: (ragChunks || []).map(c => ({ id: c.id, score: c.score }))
  };
}

function validateAdminNotes(adminNotes, ticketContext, userDispositions) {
  const errors = [];
  const notes = adminNotes || {};
  
  // Check minimum lengths
  for (const [field, minLength] of Object.entries(MIN_ADMIN_NOTES_LENGTH)) {
    const value = notes[field] || '';
    if (value.length < minLength) {
      errors.push(`${field}_TOO_SHORT: ${field} must be at least ${minLength} characters (got ${value.length})`);
    }
  }
  
  // Check English
  for (const field of Object.keys(MIN_ADMIN_NOTES_LENGTH)) {
    const value = notes[field] || '';
    if (value && !isEnglishText(value)) {
      errors.push(`${field}_NOT_ENGLISH: ${field} must be in English (internal teams use English)`);
    }
  }
  
  return errors;
}

function parseAndValidate(rawResponse, ragChunks, ticketId, ticketContext, userDispositions) {
  const logPayload = { phase: 'prompt', step: 'parseAndValidate', ticketId };
  console.log(JSON.stringify({ ...logPayload, status: 'start', hasRaw: !!rawResponse, ragCount: (ragChunks || []).length }));
  
  const parsed = extractJson(rawResponse);
  if (!parsed) {
    const res = buildFallbackResult('INVALID_JSON', ragChunks);
    console.log(JSON.stringify({ ...logPayload, status: 'error', error: 'INVALID_JSON', result: sanitizeForLog(res) }));
    return res;
  }
  
  const allValidIssueTypes = issueTypesModule.getValidIssueTypeIds();
  const issueTypeSet = new Set(allValidIssueTypes);
  
  // Extract categories from RAG chunks to filter valid issue types
  const ragCategories = new Set();
  if (ragChunks && Array.isArray(ragChunks)) {
    ragChunks.forEach(c => {
      const catMatch = c.id.match(/^([a-z]+)_/);
      if (catMatch) ragCategories.add(catMatch[1]);
    });
  }
  
  // Filter valid issue types by RAG categories
  let filteredValidIssueTypes = allValidIssueTypes;
  if (ragCategories.size > 0) {
    filteredValidIssueTypes = allValidIssueTypes.filter(id => 
      Array.from(ragCategories).some(cat => id.toLowerCase().startsWith(cat + '_'))
    );
    if (filteredValidIssueTypes.length === 0) filteredValidIssueTypes = allValidIssueTypes;
  }
  const filteredIssueTypeSet = new Set(filteredValidIssueTypes);
  
  const result = {
    issueTypeId: parsed.issueTypeId || '',
    macroId: parsed.macroId || null,
    responseFormat: parsed.responseFormat === 'email' ? 'email' : 'chat',
    extractedLines: Array.isArray(parsed.extractedLines) 
      ? parsed.extractedLines.filter(x => x && String(x).trim()).map(x => String(x).trim())
      : [],
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
  
  // Clamp confidence
  result.confidence = Math.max(0, Math.min(1, result.confidence));
  
  // Parse dispositions from LLM
  if (Array.isArray(parsed.dispositions)) {
    for (const d of parsed.dispositions) {
      if (ALLOWED_DISPOSITIONS.includes(d) && !result.dispositions.includes(d)) {
        result.dispositions.push(d);
      }
    }
  }
  
  // Override with user-selected dispositions if provided
  if (userDispositions && Array.isArray(userDispositions) && userDispositions.length > 0) {
    const validUserDispositions = userDispositions.filter(d => ALLOWED_DISPOSITIONS.includes(d));
    if (validUserDispositions.length > 0) {
      result.dispositions = validUserDispositions;
    }
  }
  
  if (result.dispositions.length === 0) result.dispositions.push('clarification_needed');
  
  // Validate issueTypeId
  let validationErrors = [];
  
  const normalizedIssueType = result.issueTypeId ? result.issueTypeId.trim() : '';
  if (normalizedIssueType.toLowerCase() === 'general_info') {
    validationErrors.push('FORBIDDEN_ISSUE_TYPE_GENERAL_INFO');
    result.issueTypeId = '';
  } else if (normalizedIssueType && !filteredIssueTypeSet.has(normalizedIssueType)) {
    validationErrors.push('INVALID_ISSUE_TYPE_ID');
    // Try fallback to closest valid issue type from FILTERED list
    const fallback = findClosestIssueType(normalizedIssueType, ticketContext, filteredValidIssueTypes);
    if (fallback) {
      result.issueTypeId = fallback;
      console.log(JSON.stringify({ ...logPayload, step: 'fallback_issue_type', original: normalizedIssueType, fallback }));
    } else {
      result.issueTypeId = '';
    }
  }
  
  // Validate macroId if provided
  if (result.macroId) {
    const normalizedMacro = normalizeMacroId(result.macroId);
    if (normalizedMacro !== result.macroId) {
      result.macroId = normalizedMacro;
    }
    // Could add macro validation here against issue type's related macros
  }
  
  // Validate admin notes
  const adminNotesErrors = validateAdminNotes(result.adminNotes, ticketContext, userDispositions);
  validationErrors.push(...adminNotesErrors);
  
  // Apply fallbacks for short admin notes
  for (const [field, minLength] of Object.entries(MIN_ADMIN_NOTES_LENGTH)) {
    const value = result.adminNotes[field] || '';
    if (value.length < minLength) {
      result.adminNotes[field] = ADMIN_NOTES_FALLBACKS[field];
    }
  }
  
  if (validationErrors.length > 0) {
    result.validationError = validationErrors.join('; ');
  }
  
  console.log(JSON.stringify({ ...logPayload, status: 'complete', validationError: result.validationError || null, issueTypeId: result.issueTypeId, dispositions: result.dispositions }));
  return result;
}

module.exports = {
  parseAndValidate,
  buildFallbackResult,
  validateAdminNotes
};