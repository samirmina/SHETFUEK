/**
 * Zendesk FM Assistant - Popup Controller (Single File, No Modules)
 * All UI logic self-contained for reliability
 */

// ============ STATE MANAGEMENT ============
const State = (() => {
  const state = {
    ticketData: null,
    fmData: null,
    sopData: null,
    macroData: null,
    llmResult: null,
    isManualMode: false,
    currentResponseFormat: 'chat',
    currentExtractedLines: [],
    currentGreeting: null,
    currentSignOff: null,
    selectedIssueTypeId: null,
    selectedMacroId: null,
    selectedDispositions: [],
    selectedResponseFormat: 'chat',
    classifyStatus: 'ready',
    classifyError: '',
    confidence: null,
    reasoning: '',
    fmTabs: [],
    currentFmTabIndex: 0
  };

  const listeners = new Set();

  function get(key) { return state[key]; }
  function set(key, value) {
    const old = state[key];
    state[key] = value;
    if (old !== value) notify(key, value, old);
  }
  function setMultiple(updates) {
    for (const [k, v] of Object.entries(updates)) {
      const old = state[k];
      state[k] = v;
      if (old !== v) notify(k, v, old);
    }
  }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function notify(key, newVal, oldVal) {
    for (const fn of listeners) {
      try { fn(key, newVal, oldVal, state); } catch (e) { console.error('State listener error:', e); }
    }
  }

  // Computed getters
  function getIssueTypes() { return state.sopData?.issueTypes || []; }
  function getMacrosForIssueType(issueTypeId) {
    if (!state.sopData?.issueTypes || !issueTypeId) return [];
    const it = state.sopData.issueTypes.find(x => x.id === issueTypeId);
    if (!it || !it.relatedMacros) return [];
    return it.relatedMacros.map(id => state.macroData?.[id]).filter(Boolean);
  }
  function getAllMacros() { return state.macroData ? Object.values(state.macroData) : []; }
  function getUserOverrides() {
    return {
      issueTypeId: state.selectedIssueTypeId,
      macroId: state.selectedMacroId,
      dispositions: state.selectedDispositions,
      responseFormat: state.selectedResponseFormat
    };
  }
  function resetClassification() {
    setMultiple({
      llmResult: null, isManualMode: false, currentResponseFormat: 'chat',
      currentExtractedLines: [], currentGreeting: null, currentSignOff: null,
      classifyStatus: 'ready', classifyError: '', confidence: null, reasoning: ''
    });
  }

  return { get, set, setMultiple, subscribe, getIssueTypes, getMacrosForIssueType, getAllMacros, getUserOverrides, resetClassification };
})();

// ============ CONSTANTS ============
const ALLOWED_DISPOSITIONS = ['customer_favorable', 'system_favorable', 'clarification_needed', 'wrong_email'];
const DISPOSITION_LABELS = {
  customer_favorable: 'Customer Favorable',
  system_favorable: 'System Favorable',
  clarification_needed: 'Clarification Needed',
  wrong_email: 'Wrong Email/Queue'
};
const DISPOSITION_DESCRIPTIONS = {
  customer_favorable: 'Resolution favors the customer (refund, credit, exception, waiver)',
  system_favorable: 'Resolution favors the system/company (policy enforcement, no refund)',
  clarification_needed: 'More information required from customer',
  wrong_email: 'Ticket submitted to wrong queue/email'
};

// ============ UTILITIES ============
const $ = id => document.getElementById(id);
const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };
const setSel = (id, val) => { const el = $(id); if (el && [...el.options].some(o => o.value === val)) el.value = val; };
const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
const setHtml = (id, val) => { const el = $(id); if (el) el.innerHTML = val; };
const show = (id, show) => { const el = $(id); if (el) el.style.display = show ? '' : 'none'; };
const addClass = (el, cls) => el && el.classList.add(cls);
const removeClass = (el, cls) => el && el.classList.remove(cls);
const toggleClass = (el, cls) => el && el.classList.toggle(cls);

