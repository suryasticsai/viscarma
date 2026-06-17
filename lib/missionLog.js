const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'mission-history.json');

function getLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLogEntry(entry) {
  const log = getLog();
  log.push({
    timestamp: new Date().toISOString(),
    ...entry
  });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function getLatestMissions(limit = 10) {
  const log = getLog();
  return log.slice(-limit).reverse();
}

module.exports = { getLog, saveLogEntry, getLatestMissions };