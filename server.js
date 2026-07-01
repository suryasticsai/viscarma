// server.js — VisCarMa Backend v2.0
// New in this version:
//   - Security scanner (OWASP top 10, secrets, SQL injection)
//   - Multi-language analysis (Python, Go, Java, Rust via pattern rules)
//   - GitHub PR reviewer (post AI review comments on existing open PRs)
//   - Jira integration (/api/jira-tasks)
//   - Server-side scan history (/api/history)
//   - All Tier 1 + Tier 2 features

import 'dotenv/config';
import express      from 'express';
import cors         from 'cors';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import { ESLint }   from 'eslint';
import { JSDOM }    from 'jsdom';
import * as cheerio  from 'cheerio';
import * as Diff     from 'diff';
import simpleGit    from 'simple-git';
import path         from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import crypto       from 'crypto';
import webpush      from 'web-push';
import cron         from 'node-cron';

// server.js — Add this endpoint
import { PRAgent } from './lib/pr-agent.js';

// ─── PR Agent Webhook ─────────────────────────────────────────────
app.post('/api/pr-agent/comment', async (req, res) => {
  const { repoOwner, repoName, prNumber, token } = req.body;
  const ghToken = token || req.session?.githubToken;

  if (!ghToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const agent = new PRAgent(repoOwner, repoName, prNumber, ghToken);

    // Check for new comments
    const newComments = await agent.listenForComments();

    if (newComments === 0) {
      return res.json({ message: 'No new comments to process' });
    }

    res.json({
      message: `Processed ${newComments} comment(s)`,
      commentsProcessed: newComments,
    });
  } catch (error) {
    console.error('[PR Agent]', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── GitHub Webhook Listener ──────────────────────────────────────
app.post('/api/webhook/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  // Only listen for PR comments
  if (event === 'issue_comment' && payload.issue?.pull_request) {
    const { repo, issue, comment } = payload;
    const prNumber = issue.number;
    const repoOwner = repo.owner.login;
    const repoName = repo.name;

    console.log(`🔔 GitHub webhook: PR #${prNumber} comment by ${comment.user.login}`);

    // Skip if comment is from the agent itself
    if (comment.user.login === 'viscarma[bot]') {
      return res.status(200).send('Skipped: own comment');
    }

    try {
      // Get token from session or use a bot token
      const token = process.env.GITHUB_BOT_TOKEN;
      if (!token) {
        console.warn('⚠️ GITHUB_BOT_TOKEN not set — skipping auto-respond');
        return res.status(200).send('No bot token');
      }

      const agent = new PRAgent(repoOwner, repoName, prNumber, token);
      await agent.listenForComments();

      res.status(200).json({ message: 'PR Agent processed comment' });
    } catch (error) {
      console.error('[Webhook]', error);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(200).send('Ignored event');
  }
});

// ============ NEW: AI Provider imports ============
import { callAIWithJSON, setAIProvider, getAIProvider } from './lib/ai-providers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

// Render terminates SSL at load balancer — trust proxy so secure cookies work
app.set('trust proxy', 1);

const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  OLLAMA_API_KEY,
  OPENROUTER_API_KEY,
  SESSION_SECRET = 'dev-secret-change-me-in-production',
  REDIRECT_URI   = 'https://viscarma.onrender.com/auth/callback',
  FRONTEND_URL   = 'https://viscarma.onrender.com',
} = process.env;

// ============ NEW: Set active AI provider based on env ============
const AI_PROVIDER = process.env.AI_PROVIDER || 'openrouter';
try {
  setAIProvider(AI_PROVIDER);
  console.log(`🔐 AI Provider: ${AI_PROVIDER}`);
} catch (e) {
  console.warn(`⚠️ AI Provider "${AI_PROVIDER}" not found, falling back to openrouter`);
  setAIProvider('openrouter');
}

app.use(cookieSession({
  name: 'viscarma_sess', keys: [SESSION_SECRET],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax', httpOnly: true,
}));
app.use(cookieParser(SESSION_SECRET));
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── History store (in-memory + file) ────────────────────────────
const HISTORY_FILE = path.join(process.cwd(), 'data', 'history.json');
let scanHistory = [];

async function loadHistory() {
  try {
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    const raw = await fs.readFile(HISTORY_FILE, 'utf-8');
    scanHistory = JSON.parse(raw);
  } catch { scanHistory = []; }
}

async function saveHistoryEntry(entry) {
  scanHistory.unshift(entry);
  if (scanHistory.length > 200) scanHistory.pop();
  try { await fs.writeFile(HISTORY_FILE, JSON.stringify(scanHistory, null, 2)); }
  catch (e) { console.error('[HISTORY] Save failed:', e.message); }
}

loadHistory();

// ─── ESLint ──────────────────────────────────────────────────────
let eslintInstance = null;
async function getESLint() {
  if (!eslintInstance) {
    eslintInstance = new ESLint({
      useEslintrc: false,
      overrideConfig: {
        env: { browser: true, node: true, es2021: true },
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: {
          'no-undef': 'error', 'eqeqeq': 'error', 'no-eval': 'error',
          'no-unused-vars': 'warn', 'no-extra-semi': 'warn',
          'no-await-in-loop': 'warn', 'require-await': 'warn',
          'no-promise-executor-return': 'error', 'no-console': 'warn',
          'no-alert': 'warn', 'no-debugger': 'warn',
          'no-var': 'warn', 'prefer-const': 'warn',
        },
      },
    });
  }
  return eslintInstance;
}

// ─── Safe JSON fetch ─────────────────────────────────────────────
// Checks Content-Type before calling .json() so an HTML error page
// from a gateway, rate-limiter, or expired auth doesn't throw an
// unhandled parse exception (the single most common silent failure).
async function safeJsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const ct  = res.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    const preview = await res.text();
    console.error(`[AI] Got HTML from ${url} (status ${res.status}) — likely a gateway/auth error:\n${preview.slice(0, 200)}`);
    return { ok: false, status: res.status, data: null };
  }
  let data = null;
  try { data = await res.json(); } catch (e) {
    console.error(`[AI] JSON parse failed from ${url} (status ${res.status}): ${e.message}`);
    return { ok: false, status: res.status, data: null };
  }
  if (!res.ok) {
    console.error(`[AI] ${url} responded ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    return { ok: false, status: res.status, data };
  }
  return { ok: true, status: res.status, data };
}

// ─── AI call (DEPRECATED — kept for backward compatibility) ─────
// New code should use callAIWithJSON from lib/ai-providers.js
// This function is now a thin wrapper that delegates to the provider system.
async function callAI(prompt) {
  console.warn('[AI] callAI() is deprecated — use callAIWithJSON() from lib/ai-providers.js');
  try {
    const provider = getAIProvider();
    const result = await provider.generate(prompt, 'deprecated');
    return result;
  } catch (e) {
    console.error('[AI] Fallback call failed:', e.message);
    return null;
  }
}

// ─── Robust AI response parser ────────────────────────────────────
// Ported and adapted from GrishteSync's parse_ai_response().
// Handles: markdown fences, literal newlines inside strings,
// trailing commas, unbalanced brackets, and plain JSON.parse failures.
function parseAIResponse(text) {
  if (!text) return [];

  // 1. Strip markdown fences (```json ... ``` or ``` ... ```)
  text = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  // 2. Isolate the outermost JSON array
  const start = text.indexOf('[');
  const end   = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let src = text.slice(start, end + 1);

  // 3. Walk character-by-character to escape literal newlines/tabs
  //    that appear *inside* JSON string values (most common AI formatting bug).
  function escapeStringLiterals(str) {
    const out = [];
    let inString = false, escaped = false;
    for (const ch of str) {
      if (escaped)        { out.push(ch); escaped = false; continue; }
      if (ch === '\\')    { out.push(ch); escaped = true;  continue; }
      if (ch === '"')     { inString = !inString; out.push(ch); continue; }
      if (inString) {
        if (ch === '\n')  { out.push('\\n'); continue; }
        if (ch === '\r')  { continue; }
        if (ch === '\t')  { out.push('\\t'); continue; }
      }
      out.push(ch);
    }
    return out.join('');
  }
  src = escapeStringLiterals(src);

  // 4. Strip trailing commas before ] or }
  src = src.replace(/,\s*([}\]])/g, '$1');

  // 5. First parse attempt
  try {
    const p = JSON.parse(src);
    return Array.isArray(p) ? p : [];
  } catch { /* fall through */ }

  // 6. Bracket-balance fix, then retry
  const opens  = (src.match(/\[/g) || []).length;
  const closes = (src.match(/\]/g) || []).length;
  if (opens > closes) src += ']'.repeat(opens - closes);
  try {
    const p = JSON.parse(src);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

// ══════════════════════════════════════════════════════════════
// NOTE: callAIForJSON is now imported from lib/ai-providers.js
// The function below is kept for backward compatibility and
// delegates to the new system.
// ══════════════════════════════════════════════════════════════
async function callAIForJSON(prompt) {
  console.warn('[AI] callAIForJSON() is deprecated — use imported version from lib/ai-providers.js');
  return await callAIWithJSON(prompt, 'deprecated');
}

// ─── SECURITY SCANNER (Tier 2) ───────────────────────────────────
// Detects: hardcoded secrets, OWASP top 10 patterns, SQL injection,
// XSS vectors, insecure crypto, dangerous functions
function runSecurityScan(code, filename) {
  const issues = [];
  const ext    = filename.split('.').pop().toLowerCase();
  const lines  = code.split('\n');

  const secretPatterns = [
    { re: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi,      desc: 'Hardcoded API key detected.',              fix: 'Move to environment variable.' },
    { re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,                 desc: 'Hardcoded password detected.',             fix: 'Use environment variable or secrets manager.' },
    { re: /(?:secret|token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi,             desc: 'Hardcoded secret/token detected.',          fix: 'Move to environment variable.' },
    { re: /AKIA[0-9A-Z]{16}/g,                                                    desc: 'Possible AWS access key detected.',         fix: 'Revoke and move to IAM roles or env vars.' },
    { re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g,                               desc: 'Private key embedded in source code.',     fix: 'Remove immediately — store in secrets manager.' },
    { re: /ghp_[a-zA-Z0-9]{36}/g,                                                 desc: 'GitHub personal access token in code.',    fix: 'Revoke token and use GitHub secrets.' },
  ];

  const owaspPatterns = [
    { re: /eval\s*\(/g,                                                            desc: 'eval() usage — remote code execution risk.', fix: 'Avoid eval(); use JSON.parse() or Function constructors carefully.', sev: 'HIGH' },
    { re: /innerHTML\s*=/g,                                                        desc: 'innerHTML assignment — XSS risk.',          fix: 'Use textContent or sanitize input with DOMPurify.', sev: 'HIGH' },
    { re: /document\.write\s*\(/g,                                                 desc: 'document.write() — XSS risk.',             fix: 'Use DOM manipulation methods instead.', sev: 'HIGH' },
    { re: /exec\s*\(\s*`[^`]*\$\{/g,                                              desc: 'Command injection via template literal.',   fix: 'Sanitize inputs; use parameterized exec calls.', sev: 'HIGH' },
    { re: /Math\.random\(\)/g,                                                     desc: 'Math.random() used for security context.',  fix: 'Use crypto.randomBytes() for security-sensitive randomness.', sev: 'MED' },
    { re: /md5|sha1(?!\d)/gi,                                                      desc: 'Weak hash algorithm (MD5/SHA1) detected.',  fix: 'Use SHA-256 or bcrypt for passwords.', sev: 'MED' },
    { re: /http:\/\//g,                                                            desc: 'Insecure HTTP URL — use HTTPS.',            fix: 'Replace http:// with https://.', sev: 'LOW' },
  ];

  // SQL injection patterns
  const sqlPatterns = [
    { re: /query\s*\(\s*['"`][^'"`]*\$\{/g,                                      desc: 'Possible SQL injection via string interpolation.', fix: 'Use parameterized queries or prepared statements.', sev: 'HIGH' },
    { re: /\.query\([`'"]\s*SELECT.*\+\s*(?:req|request|params|body)/gi,          desc: 'SQL query built from user input.',          fix: 'Use parameterized queries.', sev: 'HIGH' },
  ];

  const allPatterns = [
    ...secretPatterns.map(p => ({ ...p, sev: 'HIGH' })),
    ...owaspPatterns,
    ...sqlPatterns,
  ];

  for (const { re, desc, fix, sev } of allPatterns) {
    re.lastIndex = 0;
    if (re.test(code)) {
      // Find which line
      re.lastIndex = 0;
      let lineNum = '?';
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i])) { lineNum = i + 1; break; }
      }
      issues.push({ severity: sev, description: `[SECURITY] Line ~${lineNum}: ${desc}`, fix });
    }
  }

  return issues;
}

// ─── MULTI-LANGUAGE ANALYSIS (Tier 2) ────────────────────────────
// Pattern-based analysis for Python, Go, Java, Rust
function analyzeMultiLang(code, filename) {
  const issues = [];
  const ext    = filename.split('.').pop().toLowerCase();

  if (ext === 'py') {
    const pyPatterns = [
      { re: /print\s*\(/g,          sev:'LOW',  desc:'print() in production code.', fix:'Use logging module instead.' },
      { re: /except:\s*$/gm,        sev:'MED',  desc:'Bare except clause catches all exceptions.', fix:'Catch specific exceptions: except ValueError:' },
      { re: /pickle\.loads?\(/g,    sev:'HIGH', desc:'pickle.load() can execute arbitrary code.', fix:'Use json or safer serialization formats.' },
      { re: /exec\s*\(/g,           sev:'HIGH', desc:'exec() call — code injection risk.', fix:'Avoid exec(); use safer alternatives.' },
      { re: /input\s*\(/g,          sev:'LOW',  desc:'input() used — validate user input.', fix:'Validate and sanitize all user input.' },
      { re: /TODO|FIXME/g,          sev:'LOW',  desc:'TODO/FIXME comment found.', fix:'Address before release.' },
      { re: /import \*/g,           sev:'LOW',  desc:'Wildcard import — pollutes namespace.', fix:'Import specific names instead.' },
    ];
    for (const { re, sev, desc, fix } of pyPatterns) {
      re.lastIndex = 0;
      if (re.test(code)) issues.push({ severity: sev, description: desc, fix });
    }
  }

  if (ext === 'go') {
    const goPatterns = [
      { re: /panic\s*\(/g,              sev:'MED',  desc:'panic() call — prefer error returns.', fix:'Return errors instead of panicking.' },
      { re: /fmt\.Println/g,            sev:'LOW',  desc:'fmt.Println in production code.', fix:'Use structured logging (zap, logrus).' },
      { re: /err\s*!=\s*nil\s*\{\s*\}/, sev:'HIGH', desc:'Empty error handling block.', fix:'Handle or propagate the error.' },
      { re: /\/\/ TODO|\/\/ FIXME/g,    sev:'LOW',  desc:'TODO/FIXME comment found.', fix:'Address before release.' },
      { re: /time\.Sleep/g,             sev:'MED',  desc:'time.Sleep in non-test code.', fix:'Use channels or timers for synchronization.' },
    ];
    for (const { re, sev, desc, fix } of goPatterns) {
      re.lastIndex = 0;
      if (re.test(code)) issues.push({ severity: sev, description: desc, fix });
    }
  }

  if (ext === 'java') {
    const javaPatterns = [
      { re: /System\.out\.print/g,      sev:'LOW',  desc:'System.out.print in production code.', fix:'Use a logging framework (SLF4J, Log4j).' },
      { re: /e\.printStackTrace\(\)/g,  sev:'MED',  desc:'printStackTrace() — exposes stack trace.', fix:'Log the exception using a logging framework.' },
      { re: /catch\s*\(\s*Exception\s+/g, sev:'MED', desc:'Catching generic Exception.', fix:'Catch specific exception types.' },
      { re: /new\s+Random\s*\(\)/g,     sev:'MED',  desc:'java.util.Random is not cryptographically secure.', fix:'Use SecureRandom for security contexts.' },
      { re: /TODO|FIXME/g,              sev:'LOW',  desc:'TODO/FIXME comment found.', fix:'Address before release.' },
      { re: /==\s*null|null\s*==/g,     sev:'LOW',  desc:'Null comparison with ==.', fix:'Use Objects.isNull() or Optional.' },
    ];
    for (const { re, sev, desc, fix } of javaPatterns) {
      re.lastIndex = 0;
      if (re.test(code)) issues.push({ severity: sev, description: desc, fix });
    }
  }

  if (ext === 'rs') {
    const rustPatterns = [
      { re: /\.unwrap\(\)/g,            sev:'MED',  desc:'.unwrap() will panic on None/Err.', fix:'Use match, if let, or ? operator for error handling.' },
      { re: /\.expect\(/g,              sev:'LOW',  desc:'.expect() will panic with a message.', fix:'Use proper error propagation with ?.' },
      { re: /unsafe\s*\{/g,             sev:'HIGH', desc:'unsafe block detected.', fix:'Document invariants and minimize unsafe surface area.' },
      { re: /todo!\(\)|unimplemented!\(\)/g, sev:'MED', desc:'todo!()/unimplemented!() will panic at runtime.', fix:'Implement or remove before release.' },
      { re: /println!/g,                sev:'LOW',  desc:'println! in production code.', fix:'Use a logging crate (tracing, log).' },
    ];
    for (const { re, sev, desc, fix } of rustPatterns) {
      re.lastIndex = 0;
      if (re.test(code)) issues.push({ severity: sev, description: desc, fix });
    }
  }

  if (ext === 'css') {
    const cssPatterns = [
      { re: /!important/g,              sev:'LOW',  desc:'!important overrides — specificity smell.', fix:'Refactor CSS specificity instead.' },
      { re: /\*\s*\{/g,                 sev:'LOW',  desc:'Universal selector (*) — performance impact.', fix:'Target specific elements.' },
    ];
    for (const { re, sev, desc, fix } of cssPatterns) {
      re.lastIndex = 0;
      if (re.test(code)) issues.push({ severity: sev, description: desc, fix });
    }
  }

  return issues;
}

// ─── HTML checks ─────────────────────────────────────────────────
function checkHTML(code) {
  const issues = [];
  if (!code.includes('<html lang='))
    issues.push({ severity: 'MED', description: 'Missing lang attribute on <html>.', fix: 'Add <html lang="en">.' });
  if (!code.includes('<title>') || code.match(/<title>\s*<\/title>/))
    issues.push({ severity: 'HIGH', description: 'Missing or empty <title>.', fix: 'Add <title>My Page</title>.' });
  if (code.includes('<img') && !code.includes('alt='))
    issues.push({ severity: 'MED', description: 'Images missing alt attributes.', fix: 'Add alt="..." to all <img> tags.' });
  if (!code.includes('viewport'))
    issues.push({ severity: 'MED', description: 'Missing viewport meta tag.', fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">.' });
  if (!code.includes('<meta name="description"'))
    issues.push({ severity: 'LOW', description: 'Missing meta description.', fix: 'Add <meta name="description" content="...">.' });
  return issues;
}

// ─── Analyze file (all engines combined) ─────────────────────────
async function analyzeFile(code, filename) {
  const ext    = filename.split('.').pop().toLowerCase();
  const issues = [];

  // 1. ESLint for JS/TS
  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    try {
      const eslint  = await getESLint();
      const results = await eslint.lintText(code, { filePath: filename });
      for (const msg of (results[0]?.messages || [])) {
        issues.push({
          severity:    msg.severity === 2 ? 'HIGH' : 'MED',
          description: msg.message,
          fix:         msg.fix?.text ? `Apply: ${msg.fix.text}` : `Line ${msg.line || '?'}: Review manually.`,
        });
      }
    } catch (e) { console.error('ESLint error:', e); }
  }

  // 2. HTML checks
  if (ext === 'html') issues.push(...checkHTML(code));

  // 3. Security scan (all languages)
  issues.push(...runSecurityScan(code, filename));

  // 4. Multi-language pattern analysis
  issues.push(...analyzeMultiLang(code, filename));

  // 5. AI analysis (if not already saturated)
  if (issues.length < 12) {
    // ============ NEW: Using callAIWithJSON from the provider system ============
    const aiIssues = await callAIWithJSON(
      `Analyse this code for bugs, security issues, and bad practices. File: ${filename}\n\n${code.slice(0, 3000)}\n\nReturn a JSON array ONLY (no other text): [{"severity":"HIGH|MED|LOW","description":"...","fix":"..."}]`,
      filename
    );
    const existing = new Set(issues.map(i => i.description));
    for (const ai of aiIssues) {
      if (!existing.has(ai.description)) { issues.push(ai); existing.add(ai.description); }
    }
  }

  // 5b. Custom user rules
  issues.push(...applyCustomRules(code, filename));

  // 6. Fallback: TODO/FIXME for unrecognized types
  if (issues.length === 0 && (code.includes('TODO') || code.includes('FIXME')))
    issues.push({ severity: 'LOW', description: 'Found TODO/FIXME comments.', fix: 'Address before release.' });

  return issues;
}

// ─── Fix generation ──────────────────────────────────────────────
async function generateFixesForFile(code, filename, issues) {
  let newCode   = code;
  const ext     = filename.split('.').pop().toLowerCase();
  const applied = [];

  // ESLint auto-fix for JS/TS
  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    try {
      const eslint  = await getESLint();
      const results = await eslint.lintText(newCode, { filePath: filename, fix: true });
      if (results[0]?.output) { newCode = results[0].output; applied.push('ESLint auto-fix'); }
    } catch (e) { console.error('ESLint fix error:', e); }
  }

  // HTML DOM fixes
  if (ext === 'html') {
    const dom = new JSDOM(newCode);
    const doc = dom.window.document;
    if (!doc.documentElement.hasAttribute('lang')) {
      doc.documentElement.setAttribute('lang', 'en'); applied.push('Added lang="en"');
    }
    if (!doc.querySelector('meta[name="viewport"]')) {
      const m = doc.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width, initial-scale=1.0';
      doc.head.appendChild(m); applied.push('Added viewport meta');
    }
    if (!doc.querySelector('title')) {
      const t = doc.createElement('title'); t.textContent = 'My Page';
      doc.head.appendChild(t); applied.push('Added title');
    }
    if (!doc.querySelector('meta[name="description"]')) {
      const m = doc.createElement('meta'); m.name = 'description'; m.content = 'Page description';
      doc.head.appendChild(m); applied.push('Added meta description');
    }
    doc.querySelectorAll('img:not([alt])').forEach(img => {
      img.setAttribute('alt', 'image'); applied.push('Added alt to image');
    });
    newCode = dom.serialize();
  }

  // AI fixes for remaining issues
  const aiIssues = issues.filter(i => i.fix && !i.fix.startsWith('Apply:') && !i.fix.startsWith('Line'));
  if (aiIssues.length > 0 && !applied.length) {
    // ============ NEW: Using callAIWithJSON for fix generation ============
    const aiResponse = await callAIWithJSON(
      `Fix the following issues and return ONLY the full corrected code, no explanation, no markdown fences.\nIssues:\n${aiIssues.map(i => `- ${i.description}`).join('\n')}\n\nFile: ${filename}\n\n${newCode}`,
      filename + '.fix'
    );
    if (aiResponse && aiResponse.length) {
      // The response might be a JSON array with fixes, but we just want the code
      // If it's not valid JSON, use it as raw response
      let rawResponse = aiResponse;
      if (Array.isArray(aiResponse) && aiResponse.length > 0 && aiResponse[0].fix) {
        rawResponse = aiResponse[0].fix;
      }
      const block = rawResponse.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      newCode = block ? block[1] : rawResponse;
      applied.push('AI-generated fixes');
    }
  }

  return { newCode, applied };
}

// ─── Feature generation ───────────────────────────────────────────
async function generateFeatureForFile(code, filename, featureDescription) {
  const prompt = `You are a senior engineer. Add the following feature to this file.
Feature request: ${featureDescription}
File: ${filename}

Rules:
- Return ONLY the complete updated file contents, no explanation, no markdown fences.
- Preserve all existing functionality.
- Follow the existing code style.
- Add a comment near the new code: // Added by VisCarMa: ${featureDescription.slice(0, 60)}

File contents:
${code.slice(0, 4000)}`;

  // ============ NEW: Using callAIWithJSON for feature generation ============
  const aiResponse = await callAIWithJSON(prompt, filename + '.feature');
  if (!aiResponse) return { newCode: code, success: false };
  // If callAIWithJSON returns an array, try to extract the code from the first item
  let raw = aiResponse;
  if (Array.isArray(aiResponse) && aiResponse.length > 0) {
    raw = aiResponse[0].fix || aiResponse[0].description || JSON.stringify(aiResponse);
  }
  const block = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  return { newCode: block ? block[1] : raw, success: true };
}

// ─── PR body builder ─────────────────────────────────────────────
function buildPRBody({ fixes, featureDescription, repoOwner, repoName, prType }) {
  const now        = new Date().toUTCString();
  const repoLink   = `https://github.com/${repoOwner}/${repoName}`;
  const authorLink = `[@suryasticsai](https://github.com/suryasticsai)`;
  const badge      = `[![VisCarMa](https://img.shields.io/badge/auto--fixed%20by-VisCarMa-388bfd?style=flat-square&logo=github)](https://viscarma.onrender.com)`;

  if (prType === 'feature') {
    return `${badge}

## ✨ Feature Added by VisCarMa

**Feature:** ${featureDescription}

### Files modified
${fixes.map(f => '- `' + f.file + '`').join('\n')}

### What changed
${fixes.map(f => '**`' + f.file + '`** — AI implemented: _' + featureDescription + '_').join('\n\n')}

---
🤖 Auto-generated by **[VisCarMa](https://viscarma.onrender.com)**
👤 Requested by ${authorLink} · 🕐 ${now} · 🔗 ${repoLink}`;
  }

  const fileDetails = fixes.map(f => {
    const appliedList = f.applied?.length
      ? f.applied.map(a => '  - ' + a).join('\n')
      : '  - No auto-fixes applied';
    return '**`' + f.file + '`**\n' + appliedList;
  }).join('\n\n');

  const securityIssues = fixes.flatMap(f =>
    (f.issues || []).filter(i => i.description?.includes('[SECURITY]'))
  );

  return `${badge}

## 🔧 Auto-fix PR by VisCarMa

### What was fixed
${fileDetails}

${securityIssues.length ? `### 🔒 Security issues addressed\n${securityIssues.map(i => '- ' + i.description).join('\n')}\n` : ''}
### Files changed
${fixes.map(f => '- `' + f.file + '`').join('\n')}

---
🤖 Auto-generated by **[VisCarMa](https://viscarma.onrender.com)**
👤 Fixed by ${authorLink} · 🕐 ${now} · 🔗 ${repoLink}`;
}

// ─── README updater ──────────────────────────────────────────────
async function updateReadme({ repoOwner, repoName, branch, fixes, featureDescription, prUrl, prNumber, ghToken, prType }) {
  const baseUrl  = `https://api.github.com/repos/${repoOwner}/${repoName}`;
  const now      = new Date().toUTCString();
  const typeLabel = prType === 'feature' ? '✨ Feature' : '🔧 Fix';
  const summary   = prType === 'feature'
    ? featureDescription
    : fixes.map(f => f.applied?.join(', ') || 'reviewed').join('; ');

  const newEntry = `| ${typeLabel} | ${fixes.map(f => '`' + f.file + '`').join(', ')} | ${summary} | [PR #${prNumber}](${prUrl}) | ${now} | [@suryasticsai](https://github.com/suryasticsai) |`;

  try {
    const readmeRes  = await fetch(`${baseUrl}/contents/README.md?ref=${branch}`, {
      headers: { Authorization: `token ${ghToken}` },
    });
    let currentContent = '', sha = null;
    if (readmeRes.ok) {
      const readmeData = await readmeRes.json();
      currentContent   = Buffer.from(readmeData.content, 'base64').toString('utf-8');
      sha              = readmeData.sha;
    }

    const header = `\n\n<!-- VISCARMA:START -->\n## 🤖 VisCarMa Change Log\n> Auto-maintained by [VisCarMa](https://viscarma.onrender.com) · Author: [@suryasticsai](https://github.com/suryasticsai)\n\n| Type | Files | Summary | PR | Date | Author |\n|------|-------|---------|-----|------|--------|\n`;
    const footer = `<!-- VISCARMA:END -->`;

    let updatedContent;
    if (currentContent.includes('<!-- VISCARMA:START -->')) {
      updatedContent = currentContent.replace(
        /(\| Type \| Files \| Summary \| PR \| Date \| Author \|\n\|[-|]+\|\n)/,
        `$1${newEntry}\n`
      );
    } else {
      updatedContent = currentContent + header + newEntry + '\n' + footer;
    }

    await fetch(`${baseUrl}/contents/README.md`, {
      method: 'PUT',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `docs: VisCarMa update README for PR #${prNumber}`,
        content: Buffer.from(updatedContent).toString('base64'),
        sha, branch,
      }),
    });
    console.log('[README] Updated for PR #' + prNumber);
  } catch (e) { console.error('[README] Update failed:', e.message); }
}

// ─── OAuth ───────────────────────────────────────────────────────
const GITHUB_AUTH_URL  = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

app.get('/auth/github', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauthState', state, {
    signed: true, maxAge: 10 * 60 * 1000,
    httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  console.log('[AUTH] Redirecting to GitHub OAuth, state:', state);
  res.redirect(`${GITHUB_AUTH_URL}?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=repo&state=${state}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const cookieState     = req.signedCookies.oauthState;
  console.log('[AUTH] Callback — code:', !!code, 'state match:', state === cookieState);
  if (!code) return res.status(400).send('Missing code');
  if (!state || state !== cookieState) return res.status(400).send('Invalid state — try again');
  res.clearCookie('oauthState');
  try {
    const tokenRes  = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code, redirect_uri: REDIRECT_URI }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).send('Token exchange failed');
    const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${tokenData.access_token}` } });
    const user    = await userRes.json();
    req.session.githubToken = tokenData.access_token;
    req.session.githubUser  = { id: user.id, login: user.login, avatar: user.avatar_url };
    console.log('[AUTH] Session set for user:', user.login, '— redirecting to /');
    res.redirect('/');
  } catch (e) { console.error('[AUTH] Callback error:', e); res.status(500).send('OAuth error: ' + e.message); }
});

app.get('/auth/logout', (req, res) => {
  req.session = null;
  res.clearCookie('oauthState');
  res.redirect('/');
});

app.get('/api/user', (req, res) => {
  res.json(req.session?.githubUser
    ? { user: req.session.githubUser, token: req.session.githubToken }
    : { user: null });
});

app.get('/api/repos', async (req, res) => {
  if (!req.session?.githubToken) return res.status(401).json({ error: 'Not logged in' });
  try {
    const r = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: { Authorization: `token ${req.session.githubToken}` },
    });
    res.json(await r.json());
  } catch { res.status(500).json({ error: 'Failed to fetch repos' }); }
});

