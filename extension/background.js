/**
 * Background service worker — Zendesk FM Assistant
 * Self-contained Chrome MV3 service worker (no require()/importScripts).
 *
 * Inlines the HTTP-mode modules from extension/background/:
 *   classifier-client.js  (native host HTTP client, port 27183)
 *   orchestrator.js       (tab + content-script orchestration)
 *   sop-loader.js         (SOP data via chrome.runtime.getURL)
 *   macro-loader.js       (Full Macros.json parser)
 *
 * Restores FM tab matching and injectResponse forwarding from
 * backup/background_20261007_204716.js, adapted to the HTTP native host.
 *
 * The manifest already grants host_permissions for http://localhost:27183/*
 * so the service worker may fetch the native host directly.
 */

const HTTP_PORT = 27183;
const BASE_URL = `http://localhost:${HTTP_PORT}/api`;
const EXT_LOG_URL = `${BASE_URL}/log`;

async function extLog(entry) {
  try {
    const logEntry = {
      action: 'log',
      entries: [Object.assign({ ts: new Date().toISOString(), source: 'background' }, entry)]
    };
    await fetch(EXT_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    });
  } catch (e) {
    console.error('[Background] Failed to send log:', e);
  }
}


let sopDataCache = null;
let macroDataCache = null;
let matchedTicketData = null;
let matchedFmData = null;

/* ================= classifier-client (HTTP native host) ================= */

async function sendToNativeHost(payload, timeoutMs = 120000) {
  const action = payload && payload.action ? payload.action : 'unknown';
  console.log('[Background] Sending to native host:', action);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BASE_URL}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timer);
    const text = await response.text();

    if (!response.ok) {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      throw new Error((parsed && parsed.error) || `HTTP ${response.status}`);
    }

    let result = null;
    try { result = JSON.parse(text); } catch (e) {}
    if (!result || !result.success) {
      throw new Error((result && result.error) || 'HTTP response missing success');
    }

    console.log('[Background] Native host response:', action, 'success');
    return result.data;
  } catch (error) {
    clearTimeout(timer);
    console.error('[Background] Native host error:', action, error.message);
    throw error;
  }
}

