const {
  detectPartner,
  determineCompensation
} = window.__rules || {};

function localDetectPartner(headerText) {
  if (!headerText) return 'VOI Customer';
  const lower = headerText.toLowerCase();
  const partners = [
    { name: 'ASEAG (MOV A)', patterns: ['aseag', 'mov a'] },
    { name: 'Free Now', patterns: ['free now'] },
    { name: 'HVV Switch', patterns: ['hvv switch', 'hochbahn', 'hvv'] },
    { name: 'Jelbi', patterns: ['jelbi'] },
    { name: 'KVV', patterns: ['kvv'] },
    { name: 'Leipzig (GO) / (LVB)', patterns: ['leipzig', 'go)', 'lvb'] },
    { name: 'MEEP', patterns: ['meep'] },
    { name: 'Reach Now (Movl)', patterns: ['reach now', 'movl'] },
    { name: 'REDY', patterns: ['redy'] },
    { name: 'Rheinbahn', patterns: ['rheinbahn'] },
    { name: 'Ruter', patterns: ['ruter'] },
    { name: 'SBB / (YUMUV)', patterns: ['sbb', 'yumuv'] },
    { name: 'Splyt', patterns: ['splyt'] },
    { name: 'SWM / (MVGO)', patterns: ['swm', 'mvgo'] },
    { name: 'Telepass', patterns: ['telepass'] },
    { name: 'Travis (NOBINA)', patterns: ['travis', 'nobina'] },
    { name: 'Trafi (SOLENT)', patterns: ['trafi', 'solent'] },
    { name: 'Urbi', patterns: ['urbi'] },
    { name: 'VAG (PT) (NUREMBERG)', patterns: ['vag', 'nuremberg'] },
    { name: 'WeTaxi', patterns: ['wetaxi', 'we taxi'] },
    { name: 'WHIM', patterns: ['whim'] },
    { name: 'Hyre', patterns: ['hyre'] }
  ];
  for (const partner of partners) {
    for (const pattern of partner.patterns) {
      if (lower.indexOf(pattern) !== -1) return partner.name;
    }
  }
  if (lower.indexOf('rider') !== -1) return 'VOI Customer';
  return 'VOI Customer';
}

function localDetermineCompensation(ticketData, fmData) {
  if (fmData && fmData.flags && fmData.flags.indexOf('refund_eligible') !== -1) return 'refund';
  if (fmData && fmData.flags && fmData.flags.indexOf('voucher_available') !== -1) return 'discount/voucher';
  const issueType = ticketData.structured && ticketData.structured.issueType || '';
  const body = (ticketData.body || '').toLowerCase();
  const subject = (ticketData.subject || '').toLowerCase();
  const text = subject + ' ' + body;
  const refundKeywords = ['refund', 'money back', 'return payment'];
  const creditKeywords = ['credit', 'account credit', 'wallet credit'];
  const voucherKeywords = ['voucher', 'discount code', 'promo code'];
  if (refundKeywords.some(k => text.includes(k))) return 'refund';
  if (voucherKeywords.some(k => text.includes(k))) return 'discount/voucher';
  if (creditKeywords.some(k => text.includes(k))) return 'credits';
  return 'N/A';
}

function safeDetectPartner(headerText) {
  return (typeof detectPartner === 'function' ? detectPartner(headerText) : undefined) || localDetectPartner(headerText);
}

function safeDetermineCompensation(ticketData, fmData) {
  return (typeof determineCompensation === 'function' ? determineCompensation(ticketData, fmData) : undefined) || localDetermineCompensation(ticketData, fmData);
}

function resolveMetadata(ticketData, fmData, issueType, sopData) {
  if (!ticketData) return null;
  const structured = ticketData.structured || {};
  let compensation = structured.compensation || 'false';
  if (fmData && fmData.flags && fmData.flags.indexOf('refund_eligible') !== -1) compensation = 'true';
  if (fmData && fmData.flags && fmData.flags.indexOf('voucher_available') !== -1) compensation = 'true';
  let partner = structured.partner || 'false';
  let country = structured.country || '';
  if (!country && fmData && fmData.country) country = fmData.country;
  if (!country && fmData && fmData.region) country = fmData.region;
  let city = structured.city || '';
  if (!city && fmData && fmData.city) city = fmData.city;
  return {
    country: country,
    city: city,
    partner: partner,
    compensation: compensation,
    issueType: issueType ? issueType.name : 'General Information',
    macro: issueType ? issueType.macroId : 'macro_general_info'
  };
}

