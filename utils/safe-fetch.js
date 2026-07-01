// utils/safe-fetch.js — Safe JSON fetch that handles HTML error pages
export async function safeJsonFetch(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('text/html')) {
    const html = await response.text();
    console.error('HTML response instead of JSON:', html.slice(0, 200));
    throw new Error(`API returned HTML (status ${response.status}). Check endpoint or gateway.`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let details = text;
    try { details = JSON.parse(text); } catch {}
    throw new Error(`API error ${response.status}: ${typeof details === 'string' ? details : JSON.stringify(details)}`);
  }

  return response.json();
}