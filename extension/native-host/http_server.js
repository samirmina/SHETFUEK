/**
 * HTTP Server for native host
 */

const http = require('http');
const logger = require('./logs/logger');
const { classify } = require('./classifier');
const rag = require('./rag/ingest');
const cache = require('./cache/ticket_cache');
const ollama = require('./ollama_client');

async function handleAction(action, payload) {
  if (action === 'classify') {
    const result = await classify(payload.ticketContext, payload.fmContext, payload.options);
    return { success: true, data: result };
  }
  if (action === 'ping') {
    return { success: true, data: { pong: true, model: ollama.DEFAULT_MODEL } };
  }
  if (action === 'ingest') {
    const result = await rag.buildIndex(payload.force || false);
    return { success: true, data: result };
  }
  if (action === 'cacheStats') {
    return { success: true, data: cache.stats() };
  }
  if (action === 'clearCache') {
    cache.clear();
    return { success: true, data: { cleared: true } };
  }
  if (action === 'ragDebug') {
    const result = rag.getLastQuery ? rag.getLastQuery() : { text: null, scores: [], topK: 0 };
    return { success: true, data: result };
  }
  if (action === 'log') {
    const entries = Array.isArray(payload.entries) ? payload.entries : [payload.entry || { phase: 'extension', step: 'log', status: 'info' }];
    let logged = 0;
    for (const e of entries) {
      try { logger.log(e); logged++; } catch (err) {}
    }
    return { success: true, data: { logged: logged } };
  }
  return { success: false, error: 'UNKNOWN_ACTION: ' + action };
}

function startHttpServer(port) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let message;
      try {
        message = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        return;
      }
      
      const action = (message && message.action) || '';
      logger.log({ phase: 'http_server', step: 'request', action, pid: process.pid });
      
      try {
        const result = await handleAction(action, message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        logger.log({ phase: 'http_server', step: 'response', action, status: 'success', pid: process.pid });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
        logger.log({ phase: 'http_server', step: 'response', action, status: 'error', error: err.message, pid: process.pid });
      }
    });
  });
  
  server.on('error', err => {
    logger.log({ phase: 'http_server', step: 'error', error: err.message, pid: process.pid });
  });
  
  server.listen(port, () => {
    logger.log({ phase: 'http_server', step: 'start', port, pid: process.pid });
    console.log(`[Native Host] HTTP server listening on port ${port}`);
  });
  
  return server;
}

module.exports = {
  startHttpServer,
  handleAction
};