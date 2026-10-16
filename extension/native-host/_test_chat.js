const fs = require('fs');
const files = [
  'D:/SHETFUEK/extension/sop-data.json',
  'D:/SHETFUEK/extension/SOP_Reference_Macros_IssueTypes.json',
  'D:/SHETFUEK/extension/Full Macros.json'
];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  const m = t.match(/live[\s_-]*chat[^\n",]*/gi);
  console.log(f.split(/[\\/]/).pop() + ': ' + (m ? m.length : 0) + ' matches');
  if (m) console.log('  ' + JSON.stringify([...new Set(m)].slice(0, 12)));
}