// ─── Scan history API ─────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  res.json({ history: scanHistory });
});

// ─── Scan repo ───────────────────────────────────────────────────
const TEMP_DIR = path.join(process.cwd(), 'tmp');

app.post('/api/scan-repo', async (req, res) => {
  const { repoUrl, repoOwner, repoName, token } = req.body;
  const useToken = token || req.session?.githubToken;
  let cloneUrl   = repoUrl;
  if (useToken) cloneUrl = repoUrl.replace('https://', `https://x-access-token:${useToken}@`);

  const folderId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const repoPath = path.join(TEMP_DIR, folderId);
  await fs.mkdir(repoPath, { recursive: true });

  try {
    await simpleGit().clone(cloneUrl, repoPath, ['--depth', '1']);
    const files   = await walkDir(repoPath);
    const results = [];
    for (const filePath of files) {
      const relativePath = path.relative(repoPath, filePath);
      const code         = await fs.readFile(filePath, 'utf-8');
      const issues       = await analyzeFile(code, relativePath);
      results.push({ file: relativePath, code, issues });
    }
    await fs.rm(repoPath, { recursive: true, force: true });

    // Save to history
    const high   = results.reduce((s,f) => s + f.issues.filter(i=>i.severity==='HIGH').length, 0);
    const med    = results.reduce((s,f) => s + f.issues.filter(i=>i.severity==='MED').length, 0);
    const low    = results.reduce((s,f) => s + f.issues.filter(i=>i.severity==='LOW').length, 0);
    const security = results.reduce((s,f) => s + f.issues.filter(i=>i.description?.includes('[SECURITY]')).length, 0);
    await saveHistoryEntry({
      date: new Date().toISOString(),
      repo: `${repoOwner || ''}/${repoName || ''}`.replace(/^\//, ''),
      files: results.length,
      issues: results.reduce((s,f)=>s+f.issues.length,0),
      high, med, low, security,
    });

    res.json({ success: true, results });
  } catch (e) {
    console.error('[SCAN]', e);
    await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
    res.status(500).json({ error: 'Scan failed: ' + e.message });
  }
});

async function walkDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files   = [];
  const exclude = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '__pycache__', 'vendor'];
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkDir(fullPath)));
    else {
      const ext = entry.name.split('.').pop().toLowerCase();
      if (['js','ts','jsx','tsx','html','css','py','java','go','rs','c','cpp','h','rb','php'].includes(ext))
        files.push(fullPath);
    }
  }
  return files;
}

