// ─── Global variables ──────────────────────────────────────
let scrollLock = false;
let messageBuffer = '';
let messageCount = 0;
let eventSource = null;
let footerVisible = true;

document.addEventListener('DOMContentLoaded', function() {
  if (typeof animateAvatars === 'function') animateAvatars();

  // ─── DOM refs ──────────────────────────────────────────
  const chatMessages = document.getElementById('chatMessages');
  const launchBtn = document.getElementById('launchBtn');
  const clearBtn = document.getElementById('clearBtn');
  const scrollLockBtn = document.getElementById('scrollLockBtn');
  const connectionStatus = document.getElementById('connectionStatus');
  const messageCountSpan = document.getElementById('messageCount');
  const footerToggle = document.getElementById('footerToggle');
  const footerContent = document.getElementById('footerContent');
  const footerArrow = document.getElementById('footerArrow');
  const setupBtn = document.getElementById('setupBtn');

  const manualRepo = document.getElementById('manualRepo');
  const manualOwner = document.getElementById('manualOwner');
  const usernameInput = document.getElementById('username');
  const branchInput = document.getElementById('branch');
  const promptInput = document.getElementById('prompt');

  const docsBtn = document.getElementById('docsBtn');
  const prototypeBtn = document.getElementById('prototypeBtn');

  // ─── Notification bar ──────────────────────────────────
  const notif = document.getElementById('notification');
  const notifMsg = document.getElementById('notifMessage');
  const notifClose = document.getElementById('notifClose');
  let notifTimeout = null;

  function showNotification(msg, isError = false) {
    notifMsg.textContent = msg;
    notif.style.display = 'flex';
    notif.style.borderColor = isError ? '#e74c3c' : '#d4af37';
    if (notifTimeout) clearTimeout(notifTimeout);
    notifTimeout = setTimeout(() => {
      notif.style.display = 'none';
    }, 5000);
  }

  notifClose.addEventListener('click', () => {
    notif.style.display = 'none';
    if (notifTimeout) clearTimeout(notifTimeout);
  });

  // ─── Modals ─────────────────────────────────────────────
  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  docsBtn.addEventListener('click', () => openModal('docsModal'));
  prototypeBtn.addEventListener('click', () => openModal('prototypeModal'));

  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal;
      closeModal(modalId);
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
      }
    });
  });

  // ─── Agent intro messages ──────────────────────────────
  const agentIntro = {
    'VisCarma': {
      intro: "🔱 I am VisCarma, the Supreme Architect and commander of this DevAIne team. I oversee all missions, delegate tasks, and ensure quality.\n\nI can guide you through the entire installation process. Click me again to see step-by-step instructions! 🛠️",
      install: [
        "📦 **Step 1:** Clone the repository\n```bash\ngit clone https://github.com/suryasticsai/viscarma.git\n```",
        "📦 **Step 2:** Navigate to the folder\n```bash\ncd viscarma\n```",
        "📦 **Step 3:** Install Node dependencies\n```bash\nnpm install\n```",
        "📦 **Step 4:** Install Aider (Python)\n```bash\npython -m pip install aider-chat\n```",
        "📦 **Step 5:** Configure your GitHub token and repo in `config/visCarma.json`\n```json\n{\n  \"github\": {\n    \"token\": \"your_token_here\",\n    \"owner\": \"suryasticsai\",\n    \"repo\": \"viscarma-test\"\n  }\n}\n```",
        "📦 **Step 6:** Start the dashboard\n```bash\nnode server.js\n```",
        "📦 **Step 7:** Open http://localhost:9000 and launch your first mission! 🚀\n\n💡 You can also run missions via CLI:\n```bash\nnode agent.js --repo viscarma-test --owner suryasticsai --base main \"Fix the duplicate counter bug\"\n```"
      ]
    },
    'Parsh': {
      intro: "🪓 I am Parsh, the Bug Killer. I specialize in identifying and eliminating bugs, errors, and code smells.\n\nGive me a mission like **'Fix the duplicate counter bug'** and I'll hunt it down instantly!\n\n🔧 I use ESLint, Aider, and my own rule‑based logic to keep your code pristine."
    },
    'Krish': {
      intro: "🪈 I am Krish, the Feature Inventor. I design and implement new capabilities, from simple UI tweaks to complex modules.\n\nTell me what you want to add – like **'Add a to‑do list feature'** – and I'll write the code, handle the logic, and even add localStorage persistence.\n\n✨ I love building things from scratch!"
    },
    'Parth': {
      intro: "☸️ I am Parth, The Driver. I analyze your mission and decide who should handle it – Parsh for bugs, Krish for features.\n\nI route tasks, orchestrate the workflow, and ensure the right agent is on the job. I'm the brain behind the operation! 🧭"
    }
  };

  // ─── Agent map for chat bubbles ────────────────────────
  const agentMap = {
    'VisCarma': { emoji: '🔱', cls: 'vis' },
    'Parsh':   { emoji: '🪓', cls: 'parsh' },
    'Krish':   { emoji: '🪈', cls: 'krish' },
    'Parth':   { emoji: '☸️', cls: 'parth' },
    'System':  { emoji: '⚙️', cls: 'system' }
  };

  // ─── Chat helper functions ──────────────────────────────
  function switchToChatTab() {
    const chatTab = document.querySelector('.tab-btn[data-tab="chat"]');
    if (chatTab && !chatTab.classList.contains('active')) chatTab.click();
  }

  function setAgentActive(agentName, active) {
    if (typeof window.setAgentActive === 'function') {
      window.setAgentActive(agentName, active);
    } else {
      const map = { VisCarma: 'Vis', Parsh: 'Parsh', Krish: 'Krish', Parth: 'Parth' };
      const key = map[agentName];
      const dot = document.getElementById('status' + key);
      if (dot) {
        dot.className = 'status-dot' + (active ? ' pulse' : ' idle');
      }
    }
  }

  function clearChat() {
    chatMessages.innerHTML = '';
    messageCount = 0;
    messageCountSpan.textContent = '0 messages';
    connectionStatus.textContent = '⚪ Disconnected';
    connectionStatus.style.color = '#666';
    messageBuffer = '';
    ['Vis','Parsh','Krish','Parth'].forEach(k => {
      const dot = document.getElementById('status'+k);
      if (dot) dot.className = 'status-dot idle';
    });
    if (window['visCarmaTimeout']) clearTimeout(window['visCarmaTimeout']);
  }

  // ─── Clickable avatars ─────────────────────────────────
  document.querySelectorAll('.agent-item').forEach(item => {
    item.addEventListener('click', function(e) {
      if (e.target.closest('.mission-form') || e.target.closest('button')) return;
      const agentName = this.dataset.agent;
      if (!agentName) return;
      switchToChatTab();
      const info = agentIntro[agentName];
      if (!info) return;
      if (agentName === 'VisCarma') {
        if (window['visCarmaTimeout']) clearTimeout(window['visCarmaTimeout']);
        addMessage(agentName, info.intro, true);
        const steps = info.install;
        let delay = 800;
        steps.forEach((step, index) => {
          window['visCarmaTimeout'] = setTimeout(() => {
            addMessage(agentName, step, true);
          }, delay);
          delay += 800;
        });
      } else {
        addMessage(agentName, info.intro, true);
      }
    });
  });

  // ─── Button enable/disable logic ──────────────────────
  function updateLaunchButton() {
    const usernameFilled = usernameInput.value.trim() !== '';
    const repoFilled = manualRepo.value.trim() !== '';
    const ownerFilled = manualOwner.value.trim() !== '';
    const promptFilled = promptInput.value.trim() !== '';
    const enabled = usernameFilled && repoFilled && ownerFilled && promptFilled;
    launchBtn.disabled = !enabled;
  }

  usernameInput.addEventListener('input', updateLaunchButton);
  manualRepo.addEventListener('input', updateLaunchButton);
  manualOwner.addEventListener('input', updateLaunchButton);
  promptInput.addEventListener('input', updateLaunchButton);
  branchInput.addEventListener('input', updateLaunchButton);

  // ─── Add message – clean rendering ─────────────────────
  let typingInterval = null;

  function addMessage(agentName, text, instant = false) {
    const info = agentMap[agentName] || agentMap['System'];
    const time = new Date().toLocaleTimeString();
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${agentName === 'System' ? 'system' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar avatar-${info.cls}`;
    avatar.textContent = info.emoji;

    const bubble = document.createElement('div');
    bubble.className = `bubble bubble-${info.cls}`;

    const sender = document.createElement('div');
    sender.className = 'sender';
    sender.innerHTML = `${info.emoji} ${agentName} <span class="time">${time}</span>`;

    const content = document.createElement('div');
    content.className = 'content';

    // ─── Render content – use innerHTML directly ──────────
    // We control the source (server), so it's safe.
    const parts = text.split(/(```[^`]*```)/g);
    let html = '';
    for (let part of parts) {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3).trim();
        let lang = '', codeContent = code;
        const firstLine = code.split('\n')[0];
        if (firstLine && firstLine.match(/^[a-zA-Z0-9_+-]+$/)) {
          lang = firstLine;
          codeContent = code.split('\n').slice(1).join('\n');
        }
        html += `<div class="code-block"><span class="lang-tag">${lang || 'code'}</span><pre>${codeContent}</pre></div>`;
      } else {
        html += `<span class="content-text">${part.replace(/\n/g, '<br>')}</span>`;
      }
    }

    if (instant) {
      content.innerHTML = html;
      messageCount++;
      messageCountSpan.textContent = `${messageCount} messages`;
      if (text.includes('Mission complete')) {
        connectionStatus.textContent = '✅ Done';
        connectionStatus.style.color = '#4caf50';
      }
    } else {
      // Typing effect
      let charIndex = 0;
      const fullText = html;
      content.innerHTML = '';
      if (typingInterval) clearInterval(typingInterval);
      typingInterval = setInterval(() => {
        if (charIndex < fullText.length) {
          content.innerHTML += fullText.charAt(charIndex);
          charIndex++;
          chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
          clearInterval(typingInterval);
          typingInterval = null;
          messageCount++;
          messageCountSpan.textContent = `${messageCount} messages`;
          if (text.includes('Mission complete')) {
            connectionStatus.textContent = '✅ Done';
            connectionStatus.style.color = '#4caf50';
          }
        }
      }, 15);
    }

    bubble.appendChild(sender);
    bubble.appendChild(content);
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    chatMessages.appendChild(msgDiv);

    if (agentName !== 'System') {
      setAgentActive(agentName, true);
      clearTimeout(window['timeout_' + agentName]);
      window['timeout_' + agentName] = setTimeout(() => {
        setAgentActive(agentName, false);
      }, 2000);
    }
  }

  // ─── Launch mission ────────────────────────────────────
  function launchMission() {
    const repo = manualRepo.value.trim();
    const owner = manualOwner.value.trim();
    const username = usernameInput.value.trim();
    const branch = branchInput.value.trim() || 'main';
    const prompt = promptInput.value.trim();

    if (!repo) { showNotification('Please enter a repository name.', true); return; }
    if (!owner) { showNotification('Please enter the owner.', true); return; }
    if (!username) { showNotification('Please enter your GitHub username.', true); return; }
    if (!prompt) { showNotification('Enter a mission prompt.', true); return; }

    launchBtn.disabled = true;
    launchBtn.textContent = 'Running...';
    clearChat();
    connectionStatus.textContent = '⏳ Initializing...';
    connectionStatus.style.color = '#f39c12';

    const url = `/stream?repo=${encodeURIComponent(repo)}&owner=${encodeURIComponent(owner)}&branch=${encodeURIComponent(branch)}&prompt=${encodeURIComponent(prompt)}&username=${encodeURIComponent(username)}`;

    if (eventSource) { eventSource.close(); eventSource = null; }

    eventSource = new EventSource(url);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'output') {
          // Dynamic status updates
          if (data.agent === 'Parsh') connectionStatus.textContent = '🐛 Parsh is debugging...';
          else if (data.agent === 'Krish') connectionStatus.textContent = '🚀 Krish is building...';
          else if (data.agent === 'Parth') connectionStatus.textContent = '🧭 Parth is routing...';
          else if (data.agent === 'VisCarma') connectionStatus.textContent = '🔱 VisCarma is commanding...';
          else if (data.content.includes('ESLint')) connectionStatus.textContent = '🧹 Running ESLint...';
          else if (data.content.includes('Aider')) connectionStatus.textContent = '🧠 Aider is coding...';
          else if (data.content.includes('PR created')) connectionStatus.textContent = '📦 Opening PR...';
          addMessage(data.agent || 'System', data.content, false);
        } else if (data.type === 'error') {
          addMessage('System', '❌ ERROR: ' + data.content, true);
        } else if (data.type === 'done') {
          connectionStatus.textContent = '✅ Done';
          connectionStatus.style.color = '#4caf50';
          launchBtn.disabled = false;
          launchBtn.textContent = '🚀 Launch Mission';
          updateLaunchButton();
          eventSource.close();
          eventSource = null;
        }
      } catch (err) {
        console.error('Parse error:', err);
      }
    };

    eventSource.onerror = () => {
      if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        connectionStatus.textContent = '⚠️ Disconnected';
        connectionStatus.style.color = '#e74c3c';
        launchBtn.disabled = false;
        launchBtn.textContent = '🚀 Launch Mission';
        eventSource = null;
        updateLaunchButton();
      }
    };
  }

  // ─── Setup button ──────────────────────────────────────
  setupBtn.addEventListener('click', function() {
    switchToChatTab();
    clearChat();
    addMessage('System', '⚙️ Starting setup... Please wait.', true);
    if (eventSource) { eventSource.close(); eventSource = null; }
    eventSource = new EventSource('/setup');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'output') {
          addMessage('System', data.content, true);
        } else if (data.type === 'error') {
          addMessage('System', '❌ ERROR: ' + data.content, true);
        } else if (data.type === 'done') {
          addMessage('VisCarma', data.content, true);
          eventSource.close();
          eventSource = null;
        }
      } catch (err) { console.error(err); }
    };
    eventSource.onerror = () => {
      if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        addMessage('System', '⚠️ Setup connection closed.', true);
        eventSource = null;
      }
    };
  });

  // ─── Event listeners ──────────────────────────────────
  launchBtn.addEventListener('click', function(e) {
    e.preventDefault();
    launchMission();
  });

  clearBtn.addEventListener('click', clearChat);
  scrollLockBtn.addEventListener('click', () => {
    scrollLock = !scrollLock;
    scrollLockBtn.textContent = scrollLock ? '🔓 Scroll Unlocked' : '🔒 Scroll Lock';
    if (!scrollLock) chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  footerToggle.addEventListener('click', () => {
    footerVisible = !footerVisible;
    footerContent.classList.toggle('hidden', !footerVisible);
    footerArrow.classList.toggle('collapsed', !footerVisible);
  });

  // ─── Tab switching ──────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const panels = {
        chat: document.getElementById('panel-chat'),
        docs: document.getElementById('panel-docs'),
        prototype: document.getElementById('panel-prototype')
      };
      Object.keys(panels).forEach(key => {
        panels[key].classList.toggle('active', key === btn.dataset.tab);
      });
    });
  });

  // ─── Initial messages ──────────────────────────────────
  addMessage('VisCarma', '🔱 VisCarma is ready. Enter your GitHub username, repo, and mission.', true);
  updateLaunchButton();

  window.addEventListener('beforeunload', () => {
    if (eventSource) eventSource.close();
  });
});
// This script is safe to use as it controls the source (server) and renders HTML directly.