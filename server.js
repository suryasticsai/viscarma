const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runMission } = require('./agent');

const PORT = 9000;

const server = http.createServer(async (req, res) => {
  // ─── Serve static files (dashboard) ──────────────────
  if (req.method === 'GET' && req.url === '/') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    } catch (err) {
      res.writeHead(500);
      res.end('Error loading dashboard.');
    }
    return;
  }

  // ─── Streaming mission endpoint ──────────────────────
  if (req.method === 'GET' && req.url.startsWith('/stream')) {
    const urlParams = new URL(req.url, `http://${req.headers.host}`);
    const repo = urlParams.searchParams.get('repo') || 'viscarma-test';
    const owner = urlParams.searchParams.get('owner') || 'suryasticsai';
    const branch = urlParams.searchParams.get('branch') || 'main';
    const prompt = urlParams.searchParams.get('prompt') || '';

    if (!prompt) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing prompt');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const args = [
      'agent.js',
      '--repo', repo,
      '--owner', owner,
      '--base', branch,
      prompt
    ];

    const agentProcess = spawn('node', args, { cwd: __dirname });

    agentProcess.stdout.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'output', content: data.toString() })}\n\n`);
    });

    agentProcess.stderr.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'error', content: data.toString() })}\n\n`);
    });

    agentProcess.on('close', (code) => {
      res.write(`data: ${JSON.stringify({ type: 'done', content: `Process exited with code ${code}` })}\n\n`);
      res.end();
    });

    return;
  }

  // ─── Setup streaming endpoint ────────────────────────
  if (req.method === 'GET' && req.url === '/setup') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const setupProcess = spawn('bash', ['scripts/setup.sh'], {
      cwd: __dirname,
      env: process.env
    });

    setupProcess.stdout.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'output', content: data.toString() })}\n\n`);
    });

    setupProcess.stderr.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'error', content: data.toString() })}\n\n`);
    });

    setupProcess.on('close', (code) => {
      const status = code === 0 ? '✅ Setup completed successfully.' : `❌ Setup exited with code ${code}.`;
      res.write(`data: ${JSON.stringify({ type: 'done', content: status })}\n\n`);
      res.end();
    });

    return;
  }

  // ─── Legacy POST /launch (optional) ──────────────────
  if (req.method === 'POST' && req.url === '/launch') {
    res.writeHead(404);
    res.end('Use /stream for real-time output');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🕵️ VisCarma dashboard running at http://localhost:${PORT}`);
});