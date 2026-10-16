/**
 * Load and normalize macros from Full Macros.json
 */

const fs = require('fs');
const path = require('path');
const { normalizeMacroId } = require('../../shared/utils');

const MACROS_DATA_PATH = path.resolve(__dirname, '..', '..', 'Full Macros.json');

let cachedMacros = null;
let cachedMacroMap = null;

function loadMacrosData() {
  if (cachedMacros) return cachedMacros;
  
  try {
    const text = fs.readFileSync(MACROS_DATA_PATH, 'utf8');
    const macros = {};
    
    // Parse format: {Macro::Name\nBody text...}
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
          macros[id] = {
            id: id,
            rawId: current,
            body: bodyLines.join('\n').trim(),
            title: current
          };
        }
        current = null;
        bodyLines = [];
        continue;
      }
      bodyLines.push(line);
    }
    
    cachedMacros = macros;
    cachedMacroMap = Object.values(macros);
    return macros;
  } catch (e) {
    console.error('Failed to load macros:', e.message);
    return {};
  }
}

function getAllMacros() {
  loadMacrosData();
  return cachedMacroMap;
}

function getMacroById(id) {
  loadMacrosData();
  return cachedMacros[id] || null;
}

function getMacroBody(id) {
  const macro = getMacroById(id);
  return macro ? macro.body : '';
}

function searchMacros(query) {
  const macros = getAllMacros();
  const q = String(query || '').toLowerCase();
  if (!q) return macros;
  return macros.filter(m => 
    m.id.toLowerCase().includes(q) || 
    m.title.toLowerCase().includes(q) ||
    m.body.toLowerCase().includes(q)
  );
}

function getMacrosForIssueType(issueTypeId, issueTypesModule) {
  const issueType = issueTypesModule.getIssueTypeById(issueTypeId);
  if (!issueType || !issueType.relatedMacros) return [];
  
  loadMacrosData();
  return issueType.relatedMacros
    .map(id => cachedMacros[id])
    .filter(Boolean);
}

module.exports = {
  loadMacrosData,
  getAllMacros,
  getMacroById,
  getMacroBody,
  searchMacros,
  getMacrosForIssueType
};