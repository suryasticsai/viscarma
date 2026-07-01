// lib/providers/openrouter.js — OpenRouter AI Provider
import { safeJsonFetch } from '../../utils/safe-fetch.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function generateWithOpenRouter(prompt, filename, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = options.model || process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free';

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Use provided system prompt or default
  const systemPrompt = options.systemPrompt || `You are a code reviewer. Return a JSON array of issues with severity (HIGH|MED|LOW), description, and fix suggestion. Only respond with the JSON array.`;

  const userPrompt = options.userPrompt || `Analyse this file for bugs, security, performance, and bad practices.\nFile: ${filename}\n\n${prompt.slice(0, 3000)}`;

  const response = await safeJsonFetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: options.temperature || 0.3,
      max_tokens: options.maxTokens || 800,
    }),
  });

  return response.choices?.[0]?.message?.content || '';
}