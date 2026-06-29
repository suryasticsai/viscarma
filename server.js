// server.js — VisCarma Backend (Clean Version)
import express from 'express';
import cors from 'cors';
import { ESLint } from 'eslint';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── ESLint instance ──────────────────────────────────────────────
let eslintInstance = null;

async function getESLint() {
  if (!eslintInstance) {
    eslintInstance = new ESLint({
      useEslintrc: false,
      overrideConfig: {
        env: {
          browser: true,
          node: true,
          es2021: true,
        },
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
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

// ─── AI call (optional, replace with your chosen service) ──────
async function callAI(code, filename) {
  // Example using OpenRouter (free tier)
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add your API key if needed:
        // 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemma-2-9b-it:free',
        messages: [
          {
            role: 'system',
            content: 'You are a code reviewer. Return a JSON array of issues with severity (HIGH/MED/LOW), description, and a fix suggestion. Only respond with the JSON array.'
          },
          {
            role: 'user',
            content: `Analyse this file for bugs, security, performance, and bad practices.\nFile: ${filename}\n\n${code.slice(0, 3000)}`
          }
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
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
      fix: 'Add <html lang="en"> to the page.'
    });
  }
  if (!code.includes('<title>') || code.match(/<title>\s*<\/title>/)) {
    issues.push({
      severity: 'HIGH',
      description: 'Missing or empty <title> – SEO and usability issue.',
      fix: 'Add a descriptive title: <title>My Page</title>.'
    });
  }
  if (code.includes('<img') && !code.includes('alt=')) {
    issues.push({
      severity: 'MED',
      description: 'Images missing alt attributes – accessibility issue.',
      fix: 'Add alt="description" to all <img> tags.'
    });
  }
  if (!code.includes('viewport')) {
    issues.push({
      severity: 'MED',
      description: 'Missing viewport meta tag – mobile responsiveness issue.',
      fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">'
    });
  }
  return issues;
}

// ─── Main analysis endpoint ──────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { code, filename, extension } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  const ext = extension || filename?.split('.').pop() || '';
  const issues = [];

  // 1. ESLint for JS/TS
  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    try {
      const eslint = await getESLint();
      const results = await eslint.lintText(code, { filePath: filename || 'file.js' });
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

  // 2. HTML checks
  if (ext === 'html') {
    issues.push(...checkHTML(code));
  }

  // 3. AI analysis (if not too many issues already)
  if (issues.length < 10) {
    const aiRaw = await callAI(code, filename || 'file');
    const aiIssues = parseAIResponse(aiRaw);
    const existing = new Set(issues.map(i => i.description));
    for (const ai of aiIssues) {
      if (!existing.has(ai.description)) {
        issues.push(ai);
        existing.add(ai.description);
      }
    }
  }

  // 4. Simple fallback for other languages
  if (!['js', 'ts', 'jsx', 'tsx', 'html'].includes(ext) && issues.length === 0) {
    if (code.includes('TODO') || code.includes('FIXME')) {
      issues.push({
        severity: 'LOW',
        description: 'Found TODO/FIXME comments – incomplete code.',
        fix: 'Address the TODO/FIXME before release.'
      });
    }
  }

  res.json({ issues });
});

// ─── Health check ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🕵️ VisCarma backend running on port ${PORT}`);
});