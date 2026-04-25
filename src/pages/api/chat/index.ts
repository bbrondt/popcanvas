import type { APIRoute } from 'astro';
import { findConnectedSources, buildSystemPrompt, buildMessages } from '@/lib/ai/prompt';
import { streamChat } from '@/lib/ai/anthropic';
import type { ChatRequest } from '@/lib/types';

export const prerender = false;

/**
 * POST /api/chat
 *
 * Body: ChatRequest { canvasId, chatNodeId, userMessage, nodes, edges }
 *
 * Streams Claude's reply back to the client as text/event-stream. Each frame
 * is a JSON line: {"type":"text","text":"..."} or {"type":"done"} or
 * {"type":"error","error":"..."}.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch (err) {
    return logAndFail('chat:parse', err);
  }

  const chatNode = body.nodes.find((n) => n.id === body.chatNodeId);
  if (!chatNode || chatNode.data.kind !== 'chat') {
    return new Response('Chat node not found', { status: 400 });
  }

  let systemPrompt: string;
  let messages: ReturnType<typeof buildMessages>;
  try {
    const sources = findConnectedSources(body.chatNodeId, body.nodes, body.edges);
    systemPrompt = buildSystemPrompt(sources);
    // history is whatever messages existed *before* this new user turn.
    // Falling back to chatNode.data.messages is safe for old clients but
    // strips the trailing user message if present so we don't send it twice.
    const explicitHistory = Array.isArray(body.history) ? body.history : null;
    const fallbackHistory = (chatNode.data.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    let history = explicitHistory ?? fallbackHistory;
    if (
      history.length > 0 &&
      history[history.length - 1].role === 'user' &&
      history[history.length - 1].content === body.userMessage
    ) {
      history = history.slice(0, -1);
    }
    messages = buildMessages(history, body.userMessage);
  } catch (err) {
    return logAndFail('chat:prompt', err);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        await streamChat({
          systemPrompt,
          messages,
          onText: (chunk) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`));
          },
        });
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error('[chat:stream] failed:', e.message, '\n', e.stack);
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering on Vercel/Nginx so tokens flush as they arrive.
      'X-Accel-Buffering': 'no',
    },
  });
};

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
