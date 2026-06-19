const { execSync } = require('child_process');

/**
 * Runs Aider on a given repo with a specific message.
 * Returns true if changes were made, false otherwise.
 */
function runAider(repoPath, message, model = 'ollama/qwen2.5-coder:7b') {
  console.log(`🧠 Running Aider with message: "${message}"`);

  // Ensure Ollama API base is set (default localhost)
  const env = {
    ...process.env,
    OLLAMA_API_BASE: process.env.OLLAMA_API_BASE || 'http://127.0.0.1:11434',
    TERM: 'dumb',
    PYTHONUNBUFFERED: '1',
  };

  const command = [
    'python', '-m', 'aider',
    '--message', `"${message}"`,
    '--model', model,
    '--yes',
    '--no-auto-commits',
    '--no-suggest-shell-commands',
    '--no-pretty',
  ].join(' ');

  try {
    execSync(command, {
      cwd: repoPath,
      stdio: 'inherit',
      env: env,
    });

    // ─── Check if any file actually changed ──────────────
    const status = execSync('git status --porcelain', {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim();

    if (status) {
      console.log('✅ Aider applied changes successfully.');
      return true;
    } else {
      console.log('ℹ️ Aider ran but made no changes.');
      return false;
    }
  } catch (err) {
    // If Aider exits with code 1, it might still have made changes.
    // We check the status anyway.
    try {
      const status = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim();
      if (status) {
        console.log('✅ Aider applied changes (despite exit code).');
        return true;
      }
    } catch (e) {}
    console.log('⚠️ Aider did not apply any changes (or exited with an error).');
    return false;
  }
}

module.exports = { runAider };