/**
 * Load SOP data in background context
 */

async function loadSopData() {
  try {
    const url = chrome.runtime.getURL('sop-data.json');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load SOP data');
    return await response.json();
  } catch (error) {
    console.error('Error loading SOP data:', error);
    return { sops: [] };
  }
}

module.exports = { loadSopData };