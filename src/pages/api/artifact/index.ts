import type { APIRoute } from 'astro';
import { walkContext, buildSystemPrompt, attachImagesToLastUserTurn } from '@/lib/ai/prompt';
import { streamChat } from '@/lib/ai/anthropic';
import { getTemplate } from '@/lib/ai/templates';
import type { CanvasNode, CanvasEdge, ArtifactTemplateId } from '@/lib/types';

export const prerender = false;

interface ArtifactRequest {
  artifactNodeId: string;
  template: ArtifactTemplateId;
  customInstructions?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * POST /api/artifact
 *
 * Same wire shape as /api/chat: SSE stream of {type:"text",text:"..."} frames
 * ending with {type:"done"} or {type:"error"}. Difference: no message
 * history, no back-and-forth — one shot. The user message is built from a
 * named template (or custom instructions). The system prompt has the
 * connected sources as XML-tagged context, identically to chat.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: ArtifactRequest;
  try {
    body = (await request.json()) as ArtifactRequest;
  } catch (err) {
    return logAndFail('artifact:parse', err);
  }

  let systemPrompt: string;
  let messages: ReturnType<typeof attachImagesToLastUserTurn>;
  let maxTokens: number;
  try {
    const context = walkContext(body.artifactNodeId, body.nodes, body.edges);
    const upstreamCount =
      context.sources.length + context.chats.length + context.artifacts.length + context.images.length;
    if (upstreamCount === 0) {
      return Response.json(
        {
          error:
            'Connect at least one upstream node (source, chat, prior artifact, or image) before generating.',
        },
        { status: 400 },
      );
    }

    systemPrompt = buildSystemPrompt(context);
    const tpl = getTemplate(body.template);
    maxTokens = tpl.maxTokens;

    let userMessage: string;
    const extra = (body.customInstructions ?? '').trim();
    if (tpl.id === 'custom') {
      if (!extra) {
        return Response.json(
          { error: 'Custom template needs instructions. Type what you want Claude to produce.' },
          { status: 400 },
        );
      }
      userMessage = extra;
    } else {
      // Named template: layer the user's extra direction on top of the
      // template's baseline so they can iterate ("more aggressive",
      // "swap the angle to first-time buyers") without losing the
      // template's structural hints.
      userMessage = extra
        ? `${tpl.userInstructions}\n\n--- additional direction from the user ---\n${extra}`
        : tpl.userInstructions;
    }
    messages = attachImagesToLastUserTurn(
      [{ role: 'user', content: userMessage }],
      context.images,
    );
  } catch (err) {
    return logAndFail('artifact:prompt', err);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        await streamChat({
          systemPrompt,
          messages,
          maxTokens,
          onText: (chunk) => {
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`),
            );
          },
        });
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error('[artifact:stream] failed:', e.message, '\n', e.stack);
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
      'X-Accel-Buffering': 'no',
    },
  });
};

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
