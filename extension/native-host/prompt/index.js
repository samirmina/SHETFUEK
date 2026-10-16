/**
 * Prompt engine - builds system and user prompts for LLM
 */

const { buildSystemPrompt } = require('./system');
const { buildUserPrompt } = require('./user');
const { buildRetryPrompt } = require('../classifier/retry');

function buildPrompt(ticketContext, fmContext, ragChunks, ticketId, allMacroBodies, userDispositions) {
  const sopData = {}; // Not used directly, issue types loaded in system prompt
  const systemPrompt = buildSystemPrompt(sopData, ragChunks, ticketContext, userDispositions);
  const userPrompt = buildUserPrompt(ticketContext, fmContext, ragChunks, allMacroBodies, userDispositions);
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

module.exports = {
  buildPrompt,
  buildUserPrompt,
  buildRetryPrompt,
  buildSystemPrompt
};