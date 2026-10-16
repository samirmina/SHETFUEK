/**
 * User prompt template
 */

const { MAX_TICKET_BODY_CHARS } = require('../../shared/constants');

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
    macroBodiesText = keys.map(k => {
      const m = allMacroBodies[k];
      const body = (m && m.body) ? m.body : '';
      return k + ':\n' + body.slice(0, 150) + '\n---\n';
    }).join('\n');
  }
  
  // Language instruction
  const langInstruction = ticketContext && ticketContext.language
    ? '\nCRITICAL LANGUAGE INSTRUCTIONS:\n' +
      '- The ticket language is ' + ticketContext.language + '. You MUST read and understand the ticket body in this language.\n' +
      '- ALL adminNotes fields (issue, solution, other, supportingDocumentation) MUST be written in English. Internal teams use English.\n' +
      '- The ticket body may contain existing admin notes from previous agents. IGNORE those — they are internal and not the customer\'s problem.\n' +
      '- Analyze the CUSTOMER\'S ORIGINAL MESSAGE (the ticket description/requester comments) to classify the issue type and generate admin notes.'
    : '';
  
  // User dispositions reinforcement
  let userDispositionsStr = '';
  if (userDispositions && Array.isArray(userDispositions) && userDispositions.length > 0) {
    const { ALLOWED_DISPOSITIONS, DISPOSITION_GUIDANCE } = require('../../shared/constants');
    const validUserDispositions = userDispositions.filter(d => ALLOWED_DISPOSITIONS.includes(d));
    if (validUserDispositions.length > 0) {
      userDispositionsStr = '\n\nUSER-SELECTED DISPOSITIONS (MANDATORY — use these exact values in the "dispositions" field of your JSON response): ' + validUserDispositions.join(', ') + '\n' +
        'Generate admin notes (issue, solution, other, supportingDocumentation) that are CONSISTENT with the selected disposition(s).\n' +
        'Disposition guidance:\n' +
        Object.entries(DISPOSITION_GUIDANCE)
          .filter(([key]) => validUserDispositions.includes(key))
          .map(([key, g]) => `- ${key}: ${g.description}. ${g.adminNotesGuidance}`)
          .join('\n') + '\n';
    }
  }
  
  return 'TICKET:\n' + ticketSummary + '\n\nFM CONTEXT:\n' + fmSummary + '\n\nMACRO BODIES (sample):\n' + macroBodiesText + '\n\nReturn valid JSON only as per schema.' + langInstruction + userDispositionsStr;
}

module.exports = {
  buildUserPrompt
};