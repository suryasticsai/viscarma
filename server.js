// server.js — VisCarma Backend (Hybrid: OAuth + Manual + Scan + Fix + PR + Feature Dev)
import express from 'express';
import cors from 'cors';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import { ESLint } from 'eslint';
import { JSDOM } from 'jsdom';
import simpleGit from 'simple-git';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Render's reverse proxy so secure cookies work correctly
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
  name:     'viscarma_sess',
  keys:     [SESSION_SECRET],
  maxAge:   7 * 24 * 60 * 60 * 1000,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  httpOnly: true,
}));

app.use(cookieParser(SESSION_SECRET));

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
async function callAI(prompt, filename) {
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
      temperature: 0.3,
      max_tokens:  1200,
    };
  }

  try {
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) return null;
    const data = await response.json();
    return useOllama ? (data.response || null) : (data.choices?.[0]?.message?.content || null);
  } catch (e) {
    console.error('AI error:', e.message);
    return null;
  }
}

function parseAIResponse(text) {
  if (!text) return [];
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { const p = JSON.parse(match[0]); return Array.isArray(p) ? p : []; }
  catch { return []; }
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

// ─── Analyze file ────────────────────────────────────────────────
async function analyzeFile(code, filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const issues = [];

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

  if (ext === 'html') issues.push(...checkHTML(code));

  if (issues.length < 10) {
    const aiRaw    = await callAI(
      `Analyse this code for bugs, security, and bad practices. File: ${filename}\n\n${code.slice(0, 3000)}\n\nReturn a JSON array ONLY: [{"severity":"HIGH|MED|LOW","description":"...","fix":"..."}]`,
      filename
    );
    const aiIssues = parseAIResponse(aiRaw);
    const existing = new Set(issues.map(i => i.description));
    for (const ai of aiIssues) {
      if (!existing.has(ai.description)) { issues.push(ai); existing.add(ai.description); }
    }
  }

  if (!['js', 'ts', 'jsx', 'tsx', 'html'].includes(ext) && issues.length === 0) {
    if (code.includes('TODO') || code.includes('FIXME'))
      issues.push({ severity: 'LOW', description: 'Found TODO/FIXME comments.', fix: 'Address before release.' });
  }

  return issues;
}

// ─── Generate fixes ──────────────────────────────────────────────
async function generateFixesForFile(code, filename, issues) {
  let newCode   = code;
  const ext     = filename.split('.').pop().toLowerCase();
  const applied = [];

  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    try {
      const eslint  = await getESLint();
      const results = await eslint.lintText(newCode, { filePath: filename, fix: true });
      if (results[0]?.output) { newCode = results[0].output; applied.push('ESLint auto-fix'); }
    } catch (e) { console.error('ESLint fix error:', e); }
  }

  if (ext === 'html') {
    const dom = new JSDOM(newCode);
    const doc = dom.window.document;
    if (!doc.documentElement.hasAttribute('lang')) { doc.documentElement.setAttribute('lang', 'en'); applied.push('Added lang="en"'); }
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
    doc.querySelectorAll('img:not([alt])').forEach(img => { img.setAttribute('alt', 'image'); applied.push('Added alt to image'); });
    newCode = dom.serialize();
  }

  const aiIssues = issues.filter(i => i.fix && !i.fix.startsWith('Apply:') && !i.fix.startsWith('Line'));
  if (aiIssues.length > 0 && !applied.length) {
    const aiResponse = await callAI(
      `Fix the following issues and return ONLY the full corrected code, no explanation.\nIssues:\n${aiIssues.map(i => `- ${i.description}`).join('\n')}\n\nFile: ${filename}\n\n${newCode}`,
      filename + '.fix'
    );
    if (aiResponse) {
      const block = aiResponse.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      newCode = block ? block[1] : aiResponse;
      applied.push('AI-generated fixes');
    }
  }

  return { newCode, applied };
}

// ─── Feature development via AI ──────────────────────────────────
// NEW: takes a feature description and a file, asks AI to implement it
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

  const aiResponse = await callAI(prompt, filename);
  if (!aiResponse) return { newCode: code, success: false };
  const block = aiResponse.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  return { newCode: block ? block[1] : aiResponse, success: true };
}

// ─── PR body builder ─────────────────────────────────────────────
function buildPRBody({ fixes, featureDescription, repoOwner, repoName, prType }) {
  const now       = new Date().toUTCString();
  const repoLink  = `https://github.com/${repoOwner}/${repoName}`;
  const authorLink = `[@suryasticsai](https://github.com/suryasticsai)`;
  const badge      = `[![VisCarMa](https://img.shields.io/badge/auto--fixed%20by-VisCarMa-3b82f6?style=flat-square&logo=github)](https://viscarma.onrender.com)`;

  if (prType === 'feature') {
    return `${badge}

## ✨ Feature Added by VisCarMa

**Feature:** ${featureDescription}

### Files modified
${fixes.map(f => `- \`${f.file}\``).join('\n')}

