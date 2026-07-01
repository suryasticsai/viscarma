// lib/pr-agent.js — PR Agent that responds to comments and reworks code
import { callAIWithJSON } from './ai-providers.js';

const GITHUB_API_URL = 'https://api.github.com';

// ─── PR Agent ──────────────────────────────────────────────────────
export class PRAgent {
  constructor(repoOwner, repoName, prNumber, token) {
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.prNumber = prNumber;
    this.token = token;
    this.baseUrl = `${GITHUB_API_URL}/repos/${repoOwner}/${repoName}`;
    this.headers = {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    };
  }

  // ─── Listen for PR comments ─────────────────────────────────────
  async listenForComments() {
    console.log(`👂 Listening for comments on PR #${this.prNumber}...`);
    const comments = await this.getPRComments();
    const newComments = comments.filter(c => !c.agent_processed);

    for (const comment of newComments) {
      const response = await this.processComment(comment);
      if (response) {
        await this.postReply(comment.id, response);
        await this.markCommentProcessed(comment.id);
      }
    }

    return newComments.length;
  }

  // ─── Get all PR comments ────────────────────────────────────────
  async getPRComments() {
    const url = `${this.baseUrl}/issues/${this.prNumber}/comments`;
    const response = await fetch(url, { headers: this.headers });
    const comments = await response.json();
    return comments.map(c => ({
      id: c.id,
      user: c.user.login,
      body: c.body,
      created_at: c.created_at,
      agent_processed: false, // Track processed comments
    }));
  }

  // ─── Process a comment with AI ──────────────────────────────────
  async processComment(comment) {
    const prompt = `
You are VisCarMa, an autonomous PR agent.

A reviewer has commented on your PR:

PR #${this.prNumber}: ${comment.body}

The reviewer is: ${comment.user}

Your job:
1. Understand what they are asking for.
2. Determine if it's a:
   - **Rework request** — they want code changes.
   - **Question** — they need clarification.
   - **Acknowledgment** — they're approving or thanking.
   - **New requirement** — they're asking for a new feature.

Respond with a JSON object:
{
  "action": "rework" | "question" | "acknowledge" | "new_feature",
  "explanation": "What you think they want",
  "proposed_fix": "The code change (if rework) or the explanation (if question)",
  "commit_message": "The commit message (if rework)"
}

If it's a rework, be specific about what code to change.
If it's a question, provide a clear, friendly answer.
If it's a new feature, suggest creating a new issue or PR.
    `;

    const result = await callAIWithJSON(prompt, `pr-${this.prNumber}-comment`);

    // Parse the AI response
    if (!result || !result.action) {
      return this.fallbackResponse(comment);
    }

    return result;
  }

  // ─── Fallback if AI fails ──────────────────────────────────────
  fallbackResponse(comment) {
    return {
      action: 'question',
      explanation: 'I want to understand this better.',
      proposed_fix: `Hi @${comment.user}, could you elaborate on what you'd like me to change? I want to make sure I get it right.`,
    };
  }

  // ─── Execute the action ─────────────────────────────────────────
  async executeAction(actionResult) {
    switch (actionResult.action) {
      case 'rework':
        return await this.reworkCode(actionResult);
      case 'question':
        return await this.answerQuestion(actionResult);
      case 'acknowledge':
        return await this.acknowledge(actionResult);
      case 'new_feature':
        return await this.suggestNewFeature(actionResult);
      default:
        return {
          reply: "I'm not sure how to respond to that. Could you rephrase?",
        };
    }
  }

  // ─── Rework: Make the code change ──────────────────────────────
  async reworkCode(actionResult) {
    console.log(`🔧 Reworking PR #${this.prNumber}...`);

    // 1. Get the current PR files
    const files = await this.getPRFiles();

    // 2. AI generates the fix
    const fixPrompt = `
The reviewer asked for changes on PR #${this.prNumber}:
"${actionResult.explanation}"

The proposed fix is:
${actionResult.proposed_fix}

Current files:
${files.map(f => `- ${f.filename}: ${f.patch?.slice(0, 200)}`).join('\n')}

Generate the exact code changes needed.
    `;

    const fixResult = await callAIWithJSON(fixPrompt, `pr-${this.prNumber}-fix`);

    // 3. Apply the change
    if (fixResult && fixResult.changes) {
      await this.applyChanges(fixResult.changes);
    }

    // 4. Push a new commit
    const commitSha = await this.pushCommit(actionResult.commit_message || 'fix: address PR feedback');

    // 5. Reply to the comment
    return {
      reply: `✅ Addressed your feedback! See commit \`${commitSha.slice(0, 7)}\`.

**Changes made:**
${this.formatChanges(actionResult.proposed_fix)}

Please review and let me know if anything else is needed.`,
      commitSha,
    };
  }

