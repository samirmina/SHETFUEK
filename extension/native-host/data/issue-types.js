/**
 * Load and normalize SOP issue types
 */

const fs = require('fs');
const path = require('path');
const { normalizeMacroId } = require('../../shared/utils');

const SOP_DATA_PATH = path.resolve(__dirname, '..', '..', 'sop-data.json');

let cachedIssueTypes = null;
let cachedIssueTypeMap = null;
let cachedCategories = null;

function loadSopData() {
  try {
    return JSON.parse(fs.readFileSync(SOP_DATA_PATH, 'utf8'));
  } catch (e) {
    console.error('Failed to load SOP data:', e.message);
    return { sops: [] };
  }
}

function buildIssueTypeList() {
  if (cachedIssueTypes) return cachedIssueTypes;
  
  const sopData = loadSopData();
  const issueTypes = [];
  const issueTypeMap = {};
  
  for (const sop of sopData.sops || []) {
    for (const issueTypeId of sop.issueTypes || []) {
      if (!issueTypeId) continue;
      
      // Extract category from issue type ID
      const categoryMatch = issueTypeId.match(/^([a-z]+)_/);
      const category = categoryMatch ? categoryMatch[1] : 'unknown';
      
      // Find related macros for this SOP
      const relatedMacros = (sop.macros || []).map(normalizeMacroId).filter(Boolean);
      
      const issueType = {
        id: issueTypeId,
        name: formatIssueTypeName(issueTypeId),
        category: category,
        sopName: sop.sopName,
        sopLink: sop.pageLink,
        relatedMacros: relatedMacros
      };
      
      issueTypes.push(issueType);
      issueTypeMap[issueTypeId] = issueType;
    }
  }
  
  // Sort by category then name
  issueTypes.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
  
  cachedIssueTypes = issueTypes;
  cachedIssueTypeMap = issueTypeMap;
  return issueTypes;
}

function formatIssueTypeName(id) {
  return id
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getAllIssueTypes() {
  return buildIssueTypeList();
}

function getIssueTypeById(id) {
  buildIssueTypeList(); // Ensure loaded
  return cachedIssueTypeMap[id] || null;
}

function getValidIssueTypeIds() {
  return buildIssueTypeList().map(it => it.id);
}

function getIssueTypesByCategory(category) {
  return buildIssueTypeList().filter(it => it.category === category);
}

function getCategories() {
  if (cachedCategories) return cachedCategories;
  const issueTypes = buildIssueTypeList();
  const categories = [...new Set(issueTypes.map(it => it.category))].filter(Boolean).sort();
  cachedCategories = categories;
  return categories;
}

function getIssueTypesForCategory(category) {
  return buildIssueTypeList().filter(it => it.category === category);
}

function getRelatedMacrosForIssueType(issueTypeId) {
  const issueType = getIssueTypeById(issueTypeId);
  return issueType ? issueType.relatedMacros : [];
}

function filterIssueTypesByCategories(categories) {
  if (!categories || categories.length === 0) return buildIssueTypeList();
  const categorySet = new Set(categories);
  return buildIssueTypeList().filter(it => categorySet.has(it.category));
}

module.exports = {
  loadSopData,
  getAllIssueTypes,
  getIssueTypeById,
  getValidIssueTypeIds,
  getIssueTypesByCategory,
  getCategories,
  getIssueTypesForCategory,
  getRelatedMacrosForIssueType,
  filterIssueTypesByCategories,
  buildIssueTypeList
};