### What changed
${fixes.map(f => `**\`${f.file}\`** — AI implemented: _${featureDescription}_`).join('\n\n')}

---
🤖 This PR was automatically generated by **[VisCarMa](https://viscarma.onrender.com)** — the divine code architect.
👤 Requested by ${authorLink}
🕐 Generated at: ${now}
🔗 Repository: ${repoLink}`;
  }

  // Fix PR body
  const fileDetails = fixes.map(f => {
    const appliedList = f.applied.length
      ? f.applied.map(a => `  - ${a}`).join('\n')
      : '  - No auto-fixes applied';
    return `**\`${f.file}\`**\n${appliedList}`;
  }).join('\n\n');

  const issuesSummary = fixes.map(f =>
    f.issues && f.issues.length
      ? f.issues.map(i => `  - [${i.severity || 'MED'}] ${i.description}`).join('\n')
      : '  - No issues'
  ).join('\n');

  return `${badge}

## 🔧 Auto-fix PR by VisCarMa

### What was fixed
${fileDetails}

### Issues addressed
${issuesSummary}

### Files changed
${fixes.map(f => `- \`${f.file}\``).join('\n')}

---
🤖 This PR was automatically generated by **[VisCarMa](https://viscarma.onrender.com)** — the divine code architect.
👤 Fixes applied by ${authorLink}
🕐 Generated at: ${now}
🔗 Repository: ${repoLink}`;
}

// ─── README updater ──────────────────────────────────────────────
async function updateReadme({ repoOwner, repoName, branch, fixes, featureDescription, prUrl, prNumber, ghToken, prType }) {
  const baseUrl  = `https://api.github.com/repos/${repoOwner}/${repoName}`;
  const now      = new Date().toUTCString();
  const prType_  = prType === 'feature' ? '✨ Feature' : '🔧 Fix';
  const summary  = prType === 'feature'
    ? featureDescription
    : fixes.map(f => f.applied.join(', ') || 'reviewed').join('; ');

  const newEntry = `| ${prType_} | ${fixes.map(f => `\`${f.file}\``).join(', ')} | ${summary} | [PR #${prNumber}](${prUrl}) | ${now} | [@suryasticsai](https://github.com/suryasticsai) |`;

  try {
    const readmeRes  = await fetch(`${baseUrl}/contents/README.md?ref=${branch}`, {
      headers: { Authorization: `token ${ghToken}` },
    });

    let currentContent = '';
    let sha            = null;

    if (readmeRes.ok) {
      const readmeData = await readmeRes.json();
      currentContent   = Buffer.from(readmeData.content, 'base64').toString('utf-8');
      sha              = readmeData.sha;
    }

    const viscarmaHeader = `\n\n<!-- VISCARMA:START -->\n## 🤖 VisCarMa Change Log\n> Auto-maintained by [VisCarMa](https://viscarma.onrender.com) · Author: [@suryasticsai](https://github.com/suryasticsai)\n\n| Type | Files | Summary | PR | Date | Author |\n|------|-------|---------|-----|------|--------|\n`;
    const viscarmaFooter = `<!-- VISCARMA:END -->`;

    let updatedContent;

    if (currentContent.includes('<!-- VISCARMA:START -->')) {
      // Inject new row right after the table header
      updatedContent = currentContent.replace(
        /(\| Type \| Files \| Summary \| PR \| Date \| Author \|\n\|[-|]+\|\n)/,
        `$1${newEntry}\n`
      );
    } else {
      // First time — append the whole section
      updatedContent = currentContent + viscarmaHeader + newEntry + '\n' + viscarmaFooter;
    }

    await fetch(`${baseUrl}/contents/README.md`, {
      method:  'PUT',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message: `docs: VisCarMa update README for PR #${prNumber}`,
        content: Buffer.from(updatedContent).toString('base64'),
        sha,
        branch,
      }),
    });

    console.log('[README] Updated successfully');
  } catch (e) {
    console.error('[README] Update failed:', e.message);
    // Non-fatal — PR still succeeds even if README update fails
  }
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
  res.redirect(`${GITHUB_AUTH_URL}?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=repo&state=${state}`);
  console.log('[AUTH] Redirecting to GitHub OAuth, state:', state);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const cookieState     = req.signedCookies.oauthState;
  console.log('[AUTH] Callback — code:', !!code, 'state match:', state === cookieState);
  if (!code) return res.status(400).send('Missing code');
  if (!state || state !== cookieState) return res.status(400).send('Invalid state — please try again');
  res.clearCookie('oauthState');

  try {
    const tokenRes  = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code, redirect_uri: REDIRECT_URI }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).send('Failed to get access token');

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    req.session.githubToken = tokenData.access_token;
    req.session.githubUser  = { id: user.id, login: user.login, avatar: user.avatar_url };
    console.log('[AUTH] Session set for user:', user.login, '— redirecting to /');
    res.redirect('/');
  } catch (e) {
    console.error('[AUTH] Callback error:', e);
    res.status(500).send('OAuth error: ' + e.message);
  }
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

