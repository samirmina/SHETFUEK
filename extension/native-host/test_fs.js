console.log('Testing fs access...');
const fs = require('fs');
const path = require('path');

const loggerPath = path.resolve(__dirname, '..', 'logs', 'logger.js');
console.log('Resolved path:', loggerPath);
console.log('Exists:', fs.existsSync(loggerPath));

try {
  const content = fs.readFileSync(loggerPath, 'utf8');
  console.log('Content length:', content.length);
} catch (e) {
  console.log('Read error:', e.message);
}

// Try require
try {
  const logger = require('./logs/logger');
  console.log('Require success:', typeof logger.log);
} catch (e) {
  console.log('Require error:', e.message);
}