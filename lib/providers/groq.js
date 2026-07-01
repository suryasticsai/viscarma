// lib/providers/groq.js — Groq AI Provider
import { safeJsonFetch } from '../../utils/safe-fetch.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function generateWithGroq(prompt, filename, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = options.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  if (!apiKey) {
    console.warn('GROQ_API_KEY not set. Get one from console.groq.com');
    throw new Error('GROQ_API_KEY not set. Please add it to your environment variables.');
  }

  // Build system prompt
  const systemPrompt = options.systemPrompt || `You are a code reviewer and bug hunter. 
You must return ONLY a valid JSON array. No markdown, no explanations, no code fences.
Format: [{"severity":"HIGH|MED|LOW","description":"...","fix":"..."}]
IMPORTANT: Your response must start with [ and end with ].`;

  const userPrompt = options.userPrompt || `Analyse this code for bugs, security issues, and bad practices.
File: ${filename}

${prompt.slice(0, 3000)}

Return a JSON array of issues found.`;

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

  // Strip any markdown code fences that might slip through
  content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  // Try to extract JSON if the response has extra text
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    content = jsonMatch[0];
  }

  return content;
}