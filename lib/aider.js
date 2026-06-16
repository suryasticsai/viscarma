const { execSync } = require('child_process');

function runAider(repoPath, message, files = []) {
  console.log(`🧠 Running Aider with message: "${message}"`);
  console.log(`📁 Target files: ${files.length ? files.join(', ') : 'all files'}`);

  const env = {
    ...process.env,
    OLLAMA_API_BASE: process.env.OLLAMA_API_BASE || 'http://127.0.0.1:11434'
  };

  // Build command: include --file for each file
  const fileArgs = files.map(f => `--file ${f}`).join(' ');

  const command = [
    'python', '-m', 'aider',
    fileArgs,
    '--message', `"${message}"`,
    '--model', 'ollama/qwen2.5-coder:7b',
    '--yes',
    '--no-auto-commits',
    '--no-suggest-shell-commands',
    '--no-show-model-warnings'
  ].filter(Boolean).join(' ');

  try {
    execSync(command, { cwd: repoPath, stdio: 'inherit', env });
    console.log('✅ Aider applied changes successfully.');
    return true;
  } catch (err) {
    console.log('⚠️ Aider did not apply any changes (or exited with an error).');
    return false;
  }
}

module.exports = { runAider };