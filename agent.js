const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const { captureAppState } = require('./lib/capture');
const { queryModel } = require('./lib/model');
const { applyChangesAndOpenPR } = require('./lib/git');
const { trySimpleFix } = require('./lib/rules');
const { runAider } = require('./lib/aider');
const CONFIG = require('./config/viscarma.json');

// ──────────────────────────────────────────────
//  Helper: parse --key value arguments
// ──────────────────────────────────────────────
function parseArgs(rawArgs) {
  const args = {};
  for (let i = 2; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith('--')) {
      const key = rawArgs[i].slice(2);
      const val = rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--') ? rawArgs[i + 1] : true;
      args[key] = val;
      if (val !== true) i++;
    }
  }
  return args;
}

// ──────────────────────────────────────────────
//  Interactive prompt (if no flags)
// ──────────────────────────────────────────────
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(question, ans => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function interactiveConfig() {
  console.log('🕵️ No target specified. Running interactive mission setup...\n');
  const owner = await ask('GitHub owner (default: ' + CONFIG.github.owner + '): ');
  const repo = await ask('Target repo name (default: ' + CONFIG.github.repo + '): ');
  const baseBranch = await ask('Base branch (default: ' + CONFIG.github.baseBranch + '): ');
  const appUrl = await ask('App URL (default: ' + CONFIG.appUrl + '): ');
  const repoPath = await ask('Local repo path (default: ' + CONFIG.repoPath + '): ');

  return {
    github: {
      owner: owner || CONFIG.github.owner,
      repo: repo || CONFIG.github.repo,
      baseBranch: baseBranch || CONFIG.github.baseBranch,
      prLabels: CONFIG.github.prLabels
    },
    appUrl: appUrl || CONFIG.appUrl,
    repoPath: repoPath || CONFIG.repoPath
  };
}

// ──────────────────────────────────────────────
//  Agent Parsh – Bug Killer
// ──────────────────────────────────────────────
async function agentParsh(prompt, config) {
  console.log('🐛 Agent Parsh is hunting bugs...');
  const message = `Fix the bug: ${prompt}`;
  const changed = runAider(config.repoPath, message);
  if (changed) {
    const changes = detectChanges(config.repoPath);
    if (changes.length > 0) {
      return await applyChangesAndOpenPR(config, changes, prompt);
    }
  }
  console.log('No bugs found or no changes applied.');
  return null;
}

// ──────────────────────────────────────────────
//  Agent Krish – Feature Inventor
// ──────────────────────────────────────────────
async function agentKrish(prompt, config) {
  console.log('🚀 Agent Krish is building new features...');
  const message = `Implement the feature: ${prompt}`;
  const changed = runAider(config.repoPath, message);
  if (changed) {
    const changes = detectChanges(config.repoPath);
    if (changes.length > 0) {
      return await applyChangesAndOpenPR(config, changes, prompt);
    }
  }
  console.log('No new features added.');
  return null;
}

// ──────────────────────────────────────────────
//  Agent Parth – The Driver (Orchestrator)
// ──────────────────────────────────────────────
async function agentParth(prompt, config) {
  console.log('🧭 Agent Parth is analyzing the mission...');

  const lower = prompt.toLowerCase();
  if (lower.includes('bug') || lower.includes('fix') || lower.includes('error') || lower.includes('issue')) {
    console.log('🔀 Routing to Agent Parsh (Bug Killer)');
    return await agentParsh(prompt, config);
  } else if (lower.includes('feature') || lower.includes('new') || lower.includes('add') || lower.includes('implement')) {
    console.log('🔀 Routing to Agent Krish (Feature Inventor)');
    return await agentKrish(prompt, config);
  } else {
    console.log('⚠️ Mission type unclear. Trying Agent Parsh as fallback.');
    return await agentParsh(prompt, config);
  }
}

// ──────────────────────────────────────────────
//  Helper: detect changed files after Aider
// ──────────────────────────────────────────────
function detectChanges(repoPath) {
  const output = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf8' });
  const changed = [];
  output.split('\n').forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const file = parts[1];
      const fullPath = path.join(repoPath, file);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        changed.push(file);
      }
    }
  });
  return changed;
}