// ─── Generate fixes ──────────────────────────────────────────────
app.post('/api/generate-fixes', async (req, res) => {
  const { files } = req.body;
  const fixes = [];
  for (const item of files) {
    const { newCode, applied } = await generateFixesForFile(item.code, item.file, item.issues);
    fixes.push({ file: item.file, newCode, applied, issues: item.issues });
  }
  res.json({ fixes });
});

// ─── Generate feature ─────────────────────────────────────────────
app.post('/api/generate-feature', async (req, res) => {
  const { files, featureDescription } = req.body;
  if (!featureDescription) return res.status(400).json({ error: 'featureDescription required' });
  const results = [];
  for (const item of files) {
    const { newCode, success } = await generateFeatureForFile(item.code, item.file, featureDescription);
    results.push({ file: item.file, newCode, applied: success ? [`Feature: ${featureDescription}`] : [], success });
  }
  res.json({ fixes: results, featureDescription });
});

// ─── Create PR ───────────────────────────────────────────────────
app.post('/api/create-pr', async (req, res) => {
  const { repoOwner, repoName, branch, fixes, token, featureDescription, prType = 'fix' } = req.body;
  const ghToken = token || req.session?.githubToken;
  if (!ghToken) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const baseUrl  = `https://api.github.com/repos/${repoOwner}/${repoName}`;
    const baseRef  = await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
      headers: { Authorization: `token ${ghToken}` },
    });
    const baseData = await baseRef.json();
    if (!baseData.object?.sha) throw new Error(`Branch "${branch}" not found`);

    const newBranch = prType === 'feature'
      ? `viscarma-feature-${Date.now()}`
      : `viscarma-fix-${Date.now()}`;

    await fetch(`${baseUrl}/git/refs`, {
      method: 'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseData.object.sha }),
    });

    for (const fix of fixes) {
      if (!fix.newCode) continue;
      const fileRes  = await fetch(`${baseUrl}/contents/${fix.file}?ref=${newBranch}`, {
        headers: { Authorization: `token ${ghToken}` },
      });
      const fileData = await fileRes.json();
      const oldContent = fileData.content ? Buffer.from(fileData.content, 'base64').toString('utf-8') : null;
      if (oldContent === fix.newCode) continue;

      await fetch(`${baseUrl}/contents/${fix.file}`, {
        method:  fileData.sha ? 'PUT' : 'POST',
        headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prType === 'feature'
            ? `feat: VisCarMa adds "${featureDescription?.slice(0, 60)}" to ${fix.file}`
            : `fix: VisCarMa auto-fix in ${fix.file} (${fix.applied?.join(', ')})`,
          content: Buffer.from(fix.newCode).toString('base64'),
          ...(fileData.sha ? { sha: fileData.sha } : {}),
          branch: newBranch,
        }),
      });
    }

    const prBody  = buildPRBody({ fixes, featureDescription, repoOwner, repoName, prType });
    const prTitle = prType === 'feature'
      ? `feat: VisCarMa — ${featureDescription?.slice(0, 72)}`
      : `fix: auto-generated fixes by VisCarMa`;

    const pr     = await fetch(`${baseUrl}/pulls`, {
      method: 'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: prTitle, head: newBranch, base: branch, body: prBody }),
    });
    const prData = await pr.json();
    if (!prData.html_url) throw new Error(prData.message || 'PR creation failed');

    await updateReadme({
      repoOwner, repoName, branch: newBranch, fixes, featureDescription, prType,
      prUrl: prData.html_url, prNumber: prData.number, ghToken,
    });

    res.json({ url: prData.html_url, number: prData.number });
  } catch (e) {
    console.error('[PR]', e);
    res.status(500).json({ error: 'PR creation failed: ' + e.message });
  }
});

