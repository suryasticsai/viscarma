/**
 * VisCarMa — Fixed server.js
 * Fixes:
 *  1. Session persistence on Render (cookie-based, no file store)
 *  2. GitHub OAuth login loop
 *  3. AI fetch target (Pollinations fallback when Ollama unreachable)
 *  4. ESLint v8 lintText() fix option error
 */

import express from 'express';
import cookieSession from 'cookie-session';
import cors from 'cors';
import { createRequire } from 'module';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const app  = express();
const PORT = process.env.PORT || 10000;

// ── ENV ──────────────────────────────────────────────────────────────
const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL         = process.env.FRONTEND_URL || 'http://localhost:3000';
const REDIRECT_URI         = process.env.REDIRECT_URI  || `${FRONTEND_URL}/auth/callback`;
const SESSION_SECRET        = process.env.SESSION_SECRET || 'viscarma-secret-change-me';
const OLLAMA_API_KEY       = process.env.OLLAMA_API_KEY;
const OLLAMA_URL           = process.env.OLLAMA_URL || 'http://localhost:11434';

console.log('🕵️  VisCarma backend running on port', PORT);
if (OLLAMA_API_KEY) console.log('🔐 OLLAMA_API_KEY ✓ set');
console.log('🌐 FRONTEND_URL:', FRONTEND_URL);
console.log('🔁 REDIRECT_URI:', REDIRECT_URI);

// ── MIDDLEWARE ───────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS — allow frontend origin + credentials
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// FIX #1: Use cookie-session instead of express-session + file-store.
// cookie-session stores the whole session in a signed cookie — works
// perfectly on Render's ephemeral filesystem with zero extra deps.
app.use(cookieSession({
  name:   'viscarma_session',
  secret: SESSION_SECRET,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  httpOnly: true,
  // FIX #2: secure must be false on Render HTTP health-checks but true on HTTPS.
  // Render always terminates TLS at the edge, so trust the X-Forwarded-Proto header.
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
}));

// Render terminates SSL at the load balancer — tell Express to trust the proxy
// so req.secure works correctly and cookie-session sets secure cookies properly.
app.set('trust proxy', 1);

// ── STATIC FILES ─────────────────────────────────────────────────────
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));

// ── SESSION CHECK ────────────────────────────────────────────────────
// FIX #3: /api/me now correctly reads from cookie-session (req.session.user)
app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// ── GITHUB OAUTH ─────────────────────────────────────────────────────
// Step 1 — redirect to GitHub
app.get('/auth/github', (req, res) => {
  const state = Math.random().toString(36).slice(2);
  req.session.oauth_state = state;            // store in cookie-session ← fixes loop

  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'repo user');
  url.searchParams.set('state', state);

  console.log('[AUTH] Redirecting to GitHub OAuth, state:', state);
  res.redirect(url.toString());
});

// Step 2 — GitHub callback
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const storedState = req.session.oauth_state;

  console.log('[AUTH] Callback received — code:', !!code, 'state match:', state === storedState);

  // FIX #4: Don't redirect back to /auth/github on state mismatch — it creates a loop.
  // Instead send a proper error page.
  if (!code || state !== storedState) {
    console.warn('[AUTH] State mismatch or missing code — possible CSRF or retry');
    return res.status(400).send(`
      <html><body style="font-family:monospace;background:#0a0c0f;color:#ff5370;padding:40px;">
        <h2>Authentication Error</h2>
        <p>State mismatch or missing code. This can happen if you clicked the OAuth link twice.</p>
        <a href="${FRONTEND_URL}" style="color:#00ffa3;">← Back to VisCarMa</a>
      </body></html>
    `);
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id:     GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri:  REDIRECT_URI
      })
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to get access token');
    }

    // Fetch GitHub user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    const userData = await userRes.json();

    // Store in cookie-session
    req.session.oauth_state = null;  // clear state after use
    req.session.user = {
      login:      userData.login,
      name:       userData.name,
      avatar_url: userData.avatar_url,
      email:      userData.email
    };
    req.session.github_token = tokenData.access_token;

    console.log('[AUTH] Session set for user:', userData.login, '— redirecting to /');
    res.redirect(FRONTEND_URL + '/?login=success');

  } catch (err) {
    console.error('[AUTH] Error:', err.message);
    res.status(500).send(`
      <html><body style="font-family:monospace;background:#0a0c0f;color:#ff5370;padding:40px;">
        <h2>OAuth Error</h2><p>${err.message}</p>
        <a href="${FRONTEND_URL}" style="color:#00ffa3;">← Back to VisCarMa</a>
      </body></html>
    `);
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.session = null;  // cookie-session: setting to null clears the cookie
  res.json({ ok: true });
});

