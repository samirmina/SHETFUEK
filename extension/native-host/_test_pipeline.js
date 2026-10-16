const ingest = require('./rag/ingest');
const prompt = require('./rag/prompt');

// Test native host macro parser via internal function check
const fs = require('fs');
const text = fs.readFileSync('D:/SHETFUEK/extension/Full Macros.json', 'utf8');
const macros = {};
const lines = text.split(/\r?\n/);
let current = null;
let bodyLines = [];
for (const line of lines) {
  if (current === null) {
    if (line.startsWith('{') && line.length > 1) { current = line.slice(1).trim(); bodyLines = []; }
    continue;
  }
  if (line.endsWith('}')) {
    bodyLines.push(line.slice(0, -1));
    const id = current.replace(/::/g, '_').replace(/[^a-zA-Z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
    if (id) macros[id] = { id, title: current, body: bodyLines.join('\n').trim() };
    current = null; bodyLines = [];
    continue;
  }
  bodyLines.push(line);
}
console.log('HOST parser macros:', Object.keys(macros).length);
const anyBody = macros[Object.keys(macros)[0]].body;
console.log('body ends with } ?', anyBody.endsWith('}'));

// Test parseAndValidate with chat format + email format
const chatResp = JSON.stringify({
  issueTypeId: 'account_appissue_knownissue',
  macroId: 'livechat_hey',
  responseFormat: 'chat',
  extractedLines: ['Direct answer line'],
  greeting: null,
  signOff: null,
  dispositions: ['customer_favorable'],
  confidence: 0.85,
  adminNotes: { issue: 'login fail', solution: 'reset', other: 'uid 123', supportingDocumentation: 'sop' },
  reasoning: 'matched'
});
const r1 = prompt.parseAndValidate(chatResp, [], 't1');
console.log('\nCHAT parse: format=' + r1.responseFormat + ' greeting=' + r1.greeting + ' issue=' + r1.issueTypeId + ' disp=' + JSON.stringify(r1.dispositions));

const emailResp = JSON.stringify({
  issueTypeId: 'account_account_settings_edit_profile',
  macroId: 'account_edit_email',
  responseFormat: 'email',
  extractedLines: ['Body line 1', 'Body line 2'],
  greeting: 'Hi Vojtech,',
  signOff: 'Best,',
  dispositions: ['system_favorable'],
  confidence: 0.7,
  adminNotes: { issue: 'i', solution: 's', other: 'o', supportingDocumentation: 'd' },
  reasoning: 'r'
});
const r2 = prompt.parseAndValidate(emailResp, [], 't2');
console.log('EMAIL parse: format=' + r2.responseFormat + ' greeting=' + r2.greeting + ' signOff=' + r2.signOff + ' lines=' + r2.extractedLines.length);
console.log('adminNotes issue:', r2.adminNotes.issue);

// Test general_info rejection
const giResp = JSON.stringify({
  issueTypeId: 'general_info',
  macroId: null,
  responseFormat: 'chat',
  extractedLines: ['x'],
  dispositions: ['clarification_needed'],
  confidence: 0.4,
  adminNotes: { issue: '', solution: '', other: '', supportingDocumentation: '' },
  reasoning: ''
});
const r3 = prompt.parseAndValidate(giResp, [], 't3');
console.log('\ngeneral_info rejected: issueTypeId=' + JSON.stringify(r3.issueTypeId) + ' validationError=' + r3.validationError);
