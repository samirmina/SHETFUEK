/**
 * Unified page scraper base class
 */

class BaseScraper {
  constructor() {
    this.selectors = {};
  }
  
  getText(selector, context = document) {
    const el = context.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }
  
  getAttribute(selector, attr, context = document) {
    const el = context.querySelector(selector);
    return el ? el.getAttribute(attr) : '';
  }
  
  regexExtract(text, pattern, group = 1) {
    const match = text.match(pattern);
    return match && match[group] ? match[group].trim() : '';
  }
  
  findFirst(selectors, context = document) {
    for (const sel of selectors) {
      const el = context.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
  
  getTextFromSelectors(selectors, context = document) {
    for (const sel of selectors) {
      const el = context.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return '';
  }
  
  waitForRender(maxWaitMs = 8000, checkFn) {
    return new Promise(resolve => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (checkFn()) {
          clearInterval(interval);
          resolve(true);
        } else if (Date.now() - start >= maxWaitMs) {
          clearInterval(interval);
          resolve(true);
        }
      }, 300);
    });
  }
}

window.BaseScraper = BaseScraper;