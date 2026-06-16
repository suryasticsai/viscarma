const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

function logExchange(prompt, responseContent, success) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `mission-${timestamp}.log`;
  const logPath = path.join(LOG_DIR, filename);

  const logData = [
    `=== MISSION DEBUG LOG ===`,
    `Time: ${new Date().toLocaleString()}`,
    ``,
    `--- PROMPT SENT TO MODEL ---`,
    prompt,
    ``,
    `--- RAW RESPONSE ---`,
    responseContent || '(empty or error)',
    ``,
    `--- STATUS ---`,
    success ? 'Fix generated' : 'No fix / error',
  ].join('\n');

  fs.writeFileSync(logPath, logData, 'utf8');
  console.log(`📄 Debug log saved to logs/${filename}`);
}

module.exports = { logExchange };