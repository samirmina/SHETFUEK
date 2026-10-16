const fs = require('fs');
const text = fs.readFileSync('D:/SHETFUEK/extension/Full Macros.json', 'utf8');

// Replicate popup.js parser
function normalizeMacroId(rawId) {
  return String(rawId)
    .replace(/::/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

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
    if (id) macros[id] = { id: id, rawId: current, body: bodyLines.join('\n').trim(), title: current };
    current = null;
    bodyLines = [];
    continue;
  }
  bodyLines.push(line);
}

console.log('POPUP parser macros:', Object.keys(macros).length);
const sample = Object.keys(macros)[0];
console.log('sample body:', JSON.stringify(macros[sample].body.slice(0, 150)));
console.log('body ends with } ?', macros[sample].body.endsWith('}'));

// Merge sop macros
const sop = JSON.parse(fs.readFileSync('D:/SHETFUEK/extension/sop-data.json', 'utf8'));
for (const macroId of Object.keys(sop.macros)) {
  const m = sop.macros[macroId];
  if (!macros[macroId]) macros[macroId] = { id: macroId, rawId: m.title || macroId, body: m.body || '', title: m.title || macroId };
}
console.log('AFTER sop merge:', Object.keys(macros).length);

function isChatMacroId(id) {
  return /^livechat/i.test(String(id || '')) || /^live_chat/i.test(String(id || ''));
}
const chat = Object.keys(macros).filter(isChatMacroId);
const email = Object.keys(macros).filter(id => !isChatMacroId(id));
console.log('CHAT macros:', chat.length, JSON.stringify(chat));
console.log('EMAIL macros:', email.length);
console.log('email sample:', JSON.stringify(email.slice(0, 5)));

// Verify issue types
console.log('\nissueTypes:', sop.issueTypes.length);
console.log('first name:', sop.issueTypes[0].name);
const withNames = sop.issueTypes.filter(it => it.name && it.name.includes('::')).length;
console.log('issueTypes with :: hierarchy names:', withNames);