async function loadSopData() {
  try {
    const url = chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('sop-data.json') : 'sop-data.json';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load SOP data');
    return await response.json();
  } catch (error) {
    console.error('Error loading SOP data:', error);
    return null;
  }
}

const ALLOWED_DISPOSITIONS = ['customer_favorable', 'system_favorable', 'clarification_needed', 'wrong_email'];

const elements = {
  ticketStatus: document.getElementById('ticketStatus'),
  fmStatus: document.getElementById('fmStatus'),
  checkStatus: document.getElementById('checkStatus'),
  country: document.getElementById('country'),
  city: document.getElementById('city'),
  partner: document.getElementById('partner'),
  compensation: document.getElementById('compensation'),
  ticketIdDisplay: document.getElementById('ticketIdDisplay'),
  ticketStatusDisplay: document.getElementById('ticketStatusDisplay'),
  language: document.getElementById('language'),
  ivc: document.getElementById('ivc'),
  userId: document.getElementById('userId'),
  requesterEmail: document.getElementById('requesterEmail'),
  issueType: document.getElementById('issueType'),
  macroSelect: document.getElementById('macroSelect'),
  macroTitle: document.getElementById('macroTitle'),
  macroIncomplete: document.getElementById('macroIncomplete'),
  macroPreview: document.getElementById('macroPreview'),
  fmMatchStatus: document.getElementById('fmMatchStatus'),
  fmTabSelect: document.getElementById('fmTabSelect'),
  refreshFm: document.getElementById('refreshFm'),
  fmDetails: document.getElementById('fmDetails'),
  fmPageType: document.getElementById('fmPageType'),
  fmEntityId: document.getElementById('fmEntityId'),
  fmFlags: document.getElementById('fmFlags'),
  supplementPreview: document.getElementById('supplementPreview'),
  responsePreview: document.getElementById('responsePreview'),
  copyResponse: document.getElementById('copyResponse'),
  injectResponse: document.getElementById('injectResponse'),
  adminIssue: document.getElementById('adminIssue'),
  adminSolution: document.getElementById('adminSolution'),
  adminTicketNotes: document.getElementById('adminTicketNotes'),
  adminDocumented: document.getElementById('adminDocumented'),
  copyAdminNotes: document.getElementById('copyAdminNotes'),
  resolveTicket: document.getElementById('resolveTicket'),
  checkResult: document.getElementById('checkResult'),
  classifyBtn: document.getElementById('classifyBtn'),
  classifyStatus: document.getElementById('classifyStatus'),
  classifyError: document.getElementById('classifyError'),
  confidenceDisplay: document.getElementById('confidenceDisplay'),
  reasoningDisplay: document.getElementById('reasoningDisplay'),
  dispositionContainer: document.getElementById('dispositionContainer'),
  manualFallback: document.getElementById('manualFallback'),
  loadSopBtn: document.getElementById('loadSopBtn'),
  sopStatus: document.getElementById('sopStatus')
};

let currentTicketData = null;
let currentFmData = null;
let currentFmFlags = [];
let currentSopData = null;
let currentLlmResult = null;
let allFmTabs = [];
let isManualMode = false;
let nativeHostHealthy = false;

const CONTENT_SCRIPTS = {
  zendesk: { file: 'content/zendesk.js', matches: ['https://*.zendesk.com/*', 'https://*.zendesk.eu/*'] },
  fm: { file: 'content/fm.js', matches: ['https://fm.voiapp.io/*'] }
};

function setStatus(element, type, text) {
  element.textContent = text;
  element.className = 'status-badge';
  element.classList.add('status-' + type);
}

function log(message) {
  console.log('[ZendeskFM] ' + message);
}

async function pingTab(tabId) {
  try {
    const response = await withTimeout(chrome.tabs.sendMessage(tabId, { action: 'ping' }), 4000);
    return response && response.pong === true;
  } catch (error) {
    return false;
  }
}

function withTimeout(promise, ms) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      reject(new Error('Timed out after ' + ms + 'ms'));
    }, ms);
    promise.then(
      function(value) { clearTimeout(timer); resolve(value); },
      function(err) { clearTimeout(timer); reject(err); }
    );
  });
}

