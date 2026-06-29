// server.js — VisCarma Backend (Hybrid: OAuth + Manual + Scan + Fix + PR)
// AUTH FIX: Replaced session-file-store (breaks on Render ephemeral FS)
//           with cookie-session (stateless, no disk needed, survives restarts)
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
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Environment variables ──────────────────────────────────────
const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  OLLAMA_API_KEY,
  SESSION_SECRET = 'dev-secret-change-me-in-production',
  REDIRECT_URI = 'https://viscarma.onrender.com/auth/callback',
  FRONTEND_URL = 'https://viscarma.onrender.com',
} = process.env;

// ─── Cookie-based session (stateless — works on Render ephemeral FS) ─
// Stores session data encrypted inside the cookie itself.
// No disk, no DB needed. Survives Render restarts and instance swaps.
app.use(cookieSession({
  name: 'viscarma_sess',
  keys: [SESSION_SECRET],
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  httpOnly: true,
}));

// ─── Cookie parser (for signed OAuth state cookie) ───────────────
app.use(cookieParser(SESSION_SECRET));

// ─── CORS ────────────────────────────────────────────────────────
// FIX: origin:'*' is invalid when credentials:true — use explicit origin
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── ESLint instance ──────────────────────────────────────────────
let eslintInstance = null;

async function getESLint() {
  if (!eslintInstance) {
    eslintInstance = new ESLint({
      useEslintrc: false,
      overrideConfig: {
        env: { browser: true, node: true, es2021: true },
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: {
          'no-undef': 'error',
          'eqeqeq': 'error',
          'no-eval': 'error',
          'no-unused-vars': 'warn',
          'no-extra-semi': 'warn',
          'no-await-in-loop': 'warn',
          'require-await': 'warn',
          'no-promise-executor-return': 'error',
          'no-console': 'warn',
          'no-alert': 'warn',
          'no-debugger': 'warn',
          'no-var': 'warn',
          'prefer-const': 'warn',
        },
      },
    });
  }
  return eslintInstance;
}

