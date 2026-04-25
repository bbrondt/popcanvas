import type { APIRoute } from 'astro';
import { findConnectedSources, buildSystemPrompt, buildMessages } from '@/lib/ai/prompt';
import { streamChat } from '@/lib/ai/anthropic';
import type { ChatRequest, ChatNodeData } from '@/lib/types';

export const prerender = false;

/**
 * POST /api/chat
 *
 * Body: ChatRequest { canvasId, chatNodeId, userMessage, nodes, edges }
 *
 * Streams Claude's reply back to the client as text/event-stream. Each
 * chunk is a JSON line: {"type":"text","text":"..."} or {"type":"done"}.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json()) as ChatRequest;
  const chatNode = body.nodes.find((n) => n.id === body.chatNodeId);
  if (!chatNode || chatNode.data.kind !== 'chat') {
    return new Response('Chat node not found', { status: 400 });
  }

  const sources = findConnectedSources(body.chatNodeId, body.nodes, body.edges);
  const systemPrompt = buildSystemPrompt(sources);
  const messages = buildMessages(chatNode.data as ChatNodeData, body.userMessage);

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
        const msg = err instanceof Error ? err.message : 'Unknown error';
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
