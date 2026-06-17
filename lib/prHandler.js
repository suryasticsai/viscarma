const { Octokit } = require('@octokit/rest');
const { runMission } = require('../agent');

async function handlePRComments(prUrl, githubToken) {
  const octokit = new Octokit({ auth: githubToken });
  const urlParts = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!urlParts) throw new Error('Invalid PR URL');
  const [, owner, repo, pull_number] = urlParts;

  // Get PR comments
  const { data: comments } = await octokit.issues.listComments({
    owner, repo, issue_number: parseInt(pull_number)
  });

  // We only handle the latest comment (for simplicity)
  if (comments.length === 0) {
    console.log('No comments found.');
    return;
  }
  const latest = comments[comments.length - 1];
  const commentBody = latest.body.toLowerCase();

  // Classify
  if (commentBody.includes('thank') || commentBody.includes('thanks') || commentBody.includes('👍')) {
    // Reply with emoji
    await octokit.issues.createComment({
      owner, repo, issue_number: parseInt(pull_number),
      body: '👍 You\'re welcome!'
    });
    console.log('Replied with thumbs up.');
    return;
  }

  if (commentBody.includes('fix') || commentBody.includes('change') || commentBody.includes('can you')) {
    // Extract request and run a new mission
    const request = commentBody.replace(/^(fix|change|can you|please)/i, '').trim();
    console.log(`🔧 New mission triggered from PR comment: "${request}"`);
    const config = {
      github: { owner, repo, baseBranch: 'main', prLabels: ['auto-generated'] },
      repoPath: `../${repo}` // adjust as needed
    };
    const prUrlNew = await runMission(request, config);
    await octokit.issues.createComment({
      owner, repo, issue_number: parseInt(pull_number),
      body: `🔄 I've opened a new PR to address your request: ${prUrlNew}`
    });
    return;
  }

  // Unclear – ask for clarification
  await octokit.issues.createComment({
    owner, repo, issue_number: parseInt(pull_number),
    body: '🤔 I\'m not sure what you\'d like me to do. Could you clarify?'
  });
  console.log('Asked for clarification.');
}

module.exports = { handlePRComments };