// ─── AI call (Ollama or OpenRouter) ──────────────────────────────
async function callAI(code, filename) {
  const useOllama = OLLAMA_API_KEY && OLLAMA_API_KEY.length > 0;
  let endpoint, headers, body;

  if (useOllama) {
    endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/generate';
    headers = { 'Content-Type': 'application/json' };
    if (OLLAMA_API_KEY) headers['Authorization'] = `Bearer ${OLLAMA_API_KEY}`;
    body = {
      model: process.env.OLLAMA_MODEL || 'llama3.2',
      prompt: `Analyse this code for bugs, security, and bad practices. File: ${filename}\n\n${code.slice(0, 3000)}\n\nReturn a JSON array: [{"severity":"HIGH|MED|LOW","description":"...","fix":"..."}]`,
      stream: false,
    };
  } else {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    headers = { 'Content-Type': 'application/json' };
    body = {
      model: 'google/gemma-2-9b-it:free',
      messages: [
        { role: 'system', content: 'You are a code reviewer. Return a JSON array of issues with severity, description, and fix suggestion. Only respond with the JSON array.' },
        { role: 'user', content: `Analyse this file for bugs, security, performance, and bad practices.\nFile: ${filename}\n\n${code.slice(0, 3000)}` },
      ],
      temperature: 0.3,
      max_tokens: 800,
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (useOllama) return data.response || null;
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('AI error:', e.message);
    return null;
  }
}

function parseAIResponse(text) {
  if (!text) return [];
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── HTML specific checks ────────────────────────────────────────
function checkHTML(code) {
  const issues = [];
  if (!code.includes('<html lang=') && !code.includes('<html lang="')) {
    issues.push({
      severity: 'MED',
      description: 'Missing lang attribute on <html> – accessibility issue.',
      fix: 'Add <html lang="en"> to the page.',
    });
  }
  if (!code.includes('<title>') || code.match(/<title>\s*<\/title>/)) {
    issues.push({
      severity: 'HIGH',
      description: 'Missing or empty <title> – SEO and usability issue.',
      fix: 'Add a descriptive title: <title>My Page</title>.',
    });
  }
  if (code.includes('<img') && !code.includes('alt=')) {
    issues.push({
      severity: 'MED',
      description: 'Images missing alt attributes – accessibility issue.',
      fix: 'Add alt="description" to all <img> tags.',
    });
  }
  if (!code.includes('viewport')) {
    issues.push({
      severity: 'MED',
      description: 'Missing viewport meta tag – mobile responsiveness issue.',
      fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    });
  }
  if (!code.includes('<meta name="description"')) {
    issues.push({
      severity: 'LOW',
      description: 'Missing meta description – SEO issue.',
      fix: 'Add <meta name="description" content="...">',
    });
  }
  return issues;
}

// ─── Analyze a single file ──────────────────────────────────────
async function analyzeFile(code, filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const issues = [];

  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    try {
      const eslint = await getESLint();
      const results = await eslint.lintText(code, { filePath: filename });
      const messages = results[0]?.messages || [];
      for (const msg of messages) {
        issues.push({
          severity: msg.severity === 2 ? 'HIGH' : 'MED',
          description: msg.message,
          fix: msg.fix?.text ? `Apply: ${msg.fix.text}` : `Line ${msg.line || '?'}: Review manually.`,
        });
      }
    } catch (e) {
      console.error('ESLint error:', e);
    }
  }

  if (ext === 'html') {
    issues.push(...checkHTML(code));
  }

  if (issues.length < 10) {
    const aiRaw = await callAI(code, filename);
    const aiIssues = parseAIResponse(aiRaw);
    const existing = new Set(issues.map(i => i.description));
    for (const ai of aiIssues) {
      if (!existing.has(ai.description)) {
        issues.push(ai);
        existing.add(ai.description);
      }
    }
  }

  if (!['js', 'ts', 'jsx', 'tsx', 'html'].includes(ext) && issues.length === 0) {
    if (code.includes('TODO') || code.includes('FIXME')) {
      issues.push({
        severity: 'LOW',
        description: 'Found TODO/FIXME comments – incomplete code.',
        fix: 'Address the TODO/FIXME before release.',
      });
    }
  }

  return issues;
}

// ─── Fix generation ──────────────────────────────────────────────
async function generateFixesForFile(code, filename, issues) {
  let newCode = code;
  const ext = filename.split('.').pop().toLowerCase();
  const applied = [];

  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    try {
      const eslint = await getESLint();
      const results = await eslint.lintText(newCode, {
        filePath: filename,
        fix: true,
      });
      if (results[0]?.output) {
        newCode = results[0].output;
        applied.push('ESLint auto-fix');
      }
    } catch (e) {
      console.error('ESLint fix error:', e);
    }
  }

  if (ext === 'html') {
    const dom = new JSDOM(newCode);
    const doc = dom.window.document;

    if (!doc.documentElement.hasAttribute('lang')) {
      doc.documentElement.setAttribute('lang', 'en');
      applied.push('Added lang="en"');
    }
    if (!doc.querySelector('meta[name="viewport"]')) {
      const meta = doc.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0';
      doc.head.appendChild(meta);
      applied.push('Added viewport meta');
    }
    if (!doc.querySelector('title')) {
      const title = doc.createElement('title');
      title.textContent = 'My Page';
      doc.head.appendChild(title);
      applied.push('Added title');
    }
    if (!doc.querySelector('meta[name="description"]')) {
      const meta = doc.createElement('meta');
      meta.name = 'description';
      meta.content = 'Page description';
      doc.head.appendChild(meta);
      applied.push('Added meta description');
    }
    doc.querySelectorAll('img:not([alt])').forEach(img => {
      img.setAttribute('alt', 'image');
      applied.push('Added alt to image');
    });

    newCode = dom.serialize();
  }

  const aiIssues = issues.filter(i => i.severity && i.fix && !i.fix.startsWith('Apply:') && !i.fix.startsWith('Line'));
  if (aiIssues.length > 0 && !applied.length) {
    const prompt = `Fix the following issues in this code and return the full corrected code (only the code, no explanation).\nIssues:\n${aiIssues.map(i => `- ${i.description}`).join('\n')}\n\nFile: ${filename}\n\n${newCode}`;
    const aiResponse = await callAI(prompt, filename + '.fix');
    if (aiResponse) {
      const codeBlock = aiResponse.match(/```(?:\w+)?\s*([\s\S]*?)```/);
      if (codeBlock && codeBlock[1]) {
        newCode = codeBlock[1];
        applied.push('AI-generated fixes');
      } else {
        newCode = aiResponse;
        applied.push('AI-generated fixes (full response)');
      }
    }
  }

  return { newCode, applied };
}

// ─── OAuth Routes ────────────────────────────────────────────────
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

app.get('/auth/github', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  // Store state in a short-lived signed cookie
  res.cookie('oauthState', state, {
    signed: true,
    maxAge: 10 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  const url = `${GITHUB_AUTH_URL}?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=repo&state=${state}`;
  console.log('[AUTH] Redirecting to GitHub OAuth, state:', state);
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const cookieState = req.signedCookies.oauthState;
  console.log('[AUTH] Callback received — code:', !!code, 'state match:', state === cookieState);

  if (!code) {
    return res.status(400).send('Missing code from GitHub');
  }
  if (!state || state !== cookieState) {
    console.error('[AUTH] State mismatch — possible CSRF');
    return res.status(400).send('Invalid state — please try logging in again');
  }

  // Clear the one-time state cookie
  res.clearCookie('oauthState');

  try {
    // Exchange code for access token
    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('[AUTH] Token exchange failed:', tokenData);
      return res.status(400).send('Failed to get access token from GitHub');
    }

    // Fetch GitHub user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    // FIX: cookie-session — just assign to req.session, it auto-saves.
    // No req.session.save() needed (that was express-session API).
    req.session.githubToken = tokenData.access_token;
    req.session.githubUser = {
      id: user.id,
      login: user.login,
      avatar: user.avatar_url,
    };

    console.log('[AUTH] Session set for user:', user.login, '— redirecting to /');
    res.redirect('/');
  } catch (e) {
    console.error('[AUTH] Callback error:', e);
    res.status(500).send('OAuth error: ' + e.message);
  }
});

