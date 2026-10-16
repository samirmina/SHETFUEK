/**
 * Native host HTTP client for background script
 */

const HTTP_PORT = 27183;
const BASE_URL = `http://localhost:${HTTP_PORT}/api`;

async function sendToNativeHost(payload, timeoutMs = 120000) {
  const action = payload?.action || 'unknown';
  console.log('[Background] Sending to native host:', action);
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(`${BASE_URL}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    
    clearTimeout(timer);
    const text = await response.text();
    
    if (!response.ok) {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      throw new Error((parsed && parsed.error) || `HTTP ${response.status}`);
    }
    
    let result = null;
    try { result = JSON.parse(text); } catch (e) {}
    if (!result || !result.success) {
      throw new Error((result && result.error) || 'HTTP response missing success');
    }
    
    console.log('[Background] Native host response:', action, 'success');
    return result.data;
  } catch (error) {
    clearTimeout(timer);
    console.error('[Background] Native host error:', action, error.message);
    throw error;
  }
}

async function pingNativeHost() {
  try {
    const result = await sendToNativeHost({ action: 'ping' }, 5000);
    return { healthy: true, model: result?.model };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

module.exports = {
  sendToNativeHost,
  pingNativeHost
};