async function pingNativeHost() {
  try {
    const result = await sendToNativeHost({ action: 'ping' }, 5000);
    return { healthy: true, model: result ? result.model : null };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

/* ================= orchestrator (tabs + content scripts) ================= */

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

async function fetchTicketDataFromTab(tabId) {
  const res = await sendToContentScript(tabId, { action: 'getTicketData' });
  return res && res.success ? res.data : null;
}

async function fetchFmDataFromTab(tabId) {
  const res = await sendToContentScript(tabId, { action: 'getFmData' });
  return res && res.success ? res.data : null;
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

/* ================= FM tab matching (restored from backup) ================= */

async function queryFmTabs() {
  try {
    return await chrome.tabs.query({ url: ['https://fm.voiapp.io/*'] });
  } catch (error) {
    console.error('Error querying FM tabs:', error);
    return [];
  }
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
    const fmData = await fetchFmDataFromTab(tab.id);
    if (!fmData) {
      nonMatchingTabs.push({ tab: tab, reason: 'Could not read FM page' });
      continue;
    }

    const fmId = fmData.entityId || extractFmIdentifierFromUrl(tab.url);
    if (fmId && ticketIdentifier && String(fmId).toLowerCase() === String(ticketIdentifier).toLowerCase()) {
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

async function resolveFmContext(ticketContext, providedFmContext) {
  if (providedFmContext && Object.keys(providedFmContext).length > 0) {
    return { fmContext: providedFmContext, matchType: 'direct', reason: null };
  }
  if (matchedFmData) {
    return { fmContext: matchedFmData, matchType: 'cached', reason: null };
  }
  const identifier = (ticketContext && (ticketContext.fmIdentifier || (ticketContext.structured && ticketContext.structured.phone) || ticketContext.requesterEmail)) || '';
  const fmTabs = await queryFmTabs();
  const fmResult = await findMatchingFmTab(identifier, fmTabs);
  if (fmResult.matched && fmResult.fmData) {
    matchedFmData = fmResult.fmData;
    return { fmContext: fmResult.fmData, matchType: fmResult.matchType, reason: null };
  }
  return { fmContext: null, matchType: null, reason: fmResult.reason || 'No FM data available' };
}

/* ================= sop-loader / macro-loader ================= */

async function loadSopData() {
  try {
    const url = chrome.runtime.getURL('sop-data.json');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load SOP data');
    return await response.json();
  } catch (error) {
    console.error('Error loading SOP data:', error);
    return { sops: [] };
  }
}

function normalizeMacroId(rawId) {
  return String(rawId)
    .replace(/::/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

async function loadMacroData() {
  try {
    const url = chrome.runtime.getURL('Full Macros.json');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load macro data');
    const text = await response.text();
    const macros = {};

    const lines = text.split(/\r?\n/);
    let current = null;
    let bodyLines = [];

    for (const line of lines) {
      if (current === null) {
        if (line.startsWith('{') && line.length > 1) {
          current = line.slice(1).trim();
          bodyLines = [];
        }
        continue;
      }
      if (line.endsWith('}')) {
        bodyLines.push(line.slice(0, -1));
        const id = normalizeMacroId(current);
        if (id) {
          macros[id] = { id: id, rawId: current, body: bodyLines.join('\n').trim(), title: current };
        }
        current = null;
        bodyLines = [];
        continue;
      }
      bodyLines.push(line);
    }

    return macros;
  } catch (error) {
    console.error('Error loading macro data:', error);
    return {};
  }
}

async function ensureSopData() {
  if (!sopDataCache) sopDataCache = await loadSopData();
  return sopDataCache;
}

async function ensureMacroData() {
  if (!macroDataCache) macroDataCache = await loadMacroData();
  return macroDataCache;
}

/* ================= message router ================= */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message && message.action ? message.action : 'unknown';
  console.log('[Background] Received message:', action);
  extLog({ phase: 'background', step: 'message', status: 'start', action: action });

  (async () => {
    try {
      if (action === 'pingNativeHost') {
        const result = await pingNativeHost();
        extLog({ phase: 'background', step: 'pingNativeHost', status: result.healthy ? 'complete' : 'error', model: result.model || null, error: result.error || null });
        sendResponse({ success: true, healthy: result.healthy, model: result.model, error: result.error });
        return;
      }

      if (action === 'ticketChanged') {
        const { ticketData } = message;
        if (ticketData) {
          matchedTicketData = ticketData;
          extLog({ phase: 'ticket', step: 'changed', status: 'start', ticketId: ticketData.ticketId || null, requesterEmail: ticketData.requesterEmail || null, url: ticketData.url || null });
        }
        sendResponse({ success: true });
        return;
      }

      if (action === 'getTicketData') {
        const zendeskTabs = await chrome.tabs.query({ url: ['https://*.zendesk.com/*', 'https://*.zendesk.eu/*'] });
        const activeZendeskTab = zendeskTabs.find((t) => t.active) || zendeskTabs[0];
        if (!activeZendeskTab) {
          extLog({ phase: 'background', step: 'getTicketData', status: 'error', error: 'No Zendesk tab found' });
          sendResponse({ success: false, error: 'No Zendesk tab found. Open a Zendesk ticket first.' });
          return;
        }
        const ticketData = await fetchTicketDataFromTab(activeZendeskTab.id);
        if (!ticketData) {
          extLog({ phase: 'background', step: 'getTicketData', status: 'error', error: 'Could not read Zendesk ticket data' });
          sendResponse({ success: false, error: 'Could not read Zendesk ticket data. Reload the Zendesk tab and try again.' });
          return;
        }
        matchedTicketData = ticketData;

        const fm = await resolveFmContext(ticketData, null);
        extLog({ phase: 'background', step: 'getTicketData', status: 'complete', ticketId: ticketData.ticketId || null, fmMatch: !!fm.fmContext, fmMatchType: fm.matchType || null });
        sendResponse({
          success: true,
          ticketData: ticketData,
          fmData: fm.fmContext,
          fmMatch: { matched: !!fm.fmContext, matchType: fm.matchType, reason: fm.reason }
        });
        return;
      }

      if (action === 'classifyTicket' || action === 'reclassifyTicket') {
        const { ticketContext, fmContext, macroData, userOverrides } = message;
        await Promise.all([ensureSopData(), ensureMacroData()]);

        let effectiveTicket = ticketContext;
        if (!effectiveTicket) {
          effectiveTicket = matchedTicketData;
        }
        if (!effectiveTicket) {
          const zendeskTabs = await chrome.tabs.query({ url: ['https://*.zendesk.com/*', 'https://*.zendesk.eu/*'] });
          const tab = zendeskTabs.find((t) => t.active) || zendeskTabs[0];
          if (tab) {
            effectiveTicket = await fetchTicketDataFromTab(tab.id);
            matchedTicketData = effectiveTicket;
          }
        }

        const fm = await resolveFmContext(effectiveTicket, fmContext);
        const effectiveFm = fm.fmContext;

        extLog({ phase: 'background', step: action, status: 'classify-start', ticketId: effectiveTicket ? effectiveTicket.ticketId : null, model: null });

        let llmResult = null;
        let llmError = null;
        try {
          llmResult = await classifyTicket(effectiveTicket, effectiveFm, macroData, userOverrides || {});
        } catch (error) {
          console.error('Native host classify error:', error);
          llmError = 'LLM unavailable, use manual selection: ' + error.message;
        }

        extLog({ phase: 'background', step: action, status: llmResult ? 'complete' : 'error', ticketId: effectiveTicket ? effectiveTicket.ticketId : null, issueTypeId: llmResult ? llmResult.issueTypeId : null, macroId: llmResult && llmResult.macroId ? llmResult.macroId : null, error: llmError });

        sendResponse({
          success: true,
          ticketData: effectiveTicket,
          fmMatch: { matched: !!effectiveFm, matchType: fm.matchType, reason: fm.reason },
          fmData: effectiveFm,
          error: llmError,
          llm: llmResult
        });
        return;
      }

      if (action === 'getSopData') {
        const data = await ensureSopData();
        sendResponse({ success: true, data: data });
        return;
      }

      if (action === 'getMacroData') {
        const data = await ensureMacroData();
        sendResponse({ success: true, data: data });
        return;
      }

      if (action === 'injectResponse') {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        const res = await sendToContentScript(tab.id, { action: 'injectResponse', text: message.text });
        sendResponse({ success: !!(res && res.success), error: res && res.error ? res.error : null });
        return;
      }

      if (action === 'getFmTabs') {
        const fmTabs = await queryFmTabs();
        const tabsWithStatus = [];
        for (let t = 0; t < fmTabs.length; t++) {
          const tab = fmTabs[t];
          const fmData = await fetchFmDataFromTab(tab.id);
          tabsWithStatus.push({ id: tab.id, title: tab.title, url: tab.url, fmData: fmData });
        }
        sendResponse({ success: true, tabs: tabsWithStatus });
        return;
      }

      if (action === 'selectFmTab') {
        const fmData = await fetchFmDataFromTab(message.tabId);
        matchedFmData = fmData;
        sendResponse({ success: true, fmData: fmData });
        return;
      }

      sendResponse({ success: false, error: 'UNKNOWN_ACTION: ' + action });
    } catch (error) {
      console.error('[Background] Error in', action, ':', error);
      extLog({ phase: 'background', step: action, status: 'error', error: error.message });
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

extLog({ phase: 'background', step: 'service-worker', status: 'start', url: self.location.href });
console.log('[Background] Zendesk FM Assistant background script loaded');
