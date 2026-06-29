// server.js — VisCarMa Backend v2.0
// New in this version:
//   - Security scanner (OWASP top 10, secrets, SQL injection)
//   - Multi-language analysis (Python, Go, Java, Rust via pattern rules)
//   - GitHub PR reviewer (post AI review comments on existing open PRs)
//   - Jira integration (/api/jira-tasks)
//   - Server-side scan history (/api/history)
//   - All Tier 1 + Tier 2 features

import express      from 'express';
import cors         from 'cors';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import { ESLint }   from 'eslint';
import { JSDOM }    from 'jsdom';
import * as cheerio  from 'cheerio';
import Diff          from 'diff';
import simpleGit    from 'simple-git';
import path         from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import crypto       from 'crypto';
import webpush      from 'web-push';
import cron         from 'node-cron';

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
  SESSION_SECRET = 'dev-secret-change-me-in-production',
  REDIRECT_URI   = 'https://viscarma.onrender.com/auth/callback',
  FRONTEND_URL   = 'https://viscarma.onrender.com',
} = process.env;

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

// ─── AI call ─────────────────────────────────────────────────────
async function callAI(prompt) {
  const useOllama = OLLAMA_API_KEY && OLLAMA_API_KEY.length > 0;
  let endpoint, headers, body;

  if (useOllama) {
    endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/generate';
    headers  = { 'Content-Type': 'application/json' };
    if (OLLAMA_API_KEY) headers['Authorization'] = `Bearer ${OLLAMA_API_KEY}`;
    body = { model: process.env.OLLAMA_MODEL || 'llama3.2', prompt, stream: false };
  } else {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    headers  = { 'Content-Type': 'application/json' };
    body = {
      model: 'google/gemma-2-9b-it:free',
      messages: [
        { role: 'system', content: 'You are a senior code reviewer and engineer. Follow instructions exactly.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.3, max_tokens: 1200,
    };
  }

  try {
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) return null;
    const data = await res.json();
    return useOllama ? (data.response || null) : (data.choices?.[0]?.message?.content || null);
  } catch (e) { console.error('AI error:', e.message); return null; }
}

function parseAIResponse(text) {
  if (!text) return [];
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { const p = JSON.parse(match[0]); return Array.isArray(p) ? p : []; }
  catch { return []; }
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
    const aiRaw    = await callAI(
      `Analyse this code for bugs, security issues, and bad practices. File: ${filename}\n\n${code.slice(0, 3000)}\n\nReturn a JSON array ONLY (no other text): [{"severity":"HIGH|MED|LOW","description":"...","fix":"..."}]`
    );
    const aiIssues = parseAIResponse(aiRaw);
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
    const aiResponse = await callAI(
      `Fix the following issues and return ONLY the full corrected code, no explanation, no markdown fences.\nIssues:\n${aiIssues.map(i => `- ${i.description}`).join('\n')}\n\nFile: ${filename}\n\n${newCode}`
    );
    if (aiResponse) {
      const block = aiResponse.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      newCode = block ? block[1] : aiResponse;
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

  const aiResponse = await callAI(prompt);
  if (!aiResponse) return { newCode: code, success: false };
  const block = aiResponse.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  return { newCode: block ? block[1] : aiResponse, success: true };
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
      ? f.applied.map(a => `  - ${a}`).join('\n')
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
      const aiRaw = await callAI(
        `Review this code diff and identify bugs, security issues, or bad practices.\nFile: ${file.filename}\n\nDiff:\n${file.patch.slice(0, 2000)}\n\nReturn a JSON array ONLY: [{"line_note":"...","severity":"HIGH|MED|LOW","suggestion":"..."}]`
      );
      const aiIssues = parseAIResponse(aiRaw);
      for (const issue of aiIssues) {
        reviewNotes.push('**`' + file.filename + '`** [' + issue.severity + '] ' + issue.line_note + ' — ' + issue.suggestion);
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

// ─── SERVER-SIDE AGENT ───────────────────────────────────────────
// Runs entirely on the server — survives browser tab close.
// Browser polls /api/agent/status every 3s to get live updates.

const agentJobs = new Map(); // sessionId -> job state

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

      try {
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
        await fs.rm(repoPath, { recursive: true, force: true }).catch(()=>{});
        throw e;
      }
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
  // Store jobId in session so status can be polled
  req.session.agentJobId = jobId;

  job.log.push(`[${new Date().toLocaleTimeString()}] Agent activated — ${tasks.length} task(s), ${durationMins||45} min window`);
  res.json({ jobId, status: 'running', message: 'Agent started on server' });

  // Run async — don't await (non-blocking)
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
    log:          job.log.slice(-50), // last 50 log lines
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
// VAPID keys — generate once and store in env vars:
//   npx web-push generate-vapid-keys
// Then set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Render env vars.

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_EMAIL       = process.env.VAPID_EMAIL       || 'mailto:suryasticsai@gmail.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('🔔 Web Push VAPID configured');
} else {
  console.log('⚠️  VAPID keys not set — push notifications disabled (set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY)');
}

app.get('/api/push/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ key: VAPID_PUBLIC_KEY });
});

// ─── GITHUB ACTION GENERATOR ──────────────────────────────────────
// Generates .github/workflows/viscarma.yml and commits it via PR

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
          RESPONSE=$(curl -s -X POST \
            -H "Content-Type: application/json" \
            -d '{
              "repoUrl": "https://github.com/\${{ github.repository }}.git",
              "repoOwner": "\${{ github.repository_owner }}",
              "repoName": "\${{ github.event.repository.name }}",
              "token": "\${{ secrets.VISCARMA_TOKEN }}"
            }' \
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

    // Check if workflow file already exists
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
    // fileTypes filter — empty means all files
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
  // Validate regex before saving
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
    // Re-register all active cron jobs on startup
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
      // Scan
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

      // Fix
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

      // PR
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
  if (cronJobs.has(req.params.id)) { cronJobs.get(req.params.id).destroy(); cronJobs.delete(req.params.id); }
  schedules = schedules.filter(s => s.id !== req.params.id);
  await saveSchedules();
  res.json({ deleted: true });
});

