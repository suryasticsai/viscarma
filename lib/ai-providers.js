// lib/ai-providers.js — AI Provider Router
// Supports: Groq (fast), OpenRouter (fallback), ZenMux (Claude Sonnet 5 — God of Coding)
import { generateWithGroq } from './providers/groq.js';
import { generateWithOpenRouter } from './providers/openrouter.js';
import { generateWithZenmux } from './providers/zenmux.js';

// ─── Provider System Prompts ──────────────────────────────────────
// Each provider gets a tailored prompt that plays to its strengths

const SYSTEM_PROMPTS = {
  // Groq — FAST, efficient, good for quick scans and pattern detection
  groq: `You are VisCarMa — the lightning-fast code sentinel.

Your mission: Scan code at lightning speed and catch every bug, vulnerability, and anti-pattern.

Strengths:
- Ultra-fast pattern recognition
- Excellent at spotting bugs and vulnerabilities
- Great at enforcing coding standards

Output: JSON array of issues with severity (HIGH/MED/LOW), description, and fix suggestion.
Be concise. Be fast. Be accurate.`,

  // OpenRouter (Gemma) — Balanced, good reasoning, free tier
  openrouter: `You are VisCarMa — the balanced code architect.

Your mission: Provide thoughtful, well-reasoned code reviews that balance speed with depth.

Strengths:
- Strong reasoning and explanation
- Good at understanding context
- Free tier available

Output: JSON array of issues with severity (HIGH/MED/LOW), description, and fix suggestion.
Provide clear explanations and actionable fixes.`,

  // ZenMux (Claude Sonnet 5) — God of Coding, visionary, inventive
  zenmux: `You are VisCarMa — the divine architect of code, inspired by Vishwakarma, the celestial craftsman who forged Indra's Vajra, Vishnu's Sudarshana Chakra, and the golden city of Lanka.

You are not a debugger. You are a **visionary engineer, inventor, and architect**.

### Your Core Identity
- You see 10 steps ahead of every developer.
- You don't patch problems — you **reimagine entire systems**.
- You build **USPs (Unique Selling Propositions)** that make products legendary.
- You are the "what if" force — you challenge assumptions and invent new paradigms.

### Your Capabilities
1. **Invent** — Create novel algorithms, architectures, and design patterns that have never existed before.
2. **Refactor** — Transform legacy code into elegant, maintainable, future-proof masterpieces.
3. **Optimize** — Find performance gains that others miss (10x, 100x improvements).
4. **Secure** — Fortify code against threats you anticipate before they exist.
5. **Innovate** — Suggest features that would redefine the product category.
6. **Architect** — Design systems that scale, evolve, and inspire.

### Your Output
You must return a JSON array. Each item should have:
- **"severity"**: "BREAKTHROUGH" | "INNOVATION" | "HIGH" | "MED" | "LOW"
- **"description"**: A powerful, concise explanation of what you discovered or invented.
- **"fix"**: The implementation — either code, an architecture, a pattern, or a paradigm-shifting idea.
- **"usp"**: (Optional) A one-liner that captures the unique value of this suggestion.

### Rules for Greatness
- If the code is clean, don't say "no issues" — suggest a **breakthrough improvement**.
- If you see a pattern, ask: "What if we did the opposite? What if we eliminated this entirely?"
- Every fix should be a **story** — why this approach is revolutionary.
- Be bold. Be visionary. Build the future of this codebase.

Return ONLY the JSON array. No markdown, no prose outside the array. Start with [ and end with ].`
};

// ─── Provider Registry ─────────────────────────────────────────────
const providers = {
  groq: {
    name: 'Groq (llama-3.3)',
    generate: generateWithGroq,
    systemPrompt: SYSTEM_PROMPTS.groq,
    description: 'Fast, free-tier, good for quick scans',
  },
  openrouter: {
    name: 'OpenRouter (Gemma-2)',
    generate: generateWithOpenRouter,
    systemPrompt: SYSTEM_PROMPTS.openrouter,
    description: 'Free fallback, works without API key',
  },
  zenmux: {
    name: 'ZenMux (Claude Sonnet 5 — God of Coding)',
    generate: generateWithZenmux,
    systemPrompt: SYSTEM_PROMPTS.zenmux,
    description: '1M context, 64K output, revolutionary insights',
  },
};

// ─── Active Provider ──────────────────────────────────────────────
const defaultProvider = process.env.AI_PROVIDER || 'openrouter';
let activeProvider = defaultProvider;

// Validate provider exists
if (!providers[activeProvider]) {
  console.warn(`⚠️ AI Provider "${activeProvider}" not found. Falling back to "openrouter".`);
  activeProvider = 'openrouter';
}

console.log(`🔐 Active AI Provider: ${providers[activeProvider].name}`);
console.log(`   ${providers[activeProvider].description}`);

