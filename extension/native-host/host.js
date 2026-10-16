/**
 * Native Host Entry Point
 * Starts HTTP server on port 27183
 */

const httpServer = require('./http_server');

const HTTP_PORT = process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT, 10) : 27183;

// Global unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Native Host] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Native Host] Uncaught Exception:', err);
});

// Start HTTP server
httpServer.startHttpServer(HTTP_PORT);

console.log('[Native Host] Started in HTTP mode on port ' + HTTP_PORT);