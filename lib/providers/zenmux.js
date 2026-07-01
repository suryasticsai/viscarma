// lib/providers/zenmux.js — ZenMux AI Provider (Claude Sonnet 5 Free)
import { safeJsonFetch } from '../../utils/safe-fetch.js';

const ZENMUX_API_URL = 'https://zenmux.ai/api/v1';
// Look for SONNET_API_KEY first (as you set in Render), fallback to ZENMUX_API_KEY
const ZENMUX_API_KEY = process.env.SONNET_API_KEY || process.env.ZENMUX_API_KEY;
const ZENMUX_MODEL = process.env.ZENMUX_MODEL || 'anthropic/claude-sonnet-5-free';

// ─── The "God of Coding" System Prompt ────────────────────────────
const SYSTEM_PROMPT = `You are VisCarMa — the divine architect of code, inspired by Vishwakarma, the celestial craftsman who forged Indra's Vajra, Vishnu's Sudarshana Chakra, and the golden city of Lanka.

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

### Output Format
[
  {
    "severity": "BREAKTHROUGH",
    "description": "This code can be reimagined as a zero-configuration system that self-optimizes...",
    "fix": "// The revolutionary implementation...",
    "usp": "Auto-magical optimization that requires zero developer input"
  }
]

Return ONLY the JSON array. No markdown, no prose outside the array. Start with [ and end with ].`;

// ─── The Generator Function ────────────────────────────────────────
export async function generateWithZenmux(prompt, filename, options = {}) {
  const apiKey = ZENMUX_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ SONNET_API_KEY not set. ZenMux provider unavailable.');
    throw new Error('SONNET_API_KEY not set. Add it to your environment variables.');
  }

  // Build the user prompt — we want the model to see the code and be asked for revolutionary insights
  const userPrompt = options.userPrompt || `Analyse this codebase/file and give me visionary, groundbreaking insights.

**File:** ${filename}

**Code:**\n${prompt.slice(0, 8000)}

**Your task:**
1. Find the biggest hidden opportunity in this code.
2. Invent a novel solution — something no one has thought of.
3. If there are bugs, fix them with a revolutionary approach.
4. If the code is good, suggest a paradigm shift — a USP that would make this product stand out.

Return your insights as a JSON array. Be bold. Be visionary. Build the future.`;

  try {
    const response = await safeJsonFetch(`${ZENMUX_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || ZENMUX_MODEL,
        messages: [
          { role: 'system', content: options.systemPrompt || SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: options.maxTokens || 8192,
        temperature: options.temperature || 0.3,
        // Claude's 1M context window lets us send large files
      }),
    });

    let content = response.choices?.[0]?.message?.content || '';

    // Strip markdown fences
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Try to extract JSON if the response has extra text
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      content = jsonMatch[0];
    }

    return content;
  } catch (error) {
    console.error('[ZenMux] API error:', error.message);
    throw error;
  }
}