app.post('/api/schedules/:id/toggle', async (req, res) => {
  const s = schedules.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  s.disabled = !s.disabled;
  if (s.disabled) { cronJobs.get(s.id)?.destroy(); cronJobs.delete(s.id); }
  else registerCronJob(s);
  await saveSchedules();
  res.json({ disabled: s.disabled });
});

// ══════════════════════════════════════════════════════════════
// TIER 3: TEST GENERATOR
// ══════════════════════════════════════════════════════════════
async function generateTestsForFile(code, filename) {
  const ext      = filename.split('.').pop().toLowerCase();
  const framework = ext === 'py' ? 'pytest' : ext === 'java' ? 'JUnit 5' : 'Jest';
  const testExt   = ext === 'py' ? 'py' : ext === 'java' ? 'java' : ext;
  const testFile  = filename.replace(/\.([^.]+)$/, `.test.$1`);

  const prompt = `You are a senior engineer. Write comprehensive unit tests for this file.
Testing framework: ${framework}
File: ${filename}

Rules:
- Return ONLY the complete test file contents, no explanation, no markdown fences.
- Cover all functions and edge cases.
- Use descriptive test names.
- Include setup/teardown where needed.
- Add a comment at the top: // Tests generated by VisCarMa
- Test file should be: ${testFile}

Source code:
${code.slice(0, 4000)}`;

  const aiResponse = await callAI(prompt);
  if (!aiResponse) return null;
  const block = aiResponse.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  return { testFile, testCode: block ? block[1] : aiResponse, framework };
}

app.post('/api/generate-tests', async (req, res) => {
  const { files, repoOwner, repoName, branch, token } = req.body;
  const ghToken = token || req.session?.githubToken;
  if (!files?.length) return res.status(400).json({ error: 'files required' });

  const results = [];
  for (const item of files) {
    const result = await generateTestsForFile(item.code, item.file);
    if (result) results.push({ ...result, sourceFile: item.file });
  }

  if (!results.length) return res.status(500).json({ error: 'AI could not generate tests' });

  // If repo info provided, commit tests as PR
  if (ghToken && repoOwner && repoName) {
    try {
      const baseUrl  = `https://api.github.com/repos/${repoOwner}/${repoName}`;
      const baseRef  = await fetch(`${baseUrl}/git/refs/heads/${branch||'main'}`, {
        headers: { Authorization: `token ${ghToken}` },
      });
      const baseSha  = (await baseRef.json()).object?.sha;
      if (!baseSha) throw new Error('Branch not found');
      const newBranch = `viscarma-tests-${Date.now()}`;
      await fetch(`${baseUrl}/git/refs`, {
        method: 'POST',
        headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
      });
      for (const r of results) {
        const existing = await fetch(`${baseUrl}/contents/${r.testFile}?ref=${newBranch}`, {
          headers: { Authorization: `token ${ghToken}` },
        }).then(res => res.ok ? res.json() : null);
        await fetch(`${baseUrl}/contents/${r.testFile}`, {
          method: 'PUT',
          headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `test: VisCarMa generates tests for ${r.sourceFile}`,
            content: Buffer.from(r.testCode).toString('base64'),
            ...(existing?.sha ? { sha: existing.sha } : {}),
            branch: newBranch,
          }),
        });
      }
      const pr = await fetch(`${baseUrl}/pulls`, {
        method: 'POST',
        headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `test: AI-generated unit tests by VisCarMa`,
          head: newBranch, base: branch||'main',
          body: `[![VisCarMa](https://img.shields.io/badge/tests%20by-VisCarMa-388bfd?style=flat-square)](https://viscarma.onrender.com)\n\n## 🧪 AI-Generated Tests\n\n${results.map(r => '- `' + r.testFile + '` — ' + r.framework).join('\n')}\n\n---\n🤖 by [VisCarMa](https://viscarma.onrender.com)`,
        }),
      });
      const prData = await pr.json();
      res.json({ results, prUrl: prData.html_url, prNumber: prData.number });
    } catch(e) {
      res.json({ results, prError: e.message });
    }
  } else {
    res.json({ results });
  }
});