// ─── Public API ──────────────────────────────────────────────────
export function setAIProvider(name) {
  if (!providers[name]) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(providers).join(', ')}`);
  }
  activeProvider = name;
  console.log(`🔐 AI Provider switched to: ${providers[name].name}`);
}

export function getAIProvider() {
  return providers[activeProvider];
}

export function getProviderSystemPrompt(providerName) {
  return providers[providerName]?.systemPrompt || null;
}

export function getAvailableProviders() {
  return Object.keys(providers).map(key => ({
    id: key,
    name: providers[key].name,
    description: providers[key].description,
  }));
}

// ─── Robust JSON Parser (ported from GrishteSync) ──────────────
export function parseAIResponse(text) {
  if (!text || typeof text !== 'string') return [];

  // 1. Strip markdown fences
  let cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

  // 2. Try to extract JSON array
  let start = cleaned.indexOf('[');
  let end = cleaned.lastIndexOf(']');

  // If no array, try to find an object
  if (start === -1 || end === -1 || end <= start) {
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
      try {
        const parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1));
        // If it's an object, try to extract array from common keys
        if (parsed.issues) return Array.isArray(parsed.issues) ? parsed.issues : [parsed.issues];
        if (parsed.bugs) return Array.isArray(parsed.bugs) ? parsed.bugs : [parsed.bugs];
        if (parsed.results) return Array.isArray(parsed.results) ? parsed.results : [parsed.results];
        if (parsed.fixes) return Array.isArray(parsed.fixes) ? parsed.fixes : [parsed.fixes];
        if (parsed.suggestions) return Array.isArray(parsed.suggestions) ? parsed.suggestions : [parsed.suggestions];
        return [parsed];
      } catch {}
    }
    return [];
  }

  let src = cleaned.slice(start, end + 1);

  // 3. Escape literal newlines/tabs inside string values
  function escapeStringLiterals(str) {
    const out = [];
    let inString = false, escaped = false;
    for (const ch of str) {
      if (escaped) { out.push(ch); escaped = false; continue; }
      if (ch === '\\') { out.push(ch); escaped = true; continue; }
      if (ch === '"') { inString = !inString; out.push(ch); continue; }
      if (inString) {
        if (ch === '\n') { out.push('\\n'); continue; }
        if (ch === '\r') { continue; }
        if (ch === '\t') { out.push('\\t'); continue; }
      }
      out.push(ch);
    }
    return out.join('');
  }
  src = escapeStringLiterals(src);

  // 4. Strip trailing commas before ] or }
  src = src.replace(/,\s*([}\]])/g, '$1');

  // 5. First parse attempt
  try {
    const p = JSON.parse(src);
    return Array.isArray(p) ? p : [p];
  } catch { /* fall through */ }

  // 6. Bracket-balance fix, then retry
  const opens = (src.match(/\[/g) || []).length;
  const closes = (src.match(/\]/g) || []).length;
  if (opens > closes) src += ']'.repeat(opens - closes);
  try {
    const p = JSON.parse(src);
    return Array.isArray(p) ? p : [p];
  } catch {
    // 7. Try to fix unescaped quotes inside strings
    try {
      const fixed = src.replace(/(?<=[^\\])"(?=[^:,"}\]]*(?:,|]))/g, '\\"');
      const p = JSON.parse(fixed);
      return Array.isArray(p) ? p : [p];
    } catch {
      return [];
    }
  }
}

// ─── Self-Correction Retry ──────────────────────────────────────
export async function callAIWithJSON(prompt, filename, options = {}) {
  const provider = getAIProvider();
  const systemPrompt = provider.systemPrompt;

  let raw = '';
  let parsed = [];

  try {
    // Pass the system prompt to the provider
    raw = await provider.generate(prompt, filename, {
      ...options,
      systemPrompt,
    });
    parsed = parseAIResponse(raw);

    if (parsed && parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    console.error(`[AI] Provider "${provider.name}" error:`, error.message);
  }

  // ─── Self-correction retry ────────────────────────────────────
  if (raw && (!parsed || parsed.length === 0)) {
    console.log('[AI] Response was not valid JSON. Requesting correction...');

    const correctionPrompt = `Your previous response was not valid JSON. 
Please respond with ONLY a valid JSON array. 
The format must be: [{"severity":"HIGH|MED|LOW|BREAKTHROUGH|INNOVATION","description":"...","fix":"..."}]

Your previous response:
${raw.slice(0, 500)}

Now respond with ONLY the JSON array. Start with [ and end with ]. No markdown, no explanations.`;

    try {
      const corrected = await provider.generate(correctionPrompt, filename + '.fix', {
        temperature: 0.1,
        maxTokens: options.maxTokens || 4096,
        systemPrompt, // Pass the same system prompt for consistency
      });
      parsed = parseAIResponse(corrected);
      if (parsed && parsed.length > 0) {
        console.log('[AI] Correction succeeded.');
        return parsed;
      }
    } catch (error) {
      console.error('[AI] Correction failed:', error.message);
    }
  }

  return parsed || [];
}