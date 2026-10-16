/**
 * Shared utility functions
 */

import { TOPIC_KEYWORDS } from './constants.js';

export function sanitizeForLog(obj, maxLength = 1000) {
  if (!obj) return obj;
  try {
    const clone = JSON.parse(JSON.stringify(obj));
    if (clone.ollamaRaw && clone.ollamaRaw.length > maxLength) clone.ollamaRaw = clone.ollamaRaw.slice(0, maxLength) + '...';
    if (clone.rawResponse && clone.rawResponse.length > maxLength) clone.rawResponse = clone.rawResponse.slice(0, maxLength) + '...';
    return clone;
  } catch (e) {
    return obj;
  }
}

export function extractJson(text) {
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
        return null;
      }
    }
    return null;
  }
}

export function normalizeMacroId(rawId) {
  if (!rawId) return null;
  return String(rawId)
    .replace(/::/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

export function isChatMacroId(id) {
  return /^livechat/i.test(String(id || '')) || /^live_chat/i.test(String(id || ''));
}

export function truncateText(text, maxLength) {
  if (!text || typeof text !== 'string') return '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function detectLanguage(text) {
  if (!text) return 'unknown';
  // Simple heuristic
  const frenchWords = /\b(le|la|les|un|une|des|du|de|et|ou|mais|est|sont|avec|pour|sur|dans|sous|entre|par|comme|que|qui|où|quand|comment|très|plus|moins|aussi|donc|alors)\b/i;
  const englishWords = /\b(the|and|or|but|is|are|was|were|have|has|had|will|would|could|should|this|that|with|from|for|about|into|through|during|before|after)\b/i;
  const spanishWords = /\b(el|la|los|las|un|una|y|o|pero|es|son|con|para|por|en|como|que|quien|donde|cuando|muy|más|menos|también|porque|entonces)\b/i;
  
  const hasFrench = frenchWords.test(text);
  const hasEnglish = englishWords.test(text);
  const hasSpanish = spanishWords.test(text);
  
  if (hasFrench && !hasEnglish) return 'fr';
  if (hasSpanish && !hasEnglish) return 'es';
  return 'en';
}

export function isEnglishText(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  
  let nonAsciiCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) > 127) nonAsciiCount++;
  }
  const nonAsciiRatio = nonAsciiCount / trimmed.length;
  
  const englishWords = /\b(the|and|or|but|is|are|was|were|have|has|had|will|would|could|should|this|that|with|from|for|about|into|through|during|before|after)\b/i;
  const hasEnglishWords = englishWords.test(trimmed);
  
  const frenchWords = /\b(le|la|les|un|une|des|du|de|et|ou|mais|est|sont|avec|pour|sur|dans|sous|entre|par|comme|que|qui|où|quand|comment|très|plus|moins|aussi|donc|alors)\b/i;
  const hasFrenchWords = frenchWords.test(trimmed);
  
  if (nonAsciiRatio > 0.15 && hasFrenchWords) return false;
  if (hasEnglishWords && nonAsciiRatio < 0.1) return true;
  return true;
}

export function findClosestIssueType(invalidId, ticketContext, validIssueTypes) {
  if (!validIssueTypes || validIssueTypes.length === 0) return null;
  const invalidLower = invalidId.toLowerCase();
  const ticketText = ticketContext ? ((ticketContext.subject || '') + ' ' + (ticketContext.body || '')).toLowerCase() : '';
  
  const categoryMatch = invalidLower.match(/^([a-z]+)_/);
  const category = categoryMatch ? categoryMatch[1] : null;
  
  let candidates = validIssueTypes;
  if (category) {
    const categoryCandidates = validIssueTypes.filter(id => id.toLowerCase().startsWith(category + '_'));
    if (categoryCandidates.length > 0) candidates = categoryCandidates;
  }
  
  let bestMatch = null;
  let bestScore = -1;
  
  for (const validId of candidates) {
    let score = 0;
    const validLower = validId.toLowerCase();
    
    const invalidKeywords = invalidLower.split(/[_\-]/);
    for (const kw of invalidKeywords) {
      if (kw.length > 2 && validLower.includes(kw)) score += 2;
    }
    
    const ticketKeywords = ticketText.split(/[\s\-,\.]/);
    for (const kw of ticketKeywords) {
      if (kw.length > 3 && validLower.includes(kw)) score += 1;
    }
    
    score -= validId.length * 0.01;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = validId;
    }
  }
  
  return bestMatch;
}

export function getTopicHints(text) {
  const hints = [];
  const lower = text.toLowerCase();
  
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      hints.push(topic);
    }
  }
  return hints;
}