// ─── TIER 2: GitHub PR Reviewer ──────────────────────────────────
// Posts AI review comments on an EXISTING open PR (not one we created)
app.post('/api/review-pr', async (req, res) => {
  const { repoOwner, repoName, prNumber, token } = req.body;
  const ghToken = token || req.session?.githubToken;
  if (!ghToken) return res.status(401).json({ error: 'Not authenticated' });
  if (!prNumber) return res.status(400).json({ error: 'prNumber required' });

  try {
    const baseUrl = `https://api.github.com/repos/${repoOwner}/${repoName}`;

    // Fetch the PR diff
    const diffRes = await fetch(`${baseUrl}/pulls/${prNumber}/files`, {
      headers: { Authorization: `token ${ghToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    const changedFiles = await diffRes.json();
    if (!Array.isArray(changedFiles)) throw new Error('Failed to fetch PR files');

    // AI-review each changed file's patch
    const comments = [];
    const reviewNotes = [];

    for (const file of changedFiles.slice(0, 10)) { // cap at 10 files
      if (!file.patch) continue;
      // ============ NEW: Using callAIWithJSON ============
      const aiIssues = await callAIWithJSON(
        `Review this code diff and identify bugs, security issues, or bad practices.\nFile: ${file.filename}\n\nDiff:\n${file.patch.slice(0, 2000)}\n\nReturn a JSON array ONLY: [{"line_note":"...","severity":"HIGH|MED|LOW","suggestion":"..."}]`,
        file.filename + '.diff'
      );
      for (const issue of aiIssues) {
        reviewNotes.push('**`' + file.filename + '`** [' + issue.severity + '] ' + (issue.line_note || issue.description) + ' — ' + (issue.suggestion || issue.fix));
      }
    }

    // Post a single review comment on the PR
    const reviewBody = reviewNotes.length
      ? `## 🔍 VisCarMa AI Code Review\n\n${reviewNotes.join('\n\n')}\n\n---\n🤖 Review by **[VisCarMa](https://viscarma.onrender.com)** · [@suryasticsai](https://github.com/suryasticsai)`
      : `## ✅ VisCarMa AI Code Review\n\nNo significant issues found in this PR.\n\n---\n🤖 Review by **[VisCarMa](https://viscarma.onrender.com)**`;

    const reviewRes = await fetch(`${baseUrl}/pulls/${prNumber}/reviews`, {
      method: 'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: reviewBody, event: 'COMMENT' }),
    });
    const reviewData = await reviewRes.json();
    if (!reviewData.id) throw new Error(reviewData.message || 'Review post failed');

    res.json({ reviewId: reviewData.id, url: reviewData.html_url, issueCount: reviewNotes.length });
  } catch (e) {
    console.error('[REVIEW-PR]', e);
    res.status(500).json({ error: 'PR review failed: ' + e.message });
  }
});

// ─── Jira integration ─────────────────────────────────────────────
app.post('/api/jira-tasks', async (req, res) => {
  const { url, token, email, project } = req.body;
  if (!url || !token || !email || !project)
    return res.status(400).json({ error: 'url, token, email, project required' });

  try {
    const auth    = Buffer.from(`${email}:${token}`).toString('base64');
    const jiraRes = await fetch(
      `${url.replace(/\/$/, '')}/rest/api/3/search?jql=project=${project}+AND+statusCategory!=Done&maxResults=20&fields=summary,description,priority,status`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }
    );
    if (!jiraRes.ok) throw new Error(`Jira returned ${jiraRes.status}`);
    const data  = await jiraRes.json();
    const tasks = (data.issues || []).map(issue => ({
      key:         issue.key,
      summary:     issue.fields.summary,
      priority:    issue.fields.priority?.name || 'Medium',
      status:      issue.fields.status?.name || 'Open',
      description: issue.fields.description?.content?.[0]?.content?.[0]?.text || '',
    }));
    res.json({ tasks });
  } catch (e) {
    console.error('[JIRA]', e);
    res.status(500).json({ error: 'Jira fetch failed: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// SERVER-SIDE AGENT
// ══════════════════════════════════════════════════════════════

const agentJobs = new Map();

function makeJobId() { return crypto.randomBytes(8).toString('hex'); }

async function runAgentJob(job) {
  const { tasks, repoUrl, repoOwner, repoName, repoBranch, ghToken, pushSubscription } = job;

  for (let i = 0; i < tasks.length; i++) {
    if (job.stopped) break;
    if (Date.now() > job.endTime) { job.log.push('Time window expired.'); break; }

    const task = tasks[i];
    task.status = 'running';
    job.currentIndex = i;
    job.log.push(`[${new Date().toLocaleTimeString()}] Starting: "${task.text}"`);

    try {
      const isFeature = /\b(add|implement|build|create|generate|make)\b/i.test(task.text);

      // Always scan first
      const folderId = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      const repoPath = path.join(TEMP_DIR, folderId);
      await fs.mkdir(repoPath, { recursive: true });
      let cloneUrl = repoUrl;
      if (ghToken) cloneUrl = repoUrl.replace('https://', `https://x-access-token:${ghToken}@`);
      await simpleGit().clone(cloneUrl, repoPath, ['--depth','1']);
      const files   = await walkDir(repoPath);
      const results = [];
      for (const fp of files) {
        const rel  = path.relative(repoPath, fp);
        const code = await fs.readFile(fp, 'utf-8');
        const issues = await analyzeFile(code, rel);
        results.push({ file: rel, code, issues });
      }
      await fs.rm(repoPath, { recursive: true, force: true });

      if (isFeature) {
        const selected = results.slice(0, 3).map(r => ({ file: r.file, code: r.code }));
        const featRes  = await fetch(`http://localhost:${PORT}/api/generate-feature`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: selected, featureDescription: task.text }),
        });
        const featData = await featRes.json();
        if (featData.fixes?.length) {
          const prRes  = await fetch(`http://localhost:${PORT}/api/create-pr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoOwner, repoName, branch: repoBranch||'main', fixes: featData.fixes, token: ghToken, prType:'feature', featureDescription: task.text }),
          });
          const prData = await prRes.json();
          if (prData.url) {
            task.prUrl = prData.url;
            task.prNumber = prData.number;
            job.log.push(`[${new Date().toLocaleTimeString()}] Feature PR #${prData.number} opened: ${prData.url}`);
            job.prs.push({ number: prData.number, url: prData.url, type: 'feature', task: task.text });
          }
        }
      } else {
        const filesToFix = results.filter(f => f.issues?.length > 0).map(f => ({ file:f.file, code:f.code, issues:f.issues }));
        if (!filesToFix.length) {
          job.log.push(`[${new Date().toLocaleTimeString()}] No issues found for this task.`);
        } else {
          const fixRes  = await fetch(`http://localhost:${PORT}/api/generate-fixes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesToFix }),
          });
          const fixData = await fixRes.json();
          if (fixData.fixes?.length) {
            const prRes  = await fetch(`http://localhost:${PORT}/api/create-pr`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ repoOwner, repoName, branch: repoBranch||'main', fixes: fixData.fixes, token: ghToken, prType:'fix' }),
            });
            const prData = await prRes.json();
            if (prData.url) {
              task.prUrl = prData.url;
              task.prNumber = prData.number;
              job.log.push(`[${new Date().toLocaleTimeString()}] Fix PR #${prData.number} opened: ${prData.url}`);
              job.prs.push({ number: prData.number, url: prData.url, type: 'fix', task: task.text });
            }
          }
        }
      }
      task.status = 'done';
      job.log.push(`[${new Date().toLocaleTimeString()}] Done: "${task.text}"`);
    } catch (e) {
      task.status = 'error';
      job.log.push(`[${new Date().toLocaleTimeString()}] Failed: ${e.message}`);
    }
  }

  job.status   = 'complete';
  job.endedAt  = new Date().toISOString();
  const summary = `VisCarMa finished! ${job.prs.length} PR(s) opened on ${repoOwner}/${repoName}.`;
  job.log.push(`[${new Date().toLocaleTimeString()}] ${summary}`);

  // Send browser push notification
  if (pushSubscription) {
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify({
        title: '🕵️ VisCarMa Done',
        body:  summary,
        icon:  '/viscarma_logo.png',
        badge: '/viscarma_logo.png',
        data:  { prs: job.prs },
      }));
      job.log.push(`[${new Date().toLocaleTimeString()}] Push notification sent.`);
    } catch (e) {
      job.log.push(`[${new Date().toLocaleTimeString()}] Push notification failed: ${e.message}`);
    }
  }
}

