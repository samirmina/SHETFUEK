/**
 * Background orchestrator - handles classification workflow
 */

const { sendToNativeHost } = require('./classifier-client');

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendToContentScript(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: 'No response' });
      }
    });
  });
}

async function fetchTicketData() {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  const res = await sendToContentScript(tab.id, { action: 'getTicketData' });
  return res?.success ? res.data : null;
}

async function fetchFmData() {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  const res = await sendToContentScript(tab.id, { action: 'getFmData' });
  return res?.success ? res.data : null;
}

async function fetchAllData() {
  const [ticketData, fmData] = await Promise.all([
    fetchTicketData(),
    fetchFmData()
  ]);
  return { ticketData, fmData };
}

async function classifyTicket(ticketContext, fmContext, macroData, userOverrides = {}) {
  const payload = {
    action: 'classify',
    ticketContext,
    fmContext: fmContext || {},
    options: {
      useCache: false,
      skipCache: true,
      allMacroBodies: macroData || {},
      userDispositions: userOverrides.dispositions || null
    }
  };
  
  if (userOverrides.issueTypeId) payload.options.issueTypeId = userOverrides.issueTypeId;
  if (userOverrides.macroId) payload.options.macroId = userOverrides.macroId;
  if (userOverrides.responseFormat) payload.options.responseFormat = userOverrides.responseFormat;
  
  return sendToNativeHost(payload);
}

module.exports = {
  fetchTicketData,
  fetchFmData,
  fetchAllData,
  classifyTicket
};