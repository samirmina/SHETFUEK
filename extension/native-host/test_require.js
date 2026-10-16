console.log('Testing require...');
try {
  const logger = require('./logs/logger');
  console.log('Success:', logger);
} catch (e) {
  console.log('Error:', e.message);
}