# viscarma
VisCarma - The spy in your virtual space. It enters disguised, offline, silently watches your web apps, hunts down bugs and terminates them, then proposes new features through pull requests. Zero cloud, zero API keys, zero traces. Close your eyes and wake up to a clean territory.
---

## What is VisCarma?

VisCarma is a self‑hosted, offline, multi‑modal AI agent that infiltrates your running web application without detection. It observes everything, captures bugs, and autonomously opens pull requests with fixes or brand‑new features — all without a single byte leaving your infrastructure.

**Zero cloud. Zero keys. Zero traces.**  
You own the entire loop.

Live : 🌐 https://suryasticsai.github.io/viscarma/ 

---

## How it works (high‑level)

1. **Infiltrate** – VisCarma enters your app silently and gathers intelligence (visual state, console, structure).
2. **Analyse** – A local AI model interprets what it sees and decides what action to take.
3. **Execute** – Code fixes or features are written, committed to a new branch, and a pull request is opened.
4. **Retreat** – No traces left behind, just a cleaner, sharper territory.

---

## Quick Start

> Detailed installation and configuration are in `docs/` (or wait for Phase II).

```bash
git clone https://github.com/suryasticsai/visCarma.git
cd visCarma
npm install
# configure your app URL and repo in config/visCarma.json
node agent.js "Add a dark mode toggle"


---

Philosophy

· Private by design – everything stays on your machine.
· Invisible – no API keys, no cloud dependencies, no logs outside your control.
· Autonomous – from prompt to PR, zero human intervention.

---

Author

Sai Varakala (Surya)
Senior Scrum Master | Techno‑Agilist | TCS Hyderabad
🔗 suryasticsai across all platforms

---

License

MIT – free for all, like the air that carries the divine whisper.

```

---

## 3. License – MIT

Add a `LICENSE` file (standard MIT). Here’s the full text you can drop in:

```

MIT License

Copyright (c) 2026 Sai Varakala (Surya)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

---

## 4. `.gitignore` for a Node.js project

Create `.gitignore` and fill it with:

```

Dependencies

node_modules/

Environment variables (never commit your GITHUB_TOKEN)

.env

Logs

logs/
*.log

OS files

.DS_Store
Thumbs.db

IDE

.vscode/
.idea/

Playground (local clone of target repo)

playground/

Optional: if you store mission prompts privately

prompts/mission.txt

```

---

