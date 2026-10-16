const http = require('http');
const https = require('https');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const REQUEST_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10);

function request(path, payload) {
  return new Promise(function(resolve, reject) {
    const url = new URL(OLLAMA_URL);
    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const req = transport.request(options, function(res) {
      const chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        let body = '';
        try { body = Buffer.concat(chunks).toString('utf8'); } catch (e) { body = ''; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Ollama HTTP ' + res.statusCode + ': ' + body.slice(0, 500)));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Ollama JSON parse error: ' + e.message)); }
      });
      res.on('error', function(e) { reject(new Error('Ollama response error: ' + e.message)); });
    });

    req.on('error', function(e) { reject(new Error('Ollama connection error: ' + e.message)); });
    req.setTimeout(REQUEST_TIMEOUT_MS, function() {
      req.destroy();
      reject(new Error('Ollama request timeout after ' + REQUEST_TIMEOUT_MS + 'ms'));
    });

    try { req.write(JSON.stringify(payload)); } catch (e) { return reject(e); }
    req.end();
  });
}

async function chat(messages, model) {
  model = model || DEFAULT_MODEL;
  const payload = {
    model: model,
    messages: messages,
    stream: false,
    format: 'json',
    options: {
      num_ctx: 16384,
      temperature: 0.1,
      top_p: 0.9,
      num_predict: 1024
    }
  };
  const start = Date.now();
  const result = await request('/api/chat', payload);
  const durationMs = Date.now() - start;
  const content = (result.message && result.message.content) ? result.message.content : '';
  const evalCount = result.eval_count || 0;
  const promptEvalCount = result.prompt_eval_count || 0;
  return {
    content: content,
    durationMs: durationMs,
    inputTokens: promptEvalCount,
    outputTokens: evalCount,
    model: model,
    done: result.done !== false,
    raw: result
  };
}

async function embeddings(text, model) {
  model = model || 'mxbai-embed-large';
  // Ollama's /api/embeddings endpoint does not honor the truncate flag
  // (verified against 0.40.3: long prompts return HTTP 500
  // "the input length exceeds the context length"), so truncate client-side.
  // mxbai-embed-large has a 512-token context; ~1500 chars is safely inside it.
  const EMBEDDING_MAX_CHARS = 1500;
  const truncatedText = (typeof text === 'string' && text.length > EMBEDDING_MAX_CHARS)
    ? text.slice(0, EMBEDDING_MAX_CHARS)
    : text;
  const payload = { model: model, prompt: truncatedText, truncate: true };
  const result = await request('/api/embeddings', payload);
  const embedding = (result && result.embedding) ? result.embedding : null;
  if (embedding && Array.isArray(embedding) && embedding.length > 0) {
    return embedding;
  }
  return null;
}

async function listModels() {
  return request('/api/tags', {});
}

module.exports = {
  chat: chat,
  embeddings: embeddings,
  listModels: listModels,
  DEFAULT_MODEL: DEFAULT_MODEL,
  OLLAMA_URL: OLLAMA_URL
};
