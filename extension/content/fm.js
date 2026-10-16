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

  function detectPageType() {
    const url = window.location.href;
    const path = window.location.pathname.toLowerCase();

    if (path.indexOf('/ride-inspector') !== -1) return 'service_inspector';
    if (path.indexOf('/riders/') !== -1 || path.indexOf('/rider/') !== -1) return 'profile';
    if (path.indexOf('/config-hub') !== -1 || path.indexOf('/confighub') !== -1) return 'config_hub';
    if (path.indexOf('/vehicle-map') !== -1 || path.indexOf('/vehiclemap') !== -1) return 'map_view';
    return 'unknown';
  }

  function extractProfileData() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = {
      pageType: 'profile',
      entityId: null,
      name: getText('[data-test-id="profile-name"], .profile-name, h1, [class*="name"]'),
      email: getText('[data-test-id="profile-email"], .profile-email, [class*="email"]'),
      phone: getText('[data-test-id="profile-phone"], .profile-phone, [class*="phone"]'),
      city: getText('[data-test-id="profile-city"], .profile-city, [class*="city"]'),
      country: getText('[data-test-id="profile-country"], .profile-country, [class*="country"]'),
      partner: getText('[data-test-id="profile-partner"], .profile-partner, [class*="partner"]'),
      serviceEntries: [],
      transactionHistory: [],
      flags: [],
      rawText: fullText
    };

    const headerEl = document.querySelector('[class*="header"], [class*="Header"], [class*="profile-header"], [data-test-id="profile-header"]');
    if (headerEl) {
      const headerText = headerEl.innerText || headerEl.textContent || '';
      if (headerText.toLowerCase().indexOf('rider') !== -1) {
        data.partner = data.partner || 'VOI Customer';
      }
      const partnerMatch = headerText.match(/(ASEAG|Free Now|HVV Switch|Jelbi|KVV|Leipzig|MEEP|Reach Now|REDY|Rheinbahn|Ruter|SBB|Splyt|SWM|Telepass|Travis|Trafi|Urbi|VAG|WeTaxi|WHIM|Hyre|MOV A|YUMUV|MVGO|NOBINA|SOLENT|NUREMBERG)/i);
      if (partnerMatch) {
        data.partner = partnerMatch[1];
      }
    }

    if (!data.partner && fullText) {
      if (fullText.toLowerCase().indexOf('rider') !== -1 && fullText.toLowerCase().indexOf('partner') === -1) {
        data.partner = 'VOI Customer';
      }
    }

    const serviceRows = Array.from(document.querySelectorAll('[data-test-id="service-entry"], .service-row, .history-item, [class*="service"], [class*="history"]'));
    for (let r = 0; r < serviceRows.length; r++) {
      const row = serviceRows[r];
      const rowText = row.innerText || row.textContent || '';
      data.serviceEntries.push({
        date: getText('[data-test-id="service-date"], .service-date', row),
        type: getText('[data-test-id="service-type"], .service-type', row),
        status: getText('[data-test-id="service-status"], .service-status', row),
        raw: rowText.substring(0, 200)
      });
      if (rowText.toLowerCase().indexOf('incomplete') !== -1 || rowText.toLowerCase().indexOf('failed') !== -1) {
        data.flags.push('service_incomplete');
      }
      if (rowText.toLowerCase().indexOf('battery') !== -1 || rowText.toLowerCase().indexOf('power') !== -1) {
        data.flags.push('battery_issue');
      }
    }

    const txRows = Array.from(document.querySelectorAll('[data-test-id="transaction"], .transaction-row, [class*="transaction"]'));
    for (let t = 0; t < txRows.length; t++) {
      const row = txRows[t];
      const rowText = row.innerText || row.textContent || '';
      data.transactionHistory.push({
        date: getText('[data-test-id="tx-date"], .tx-date', row),
        amount: getText('[data-test-id="tx-amount"], .tx-amount', row),
        status: getText('[data-test-id="tx-status"], .tx-status', row),
        raw: rowText.substring(0, 200)
      });
      if (rowText.toLowerCase().indexOf('refund') !== -1 || rowText.toLowerCase().indexOf('eligible') !== -1) {
        data.flags.push('refund_eligible');
      }
      if (rowText.toLowerCase().indexOf('voucher') !== -1) {
        data.flags.push('voucher_available');
      }
    }

    const idFromUrl = window.location.pathname.match(/\/riders\/([^\/?#]+)/);
    if (idFromUrl) data.entityId = idFromUrl[1];
    else if (data.email) data.entityId = data.email;
    else if (data.phone) data.entityId = data.phone;

    return data;
  }

  function extractInspectorData() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = {
      pageType: 'service_inspector',
      entityId: null,
      serviceId: getText('[data-test-id="inspector-service-id"], .inspector-service-id, [class*="service-id"]'),
      telemetry: {
        duration: getText('[data-test-id="telemetry-duration"], .telemetry-duration, [class*="duration"]'),
        issues: []
      },
      flags: [],
      rawText: fullText
    };

    const issueEls = Array.from(document.querySelectorAll('[data-test-id="telemetry-issue"], .telemetry-issue, .issue-item, [class*="issue"]'));
    for (let e = 0; e < issueEls.length; e++) {
      const issueText = issueEls[e].textContent.trim();
      data.telemetry.issues.push(issueText);
      const lower = issueText.toLowerCase();
      if (lower.indexOf('battery') !== -1 || lower.indexOf('power') !== -1) data.flags.push('battery_issue');
      if (lower.indexOf('hardware') !== -1) data.flags.push('hardware_issue');
      if (lower.indexOf('voucher') !== -1) data.flags.push('voucher_available');
      if (lower.indexOf('refund') !== -1) data.flags.push('refund_eligible');
      if (lower.indexOf('incomplete') !== -1 || lower.indexOf('not provided') !== -1) data.flags.push('service_incomplete');
    }

    const idFromUrl = window.location.pathname.match(/\/ride-inspector\/([^\/?#]+)/);
    if (idFromUrl) data.entityId = idFromUrl[1];
    if (!data.entityId && data.serviceId) data.entityId = data.serviceId;

    return data;
  }

  function extractTransactionData() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = {
      pageType: 'transactions',
      entityId: null,
      transactions: [],
      flags: [],
      rawText: fullText
    };

    const rows = Array.from(document.querySelectorAll('[data-test-id="transaction"], .transaction-row, tr, [class*="transaction"]'));
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const tx = {
        date: getText('[data-test-id="tx-date"], .tx-date', row),
        amount: getText('[data-test-id="tx-amount"], .tx-amount', row),
        status: getText('[data-test-id="tx-status"], .tx-status', row),
        raw: (row.innerText || row.textContent || '').substring(0, 200)
      };
      data.transactions.push(tx);
      if (tx.status && tx.status.toLowerCase().indexOf('refund') !== -1) data.flags.push('refund_eligible');
      if (row.innerText && row.innerText.toLowerCase().indexOf('voucher') !== -1) data.flags.push('voucher_available');
    }

    const idFromUrl = window.location.pathname.match(/\/transaction\/([^\/?#]+)/);
    if (idFromUrl) data.entityId = idFromUrl[1];
    else if (data.transactions.length > 0) data.entityId = 'transactions_page';

    return data;
  }

  function extractConfigHubData() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = {
      pageType: 'config_hub',
      entityId: 'config_hub',
      region: getText('[data-test-id="config-region"], .config-region, [class*="region"]'),
      rules: [],
      flags: [],
      rawText: fullText
    };

    const ruleEls = Array.from(document.querySelectorAll('[data-test-id="policy-rule"], .policy-rule, [class*="config"], [class*="rule"]'));
    for (let e = 0; e < ruleEls.length; e++) {
      data.rules.push(ruleEls[e].textContent.trim());
    }

    if (fullText.toLowerCase().indexOf('parking') !== -1) {
      data.flags.push('parking_mode_enabled');
    }
    if (fullText.toLowerCase().indexOf('zone') !== -1) {
      data.flags.push('zone_config_present');
    }

    return data;
  }

  function extractMapViewData() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = {
      pageType: 'map_view',
      entityId: 'vehicle_map',
      flags: [],
      rawText: fullText
    };

    if (fullText.toLowerCase().indexOf('congestion') !== -1 || fullText.toLowerCase().indexOf('congested') !== -1) {
      data.flags.push('congestion_detected');
    }
    if (fullText.toLowerCase().indexOf('wrongly parked') !== -1 || fullText.toLowerCase().indexOf('incorrectly parked') !== -1) {
      data.flags.push('wrongly_parked_scooters');
    }
    if (fullText.toLowerCase().indexOf('scooter') !== -1) {
      data.flags.push('scooters_visible');
    }

    return data;
  }

  function extractFmData() {
    const pageType = detectPageType();

    switch (pageType) {
      case 'profile':
        return extractProfileData();
      case 'service_inspector':
        return extractInspectorData();
      case 'transactions':
        return extractTransactionData();
      case 'config_hub':
        return extractConfigHubData();
      case 'map_view':
        return extractMapViewData();
      default:
        return {
          pageType: 'unknown',
          entityId: null,
          flags: [],
          rawText: document.body ? document.body.innerText.trim().substring(0, 2000) : ''
        };
    }
  }

  console.log('[ZendeskFM] FM content script loaded. pageType=' + detectPageType() + ' url=' + window.location.href);

  function waitForRender(maxWaitMs) {
    // Stability-based: FM pages are an SPA, so wait until the detected
    // page type stops changing across consecutive polls (render finished
    // or real navigation completed), with a deadline fallback.
    maxWaitMs = maxWaitMs || 5000;
    return new Promise(function(resolve) {
      var start = Date.now();
      var lastType = null;
      var stablePolls = 0;
      var interval = setInterval(function() {
        var type = detectPageType();
        var bodyText = document.body ? document.body.innerText.trim() : '';
        if (type === lastType) {
          stablePolls++;
        } else {
          stablePolls = 0;
          lastType = type;
        }
        var ready = type !== 'unknown' || bodyText.length > 200;
        if ((ready && stablePolls >= 2) || Date.now() - start >= maxWaitMs) {
          clearInterval(interval);
          resolve(true);
        }
      }, 300);
    });
  }

  waitForRender().then(function() {
    window.__fmData = extractFmData();
  });

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
      if (message.action === 'ping') {
        sendResponse({ pong: true, pageType: window.__fmData ? window.__fmData.pageType : null });
        return true;
      }
      if (message.action === 'getFmData') {
        waitForRender().then(function() {
          sendResponse({ success: true, data: extractFmData() });
        });
        return true;
      }
    });
  }
})();