  // ─── Answer a question ──────────────────────────────────────────
  async answerQuestion(actionResult) {
    return {
      reply: `🤔 Great question! ${actionResult.proposed_fix}`,
    };
  }

  // ─── Acknowledge feedback ──────────────────────────────────────
  async acknowledge(actionResult) {
    return {
      reply: `🙌 Thanks for the feedback! I'm glad you like it.`,
    };
  }

  // ─── Suggest a new feature ──────────────────────────────────────
  async suggestNewFeature(actionResult) {
    return {
      reply: `💡 That's a great idea! I've created a new issue to track this:

[Link to new issue]

Let's handle this separately so we can keep this PR focused.`,
    };
  }

  // ─── Get PR files ──────────────────────────────────────────────
  async getPRFiles() {
    const url = `${this.baseUrl}/pulls/${this.prNumber}/files`;
    const response = await fetch(url, { headers: this.headers });
    return response.json();
  }

  // ─── Apply changes to files ─────────────────────────────────────
  async applyChanges(changes) {
    const branch = await this.getPRBranch();

    for (const change of changes) {
      const fileUrl = `${this.baseUrl}/contents/${change.path}?ref=${branch}`;
      const existing = await fetch(fileUrl, { headers: this.headers });

      if (existing.ok) {
        const data = await existing.json();
        await fetch(fileUrl, {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify({
            message: change.message || 'fix: address PR feedback',
            content: Buffer.from(change.content).toString('base64'),
            sha: data.sha,
            branch: branch,
          }),
        });
      } else {
        // New file
        await fetch(fileUrl, {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify({
            message: change.message || 'fix: address PR feedback',
            content: Buffer.from(change.content).toString('base64'),
            branch: branch,
          }),
        });
      }
    }
  }

  // ─── Push a commit ──────────────────────────────────────────────
  async pushCommit(message) {
    const branch = await this.getPRBranch();
    const refUrl = `${this.baseUrl}/git/refs/heads/${branch}`;
    const ref = await fetch(refUrl, { headers: this.headers });
    const data = await ref.json();

    const commitUrl = `${this.baseUrl}/git/commits`;
    const commit = await fetch(commitUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        message: message,
        tree: data.object.sha,
        parents: [data.object.sha],
      }),
    });
    const commitData = await commit.json();

    // Update the branch
    await fetch(refUrl, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({
        sha: commitData.sha,
        force: false,
      }),
    });

    return commitData.sha;
  }

  // ─── Get PR branch ──────────────────────────────────────────────
  async getPRBranch() {
    const url = `${this.baseUrl}/pulls/${this.prNumber}`;
    const response = await fetch(url, { headers: this.headers });
    const data = await response.json();
    return data.head.ref;
  }

  // ─── Post a reply ──────────────────────────────────────────────
  async postReply(commentId, response) {
    const url = `${this.baseUrl}/issues/${this.prNumber}/comments`;
    await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        body: response.reply || response,
      }),
    });
    console.log('💬 Reply posted:', response.reply?.slice(0, 100) + '...');
  }

  // ─── Mark comment as processed ──────────────────────────────────
  async markCommentProcessed(commentId) {
    // Store in a local cache (Redis or file)
    const cacheFile = path.join(process.cwd(), 'data', 'processed-comments.json');
    let processed = [];
    try {
      const data = await fs.readFile(cacheFile, 'utf-8');
      processed = JSON.parse(data);
    } catch {}
    processed.push(commentId);
    await fs.writeFile(cacheFile, JSON.stringify(processed, null, 2));
  }

  // ─── Format changes for reply ──────────────────────────────────
  formatChanges(proposedFix) {
    return proposedFix
      .split('\n')
      .filter(line => line.trim())
      .map(line => `- ${line}`)
      .join('\n');
  }
}