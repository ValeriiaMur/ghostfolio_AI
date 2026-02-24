/**
 * MVP Evaluation Script for Ghostfolio AI Chat Endpoint
 *
 * Tests the POST /api/v1/ai/chat endpoint with sample queries.
 * Requires a running server and valid GHOSTFOLIO_TOKEN env var.
 *
 * Usage:
 *   export GHOSTFOLIO_TOKEN="your-jwt-token"
 *   pnpm test:mvp-eval
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3333';
const TOKEN = process.env.GHOSTFOLIO_TOKEN;

if (!TOKEN) {
  console.error(
    '❌ GHOSTFOLIO_TOKEN not set. Get it from browser DevTools after signing in.\n' +
      '   export GHOSTFOLIO_TOKEN="your-jwt-token"'
  );
  process.exit(1);
}

const testCases = [
  {
    name: 'Basic portfolio query',
    query: 'Show my portfolio',
    sessionId: 'eval-1',
    expectContains: null // just check for 200 + answer field
  },
  {
    name: 'Risk analysis',
    query: 'What are the main risks in my portfolio?',
    sessionId: 'eval-2',
    expectContains: null
  },
  {
    name: 'Allocation question',
    query: 'What is my portfolio allocation?',
    sessionId: 'eval-3',
    expectContains: null
  },
  {
    name: 'Session continuity',
    query: 'Can you summarize what we discussed?',
    sessionId: 'eval-1', // reuse session from first test
    expectContains: null
  }
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`
      },
      body: JSON.stringify({ query: tc.query, sessionId: tc.sessionId })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`❌ ${tc.name}: HTTP ${res.status} — ${text}`);
      failed++;
      continue;
    }

    const data = await res.json();

    if (!data.answer || typeof data.answer !== 'string') {
      console.error(`❌ ${tc.name}: Missing or invalid 'answer' field`, data);
      failed++;
      continue;
    }

    if (!data.sessionId) {
      console.error(`❌ ${tc.name}: Missing 'sessionId' in response`);
      failed++;
      continue;
    }

    if (
      tc.expectContains &&
      !data.answer.toLowerCase().includes(tc.expectContains.toLowerCase())
    ) {
      console.error(
        `❌ ${tc.name}: Expected answer to contain "${tc.expectContains}"`
      );
      failed++;
      continue;
    }

    console.log(
      `✅ ${tc.name}: OK (${data.answer.length} chars, session=${data.sessionId})`
    );
    passed++;
  } catch (error) {
    console.error(`❌ ${tc.name}: ${error.message}`);
    failed++;
  }
}

console.log(
  `\n📊 Results: ${passed} passed, ${failed} failed out of ${testCases.length}`
);
process.exit(failed > 0 ? 1 : 0);
