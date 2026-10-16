const fs = require('fs');
const text = fs.readFileSync('D:/SHETFUEK/extension/Full Macros.json', 'utf8');
const lines = text.split(/\r?\n/);
const macros = {};
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
    const id = current.replace(/::/g, '_').replace(/[^a-zA-Z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
    macros[id] = bodyLines.join('\n').trim();
    current = null;
    bodyLines = [];
    continue;
  }
  bodyLines.push(line);
}
const ids = Object.keys(macros);
console.log('TOTAL macros parsed:', ids.length);
console.log('first:', JSON.stringify(ids.slice(0, 5)));
const chat = ids.filter(i => /^live_chat/i.test(i));
console.log('live chat macros:', chat.length);
console.log('samples:', JSON.stringify(chat.slice(0, 10)));
console.log('body sample:', JSON.stringify(macros[ids[0]].slice(0, 120)));
