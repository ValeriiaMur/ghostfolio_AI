/**
 * Quick smoke test for the AI endpoint.
 * Sends a single query and prints the response.
 *
 * Usage:
 *   export GHOSTFOLIO_TOKEN="your-jwt-token"
 *   pnpm test:ai
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3333';
const TOKEN = process.env.GHOSTFOLIO_TOKEN;

if (!TOKEN) {
  console.error(
    '❌ GHOSTFOLIO_TOKEN not set.\n' +
      '   1. Open http://localhost:4200 and sign in\n' +
      '   2. DevTools → Application → Local Storage → copy accessToken\n' +
      '   3. export GHOSTFOLIO_TOKEN="paste-here"'
  );
  process.exit(1);
}

console.log('🔍 Sending test query to AI chat endpoint...\n');

try {
  const res = await fetch(`${BASE_URL}/api/v1/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`
    },
    body: JSON.stringify({
      query: 'Give me a brief overview of my portfolio.',
      sessionId: 'smoke-test'
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ HTTP ${res.status}: ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log('✅ Response received:\n');
  console.log(`Session: ${data.sessionId}`);
  console.log(`Answer (${data.answer.length} chars):\n`);
  console.log(data.answer);
  console.log('\n✅ AI endpoint is working!');
} catch (error) {
  console.error(`❌ Error: ${error.message}`);
  process.exit(1);
}
