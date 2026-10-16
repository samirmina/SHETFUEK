importScripts('./utils/rules.js');

let matchedTicketData = null;
let matchedFmData = null;

if (chrome.runtime.onInstalled && chrome.scripting && chrome.scripting.registerContentScripts) {
  try {
    chrome.scripting.registerContentScripts([
      {
        id: 'voi-zendesk-dynamic',
        matches: ['https://*.zendesk.com/*', 'https://*.zendesk.eu/*'],
        js: ['content/zendesk.js'],
        runAt: 'document_idle',
        persistAcrossSessions: false
      },
      {
        id: 'voi-fm-dynamic',
        matches: ['https://fm.voiapp.io/*'],
        js: ['content/fm.js'],
        runAt: 'document_idle',
        persistAcrossSessions: false
      }
    ]);
    console.log('[ZendeskFM] Dynamic content scripts registered');
  } catch (e) {
    console.warn('[ZendeskFM] Failed to register dynamic content scripts:', e.message);
  }
}

async function getSopData() {
  return self.__rules.loadSopData();
}

async function queryFmTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://fm.voiapp.io/*'] });
    return tabs;
  } catch (error) {
    console.error('Error querying FM tabs:', error);
    return [];
  }
}

async function requestFmData(tabId, timeoutMs) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getFmData' });
    if (response && response.success) return response.data;
  } catch (error) {
    console.warn('Failed to get FM data from tab ' + tabId + ':', error.message);
  }
  return null;
}

function extractFmIdentifierFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/(riders|ride-inspector)\/([^\/?#]+)/);
  if (match) return match[2];
  const emailMatch = url.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) return emailMatch[0];
  return null;
}

async function findMatchingFmTab(ticketIdentifier, fmTabs) {
  if (!fmTabs || fmTabs.length === 0) return { matched: false, tab: null, reason: 'No FM tabs open' };

  const matchingTabs = [];
  const nonMatchingTabs = [];

  for (let t = 0; t < fmTabs.length; t++) {
    const tab = fmTabs[t];
    const fmData = await requestFmData(tab.id);
    if (!fmData) {
      nonMatchingTabs.push({ tab: tab, reason: 'Could not read FM page' });
      continue;
    }

    const fmId = fmData.entityId || extractFmIdentifierFromUrl(tab.url);
    if (fmId && ticketIdentifier && fmId.toLowerCase() === ticketIdentifier.toLowerCase()) {
      matchingTabs.push({ tab: tab, fmData: fmData, matchType: 'exact' });
    } else if (fmData.pageType === 'profile' && tab.url) {
      matchingTabs.push({ tab: tab, fmData: fmData, matchType: 'profile_fallback' });
    } else {
      nonMatchingTabs.push({ tab: tab, reason: 'No identifier match', fmData: fmData });
    }
  }

  if (matchingTabs.length > 0) {
    const exact = matchingTabs.find(function(m) { return m.matchType === 'exact'; });
    if (exact) return { matched: true, tab: exact.tab, fmData: exact.fmData, matchType: 'exact' };
    const profile = matchingTabs.find(function(m) { return m.matchType === 'profile_fallback'; });
    if (profile) return { matched: true, tab: profile.tab, fmData: profile.fmData, matchType: 'profile_fallback' };
  }

  return { matched: false, tab: null, reason: 'No FM tab matches ticket identifier', availableTabs: nonMatchingTabs };
}

async function sendToNativeHost(payload) {
  return new Promise(function(resolve, reject) {
    const timeout = setTimeout(function() {
      reject(new Error('Native host timeout after 120000ms'));
    }, 120000);

    try {
      chrome.runtime.sendNativeMessage(
        'com.voitechnology.zendesk_fm_assistant',
        payload,
        function(response) {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            return reject(new Error('Native host error: ' + chrome.runtime.lastError.message));
          }
          if (response && response.success) {
            return resolve(response.data);
          }
          if (response && response.error) {
            return reject(new Error(response.error + (response.errorDetail ? ': ' + response.errorDetail : '')));
          }
          return reject(new Error('Native host returned unexpected response'));
        }
      );
    } catch (e) {
      clearTimeout(timeout);
      return reject(new Error('Failed to send to native host: ' + e.message));
    }
  });
}