app.get('/auth/logout', (req, res) => {
  // FIX: cookie-session way to destroy — set to null
  req.session = null;
  res.clearCookie('oauthState');
  res.redirect('/');
});

// ─── API: Current user ───────────────────────────────────────────
app.get('/api/user', (req, res) => {
  if (req.session && req.session.githubUser) {
    res.json({ user: req.session.githubUser, token: req.session.githubToken });
  } else {
    res.json({ user: null });
  }
});

// ─── API: List repos ─────────────────────────────────────────────
app.get('/api/repos', async (req, res) => {
  if (!req.session || !req.session.githubToken) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  try {
    const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: { Authorization: `token ${req.session.githubToken}` },
    });
    const repos = await response.json();
    res.json(repos);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch repos' });
  }
});

// ─── Clone and Scan a Repo ──────────────────────────────────────
const TEMP_DIR = path.join(process.cwd(), 'tmp');

app.post('/api/scan-repo', async (req, res) => {
  const { repoUrl, repoOwner, repoName, token } = req.body;
  const useToken = token || (req.session && req.session.githubToken);
  let cloneUrl = repoUrl;
  if (useToken) {
    cloneUrl = repoUrl.replace('https://', `https://x-access-token:${useToken}@`);
  }
  const folderId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const repoPath = path.join(TEMP_DIR, folderId);
  await fs.mkdir(repoPath, { recursive: true });

  try {
    const git = simpleGit();
    await git.clone(cloneUrl, repoPath, ['--depth', '1']);
    const files = await walkDir(repoPath);
    const results = [];
    for (const filePath of files) {
      const relativePath = path.relative(repoPath, filePath);
      const code = await fs.readFile(filePath, 'utf-8');
      const issues = await analyzeFile(code, relativePath);
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
  const files = [];
  const exclude = ['node_modules', '.git', 'dist', 'build', 'coverage'];
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else {
      const ext = entry.name.split('.').pop().toLowerCase();
      if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h'].includes(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

// ─── Generate Fixes ──────────────────────────────────────────────
app.post('/api/generate-fixes', async (req, res) => {
  const { files } = req.body;
  const fixes = [];
  for (const item of files) {
    const { newCode, applied } = await generateFixesForFile(item.code, item.file, item.issues);
    fixes.push({ file: item.file, newCode, applied });
  }
  res.json({ fixes });
});

// ─── Create PR ──────────────────────────────────────────────────
app.post('/api/create-pr', async (req, res) => {
  const { repoOwner, repoName, branch, fixes, token } = req.body;
  const ghToken = token || (req.session && req.session.githubToken);
  if (!ghToken) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const baseUrl = `https://api.github.com/repos/${repoOwner}/${repoName}`;

    const baseRef = await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
      headers: { Authorization: `token ${ghToken}` },
    });
    const baseRefData = await baseRef.json();
    if (!baseRefData.object?.sha) {
      throw new Error(`Branch "${branch}" not found or repo inaccessible`);
    }
    const baseSha = baseRefData.object.sha;

    const newBranch = `viscarma-fix-${Date.now()}`;
    await fetch(`${baseUrl}/git/refs`, {
      method: 'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
    });

    for (const fix of fixes) {
      const fileRes = await fetch(`${baseUrl}/contents/${fix.file}?ref=${newBranch}`, {
        headers: { Authorization: `token ${ghToken}` },
      });
      const fileData = await fileRes.json();
      if (!fileData.content) continue;
      const oldContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
      if (oldContent === fix.newCode) continue;

      await fetch(`${baseUrl}/contents/${fix.file}`, {
        method: 'PUT',
        headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `fix: auto-generated fixes by VisCarMa (${fix.applied.join(', ')})`,
          content: Buffer.from(fix.newCode).toString('base64'),
          sha: fileData.sha,
          branch: newBranch,
        }),
      });
    }

    const pr = await fetch(`${baseUrl}/pulls`, {
      method: 'POST',
      headers: { Authorization: `token ${ghToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'fix: auto-generated fixes by VisCarMa',
        head: newBranch,
        base: branch,
        body: `This PR applies the fixes suggested by VisCarMa.\n\n${fixes.map(f => `- \`${f.file}\``).join('\n')}`,
      }),
    });
    const prData = await pr.json();
    if (!prData.html_url) throw new Error(prData.message || 'PR creation failed');
    res.json({ url: prData.html_url, number: prData.number });
  } catch (e) {
    console.error('[PR]', e);
    res.status(500).json({ error: 'PR creation failed: ' + e.message });
  }
});

// ─── Health check ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🕵️  VisCarma backend running on port ${PORT}`);
  console.log(`🔐 OLLAMA_API_KEY ${OLLAMA_API_KEY ? '✓ set' : '✗ not set (using OpenRouter fallback)'}`);
  console.log(`🌐 FRONTEND_URL: ${FRONTEND_URL}`);
  console.log(`🔁 REDIRECT_URI: ${REDIRECT_URI}`);
});
