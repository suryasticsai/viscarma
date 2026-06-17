const fs = require('fs');
const path = require('path');
const { getLog, getLatestMissions } = require('./missionLog');

function generateDocumentation() {
  const log = getLog();
  const missions = getLatestMissions(50);

  let markdown = `# VisCarma – Project Report\n\n`;
  markdown += `*Generated on ${new Date().toLocaleString()}*\n\n`;

  markdown += `## 📊 Summary\n`;
  markdown += `- Total missions: ${log.length}\n`;
  const successful = log.filter(e => e.success).length;
  markdown += `- Successful: ${successful}\n`;
  markdown += `- Failed: ${log.length - successful}\n\n`;

  markdown += `## 🕵️ Mission History\n\n`;
  missions.forEach(m => {
    markdown += `### ${m.timestamp}\n`;
    markdown += `- **Agent:** ${m.agent || 'Unknown'}\n`;
    markdown += `- **Prompt:** ${m.prompt}\n`;
    markdown += `- **PR:** ${m.prUrl || 'No PR'}\n`;
    markdown += `- **Status:** ${m.success ? '✅ Success' : '❌ Failed'}\n`;
    markdown += `- **Files changed:** ${m.filesChanged ? m.filesChanged.join(', ') : 'None'}\n`;

    // Include before/after screenshots if available
    if (m.beforeScreenshot) {
      markdown += `- **Before:** ![before](${m.beforeScreenshot})\n`;
    }
    if (m.afterScreenshot) {
      markdown += `- **After:** ![after](${m.afterScreenshot})\n`;
    }
    markdown += `\n---\n\n`;
  });

  markdown += `## 🔮 Future Scope\n\n`;
  markdown += `Based on recent activity, here are some ideas:\n\n`;
  markdown += `- 📌 **Automated testing**: Add Playwright tests to verify changes.\n`;
  markdown += `- 📌 **Performance monitoring**: Track response times of the agents.\n`;
  markdown += `- 📌 **Self‑healing**: Allow agents to revert changes if tests fail.\n`;
  markdown += `- 📌 **Multi‑repo support**: Let VisCarma work across multiple repos in one session.\n`;
  markdown += `- 📌 **Natural language scheduling**: Say "Run this every day" and VisCarma does it.\n`;
  markdown += `\n*This is a living document – expand it as VisCarma evolves.*\n`;

  // Save to file
  const docPath = path.join(__dirname, '..', 'VISCARMA_REPORT.md');
  fs.writeFileSync(docPath, markdown);
  console.log(`📄 Documentation saved to ${docPath}`);
  return docPath;
}

module.exports = { generateDocumentation };