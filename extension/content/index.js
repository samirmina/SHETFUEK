/**
 * Content script entry point
 * Handles message passing between page and background
 */

// Initialize scrapers
const zendeskScraper = new ZendeskScraper();
const fmScraper = new FmScraper();

// Wait for page to render
function waitForRender(maxWaitMs = 8000) {
  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(() => {
      const root = document.querySelector('#root');
      const bodyText = document.body ? document.body.innerText.trim() : '';
      const hasRequester = document.querySelector('[data-test-id*="requester"], [data-test-id*="user"], .requester-info, [class*="requester"]') !== null;
      if ((root && root.children.length > 0 && bodyText.length > 200) || (hasRequester && bodyText.length > 200)) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start >= maxWaitMs) {
        clearInterval(interval);
        resolve(true);
      }
    }, 300);
  });
}

// Extract ticket data
function extractTicketData() {
  return zendeskScraper.extract();
}

// Extract FM data
function extractFmData() {
  return fmScraper.extract();
}

// Inject response into Zendesk editor
function injectResponse(text) {
  const selectors = [
    '[data-test-id="ticket-comment-editor"]',
    '.ticket-editor',
    '.comment-editor',
    '[contenteditable="true"]',
    'textarea[name="comment[body]"]',
    '.cke_wysiwyg_frame'
  ];
  
  let target = null;
  for (const sel of selectors) {
    target = document.querySelector(sel);
    if (target) break;
  }
  
  if (!target) {
    console.error('[ZendeskFM] Could not find Zendesk reply editor');
    return false;
  }
  
  if (target.tagName === 'TEXTAREA') {
    target.value = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (target.tagName === 'IFRAME') {
    try {
      const doc = target.contentDocument || target.contentWindow.document;
      if (doc && doc.body) {
        doc.body.innerHTML = text.replace(/\n/g, '<br>');
        doc.body.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (e) {
      console.error('[ZendeskFM] Failed to inject into iframe editor:', e);
      return false;
    }
  } else {
    target.focus();
    target.innerHTML = text.replace(/\n/g, '<br>');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

// Message handler
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ 
        pong: true, 
        ticketId: window.__zendeskData?.ticketId || null,
        fmPageType: window.__fmData?.pageType || null
      });
      return true;
    }
    
    if (message.action === 'getTicketData') {
      waitForRender().then(() => {
        sendResponse({ success: true, data: extractTicketData() });
      });
      return true;
    }
    
    if (message.action === 'getFmData') {
      waitForRender(5000).then(() => {
        sendResponse({ success: true, data: extractFmData() });
      });
      return true;
    }
    
    if (message.action === 'injectResponse') {
      const success = injectResponse(message.text);
      sendResponse({ success });
      return true;
    }
  });
}

// Auto-extract on load
waitForRender().then(() => {
  window.__zendeskData = extractTicketData();
  console.log('[ZendeskFM] Zendesk content script loaded. ticketId=' + (window.__zendeskData.ticketId || 'unknown') + ' url=' + window.location.href);
});

waitForRender(5000).then(() => {
  window.__fmData = extractFmData();
  console.log('[ZendeskFM] FM content script loaded. pageType=' + fmScraper.detectPageType() + ' url=' + window.location.href);
});