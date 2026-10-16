(function() {
  'use strict';

  function getText(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  function getAttribute(selector, attr) {
    const el = document.querySelector(selector);
    return el ? el.getAttribute(attr) : '';
  }

  function regexExtract(text, pattern, group) {
    const match = text.match(pattern);
    return match && match[group] ? match[group].trim() : '';
  }

  function logToNativeHost(entry) {
    try {
      if (typeof window.__extLog === 'function') window.__extLog(entry);
    } catch (e) {}
  }

  // Lightweight ticket-ID extraction used for render-stability checks and
  // ticket-change detection. Does not touch the heavy full-page extraction.
  function extractTicketId() {
    var ticketIdSelectors = [
      '[data-test-id="ticket-id"]',
      '[data-test-id="ticket-number"]',
      '.ticket-id',
      '.ticket-number',
      '[data-field-id="id"]',
      '[data-test-id="tooltip-ticket-id"]',
      '[data-test-id="header-tab-subtitle"]'
    ];
    for (var s = 0; s < ticketIdSelectors.length; s++) {
      var el = document.querySelector(ticketIdSelectors[s]);
      if (el) {
        var raw = el.textContent.trim();
        var num = raw.replace(/[^\d]/g, '');
        if (num && num.length >= 3) return num;
      }
    }
    var fullText = document.body ? document.body.innerText.trim() : '';
    var html = document.documentElement ? document.documentElement.innerHTML : '';
    var ticketIdMatch = html.match(/Ticket\s*#?\s*(\d{3,})/i) || fullText.match(/Ticket\s*#?\s*(\d{3,})/i);
    if (ticketIdMatch) return ticketIdMatch[1];
    var pathMatch = html.match(/\/(tickets?)\/(\d{3,})/i) || fullText.match(/\/(tickets?)\/(\d{3,})/i);
    if (pathMatch) return pathMatch[2];
    var hashMatch = fullText.match(/#(\d{3,})/);
    if (hashMatch) return hashMatch[1];
    var entityIdEl = document.querySelector('[data-entity-id][data-entity-type="ticket"]');
    if (entityIdEl) {
      var entityId = entityIdEl.getAttribute('data-entity-id');
      if (entityId && entityId.length >= 3) return entityId;
    }
    return '';
  }

  function waitForRender(maxWaitMs) {
    // Zendesk's agent workspace is an SPA: switching tickets (tooltip panels)
    // never reloads the document, so a one-shot render check resolves against
    // whatever is in the DOM at call time — often the PREVIOUS ticket. Instead,
    // wait until a ticket ID is present and has stayed identical across two
    // consecutive polls (i.e. the DOM is no longer mid-switch), with a
    // deadline fallback to the old behaviour.
    maxWaitMs = maxWaitMs || 10000;
    return new Promise(function(resolve) {
      var start = Date.now();
      var lastKey = null;
      var stablePolls = 0;
      var interval = setInterval(function() {
        var key = extractTicketId() || 'no-ticket';
        if (key === lastKey) {
          stablePolls++;
        } else {
          stablePolls = 0;
          lastKey = key;
        }
        if ((key !== 'no-ticket' && stablePolls >= 2) || Date.now() - start >= maxWaitMs) {
          clearInterval(interval);
          resolve(true);
        }
      }, 400);
    });
  }

  function extractTicketData() {
    var fullText = document.body ? document.body.innerText.trim() : '';
    var html = document.documentElement ? document.documentElement.innerHTML : '';

    var ticketId = extractTicketId();

    var status = '';
    var statusSelectors = [
      '[data-test-id="ticket-status"]',
      '.ticket-status',
      '[data-field-id="status"]',
      '[data-test-id="status"]',
      '.status'
    ];
    for (var s = 0; s < statusSelectors.length; s++) {
      var el = document.querySelector(statusSelectors[s]);
      if (el) {
        status = el.textContent.trim().toLowerCase();
        if (status) break;
      }
    }
    if (!status) {
      var statusMatch = fullText.match(/\b(Open|Pending|On-hold|Solved|Closed)\b/i);
      if (statusMatch) status = statusMatch[1].toLowerCase();
    }

    var subject = '';
    var subjectSelectors = [
      'h1',
      '[data-test-id="ticket-subject"]',
      '.ticket-subject',
      '.subject',
      '[data-field-id="subject"]'
    ];
    for (var s = 0; s < subjectSelectors.length; s++) {
      var el = document.querySelector(subjectSelectors[s]);
      if (el && el.textContent.trim().length > 0) {
        subject = el.textContent.trim();
        break;
      }
    }
    if (!subject) {
      var subjectMatch = fullText.match(/Message du support(.+?)(?:\n|$)/i);
      if (subjectMatch) subject = subjectMatch[1].trim();
    }

    var requesterEmail = '';
    var requesterName = '';
    var requesterNameEl = document.querySelector('[data-test-id="tooltip-requester-name"], [data-test-id="requester-name"], .requester-name, [data-field-id="requester_name"]');
    if (requesterNameEl) {
      requesterName = requesterNameEl.textContent.trim();
    }
    var requesterEmailSelectors = [
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
    for (var s = 0; s < requesterEmailSelectors.length; s++) {
      var el = document.querySelector(requesterEmailSelectors[s]);
      if (el) {
        var emailMatch = el.textContent.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          requesterEmail = emailMatch[1];
          break;
        }
      }
    }
    if (!requesterEmail) {
      var mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
      for (var m = 0; m < mailtoLinks.length; m++) {
        var href = mailtoLinks[m].getAttribute('href') || '';
        var email = href.replace(/^mailto:/i, '').split('?')[0].trim();
        if (email && email.indexOf('@') !== -1) {
          requesterEmail = email;
          break;
        }
      }
    }
    if (!requesterEmail) {
      var emailCandidates = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      if (emailCandidates.length > 0) {
        var avoidDomains = ['voi.com', 'zendesk.com', 'zdassets.com', 'support'];
        for (var e = 0; e < emailCandidates.length; e++) {
          var candidate = emailCandidates[e].toLowerCase();
          var isInternal = false;
          for (var d = 0; d < avoidDomains.length; d++) {
            if (candidate.indexOf(avoidDomains[d]) !== -1) {
              isInternal = true;
              break;
            }
          }
          if (!isInternal) {
            requesterEmail = emailCandidates[e];
            break;
          }
        }
        if (!requesterEmail) {
          requesterEmail = emailCandidates[0];
        }
      }
    }
    var requesterPhone = regexExtract(fullText, /(\+?\d[\d\s-]{7,}\d)/, 1);

    var language = '';
    var langMatch = fullText.match(/Language[:\s]+(\w+)/i);
    if (langMatch) language = langMatch[1];

    var userId = '';
    var userLinks = Array.from(document.querySelectorAll('a[href*="/users/"], a[href*="/agent/users/"]'));
    for (var u = 0; u < userLinks.length; u++) {
      var href = userLinks[u].getAttribute('href') || '';
      var userMatch = href.match(/\/users\/(\d{2,})/);
      if (userMatch) {
        userId = userMatch[1];
        break;
      }
    }
    if (!userId) {
      var userIdEl = document.querySelector('[data-test-id*="user-id"], [data-test-id*="userid"], [data-field-id*="user_id"], [class*="user-id"]');
      if (userIdEl) {
        var uidText = (userIdEl.textContent || '').trim();
        var uidNum = uidText.replace(/[^\d]/g, '');
        if (uidNum.length >= 2) userId = uidNum;
      }
    }
    if (!userId) userId = regexExtract(fullText, /User\s*ID[:\s]+([^\n]+)/i, 1);
    if (!userId) userId = regexExtract(html, /user[_-]?id["']?\s*[:=]\s*["']?(\d{2,})/i, 1);
    if (!userId) {
      var requesterIdMatch = fullText.match(/Requester\s*ID[:\s]+([^\n]+)/i);
      if (requesterIdMatch) userId = requesterIdMatch[1];
    }
    if (!userId) {
      // Try to extract from requester email context — some Zendesk instances embed user ID differently
      var emailCandidates = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      if (emailCandidates.length > 0) {
        var avoidDomains = ['voi.com', 'zendesk.com', 'zdassets.com', 'support'];
        for (var e = 0; e < emailCandidates.length; e++) {
          var candidate = emailCandidates[e].toLowerCase();
          var isInternal = false;
          for (var d = 0; d < avoidDomains.length; d++) {
            if (candidate.indexOf(avoidDomains[d]) !== -1) {
              isInternal = true;
              break;
            }
          }
          if (!isInternal) {
            // Some Zendesk instances embed user ID as numeric prefix or suffix
            var numMatch = candidate.match(/^(\d+)/) || candidate.match(/(\d+)$/);
            if (numMatch) {
              userId = numMatch[1];
              break;
            }
          }
        }
      }
    }
    if (userId) {
      userId = userId.replace(/^User\s*ID[:\s]+/i, '').trim();
      userId = userId.split(/\s{2,}|\n/)[0].trim();
    }

    var ivc = '';
    var ivcEl = document.querySelector('[data-test-id*="ivc"], [class*="ivc"], [data-field-id="ivc"]');
    if (ivcEl) {
      ivc = (ivcEl.textContent || '').replace(/^IVC\s*[:\s]*/i, '').trim();
    }
    if (!ivc) {
      var ivcLine = fullText.split(/\r?\n/).filter(function(l) {
        return /IVC/i.test(l);
      });
      if (ivcLine.length > 0) {
        ivc = ivcLine[0].replace(/^.*?IVC\s*[:\s]*/i, '').trim();
      }
    }
    if (!ivc) ivc = regexExtract(fullText, /IVC[:\s]+([^\n]+)/i, 1);
    if (ivc) {
      ivc = ivc.replace(/^score[,\s]*/i, '').trim();
      if (ivc.length > 300) ivc = ivc.slice(0, 300).trim();
    }

    var country = getText('[data-test-id="ticket-country"], .ticket-country, [data-field-id="country"]');
    var city = getText('[data-test-id="ticket-city"], .ticket-city, [data-field-id="city"]');
    var partner = getText('[data-test-id="ticket-partner"], .ticket-partner, [data-field-id="partner"]');
    var compensation = getText('[data-test-id="ticket-compensation"], .ticket-compensation, [data-field-id="compensation"]');
    var issueType = '';

    var issueTypeContainer = document.querySelector('[data-test-id="ticket-issue-type"], .ticket-issue-type, [data-field-id="issue_type"], [name="issue_type"]');
    if (issueTypeContainer) {
      issueType = issueTypeContainer.textContent.trim();
    }

    // Try to find country/city from custom ticket field containers by label text proximity.
    if (!country || !city) {
      var fieldContainers = document.querySelectorAll('[data-test-id="ticket-fields"], .ticket-fields, .metadata-fields, .custom-fields, [data-test-id*="field"], [class*="field"]');
      for (var f = 0; f < fieldContainers.length; f++) {
        var fieldText = fieldContainers[f].innerText || fieldContainers[f].textContent || '';
        if (!country) country = regexExtract(fieldText, /Country[:\s*]+([^\n]+)/i, 1);
        if (!city) city = regexExtract(fieldText, /City[:\s*]+([^\n]+)/i, 1);
        if (!partner) partner = regexExtract(fieldText, /Partner[:\s*]+([^\n]+)/i, 1);
        if (!compensation) compensation = regexExtract(fieldText, /Compensation[:\s*]+([^\n]+)/i, 1);
        if (!issueType) issueType = regexExtract(fieldText, /Issue\s*Type[:\s*]+([^\n]+)/i, 1);
        if (country && city) break;
      }
    }

    // Also try full-page text for country/city if still missing.
    if (!country || !city) {
      var metaSection = document.querySelector('[data-test-id="ticket-fields"], .ticket-fields, .metadata-fields, .custom-fields');
      if (metaSection) {
        var metaText = metaSection.innerText || metaSection.textContent || '';
        if (!country) country = regexExtract(metaText, /Country[:\s]+([^\n]+)/i, 1);
        if (!city) city = regexExtract(metaText, /City[:\s]+([^\n]+)/i, 1);
        if (!partner) partner = regexExtract(metaText, /Partner[:\s]+([^\n]+)/i, 1);
        if (!compensation) compensation = regexExtract(metaText, /Compensation[:\s]+([^\n]+)/i, 1);
        if (!issueType) issueType = regexExtract(metaText, /Issue\s*Type[:\s]+([^\n]+)/i, 1);
      }
    }

    var tags = [];
    var tagSelectors = ['.tag-list .tag', '[data-test-id="ticket-tags"] .tag', '.ticket-tags .tag', '[data-field-id="tags"] .tag'];
    for (var s = 0; s < tagSelectors.length; s++) {
      var tagEls = document.querySelectorAll(tagSelectors[s]);
      if (tagEls.length > 0) {
        tags = Array.from(tagEls).map(function(el) { return el.textContent.trim(); }).filter(Boolean);
        break;
      }
    }

    var publicReplyText = '';
    var replyEditors = document.querySelectorAll('[contenteditable="true"], .cke_editable, .cke_wysiwyg_frame, textarea[name*="comment"], [data-test-id="ticket-comment-editor"], .ticket-editor');
    for (var i = 0; i < replyEditors.length; i++) {
      var editor = replyEditors[i];
      if (editor.innerText && editor.innerText.trim().length > 10) {
        publicReplyText = editor.innerText.trim();
        break;
      }
    }

    var internalNoteText = '';
    var noteEditors = document.querySelectorAll('[data-test-id="internal-note"], .internal-note-editor, .note-editor');
    for (var n = 0; n < noteEditors.length; n++) {
      if (noteEditors[n].innerText && noteEditors[n].innerText.trim().length > 5) {
        internalNoteText = noteEditors[n].innerText.trim();
        break;
      }
    }

    var contactSummary = '';
    var contactSection = document.querySelector('[data-test-id="contact-summary"], .contact-summary, .requester-info');
    if (contactSection) {
      contactSummary = contactSection.innerText.trim();
    }

    var fmIdentifier = null;
    var links = Array.from(document.querySelectorAll('a[href]'));
    for (var l = 0; l < links.length; l++) {
      var href = links[l].getAttribute('href') || '';
      if (href.indexOf('/riders/') !== -1 || href.indexOf('/profile/') !== -1) {
        var idMatch = href.match(/\/(riders|profile)\/([^\/?#]+)/);
        if (idMatch) {
          fmIdentifier = idMatch[2];
          break;
        }
      }
    }

    console.log('[ZendeskFM] Extracted ticket data:', {
      ticketId: ticketId,
      requesterEmail: requesterEmail,
      requesterName: requesterName,
      userId: userId,
      fmIdentifier: fmIdentifier
    });

    return {
      ticketId: ticketId,
      status: status,
      subject: subject,
      body: fullText,
      fullText: fullText,
      requesterEmail: requesterEmail,
      requesterPhone: requesterPhone,
      language: language,
      userId: userId,
      ivc: ivc,
      tags: tags,
      url: window.location.href,
      structured: {
        country: country,
        city: city,
        partner: partner,
        compensation: compensation,
        issueType: issueType
      },
      contactSummary: contactSummary,
      publicReply: publicReplyText,
      internalNote: internalNoteText,
      customerLinks: [],
      fmIdentifier: fmIdentifier
    };
  }

  function injectResponseIntoZendesk(text) {
    var editorSelectors = [
      '[data-test-id="ticket-comment-editor"]',
      '.ticket-editor',
      '.comment-editor',
      '[contenteditable="true"]',
      'textarea[name="comment[body]"]',
      '.cke_wysiwyg_frame'
    ];

    var target = null;
    for (var s = 0; s < editorSelectors.length; s++) {
      target = document.querySelector(editorSelectors[s]);
      if (target) break;
    }

    if (!target) {
      console.error('Could not find Zendesk reply editor');
      return;
    }

    if (target.tagName === 'TEXTAREA') {
      target.value = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (target.tagName === 'IFRAME') {
      try {
        var doc = target.contentDocument || target.contentWindow.document;
        if (doc && doc.body) {
          doc.body.innerHTML = text.replace(/\n/g, '<br>');
          doc.body.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (e) {
        console.error('Failed to inject into iframe editor:', e);
      }
    } else {
      target.focus();
      target.innerHTML = text.replace(/\n/g, '<br>');
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  var currentTicketId = '';

  function onTicketDataReady(reason) {
    var data = extractTicketData();
    var newTicketId = data.ticketId || '';
    var changed = newTicketId !== '' && newTicketId !== currentTicketId;
    var firstDetection = currentTicketId === '' && newTicketId !== '';
    currentTicketId = newTicketId;
    window.__zendeskData = data;

    logToNativeHost({
      phase: 'content', step: 'ticket-detected', status: 'start',
      ticketId: newTicketId || null, changed: changed, reason: reason,
      requesterEmail: data.requesterEmail || null, url: window.location.href
    });

    if (changed && !firstDetection && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ action: 'ticketChanged', ticketData: data });
      } catch (e) {}
    }
    return data;
  }

  waitForRender().then(function() {
    onTicketDataReady('initial-load');
    console.log('[ZendeskFM] Zendesk content script loaded. ticketId=' + (window.__zendeskData.ticketId || 'unknown') + ' url=' + window.location.href);
  });

  // Zendesk switches tickets inside tooltip panels without reloading the
  // document, so the content script (injected once per document) would keep
  // serving the first ticket's data forever. Watch the DOM and re-extract
  // whenever the ticket ID actually changes.
  var observerTimer = null;
  function scheduleRecheck() {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(function() {
      observerTimer = null;
      var id = extractTicketId();
      if (id && id !== currentTicketId) {
        onTicketDataReady('dom-change');
      }
    }, 700);
  }

  try {
    var domObserver = new MutationObserver(function(mutations) {
      if (observerTimer) return;
      scheduleRecheck();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    logToNativeHost({ phase: 'content', step: 'observer', status: 'error', error: String(e && e.message || e) });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
      if (message.action === 'ping') {
        sendResponse({ pong: true, ticketId: window.__zendeskData ? window.__zendeskData.ticketId : null });
        return true;
      }
      if (message.action === 'getTicketData') {
        waitForRender().then(function() {
          var data = onTicketDataReady('on-demand');
          logToNativeHost({ phase: 'content', step: 'getTicketData', status: 'complete', ticketId: data.ticketId || null });
          sendResponse({ success: true, data: data });
        });
        return true;
      }
      if (message.action === 'injectResponse') {
        injectResponseIntoZendesk(message.text);
        logToNativeHost({ phase: 'content', step: 'injectResponse', status: 'complete', textLength: (message.text || '').length });
        sendResponse({ success: true });
        return true;
      }
    });
  }
})();
