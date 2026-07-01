// lib/ai-providers.js — AI Provider Router
// Supports: Groq (fast), OpenRouter (fallback), ZenMux (Claude Sonnet 5 — God of Coding)
import { generateWithGroq } from './providers/groq.js';
import { generateWithOpenRouter } from './providers/openrouter.js';
import { generateWithZenmux } from './providers/zenmux.js';

// ─── Provider Registry ─────────────────────────────────────────────
const providers = {
  groq: { 
    name: 'Groq (llama-3.3)',
    generate: generateWithGroq,
    description: 'Fast, free-tier, good for quick scans'
  },
  openrouter: { 
    name: 'OpenRouter (Gemma-2)',
    generate: generateWithOpenRouter,
    description: 'Free fallback, works without API key'
  },
  zenmux: { 
    name: 'ZenMux (Claude Sonnet 5 — God of Coding)',
    generate: generateWithZenmux,
    description: '1M context, 64K output, revolutionary insights'
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
      // Replace any unescaped quotes inside strings
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
  let raw = '';
  let parsed = [];

  try {
    raw = await provider.generate(prompt, filename, options);
    parsed = parseAIResponse(raw);

    // If parsing succeeded and we have results, return them
    if (parsed && parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    console.error(`[AI] Provider "${provider.name}" error:`, error.message);
    // If this was a fallback provider and it failed, we could try the next one
    // But for now, we'll try a correction prompt
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