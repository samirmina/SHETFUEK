const fs = require('fs');
const sop = JSON.parse(fs.readFileSync('D:/SHETFUEK/extension/sop-data.json', 'utf8'));
console.log('top-level keys:', JSON.stringify(Object.keys(sop)));
if (sop.macros) {
  const keys = Object.keys(sop.macros);
  console.log('macros count:', keys.length);
  const chat = keys.filter(k => /^livechat/i.test(k));
  console.log('livechat macros with bodies:', chat.length, JSON.stringify(chat));
  if (chat[0]) console.log('sample:', JSON.stringify(sop.macros[chat[0]]).slice(0, 400));
}
const it = sop.issueTypes[0];
console.log('issueType keys:', JSON.stringify(Object.keys(it)));
