// lib/providers/groq.js — Groq AI Provider
import { safeJsonFetch } from '../../utils/safe-fetch.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function generateWithGroq(prompt, filename, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = options.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  if (!apiKey) {
    throw new Error('GROQ_API_KEY not set. Get one from console.groq.com');
  }

  // Use provided system prompt or default
  const systemPrompt = options.systemPrompt || `You are a code reviewer. Return a JSON array of issues with severity (HIGH|MED|LOW), description, and fix suggestion. Only respond with the JSON array.`;

  const userPrompt = options.userPrompt || `Analyse this code for bugs, security issues, and bad practices.\nFile: ${filename}\n\n${prompt.slice(0, 3000)}`;

  const response = await safeJsonFetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.3,
    }),
  });

  let content = response.choices?.[0]?.message?.content || '';
  content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) content = jsonMatch[0];

  return content;
}