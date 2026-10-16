/**
 * Zendesk ticket page scraper
 */

class ZendeskScraper {
  extract() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const html = document.documentElement ? document.documentElement.innerHTML : '';
    
    return {
      ticketId: this.extractTicketId(fullText, html),
      status: this.extractStatus(fullText),
      subject: this.extractSubject(fullText),
      body: fullText,
      fullText: fullText,
      requesterEmail: this.extractRequesterEmail(fullText),
      requesterPhone: this.extractPhone(fullText),
      language: this.extractLanguage(fullText),
      userId: this.extractUserId(fullText, html),
      ivc: this.extractIVC(fullText),
      tags: this.extractTags(),
      url: window.location.href,
      structured: {
        country: this.extractField('country'),
        city: this.extractField('city'),
        partner: this.extractField('partner'),
        compensation: this.extractField('compensation'),
        issueType: this.extractField('issueType')
      },
      contactSummary: this.extractContactSummary(),
      publicReply: this.extractPublicReply(),
      internalNote: this.extractInternalNote(),
      fmIdentifier: this.extractFmIdentifier()
    };
  }
  
  extractTicketId(fullText, html) {
    const selectors = [
      '[data-test-id="ticket-id"]',
      '[data-test-id="ticket-number"]',
      '.ticket-id',
      '.ticket-number',
      '[data-field-id="id"]',
      '[data-test-id="tooltip-ticket-id"]',
      '[data-test-id="header-tab-subtitle"]'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const num = el.textContent.trim().replace(/[^\d]/g, '');
        if (num && num.length >= 3) return num;
      }
    }
    
    // Fallback patterns
    const patterns = [
      /Ticket\s*#?\s*(\d{3,})/i,
      /\/(tickets?)\/(\d{3,})/i,
      /#(\d{3,})/,
      /\/users\/(\d{3,})/
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern) || fullText.match(pattern);
      if (match) return match[match.length - 1];
    }
    
    // Entity ID
    const entityEl = document.querySelector('[data-entity-id][data-entity-type="ticket"]');
    if (entityEl) {
      const id = entityEl.getAttribute('data-entity-id');
      if (id && id.length >= 3) return id;
    }
    
    return '';
  }
  
  extractStatus(fullText) {
    const selectors = [
      '[data-test-id="ticket-status"]',
      '.ticket-status',
      '[data-field-id="status"]',
      '[data-test-id="status"]',
      '.status'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const status = el.textContent.trim().toLowerCase();
        if (status) return status;
      }
    }
    
    const match = fullText.match(/\b(Open|Pending|On-hold|Solved|Closed)\b/i);
    return match ? match[1].toLowerCase() : '';
  }
  
  extractSubject(fullText) {
    const selectors = [
      'h1',
      '[data-test-id="ticket-subject"]',
      '.ticket-subject',
      '.subject',
      '[data-field-id="subject"]'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 0) return el.textContent.trim();
    }
    
    const match = fullText.match(/Message du support(.+?)(?:\n|$)/i);
    return match ? match[1].trim() : '';
  }
  
  extractRequesterEmail(fullText) {
    const selectors = [
      '[data-test-id="requester-email"]',
      '[data-test-id="user-email"]',
      '.requester-email',
      '.user-email',
      '[data-field-id="requester_email"]',
      '[data-field-id="user_email"]',
      '[data-test-id="tooltip-requester-email"]',
      '.sc-ee51edef-7',
      '[class*="requester-email"]',
      '[class*="user-email"]'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const match = el.textContent.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (match) return match[1];
      }
    }
    
    // Mailto links
    const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
    for (const link of mailtoLinks) {
      const email = link.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim();
      if (email && email.includes('@')) return email;
    }
    
    // Full text extraction
    const candidates = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const avoidDomains = ['voi.com', 'zendesk.com', 'zdassets.com', 'support'];
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      if (!avoidDomains.some(d => lower.includes(d))) return candidate;
    }
    return candidates[0] || '';
  }
  
  extractPhone(fullText) {
    const match = fullText.match(/(\+?\d[\d\s-]{7,}\d)/);
    return match ? match[1] : '';
  }
  
  extractLanguage(fullText) {
    const match = fullText.match(/Language[:\s]+(\w+)/i);
    return match ? match[1] : '';
  }
  
  extractUserId(fullText, html) {
    // User links
    const userLinks = Array.from(document.querySelectorAll('a[href*="/users/"], a[href*="/agent/users/"]'));
    for (const link of userLinks) {
      const match = link.getAttribute('href').match(/\/users\/(\d{2,})/);
      if (match) return match[1];
    }
    
    // Data attributes
    const userIdEl = document.querySelector('[data-test-id*="user-id"], [data-test-id*="userid"], [data-field-id*="user_id"], [class*="user-id"]');
    if (userIdEl) {
      const uid = userIdEl.textContent.trim().replace(/[^\d]/g, '');
      if (uid.length >= 2) return uid;
    }
    
    // Text patterns
    const patterns = [
      /User\s*ID[:\s]+([^\n]+)/i,
      /user[_-]?id["']?\s*[:=]\s*["']?(\d{2,})/i,
      /Requester\s*ID[:\s]+([^\n]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = fullText.match(pattern) || html.match(pattern);
      if (match) return match[1].replace(/^User\s*ID[:\s]+/i, '').trim().split(/\s{2,}|\n/)[0].trim();
    }
    
    // From email
    const emailCandidates = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const avoidDomains = ['voi.com', 'zendesk.com', 'zdassets.com', 'support'];
    for (const candidate of emailCandidates) {
      const lower = candidate.toLowerCase();
      if (!avoidDomains.some(d => lower.includes(d))) {
        const numMatch = candidate.match(/^(\d+)/) || candidate.match(/(\d+)$/);
        if (numMatch) return numMatch[1];
      }
    }
    
    return '';
  }
  
  extractIVC(fullText) {
    const ivcEl = document.querySelector('[data-test-id*="ivc"], [class*="ivc"], [data-field-id="ivc"]');
    if (ivcEl) {
      let ivc = (ivcEl.textContent || '').replace(/^IVC\s*[:\s]*/i, '').trim();
      if (ivc) return ivc;
    }
    
    const ivcLines = fullText.split(/\r?\n/).filter(l => /IVC/i.test(l));
    if (ivcLines.length > 0) {
      let ivc = ivcLines[0].replace(/^.*?IVC\s*[:\s]*/i, '').trim();
      ivc = ivc.replace(/^score[,\s]*/i, '').trim();
      if (ivc.length > 300) ivc = ivc.slice(0, 300).trim();
      return ivc;
    }
    
    const match = fullText.match(/IVC[:\s]+([^\n]+)/i);
    return match ? match[1].trim() : '';
  }
  
  extractField(fieldName) {
    const labelPatterns = {
      country: /Country[:\s]+([^\n]+)/i,
      city: /City[:\s]+([^\n]+)/i,
      partner: /Partner[:\s]+([^\n]+)/i,
      compensation: /Compensation[:\s]+([^\n]+)/i,
      issueType: /Issue\s*Type[:\s]+([^\n]+)/i
    };
    
    const pattern = labelPatterns[fieldName];
    if (!pattern) return '';
    
    // Try data-test-id selectors first
    const selectors = [
      `[data-test-id="ticket-${fieldName}"]`,
      `.ticket-${fieldName}`,
      `[data-field-id="${fieldName}"]`
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.textContent.trim();
    }
    
    // Try field containers
    const containers = document.querySelectorAll('[data-test-id="ticket-fields"], .ticket-fields, .metadata-fields, .custom-fields, [data-test-id*="field"], [class*="field"]');
    for (const container of containers) {
      const text = container.innerText || container.textContent || '';
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    
    // Full page fallback
    const metaSection = document.querySelector('[data-test-id="ticket-fields"], .ticket-fields, .metadata-fields, .custom-fields');
    if (metaSection) {
      const text = metaSection.innerText || metaSection.textContent || '';
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    
    return '';
  }
  
  extractTags() {
    const selectors = [
      '.tag-list .tag',
      '[data-test-id="ticket-tags"] .tag',
      '.ticket-tags .tag',
      '[data-field-id="tags"] .tag'
    ];
    
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        return Array.from(els).map(el => el.textContent.trim()).filter(Boolean);
      }
    }
    return [];
  }
  
  extractPublicReply() {
    const selectors = [
      '[contenteditable="true"]',
      '.cke_editable',
      '.cke_wysiwyg_frame',
      'textarea[name*="comment"]',
      '[data-test-id="ticket-comment-editor"]',
      '.ticket-editor'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 10) {
        return el.innerText.trim();
      }
    }
    return '';
  }
  
  extractInternalNote() {
    const selectors = [
      '[data-test-id="internal-note"]',
      '.internal-note-editor',
      '.note-editor'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 5) {
        return el.innerText.trim();
      }
    }
    return '';
  }
  
  extractContactSummary() {
    const selectors = [
      '[data-test-id="contact-summary"]',
      '.contact-summary',
      '.requester-info'
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.innerText.trim();
    }
    return '';
  }
  
  extractFmIdentifier() {
    const links = Array.from(document.querySelectorAll('a[href]'));
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (href.includes('/riders/') || href.includes('/profile/')) {
        const match = href.match(/\/(riders|profile)\/([^\/?#]+)/);
        if (match) return match[2];
      }
    }
    return null;
  }
}

window.ZendeskScraper = ZendeskScraper;