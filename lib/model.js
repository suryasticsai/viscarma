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
  const { dom, consoleErrors, sourceFiles } = context;

  // ── Extract precise error location ────────────────────
  const firstError = consoleErrors && consoleErrors.length > 0 ? consoleErrors[0] : null;
  let targetFile = null;
  let fileContent = '';

  if (firstError && firstError.file && firstError.file !== 'unknown') {
    targetFile = firstError.file;
    if (sourceFiles[targetFile]) {
      fileContent = sourceFiles[targetFile];
    }
  }

  const mentionedFile = prompt.match(/([\w\-\/]+\.(js|html|css))/)?.[1];
  if (mentionedFile && mentionedFile !== targetFile && sourceFiles[mentionedFile]) {
    targetFile = mentionedFile;
    fileContent = sourceFiles[targetFile];
  }

  if (!targetFile || !fileContent) {
    const fallback = Object.keys(sourceFiles).find(f => f.endsWith('.js') || f.endsWith('.html'));
    if (fallback) {
      targetFile = fallback;
      fileContent = sourceFiles[targetFile];
    } else {
      console.error('No target file found.');
      return [];
    }
  }

  // ── Build the 10x god‑mode prompt ──────────────────────
  const buildPayload = (retryCount) => {
    const retryHint = retryCount > 0
      ? `\n⚠️ This is RETRY #${retryCount}. Previous attempts returned no changes, but the issues persist. Please double‑check your analysis.\n`
      : '';

    return `You are a **Principal Software Engineer** with 20 years of experience in code quality, refactoring, and debugging. Your mission is to analyze the provided file and generate a **complete, correct, and safe** set of changes that address the user's request.

## MISSION
${prompt}

${retryHint}

## FILE TO FIX
- **File:** ${targetFile}
- **Full content** (see below)

## CONTEXT
${firstError ? `- **Console error:** ${JSON.stringify(firstError)}` : '- No console errors reported.'}
${consoleErrors && consoleErrors.length > 1 ? `- **Additional console errors:** ${JSON.stringify(consoleErrors.slice(1))}` : ''}

## YOUR TASK – Step‑by‑Step

1. **Understand the mission** – What is the user asking you to fix? (e.g., duplicate declarations, unused vars, missing semicolons, runtime errors, style issues, etc.)

2. **Analyze the file** – Read the entire file content. Identify ALL issues that relate to the mission. Use your expertise to catch subtle problems.

3. **Plan your fixes** – For each issue, decide:
   - The exact line(s) to change (include the full old line as it appears in the file).
   - The new line(s) to replace it with. If removing, set newLine to "".
   - Ensure your changes preserve indentation and surrounding context.

4. **Self‑review** – Before outputting, review your proposed changes:
   - Does each oldLine exactly match a line in the file?
   - Does each newLine actually fix the problem?
   - Could your change break something else? If yes, refine it.

5. **Generate output** – Produce a JSON array of changes. Even if only one change, wrap it in an array.

## CRITICAL RULES
- **Always return a JSON array** – never a single object.
- **Do NOT include any explanation, markdown, or extra text** outside the JSON array.
- **If no changes are needed**, return \`[]\`.
- **Be thorough** – if the mission says "fix all code quality issues", fix everything you can safely fix.
- **Be safe** – don't change code that isn't broken. Only fix what's needed to satisfy the mission.

## OUTPUT FORMAT
Each change object must have:
- \`"file"\`: the filename (usually "${targetFile}")
- \`"oldLine"\`: the exact line(s) from the original file (can include multiple lines)
- \`"newLine"\`: the replacement line(s) (can be empty string to delete)

## EXAMPLES

### Example 1: Remove a duplicate variable
If the file contains:
\`\`\`
let counter = 0;
let counter = 5;
\`\`\`
Output:
\`\`\`json
[ { "file": "index.html", "oldLine": "let counter = 0;", "newLine": "" } ]
\`\`\`

### Example 2: Fix multiple issues
If the file has an unused var, a missing semicolon, and a var that should be const:
\`\`\`
let unused = 100;
let score = 99
var oldStyle = "outdated";
\`\`\`
Output:
\`\`\`json
[
  { "file": "index.html", "oldLine": "let unused = 100;", "newLine": "" },
  { "file": "index.html", "oldLine": "let score = 99", "newLine": "let score = 99;" },
  { "file": "index.html", "oldLine": "var oldStyle = \"outdated\";", "newLine": "const oldStyle = \"outdated\";" }
]
\`\`\`

### Example 3: Comment out an error‑causing line
If a function call throws an error:
\`\`\`
nonExistentFunction();
\`\`\`
Output:
\`\`\`json
[ { "file": "index.html", "oldLine": "nonExistentFunction();", "newLine": "// nonExistentFunction();" } ]
\`\`\`

---

## FILE CONTENT
\`\`\`
${fileContent}
\`\`\`

---

## NOW, GENERATE THE JSON ARRAY.
`;
  };

  // ── API call with heartbeat ──────────────────────────
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
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      // Strip markdown code blocks
      rawContent = rawContent.replace(/^```(json)?\s*/, '').replace(/\s*```$/, '');

      writeHeartbeat(`Model replied with ${rawContent.length} characters`);

      // Parse – could be array or object
      let parsed = JSON.parse(rawContent);
      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }

      // ── Validate each change ──────────────────────────
      const validChanges = parsed.filter(change =>
        change.file && change.oldLine !== undefined && change.newLine !== undefined
      );

      // Additional safety: ensure oldLine exists in the file
      const lines = fileContent.split('\n');
      const finalChanges = validChanges.filter(change => {
        const oldLine = change.oldLine;
        // Check if line exists (exact match)
        if (lines.includes(oldLine)) {
          return true;
        }
        // Sometimes trailing spaces matter, so try trimming
        const trimmedOld = oldLine.trim();
        const matched = lines.some(line => line.trim() === trimmedOld);
        if (!matched) {
          console.warn(`⚠️ Skipping change: oldLine "${oldLine}" not found in file.`);
        }
        return matched;
      });

      return { changes: finalChanges, raw: rawContent };
    } catch (err) {
      clearInterval(heartbeatInterval);
      writeHeartbeat(`Failed: ${err.message.substring(0, 200)}`);
      throw err;
    }
  };

  // ── Retry loop ─────────────────────────────────────
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