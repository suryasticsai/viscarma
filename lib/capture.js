const { chromium } = require('playwright');

async function captureAppState(appUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];

  // Standard console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const loc = msg.location();
      consoleErrors.push({
        text: msg.text(),
        file: loc.url ? loc.url.split('/').pop() : 'unknown',
        line: loc.lineNumber,
        type: 'console'
      });
    }
  });

  // Uncaught exceptions – extract file & line from stack
  page.on('pageerror', error => {
    const stack = error.stack || '';
    const match = stack.match(/at\s.*\((.*?):(\d+):(\d+)\)/) || stack.match(/at\s(.*?):(\d+):(\d+)/);
    let file = 'unknown';
    let line = 0;
    if (match) {
      const url = match[1];
      try {
        const pathname = new URL(url).pathname;
        file = pathname.split('/').pop(); // e.g., console.js
      } catch {
        // relative path or bare name
        file = url.split('/').pop();
      }
      line = parseInt(match[2]);
    }
    consoleErrors.push({
      text: error.message,
      file,
      line,
      type: 'uncaught'
    });
  });

  await page.goto(appUrl, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(3000); // let all scripts execute

  const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'png' });
  const dom = await page.content();
  await browser.close();

  return {
    screenshotBase64: screenshotBuffer.toString('base64'),
    dom,
    consoleErrors
  };
}

module.exports = { captureAppState };

const fs = require('fs');
const path = require('path');

function saveScreenshot(base64, filename) {
  const dir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(dir, filename), buffer);
  return path.join(dir, filename);
}

module.exports = { captureAppState, saveScreenshot };