// ── AI PROXY ─────────────────────────────────────────────────────────
// FIX #5: Ollama is localhost-only on Render — use Pollinations as fallback.
// If OLLAMA_URL is set and reachable, use it. Otherwise fall back to Pollinations.
app.post('/api/ai', async (req, res) => {
  const { prompt, model = 'llava', images = [] } = req.body;

  // Try Ollama first (works locally, fails on Render unless self-hosted)
  const ollamaAvailable = OLLAMA_URL && !OLLAMA_URL.includes('localhost') || process.env.NODE_ENV !== 'production';

  if (ollamaAvailable) {
    try {
      const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, images, stream: false }),
        signal: AbortSignal.timeout(30000)
      });
      if (ollamaRes.ok) {
        const data = await ollamaRes.json();
        return res.json({ response: data.response });
      }
    } catch (e) {
      console.log('[AI] Ollama unreachable, falling back to Pollinations:', e.message);
    }
  }

  // Pollinations fallback — free, keyless, no signup required
  try {
    const pollRes = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!pollRes.ok) throw new Error(`Pollinations HTTP ${pollRes.status}`);
    const data = await pollRes.json();
    const text = data.choices?.[0]?.message?.content || data.response || '(no response)';
    return res.json({ response: text });

  } catch (e) {
    console.error('AI error:', e.message);
    return res.status(502).json({ error: 'AI unavailable: ' + e.message });
  }
});

// ── GITHUB API PROXY ──────────────────────────────────────────────────
// Proxies GitHub API calls using the session token — avoids CORS issues
app.get('/api/github/*', async (req, res) => {
  const token = req.session?.github_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const ghPath = req.params[0];
  try {
    const ghRes = await fetch(`https://api.github.com/${ghPath}?${new URLSearchParams(req.query)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    const data = await ghRes.json();
    res.status(ghRes.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/github/*', async (req, res) => {
  const token = req.session?.github_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const ghPath = req.params[0];
  try {
    const ghRes = await fetch(`https://api.github.com/${ghPath}`, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(req.body)
    });
    const data = await ghRes.json();
    res.status(ghRes.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── ESLINT FIX ───────────────────────────────────────────────────────
// FIX #6: ESLint v8 lintText() does not accept { fix: true } in options.
// The fix flag must be passed in the ESLint constructor, not lintText().
async function generateFixesForFile(code, filePath) {
  const eslint = new ESLint({
    fix: true,          // ← correct: constructor option, not lintText option
    overrideConfig: {
      env: { browser: true, es2022: true, node: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' }
    },
    useEslintrc: false
  });

  // lintText() takes only (code, { filePath }) — no fix option here
  const results = await eslint.lintText(code, { filePath });
  await ESLint.outputFixes(results);  // applies fixes back to file
  return results;
}

app.post('/api/lint', async (req, res) => {
  const { code, filePath = 'input.js' } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    const results = await generateFixesForFile(code, filePath);
    const messages = results.flatMap(r => r.messages);
    const fixed    = results[0]?.output || code;
    res.json({ messages, fixed, errorCount: results[0]?.errorCount || 0 });
  } catch (e) {
    console.error('ESLint fix error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── SPA FALLBACK ──────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ VisCarMa server listening on port ${PORT}`);
});
