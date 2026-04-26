import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStore, type NodeProps } from '@xyflow/react';
import { NodeShell } from './NodeShell';
import { slimNodesForApi } from '@/lib/slimPayload';
import { useCanvasId } from '../canvas/canvasIdContext';
import {
  NODE_WIDTH,
  type ImageGenNodeData,
  type ImageNodeData,
  type VeoVideoRef,
  type VideoGenNodeData,
} from '@/lib/types';

/** Veo's Files API holds source clips for ~2 days. We treat anything
 *  older as expired and fall back to last-frame image-to-video so the
 *  user never sees a hard "ref not found" error from Veo. The buffer
 *  (40h instead of 48h) gives the actual call a margin to complete
 *  before Veo's GC hits the source. */
const VEO_REF_TTL_MS = 40 * 60 * 60 * 1000;

function isVeoRefFresh(ref: VeoVideoRef | undefined): ref is VeoVideoRef {
  if (!ref?.uri || !ref.createdAt) return false;
  const age = Date.now() - new Date(ref.createdAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < VEO_REF_TTL_MS;
}

const ASPECT_OPTIONS: ('16:9' | '9:16' | '1:1')[] = ['16:9', '9:16', '1:1'];
const DURATIONS: (5 | 8)[] = [5, 8];

/**
 * Picks a starting frame for Veo from the closest upstream source:
 *   1) closest connected VideoGen with a fresh Veo ref → native extend
 *      (Flow's motion-continuous chain — preserves motion vectors)
 *   2) closest connected VideoGen with an aged-out ref → last-frame
 *      image-to-video fallback (works forever, but motion resets)
 *   3) closest connected ImageGen → its outputDataUrl
 *   4) closest connected Image source → its dataUrl
 *   5) nothing → text-to-video
 *
 * "Closest" walks the upstream graph layer by layer and returns the first
 * layer that yields any usable frame; further-upstream items still appear
 * in the upstream context panel for guidance.
 */
type StartingFrameSource =
  | { kind: 'image'; dataUrl: string; label: string }
  | { kind: 'image-gen'; dataUrl: string; label: string }
  | { kind: 'video-gen'; videoUrl: string; label: string }
  | { kind: 'video-gen-extend'; veoRef: VeoVideoRef; videoUrl: string; label: string }
  | null;

export function VideoGenNode({ id, data, selected }: NodeProps) {
  const d = data as VideoGenNodeData;
  const flow = useReactFlow();
  const canvasId = useCanvasId();
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const prompt = d.prompt ?? '';
  const aspectRatio: '16:9' | '9:16' | '1:1' = (d as { aspectRatio?: '16:9' | '9:16' | '1:1' }).aspectRatio ?? '16:9';
  const durationSec = d.durationSec ?? 8;
  const outputUrl = d.outputUrl;
  const storagePath = d.storagePath;

  const startingFrame = useStore((s) => pickStartingFrame(id, s.nodes, s.edges));

  // Refresh the playback URL on mount when we have a storagePath but no
  // playable URL — handles canvases re-opened after the persisted signed
  // URL expired. Also recovers when a stale URL is present but Veo's
  // 4xx-prone CDN starts rejecting it.
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!storagePath) return;
    if (refreshedFor.current === storagePath) return;
    if (outputUrl && outputUrl.startsWith('http')) return;
    refreshedFor.current = storagePath;
    (async () => {
      try {
        const res = await fetch('/api/videos/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        });
        if (!res.ok) throw new Error(`sign failed (${res.status})`);
        const { url } = (await res.json()) as { url: string };
        flow.updateNodeData(id, { ...d, outputUrl: url });
      } catch (err) {
        console.error('[VideoGenNode] could not refresh signed URL:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePath]);

  const setPrompt = (text: string) => flow.updateNodeData(id, { ...d, prompt: text });
  const setAspect = (a: '16:9' | '9:16' | '1:1') =>
    flow.updateNodeData(id, { ...d, aspectRatio: a });
  const setDuration = (n: 5 | 8) => flow.updateNodeData(id, { ...d, durationSec: n });

  const runGeneration = async (
    args:
      | { kind: 'extend'; veoRef: VeoVideoRef }
      | { kind: 'image'; startingImageDataUrl?: string },
  ): Promise<{
    outputUrl: string;
    storagePath: string;
    veoVideoRef: VeoVideoRef | null;
  }> => {
    const requestBody: Record<string, unknown> = {
      videoGenNodeId: id,
      prompt: prompt.trim(),
      aspectRatio,
      durationSec,
      canvasId,
      // Slim before shipping — without this the upstream ImageGen
      // output (~1–2MB base64) plus other media fields blow past
      // Vercel's 4.5MB request body limit. The starting image
      // rides separately above so we don't need it inside `nodes`.
      nodes: slimNodesForApi(flow.getNodes()),
      edges: flow.getEdges(),
    };
    if (args.kind === 'extend') {
      requestBody.extendFromVeoRef = { uri: args.veoRef.uri, mimeType: args.veoRef.mimeType };
    } else if (args.startingImageDataUrl) {
      requestBody.startingImageDataUrl = args.startingImageDataUrl;
    }

    const res = await fetch('/api/generate/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const raw = await res.text();
      let msg = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && 'error' in parsed) msg = String((parsed as { error: unknown }).error);
      } catch {
        /* not JSON */
      }
      throw new Error(msg || `video-gen failed (${res.status})`);
    }
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let resultUrl: string | null = null;
    let resultStoragePath: string | null = null;
    let resultVeoRef: VeoVideoRef | null = null;

    streamLoop: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.replace(/^data:\s*/, '').trim();
        if (!line) continue;
        let event:
          | {
              type: string;
              message?: string;
              error?: string;
              outputUrl?: string;
              storagePath?: string;
              veoVideoRef?: VeoVideoRef | null;
            }
          | null = null;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (!event) continue;
        if (event.type === 'status' && event.message) {
          setStatusMsg(event.message);
        } else if (event.type === 'done' && event.outputUrl && event.storagePath) {
          resultUrl = event.outputUrl;
          resultStoragePath = event.storagePath;
          resultVeoRef = event.veoVideoRef ?? null;
          break streamLoop;
        } else if (event.type === 'error') {
          throw new Error(event.error ?? 'Stream error');
        }
      }
    }

    if (!resultUrl || !resultStoragePath) {
      throw new Error('Video stream ended without a result.');
    }
    return { outputUrl: resultUrl, storagePath: resultStoragePath, veoVideoRef: resultVeoRef };
  };

  /** Veo returns vague messages when the source video reference is gone:
   *  matches "not found", "expired", "FAILED_PRECONDITION", or "video"
   *  alongside a 4xx hint. We use this to decide when to silently fall
   *  back to last-frame instead of failing the whole generation. */
  const looksLikeExtendSourceFailure = (msg: string): boolean => {
    const m = msg.toLowerCase();
    return (
      m.includes('not found') ||
      m.includes('expired') ||
      m.includes('failed_precondition') ||
      m.includes('invalid_argument') ||
      m.includes('permission') ||
      m.includes('unsupported')
    );
  };

  const generate = async () => {
    if (isGenerating) return;
    if (!prompt.trim()) {
      setError('Type a motion prompt first.');
      return;
    }
    setIsGenerating(true);
    setError(undefined);
    setStatusMsg('Preparing…');
    flow.updateNodeData(id, { ...d, isGenerating: true, status: 'pending' });

    try {
      let result: Awaited<ReturnType<typeof runGeneration>> | null = null;

      if (startingFrame?.kind === 'video-gen-extend') {
        // Native Veo extension — preserves motion. If Veo rejects the
        // source (TTL elapsed, ref invalid), drop down to last-frame
        // image-to-video so the user still gets a clip.
        try {
          setStatusMsg('Asking Veo to extend the prior clip…');
          result = await runGeneration({ kind: 'extend', veoRef: startingFrame.veoRef });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (looksLikeExtendSourceFailure(msg)) {
            console.warn('[VideoGenNode] extend failed, falling back to last-frame:', msg);
            setStatusMsg('Veo source expired — falling back to last frame…');
            const startingImageDataUrl = await extractLastFrame(startingFrame.videoUrl);
            result = await runGeneration({ kind: 'image', startingImageDataUrl });
          } else {
            throw err;
          }
        }
      } else {
        let startingImageDataUrl: string | undefined;
        if (startingFrame?.kind === 'image' || startingFrame?.kind === 'image-gen') {
          startingImageDataUrl = startingFrame.dataUrl;
        } else if (startingFrame?.kind === 'video-gen') {
          setStatusMsg('Extracting last frame from upstream video…');
          startingImageDataUrl = await extractLastFrame(startingFrame.videoUrl);
        }
        result = await runGeneration({ kind: 'image', startingImageDataUrl });
      }

      // Store the storage path (durable identity), signed playback URL,
      // and the Veo Files reference so a *downstream* VideoGen can
      // extend this clip natively.
      flow.updateNodeData(id, {
        ...d,
        outputUrl: result.outputUrl,
        storagePath: result.storagePath,
        veoVideoRef: result.veoVideoRef ?? undefined,
        isGenerating: false,
        status: 'ready',
      });
      setStatusMsg(null);
      setIsGenerating(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[VideoGenNode] generate failed:', err);
      flow.updateNodeData(id, { ...d, isGenerating: false, status: 'error', error: msg });
      setError(msg);
      setStatusMsg(null);
      setIsGenerating(false);
    }
  };

  const downloadOutput = () => {
    if (!outputUrl) return;
    const a = document.createElement('a');
    a.href = outputUrl;
    a.download = `videogen-${Date.now()}.mp4`;
    a.click();
  };

  const status = isGenerating ? 'pending' : outputUrl ? 'ready' : 'idle';

  return (
    <NodeShell
      id={id}
      selected={!!selected}
      width={NODE_WIDTH['video-gen']}
      inputHandle
      outputHandle
      status={status}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="node-label" style={{ color: '#ff66e0' }}>▷ video gen</span>
        <span className={`node-label ${isGenerating ? 'text-ember' : outputUrl ? 'text-moss' : 'text-bone-400'}`}>
          {isGenerating ? 'rendering…' : status}
        </span>
      </div>

      <div className="border-y border-ink-600 py-2 mb-2 -mx-1 px-1 text-[11px] font-mono">
        <div className="node-label opacity-60 mb-1">
          {startingFrame?.kind === 'video-gen-extend' ? 'extending' : 'starting frame'}
        </div>
        {startingFrame === null ? (
          <div className="text-bone-400">none — text-to-video</div>
        ) : (
          <div className="flex items-center gap-2">
            {(startingFrame.kind === 'image' || startingFrame.kind === 'image-gen') && (
              <img
                src={startingFrame.dataUrl}
                alt=""
                className="w-12 h-12 object-cover rounded-md bg-ink-900 border border-ink-600"
              />
            )}
            {startingFrame.kind === 'video-gen-extend' && (
              <span className="text-ember">▶ continuing prior motion</span>
            )}
            {startingFrame.kind === 'video-gen' && (
              <span className="text-bone-300">last frame of upstream video</span>
            )}
            <span className="text-bone-300 truncate flex-1">{startingFrame.label}</span>
          </div>
        )}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={isGenerating}
        placeholder="Describe the motion (e.g. slow dolly-in, camera pans left, subject turns toward camera)…"
        rows={3}
        className="nodrag w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-md resize-y mb-2"
      />

      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="node-label opacity-60 mr-1">aspect</span>
        {ASPECT_OPTIONS.map((a) => (
          <button
            key={a}
            onClick={() => setAspect(a)}
            disabled={isGenerating}
            className={`pill-btn text-[10px] py-1 px-2 ${a === aspectRatio ? 'border-ember text-ember' : ''}`}
            style={a === aspectRatio ? { boxShadow: '0 0 8px -2px rgba(0,229,255,0.5)' } : undefined}
          >
            {a}
          </button>
        ))}
        <span className="node-label opacity-60 mx-1 ml-2">duration</span>
        {DURATIONS.map((n) => (
          <button
            key={n}
            onClick={() => setDuration(n)}
            disabled={isGenerating}
            className={`pill-btn text-[10px] py-1 px-2 ${n === durationSec ? 'border-ember text-ember' : ''}`}
            style={n === durationSec ? { boxShadow: '0 0 8px -2px rgba(0,229,255,0.5)' } : undefined}
          >
            {n}s
          </button>
        ))}
      </div>

      <button
        onClick={generate}
        disabled={isGenerating || !prompt.trim()}
        className="pill-btn-primary w-full mb-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isGenerating ? statusMsg ?? 'rendering…' : outputUrl ? 'regenerate' : 'generate'}
      </button>

      {isGenerating && statusMsg && (
        <div className="text-[10px] font-mono text-bone-300 mb-2 text-center animate-pulse-glow">
          {statusMsg}
        </div>
      )}

      {error && (
        <div className="border border-red-500/40 bg-red-500/5 px-2 py-1.5 mb-2 text-[11px] font-sans text-red-300 rounded-sm flex items-start gap-2">
          <div className="flex-1 leading-snug">
            <div className="node-label text-red-400 mb-0.5">video gen error</div>
            {error}
          </div>
          <button onClick={() => setError(undefined)} className="text-red-300 hover:text-red-100 font-mono text-xs leading-none">
            ×
          </button>
        </div>
      )}

      {outputUrl && (
        <div className="border-t border-ink-600 pt-2">
          <video
            src={outputUrl}
            controls
            playsInline
            loop
            className="w-full rounded-md bg-ink-900 mb-2"
          />
          <button onClick={downloadOutput} className="pill-btn text-[10px] w-full">
            download .mp4
          </button>
          <p className="mt-1.5 text-[10px] font-mono text-bone-400 leading-snug">
            connect this node's right ● into another video-gen node to extend the sequence — Veo continues this clip's motion (≈ 7s per hop, up to 148s). Older than ~2 days falls back to last-frame.
          </p>
        </div>
      )}

      {!outputUrl && !isGenerating && (
        <p className="mt-1 text-[10px] font-mono text-bone-400 leading-snug">
          using <span className="text-ember">veo-3.1-generate-preview</span> (default — supports lip-sync, audio, native chain extension). Override with <span className="text-ember">VEO_MODEL</span> in Vercel env.
        </p>
      )}
    </NodeShell>
  );
}

/**
 * Look at upstream nodes (BFS, transitive — not just hop=1) and pick the
 * closest usable starting frame.
 *
 * Walking transitively means a chain like
 *   [Image source] → [Chat] → [Artifact] → [VideoGen]
 * still finds the image even though there are two non-image nodes in
 * between. Without this you'd have to manually wire the image directly
 * into the VideoGen, which defeats the point of chaining.
 *
 * Crucially the walk is *layer by layer*: as soon as one hop level yields
 * any usable frame, we stop. Otherwise a chain like
 *   [ImageGen] → [VideoGen1] → [VideoGen2]
 * would prefer the original ImageGen (2 hops, but high kind-priority) over
 * VideoGen1's last frame (1 hop) and break VideoGen→VideoGen extension.
 *
 * Within a single layer, when multiple kinds tie, prefer VideoGen so a
 * directly-wired upstream video drives extension, with ImageGen and Image
 * as fallbacks for fresh starts.
 */
function pickStartingFrame(
  consumerId: string,
  nodes: { id: string; data: { kind?: string } & Record<string, unknown> }[],
  edges: { source: string; target: string }[],
): StartingFrameSource {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>([consumerId]);
  let layer: string[] = [consumerId];

  while (layer.length > 0) {
    const nextLayer: string[] = [];
    const imageGenHits: { dataUrl: string; label: string }[] = [];
    const imageHits: { dataUrl: string; label: string }[] = [];
    const videoExtendHits: { veoRef: VeoVideoRef; videoUrl: string; label: string }[] = [];
    const videoFallbackHits: { videoUrl: string; label: string }[] = [];

    for (const cur of layer) {
      for (const e of edges) {
        if (e.target !== cur || visited.has(e.source)) continue;
        visited.add(e.source);
        nextLayer.push(e.source);
        const node = nodeById.get(e.source);
        if (!node) continue;
        const k = node.data?.kind;
        if (k === 'image-gen') {
          const ig = node.data as unknown as ImageGenNodeData;
          if (ig.outputDataUrl) {
            imageGenHits.push({ dataUrl: ig.outputDataUrl, label: 'generated image' });
          }
        } else if (k === 'image') {
          const im = node.data as unknown as ImageNodeData;
          if (im.dataUrl) {
            imageHits.push({
              dataUrl: im.dataUrl,
              label: im.title ?? im.filename ?? 'image source',
            });
          }
        } else if (k === 'video-gen') {
          const vg = node.data as unknown as VideoGenNodeData;
          if (vg.outputUrl) {
            if (isVeoRefFresh(vg.veoVideoRef)) {
              videoExtendHits.push({
                veoRef: vg.veoVideoRef,
                videoUrl: vg.outputUrl,
                label: 'extending prior clip',
              });
            } else {
              videoFallbackHits.push({
                videoUrl: vg.outputUrl,
                label: 'upstream video (last frame)',
              });
            }
          }
        }
      }
    }

    // Within a layer, native extension wins over last-frame fallback so
    // chained VideoGens get motion continuity when the Veo source is
    // still alive. Both still beat ImageGen/Image as before.
    if (videoExtendHits.length > 0) return { kind: 'video-gen-extend', ...videoExtendHits[0] };
    if (videoFallbackHits.length > 0) return { kind: 'video-gen', ...videoFallbackHits[0] };
    if (imageGenHits.length > 0) return { kind: 'image-gen', ...imageGenHits[0] };
    if (imageHits.length > 0) return { kind: 'image', ...imageHits[0] };

    layer = nextLayer;
  }

  return null;
}

/**
 * Seek a video to its last frame, draw to a canvas, return a PNG data URL.
 * Used when chaining VideoGen → VideoGen so the next clip starts where the
 * previous one ended (the same trick Google Flow uses for video extension).
 */
async function extractLastFrame(videoSrc: string): Promise<string> {
  const video = document.createElement('video');
  video.src = videoSrc;
  video.muted = true;
  video.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Could not load upstream video for frame extraction.'));
  });

  // Seek to just before the end. Some browsers won't decode exactly at
  // duration, so subtract a small epsilon.
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve();
    video.onerror = () => reject(new Error('Seek failed during frame extraction.'));
    video.currentTime = Math.max(0, video.duration - 0.05);
  });

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
