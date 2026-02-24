/**
 * Ghostfolio API client.
 * Handles anonymous auth (security token → JWT) and API calls.
 */

const API_URL = process.env.GHOSTFOLIO_API_URL || 'http://localhost:3333';
const SECURITY_TOKEN = process.env.GHOSTFOLIO_SECURITY_TOKEN || '';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Get a JWT from Ghostfolio using the anonymous auth flow.
 * Caches the token for 30 minutes.
 */
export async function getGhostfolioToken(): Promise<string> {
  // Return cached token if still valid (30 min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (!SECURITY_TOKEN) {
    throw new Error(
      'GHOSTFOLIO_SECURITY_TOKEN not set. Get this from your Ghostfolio user settings.'
    );
  }

  const response = await fetch(`${API_URL}/api/v1/auth/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: SECURITY_TOKEN })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ghostfolio auth failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  cachedToken = data.authToken;
  tokenExpiresAt = Date.now() + 30 * 60 * 1000; // cache 30 min

  return cachedToken!;
}

/**
 * Send a chat message to the Ghostfolio AI agent.
 */
export async function chatWithAgent(
  query: string,
  sessionId?: string
): Promise<{ answer: string; sessionId: string }> {
  const token = await getGhostfolioToken();

  const response = await fetch(`${API_URL}/api/v1/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query, sessionId })
  });

  if (!response.ok) {
    // If 401/403, clear cached token and retry once
    if (response.status === 401 || response.status === 403) {
      cachedToken = null;
      tokenExpiresAt = 0;
      const retryToken = await getGhostfolioToken();
      const retry = await fetch(`${API_URL}/api/v1/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${retryToken}`
        },
        body: JSON.stringify({ query, sessionId })
      });
      if (!retry.ok) {
        throw new Error(`Ghostfolio chat failed: ${retry.status}`);
      }
      return retry.json();
    }
    throw new Error(`Ghostfolio chat failed: ${response.status}`);
  }

  return response.json();
}
