import type { APIRoute } from 'astro';
import { GoogleGenAI } from '@google/genai';
import { walkContext } from '@/lib/ai/prompt';
import type { CanvasNode, CanvasEdge, ImageNodeData } from '@/lib/types';

export const prerender = false;

interface ImageGenRequest {
  imageGenNodeId: string;
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  /** Reference images shipped explicitly so the bytes don't have to ride
   *  along inside `nodes` (which would blow past Vercel's body limit when
   *  there are several base64 images on the canvas). */
  references?: { dataUrl: string; label?: string }[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * POST /api/generate/image
 *
 * Generates an image using Gemini 2.5 Flash Image (a.k.a. nano-banana). The
 * request body includes the canvas snapshot; we walk the graph upstream from
 * the image-gen node to find:
 *   - reference image source nodes (used as multimodal inputs)
 *   - text/URL/PDF/transcript context (folded into the prompt as guidance)
 *   - prior chats/artifacts (folded into the prompt as conversational/work
 *     history so the user can iterate inside the canvas the way they would
 *     inside a Claude conversation)
 *
 * Returns { dataUrl, mimeType } — a base64 data URL of the generated image
 * which the client persists into the node's data so it survives reloads.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: ImageGenRequest;
  try {
    body = (await request.json()) as ImageGenRequest;
  } catch (err) {
    return logAndFail('imagegen:parse', err);
  }

  const prompt = (body.prompt ?? '').trim();
  if (!prompt) {
    return Response.json({ error: 'Prompt is required.' }, { status: 400 });
  }

  const apiKey = import.meta.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY not set in env. Get one from aistudio.google.com.' },
      { status: 500 },
    );
  }

  // Walk upstream for TEXT-shaped context (sources, chats, artifacts).
  // Image bytes come from body.references (preferred) — clients ship the
  // image dataUrls in their own field so the server doesn't have to dig
  // them out of `nodes`, which keeps the request body slim. Falling back
  // to ctx.sources for image dataUrls covers older clients.
  const ctx = walkContext(body.imageGenNodeId, body.nodes, body.edges);

  const referenceImages: { mimeType: string; data: string }[] = [];
  if (Array.isArray(body.references) && body.references.length > 0) {
    for (const r of body.references) {
      const parsed = parseDataUrl(r.dataUrl);
      if (parsed) referenceImages.push(parsed);
    }
  } else {
    for (const src of ctx.sources) {
      if (src.kind === 'image') {
        const img = src as ImageNodeData;
        if (img.dataUrl) {
          const parsed = parseDataUrl(img.dataUrl);
          if (parsed) referenceImages.push(parsed);
        }
      }
    }
  }

  // Build a single prompt string that folds in any text-shaped upstream
  // context. Keep it concise — image models care more about the image
  // request than long contextual essays.
  const contextSummary = summarizeUpstream(ctx, prompt);

  try {
    const ai = new GoogleGenAI({ apiKey });

    // gemini-2.5-flash-image (a.k.a. "nano banana") accepts text + reference
    // images via inlineData parts and returns image parts in the response.
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [];
    for (const ref of referenceImages) {
      parts.push({ inlineData: ref });
    }
    parts.push({ text: contextSummary });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts }],
    });

    // The response.candidates[0].content.parts contains image inlineData on
    // success. Pluck the first image part and ship it back as a data URL.
    const responseParts = response.candidates?.[0]?.content?.parts ?? [];
    let dataUrl: string | null = null;
    let textNote: string | null = null;
    for (const p of responseParts) {
      if ('inlineData' in p && p.inlineData?.data) {
        const mime = p.inlineData.mimeType ?? 'image/png';
        dataUrl = `data:${mime};base64,${p.inlineData.data}`;
        break;
      }
      if ('text' in p && p.text && !textNote) {
        textNote = p.text;
      }
    }

    if (!dataUrl) {
      const detail = textNote ? ` Model replied: "${textNote.slice(0, 200)}"` : '';
      return Response.json(
        { error: `Gemini returned no image.${detail}` },
        { status: 502 },
      );
    }

    return Response.json({
      dataUrl,
      mimeType: dataUrl.match(/^data:([^;]+);/)?.[1] ?? 'image/png',
      referenceCount: referenceImages.length,
      modelNote: textNote,
    });
  } catch (err) {
    return logAndFail('imagegen:gemini', err);
  }
};

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const m = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function summarizeUpstream(
  ctx: ReturnType<typeof walkContext>,
  userPrompt: string,
): string {
  const lines: string[] = [];
  lines.push(userPrompt);

  const textSources = ctx.sources.filter((s) => s.kind !== 'image');
  if (textSources.length > 0 || ctx.chats.length > 0 || ctx.artifacts.length > 0) {
    lines.push('');
    lines.push('--- additional context to inform the image ---');
  }
  for (const s of textSources) {
    if (s.status === 'ready' && s.content) {
      const title = s.title ? ` (${s.title})` : '';
      lines.push(`[${s.kind}${title}]: ${s.content.slice(0, 800)}`);
    }
  }
  for (const c of ctx.chats) {
    const last = c.messages?.[c.messages.length - 1];
    if (last) lines.push(`[recent chat]: ${last.content.slice(0, 600)}`);
  }
  for (const a of ctx.artifacts) {
    if (a.output) lines.push(`[prior artifact (${a.template})]: ${a.output.slice(0, 600)}`);
  }
  return lines.join('\n');
}

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
