import type { APIRoute } from 'astro';
import { GoogleGenAI } from '@google/genai';
import { walkContext } from '@/lib/ai/prompt';
import type { CanvasNode, CanvasEdge } from '@/lib/types';

export const prerender = false;

interface VideoGenRequest {
  videoGenNodeId: string;
  prompt: string;
  /** Starting frame as a base64 data URL (data:image/png;base64,...).
   *  When omitted, Veo runs in pure text-to-video mode. */
  startingImageDataUrl?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  durationSec?: 5 | 8;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * POST /api/generate/video
 *
 * Generates a video clip with Veo 3 via the Gemini API. Returns an SSE
 * stream:
 *   {type:'status', message, progress?}  – progress pings during the 1–3
 *                                          minute Veo job (Vercel proxy
 *                                          would otherwise close the
 *                                          connection on idle).
 *   {type:'done', videoBase64, mimeType} – on success.
 *   {type:'error', error}                – on failure.
 *
 * If the client passes `startingImageDataUrl`, that frame is the first
 * frame of the video. This is what enables image-to-video AND the
 * VideoGen-to-VideoGen extension chain (the client pre-extracts the last
 * frame of the upstream video and ships it as the starting image).
 *
 * Text-side context (sources, chats, prior artifacts) gets folded into
 * the prompt as guidance — same idea as ImageGen.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: VideoGenRequest;
  try {
    body = (await request.json()) as VideoGenRequest;
  } catch (err) {
    return logAndFail('videogen:parse', err);
  }

  const prompt = (body.prompt ?? '').trim();
  if (!prompt) {
    return Response.json({ error: 'Motion prompt is required.' }, { status: 400 });
  }

  const apiKey = import.meta.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY not set in env. Get one from aistudio.google.com.' },
      { status: 500 },
    );
  }

  const aspectRatio = body.aspectRatio ?? '16:9';
  const durationSec = body.durationSec ?? 8;

  // Veo model name. Default to Veo 2 (widely available); set VEO_MODEL in
  // env to use Veo 3 if your Gemini account has access. Common values:
  //   veo-2.0-generate-001       (default — broadly available)
  //   veo-3.0-generate-001       (preview availability)
  //   veo-3.0-fast-generate-001  (cheaper Veo 3)
  const veoModel = import.meta.env.VEO_MODEL || 'veo-2.0-generate-001';

  const ctx = walkContext(body.videoGenNodeId, body.nodes, body.edges);
  const fullPrompt = composePrompt(prompt, ctx);

  let startingImage: { imageBytes: string; mimeType: string } | undefined;
  if (body.startingImageDataUrl) {
    const parsed = parseDataUrl(body.startingImageDataUrl);
    if (parsed) startingImage = { imageBytes: parsed.data, mimeType: parsed.mimeType };
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const ai = new GoogleGenAI({ apiKey });

        send({ type: 'status', message: 'Starting Veo job…' });

        let operation = await ai.models.generateVideos({
          model: veoModel,
          prompt: fullPrompt,
          ...(startingImage ? { image: startingImage } : {}),
          config: {
            numberOfVideos: 1,
            aspectRatio,
            durationSeconds: durationSec,
            personGeneration: 'allow_all',
          },
        });

        // Poll. Veo typically finishes in 1–3 minutes for 8s clips. We
        // ping the client every 10s so the SSE connection stays warm and
        // the user sees progress.
        const startedAt = Date.now();
        let pollCount = 0;
        while (!operation.done) {
          await sleep(10_000);
          pollCount += 1;
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          send({
            type: 'status',
            message: `Generating video… (${elapsed}s elapsed)`,
            elapsedSec: elapsed,
            poll: pollCount,
          });
          operation = await ai.operations.getVideosOperation({ operation });
        }

        const generated = operation.response?.generatedVideos?.[0];
        if (!generated?.video) {
          send({
            type: 'error',
            error:
              operation.error?.message ??
              'Veo finished without producing a video. Try a different prompt or starting frame.',
          });
          controller.close();
          return;
        }

        send({ type: 'status', message: 'Downloading video…' });

        // Veo returns a Google Cloud Storage URI requiring API-key auth.
        // Fetch the bytes server-side, base64-encode, ship over SSE.
        const videoUri = generated.video.uri;
        if (!videoUri) {
          send({ type: 'error', error: 'Veo returned a video with no URI.' });
          controller.close();
          return;
        }
        const sep = videoUri.includes('?') ? '&' : '?';
        const downloadUrl = `${videoUri}${sep}key=${apiKey}`;
        const dl = await fetch(downloadUrl);
        if (!dl.ok) {
          send({
            type: 'error',
            error: `Could not download Veo result (${dl.status}). The video URI may have expired.`,
          });
          controller.close();
          return;
        }
        const arrayBuf = await dl.arrayBuffer();
        const base64 = Buffer.from(arrayBuf).toString('base64');
        const mimeType = generated.video.mimeType ?? dl.headers.get('content-type') ?? 'video/mp4';

        send({
          type: 'done',
          videoBase64: base64,
          mimeType,
          sizeBytes: arrayBuf.byteLength,
        });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error('[videogen:stream] failed:', e.message, '\n', e.stack);
        send({ type: 'error', error: e.message });
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

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const m = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function composePrompt(userPrompt: string, ctx: ReturnType<typeof walkContext>): string {
  const lines: string[] = [];
  lines.push(userPrompt);

  // Pull voiceover/dialogue out of any upstream artifact whose template is
  // a script — Veo 3 reads the prompt verbatim for spoken lines.
  const scriptArtifact = ctx.artifacts.find(
    (a) => a.template?.includes('script') || a.template?.includes('email') || a.template === 'tweet-thread',
  );
  if (scriptArtifact?.output) {
    lines.push('');
    lines.push('--- script the character should deliver (use the spoken/voiceover lines verbatim) ---');
    // Include up to ~4000 chars; longer scripts overflow Veo's prompt budget.
    lines.push(scriptArtifact.output.slice(0, 4000));
  }

  // Other text-shaped context (sources, non-script artifacts) goes in as
  // scene/setting guidance, lighter weight.
  const textSources = ctx.sources.filter((s) => s.kind !== 'image');
  const otherArtifacts = ctx.artifacts.filter((a) => a !== scriptArtifact);
  if (textSources.length > 0 || otherArtifacts.length > 0) {
    lines.push('');
    lines.push('--- additional context to inform the motion / scene ---');
  }
  for (const s of textSources) {
    if (s.status === 'ready' && s.content) {
      lines.push(`[${s.kind}]: ${s.content.slice(0, 600)}`);
    }
  }
  for (const a of otherArtifacts) {
    if (a.output) lines.push(`[prior artifact (${a.template})]: ${a.output.slice(0, 800)}`);
  }
  return lines.join('\n');
}

function logAndFail(scope: string, err: unknown): Response {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${scope}] handler failed:`, e.message, '\n', e.stack);
  return Response.json({ error: e.message, scope }, { status: 500 });
}
