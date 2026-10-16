/**
 * FM (Full View) page scraper
 */

class FmScraper {
  detectPageType() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/ride-inspector')) return 'service_inspector';
    if (path.includes('/riders/') || path.includes('/rider/')) return 'profile';
    if (path.includes('/config-hub') || path.includes('/confighub')) return 'config_hub';
    if (path.includes('/vehicle-map') || path.includes('/vehiclemap')) return 'map_view';
    if (path.includes('/transaction')) return 'transactions';
    return 'unknown';
  }
  
  extract() {
    const pageType = this.detectPageType();
    
    switch (pageType) {
      case 'profile':
        return this.extractProfile();
      case 'service_inspector':
        return this.extractInspector();
      case 'transactions':
        return this.extractTransactions();
      case 'config_hub':
        return this.extractConfigHub();
      case 'map_view':
        return this.extractMapView();
      default:
        return {
          pageType: 'unknown',
          entityId: null,
          flags: [],
          rawText: document.body ? document.body.innerText.trim().substring(0, 2000) : ''
        };
    }
  }
  
  getText(selector, context = document) {
    const el = context.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }
  
  extractProfile() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = {
      pageType: 'profile',
      entityId: null,
      name: this.getText('[data-test-id="profile-name"], .profile-name, h1, [class*="name"]'),
      email: this.getText('[data-test-id="profile-email"], .profile-email, [class*="email"]'),
      phone: this.getText('[data-test-id="profile-phone"], .profile-phone, [class*="phone"]'),
      city: this.getText('[data-test-id="profile-city"], .profile-city, [class*="city"]'),
      country: this.getText('[data-test-id="profile-country"], .profile-country, [class*="country"]'),
      partner: this.getText('[data-test-id="profile-partner"], .profile-partner, [class*="partner"]'),
      serviceEntries: [],
      transactionHistory: [],
      flags: [],
      rawText: fullText
    };
    
    // Partner detection
    const headerEl = document.querySelector('[class*="header"], [class*="Header"], [class*="profile-header"], [data-test-id="profile-header"]');
    if (headerEl) {
      const headerText = headerEl.innerText || headerEl.textContent || '';
      if (headerText.toLowerCase().includes('rider')) data.partner = data.partner || 'VOI Customer';
      
      const partnerMatch = headerText.match(/(ASEAG|Free Now|HVV Switch|Jelbi|KVV|Leipzig|MEEP|Reach Now|REDY|Rheinbahn|Ruter|SBB|Splyt|SWM|Telepass|Travis|Trafi|Urbi|VAG|WeTaxi|WHIM|Hyre|MOV A|YUMUV|MVGO|NOBINA|SOLENT|NUREMBERG)/i);
      if (partnerMatch) data.partner = partnerMatch[1];
    }
    
    if (!data.partner && fullText.toLowerCase().includes('rider') && !fullText.toLowerCase().includes('partner')) {
      data.partner = 'VOI Customer';
    }
    
    // Service entries
    const serviceRows = Array.from(document.querySelectorAll('[data-test-id="service-entry"], .service-row, .history-item, [class*="service"], [class*="history"]'));
    for (const row of serviceRows) {
      const rowText = row.innerText || row.textContent || '';
      data.serviceEntries.push({
        date: this.getText('[data-test-id="service-date"], .service-date', row),
        type: this.getText('[data-test-id="service-type"], .service-type', row),
        status: this.getText('[data-test-id="service-status"], .service-status', row),
        raw: rowText.substring(0, 200)
      });
      const lower = rowText.toLowerCase();
      if (lower.includes('incomplete') || lower.includes('failed')) data.flags.push('service_incomplete');
      if (lower.includes('battery') || lower.includes('power')) data.flags.push('battery_issue');
    }
    
    // Transactions
    const txRows = Array.from(document.querySelectorAll('[data-test-id="transaction"], .transaction-row, [class*="transaction"]'));
    for (const row of txRows) {
      const rowText = row.innerText || row.textContent || '';
      data.transactionHistory.push({
        date: this.getText('[data-test-id="tx-date"], .tx-date', row),
        amount: this.getText('[data-test-id="tx-amount"], .tx-amount', row),
        status: this.getText('[data-test-id="tx-status"], .tx-status', row),
        raw: rowText.substring(0, 200)
      });
      const lower = rowText.toLowerCase();
      if (lower.includes('refund') || lower.includes('eligible')) data.flags.push('refund_eligible');
      if (lower.includes('voucher')) data.flags.push('voucher_available');
    }
    
    // Entity ID from URL
    const idFromUrl = window.location.pathname.match(/\/riders\/([^\/?#]+)/);
    if (idFromUrl) data.entityId = idFromUrl[1];
    else if (data.email) data.entityId = data.email;
    else if (data.phone) data.entityId = data.phone;
    
    return data;
  }
  
  extractInspector() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = {
      pageType: 'service_inspector',
      entityId: null,
      serviceId: this.getText('[data-test-id="inspector-service-id"], .inspector-service-id, [class*="service-id"]'),
      telemetry: { duration: '', issues: [] },
      flags: [],
      rawText: fullText
    };
    
    data.telemetry.duration = this.getText('[data-test-id="telemetry-duration"], .telemetry-duration, [class*="duration"]');
    
    const issueEls = Array.from(document.querySelectorAll('[data-test-id="telemetry-issue"], .telemetry-issue, .issue-item, [class*="issue"]'));
    for (const el of issueEls) {
      const issueText = el.textContent.trim();
      data.telemetry.issues.push(issueText);
      const lower = issueText.toLowerCase();
      if (lower.includes('battery') || lower.includes('power')) data.flags.push('battery_issue');
      if (lower.includes('hardware')) data.flags.push('hardware_issue');
      if (lower.includes('voucher')) data.flags.push('voucher_available');
      if (lower.includes('refund')) data.flags.push('refund_eligible');
      if (lower.includes('incomplete') || lower.includes('not provided')) data.flags.push('service_incomplete');
    }
    
    const idFromUrl = window.location.pathname.match(/\/ride-inspector\/([^\/?#]+)/);
    if (idFromUrl) data.entityId = idFromUrl[1];
    if (!data.entityId && data.serviceId) data.entityId = data.serviceId;
    
    return data;
  }
  
  extractTransactions() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = { pageType: 'transactions', entityId: null, transactions: [], flags: [], rawText: fullText };
    
    const rows = Array.from(document.querySelectorAll('[data-test-id="transaction"], .transaction-row, tr, [class*="transaction"]'));
    for (const row of rows) {
      const tx = {
        date: this.getText('[data-test-id="tx-date"], .tx-date', row),
        amount: this.getText('[data-test-id="tx-amount"], .tx-amount', row),
        status: this.getText('[data-test-id="tx-status"], .tx-status', row),
        raw: (row.innerText || row.textContent || '').substring(0, 200)
      };
      data.transactions.push(tx);
      if (tx.status && tx.status.toLowerCase().includes('refund')) data.flags.push('refund_eligible');
      if (row.innerText && row.innerText.toLowerCase().includes('voucher')) data.flags.push('voucher_available');
    }
    
    const idFromUrl = window.location.pathname.match(/\/transaction\/([^\/?#]+)/);
    if (idFromUrl) data.entityId = idFromUrl[1];
    else if (data.transactions.length > 0) data.entityId = 'transactions_page';
    
    return data;
  }
  
  extractConfigHub() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = { pageType: 'config_hub', entityId: 'config_hub', region: '', rules: [], flags: [], rawText: fullText };
    
    data.region = this.getText('[data-test-id="config-region"], .config-region, [class*="region"]');
    
    const ruleEls = Array.from(document.querySelectorAll('[data-test-id="policy-rule"], .policy-rule, [class*="config"], [class*="rule"]'));
    for (const el of ruleEls) data.rules.push(el.textContent.trim());
    
    if (fullText.toLowerCase().includes('parking')) data.flags.push('parking_mode_enabled');
    if (fullText.toLowerCase().includes('zone')) data.flags.push('zone_config_present');
    
    return data;
  }
  
  extractMapView() {
    const fullText = document.body ? document.body.innerText.trim() : '';
    const data = { pageType: 'map_view', entityId: 'vehicle_map', flags: [], rawText: fullText };
    
    const lower = fullText.toLowerCase();
    if (lower.includes('congestion') || lower.includes('congested')) data.flags.push('congestion_detected');
    if (lower.includes('wrongly parked') || lower.includes('incorrectly parked')) data.flags.push('wrongly_parked_scooters');
    if (lower.includes('scooter')) data.flags.push('scooters_visible');
    
    return data;
  }
}

window.FmScraper = FmScraper;