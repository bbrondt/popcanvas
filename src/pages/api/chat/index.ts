import type { APIRoute } from 'astro';
import { walkContext, buildSystemPrompt, buildMessages } from '@/lib/ai/prompt';
import { streamChat, type ToolDef } from '@/lib/ai/anthropic';
import { TEMPLATES } from '@/lib/ai/templates';
import type { ChatRequest } from '@/lib/types';

/**
 * Tool Claude can invoke from inside chat. When the user asks for an asset
 * ("write me a video script", "make me a lead magnet"), Claude calls this
 * instead of writing the asset inline. The frontend listens for tool_use
 * SSE frames and spawns a connected ArtifactNode that generates the asset
 * in its own panel — so the chat stays a chat, and the asset lives next
 * to it on the canvas.
 */
const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

const CHAT_TOOLS: ToolDef[] = [
  {
    name: 'create_artifact',
    description: `Create a new long-form deliverable on the canvas (script, lead magnet, ad copy, blog post, email sequence, tweet thread, LinkedIn post, etc).

Call this when the user asks for an ASSET to be produced — anything they would copy, edit, download, or ship. Do NOT call this for short answers, summaries, or back-and-forth discussion; just reply with text for those.

After calling this tool, briefly tell the user (in 1-2 sentences) what asset you started and any creative direction you're taking. Don't paste the artifact into chat — it lives in its own panel.

Pick the template that best fits the user's request. Use 'custom' only when none of the named templates fit, and provide explicit instructions in that case.`,
    input_schema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          enum: TEMPLATE_IDS,
          description: 'Which template to use. Pick the closest fit to what the user asked for.',
        },
        instructions: {
          type: 'string',
          description: `Required when template is 'custom'. For named templates this is OPTIONAL extra direction (audience, angle, tone) layered on top of the template's defaults — leave empty if the user gave no extra direction.`,
        },
      },
      required: ['template'],
    },
  },
];

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
    const context = walkContext(body.chatNodeId, body.nodes, body.edges);
    systemPrompt = buildSystemPrompt(context);
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
          systemPrompt: systemPrompt + '\n\n' + TOOL_USE_HINT,
          messages,
          tools: CHAT_TOOLS,
          onText: (chunk) => {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`));
          },
          onToolUse: (call) => {
            controller.enqueue(
              enc.encode(
                `data: ${JSON.stringify({ type: 'tool_use', id: call.id, name: call.name, input: call.input })}\n\n`,
              ),
            );
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

const TOOL_USE_HINT = `When the user asks you to produce a deliverable (script, lead magnet, ad copy, blog post, email sequence, tweet thread, LinkedIn post, etc.), call the create_artifact tool. The artifact is shown to the user in its own panel on the canvas — you don't need to paste it into chat. After invoking the tool, briefly describe the asset you started.

For questions, summaries, brainstorming, or back-and-forth discussion: just answer in chat. Don't create artifacts for those.`;

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
