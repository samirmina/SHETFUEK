/**
 * Load macro data in background context
 */

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
          macros[id] = { id, rawId: current, body: bodyLines.join('\n').trim(), title: current };
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

module.exports = { loadMacroData };