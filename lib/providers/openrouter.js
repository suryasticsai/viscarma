// lib/providers/openrouter.js — OpenRouter AI Provider
import { safeJsonFetch } from '../../utils/safe-fetch.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function generateWithOpenRouter(prompt, filename, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = options.model || process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free';

  // If no API key, try fallback (some models work without key on OpenRouter)
  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await safeJsonFetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: options.systemPrompt || `You are a code reviewer. Return a JSON array of issues with severity (HIGH|MED|LOW), description, and fix suggestion. Only respond with the JSON array.`,
        },
        {
          role: 'user',
          content: options.userPrompt || `Analyse this file for bugs, security, performance, and bad practices.\nFile: ${filename}\n\n${prompt.slice(0, 3000)}`
        }
      ],
      temperature: options.temperature || 0.3,
      max_tokens: options.maxTokens || 800,
    }),
  });

  const content = response.choices?.[0]?.message?.content || '';
  return content;
}