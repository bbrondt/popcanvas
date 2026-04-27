import type { APIRoute } from 'astro';
import { walkContext, buildSystemPrompt, buildMessages, attachImagesToLastUserTurn } from '@/lib/ai/prompt';
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

Call this when the user asks for a SINGLE asset to be produced — anything they would copy, edit, download, or ship. Do NOT call this for short answers, summaries, or back-and-forth discussion; just reply with text for those. For MULTIPLE parallel deliverables (one per archetype, one per angle, etc.), use spawn_branches instead — it lets you create them all in one tool call.

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
  {
    name: 'spawn_branches',
    description: `Spawn MULTIPLE connected nodes on the canvas in a single call — one per branch. This is how the user composes parallel work: "give me a branch for each archetype", "create an angle node for each of these three angles", "set up a chat for each segment so I can dive deep on them separately".

Each branch is either a chat node (for further conversation / exploration the user will steer) or an artifact node (for a single deliverable). Mix and match freely.

Call this INSTEAD of calling create_artifact several times in a row. Limit: 12 branches max per call so the canvas doesn't get overwhelmed; if the user asks for more, ask them to narrow down or call spawn_branches again later for the rest.

After spawning, briefly tell the user what you laid out (1-2 sentences). Don't paste the per-branch content into chat — each node lives in its own panel.`,
    input_schema: {
      type: 'object',
      properties: {
        branches: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          description: 'Array of nodes to spawn. Each becomes its own panel on the canvas, connected to this chat.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['chat', 'artifact'],
                description: 'chat: a new conversation the user will steer (use when each branch needs back-and-forth). artifact: a single produced deliverable (use when each branch is a self-contained asset like a script or ad copy).',
              },
              title: {
                type: 'string',
                description: 'Short label (3-6 words) shown on the spawned node so the user can tell branches apart at a glance.',
              },
              starterMessage: {
                type: 'string',
                description: '(chat branches) The first user message to seed the conversation with — auto-fires when the chat opens, so each branch arrives with an answer ready. Should be specific enough that the response is immediately useful.',
              },
              template: {
                type: 'string',
                enum: TEMPLATE_IDS,
                description: '(artifact branches) Template id. Pick the closest fit per branch.',
              },
              instructions: {
                type: 'string',
                description: '(artifact branches) Specific direction for this branch (audience, angle, length, etc.).',
              },
            },
            required: ['kind', 'title'],
          },
        },
      },
      required: ['branches'],
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
  let messages: ReturnType<typeof attachImagesToLastUserTurn>;
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
    const baseMessages = buildMessages(history, body.userMessage);
    // Attach any upstream images (Image source dataUrls + ImageGen
    // outputDataUrls) to the latest user turn so Claude actually SEES the
    // images instead of having to ask the user to describe them.
    messages = attachImagesToLastUserTurn(baseMessages, context.images);
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

const TOOL_USE_HINT = `When the user asks you to produce a SINGLE deliverable (script, lead magnet, ad copy, blog post, email sequence, tweet thread, LinkedIn post, etc.), call create_artifact. The artifact is shown in its own panel — don't paste it into chat.

When the user asks for MULTIPLE PARALLEL things ("a branch for each archetype", "one node per angle", "set up a chat for each segment", "build it out separately for X, Y, Z"), call spawn_branches ONCE with all of them in the array. NEVER call create_artifact repeatedly to fake parallelism — the canvas tool handles it natively.

Choose between chat-branches and artifact-branches per item:
  - kind: 'chat'     — when the user will keep iterating on this thread (exploring an archetype, drilling into an angle).
  - kind: 'artifact' — when each branch is a finished deliverable (one ad per format, one email per audience).

For chat branches, write a starterMessage that's specific enough to produce a useful first response — the user wanted parallelism precisely so they can scan many threads quickly, so each thread should arrive populated, not empty.

For questions, summaries, brainstorming, or back-and-forth: just answer in chat.`;

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
