/**
 * System prompt template
 */

const { ALLOWED_DISPOSITIONS, DISPOSITION_GUIDANCE, MIN_ADMIN_NOTES_LENGTH, ISSUE_TYPE_CATEGORIES, TOPIC_KEYWORDS } = require('../../shared/constants');
const { getTopicHints } = require('../../shared/utils');
const issueTypesModule = require('../data/issue-types');

function buildSystemPrompt(sopData, ragChunks, ticketContext, userDispositions) {
  const issueTypeRagChunks = (ragChunks || []).filter(c => c.type === 'issueType');
  const macroRagChunks = (ragChunks || []).filter(c => c.type === 'macro');
  const ragIds = issueTypeRagChunks.map(c => c.id).join(', ');
  
  // Extract categories from RAG chunks
  const ragCategories = new Set();
  [...issueTypeRagChunks, ...macroRagChunks].forEach(c => {
    const catMatch = c.id.match(/^([a-z]+)_/);
    if (catMatch) ragCategories.add(catMatch[1]);
  });
  
  // Build list of valid issue type IDs filtered by RAG categories
  const allValidIssueTypes = issueTypesModule.getValidIssueTypeIds();
  let validIssueTypes = allValidIssueTypes;
  if (ragCategories.size > 0) {
    validIssueTypes = allValidIssueTypes.filter(id => 
      Array.from(ragCategories).some(cat => id.toLowerCase().startsWith(cat + '_'))
    );
    if (validIssueTypes.length === 0) validIssueTypes = allValidIssueTypes;
  }
  const issueTypesList = validIssueTypes.length > 0 
    ? 'Valid issueTypeId values (prioritized by RAG relevance): ' + validIssueTypes.join(', ') + '\n'
    : '';
  
  const macroCategoriesList = ragCategories.size > 0 
    ? 'RAG-detected categories: ' + Array.from(ragCategories).join(', ') + '\n'
    : '';
  
  // Topic hints from ticket body
  const ticketBody = ticketContext && ticketContext.body ? String(ticketContext.body).toLowerCase() : '';
  const topicHints = getTopicHints(ticketBody);
  const topicHintStr = topicHints.length > 0 ? 'Ticket topics detected: ' + topicHints.join(', ') + '\n' : '';
  
  // User-selected dispositions
  let userDispositionsStr = '';
  if (userDispositions && Array.isArray(userDispositions) && userDispositions.length > 0) {
    const validUserDispositions = userDispositions.filter(d => ALLOWED_DISPOSITIONS.includes(d));
    if (validUserDispositions.length > 0) {
      userDispositionsStr = 'USER-SELECTED DISPOSITIONS (MANDATORY — use these exact values in the "dispositions" field of your JSON response): ' + validUserDispositions.join(', ') + '\n' +
        'Generate admin notes (issue, solution, other, supportingDocumentation) that are CONSISTENT with the selected disposition(s).\n' +
        'Disposition guidance:\n' +
        Object.entries(DISPOSITION_GUIDANCE)
          .filter(([key]) => validUserDispositions.includes(key))
          .map(([key, g]) => `- ${key}: ${g.description}. ${g.adminNotesGuidance}`)
          .join('\n') + '\n';
    }
  }
  
  // Admin notes requirements
  const adminNotesRequirements = [
    'REQUIRED: issue must be a clear description of the problem, at least ' + MIN_ADMIN_NOTES_LENGTH.issue + ' characters.',
    'REQUIRED: solution must be a suggested resolution or next steps, at least ' + MIN_ADMIN_NOTES_LENGTH.solution + ' characters.',
    'REQUIRED: other must contain additional case-specific context or user details, at least ' + MIN_ADMIN_NOTES_LENGTH.other + ' characters.',
    'REQUIRED: supportingDocumentation must briefly note user-provided evidence (screenshots, references, etc.), at least ' + MIN_ADMIN_NOTES_LENGTH.supportingDocumentation + ' characters.'
  ].join('\n');
  
  const ticketSummaryHint = ticketContext
    ? `Ticket ID: ${ticketContext.ticketId || 'unknown'}, User ID: ${ticketContext.userId || 'none'}, IVC: ${ticketContext.ivc || 'none'}, Language: ${ticketContext.language || 'unknown'}`
    : 'No ticket context available';
  
  return adminNotesRequirements + '\n' +
    'You are a Zendesk ticket classifier. Return ONLY valid JSON matching this schema: {"issueTypeId":"string","macroId":"string","responseFormat":"chat|email","extractedLines":["string"],"greeting":"string|null","signOff":"string|null","dispositions":["customer_favorable","system_favorable","clarification_needed","wrong_email"],"confidence":0-1,"adminNotes":{"issue":"string","solution":"string","other":"string","supportingDocumentation":"string"},"reasoning":"string"}\n' +
    'Rules: never return "general_info" as issueTypeId. For live chat, responseFormat="chat", greeting=null, signOff=null. Otherwise email with greeting/signOff.\n' +
    // CRITICAL: Admin notes MUST be in English
    'CRITICAL: adminNotes.issue, adminNotes.solution, adminNotes.other, and adminNotes.supportingDocumentation MUST be in English. Even if the ticket is in French or other languages, admin notes are for internal Zendesk teams who use English. Do NOT write admin notes in the ticket language.\n' +
    // CRITICAL: Choose the BEST matching issue type
    'CRITICAL: Analyze the CUSTOMER MESSAGE (the ticket body) and select the MOST RELEVANT issue type from the valid list provided. Do not choose a default or first item. Match the issue type that best describes the actual problem the CUSTOMER is reporting.\n' +
    // CRITICAL: Ignore existing admin notes in ticket body
    'CRITICAL: The ticket body provided may contain existing admin notes, macros, or internal notes from previous agent actions. You MUST read and analyze the CUSTOMER\'S ORIGINAL MESSAGE (the ticket description/comments from the requester), NOT the existing admin notes. Admin notes are internal and written by agents — they do not represent the customer\'s problem.\n' +
    issueTypesList +
    macroCategoriesList +
    'CRITICAL: The RAG chunks below may include macro IDs and SOP IDs. Do NOT use macro IDs (e.g., payments_debtinrelatedaccount) or SOP IDs as issueTypeId. Only use IDs from the "Valid issueTypeId values" list above.\n' +
    topicHintStr +
    'ADMIN NOTES REQUIREMENTS (re-iterated):\n' +
    '- issue: Clear description of the problem (~' + MIN_ADMIN_NOTES_LENGTH.issue + ' characters minimum) in English\n' +
    '- solution: Suggested resolution or next steps (~' + MIN_ADMIN_NOTES_LENGTH.solution + ' characters minimum) in English\n' +
    '- other: Additional case-specific context or user details (~' + MIN_ADMIN_NOTES_LENGTH.other + ' characters minimum) in English\n' +
    '- supportingDocumentation: Brief note about user-provided evidence (~' + MIN_ADMIN_NOTES_LENGTH.supportingDocumentation + ' characters minimum) in English\n' +
    'Use the ticket context below to generate relevant, specific admin notes.\n' +
    ticketSummaryHint + '\n' +
    'RAG chunks: ' + ragIds + '\n' +
    userDispositionsStr;
}

module.exports = {
  buildSystemPrompt
};