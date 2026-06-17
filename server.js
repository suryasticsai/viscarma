const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9000;

// ─── Check if OAuth is configured ────────────────────────
const OAUTH_ENABLED = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

// ─── Session middleware ──────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// ─── Static files ────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API: auth status ────────────────────────────────────
app.get('/api/auth/status', (req, res) => {
  const isLoggedIn = !!req.session.githubToken;
  res.json({
    oauthEnabled: OAUTH_ENABLED,
    authenticated: isLoggedIn,
  });
});

// ─── OAuth routes (only if enabled) ──────────────────────
if (OAUTH_ENABLED) {
  // 1. Redirect to GitHub login
  app.get('/auth/github', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const redirectUri = `https://${req.get('host')}/auth/github/callback`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo`;
    res.redirect(githubAuthUrl);
  });

  // 2. GitHub callback – exchange code for token
  app.get('/auth/github/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('Missing code');
    }
    try {
      const tokenResponse = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        },
        { headers: { Accept: 'application/json' } }
      );
      const accessToken = tokenResponse.data.access_token;
      req.session.githubToken = accessToken;
      res.redirect('/');
    } catch (err) {
      console.error('OAuth error:', err.response?.data || err.message);
      res.status(500).send('OAuth failed');
    }
  });

  // 3. Logout – destroy session
  app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  // 4. API: list user repositories (requires authentication)
  app.get('/api/repos', async (req, res) => {
    const token = req.session.githubToken;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
      const response = await axios.get('https://api.github.com/user/repos', {
        headers: { Authorization: `Bearer ${token}` },
        params: { sort: 'updated', per_page: 100 }
      });
      const repos = response.data.map(repo => ({
        name: repo.name,
        owner: repo.owner.login,
        full_name: repo.full_name,
        private: repo.private,
      }));
      res.json(repos);
    } catch (err) {
      console.error('Repo fetch error:', err.response?.data || err.message);
      res.status(500).json({ error: 'Failed to fetch repos' });
    }
  });
} else {
  // OAuth not configured – return 404 for OAuth endpoints
  app.get('/auth/github', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/auth/github/callback', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/auth/logout', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/api/repos', (req, res) => res.status(404).json({ error: 'OAuth not configured' }));
}

// ─── Streaming mission (works for online and offline) ──
app.get('/stream', async (req, res) => {
  // Get repo, owner, branch, prompt from query params
  const { repo, owner, branch, prompt } = req.query;
  if (!prompt || !repo || !owner) {
    res.status(400).json({ error: 'Missing repo, owner, or prompt' });
    return;
  }

  // Use the user's GitHub token if logged in, otherwise fallback to environment token (if any)
  let userToken = req.session.githubToken || process.env.GITHUB_TOKEN;
  if (!userToken) {
    res.status(401).json({ error: 'No GitHub token available' });
    return;
  }

  const env = {
    ...process.env,
    GITHUB_TOKEN: userToken,
  };

  const args = [
    'agent.js',
    '--repo', repo,
    '--owner', owner,
    '--base', branch || 'main',
    prompt
  ];

  const child = spawn('node', args, {
    cwd: __dirname,
    env,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  child.stdout.on('data', (data) => {
    res.write(`data: ${JSON.stringify({ type: 'output', content: data.toString() })}\n\n`);
  });

  child.stderr.on('data', (data) => {
    res.write(`data: ${JSON.stringify({ type: 'error', content: data.toString() })}\n\n`);
  });

  child.on('close', (code) => {
    res.write(`data: ${JSON.stringify({ type: 'done', content: `Process exited with code ${code}` })}\n\n`);
    res.end();
  });
});

// ─── Setup endpoint (optional – returns 404 if not implemented) ──
app.get('/setup', (req, res) => {
  res.status(404).send('Setup not available');
});

// ─── Serve the main HTML (fallback) ─────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🕵️ VisCarma running at http://localhost:${PORT}`);
  console.log(`🔐 OAuth mode: ${OAUTH_ENABLED ? 'ONLINE' : 'OFFLINE'}`);
});