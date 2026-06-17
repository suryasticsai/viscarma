const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 9000;

// ─── Session middleware ──────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// ─── Static files ────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── OAuth routes ────────────────────────────────────────

// 1. Start OAuth flow
app.get('/auth/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = `https://${req.get('host')}/auth/github/callback`;
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo`;
  res.redirect(githubAuthUrl);
});

// 2. OAuth callback
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

// 3. Logout
app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ─── API: list repositories ──────────────────────────────
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
    // Return name, owner, and full_name for display
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

// ─── Streaming mission (with user token) ────────────────
app.get('/stream', async (req, res) => {
  const userToken = req.session.githubToken;
  if (!userToken) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { repo, owner, branch, prompt } = req.query;
  if (!prompt || !repo) {
    res.status(400).json({ error: 'Missing repo or prompt' });
    return;
  }

  // Build the agent command with the repo and owner
  // We'll pass the user's token as environment variable to the child process
  const env = {
    ...process.env,
    GITHUB_TOKEN: userToken,      // the user's token overrides any server token
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

// ─── Setup endpoint (optional, still uses system env) ────
app.get('/setup', (req, res) => {
  // ... keep your existing setup if needed
});

// ─── Serve the main HTML ─────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🕵️ VisCarma running at http://localhost:${PORT}`);
});