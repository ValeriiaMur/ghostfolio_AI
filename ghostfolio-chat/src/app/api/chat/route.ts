import { chatWithAgent } from '@/lib/ghostfolio';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/chat
 *
 * Bridges the Vercel AI SDK useChat hook to the Ghostfolio AI agent.
 * useChat sends { messages: [...] }, we extract the last user message
 * and forward it to Ghostfolio's /api/v1/ai/chat endpoint.
 *
 * Returns a plain text streaming-compatible response that useChat expects.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: { role: string; content: string }[] = body.messages ?? [];
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user');

    if (!lastUserMessage) {
      return NextResponse.json(
        { error: 'No user message found' },
        { status: 400 }
      );
    }

    // Use a stable session ID (from header or generate one)
    const sessionId = req.headers.get('x-session-id') ?? 'chat-default';

    const result = await chatWithAgent(lastUserMessage.content, sessionId);

    // Return as a streamed text response compatible with useChat
    // useChat expects a streaming response, but for non-streaming backends
    // we return the full text as a single-chunk stream
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        // Vercel AI SDK data stream protocol:
        // Text parts are prefixed with "0:" and JSON-encoded
        const textPart = `0:${JSON.stringify(result.answer)}\n`;
        controller.enqueue(encoder.encode(textPart));

        // Finish step
        const finishPart = `e:${JSON.stringify({
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0 }
        })}\n`;
        controller.enqueue(encoder.encode(finishPart));

        // Done message
        const donePart = `d:${JSON.stringify({ finishReason: 'stop' })}\n`;
        controller.enqueue(encoder.encode(donePart));

        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Session-Id': result.sessionId
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Chat API error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