// ============ RENDER FUNCTIONS ============
function renderTicketView() {
  const t = State.get('ticketData');
  if (!t) return;
  setVal('country', t.structured?.country || '');
  setVal('city', t.structured?.city || '');
  setVal('partner', t.structured?.partner || '');
  setSel('compensation', t.structured?.compensation || 'N/A');
  setVal('ticketIdDisplay', t.ticketId || '');
  setVal('ticketStatusDisplay', t.status || '');
  setVal('language', t.language || '');
  setVal('ivc', t.ivc || '');
  setVal('userId', t.userId || '');
  setVal('requesterEmail', t.requesterEmail || '');

  const ts = $('ticketStatus');
  if (ts) { ts.textContent = `Ticket: ${t.ticketId || 'Loading...'}`; ts.className = 'status-badge status-success'; }

  const fs = $('fmStatus'), fm = State.get('fmData');
  if (fs) {
    if (fm) { fs.textContent = `FM: ${fm.pageType} (${fm.entityId || 'no ID'})`; fs.className = 'status-badge status-success'; }
    else { fs.textContent = 'FM: Not detected'; fs.className = 'status-badge status-warning'; }
  }
  if (fm) {
    show('fmInfo', false); show('fmDetails', true);
    setText('fmMatchStatus', `Matched: ${fm.pageType}`);
    setText('fmPageType', fm.pageType);
    setText('fmEntityId', fm.entityId || 'N/A');
    setText('fmFlags', (fm.flags || []).join(', ') || 'None');
  }
}

function renderClassifyPanel() {
  const llm = State.get('llmResult');
  const manual = State.get('isManualMode');
  const status = State.get('classifyStatus');
  const err = State.get('classifyError');
  const conf = State.get('confidence');
  const reason = State.get('reasoning');
  const dispositions = State.get('selectedDispositions');

  // Issue type dropdown
  const types = State.getIssueTypes();
  const itSel = $('issueType');
  if (itSel) {
    const cur = itSel.value;
    const userChanged = cur && cur !== State.get('selectedIssueTypeId');
    itSel.innerHTML = '';
    if (types.length === 0) {
      itSel.innerHTML = '<option value="">No issue types loaded</option>';
    } else {
      for (const t of types) {
        const o = document.createElement('option');
        o.value = t.id; o.textContent = `${t.category} > ${t.name}`;
        itSel.appendChild(o);
      }
      const target = userChanged ? cur : (State.get('selectedIssueTypeId') || types[0].id);
      if (target) itSel.value = target;
    }
  }

  // Macro dropdown
  const macros = State.getMacrosForIssueType(State.get('selectedIssueTypeId'));
  const mSel = $('macroSelect');
  if (mSel) {
    const cur = mSel.value;
    const userChanged = cur && cur !== State.get('selectedMacroId');
    mSel.innerHTML = '<option value="">Select a macro...</option>';
    for (const m of macros) {
      const o = document.createElement('option');
      o.value = m.id; o.textContent = m.title || m.id;
      mSel.appendChild(o);
    }
    const target = userChanged ? cur : (State.get('selectedMacroId') || '');
    if (target) mSel.value = target;
    updateMacroPreview(target);
  }

  // Response format
  const rf = $('responseFormat');
  if (rf) rf.value = State.get('selectedResponseFormat') || 'chat';

  // Classify button
  const btn = $('classifyBtn'), stEl = $('classifyStatus'), errEl = $('classifyError'), manEl = $('manualFallback');
  if (btn) { btn.disabled = status === 'loading'; btn.textContent = status === 'loading' ? 'Classifying...' : 'Classify with AI'; }
  if (stEl) {
    switch (status) {
      case 'loading': stEl.textContent = 'Classifying...'; stEl.className = 'status-badge status-warning'; break;
      case 'success': stEl.textContent = `Classified (confidence: ${typeof conf === 'number' ? conf.toFixed(2) : conf})`; stEl.className = 'status-badge status-success'; break;
      case 'error': stEl.textContent = 'Classification failed'; stEl.className = 'status-badge status-error'; break;
      default: stEl.textContent = 'Ready'; stEl.className = 'status-badge status-info';
    }
  }
  if (errEl) { errEl.textContent = err || ''; errEl.style.display = err ? 'block' : 'none'; }
  if (manEl) manEl.style.display = manual ? 'block' : 'none';
  setText('confidenceDisplay', conf !== null ? (typeof conf === 'number' ? conf.toFixed(2) : conf) : '-');
  setText('reasoningDisplay', reason || '-');

  // Dispositions
  const cont = $('dispositionContainer');
  if (cont) {
    cont.innerHTML = '';
    for (const d of ALLOWED_DISPOSITIONS) {
      const chip = document.createElement('span');
      chip.className = 'disposition-chip' + (dispositions.includes(d) ? ' selected' : '');
      chip.dataset.disposition = d;
      chip.textContent = DISPOSITION_LABELS[d];
      chip.title = DISPOSITION_DESCRIPTIONS[d];
      cont.appendChild(chip);
    }
  }
}

