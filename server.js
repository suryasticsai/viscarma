const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9000;

const OAUTH_ENABLED = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

// ─── Session configuration ──────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: 'lax',          // ← changed from 'none' to 'lax'
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
    domain: 'viscarma.onrender.com'   // ← explicit domain
  }
}));

// ─── Logging middleware ─────────────────────────────────
app.use((req, res, next) => {
  console.log(`[Session] ID: ${req.sessionID}, Token: ${req.session.githubToken ? 'present' : 'missing'}, Cookies: ${req.headers.cookie || 'none'}`);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auth/status', (req, res) => {
  const isLoggedIn = !!req.session.githubToken;
  res.json({
    oauthEnabled: OAUTH_ENABLED,
    authenticated: isLoggedIn,
  });
});

if (OAUTH_ENABLED) {
  app.get('/auth/github', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const host = req.get('host');
    const redirectUri = `https://${host}/auth/github/callback`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo`;
    console.log(`Redirecting to GitHub: ${githubAuthUrl}`);
    res.redirect(githubAuthUrl);
  });

  app.get('/auth/github/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      console.error('Missing code in callback');
      return res.status(400).send('Missing code');
    }
    try {
      console.log('Exchanging code for token...');
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
      if (!accessToken) {
        console.error('No access token received');
        return res.status(500).send('No access token');
      }
      console.log('Access token obtained');

      // Store token in session
      req.session.githubToken = accessToken;

      // ─── Manually set cookie as fallback ──────────────
      res.cookie('github_token', accessToken, {
        secure: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        domain: 'viscarma.onrender.com',
        path: '/'
      });
      console.log('Manual cookie set');

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).send('Session save failed');
        }
        console.log('Session saved successfully, redirecting to /');
        res.redirect('/');
      });
    } catch (err) {
      console.error('OAuth error:', err.response?.data || err.message);
      res.status(500).send(`OAuth failed: ${err.message}`);
    }
  });

  app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('github_token', { domain: 'viscarma.onrender.com', path: '/' });
      res.redirect('/');
    });
  });

  app.get('/api/repos', async (req, res) => {
    // First check session, then fallback to manual cookie
    let token = req.session.githubToken || req.cookies?.github_token;
    if (!token) {
      // If still no token, try to read from Authorization header (if client sends it)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }
    if (!token) {
      console.log('Repos request: no token');
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
  app.get('/auth/github', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/auth/github/callback', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/auth/logout', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/api/repos', (req, res) => res.status(404).json({ error: 'OAuth not configured' }));
}

// ─── Streaming mission ──────────────────────────────────
app.get('/stream', async (req, res) => {
  const { repo, owner, branch, prompt } = req.query;
  if (!prompt || !repo || !owner) {
    res.status(400).json({ error: 'Missing repo, owner, or prompt' });
    return;
  }

  const repoPath = path.join(__dirname, '..', repo);
  let userToken = req.session.githubToken || req.cookies?.github_token || process.env.GITHUB_TOKEN;
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
    '--repo-path', repoPath,
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

app.get('/setup', (req, res) => res.status(404).send('Setup not available'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🕵️ VisCarma running at http://localhost:${PORT}`);
  console.log(`🔐 OAuth mode: ${OAUTH_ENABLED ? 'ONLINE' : 'OFFLINE'}`);
});