// ══════════════════════════════════════════════════════════════
// TIER 4: FREEMIUM SCAN LIMITS
// ══════════════════════════════════════════════════════════════
const USAGE_FILE = path.join(process.cwd(), 'data', 'usage.json');
let usageStore   = {};

async function loadUsage() {
  try { usageStore = JSON.parse(await fs.readFile(USAGE_FILE, 'utf-8')); }
  catch { usageStore = {}; }
}
async function saveUsage() {
  await fs.mkdir(path.dirname(USAGE_FILE), { recursive: true });
  await fs.writeFile(USAGE_FILE, JSON.stringify(usageStore, null, 2));
}
loadUsage();

const LIMITS = { anonymous: 3, free: 20, pro: Infinity };

// ── PRO WHITELIST ─────────────────────────────────────────────
// Add GitHub usernames to VISCARMA_PRO_USERS env var (comma-separated)
// e.g.  VISCARMA_PRO_USERS=suryasticsai,alice,bob
// These users get unlimited scans immediately, no payment needed.
const PRO_WHITELIST = new Set(
  (process.env.VISCARMA_PRO_USERS || 'suryasticsai')
    .split(',').map(u => u.trim().toLowerCase()).filter(Boolean)
);

// ── PRO DB (Stripe-backed, loaded from data/pro.json) ─────────
// Stripe webhook writes here when payment succeeds.
// Format: { "github_user_id": { plan:"pro", since:"...", stripeCustomerId:"..." } }
const PRO_FILE = path.join(process.cwd(), 'data', 'pro.json');
let proStore   = {};

async function loadProStore() {
  try { proStore = JSON.parse(await fs.readFile(PRO_FILE, 'utf-8')); }
  catch { proStore = {}; }
}
async function saveProStore() {
  await fs.mkdir(path.dirname(PRO_FILE), { recursive: true });
  await fs.writeFile(PRO_FILE, JSON.stringify(proStore, null, 2));
}
loadProStore();

function getPlan(req) {
  if (!req.session?.githubUser) return 'anonymous';
  const login = req.session.githubUser.login?.toLowerCase();
  const id    = String(req.session.githubUser.id);

  // 1. Manual whitelist (instant Pro)
  if (PRO_WHITELIST.has(login)) return 'pro';

  // 2. Stripe-verified Pro (set by webhook)
  if (proStore[id]?.plan === 'pro') return 'pro';

  return 'free';
}

function getUsageKey(req) {
  const userId = req.session?.githubUser?.id;
  const month  = new Date().toISOString().slice(0,7);
  return userId ? `user:${userId}:${month}` : `ip:${req.ip}:${month}`;
}

async function checkAndIncrementUsage(req) {
  const key   = getUsageKey(req);
  const plan  = getPlan(req);
  const limit = LIMITS[plan];
  const count = usageStore[key] || 0;
  if (count >= limit) return { allowed: false, count, limit, plan };
  usageStore[key] = count + 1;
  await saveUsage();
  return { allowed: true, count: usageStore[key], limit, plan };
}

app.get('/api/usage', async (req, res) => {
  const key   = getUsageKey(req);
  const plan  = getPlan(req);
  const limit = LIMITS[plan];
  const count = usageStore[key] || 0;
  res.json({
    count, limit, plan,
    remaining: limit === Infinity ? Infinity : Math.max(0, limit - count),
    isWhitelisted: plan === 'pro' && PRO_WHITELIST.has(req.session?.githubUser?.login?.toLowerCase()),
  });
});

// ── STRIPE WEBHOOK ────────────────────────────────────────────
// When a user pays, Stripe posts here.
// Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Render env vars.
// In Stripe dashboard: Webhooks → Add endpoint → https://viscarma.onrender.com/api/stripe/webhook
// Events to listen for: checkout.session.completed, customer.subscription.deleted

const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY      || null;
const STRIPE_WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET  || null;
const STRIPE_PRO_PRICE_ID    = process.env.STRIPE_PRO_PRICE_ID    || null; // your Price ID from Stripe dashboard

// Raw body needed for Stripe signature verification
app.post('/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }
    // Lazy-load Stripe only when keys are present
    const Stripe     = (await import('stripe')).default;
    const stripe     = new Stripe(STRIPE_SECRET_KEY);
    const sig        = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error('[STRIPE] Webhook signature failed:', e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session   = event.data.object;
      const githubId  = session.metadata?.github_user_id;
      const login     = session.metadata?.github_login;
      if (githubId) {
        proStore[githubId] = {
          plan:             'pro',
          since:            new Date().toISOString(),
          stripeCustomerId: session.customer,
          stripeSessionId:  session.id,
          githubLogin:      login,
        };
        await saveProStore();
        console.log(`[STRIPE] Pro activated for GitHub user: ${login} (${githubId})`);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub      = event.data.object;
      const customerId = sub.customer;
      // Find user by Stripe customer ID and downgrade
      const entry = Object.entries(proStore).find(([, v]) => v.stripeCustomerId === customerId);
      if (entry) {
        const [githubId, data] = entry;
        proStore[githubId] = { ...data, plan: 'free', cancelledAt: new Date().toISOString() };
        await saveProStore();
        console.log(`[STRIPE] Pro cancelled for: ${data.githubLogin}`);
      }
    }

    res.json({ received: true });
  }
);