// ──────────────────────────────────────────────
//  Main mission function
// ──────────────────────────────────────────────
async function runMission(prompt, dynamicConfig = null) {
  const missionStart = new Date();
  console.log(`⏱️  Mission started at ${missionStart.toLocaleTimeString()}`);

  const config = dynamicConfig || CONFIG;

  // ─── Override repoPath if --repo-path was provided ────
  const args = parseArgs(process.argv);
  if (args['repo-path']) {
    config.repoPath = args['repo-path'];
    console.log(`📁 Using repo path: ${config.repoPath}`);
  }

  console.log(`🕵️ VisCarma embarking on mission: "${prompt}"`);
  console.log(`🎯 Target: ${config.github.owner}/${config.github.repo} (branch: ${config.github.baseBranch})`);

  // Capture the app state (if browser URL is configured)
  let screenshotBase64 = '', dom = '', consoleErrors = [];
  if (config.appUrl) {
    try {
      const captured = await captureAppState(config.appUrl);
      screenshotBase64 = captured.screenshotBase64;
      dom = captured.dom;
      consoleErrors = captured.consoleErrors;
    } catch (e) {
      console.log('No browser capture (backend repo detected). Working with source files only.');
    }
  }

  // Read all source files from the local clone
  const sourceFiles = getSourceFiles(config.repoPath);

  // ─── TOOL USE: ESLint auto‑fix (Chapter 5) ─────────────────
  try {
    console.log('🧹 Running ESLint auto‑fix on the repo...');
    execSync('npx eslint --fix .', { cwd: config.repoPath, stdio: 'inherit' });
    console.log('✅ ESLint fixes applied (if any).');
  } catch (e) {
    console.log('✅ ESLint completed (fixes may have been applied).');
  }

  // ─── Rule‑based simple fix (fast) ─────────────────
  const simpleFix = trySimpleFix(prompt, sourceFiles);
  if (simpleFix && simpleFix.length > 0) {
    console.log('🔧 Simple bug detected — applying rule‑based fix...');
    const prUrl = await applyChangesAndOpenPR(config, simpleFix, prompt);
    const missionEnd = new Date();
    const duration = Math.round((missionEnd - missionStart) / 1000);
    console.log(`⏱️  Mission ended at ${missionEnd.toLocaleTimeString()}`);
    console.log(`⌛ Total duration: ${duration} seconds`);
    console.log('🎯 Mission complete.');
    return prUrl;
  }

  // ─── Route to the appropriate agent ─────────────────
  const prUrl = await agentParth(prompt, config);

  const missionEnd = new Date();
  const duration = Math.round((missionEnd - missionStart) / 1000);
  console.log(`⏱️  Mission ended at ${missionEnd.toLocaleTimeString()}`);
  console.log(`⌛ Total duration: ${duration} seconds`);
  console.log('🎯 Mission complete.');
  return prUrl;
}

function getSourceFiles(repoPath) {
  const files = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules','.git'].includes(entry.name)) continue;
        walk(full);
      } else if (entry.name.match(/\.(js|html|css|json|ts|jsx|tsx)$/)) {
        files[path.relative(repoPath, full)] = fs.readFileSync(full, 'utf8');
      }
    }
  }
  walk(repoPath);
  return files;
}

// Entry point (CLI)
if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv);

    const flags = ['repo', 'owner', 'base', 'app-url', 'repo-path', 'agent'];
    const missionWords = process.argv.slice(2).filter((_, i, arr) => {
      if (arr[i].startsWith('--')) {
        const key = arr[i].slice(2);
        if (flags.includes(key)) return false;
        if (arr[i + 1] && !arr[i + 1].startsWith('--')) return false;
        return false;
      }
      if (i > 0 && arr[i - 1].startsWith('--') && flags.includes(arr[i - 1].slice(2))) return false;
      return true;
    });
    let mission = missionWords.join(' ').trim();

    if (!mission && fs.existsSync(path.join(__dirname, 'prompts', 'mission.txt'))) {
      mission = fs.readFileSync(path.join(__dirname, 'prompts', 'mission.txt'), 'utf8').trim();
    }

    if (!mission) {
      console.error('No mission provided. Pass a prompt as argument or create prompts/mission.txt');
      process.exit(1);
    }

    let dynamicConfig = null;
    if (args.repo || args.owner || args.base || args['app-url'] || args['repo-path']) {
      dynamicConfig = {
        github: {
          owner: args.owner || CONFIG.github.owner,
          repo: args.repo || CONFIG.github.repo,
          baseBranch: args.base || CONFIG.github.baseBranch,
          prLabels: CONFIG.github.prLabels
        },
        appUrl: args['app-url'] || CONFIG.appUrl,
        repoPath: args['repo-path'] || CONFIG.repoPath
      };
    } else {
      dynamicConfig = await interactiveConfig();
    }

    // Override agent selection if --agent flag is provided
    let agentFunc = agentParth; // default
    if (args.agent) {
      const agentName = args.agent.toLowerCase();
      if (agentName === 'parsh') agentFunc = agentParsh;
      else if (agentName === 'krish') agentFunc = agentKrish;
      else if (agentName === 'parth') agentFunc = agentParth;
      else console.warn(`Unknown agent "${args.agent}". Using Parth as default.`);
    }

    // Run the selected agent directly (bypassing Parth routing)
    let result;
    if (agentFunc === agentParth) {
      result = await runMission(mission, dynamicConfig);
    } else {
      console.log(`🕵️ Running agent ${agentFunc.name} directly...`);
      result = await agentFunc(mission, dynamicConfig);
    }

    if (result) console.log(`✅ PR: ${result}`);
    process.exit(0);
  })().catch(err => {
    console.error('Mission failed:', err);
    process.exit(1);
  });
}

module.exports = { runMission, agentParsh, agentKrish, agentParth };