function updateMacroPreview(macroId) {
  const titleEl = $('macroTitle'), prevEl = $('macroPreview');
  if (!macroId) { if (titleEl) titleEl.textContent = 'Select a macro...'; if (prevEl) prevEl.value = ''; return; }
  const macroData = State.get('macroData');
  if (macroData && macroData[macroId]) {
    const m = macroData[macroId];
    if (titleEl) titleEl.textContent = m.title || macroId;
    if (prevEl) prevEl.value = m.body || '';
  }
}

function renderResponsePanel() {
  const llm = State.get('llmResult');
  const manual = State.get('isManualMode');
  const fmt = State.get('currentResponseFormat');
  const lines = State.get('currentExtractedLines');
  const greet = State.get('currentGreeting');
  const sign = State.get('currentSignOff');
  const macroId = State.get('selectedMacroId');
  const macroData = State.get('macroData');
  const prev = $('responsePreview');
  if (!prev) return;

  let resp = '';
  if (manual || !llm) {
    if (macroId && macroData && macroData[macroId]) resp = macroData[macroId].body || '';
    else resp = 'No response generated. Select a macro or classify the ticket.';
  } else {
    const macro = macroId && macroData && macroData[macroId];
    const body = macro?.body || '';
    const extracted = lines.join('\n');
    if (fmt === 'email') {
      const g = greet || (body.match(/^([^\n]+)/)?.[1] || 'Hi,');
      const s = sign || (body.match(/([^\n]+)$/)?.[1] || 'Best regards,');
      resp = `${g}\n\n${extracted}\n\n${s}`;
    } else {
      resp = extracted || body || 'No response generated.';
    }
  }
  prev.value = resp;
}

function renderAdminNotesPanel() {
  const notes = State.get('llmResult')?.adminNotes || {};
  setVal('adminIssue', notes.issue || '');
  setVal('adminSolution', notes.solution || '');
  setVal('adminTicketNotes', notes.other || '');
  setVal('adminDocumented', notes.supportingDocumentation || '');
  updateCharCount('adminIssue', notes.issue?.length || 0, 100);
  updateCharCount('adminSolution', notes.solution?.length || 0, 100);
  updateCharCount('adminTicketNotes', notes.other?.length || 0, 50);
  updateCharCount('adminDocumented', notes.supportingDocumentation?.length || 0, 50);
}

function updateCharCount(id, len, min) {
  const ta = $(id); if (!ta) return;
  const old = ta.parentNode.querySelector('.char-count'); if (old) old.remove();
  const ind = document.createElement('span');
  ind.className = 'char-count' + (len < min ? ' warning' : ' ok');
  ind.textContent = `${len}/${min} chars`;
  ind.style.fontSize = '0.75rem'; ind.style.marginLeft = '8px';
  ind.style.color = len < min ? '#dc3545' : '#28a745';
  ta.parentNode.appendChild(ind);
}

function renderAll() {
  renderTicketView();
  renderClassifyPanel();
  renderResponsePanel();
  renderAdminNotesPanel();
}

// ============ EVENT HANDLERS ============
function handleClassify() {
  State.set('classifyStatus', 'loading');
  State.set('classifyError', '');
  const { ticketData, fmData, macroData } = State;
  const overrides = State.getUserOverrides();
  chrome.runtime.sendMessage({ action: 'classifyTicket', ticketContext: ticketData, fmContext: fmData, macroData, userOverrides: overrides }, res => {
    if (!res?.success) { State.set('classifyStatus', 'error'); State.set('classifyError', res?.error || 'Classification failed'); State.set('isManualMode', true); return; }
    if (!res.llm) { State.set('classifyStatus', 'error'); State.set('classifyError', 'No LLM result returned'); State.set('isManualMode', true); return; }
    applyLlmResult(res.llm);
    State.set('classifyStatus', 'success');
  });
}

function applyLlmResult(llm) {
  State.set('llmResult', llm);
  State.set('isManualMode', false);
  State.set('confidence', llm.confidence || 0);
  State.set('reasoning', llm.reasoning || '');
  if (!State.get('selectedIssueTypeId')) State.set('selectedIssueTypeId', llm.issueTypeId);
  if (!State.get('selectedMacroId')) State.set('selectedMacroId', llm.macroId);
  if (State.get('selectedDispositions').length === 0) State.set('selectedDispositions', llm.dispositions || ['clarification_needed']);
  if (!State.get('selectedResponseFormat')) State.set('selectedResponseFormat', llm.responseFormat || 'chat');
  State.set('currentResponseFormat', llm.responseFormat || 'chat');
  State.set('currentExtractedLines', llm.extractedLines || []);
  State.set('currentGreeting', llm.greeting || null);
  State.set('currentSignOff', llm.signOff || null);
}