async function classifyTicket(ticketContext, fmContext) {
  return sendToNativeHost({
    action: 'classify',
    ticketContext: ticketContext,
    fmContext: fmContext || {},
    options: { useCache: true }
  });
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  (async function() {
    try {
      if (message.action === 'pingNativeHost') {
        try {
          await sendToNativeHost({ action: 'ping', payload: {} });
          sendResponse({ success: true, healthy: true });
        } catch (error) {
          sendResponse({ success: false, healthy: false, error: error.message });
        }
        return;
      }

      if (message.action === 'getTicketData') {
        try {
          const zendeskTabs = await chrome.tabs.query({ url: ['https://*.zendesk.com/*', 'https://*.zendesk.eu/*'] });
          const activeTab = zendeskTabs.find(function(t) { return t.active; }) || zendeskTabs[0];
          if (!activeTab) {
            sendResponse({ success: false, error: 'No Zendesk tab found' });
            return;
          }
          const ticketResponse = await chrome.tabs.sendMessage(activeTab.id, { action: 'getTicketData' });
          if (ticketResponse && ticketResponse.success) {
            matchedTicketData = ticketResponse.data;
            sendResponse({ success: true, data: matchedTicketData });
          } else {
            sendResponse({ success: false, error: 'Could not read Zendesk ticket data' });
          }
        } catch (error) {
          console.error('Background getTicketData error:', error);
          sendResponse({ success: false, error: 'Could not establish connection to Zendesk tab. Reload the Zendesk tab and try again.' });
        }
        return;
      }

      if (message.action === 'classifyTicket') {
        const ticketContext = message.ticketContext || null;
        const fmContext = message.fmContext || null;

        if (!ticketContext && !matchedTicketData) {
          try {
            const ticketResponse = await chrome.runtime.sendMessage({ action: 'getTicketData' });
            if (!ticketResponse.success) {
              sendResponse({ success: false, error: ticketResponse.error });
              return;
            }
            matchedTicketData = ticketResponse.data;
          } catch (error) {
            console.error('Background classifyTicket getTicketData error:', error);
            sendResponse({ success: false, error: 'Could not read Zendesk ticket. Reload the Zendesk tab.' });
            return;
          }
        }

        const effectiveTicket = ticketContext || matchedTicketData;

        const fmTabs = await queryFmTabs();
        let effectiveFm = fmContext;

        if (!effectiveFm && matchedFmData) {
          effectiveFm = matchedFmData;
        }

        if (!effectiveFm) {
          const identifier = (effectiveTicket && (effectiveTicket.fmIdentifier || (effectiveTicket.structured && effectiveTicket.structured.phone) || effectiveTicket.requesterEmail)) || '';
          const fmResult = await findMatchingFmTab(identifier, fmTabs);
          if (fmResult.matched && fmResult.fmData) {
            matchedFmData = fmResult.fmData;
            effectiveFm = matchedFmData;
          }
        }

        try {
          const llmResult = await classifyTicket(effectiveTicket, effectiveFm);
          sendResponse({
            success: true,
            ticketData: effectiveTicket,
            fmMatch: {
              matched: !!effectiveFm,
              matchType: effectiveFm ? (effectiveFm.matchType || 'direct') : null,
              reason: effectiveFm ? null : 'No FM data available',
              availableTabs: []
            },
            fmData: effectiveFm,
            llm: llmResult
          });
        } catch (error) {
          console.error('Native host classify error:', error);
          sendResponse({
            success: false,
            ticketData: effectiveTicket,
            fmMatch: {
              matched: !!effectiveFm,
              matchType: effectiveFm ? (effectiveFm.matchType || 'direct') : null,
              reason: effectiveFm ? null : 'No FM data available',
              availableTabs: []
            },
            fmData: effectiveFm,
            error: 'LLM unavailable, use manual selection: ' + error.message,
            llm: null
          });
        }
        return;
      }

      if (message.action === 'getFmTabs') {
        const fmTabs = await queryFmTabs();
        const tabsWithStatus = [];
        for (let t = 0; t < fmTabs.length; t++) {
          const tab = fmTabs[t];
          const fmData = await requestFmData(tab.id);
          tabsWithStatus.push({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            fmData: fmData
          });
        }
        sendResponse({ success: true, tabs: tabsWithStatus });
      }

      if (message.action === 'selectFmTab') {
        const tabId = message.tabId;
        matchedFmData = await requestFmData(tabId);
        sendResponse({ success: true, fmData: matchedFmData });
      }
    } catch (error) {
      console.error('Background worker error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
});
