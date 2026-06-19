require('dotenv').config();

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9000;

// ─── Serve static files ──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper: detect agent from a line of output ────────
function detectAgentFromLine(line) {
  if (line.includes('Agent Parsh')) return 'Parsh';
  if (line.includes('Agent Krish')) return 'Krish';
  if (line.includes('Agent Parth')) return 'Parth';
  if (line.includes('Aider') || line.includes('aider') || line.includes('Model:')) return 'Parth';
  if (line.includes('✅ PR created') || line.includes('Mission complete') || line.includes('📸 After screenshot')) return 'VisCarma';
  if (line.includes('📁 Using repo path') || line.includes('👤 Username') || line.includes('🎯 Target')) return 'VisCarma';
  if (line.includes('ESLint') || line.includes('No duplicate') || line.includes('Running ESLint')) return 'Parth';
  return 'System';
}

// ─── Streaming mission ──────────────────────────────────
app.get('/stream', async (req, res) => {
  const { repo, owner, branch, prompt, username } = req.query;

  if (!prompt || !repo || !owner) {
    res.status(400).json({ error: 'Missing repo, owner, or prompt' });
    return;
  }

  const repoPath = path.join(__dirname, '..', repo);
  const userToken = process.env.GITHUB_TOKEN;
  if (!userToken) {
    res.status(401).json({ error: 'No GitHub token available' });
    return;
  }

  const env = {
    ...process.env,
    GITHUB_TOKEN: userToken,
    TERM: 'dumb',
    PYTHONUNBUFFERED: '1',
  };

  const args = [
    'agent.js',
    '--repo', repo,
    '--owner', owner,
    '--base', branch || 'main',
    '--repo-path', repoPath,
    '--username', username || 'unknown',
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

  let buffer = '';
  let inCodeBlock = false;
  let codeBlockContent = '';
  let messageQueue = [];
  let flushTimer = null;

  const flushMessages = () => {
    if (messageQueue.length === 0) return;
    const grouped = messageQueue.reduce((acc, msg) => {
      if (!acc[msg.agent]) acc[msg.agent] = [];
      acc[msg.agent].push(msg.line);
      return acc;
    }, {});
    for (const [agent, lines] of Object.entries(grouped)) {
      const text = lines.join('\n');
      res.write(`data: ${JSON.stringify({ type: 'output', content: text, agent })}\n\n`);
    }
    messageQueue = [];
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const sendMessage = (agent, content) => {
    messageQueue.push({ agent, line: content });
    if (!flushTimer) {
      flushTimer = setTimeout(flushMessages, 100);
    }
  };

  const processLine = (line) => {
    const trimmed = line.trim();
    if (trimmed === '') return;

    // Suppress ESLint warnings
    if (trimmed.includes('ESLint') && trimmed.includes('not find')) {
      sendMessage('Parth', 'ℹ️ ESLint config not found – skipping linting.');
      return;
    }
    if (trimmed.includes('ESLint') && trimmed.includes('Oops!')) return;
    if (trimmed.includes('ESLint: 10.5.0')) return;
    if (trimmed.includes('ESLint couldn\'t find')) return;
    if (trimmed.includes('From ESLint v9.0.0')) return;
    if (trimmed.includes('If you are using a .eslintrc.*')) return;
    if (trimmed.includes('https://eslint.org/')) return;

    // Suppress Aider prompt-toolkit warnings
    if (trimmed.includes('Can\'t initialize prompt toolkit')) return;
    if (trimmed.includes('Terminal does not support pretty output')) return;

    // Detect code block
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockContent = trimmed + '\n';
        return;
      } else {
        codeBlockContent += trimmed;
        const agent = detectAgentFromLine(line);
        sendMessage(agent, codeBlockContent);
        inCodeBlock = false;
        codeBlockContent = '';
        return;
      }
    }

    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      return;
    }

    const agent = detectAgentFromLine(line);
    sendMessage(agent, line);
  };

  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      processLine(line);
    }
  });

  child.stderr.on('data', (data) => {
    const chunk = data.toString();
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.includes('Can\'t initialize prompt toolkit') && !trimmed.includes('Terminal does not support')) {
        sendMessage('System', '❌ ' + trimmed);
      }
    }
  });

  child.on('close', (code) => {
    if (buffer) processLine(buffer);
    flushMessages();
    res.write(`data: ${JSON.stringify({ type: 'done', content: `Process exited with code ${code}` })}\n\n`);
    res.end();
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🕵️ VisCarma running at http://localhost:${PORT}`);
  console.log(`🔐 OAuth mode: OFFLINE`);
});