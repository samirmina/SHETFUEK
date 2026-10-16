/**
 * Background script - message router
 */

const { fetchAllData, classifyTicket } = require('./orchestrator');
const { pingNativeHost } = require('./classifier-client');
const { loadSopData } = require('./sop-loader');
const { loadMacroData } = require('./macro-loader');

let sopDataCache = null;
let macroDataCache = null;

async function ensureSopData() {
  if (!sopDataCache) {
    sopDataCache = await loadSopData();
  }
  return sopDataCache;
}

async function ensureMacroData() {
  if (!macroDataCache) {
    macroDataCache = await loadMacroData();
  }
  return macroDataCache;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action || 'unknown';
  console.log('[Background] Received message:', action);
  
  (async () => {
    try {
      if (action === 'pingNativeHost') {
        const result = await pingNativeHost();
        sendResponse({ success: true, healthy: result.healthy, model: result.model, error: result.error });
        return;
      }
      
      if (action === 'getTicketData') {
        const { ticketData, fmData } = await fetchAllData();
        sendResponse({ success: true, ticketData, fmData });
        return;
      }
      
      if (action === 'classifyTicket') {
        const { ticketContext, fmContext, macroData, userOverrides } = message;
        
        // Ensure data is loaded
        await Promise.all([ensureSopData(), ensureMacroData()]);
        
        const llmResult = await classifyTicket(ticketContext, fmContext, macroData, userOverrides);
        
        sendResponse({
          success: true,
          ticketData: ticketContext,
          fmMatch: fmContext ? { matched: true, matchType: 'cached' } : { matched: false },
          fmData: fmContext,
          llm: llmResult
        });
        return;
      }
      
      if (action === 'reclassifyTicket') {
        // Same as classify but with user overrides
        const { ticketContext, fmContext, macroData, userOverrides } = message;
        await Promise.all([ensureSopData(), ensureMacroData()]);
        
        const llmResult = await classifyTicket(ticketContext, fmContext, macroData, userOverrides);
        
        sendResponse({
          success: true,
          ticketData: ticketContext,
          fmData: fmContext,
          llm: llmResult
        });
        return;
      }
      
      if (action === 'getSopData') {
        const data = await ensureSopData();
        sendResponse({ success: true, data });
        return;
      }
      
      if (action === 'getMacroData') {
        const data = await ensureMacroData();
        sendResponse({ success: true, data });
        return;
      }
      
      sendResponse({ success: false, error: 'UNKNOWN_ACTION: ' + action });
    } catch (error) {
      console.error('[Background] Error in', action, ':', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep message channel open for async response
});

console.log('[Background] Zendesk FM Assistant background script loaded');