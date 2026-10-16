(function() {
  'use strict';

  // Shared extension logger: batches structured entries and POSTs them to
  // the native host's /api/log endpoint, so the extension's operational
  // cycle (injection, ticket detection, classification, errors) is
  // persisted in extension/native-host/logs/native-host.log alongside
  // the server's own logs. Fails silently when the native host is down.

  if (window.__extLog) return;

  var LOG_URL = 'http://localhost:27183/api/log';
  var queue = [];
  var sending = false;

  function logToNativeHost(entry) {
    try {
      if (!entry || typeof entry !== 'object') {
        entry = { phase: 'extension', step: 'log', status: 'info', value: String(entry) };
      }
      entry.ts = new Date().toISOString();
      if (!entry.source) entry.source = 'content';
      queue.push(entry);
      if (queue.length > 200) queue.splice(0, queue.length - 200);
      drain();
    } catch (e) {}
  }

  function drain() {
    if (sending || queue.length === 0) return;
    sending = true;
    var batch = queue.splice(0, 50);
    fetch(LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'log', entries: batch })
    }).catch(function() {}).then(function() {
      sending = false;
      drain();
    });
  }

  window.__extLog = logToNativeHost;

  logToNativeHost({ phase: 'content', step: 'logger-ready', status: 'start', url: window.location.href });
})();