async function injectContentScriptIfNeeded(tabId, file) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [file]
    });
    log('Injected ' + file + ' into tab ' + tabId);
    return true;
  } catch (error) {
    console.error('Failed to inject ' + file + ' into tab ' + tabId + ':', error.message);
    return false;
  }
}

async function ensureContentScripts() {
  log('Ensuring content scripts are present in all open tabs...');
  const tabs = await chrome.tabs.query({ url: Object.values(CONTENT_SCRIPTS).flatMap(s => s.matches) });
  const results = {};

  for (const tab of tabs) {
    const scriptDef = CONTENT_SCRIPTS.zendesk.matches.some(m => {
      try { return new URL(tab.url).href.match(m.replace(/\*/g, '.*')) !== null; } catch { return false; }
    }) ? CONTENT_SCRIPTS.zendesk : CONTENT_SCRIPTS.fm;

    let injected = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const isPresent = await pingTab(tab.id);
      if (isPresent) {
        log(scriptDef.file + ' already present in tab ' + tab.id);
        injected = true;
        break;
      }
      if (attempt < 2) {
        await injectContentScriptIfNeeded(tab.id, scriptDef.file);
        await new Promise(r => setTimeout(r, 500));
      }
    }
    results[tab.id] = injected;
  }
  return results;
}

async function checkNativeHostHealth() {
  log('Checking native host health...');
  try {
    const response = await withTimeout(chrome.runtime.sendMessage({ action: 'pingNativeHost' }), 8000);
    log('Native host health response: ' + JSON.stringify(response));
    if (response && response.success) {
      nativeHostHealthy = true;
      return true;
    }
  } catch (error) {
    console.warn('Native host health check failed:', error.message);
    log('Native host health check failed: ' + error.message);
  }
  nativeHostHealthy = false;
  return false;
}

async function fetchZendeskTicket() {
  const tabs = await chrome.tabs.query({ url: ['https://*.zendesk.com/*', 'https://*.zendesk.eu/*'] });
  const zendeskTab = tabs.find(t => t.active) || tabs[0];
  if (!zendeskTab) {
    setStatus(elements.ticketStatus, 'error', 'No Zendesk tab');
    return null;
  }

  try {
    const response = await withTimeout(chrome.tabs.sendMessage(zendeskTab.id, { action: 'getTicketData' }), 10000);
    if (response && response.success) {
      setStatus(elements.ticketStatus, 'success', 'Ticket loaded');
      log('Ticket loaded: ' + (response.data ? response.data.ticketId : 'unknown'));
      return response.data;
    }
  } catch (error) {
    console.error('Failed to fetch Zendesk ticket:', error);
  }

  setStatus(elements.ticketStatus, 'error', 'No ticket data');
  return null;
}

async function fetchAllFmTabs() {
  try {
    const response = await withTimeout(chrome.runtime.sendMessage({ action: 'getFmTabs' }), 10000);
    if (!response.success) {
      setStatus(elements.fmStatus, 'error', 'FM: Error');
      return [];
    }
    allFmTabs = response.tabs || [];
    log('FM tabs found: ' + allFmTabs.length + ' — ' + allFmTabs.map(function(t) { return t.title || t.url; }).join(', '));
    if (allFmTabs.length > 0) {
      setStatus(elements.fmStatus, 'success', 'FM: ' + allFmTabs.length + ' tabs');
    } else {
      setStatus(elements.fmStatus, 'warning', 'FM: No tabs');
    }
    return allFmTabs;
  } catch (error) {
    console.error('Failed to fetch FM tabs:', error);
    setStatus(elements.fmStatus, 'error', 'FM: Error');
    return [];
  }
}