async function reclassify() {
  State.set('classifyStatus', 'loading');
  State.set('classifyError', '');
  const { ticketData, fmData, macroData } = State;
  const overrides = State.getUserOverrides();
  chrome.runtime.sendMessage({ action: 'reclassifyTicket', ticketContext: ticketData, fmContext: fmData, macroData, userOverrides: overrides }, res => {
    if (!res?.success) { State.set('classifyStatus', 'error'); State.set('classifyError', res?.error || 'Re-classification failed'); return; }
    if (!res.llm) { State.set('classifyStatus', 'error'); State.set('classifyError', 'No LLM result returned'); return; }
    applyLlmResult(res.llm);
    State.set('classifyStatus', 'success');
  });
}

function setupListeners() {
  // Classify button
  const cBtn = $('classifyBtn'); if (cBtn) cBtn.onclick = handleClassify;

  // User changes trigger re-classify
  const itSel = $('issueType'); if (itSel) itSel.onchange = e => { State.set('selectedIssueTypeId', e.target.value); if (State.get('llmResult') && !State.get('isManualMode')) reclassify(); };
  const mSel = $('macroSelect'); if (mSel) mSel.onchange = e => { State.set('selectedMacroId', e.target.value); updateMacroPreview(e.target.value); if (State.get('llmResult') && !State.get('isManualMode')) reclassify(); };
  const rfSel = $('responseFormat'); if (rfSel) rfSel.onchange = e => { State.set('selectedResponseFormat', e.target.value); if (State.get('llmResult') && !State.get('isManualMode')) reclassify(); };

  // Disposition chips
  const dc = $('dispositionContainer');
  if (dc) dc.onclick = e => {
    const chip = e.target.closest('.disposition-chip');
    if (chip) { toggleClass(chip, 'selected'); const chips = dc.querySelectorAll('.disposition-chip.selected'); State.set('selectedDispositions', [...chips].map(c => c.dataset.disposition)); }
  };

  // Refresh FM
  const rfBtn = $('refreshFm'); if (rfBtn) rfBtn.onclick = async () => { await loadTicketAndFmData(); renderAll(); };

  // Copy/Inject
  const crBtn = $('copyResponse'); if (crBtn) crBtn.onclick = () => navigator.clipboard.writeText($('responsePreview').value || '');
  const irBtn = $('injectResponse'); if (irBtn) irBtn.onclick = () => chrome.runtime.sendMessage({ action: 'injectResponse', text: $('responsePreview').value });
  const caBtn = $('copyAdminNotes'); if (caBtn) caBtn.onclick = () => navigator.clipboard.writeText([
    `Issue: ${$('adminIssue').value || ''}`,
    `Solution: ${$('adminSolution').value || ''}`,
    `Other: ${$('adminTicketNotes').value || ''}`,
    `Supporting Documentation: ${$('adminDocumented').value || ''}`
  ].join('\n\n'));

  // Reactive updates
  State.subscribe((key) => {
    if (['llmResult', 'classifyStatus', 'classifyError', 'confidence', 'reasoning'].includes(key)) { renderClassifyPanel(); renderResponsePanel(); renderAdminNotesPanel(); }
    if (['ticketData', 'fmData'].includes(key)) renderTicketView();
  });
}

// ============ DATA LOADING ============
async function loadReferenceData() {
  try {
    const [sopRes, macroRes] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'getSopData' }),
      chrome.runtime.sendMessage({ action: 'getMacroData' })
    ]);
    if (sopRes?.success) State.set('sopData', sopRes.data);
    if (macroRes?.success) State.set('macroData', macroRes.data);
  } catch (e) { console.error('[Popup] Failed to load reference data:', e); }
}

async function loadTicketAndFmData() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getTicketData' });
    if (res?.success) { State.set('ticketData', res.ticketData); State.set('fmData', res.fmData); }
  } catch (e) { console.error('[Popup] Failed to load ticket data:', e); }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Popup] Initializing...');
  await loadReferenceData();
  await loadTicketAndFmData();
  setupListeners();
  renderAll();
  console.log('[Popup] Initialized');
});