// Agent API
app.post('/api/agent/start', async (req, res) => {
  const { tasks, repoUrl, repoOwner, repoName, repoBranch, durationMins, token, pushSubscription } = req.body;
  const ghToken = token || req.session?.githubToken;
  if (!ghToken)    return res.status(401).json({ error: 'Not authenticated' });
  if (!tasks?.length) return res.status(400).json({ error: 'No tasks provided' });
  if (!repoUrl)    return res.status(400).json({ error: 'repoUrl required' });

  const jobId  = makeJobId();
  const endTime = Date.now() + (durationMins || 45) * 60 * 1000;

  const job = {
    id: jobId, status: 'running',
    startedAt: new Date().toISOString(), endedAt: null,
    endTime, stopped: false,
    repoUrl, repoOwner, repoName, repoBranch: repoBranch||'main',
    ghToken, pushSubscription: pushSubscription || null,
    tasks: tasks.map(t => ({ text: t, status: 'pending', prUrl: null, prNumber: null })),
    currentIndex: 0, prs: [], log: [],
  };

  agentJobs.set(jobId, job);
  req.session.agentJobId = jobId;

  job.log.push(`[${new Date().toLocaleTimeString()}] Agent activated — ${tasks.length} task(s), ${durationMins||45} min window`);
  res.json({ jobId, status: 'running', message: 'Agent started on server' });

  runAgentJob(job).catch(e => {
    job.status = 'error';
    job.log.push(`[${new Date().toLocaleTimeString()}] Agent crashed: ${e.message}`);
  });
});