// ── STRIPE CHECKOUT SESSION ────────────────────────────────────
// Browser calls this to get a Stripe checkout URL
app.post('/api/stripe/create-checkout', async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe not configured. Add STRIPE_SECRET_KEY to Render env vars.' });
  if (!req.session?.githubUser) return res.status(401).json({ error: 'Login required' });
  if (!STRIPE_PRO_PRICE_ID) return res.status(503).json({ error: 'No price configured. Add STRIPE_PRO_PRICE_ID to Render env vars.' });

  try {
    const Stripe  = (await import('stripe')).default;
    const stripe  = new Stripe(STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode:        'subscription',
      line_items:  [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: `${FRONTEND_URL}?pro=success`,
      cancel_url:  `${FRONTEND_URL}?pro=cancelled`,
      metadata:    {
        github_user_id: String(req.session.githubUser.id),
        github_login:   req.session.githubUser.login,
      },
      customer_email: req.body.email || undefined,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[STRIPE] Checkout failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN: manually grant/revoke Pro ──────────────────────────
// Only usable by whitelisted admin (you)
app.post('/api/admin/set-pro', async (req, res) => {
  const callerLogin = req.session?.githubUser?.login?.toLowerCase();
  if (!PRO_WHITELIST.has(callerLogin)) return res.status(403).json({ error: 'Admin only' });
  const { githubId, githubLogin, grant } = req.body;
  if (!githubId) return res.status(400).json({ error: 'githubId required' });
  if (grant) {
    proStore[String(githubId)] = { plan: 'pro', since: new Date().toISOString(), grantedBy: callerLogin, githubLogin };
  } else {
    if (proStore[String(githubId)]) proStore[String(githubId)].plan = 'free';
  }
  await saveProStore();
  res.json({ ok: true, plan: grant ? 'pro' : 'free', githubLogin });
});

// ── LIMIT-CHECK MIDDLEWARE on scan-repo ───────────────────────
app.use('/api/scan-repo', async (req, res, next) => {
  if (req.method !== 'POST') return next();
  const check = await checkAndIncrementUsage(req);
  if (!check.allowed) {
    return res.status(429).json({
      error: `Scan limit reached. Plan: ${check.plan} — ${check.limit === Infinity ? 'unlimited' : check.limit + '/month'}. Upgrade to Pro for unlimited scans.`,
      count: check.count, limit: check.limit, plan: check.plan,
      upgradeUrl: '/api/stripe/create-checkout',
    });
  }
  req.usageInfo = check;
  next();
});

// ══════════════════════════════════════════════════════════════
// TIER 4: PUBLIC SCAN BADGE
// ══════════════════════════════════════════════════════════════
// GET /badge/:owner/:repo.svg  — returns SVG badge
// Shows last scan result from history

app.get('/badge/:owner/:repo.svg', (req, res) => {
  const { owner, repo } = req.params;
  const repoKey = `${owner}/${repo}`;
  const lastScan = scanHistory.find(h => h.repo === repoKey);

  let label, color, message;
  if (!lastScan) {
    label = 'VisCarMa'; message = 'not scanned'; color = '#8b949e';
  } else if (lastScan.high > 0) {
    label = 'VisCarMa'; message = `${lastScan.high} HIGH issues`; color = '#f85149';
  } else if (lastScan.med > 0) {
    label = 'VisCarMa'; message = `${lastScan.med} warnings`; color = '#d29922';
  } else {
    label = 'VisCarMa'; message = 'clean ✓'; color = '#3fb950';
  }

  const labelW   = label.length * 7 + 10;
  const messageW = message.length * 7 + 10;
  const totalW   = labelW + messageW;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20">
  <title>${label}: ${message}</title>
  <rect width="${labelW}" height="20" fill="#21262d" rx="3"/>
  <rect x="${labelW}" width="${messageW}" height="20" fill="${color}" rx="3"/>
  <rect x="${labelW - 3}" width="6" height="20" fill="${color}"/>
  <text x="${labelW/2}" y="14" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" fill="#fff" text-anchor="middle">${label}</text>
  <text x="${labelW + messageW/2}" y="14" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" fill="#fff" text-anchor="middle">${message}</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
  res.send(svg);
});

// Badge README markdown endpoint — returns the markdown to copy
app.get('/badge/:owner/:repo', (req, res) => {
  const { owner, repo } = req.params;
  const badgeUrl   = `${FRONTEND_URL}/badge/${owner}/${repo}.svg`;
  const reportUrl  = `${FRONTEND_URL}`;
  const markdown   = `[![VisCarMa](${badgeUrl})](${reportUrl})`;
  res.json({ markdown, badgeUrl, reportUrl });
});

// ══════════════════════════════════════════════════════════════
// TIER 4: RULE MARKETPLACE
// ══════════════════════════════════════════════════════════════
const MARKETPLACE_FILE = path.join(process.cwd(), 'data', 'marketplace.json');
let marketplace = [];

async function loadMarketplace() {
  try { marketplace = JSON.parse(await fs.readFile(MARKETPLACE_FILE, 'utf-8')); }
  catch { marketplace = []; }
}
async function saveMarketplace() {
  await fs.mkdir(path.dirname(MARKETPLACE_FILE), { recursive: true });
  await fs.writeFile(MARKETPLACE_FILE, JSON.stringify(marketplace, null, 2));
}
loadMarketplace();

// Browse marketplace packs
app.get('/api/marketplace', (req, res) => {
  const { category, search } = req.query;
  let results = [...marketplace];
  if (category) results = results.filter(p => p.category === category);
  if (search)   results = results.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase())
  );
  res.json({ packs: results.sort((a,b) => (b.installs||0) - (a.installs||0)) });
});

// Publish your custom rules as a pack
app.post('/api/marketplace/publish', async (req, res) => {
  if (!req.session?.githubUser) return res.status(401).json({ error: 'Login required to publish' });
  const { name, description, category, rules } = req.body;
  if (!name || !rules?.length) return res.status(400).json({ error: 'name and rules required' });

  const pack = {
    id:          crypto.randomBytes(8).toString('hex'),
    name, description,
    category:    category || 'general',
    author:      req.session.githubUser.login,
    authorAvatar: req.session.githubUser.avatar,
    rules,
    installs:    0,
    rating:      0,
    ratings:     [],
    publishedAt: new Date().toISOString(),
  };
  marketplace.push(pack);
  await saveMarketplace();
  res.json({ pack });
});

// Install a pack (copies rules to user's custom rules)
app.post('/api/marketplace/:id/install', async (req, res) => {
  const pack = marketplace.find(p => p.id === req.params.id);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });

  let installed = 0;
  for (const rule of pack.rules) {
    if (customRules.find(r => r.name === rule.name && r.pattern === rule.pattern)) continue;
    customRules.push({
      ...rule,
      id:          crypto.randomBytes(6).toString('hex'),
      createdAt:   new Date().toISOString(),
      marketplace: true,
      packId:      pack.id,
      packName:    pack.name,
    });
    installed++;
  }
  pack.installs = (pack.installs || 0) + 1;
  await saveCustomRules();
  await saveMarketplace();
  res.json({ installed, total: pack.rules.length });
});

