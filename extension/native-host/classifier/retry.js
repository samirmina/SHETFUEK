/**
 * Retry logic with corrective prompts
 */

const { ALLOWED_DISPOSITIONS, DISPOSITION_GUIDANCE, MIN_ADMIN_NOTES_LENGTH } = require('../../shared/constants');

function buildRetryPrompt(previousRaw, validationErrors, ticketContext, userDispositions) {
  const issueTypesModule = require('../data/issue-types');
  const validIssueTypes = issueTypesModule.getValidIssueTypeIds();
  const validIssueTypesList = validIssueTypes.length > 0 
    ? 'Valid issueTypeId values (ONLY use these): ' + validIssueTypes.join(', ')
    : 'No valid issue types available';
  
  const summary = ticketContext
    ? `Ticket ID: ${ticketContext.ticketId || 'unknown'}, User ID: ${ticketContext.userId || 'none'}, IVC: ${ticketContext.ivc || 'none'}, Language: ${ticketContext.language || 'unknown'}`
    : 'No ticket context available';
  
  // User-selected dispositions for retry guidance
  let userDispositionsStr = '';
  if (userDispositions && Array.isArray(userDispositions) && userDispositions.length > 0) {
    const validUserDispositions = userDispositions.filter(d => ALLOWED_DISPOSITIONS.includes(d));
    if (validUserDispositions.length > 0) {
      userDispositionsStr = '\nUSER-SELECTED DISPOSITIONS (MANDATORY — use these exact values in the "dispositions" field): ' + validUserDispositions.join(', ') + '\n' +
        'Generate admin notes consistent with the selected disposition(s).\n' +
        Object.entries(DISPOSITION_GUIDANCE)
          .filter(([key]) => validUserDispositions.includes(key))
          .map(([key, g]) => `- ${key}: ${g.description}. ${g.adminNotesGuidance}`)
          .join('\n') + '\n';
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
    `- adminNotes.issue: at least ${MIN_ADMIN_NOTES_LENGTH.issue} characters (clear description of the problem)`,
    `- adminNotes.solution: at least ${MIN_ADMIN_NOTES_LENGTH.solution} characters (suggested resolution or next steps)`,
    `- adminNotes.other: at least ${MIN_ADMIN_NOTES_LENGTH.other} characters (additional case-specific context or user details)`,
    `- adminNotes.supportingDocumentation: at least ${MIN_ADMIN_NOTES_LENGTH.supportingDocumentation} characters (brief note about user-provided evidence)`,
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

module.exports = {
  buildRetryPrompt
};