app.get('/api/agent/status', (req, res) => {
  const jobId = req.query.jobId || req.session?.agentJobId;
  if (!jobId || !agentJobs.has(jobId)) {
    return res.json({ status: 'idle', jobId: null });
  }
  const job = agentJobs.get(jobId);
  res.json({
    jobId:        job.id,
    status:       job.status,
    startedAt:    job.startedAt,
    endedAt:      job.endedAt,
    endTime:      job.endTime,
    currentIndex: job.currentIndex,
    tasks:        job.tasks.map(t => ({ text: t.text, status: t.status, prUrl: t.prUrl, prNumber: t.prNumber })),
    prs:          job.prs,
    log:          job.log.slice(-50),
  });
});

app.post('/api/agent/stop', (req, res) => {
  const jobId = req.body.jobId || req.session?.agentJobId;
  if (jobId && agentJobs.has(jobId)) {
    const job = agentJobs.get(jobId);
    job.stopped = true;
    job.status  = 'stopped';
    job.log.push(`[${new Date().toLocaleTimeString()}] Agent stopped by user.`);
  }
  req.session.agentJobId = null;
  res.json({ ok: true });
});

// ─── BROWSER PUSH NOTIFICATIONS ──────────────────────────────────
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_EMAIL       = process.env.VAPID_EMAIL       || 'mailto:suryasticsai@gmail.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('🔔 Web Push VAPID configured');
} else {
  console.log('⚠️  VAPID keys not set — push notifications disabled');
}