function findBestFmMatch(ticketData, fmTabs) {
  if (!fmTabs || fmTabs.length === 0) {
    return { matched: false, tab: null, fmData: null, reason: 'No FM tabs open' };
  }

  const identifier = ticketData.fmIdentifier || ticketData.userId || ticketData.requesterEmail || (ticketData.structured && ticketData.structured.phone);
  if (!identifier) {
    if (fmTabs.length === 1) {
      log('Auto-selecting single FM tab as fallback (no ticket identifier)');
      const fallback = fmTabs[0];
      return { matched: true, tab: fallback, fmData: fallback.fmData || null, matchType: 'single_tab_fallback' };
    }
    if (fmTabs.length > 1) {
      return { matched: false, tab: null, fmData: null, reason: 'No identifier in ticket — multiple FM tabs open, select manually', availableTabs: fmTabs };
    }
    return { matched: false, tab: null, fmData: null, reason: 'No identifier in ticket', availableTabs: fmTabs };
  }

  const lowerId = String(identifier).toLowerCase();

  log('FM match: looking for identifier=' + lowerId + ' across ' + fmTabs.length + ' tabs');

  for (const tab of fmTabs) {
    if (!tab.fmData) continue;
    const fmId = tab.fmData.entityId || extractIdFromUrl(tab.url);
    if (fmId && String(fmId).toLowerCase() === lowerId) {
      return { matched: true, tab: tab, fmData: tab.fmData, matchType: 'exact' };
    }
  }

  for (const tab of fmTabs) {
    if (tab.fmData && tab.fmData.pageType === 'profile') {
      return { matched: true, tab: tab, fmData: tab.fmData, matchType: 'profile_fallback' };
    }
  }

  return { matched: false, tab: null, fmData: null, reason: 'No FM tab matches ticket identifier', availableTabs: fmTabs };
}

function extractIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/(riders|ride-inspector|transaction)\/([^\/?#]+)/);
  if (match) return match[2];
  return null;
}

function populateMetadata(data) {
  if (!data) return;
  elements.country.value = data.country || '';
  elements.city.value = data.city || '';
  elements.partner.value = data.partner || 'false';
  elements.compensation.value = data.compensation || 'false';
}

function populateTicketDetails(data) {
  if (!data) return;
  elements.ticketIdDisplay.value = data.ticketId || '';
  elements.ticketStatusDisplay.value = data.status || '';
  elements.language.value = data.language || '';
  elements.ivc.value = data.ivc || '';
  elements.userId.value = data.userId || '';
  elements.requesterEmail.value = data.requesterEmail || '';
}

function renderFmDetails(fmData) {
  if (!fmData) {
    elements.fmDetails.style.display = 'none';
    return;
  }
  elements.fmDetails.style.display = 'block';
  elements.fmPageType.textContent = fmData.pageType || 'unknown';
  elements.fmEntityId.textContent = fmData.entityId || 'N/A';
  elements.fmFlags.textContent = (fmData.flags && fmData.flags.length > 0) ? fmData.flags.join(', ') : 'None';
}

function renderDispositions(dispositions, confidence) {
  elements.dispositionContainer.innerHTML = '';
  if (!dispositions || dispositions.length === 0) {
    elements.dispositionContainer.innerHTML = '<span class="disposition-chip">none</span>';
    return;
  }
  for (const d of ALLOWED_DISPOSITIONS) {
    const chip = document.createElement('span');
    chip.className = 'disposition-chip';
    chip.textContent = d;
    chip.dataset.disposition = d;
    if (dispositions.indexOf(d) !== -1) {
      chip.classList.add('selected');
    }
    chip.addEventListener('click', function() {
      chip.classList.toggle('selected');
    });
    elements.dispositionContainer.appendChild(chip);
  }
  if (confidence !== undefined && confidence !== null) {
    elements.confidenceDisplay.textContent = 'Confidence: ' + (typeof confidence === 'number' ? confidence.toFixed(2) : confidence);
  }
  if (currentLlmResult && currentLlmResult.reasoning) {
    elements.reasoningDisplay.textContent = currentLlmResult.reasoning || '';
  }
}

function getSelectedDispositions() {
  const selected = [];
  for (const chip of elements.dispositionContainer.querySelectorAll('.disposition-chip.selected')) {
    selected.push(chip.dataset.disposition);
  }
  return selected.length > 0 ? selected : ALLOWED_DISPOSITIONS.slice(0, 1);
}

function populateIssueTypes(issueTypes, selectedId) {
  elements.issueType.innerHTML = '';
  for (const issueType of issueTypes) {
    const option = document.createElement('option');
    option.value = issueType.id;
    option.textContent = issueType.name || issueType.id;
    elements.issueType.appendChild(option);
  }
  if (issueTypes.length > 0) {
    elements.issueType.value = selectedId || issueTypes[0].id;
  }
}

function populateMacroSelect(macros, selectedId) {
  elements.macroSelect.innerHTML = '';
  if (!macros || macros.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No related macros';
    elements.macroSelect.appendChild(option);
    elements.macroSelect.disabled = true;
    return;
  }
  elements.macroSelect.disabled = false;
  for (const macroId of macros) {
    const option = document.createElement('option');
    option.value = macroId;
    option.textContent = macroId;
    elements.macroSelect.appendChild(option);
  }
  if (selectedId && macros.indexOf(selectedId) !== -1) {
    elements.macroSelect.value = selectedId;
  }
}

function renderLlmResult(result, issueTypeId, macroId) {
  if (!result) return;
  currentLlmResult = result;
  isManualMode = false;

  const issueTypes = result.issueTypeCandidates || [];
  const macros = result.macroCandidates || [];
  const dispositions = result.dispositions || [];
  const adminNotes = result.adminNotes || {};
  const confidence = result.confidence || 0;

  populateIssueTypes(issueTypes, issueTypeId);
  populateMacroSelect(macros, macroId);
  renderDispositions(dispositions, confidence);

  elements.adminIssue.value = adminNotes.issue || '';
  elements.adminSolution.value = adminNotes.solution || '';
  elements.adminTicketNotes.value = adminNotes.other || '';
  elements.adminDocumented.value = adminNotes.supportingDocumentation || '';

  elements.classifyStatus.textContent = 'Classified (confidence: ' + (typeof confidence === 'number' ? confidence.toFixed(2) : confidence) + ')';
  elements.classifyStatus.className = 'status-badge status-success';
  elements.classifyError.textContent = '';
  elements.manualFallback.style.display = 'none';

  if (elements.macroTitle) elements.macroTitle.textContent = macroId || '';
  if (elements.macroPreview) elements.macroPreview.value = macroId || '(none)';
  updateResponsePreview();
}

function renderManualFallback(errorMsg) {
  isManualMode = true;
  currentLlmResult = null;

  if (nativeHostHealthy) {
    elements.classifyStatus.textContent = 'Ready';
    elements.classifyStatus.className = 'status-badge status-success';
    elements.classifyError.textContent = 'Click "Classify with AI" to run LLM classification.';
  } else {
    elements.classifyStatus.textContent = 'Native host unavailable - manual mode';
    elements.classifyStatus.className = 'status-badge status-warning';
    elements.classifyError.textContent = errorMsg || 'Native host not reachable. Use dropdowns to select issue type and macro. Run register-host.ps1 -ExtensionId <id> to fix.';
  }
  elements.manualFallback.style.display = 'block';
  elements.dispositionContainer.innerHTML = '';
  elements.confidenceDisplay.textContent = '';

  populateIssueTypes(currentSopData ? currentSopData.issueTypes : [], null);
  populateMacroSelect([], null);
}

async function runClassification() {
  if (!currentTicketData) {
    setStatus(elements.classifyStatus, 'error', 'Classify: No data');
    return;
  }

  setStatus(elements.classifyStatus, 'warning', 'Classifying...');
  elements.classifyError.textContent = '';
  elements.dispositionContainer.innerHTML = '';
  elements.confidenceDisplay.textContent = '';
  elements.reasoningDisplay.textContent = '';

  try {
    const result = await withTimeout(chrome.runtime.sendMessage({
      action: 'classifyTicket',
      ticketContext: currentTicketData,
      fmContext: currentFmData
    }), 120000);
    if (!result.success) {
      throw new Error(result.error || 'Classification failed');
    }

    const llm = result.llm;
    if (!llm) {
      throw new Error('LLM returned no result');
    }

    // INVALID_MACRO_ID alone is non-fatal: still show the issue type and let the user pick a macro manually.
    const fatalLlmError = llm.error && (!llm.issueTypeId || llm.issueTypeId === 'general_info');
    if (fatalLlmError) {
      throw new Error(llm.error || 'LLM returned no result');
    }

    const issueTypeId = llm.issueTypeId;
    const macroId = llm.macroId;
    const issueTypeName = issueTypeId;

    let issueTypes = [];
    if (currentSopData && currentSopData.issueTypes) {
      if (issueTypeId && issueTypeId !== 'general_info') {
        const exact = currentSopData.issueTypes.find(function(it) { return it.id === issueTypeId; });
        if (exact) {
          issueTypes = [exact];
        }
      }
      if (issueTypes.length === 0) {
        issueTypes = currentSopData.issueTypes.slice(0, 10);
      }
    }

    let macros = [];
    if (issueTypeId && issueTypeId !== 'general_info') {
      const matchedIt = currentSopData && currentSopData.issueTypes && currentSopData.issueTypes.find(function(it) { return it.id === issueTypeId; });
      if (matchedIt && matchedIt.relatedMacros) {
        macros = matchedIt.relatedMacros.slice(0, 10);
      }
    }

    renderLlmResult({
      issueTypeId: issueTypeId,
      issueTypeName: issueTypeName,
      macroId: macroId,
      dispositions: llm.dispositions,
      adminNotes: llm.adminNotes,
      confidence: llm.confidence,
      reasoning: llm.reasoning,
      issueTypeCandidates: issueTypes,
      macroCandidates: macros,
      raw: llm
    }, issueTypeId, macroId);

    log('Classification complete: ' + issueTypeId + ' / ' + macroId + ' / ' + (llm.dispositions || []).join(',') + ' confidence=' + llm.confidence);
  } catch (error) {
    console.error('Classification error:', error);
    renderManualFallback(error.message);
    log('Classification failed: ' + error.message);
  }
}

async function runAnalysis() {
  log('Starting analysis...');

  log('Step 1: checking native host health...');
  await checkNativeHostHealth();
  log('Step 1: native host health done');

  log('Step 2: ensuring content scripts...');
  await ensureContentScripts();
  log('Step 2: content scripts done');

  currentSopData = await loadSopData();
  if (!currentSopData) {
    setStatus(elements.ticketStatus, 'error', 'SOP load failed');
    log('SOP data load failed');
    return;
  }
  log('Step 3: SOP data loaded');

  currentTicketData = await fetchZendeskTicket();
  if (!currentTicketData) {
    log('No ticket data available');
    return;
  }
  log('Step 4: ticket data loaded id=' + (currentTicketData.ticketId || 'unknown'));

  populateTicketDetails(currentTicketData);

  const fmTabs = await fetchAllFmTabs();
  log('Step 5: FM tabs loaded count=' + fmTabs.length);

  const fmResult = findBestFmMatch(currentTicketData, fmTabs);
  log('Step 6: FM match result=' + (fmResult.matched ? fmResult.matchType : fmResult.reason));

  if (fmResult.matched && fmResult.fmData) {
    currentFmData = fmResult.fmData;
    currentFmFlags = currentFmData.flags || [];
    setStatus(elements.fmStatus, 'success', 'FM: Matched');
    elements.fmMatchStatus.textContent = 'Matched: ' + fmResult.matchType;
    renderFmDetails(currentFmData);
  } else {
    currentFmData = null;
    currentFmFlags = [];
    setStatus(elements.fmStatus, 'warning', 'FM: No match');
    elements.fmMatchStatus.textContent = fmResult.reason || 'No match';
    elements.fmTabSelect.style.display = 'block';
    elements.refreshFm.style.display = 'inline-block';
    elements.fmTabSelect.innerHTML = '<option value="">Select FM tab...</option>';
    for (const tab of fmTabs) {
      const option = document.createElement('option');
      option.value = String(tab.id);
      option.textContent = tab.title || tab.url || 'Tab ' + tab.id;
      elements.fmTabSelect.appendChild(option);
    }
    renderFmDetails(null);
  }

  const structured = currentTicketData.structured || {};
  const detectedPartner = safeDetectPartner(currentFmData ? (currentFmData.rawText || '') : '');
  if (detectedPartner && detectedPartner !== 'VOI Customer') {
    structured.partner = detectedPartner;
  }
  const detectedCompensation = safeDetermineCompensation(currentTicketData, currentFmData);
  if (detectedCompensation) {
    structured.compensation = detectedCompensation;
  }

  const metadata = resolveMetadata(currentTicketData, currentFmData, null, currentSopData);
  if (metadata) populateMetadata(metadata);

  updateResponsePreview();
  renderManualFallback('Click "Classify with AI" to run LLM classification.');
  log('Step 7: analysis complete');
}

async function refreshFmSelection() {
  const tabId = parseInt(elements.fmTabSelect.value, 10);
  if (!tabId) return;

  try {
    const response = await withTimeout(chrome.runtime.sendMessage({ action: 'selectFmTab', tabId }), 10000);
    if (response.success && response.fmData) {
      currentFmData = response.fmData;
      currentFmFlags = currentFmData.flags || [];
      setStatus(elements.fmStatus, 'success', 'FM: Selected');
      elements.fmTabSelect.style.display = 'none';
      elements.refreshFm.style.display = 'none';
      renderFmDetails(currentFmData);
      await runAnalysis();
    }
  } catch (error) {
    console.error('Failed to select FM tab:', error);
  }
}

async function injectIntoZendesk() {
  const tabs = await chrome.tabs.query({ url: ['https://*.zendesk.com/*', 'https://*.zendesk.eu/*'] });
  const zendeskTab = tabs.find(t => t.active) || tabs[0];
  if (!zendeskTab) {
    alert('No Zendesk tab found. Please open a Zendesk ticket.');
    return;
  }

  const responseText = elements.responsePreview.value;
  if (!responseText) {
    alert('No response to inject.');
    return;
  }

  try {
    await withTimeout(chrome.tabs.sendMessage(zendeskTab.id, {
      action: 'injectResponse',
      text: responseText
    }), 10000);
    alert('Response injected into Zendesk reply area.');
  } catch (error) {
    console.error('Failed to inject response:', error);
    alert('Failed to inject response. See console for details.');
  }
}

function copyToClipboard(text, label) {
  if (!text) {
    alert('Nothing to copy for ' + label + '.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    const original = elements.copyResponse.textContent;
    elements.copyResponse.textContent = 'Copied!';
    setTimeout(() => {
      elements.copyResponse.textContent = original;
    }, 1500);
  }).catch(err => {
    console.error('Copy failed:', err);
    alert('Failed to copy to clipboard.');
  });
}

function copyAdminNotesText() {
  const notes = [
    elements.adminIssue.value,
    elements.adminSolution.value,
    elements.adminTicketNotes.value,
    elements.adminDocumented.value
  ].join('\n');
  copyToClipboard(notes, 'Admin Notes');
}

async function handleResolve() {
  const adminNotes = [
    elements.adminIssue.value,
    elements.adminSolution.value,
    elements.adminTicketNotes.value,
    elements.adminDocumented.value
  ].join('\n');

  if (!adminNotes.trim()) {
    if (!confirm('Admin notes are empty. Continue?')) return;
  }

  alert('Ticket resolved (demo). In production, this would set Zendesk status to Solved.');
}

function updateResponsePreview() {
  let response = elements.macroSelect.value || '';

  if (response && elements.macroTitle && elements.macroTitle.textContent) {
    response = elements.macroTitle.textContent;
  }

  currentFullResponse = response;
  elements.responsePreview.value = response || 'No response generated. Select a macro or type your response.';
}

elements.copyResponse.addEventListener('click', () => copyToClipboard(elements.responsePreview.value, 'Response'));
elements.injectResponse.addEventListener('click', injectIntoZendesk);
elements.copyAdminNotes.addEventListener('click', copyAdminNotesText);
elements.resolveTicket.addEventListener('click', handleResolve);
elements.refreshFm.addEventListener('click', refreshFmSelection);

  if (elements.classifyBtn) {
    elements.classifyBtn.addEventListener('click', runClassification);
  }

  if (elements.checkStatus) {
    setStatus(elements.checkStatus, 'success', 'Check: Ready');
  }

elements.issueType.addEventListener('change', async () => {
  updateResponsePreview();
});

elements.macroSelect.addEventListener('change', () => {
  updateResponsePreview();
});

['country', 'city', 'partner', 'compensation'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    updateResponsePreview();
  });
});

if (elements.loadSopBtn) {
  elements.loadSopBtn.addEventListener('click', async () => {
    elements.sopStatus.textContent = 'Loading SOP...';
    elements.sopStatus.className = 'status-badge status-warning';
    try {
      currentSopData = await loadSopData();
      if (currentSopData) {
        elements.sopStatus.textContent = 'SOP loaded (' + (currentSopData.issueTypes ? currentSopData.issueTypes.length : 0) + ' issue types)';
        elements.sopStatus.className = 'status-badge status-success';
      } else {
        elements.sopStatus.textContent = 'SOP load failed';
        elements.sopStatus.className = 'status-badge status-error';
      }
    } catch (e) {
      elements.sopStatus.textContent = 'SOP load error: ' + e.message;
      elements.sopStatus.className = 'status-badge status-error';
    }
  });
}

runAnalysis();
