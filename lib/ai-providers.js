// lib/ai-providers.js — AI Provider Router
import { generateWithGroq } from './providers/groq.js';
import { generateWithOpenRouter } from './providers/openrouter.js';

// For now we only have Groq and OpenRouter
// Add more providers as needed: ollama, zai, etc.
const providers = {
  groq: { generate: generateWithGroq },
  openrouter: { generate: generateWithOpenRouter },
};

const defaultProvider = process.env.AI_PROVIDER || 'openrouter';
let activeProvider = defaultProvider;

export function setAIProvider(name) {
  if (!providers[name]) throw new Error(`Unknown provider: ${name}`);
  activeProvider = name;
}

export function getAIProvider() {
  return providers[activeProvider];
}

// ─── Robust JSON parser (ported from GrishteSync) ────────────
export function parseAIResponse(text) {
  if (!text || typeof text !== 'string') return [];

  // Strip markdown fences
  let cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();

  // Locate JSON array bounds
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    // Try object mode (some models return object instead of array)
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
      try {
        const parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1));
        // If it's an object, try to extract array from common keys
        if (parsed.issues) return Array.isArray(parsed.issues) ? parsed.issues : [parsed.issues];
        if (parsed.bugs) return Array.isArray(parsed.bugs) ? parsed.bugs : [parsed.bugs];
        if (parsed.results) return Array.isArray(parsed.results) ? parsed.results : [parsed.results];
        return [parsed];
      } catch {}
    }
    return [];
  }
  cleaned = cleaned.slice(start, end + 1);

  // Strip trailing commas (common JSON error)
  cleaned = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  // Escape literal newlines/tabs inside string values
  let result = '';
  let inString = false;
  let escapeNext = false;
  for (const char of cleaned) {
    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    if (inString) {
      if (char === '\n') result += '\\n';
      else if (char === '\t') result += '\\t';
      else if (char === '\r') { /* skip */ }
      else result += char;
    } else {
      result += char;
    }
  }
  cleaned = result;

  // Try JSON.parse
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}

  // Try brace-balancing
  try {
    const open = (cleaned.match(/{/g) || []).length;
    const close = (cleaned.match(/}/g) || []).length;
    let balanced = cleaned;
    if (open > close) balanced += '}'.repeat(open - close);
    else if (close > open) balanced = '{'.repeat(close - open) + balanced;
    const parsed = JSON.parse(balanced);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}

  return [];
}

// ─── AI call with built-in JSON parsing + self-correction ────
export async function callAIWithJSON(prompt, filename, options = {}) {
  const provider = getAIProvider();
  let raw = '';
  let parsed = [];

  try {
    raw = await provider.generate(prompt, filename, options);
    parsed = parseAIResponse(raw);
  } catch (error) {
    console.error('AI call failed:', error.message);
    return [];
  }

  // Self-correction retry if parsing failed
  if (!parsed.length && raw) {
    console.log('AI response failed to parse, requesting correction...');
    try {
      const correctionPrompt = `Your previous response was not valid JSON. Please respond with ONLY a valid JSON array. Previous response was not valid JSON. Previous: ${raw.slice(0, 300)}`;
      const corrected = await provider.generate(correctionPrompt, filename + '.fix', {
        temperature: 0.2,
        maxTokens: 2048,
      });
      parsed = parseAIResponse(corrected);
      if (parsed.length) {
        console.log('Correction succeeded.');
      }
    } catch (error) {
      console.error('Correction attempt failed:', error.message);
    }
  }

  return parsed;
}