app.get('/api/push/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ key: VAPID_PUBLIC_KEY });
});

// ─── GITHUB ACTION GENERATOR ──────────────────────────────────────
app.post('/api/generate-action', async (req, res) => {
  const { repoOwner, repoName, branch, token } = req.body;
  const ghToken = token || req.session?.githubToken;
  if (!ghToken) return res.status(401).json({ error: 'Not authenticated' });

  const workflowYml = `# VisCarMa Auto-Scan Workflow
# Auto-generated by VisCarMa (https://viscarma.onrender.com)
# Scans your code on every push and pull request

name: VisCarMa Code Scan

on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master ]
  schedule:
    # Run every day at 2am UTC
    - cron: '0 2 * * *'
  workflow_dispatch:
    # Allow manual trigger from GitHub Actions UI

jobs:
  viscarma-scan:
    name: VisCarMa Scan & Fix
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run VisCarMa scan
        id: scan
        run: |
          echo "Triggering VisCarMa scan..."
          RESPONSE=$(curl -s -X POST \\
            -H "Content-Type: application/json" \\
            -d '{
              "repoUrl": "https://github.com/\${{ github.repository }}.git",
              "repoOwner": "\${{ github.repository_owner }}",
              "repoName": "\${{ github.event.repository.name }}",
              "token": "\${{ secrets.VISCARMA_TOKEN }}"
            }' \\
            https://viscarma.onrender.com/api/scan-repo)
          echo "scan_result=\$RESPONSE" >> \$GITHUB_OUTPUT
          echo "Scan complete"

      - name: Comment scan summary on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🕵️ **VisCarMa scan complete.** [View full report](https://viscarma.onrender.com) | Powered by [VisCarMa](https://viscarma.onrender.com)'
            })

# Required secrets:
# VISCARMA_TOKEN — your GitHub personal access token (repo scope)
# Add it at: Settings → Secrets and variables → Actions → New repository secret
`;

  try {
    const baseUrl   = `https://api.github.com/repos/${repoOwner}/${repoName}`;
    const baseSha   = await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
      headers: { Authorization: `token ${ghToken}` },
    }).then(r => r.json()).then(d => d.object?.sha);
    if (!baseSha) throw new Error(`Branch "${branch}" not found`);

    const newBranch = `viscarma-action-${Date.now()}`;
    await fetch(`${baseUrl}/git/refs`, {
      method: 'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
    });

    const existing = await fetch(`${baseUrl}/contents/.github/workflows/viscarma.yml?ref=${newBranch}`, {
      headers: { Authorization: `token ${ghToken}` },
    }).then(r => r.ok ? r.json() : null);

    await fetch(`${baseUrl}/contents/.github/workflows/viscarma.yml`, {
      method: existing?.sha ? 'PUT' : 'PUT',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'ci: add VisCarMa auto-scan GitHub Action',
        content: Buffer.from(workflowYml).toString('base64'),
        ...(existing?.sha ? { sha: existing.sha } : {}),
        branch: newBranch,
      }),
    });

    const now        = new Date().toUTCString();
    const badge      = '[![VisCarMa](https://img.shields.io/badge/auto--scan%20by-VisCarMa-388bfd?style=flat-square&logo=github)](https://viscarma.onrender.com)';
    const prBody     = [
      badge,
      '',
      '## ⚡ VisCarMa GitHub Action',
      '',
      'This PR adds a VisCarMa auto-scan workflow to your repository.',
      '',
      '### What it does',
      '- Scans your code on every push to `main`, `master`, `develop`',
      '- Scans every pull request automatically',
      '- Runs a scheduled daily scan at 2am UTC',
      '- Can be triggered manually from the GitHub Actions UI',
      '- Posts a comment on PRs with the scan summary',
      '',
      '### Setup required',
      'Add `VISCARMA_TOKEN` to your repository secrets:',
      '1. Go to **Settings → Secrets and variables → Actions**',
      '2. Click **New repository secret**',
      '3. Name: `VISCARMA_TOKEN`, Value: your GitHub personal access token (repo scope)',
      '',
      '---',
      `🤖 Auto-generated by **[VisCarMa](https://viscarma.onrender.com)** · 🕐 ${now}`,
    ].join('\n');

    const pr     = await fetch(`${baseUrl}/pulls`, {
      method: 'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'ci: add VisCarMa auto-scan GitHub Action',
        head:  newBranch, base: branch, body: prBody,
      }),
    });
    const prData = await pr.json();
    if (!prData.html_url) throw new Error(prData.message || 'PR failed');

    res.json({ url: prData.html_url, number: prData.number, workflow: workflowYml });
  } catch (e) {
    console.error('[ACTION]', e);
    res.status(500).json({ error: 'Action generation failed: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// TIER 3: CUSTOM RULE BUILDER
// ══════════════════════════════════════════════════════════════
const RULES_FILE = path.join(process.cwd(), 'data', 'rules.json');
let customRules = [];

async function loadCustomRules() {
  try {
    const raw = await fs.readFile(RULES_FILE, 'utf-8');
    customRules = JSON.parse(raw);
  } catch { customRules = []; }
}
loadCustomRules();

async function saveCustomRules() {
  await fs.mkdir(path.dirname(RULES_FILE), { recursive: true });
  await fs.writeFile(RULES_FILE, JSON.stringify(customRules, null, 2));
}

// Apply custom rules to code
function applyCustomRules(code, filename) {
  const issues = [];
  const ext    = filename.split('.').pop().toLowerCase();
  for (const rule of customRules) {
    if (rule.disabled) continue;
    if (rule.fileTypes?.length && !rule.fileTypes.includes(ext)) continue;
    try {
      const re = new RegExp(rule.pattern, rule.flags || 'g');
      if (re.test(code)) {
        issues.push({
          severity:    rule.severity || 'MED',
          description: `[CUSTOM] ${rule.name}: ${rule.description}`,
          fix:         rule.fix || 'Review manually.',
        });
      }
    } catch { /* invalid regex — skip */ }
  }
  return issues;
}

app.get('/api/rules', (req, res) => {
  res.json({ rules: customRules });
});

app.post('/api/rules', async (req, res) => {
  const { name, description, pattern, flags, severity, fix, fileTypes } = req.body;
  if (!name || !pattern) return res.status(400).json({ error: 'name and pattern required' });
  try { new RegExp(pattern, flags || 'g'); }
  catch(e) { return res.status(400).json({ error: 'Invalid regex: ' + e.message }); }

  const rule = {
    id:          crypto.randomBytes(6).toString('hex'),
    name, description, pattern,
    flags:       flags || 'g',
    severity:    severity || 'MED',
    fix:         fix || '',
    fileTypes:   fileTypes || [],
    disabled:    false,
    createdAt:   new Date().toISOString(),
    marketplace: false,
  };
  customRules.push(rule);
  await saveCustomRules();
  res.json({ rule });
});

app.put('/api/rules/:id', async (req, res) => {
  const idx = customRules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Rule not found' });
  customRules[idx] = { ...customRules[idx], ...req.body, id: customRules[idx].id };
  await saveCustomRules();
  res.json({ rule: customRules[idx] });
});

app.delete('/api/rules/:id', async (req, res) => {
  const before = customRules.length;
  customRules   = customRules.filter(r => r.id !== req.params.id);
  await saveCustomRules();
  res.json({ deleted: customRules.length < before });
});

// ══════════════════════════════════════════════════════════════
// TIER 3: SCHEDULED AUTO-FIX
// ══════════════════════════════════════════════════════════════
const SCHEDULES_FILE = path.join(process.cwd(), 'data', 'schedules.json');
let schedules   = [];
const cronJobs  = new Map();

async function loadSchedules() {
  try {
    const raw = await fs.readFile(SCHEDULES_FILE, 'utf-8');
    schedules = JSON.parse(raw);
    for (const s of schedules) {
      if (!s.disabled) registerCronJob(s);
    }
  } catch { schedules = []; }
}

async function saveSchedules() {
  await fs.mkdir(path.dirname(SCHEDULES_FILE), { recursive: true });
  await fs.writeFile(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

function registerCronJob(schedule) {
  if (cronJobs.has(schedule.id)) cronJobs.get(schedule.id).destroy();
  if (!cron.validate(schedule.cron)) return;

  const job = cron.schedule(schedule.cron, async () => {
    console.log(`[CRON] Running schedule "${schedule.name}" for ${schedule.repoOwner}/${schedule.repoName}`);
    schedule.lastRunAt = new Date().toISOString();
    schedule.lastRunStatus = 'running';
    await saveSchedules();

    try {
      const folderId = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      const repoPath = path.join(TEMP_DIR, folderId);
      await fs.mkdir(repoPath, { recursive: true });
      let cloneUrl = schedule.repoUrl;
      if (schedule.token) cloneUrl = schedule.repoUrl.replace('https://', `https://x-access-token:${schedule.token}@`);
      await simpleGit().clone(cloneUrl, repoPath, ['--depth','1']);
      const files   = await walkDir(repoPath);
      const results = [];
      for (const fp of files) {
        const rel    = path.relative(repoPath, fp);
        const code   = await fs.readFile(fp, 'utf-8');
        const issues = await analyzeFile(code, rel);
        results.push({ file: rel, code, issues });
      }
      await fs.rm(repoPath, { recursive: true, force: true });

      const filesToFix = results.filter(f => f.issues?.length > 0).map(f => ({ file:f.file, code:f.code, issues:f.issues }));
      if (!filesToFix.length) {
        schedule.lastRunStatus = 'clean';
        schedule.lastRunMessage = 'No issues found.';
        await saveSchedules();
        return;
      }
      const fixes = [];
      for (const item of filesToFix) {
        const { newCode, applied } = await generateFixesForFile(item.code, item.file, item.issues);
        fixes.push({ file: item.file, newCode, applied, issues: item.issues });
      }

      const baseUrl  = `https://api.github.com/repos/${schedule.repoOwner}/${schedule.repoName}`;
      const baseRef  = await fetch(`${baseUrl}/git/refs/heads/${schedule.branch||'main'}`, {
        headers: { Authorization: `token ${schedule.token}` },
      });
      const baseData = await baseRef.json();
      if (!baseData.object?.sha) throw new Error('Branch not found');
      const newBranch = `viscarma-scheduled-${Date.now()}`;
      await fetch(`${baseUrl}/git/refs`, {
        method: 'POST',
        headers: { Authorization: `token ${schedule.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseData.object.sha }),
      });
      for (const fix of fixes) {
        if (!fix.newCode) continue;
        const fileRes  = await fetch(`${baseUrl}/contents/${fix.file}?ref=${newBranch}`, {
          headers: { Authorization: `token ${schedule.token}` },
        });
        const fileData = await fileRes.json();
        if (!fileData.sha) continue;
        const oldContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
        if (oldContent === fix.newCode) continue;
        await fetch(`${baseUrl}/contents/${fix.file}`, {
          method: 'PUT',
          headers: { Authorization: `token ${schedule.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `fix: scheduled VisCarMa auto-fix — ${schedule.name}`,
            content: Buffer.from(fix.newCode).toString('base64'),
            sha: fileData.sha, branch: newBranch,
          }),
        });
      }
      const pr = await fetch(`${baseUrl}/pulls`, {
        method: 'POST',
        headers: { Authorization: `token ${schedule.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `fix: scheduled auto-fix by VisCarMa (${schedule.name})`,
          head: newBranch, base: schedule.branch||'main',
          body: `[![VisCarMa](https://img.shields.io/badge/auto--fixed%20by-VisCarMa-388bfd?style=flat-square)](https://viscarma.onrender.com)\n\n## ⏰ Scheduled Fix\n\nSchedule: **${schedule.name}** (${schedule.cron})\n\nFiles fixed: ${fixes.map(f => '`' + f.file + '`').join(', ')}\n\n---\n🤖 by [VisCarMa](https://viscarma.onrender.com)`,
        }),
      });
      const prData = await pr.json();
      schedule.lastRunStatus  = 'success';
      schedule.lastRunMessage = prData.html_url ? `PR #${prData.number} opened` : 'PR failed';
      schedule.lastPrUrl      = prData.html_url || null;
      schedule.runCount       = (schedule.runCount || 0) + 1;
      await saveSchedules();
      console.log(`[CRON] ${schedule.name} — ${schedule.lastRunMessage}`);
    } catch(e) {
      schedule.lastRunStatus  = 'error';
      schedule.lastRunMessage = e.message;
      await saveSchedules();
      console.error('[CRON] Schedule failed:', e.message);
    }
  }, { timezone: 'UTC' });

  cronJobs.set(schedule.id, job);
}

loadSchedules();

app.get('/api/schedules', (req, res) => {
  res.json({ schedules: schedules.map(s => ({ ...s, token: undefined })) });
});

app.post('/api/schedules', async (req, res) => {
  const { name, cron: cronExpr, repoUrl, repoOwner, repoName, branch, token } = req.body;
  if (!name || !cronExpr || !repoUrl || !token) return res.status(400).json({ error: 'name, cron, repoUrl, token required' });
  if (!cron.validate(cronExpr)) return res.status(400).json({ error: 'Invalid cron expression' });

  const schedule = {
    id: crypto.randomBytes(6).toString('hex'),
    name, cron: cronExpr, repoUrl, repoOwner, repoName,
    branch: branch || 'main', token,
    disabled: false, runCount: 0,
    createdAt: new Date().toISOString(),
    lastRunAt: null, lastRunStatus: null, lastRunMessage: null, lastPrUrl: null,
  };
  schedules.push(schedule);
  await saveSchedules();
  registerCronJob(schedule);
  res.json({ schedule: { ...schedule, token: undefined } });
});

app.delete('/api/schedules/:id', async (req, res) => {
  if (cronJobs.has(req.params.id)) {
    cronJobs.get(req.params.id).destroy();
    cronJobs.delete(req.params.id);
  }
  const before = schedules.length;
  schedules = schedules.filter(s => s.id !== req.params.id);
  await saveSchedules();
  res.json({ deleted: schedules.length < before });
});

app.patch('/api/schedules/:id/toggle', async (req, res) => {
  const schedule = schedules.find(s => s.id === req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
  schedule.disabled = !schedule.disabled;
  if (schedule.disabled && cronJobs.has(schedule.id)) {
    cronJobs.get(schedule.id).destroy();
    cronJobs.delete(schedule.id);
  } else if (!schedule.disabled) {
    registerCronJob(schedule);
  }
  await saveSchedules();
  res.json({ schedule: { ...schedule, token: undefined } });
});

// ─── Health check ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const aiStatus = process.env.AI_PROVIDER || 'openrouter';
  res.json({ status: 'ok', timestamp: new Date().toISOString(), aiProvider: aiStatus });
});

app.listen(PORT, () => {
  console.log(`🕵️ VisCarma backend running on port ${PORT}`);
  console.log(`🔐 AI Provider: ${process.env.AI_PROVIDER || 'openrouter'}`);
  console.log(`🔐 GROQ_API_KEY ${process.env.GROQ_API_KEY ? '✓ set' : '✗ not set'}`);
  console.log(`🔐 OPENROUTER_API_KEY ${process.env.OPENROUTER_API_KEY ? '✓ set' : '✗ not set'}`);
});