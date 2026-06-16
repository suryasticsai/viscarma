const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Catch all console messages
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
  });

  // Catch uncaught exceptions
  page.on('pageerror', error => {
    console.log(`[PAGEERROR] ${error.message}`);
  });

  await page.goto('https://suryasticsai.github.io/alkembicneo/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(3000);   // wait for scripts to execute
  await browser.close();
  console.log('Capture complete.');
})();