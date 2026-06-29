<div align="center">

<img src="public/viscarma_logo.png" alt="VisCarMa Logo" width="120" height="120" style="border-radius: 16px"/>

# VisCarMa

### *The Divine Code Architect*

[![VisCarMa](https://img.shields.io/badge/live-viscarma.onrender.com-388bfd?style=for-the-badge&logo=render&logoColor=white)](https://viscarma.onrender.com)
[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![Built by](https://img.shields.io/badge/built%20by-suryasticsai-ff6b6b?style=for-the-badge&logo=github&logoColor=white)](https://github.com/suryasticsai)

<br/>

> *"विश्वकर्मा — The one who creates everything, the architect of the universe."*
>
> **Just as Vishwakarma forged Indra's Vajra, Vishnu's Sudarshana Chakra, and the golden city of Lanka —**
> **VisCarMa forges clean code, raises PRs, and builds features while you rest.**

<br/>

**VisCarMa** is an AI-powered, agentic code platform that scans your GitHub repositories, fixes bugs, generates features, writes tests, enforces custom rules, and opens pull requests — automatically. Set it active during your lunch break and come back to a cleaner codebase.

<br/>

[🚀 Live Demo](https://viscarma.onrender.com) · [📖 How to Use](#how-to-use) · [⚡ Features](#features) · [🛠️ Self-Host](#self-hosting) · [👤 Author](#author)

</div>

---

## ✨ Features

### 🔍 Tier 1 — Scan & Report
| Feature | Description |
|---|---|
| **Multi-file scanner** | Clones any public or private GitHub repo and scans every file |
| **Severity dashboard** | Visual HIGH / MED / LOW breakdown with bar charts |
| **Scan history** | Server-persisted timeline of every scan with issue trends |
| **Inline diff view** | Monaco-powered GitHub-style before/after diff for every fix |
| **IDE-grade editor** | VS Code's Monaco editor with syntax highlighting for 15+ languages |

### 🛡️ Tier 2 — Deep Analysis
| Feature | Description |
|---|---|
| **ESLint engine** | Full ESLint analysis for JS, TS, JSX, TSX |
| **Security scanner** | 45+ OWASP patterns — secrets, SQL injection, XSS, weak crypto |
| **Multi-language** | Python (pylint patterns), Go, Java, Rust, CSS analysis |
| **AI code review** | Posts AI review comments directly on existing open PRs |
| **HTML auditor** | Accessibility, SEO, viewport, alt tag checks |

### ⚡ Tier 3 — Power Features
| Feature | Description |
|---|---|
| **Auto-fix + PR** | One click — fixes all issues and opens a pull request |
| **Feature generator** | Describe a feature in plain English, AI implements it and opens a PR |
| **Test generator** | AI writes Jest / pytest / JUnit tests and commits them as a PR |
| **Custom rule builder** | Write your own regex rules with severity, fix suggestions, file filters |
| **Scheduled auto-fix** | Cron-based automatic scanning and fixing — runs while you sleep |
| **GitHub Action** | Generates a `.github/workflows/viscarma.yml` CI workflow for any repo |

### 🤖 Agentic Idle Mode
| Feature | Description |
|---|---|
| **Server-side agent** | Survives tab close — runs entirely on the server |
| **Task queue** | Queue multiple tasks (fix + feature mix) to run sequentially |
| **Jira integration** | Pull tickets directly from a Jira project as agent tasks |
| **Browser push** | OS-level notification when the agent finishes while you're away |
| **Countdown timer** | Set a duration (e.g. 45 min lunch break), agent stops automatically |

### 💰 Tier 4 — Growth
| Feature | Description |
|---|---|
| **Scan badge** | `![VisCarMa](https://viscarma.onrender.com/badge/owner/repo.svg)` for your README |
| **Freemium limits** | 3 scans/month anonymous · 20 free · unlimited Pro |
| **Pro whitelist** | Instant Pro via env var — no payment needed for early users |
| **Stripe payments** | Full checkout + webhook integration ready to activate |
| **Rule marketplace** | Publish and install community rule packs |
| **README auto-update** | Every PR adds a VisCarMa change log entry to your README |
| **Watermarked PRs** | Every PR carries a VisCarMa badge, author credit, and timestamp |

---

## 🚀 Live Demo

**[https://viscarma.onrender.com](https://viscarma.onrender.com)**

Login with GitHub → select a repo → scan → fix → PR. Done.

Add this badge to any README after scanning:

```markdown
[![VisCarMa](https://viscarma.onrender.com/badge/YOUR_USERNAME/YOUR_REPO.svg)](https://viscarma.onrender.com)
```

---

## 📖 How to Use

### 1. Login with GitHub
Click **Login with GitHub** in the top right. This grants VisCarMa access to your repos for scanning, fixing, and opening PRs.

### 2. Fix Mode — Scan and Fix
1. Paste a public repo URL **or** select one of your repos from the dropdown
2. Click **Scan URL** or **Scan repo**
3. Review the report — severity chart, file-by-file issues, fix suggestions
4. Click **Apply fixes** — AI + ESLint generates fixed code
5. Open **Editor / Diff** tab to review changes in Monaco diff view
6. Click **Create PR** — a watermarked PR is opened on GitHub automatically

### 3. Feature Mode — Add New Functionality
1. Switch to **Feature** tab in the sidebar
2. Select your repo and click **Load files**
3. Type a feature description: *"Add a dark mode toggle to the header"*
4. Check which files to modify
5. Click **Generate feature** — AI implements it
6. Review in Editor/Diff, click **Create PR**

### 4. Agent Mode — Set It and Go for Lunch
1. Switch to **Agent** tab in the sidebar
2. Select your repo
3. Set a duration (e.g. `45` minutes)
4. Add tasks — one per line:
   ```
   Fix all HIGH severity issues
   Add input validation to all forms
   Write unit tests for the auth module
   Add loading states to API calls
   ```
5. Optionally connect **Jira** — agent will pull tickets automatically
6. Click **Activate agent** — the server takes over
7. Click **Enable push notifications** — get an OS alert when done
8. Go have lunch ☕
9. Come back to PRs already open on GitHub

### 5. Custom Rules
Go to the **Rules** tab to write your own lint rules:
- Pattern: `console\.log\(` · Severity: MED · Fix: *Remove or replace with logger*
- Pattern: `TODO|FIXME` · Severity: LOW · File types: `js,ts`
- Publish your rules to the **Marketplace** for the community

### 6. Schedules
Go to the **Schedules** tab to set up recurring scans:
- Daily at 2am UTC: `0 2 * * *`
- Every Monday at 9am: `0 9 * * 1`
- Every 6 hours: `0 */6 * * *`

### 7. PR Reviewer
Already have an open PR? Enter the PR number in the Fix sidebar and click **Review open PR** — VisCarMa posts AI review comments directly on GitHub.

---

## 🛠️ Self-Hosting

### Prerequisites
- Node.js 18+
- A GitHub OAuth App
- (Optional) Stripe account for payments
- (Optional) VAPID keys for push notifications

### 1. Clone & Install
```bash
git clone https://github.com/suryasticsai/viscarma.git
cd viscarma
npm install
```

### 2. Create GitHub OAuth App
1. Go to GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App
2. Set **Authorization callback URL** to `https://your-domain.com/auth/callback`
3. Copy **Client ID** and **Client Secret**

### 3. Environment Variables
Create a `.env` file or set these in your hosting platform:

```env
# Required
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
SESSION_SECRET=your_random_secret_here

# Optional — defaults to localhost
FRONTEND_URL=https://your-domain.com
REDIRECT_URI=https://your-domain.com/auth/callback

# AI — leave blank to use OpenRouter free tier
OLLAMA_API_KEY=your_ollama_key
OLLAMA_ENDPOINT=http://localhost:11434/api/generate

# Pro whitelist — comma-separated GitHub usernames
VISCARMA_PRO_USERS=yourusername,friendusername

# Push notifications (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_EMAIL=mailto:you@email.com

# Stripe (optional — for paid Pro plan)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...

# Environment
NODE_ENV=production
```

### 4. Generate VAPID Keys (for push notifications)
```bash
npx web-push generate-vapid-keys
```

### 5. Run
```bash
# Production
npm start

# Development
npm run dev
```

### Deploy to Render (recommended)
1. Fork this repo
2. Connect to [Render](https://render.com) → New Web Service → Connect repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add all environment variables in Render dashboard
6. Deploy 🚀

---

## 🏗️ Architecture

```
viscarma/
├── server.js          # Express backend — all API routes
├── public/
│   ├── index.html     # Single-page app (Monaco editor, all UI)
│   ├── style.css      # IDE-native dark theme design system
│   ├── sw.js          # Service worker for push notifications
│   └── viscarma_logo.png
├── data/              # Persistent JSON stores (auto-created)
│   ├── history.json   # Scan history
│   ├── rules.json     # Custom rules
│   ├── schedules.json # Cron schedules
│   ├── pro.json       # Pro users (Stripe-verified)
│   ├── usage.json     # Scan usage per user/month
│   └── marketplace.json # Community rule packs
└── tmp/               # Temporary repo clones (auto-cleaned)
```

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/github` | Start GitHub OAuth |
| `GET` | `/auth/callback` | OAuth callback |
| `GET` | `/api/user` | Current session user |
| `GET` | `/api/repos` | List user's GitHub repos |
| `POST` | `/api/scan-repo` | Clone and scan a repository |
| `POST` | `/api/generate-fixes` | AI + ESLint fix generation |
| `POST` | `/api/generate-feature` | AI feature implementation |
| `POST` | `/api/generate-tests` | AI unit test generation |
| `POST` | `/api/create-pr` | Open a PR with fixes/features |
| `POST` | `/api/review-pr` | Post AI review on existing PR |
| `POST` | `/api/agent/start` | Start server-side agent |
| `GET` | `/api/agent/status` | Poll agent progress |
| `POST` | `/api/agent/stop` | Stop running agent |
| `POST` | `/api/jira-tasks` | Fetch Jira tickets as tasks |
| `GET` | `/api/rules` | List custom rules |
| `POST` | `/api/rules` | Create custom rule |
| `DELETE` | `/api/rules/:id` | Delete custom rule |
| `GET` | `/api/schedules` | List cron schedules |
| `POST` | `/api/schedules` | Create schedule |
| `GET` | `/api/history` | Scan history |
| `GET` | `/api/usage` | Current plan usage |
| `GET` | `/badge/:owner/:repo.svg` | SVG scan badge |
| `GET` | `/api/marketplace` | Browse rule packs |
| `POST` | `/api/marketplace/publish` | Publish rule pack |
| `POST` | `/api/stripe/create-checkout` | Start Stripe checkout |
| `POST` | `/api/stripe/webhook` | Stripe payment webhook |
| `POST` | `/api/generate-action` | Generate GitHub Actions CI |
| `GET` | `/health` | Health check |

---

## 🙏 Vishwakarma — The Divine Architect

> *"यो विश्वकर्मा मनसा परिप्रश्नः — He who is Vishwakarma, the all-seeing architect of minds."*
> — Rigveda 10.81

> *"देवानां सुमहाभागः कर्मणा मनसा गिरा — The great blessed one of the gods, in deed, mind and speech."*

> *"न तस्य प्रतिमा अस्ति यस्य नाम महद्यशः — He has no image, whose name itself is great glory."*
> — Yajurveda 32.3

Just as Vishwakarma — the divine craftsman — built the weapons of the gods, the flying vimanas, the golden city of Lanka, and the celestial halls of Indra, **VisCarMa** builds the weapons of modern engineering: clean code, automated fixes, generated tests, and agentic pipelines that work while you rest.

*The name **Vis-Car-Ma** is a tribute: Vishwakarma, the maker of all things.*

---

## 👤 Author

<div align="center">

<img src="https://github.com/suryasticsai.png" alt="Sai Varakala" width="80" height="80" style="border-radius:50%"/>

### Sai Varakala

*Builder of VisCarMa · The Vishwakarma of Code*

[![GitHub](https://img.shields.io/badge/GitHub-suryasticsai-181717?style=for-the-badge&logo=github)](https://github.com/suryasticsai)
[![Email](https://img.shields.io/badge/Email-suryasticsai@gmail.com-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:suryasticsai@gmail.com)
[![VisCarMa](https://img.shields.io/badge/VisCarMa-viscarma.onrender.com-388bfd?style=for-the-badge)](https://viscarma.onrender.com)

*"I built the tool I always wanted — one that works while I rest."*

</div>

---

## 🤖 VisCarMa Change Log

> Auto-maintained by [VisCarMa](https://viscarma.onrender.com) · Author: [@suryasticsai](https://github.com/suryasticsai)

<!-- VISCARMA:START -->
| Type | Files | Summary | PR | Date | Author |
|------|-------|---------|-----|------|--------|
<!-- VISCARMA:END -->

---

<div align="center">

**Built with ❤️ by [@suryasticsai](https://github.com/suryasticsai)**

*Inspired by Vishwakarma — the divine craftsman who never rests*

[![VisCarMa](https://img.shields.io/badge/auto--scanned%20by-VisCarMa-388bfd?style=flat-square&logo=github)](https://viscarma.onrender.com)

</div>