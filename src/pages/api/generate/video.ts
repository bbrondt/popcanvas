import type { APIRoute } from 'astro';
import { GoogleGenAI } from '@google/genai';
import { walkContext } from '@/lib/ai/prompt';
import { getServiceClient } from '@/lib/supabase/server';
import { signVideoUrl, VIDEO_BUCKET } from '@/lib/videoStorage';
import type { CanvasNode, CanvasEdge } from '@/lib/types';

export const prerender = false;

interface VideoGenRequest {
  videoGenNodeId: string;
  prompt: string;
  /** Starting frame as a base64 data URL (data:image/png;base64,...).
   *  Mutually exclusive with extendFromVeoRef. */
  startingImageDataUrl?: string;
  /** Veo Files API reference for native video extension. When set, Veo
   *  continues the prior clip's motion (this is what Google Flow does)
   *  instead of starting fresh from a still frame. Mutually exclusive
   *  with startingImageDataUrl. */
  extendFromVeoRef?: { uri: string; mimeType: string };
  aspectRatio?: '16:9' | '9:16' | '1:1';
  durationSec?: 5 | 8;
  /** Used to scope the storage path so videos can be cleaned up alongside
   *  the canvas they belong to. */
  canvasId?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** Native extension is a Veo 3.1+ capability. If the env points at an
 *  older model and the client asks to extend, we transparently bump to
 *  3.1 so the call doesn't 4xx. Single-shot generations honor whatever
 *  the env says. */
const VEO_EXTEND_MODEL = 'veo-3.1-generate-preview';

/** Shapes the Gemini predictLongRunning REST endpoint returns. The
 *  @google/genai SDK reshapes these into its own object hierarchy, but
 *  for extension calls we go to REST directly so we own the wire
 *  format — see the comment at the call site. */
interface RawVeoVideo {
  uri?: string;
  mimeType?: string;
  encoding?: string;
}
interface RawVeoSample {
  video?: RawVeoVideo;
}
interface RawVeoGenerateVideoResponse {
  generatedSamples?: RawVeoSample[];
  raiMediaFilteredCount?: number;
  raiMediaFilteredReasons?: string[];
}
interface RawVeoOperationResponse {
  generateVideoResponse?: RawVeoGenerateVideoResponse;
}
interface RawVeoOperationPoll {
  name?: string;
  done?: boolean;
  response?: RawVeoOperationResponse;
  error?: { code?: number; message?: string; status?: string };
}

/**
 * POST /api/generate/video
 *
 * Generates a video clip with Veo via the Gemini API. Returns an SSE
 * stream:
 *   {type:'status', message}                                – progress pings
 *   {type:'done', outputUrl, storagePath, veoVideoRef, ...} – on success.
 *   {type:'error', error}                                   – on failure.
 *
 * Three input modes (mutually exclusive):
 *   - `extendFromVeoRef`     → Veo extends the prior clip natively. Best
 *                              continuity; only works on Veo 3.1+ and only
 *                              for source clips < ~2 days old.
 *   - `startingImageDataUrl` → image-to-video (also the fallback when a
 *                              source clip aged past Veo's TTL).
 *   - neither                → text-to-video.
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
  const isExtension = !!body.extendFromVeoRef?.uri;

  // Veo model name. Default to Veo 3.1 preview because that's what
  // unlocks native video extension (the `video:` parameter — Flow's
  // motion-continuous chain). Override with VEO_MODEL in env for older
  // models or Veo 3 Fast. Extension calls always force 3.1+ regardless,
  // because older Veos reject the `video:` parameter outright.
  //   veo-3.1-generate-preview        (default — supports extension + audio)
  //   veo-3.1-fast-generate-preview   (cheaper)
  //   veo-3.0-generate-001            (audio, no extension)
  //   veo-2.0-generate-001            (silent, no extension)
  const envModel = import.meta.env.VEO_MODEL;
  const veoModel = isExtension ? VEO_EXTEND_MODEL : envModel || VEO_EXTEND_MODEL;

  const ctx = walkContext(body.videoGenNodeId, body.nodes, body.edges);
  const fullPrompt = composePrompt(prompt, ctx);

  let startingImage: { imageBytes: string; mimeType: string } | undefined;
  if (!isExtension && body.startingImageDataUrl) {
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

        send({
          type: 'status',
          message: isExtension ? 'Extending prior clip with Veo…' : 'Starting Veo job…',
        });

        // Two completely separate paths because the @google/genai SDK
        // (v1.50.1) silently serializes Video.mimeType as `encoding` in
        // the request body, which Veo 3.1's extension endpoint rejects
        // with INVALID_ARGUMENT. Even passing only `uri` to the SDK
        // appears unreliable across SDK versions, so for extensions we
        // bypass the SDK entirely and go straight to the REST endpoint
        // — full control over the wire format. Image-to-video and
        // text-to-video stay on the SDK because that path works fine.
        let sdkOperation: Awaited<ReturnType<typeof ai.models.generateVideos>> | null = null;
        let rawOperationName: string | null = null;
        let rawOperationDone = false;
        let rawOperationResponse: RawVeoOperationResponse | null = null;
        let rawOperationError: { code?: number; message?: string; status?: string } | null = null;

        if (isExtension) {
          const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${veoModel}:predictLongRunning?key=${apiKey}`;
          // Send the bare minimum. Veo's extension endpoint inherits
          // aspect ratio and personGeneration from the source clip,
          // and rejects them when re-passed:
          //   "allow_adult for personGeneration is currently not supported."
          //   "`encoding` isn't supported by this model."
          // The SDK's image-to-video path accepts both fields fine, so
          // the extension endpoint surface is meaningfully narrower.
          //
          // Resolution does need to be set explicitly though — extension
          // defaults to 720p which produces a visible quality drop
          // against a 1080p source. 1080p is the published cap.
          //
          // URI normalization: Veo's response gives us a download URL
          // like `https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media`.
          // For extension input, several reports suggest the API wants
          // the bare resource path (`files/abc`) — passing the download
          // URL is accepted (the call returns 200 and Veo even runs
          // safety checks against the source) but the model may quietly
          // ignore it as an extension seed and just generate from
          // prompt, producing a "fresh-feeling" clip. Strip to the
          // resource path so Veo treats it as a true extension source.
          const sourceUri = normalizeVeoFileUri(body.extendFromVeoRef!.uri);
          console.info('[videogen:extend] sourceUri (normalized) =', sourceUri, 'original =', body.extendFromVeoRef!.uri);
          const startBody = {
            instances: [
              {
                prompt: fullPrompt,
                video: { uri: sourceUri },
              },
            ],
            parameters: {
              sampleCount: 1,
              resolution: '1080p',
              // Stop Veo from silently rewriting the prompt to "more
              // cinematic" language. This auto-enhance is the main
              // cause of style/quality variance between successive
              // regenerations of the same call.
              enhancePrompt: false,
            },
          };
          console.info('[videogen:extend] POST', startUrl.replace(apiKey, '***'), 'body =', JSON.stringify(startBody));
          const startRes = await fetch(startUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(startBody),
          });
          const startText = await startRes.text();
          console.info('[videogen:extend] start response status', startRes.status, 'body =', startText);
          if (!startRes.ok) {
            throw new Error(startText || `Veo extension start failed (${startRes.status})`);
          }
          const startJson = JSON.parse(startText) as { name?: string };
          if (!startJson.name) {
            throw new Error('Veo extension started but returned no operation name.');
          }
          rawOperationName = startJson.name;
        } else {
          // Native extension passes the prior Veo Video reference; image
          // and video are mutually exclusive in the SDK. Extension calls
          // also can't set durationSeconds — Veo dictates the 7s hop size.
          sdkOperation = await ai.models.generateVideos({
            model: veoModel,
            prompt: fullPrompt,
            ...(startingImage ? { image: startingImage } : {}),
            config: {
              numberOfVideos: 1,
              aspectRatio,
              durationSeconds: durationSec,
              // 'allow_all' is region/account-restricted and returns a 400 in
              // most setups; 'allow_adult' is the broadly-supported value that
              // still permits people in frame.
              personGeneration: 'allow_adult',
            },
          });
        }

        // Poll. Veo typically finishes in 1–3 minutes for 8s clips. We
        // ping the client every 10s so the SSE connection stays warm and
        // the user sees progress.
        const startedAt = Date.now();
        let pollCount = 0;
        const isDone = () => (sdkOperation ? !!sdkOperation.done : rawOperationDone);
        while (!isDone()) {
          await sleep(10_000);
          pollCount += 1;
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          send({
            type: 'status',
            message: `Generating video… (${elapsed}s elapsed)`,
            elapsedSec: elapsed,
            poll: pollCount,
          });
          if (sdkOperation) {
            sdkOperation = await ai.operations.getVideosOperation({ operation: sdkOperation });
          } else if (rawOperationName) {
            const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${rawOperationName}?key=${apiKey}`;
            const pollRes = await fetch(pollUrl);
            const pollText = await pollRes.text();
            if (!pollRes.ok) {
              throw new Error(pollText || `Veo extension poll failed (${pollRes.status})`);
            }
            const pollJson = JSON.parse(pollText) as RawVeoOperationPoll;
            rawOperationDone = !!pollJson.done;
            rawOperationResponse = pollJson.response ?? null;
            rawOperationError = pollJson.error ?? null;
          }
        }

        // Normalize the result so the rest of the pipeline (download +
        // Supabase upload) doesn't need to know which path produced it.
        let generated: { video?: { uri?: string; mimeType?: string } } | undefined;
        let opError: { message?: string } | undefined;
        let raiReasons: string[] = [];
        let raiCount = 0;
        if (sdkOperation) {
          generated = sdkOperation.response?.generatedVideos?.[0];
          opError =
            typeof sdkOperation.error?.message === 'string'
              ? { message: sdkOperation.error.message }
              : undefined;
          raiReasons = sdkOperation.response?.raiMediaFilteredReasons ?? [];
          raiCount = sdkOperation.response?.raiMediaFilteredCount ?? 0;
        } else {
          const sample = rawOperationResponse?.generateVideoResponse?.generatedSamples?.[0];
          generated = sample ? { video: sample.video } : undefined;
          opError = rawOperationError?.message ? { message: rawOperationError.message } : undefined;
          raiReasons = rawOperationResponse?.generateVideoResponse?.raiMediaFilteredReasons ?? [];
          raiCount = rawOperationResponse?.generateVideoResponse?.raiMediaFilteredCount ?? 0;
        }
        if (!generated?.video) {
          // Vague catch-all hides the most common real causes. We
          // already pulled raiReasons / raiCount / opError above so the
          // SDK and raw paths share the same diagnostics. Log the whole
          // response so we can inspect the rest in Vercel.
          console.error(
            '[videogen] empty result.',
            'sdkResponse =',
            JSON.stringify(sdkOperation?.response ?? {}),
            'rawResponse =',
            JSON.stringify(rawOperationResponse ?? {}),
            'opError =',
            opError,
          );

          let detail: string;
          const opErrMsg = opError?.message ?? '';
          const reasonsBlob = raiReasons.join('; ').toLowerCase();
          // Veo's celebrity-likeness classifier false-positives constantly
          // on AI-generated portraits (the training set is celebrity-heavy
          // so nearly any human-like face triggers it). Surface that as a
          // distinct, actionable case — and tag it with "no-fallback:" so
          // the client doesn't waste a second call on the same face.
          const isCelebrityFilter =
            reasonsBlob.includes('celebrity') || reasonsBlob.includes('likeness');
          if (opErrMsg) {
            detail = opErrMsg;
          } else if (isCelebrityFilter) {
            detail =
              "no-fallback: Veo's celebrity-likeness filter blocked the output. " +
              "This is a common false positive on AI-generated faces — your " +
              "subject doesn't have to actually be a celebrity to trip it. " +
              'Regenerate the upstream image with explicit "fictional original ' +
              "character\" wording, switch the image-gen model (toggle on the " +
              'ImageGen node), or vary the face (different hair/age/features).';
          } else if (raiReasons.length > 0) {
            detail = `Veo's safety filter blocked the output (${raiReasons.join('; ')}). Try a less brand-named / charged prompt.`;
          } else if (raiCount > 0) {
            detail = `Veo's safety filter blocked ${raiCount} candidate${raiCount === 1 ? '' : 's'}. Try a different prompt.`;
          } else if (isExtension) {
            // The extension path has its own foot-gun: source video must
            // be Veo 3.1+ output. Make that explicit so the client can
            // fall back to last-frame instead of just showing red text.
            detail = 'veo-empty: extension produced no video. The source clip may have been generated with an older Veo (only 3.1+ sources can be extended), or Veo silently dropped the output. Falling back to last-frame is recommended.';
          } else {
            detail = 'Veo finished without producing a video. Try a different prompt or starting frame.';
          }

          send({ type: 'error', error: detail });
          controller.close();
          return;
        }

        send({ type: 'status', message: 'Downloading video…' });

        // Veo returns a Google Cloud Storage URI requiring API-key auth.
        // Fetch the bytes server-side, then upload to Supabase Storage so
        // the canvas only carries a tiny URL (a Veo clip easily exceeds
        // Vercel's 4.5MB request body cap if shipped inline as base64,
        // which silently breaks canvas autosave and loses videos on
        // refresh).
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
        const mimeType = generated.video.mimeType ?? dl.headers.get('content-type') ?? 'video/mp4';
        const ext = mimeType.split('/')[1]?.split(';')[0] || 'mp4';

        send({ type: 'status', message: 'Uploading to storage…' });

        // Path scoped per canvas (when known) so cleanup can wipe a whole
        // canvas's videos with a single prefix delete. videoGenNodeId +
        // timestamp keep regenerations distinct (we don't overwrite, so a
        // user re-generating still has the prior file until manual GC).
        const scope = body.canvasId ? `canvases/${body.canvasId}` : 'unscoped';
        const storagePath = `videos/${scope}/${body.videoGenNodeId}-${Date.now()}.${ext}`;

        const supabase = getServiceClient();
        const { error: uploadErr } = await supabase.storage
          .from(VIDEO_BUCKET)
          .upload(storagePath, new Uint8Array(arrayBuf), {
            contentType: mimeType,
            cacheControl: '31536000',
            upsert: false,
          });
        if (uploadErr) {
          send({ type: 'error', error: `Storage upload failed: ${uploadErr.message}` });
          controller.close();
          return;
        }

        const signedUrl = await signVideoUrl(supabase, storagePath);

        // Capture the Veo Files API reference so a downstream VideoGen
        // can extend this clip natively. videoUri is the URI we just used
        // to download — it is the same URI Veo accepts back as the
        // `video:` extension input within Veo's ~2-day TTL.
        const veoVideoRef = videoUri
          ? {
              uri: videoUri,
              mimeType: generated.video.mimeType ?? 'video/mp4',
              createdAt: new Date().toISOString(),
            }
          : null;

        send({
          type: 'done',
          outputUrl: signedUrl,
          storagePath,
          mimeType,
          sizeBytes: arrayBuf.byteLength,
          veoVideoRef,
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

/**
 * Convert any Veo file URI form into the bare resource path the
 * extension endpoint actually wants:
 *   https://...googleapis.com/v1beta/files/abc:download?alt=media → files/abc
 *   https://...googleapis.com/v1beta/files/abc                  → files/abc
 *   files/abc                                                    → files/abc
 *   abc                                                          → files/abc
 */
function normalizeVeoFileUri(uri: string): string {
  if (!uri) return uri;
  // Pull the segment after "files/" up to the first non-id char.
  const m = uri.match(/files\/([A-Za-z0-9_-]+)/);
  if (m) return `files/${m[1]}`;
  // No "files/" prefix at all — assume the whole thing is the id.
  if (/^[A-Za-z0-9_-]+$/.test(uri)) return `files/${uri}`;
  return uri;
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
