const { captureAppState } = require('./lib/capture');

(async () => {
  const result = await captureAppState('https://suryasticsai.github.io/alkembicneo/');
  console.log('Console errors captured:', JSON.stringify(result.consoleErrors, null, 2));
})();