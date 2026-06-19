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

async function queryModel(model, ollamaUrl, prompt, context) {
  // ─── Key handling ──────────────────────────────────────
  const apiKey = process.env.OLLAMA_API_KEY;
  const useCloud = !!(apiKey && apiKey.trim() !== '');
  const baseUrl = useCloud ? 'https://ollama.com' : ollamaUrl;

  console.log(`🔑 Ollama mode: ${useCloud ? 'CLOUD' : 'LOCAL'} (key ${useCloud ? 'present' : 'missing/empty'})`);

  const { dom, consoleErrors, sourceFiles } = context;

  // ── Extract error location ─────────────────────────────
  const firstError = consoleErrors && consoleErrors.length > 0 ? consoleErrors[0] : null;
  let targetFile = null;
  let errorSnippet = '';

  if (firstError && firstError.file && firstError.file !== 'unknown') {
    targetFile = firstError.file;
    if (sourceFiles[targetFile]) {
      const lines = sourceFiles[targetFile].split('\n');
      const errorLine = firstError.line || 1;
      const start = Math.max(0, errorLine - 30);
      const end = Math.min(lines.length, errorLine + 30);
      errorSnippet = lines.slice(start, end).join('\n');
    }
  }

  const mentionedFile = prompt.match(/([\w\-\/]+\.(js|html|css))/)?.[1];
  if (mentionedFile && mentionedFile !== targetFile && sourceFiles[mentionedFile]) {
    targetFile = mentionedFile;
    const lines = sourceFiles[targetFile].split('\n');
    errorSnippet = lines.join('\n').substring(0, 8000);
  }

  if (!targetFile || !errorSnippet) {
    const fallback = Object.keys(sourceFiles).find(f => f.endsWith('.js') || f.endsWith('.html'));
    if (fallback) {
      targetFile = fallback;
      errorSnippet = sourceFiles[targetFile];
    } else {
      console.error('No target file found.');
      return [];
    }
  }

  const buildPayload = (retryCount) => {
    let missionText = prompt;
    if (retryCount > 0) {
      missionText = `IMPORTANT: This is retry #${retryCount}. The previous attempt returned no changes, but there IS a bug. Please fix the duplicate declaration mentioned. ` + prompt;
    }
    return `
You are an expert code‑fixer. Your task is to output a precise JSON change that removes the duplicate declaration.

Mission: ${missionText}

Console error details:
${firstError ? JSON.stringify(firstError) : 'none'}

File to fix: ${targetFile}
Relevant code snippet (the error is likely here):
\`\`\`
${errorSnippet}
\`\`\`

Return ONLY a JSON array (no markdown, no explanation). Example:
[ { "file": "${targetFile}", "oldLine": "let x = 1;\\nlet x = 2;", "newLine": "let x = 1;" } ]

If you see a duplicate declaration (two 'let' or 'const' for the same variable), remove one of them.`;
  };

  const callOllama = async (payload) => {
    const logPath = path.join(LOG_DIR, `heartbeat-${Date.now()}.log`);
    const writeHeartbeat = (msg) => {
      const timestamp = new Date().toLocaleTimeString();
      const line = `[${timestamp}] ${msg}`;
      console.log(`  💓 ${line}`);
      fs.appendFileSync(logPath, line + '\n', 'utf8');
    };

    const startTime = Date.now();
    writeHeartbeat('Oracle contacted. Waiting for response...');

    const heartbeatInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      writeHeartbeat(`Still waiting... (${elapsed}s elapsed)`);
    }, 60000);

    try {
      const headers = { 'Content-Type': 'application/json' };
      // ─── Only send Bearer if key is non‑empty ──────────
      if (useCloud) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        writeHeartbeat(`Using cloud API with token`);
      } else {
        writeHeartbeat(`Using local Ollama at ${baseUrl}`);
      }

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: payload }],
          format: 'json',
          stream: false,
          options: { temperature: 0, num_ctx: 8192 }
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000)
      });

      clearInterval(heartbeatInterval);
      const totalSec = Math.round((Date.now() - startTime) / 1000);
      writeHeartbeat(`Response received after ${totalSec} seconds`);

      if (!response.ok) {
        const errText = await response.text();
        writeHeartbeat(`Error: HTTP ${response.status} - ${errText.substring(0, 200)}`);
        throw new Error(`Ollama HTTP ${response.status}: ${errText}`);
      }

      const json = await response.json();
      let rawContent = json.message.content.trim();
      rawContent = rawContent.replace(/^```(json)?\s*/, '').replace(/\s*```$/, '');

      writeHeartbeat(`Model replied with ${rawContent.length} characters`);

      let parsed = JSON.parse(rawContent);
      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }
      return { changes: parsed, raw: rawContent };
    } catch (err) {
      clearInterval(heartbeatInterval);
      writeHeartbeat(`Failed: ${err.message.substring(0, 200)}`);
      throw err;
    }
  };

  let lastPayload = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const payload = buildPayload(attempt);
    lastPayload = payload;
    try {
      const { changes, raw } = await callOllama(payload);
      if (Array.isArray(changes) && changes.length > 0) {
        logExchange(payload, raw, true);
        return changes;
      }
      console.log(`Attempt ${attempt + 1} returned no changes.`);
      logExchange(payload, raw, false);
    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed:`, err.message);
      logExchange(payload, `Error: ${err.message}`, false);
      if (attempt === 2) throw err;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.error('All retries exhausted – no fix generated.');
  return [];
}

module.exports = { queryModel };