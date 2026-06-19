const express = require('express');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9000;

const OAUTH_ENABLED = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auth/status', (req, res) => {
  const token = req.cookies.github_token;
  res.json({
    oauthEnabled: OAUTH_ENABLED,
    authenticated: !!token,
  });
});

if (OAUTH_ENABLED) {
  app.get('/auth/github', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const host = req.get('host');
    const redirectUri = `https://${host}/auth/github/callback`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo`;
    res.redirect(githubAuthUrl);
  });

  app.get('/auth/github/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('Missing code');
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
      if (!accessToken) throw new Error('No access token');
      res.cookie('github_token', accessToken, {
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
        domain: 'viscarma.onrender.com'   // remove for local testing
      });
      res.redirect('/');
    } catch (err) {
      console.error('OAuth error:', err.message);
      res.status(500).send('OAuth failed');
    }
  });

  app.get('/auth/logout', (req, res) => {
    res.clearCookie('github_token', { path: '/' });
    res.redirect('/');
  });

  app.get('/api/repos', async (req, res) => {
    const token = req.cookies.github_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
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
      console.error('Repo fetch error:', err.message);
      res.status(500).json({ error: 'Failed to fetch repos' });
    }
  });
} else {
  app.get('/auth/github', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/auth/github/callback', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/auth/logout', (req, res) => res.status(404).send('OAuth not configured'));
  app.get('/api/repos', (req, res) => res.status(404).json({ error: 'OAuth not configured' }));
}

// ─── Helper to detect agent from output ────────────────
function detectAgentFromLine(line) {
  if (line.includes('Agent Parsh')) return 'Parsh';
  if (line.includes('Agent Krish')) return 'Krish';
  if (line.includes('Agent Parth')) return 'Parth';
  if (line.includes('Aider') || line.includes('aider')) return 'Parth';
  if (line.includes('✅ PR created')) return 'VisCarma';
  if (line.includes('Mission complete')) return 'VisCarma';
  if (line.includes('📸 After screenshot')) return 'VisCarma';
  return 'System';
}

// ─── Streaming mission ──────────────────────────────────
app.get('/stream', async (req, res) => {
  const { repo, owner, branch, prompt } = req.query;
  const username = req.query.username || 'unknown';

  if (!prompt || !repo || !owner) {
    res.status(400).json({ error: 'Missing repo, owner, or prompt' });
    return;
  }

  const repoPath = path.join(__dirname, '..', repo);
  let userToken = req.cookies?.github_token || process.env.GITHUB_TOKEN;
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
    '--username', username,
    prompt
  ];

  console.log('🚀 Launching agent with args:', args);

  const child = spawn('node', args, {
    cwd: __dirname,
    env,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // ─── Buffer for code blocks ────────────────────────────
  let buffer = '';
  let inCodeBlock = false;
  let codeBlockContent = '';

  const sendMessage = (agentName, content) => {
    res.write(`data: ${JSON.stringify({ type: 'output', content, agent: agentName })}\n\n`);
  };

  const processLine = (line) => {
    const trimmed = line.trim();
    if (trimmed === '') return;

    // Detect code block start
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockContent = trimmed + '\n';
      } else {
        // Closing backticks
        codeBlockContent += trimmed;
        // Send the complete code block as one message
        const agent = detectAgentFromLine(line);
        sendMessage(agent, codeBlockContent);
        inCodeBlock = false;
        codeBlockContent = '';
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      return;
    }

    // Regular line – send immediately
    const agent = detectAgentFromLine(line);
    sendMessage(agent, line);
  };

  child.stdout.on('data', (data) => {
    const chunk = data.toString();
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      processLine(line);
    }
  });

  child.stderr.on('data', (data) => {
    // Send error lines as System
    const chunk = data.toString();
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        sendMessage('System', '❌ ERROR: ' + line);
      }
    }
  });

  child.on('close', (code) => {
    if (buffer) processLine(buffer);
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