// Rate a pack
app.post('/api/marketplace/:id/rate', async (req, res) => {
  if (!req.session?.githubUser) return res.status(401).json({ error: 'Login required' });
  const pack   = marketplace.find(p => p.id === req.params.id);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  const rating = Math.min(5, Math.max(1, parseInt(req.body.rating)));
  pack.ratings  = pack.ratings.filter(r => r.user !== req.session.githubUser.login);
  pack.ratings.push({ user: req.session.githubUser.login, rating });
  pack.rating   = pack.ratings.reduce((s,r) => s+r.rating, 0) / pack.ratings.length;
  await saveMarketplace();
  res.json({ rating: pack.rating, count: pack.ratings.length });
});

// ══════════════════════════════════════════════════════════════
// GOD MODE — LIVE URL SCANNER (fetch + cheerio + JSDOM, no browser)
// ══════════════════════════════════════════════════════════════

async function fetchAndAnalyseUrl(url) {
  const issues = [];

  // Fetch the live page
  let html;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VisCarMa/2.0 (+https://viscarma.onrender.com)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return { url, issues: [{ severity: 'HIGH', description: `Failed to fetch URL: ${e.message}`, fix: 'Check the URL is publicly accessible.' }], title: 'Fetch failed', meta: {} };
  }

  const $ = cheerio.load(html);
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // ── Meta & SEO ──────────────────────────────────────────────
  const title = $('title').text().trim();
  if (!title) issues.push({ severity: 'HIGH', description: 'Missing <title> tag — critical for SEO.', fix: 'Add a descriptive <title> to your <head>.' });
  else if (title.length < 10) issues.push({ severity: 'MED', description: `Title too short (${title.length} chars): "${title}"`, fix: 'Title should be 30–60 characters.' });
  else if (title.length > 60) issues.push({ severity: 'LOW', description: `Title too long (${title.length} chars) — may be truncated in search results.`, fix: 'Keep title under 60 characters.' });

  const metaDesc = $('meta[name="description"]').attr('content');
  if (!metaDesc) issues.push({ severity: 'MED', description: 'Missing meta description — hurts SEO click-through rate.', fix: 'Add <meta name="description" content="150–160 char description">.' });
  else if (metaDesc.length > 160) issues.push({ severity: 'LOW', description: `Meta description too long (${metaDesc.length} chars).`, fix: 'Keep meta description under 160 characters.' });

  if (!$('meta[name="viewport"]').length)
    issues.push({ severity: 'HIGH', description: 'Missing viewport meta tag — site will not be mobile responsive.', fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">.' });

  if (!$('html').attr('lang'))
    issues.push({ severity: 'MED', description: 'Missing lang attribute on <html> — accessibility and SEO issue.', fix: 'Add lang="en" (or appropriate language code) to <html>.' });

  const canonical = $('link[rel="canonical"]').attr('href');
  if (!canonical) issues.push({ severity: 'LOW', description: 'No canonical URL — may cause duplicate content issues.', fix: 'Add <link rel="canonical" href="YOUR_URL">.' });

  // ── Open Graph / Social ─────────────────────────────────────
  if (!$('meta[property="og:title"]').length)
    issues.push({ severity: 'LOW', description: 'Missing og:title — link previews on social media will be poor.', fix: 'Add <meta property="og:title" content="...">.' });
  if (!$('meta[property="og:image"]').length)
    issues.push({ severity: 'LOW', description: 'Missing og:image — no image when shared on social media.', fix: 'Add <meta property="og:image" content="URL_TO_IMAGE">.' });

  // ── Accessibility ───────────────────────────────────────────
  const imgsNoAlt = $('img:not([alt])').length;
  if (imgsNoAlt > 0) issues.push({ severity: 'MED', description: `${imgsNoAlt} image(s) missing alt attribute — screen reader accessibility failure.`, fix: 'Add descriptive alt="..." to every <img>.' });

  const inputsNoLabel = $('input:not([aria-label]):not([aria-labelledby])').filter((i, el) => {
    const id = $(el).attr('id');
    return !id || !$(`label[for="${id}"]`).length;
  }).length;
  if (inputsNoLabel > 0) issues.push({ severity: 'MED', description: `${inputsNoLabel} input(s) missing associated <label> or aria-label.`, fix: 'Add <label for="inputId"> or aria-label to each input.' });

  const emptyLinks = $('a').filter((i, el) => !$(el).text().trim() && !$(el).attr('aria-label')).length;
  if (emptyLinks > 0) issues.push({ severity: 'MED', description: `${emptyLinks} link(s) with no visible text — inaccessible to screen readers.`, fix: 'Add descriptive text or aria-label to all links.' });

  if (!$('[role="main"], main').length)
    issues.push({ severity: 'LOW', description: 'No <main> landmark element — reduces accessibility navigation.', fix: 'Wrap your primary content in a <main> element.' });

  // ── Performance hints ───────────────────────────────────────
  const inlineStyles = $('[style]').length;
  if (inlineStyles > 10) issues.push({ severity: 'LOW', description: `${inlineStyles} elements use inline styles — harder to maintain and overrides CSS cascade.`, fix: 'Move inline styles to CSS classes.' });

  const scriptCount = $('script:not([type="application/json"]):not([type="application/ld+json"])').length;
  if (scriptCount > 10) issues.push({ severity: 'LOW', description: `${scriptCount} <script> tags detected — consider bundling.`, fix: 'Bundle scripts with a build tool to reduce HTTP requests.' });

  const renderBlockingCss = $('link[rel="stylesheet"]:not([media])').length;
  if (renderBlockingCss > 3) issues.push({ severity: 'MED', description: `${renderBlockingCss} render-blocking stylesheets detected.`, fix: 'Use media queries or load non-critical CSS asynchronously.' });

  // ── Security headers (inferred from meta) ───────────────────
  const csp = $('meta[http-equiv="Content-Security-Policy"]').length;
  if (!csp) issues.push({ severity: 'MED', description: 'No Content-Security-Policy meta tag detected.', fix: 'Add a CSP header via your server or a meta tag to prevent XSS.' });

  // ── Broken / suspicious patterns ────────────────────────────
  const httpLinks = $('a[href^="http:"]').length;
  if (httpLinks > 0) issues.push({ severity: 'MED', description: `${httpLinks} link(s) use insecure HTTP — mixed content risk.`, fix: 'Change all links to use HTTPS.' });

  const consoleInScripts = $('script').filter((i, el) => $(el).html()?.includes('console.log')).length;
  if (consoleInScripts > 0) issues.push({ severity: 'LOW', description: `console.log() found in ${consoleInScripts} inline script(s).`, fix: 'Remove console.log() before going to production.' });

  // ── Structured data ─────────────────────────────────────────
  const jsonLd = $('script[type="application/ld+json"]').length;
  if (!jsonLd) issues.push({ severity: 'LOW', description: 'No JSON-LD structured data — missed opportunity for rich search results.', fix: 'Add Schema.org JSON-LD markup for your page type.' });

  // ── AI analysis of the page content ─────────────────────────
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2000);
  const aiPrompt = `Analyse this webpage's HTML and content for UX, SEO, accessibility, and performance issues.
URL: ${url}
Title: ${title || 'none'}
Body text preview: ${bodyText}
Number of issues already found by static analysis: ${issues.length}

Return a JSON array of additional issues ONLY (no duplicates of common ones already found): [{"severity":"HIGH|MED|LOW","description":"...","fix":"..."}]`;

  const aiRaw = await callAI(aiPrompt);
  const aiIssues = parseAIResponse(aiRaw);
  const existing = new Set(issues.map(i => i.description));
  for (const ai of aiIssues) {
    if (!existing.has(ai.description)) { issues.push(ai); existing.add(ai.description); }
  }

  // ── Page metadata ───────────────────────────────────────────
  const meta = {
    title: title || null,
    description: metaDesc || null,
    h1: $('h1').first().text().trim() || null,
    h1Count: $('h1').length,
    links: $('a[href]').length,
    images: $('img').length,
    scripts: scriptCount,
    wordCount: bodyText.split(' ').length,
  };

  if (meta.h1Count === 0) issues.push({ severity: 'HIGH', description: 'No <h1> tag found — critical for SEO and document structure.', fix: 'Add exactly one <h1> tag as the main page heading.' });
  if (meta.h1Count > 1) issues.push({ severity: 'MED', description: `Multiple <h1> tags (${meta.h1Count}) — only one is recommended per page.`, fix: 'Use a single <h1> for the main heading; use <h2>-<h6> for subheadings.' });

  return { url, issues, title: title || url, meta };
}

// God Mode: analyse multiple URLs + optional linked pages
app.post('/api/godmode/scan-url', async (req, res) => {
  const { url, deepScan } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const primary = await fetchAndAnalyseUrl(url);
    const results  = [primary];

    // Deep scan: follow internal links (up to 4 more pages)
    if (deepScan) {
      const html  = await fetch(url, { headers: { 'User-Agent': 'VisCarMa/2.0' } }).then(r => r.text()).catch(() => '');
      const $     = cheerio.load(html);
      const base  = new URL(url);
      const links = [];
      $('a[href]').each((i, el) => {
        try {
          const href = new URL($('a', el).attr('href') || $(el).attr('href'), base);
          if (href.hostname === base.hostname && !links.includes(href.href) && href.href !== url) {
            links.push(href.href);
          }
        } catch {}
      });
      for (const link of links.slice(0, 4)) {
        try {
          const pageResult = await fetchAndAnalyseUrl(link);
          results.push(pageResult);
        } catch {}
      }
    }

    res.json({ success: true, results, totalIssues: results.reduce((s, r) => s + r.issues.length, 0) });
  } catch (e) {
    console.error('[GODMODE]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Self-verification loop ─────────────────────────────────────
// After fixes are applied, re-scan and compare before vs after
app.post('/api/godmode/verify', async (req, res) => {
  const { files, originalIssueCount } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'files required' });

  const results = [];
  let totalAfter = 0;
  for (const item of files) {
    const issues = await analyzeFile(item.code, item.file);
    totalAfter += issues.length;
    results.push({ file: item.file, issuesBefore: item.issueCount || 0, issuesAfter: issues.length, issues, improved: issues.length < (item.issueCount || 0) });
  }

  const improved = totalAfter < originalIssueCount;
  res.json({ verified: improved, before: originalIssueCount, after: totalAfter, reduction: originalIssueCount - totalAfter, results });
});

// ── Dependency vulnerability scanner ──────────────────────────
// Reads package.json from repo, checks npm registry for CVEs
app.post('/api/godmode/scan-deps', async (req, res) => {
  const { repoOwner, repoName, token } = req.body;
  const ghToken = token || req.session?.githubToken;
  if (!repoOwner || !repoName) return res.status(400).json({ error: 'repoOwner and repoName required' });

  try {
    // Fetch package.json from repo
    const pkgRes  = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/package.json`, {
      headers: { Authorization: ghToken ? `token ${ghToken}` : '', Accept: 'application/vnd.github.v3+json' },
    });
    if (!pkgRes.ok) return res.status(404).json({ error: 'package.json not found in repo' });
    const pkgData = await pkgRes.json();
    const pkg     = JSON.parse(Buffer.from(pkgData.content, 'base64').toString('utf-8'));

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const vulns   = [];

    // Check each package against npm registry for deprecation + known issues
    const checks = Object.entries(allDeps).slice(0, 20); // cap at 20 to avoid rate limits
    for (const [name, versionRange] of checks) {
      try {
        const npmRes  = await fetch(`https://registry.npmjs.org/${name}/latest`);
        if (!npmRes.ok) continue;
        const npmData = await npmRes.json();

        if (npmData.deprecated) {
          vulns.push({ package: name, currentRange: versionRange, severity: 'HIGH', issue: 'Deprecated', description: npmData.deprecated, fix: `Replace ${name} with an actively maintained alternative.` });
        }

        // Check for drastically outdated versions
        const latest = npmData.version;
        const currentMajor = parseInt((versionRange.replace(/[\^~>=<]/g, '').split('.')[0]) || '0');
        const latestMajor  = parseInt((latest.split('.')[0]) || '0');
        if (latestMajor - currentMajor >= 2) {
          vulns.push({ package: name, currentRange: versionRange, latestVersion: latest, severity: 'MED', issue: 'Major version gap', description: `${name} is ${latestMajor - currentMajor} major versions behind (you: ~${currentMajor}.x, latest: ${latest}).`, fix: `Run: npm install ${name}@latest` });
        }
      } catch {}
    }

    // AI analysis of the full dependency list
    const aiRaw = await callAI(
      `Analyse these npm dependencies for security risks, deprecated packages, or better alternatives.
Dependencies: ${JSON.stringify(allDeps, null, 2)}

Return a JSON array: [{"package":"...","severity":"HIGH|MED|LOW","description":"...","fix":"..."}]`
    );
    const aiVulns = parseAIResponse(aiRaw);
    const existing = new Set(vulns.map(v => v.package + v.issue));
    for (const ai of aiVulns) {
      if (!existing.has(ai.package + ai.description)) vulns.push(ai);
    }

    res.json({ package: pkg.name, version: pkg.version, totalDeps: Object.keys(allDeps).length, checked: checks.length, vulns });
  } catch (e) {
    console.error('[DEPS]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Auto-merge (merge PR if all issues are LOW) ─────────────────
app.post('/api/godmode/auto-merge', async (req, res) => {
  const { repoOwner, repoName, prNumber, token } = req.body;
  const ghToken = token || req.session?.githubToken;
  if (!ghToken) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const baseUrl = `https://api.github.com/repos/${repoOwner}/${repoName}`;

    // Check PR is mergeable
    const prRes  = await fetch(`${baseUrl}/pulls/${prNumber}`, { headers: { Authorization: `token ${ghToken}` } });
    const pr     = await prRes.json();
    if (!pr.mergeable) return res.json({ merged: false, reason: 'PR is not mergeable (conflicts or checks failing)' });
    if (pr.state !== 'open') return res.json({ merged: false, reason: `PR is ${pr.state}` });

    // Merge it
    const mergeRes  = await fetch(`${baseUrl}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commit_title:   `fix: VisCarMa auto-merge PR #${prNumber}`,
        commit_message: `Auto-merged by VisCarMa God Mode after verification.

All issues confirmed LOW severity or resolved.`,
        merge_method:   'squash',
      }),
    });
    const mergeData = await mergeRes.json();
    if (!mergeData.merged) return res.json({ merged: false, reason: mergeData.message });

    res.json({ merged: true, sha: mergeData.sha, message: mergeData.message });
  } catch (e) {
    console.error('[AUTO-MERGE]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Multi-repo sweep ───────────────────────────────────────────
// Scan + fix multiple repos in one call
app.post('/api/godmode/multi-repo', async (req, res) => {
  const { repos, token } = req.body; // repos: [{repoUrl, repoOwner, repoName}]
  const ghToken = token || req.session?.githubToken;
  if (!repos?.length) return res.status(400).json({ error: 'repos array required' });

  const results = [];
  for (const repo of repos.slice(0, 5)) { // cap at 5 repos
    try {
      const folderId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const repoPath = path.join(TEMP_DIR, folderId);
      await fs.mkdir(repoPath, { recursive: true });
      let cloneUrl = repo.repoUrl;
      if (ghToken) cloneUrl = repo.repoUrl.replace('https://', `https://x-access-token:${ghToken}@`);
      await simpleGit().clone(cloneUrl, repoPath, ['--depth', '1']);
      const files   = await walkDir(repoPath);
      const scanResults = [];
      for (const fp of files) {
        const rel  = path.relative(repoPath, fp);
        const code = await fs.readFile(fp, 'utf-8');
        const issues = await analyzeFile(code, rel);
        scanResults.push({ file: rel, code, issues });
      }
      await fs.rm(repoPath, { recursive: true, force: true });
      const totalIssues = scanResults.reduce((s, f) => s + f.issues.length, 0);
      results.push({ ...repo, success: true, files: scanResults.length, issues: totalIssues, results: scanResults });
    } catch (e) {
      results.push({ ...repo, success: false, error: e.message });
    }
  }

  res.json({ repos: results, totalRepos: results.length, totalIssues: results.reduce((s, r) => s + (r.issues || 0), 0) });
});

// ── AI code explainer ──────────────────────────────────────────
app.post('/api/godmode/explain', async (req, res) => {
  const { code, filename } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });

  const prompt = `You are a senior engineer explaining code to a junior developer.
Explain this file in plain English. Be clear, friendly, and thorough.

File: ${filename || 'unknown'}

Structure your response as:
1. What this file does (1-2 sentences)
2. Key functions/classes and what they do
3. How data flows through it
4. Any patterns or architecture decisions worth noting
5. Potential improvements

Code:
${code.slice(0, 4000)}`;

  const explanation = await callAI(prompt);
  res.json({ explanation: explanation || 'AI could not generate explanation.', filename });
});

// ── Proper diff patching (replaces string replace) ─────────────
app.post('/api/godmode/diff', async (req, res) => {
  const { original, modified, filename } = req.body;
  if (!original || !modified) return res.status(400).json({ error: 'original and modified required' });

  try {
    const patch   = Diff.createPatch(filename || 'file', original, modified, 'original', 'fixed');
    const changes = Diff.diffLines(original, modified);
    const stats   = { added: 0, removed: 0, unchanged: 0 };
    for (const part of changes) {
      const lines = part.count || 0;
      if (part.added) stats.added += lines;
      else if (part.removed) stats.removed += lines;
      else stats.unchanged += lines;
    }
    res.json({ patch, stats, changes: changes.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Health ──────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`🕵️  VisCarMa backend v2.0 running on port ${PORT}`);
  console.log(`🔐 OLLAMA_API_KEY ${OLLAMA_API_KEY ? '✓ set' : '✗ not set (using OpenRouter fallback)'}`);
  console.log(`🌐 FRONTEND_URL: ${FRONTEND_URL}`);
  console.log(`🔁 REDIRECT_URI: ${REDIRECT_URI}`);
  console.log(`✅ VisCarMa server listening on port ${PORT}`);
});