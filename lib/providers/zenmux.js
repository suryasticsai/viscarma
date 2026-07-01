// lib/providers/zenmux.js — ZenMux AI Provider (Claude Sonnet 5 Free)
import { safeJsonFetch } from '../../utils/safe-fetch.js';

const ZENMUX_API_URL = 'https://zenmux.ai/api/v1';
const ZENMUX_API_KEY = process.env.SONNET_API_KEY || process.env.ZENMUX_API_KEY;
const ZENMUX_MODEL = process.env.ZENMUX_MODEL || 'anthropic/claude-sonnet-5-free';

export async function generateWithZenmux(prompt, filename, options = {}) {
  const apiKey = ZENMUX_API_KEY;
  if (!apiKey) {
    throw new Error('SONNET_API_KEY not set. Get one from zenmux.ai.');
  }

  // Use provided system prompt or default God mode prompt
  const systemPrompt = options.systemPrompt || `You are VisCarMa — the divine architect of code. Return a JSON array of insights with severity (BREAKTHROUGH|INNOVATION|HIGH|MED|LOW), description, and fix. Be visionary and bold.`;

  const userPrompt = options.userPrompt || `Analyse this codebase/file and give me powerful, actionable insights.\n\n**File:** ${filename}\n\n**Code:**\n${prompt.slice(0, 8000)}`;

  const response = await safeJsonFetch(`${ZENMUX_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || ZENMUX_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: options.maxTokens || 8192,
      temperature: options.temperature || 0.3,
    }),
  });

  let content = response.choices?.[0]?.message?.content || '';
  content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) content = jsonMatch[0];

  return content;
}