// ─── Scan repo ───────────────────────────────────────────────────
const TEMP_DIR = path.join(process.cwd(), 'tmp');

app.post('/api/scan-repo', async (req, res) => {
  const { repoUrl, token } = req.body;
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
  const exclude = ['node_modules', '.git', 'dist', 'build', 'coverage'];
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkDir(fullPath)));
    else {
      const ext = entry.name.split('.').pop().toLowerCase();
      if (['js','ts','jsx','tsx','html','css','py','java','go','rs','c','cpp','h'].includes(ext))
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

// ─── NEW: Generate feature ───────────────────────────────────────
app.post('/api/generate-feature', async (req, res) => {
  const { files, featureDescription } = req.body;
  if (!featureDescription) return res.status(400).json({ error: 'featureDescription is required' });

  const results = [];
  for (const item of files) {
    const { newCode, success } = await generateFeatureForFile(item.code, item.file, featureDescription);
    results.push({ file: item.file, newCode, applied: success ? [`Feature: ${featureDescription}`] : [], success });
  }
  res.json({ fixes: results, featureDescription });
});

// ─── Create PR (fix or feature) ──────────────────────────────────
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
      method:  'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseData.object.sha }),
    });

    // Push each changed file
    for (const fix of fixes) {
      if (!fix.newCode) continue;
      const fileRes  = await fetch(`${baseUrl}/contents/${fix.file}?ref=${newBranch}`, {
        headers: { Authorization: `token ${ghToken}` },
      });
      const fileData = await fileRes.json();
      const oldContent = fileData.content
        ? Buffer.from(fileData.content, 'base64').toString('utf-8')
        : null;

      if (oldContent === fix.newCode) continue;

      const commitMsg = prType === 'feature'
        ? `feat: VisCarMa adds "${featureDescription?.slice(0, 60)}" to ${fix.file}`
        : `fix: VisCarMa auto-fix in ${fix.file} (${fix.applied?.join(', ')})`;

      await fetch(`${baseUrl}/contents/${fix.file}`, {
        method:  fileData.sha ? 'PUT' : 'POST',
        headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          message: commitMsg,
          content: Buffer.from(fix.newCode).toString('base64'),
          ...(fileData.sha ? { sha: fileData.sha } : {}),
          branch:  newBranch,
        }),
      });
    }

    // Build rich PR body with watermark
    const prBody = buildPRBody({ fixes, featureDescription, repoOwner, repoName, prType });

    const prTitle = prType === 'feature'
      ? `feat: VisCarMa — ${featureDescription?.slice(0, 72)}`
      : `fix: auto-generated fixes by VisCarMa`;

    const pr     = await fetch(`${baseUrl}/pulls`, {
      method:  'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title: prTitle, head: newBranch, base: branch, body: prBody }),
    });
    const prData = await pr.json();
    if (!prData.html_url) throw new Error(prData.message || 'PR creation failed');

    // Update README with VisCarMa change log entry (non-fatal)
    await updateReadme({
      repoOwner, repoName, branch: newBranch,
      fixes, featureDescription, prType,
      prUrl: prData.html_url, prNumber: prData.number, ghToken,
    });

    res.json({ url: prData.html_url, number: prData.number });
  } catch (e) {
    console.error('[PR]', e);
    res.status(500).json({ error: 'PR creation failed: ' + e.message });
  }
});

// ─── Health ──────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`🕵️  VisCarma backend running on port ${PORT}`);
  console.log(`🔐 OLLAMA_API_KEY ${OLLAMA_API_KEY ? '✓ set' : '✗ not set (using OpenRouter fallback)'}`);
  console.log(`🌐 FRONTEND_URL: ${FRONTEND_URL}`);
  console.log(`🔁 REDIRECT_URI: ${REDIRECT_URI}`);
  console.log(`✅ VisCarMa server listening on port ${PORT}`);
});
