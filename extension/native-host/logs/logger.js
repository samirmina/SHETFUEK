/**
 * Simple logger for native host
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'native-host.log');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function formatLog(entry) {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${entry.phase}] [${entry.step}] ${entry.status || ''} ${JSON.stringify(entry)}\n`;
}

function log(entry) {
  const line = formatLog(entry);
  fs.appendFileSync(LOG_FILE, line, 'utf8');
  // Also output to console for debugging
  if (entry.status === 'error' || entry.status === 'warning') {
    console.error(line.trim());
  } else {
    console.log(line.trim());
  }
}

module.exports = { log };