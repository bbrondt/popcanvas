import { useState } from 'react';
import { useReactFlow, useStore, type NodeProps } from '@xyflow/react';
import { NodeShell } from './NodeShell';
import {
  NODE_WIDTH,
  type ImageGenNodeData,
  type ImageNodeData,
  type VideoGenNodeData,
} from '@/lib/types';

const ASPECT_OPTIONS: ('16:9' | '9:16' | '1:1')[] = ['16:9', '9:16', '1:1'];
const DURATIONS: (5 | 8)[] = [5, 8];

/**
 * Picks a starting frame for Veo from the closest upstream source:
 *   1) directly connected ImageGen → its outputDataUrl
 *   2) directly connected Image source → its dataUrl
 *   3) directly connected VideoGen → extract last frame client-side
 *   4) nothing → text-to-video (no starting frame)
 *
 * "Closest" means hop=1; further-upstream items still appear in the
 * upstream context panel for guidance but aren't used as the literal
 * first frame.
 */
type StartingFrameSource =
  | { kind: 'image'; dataUrl: string; label: string }
  | { kind: 'image-gen'; dataUrl: string; label: string }
  | { kind: 'video-gen'; videoBase64: string; mimeType: string; label: string }
  | null;

export function VideoGenNode({ id, data, selected }: NodeProps) {
  const d = data as VideoGenNodeData;
  const flow = useReactFlow();
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const prompt = d.prompt ?? '';
  const aspectRatio: '16:9' | '9:16' | '1:1' = (d as { aspectRatio?: '16:9' | '9:16' | '1:1' }).aspectRatio ?? '16:9';
  const durationSec = d.durationSec ?? 8;
  const outputUrl = d.outputUrl;

  const startingFrame = useStore((s) => pickStartingFrame(id, s.nodes, s.edges));

  const setPrompt = (text: string) => flow.updateNodeData(id, { ...d, prompt: text });
  const setAspect = (a: '16:9' | '9:16' | '1:1') =>
    flow.updateNodeData(id, { ...d, aspectRatio: a });
  const setDuration = (n: 5 | 8) => flow.updateNodeData(id, { ...d, durationSec: n });

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
      let startingImageDataUrl: string | undefined;
      if (startingFrame?.kind === 'image' || startingFrame?.kind === 'image-gen') {
        startingImageDataUrl = startingFrame.dataUrl;
      } else if (startingFrame?.kind === 'video-gen') {
        setStatusMsg('Extracting last frame from upstream video…');
        startingImageDataUrl = await extractLastFrame(
          `data:${startingFrame.mimeType};base64,${startingFrame.videoBase64}`,
        );
      }

      const res = await fetch('/api/generate/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoGenNodeId: id,
          prompt: prompt.trim(),
          startingImageDataUrl,
          aspectRatio,
          durationSec,
          nodes: flow.getNodes(),
          edges: flow.getEdges(),
        }),
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
      let videoBase64: string | null = null;
      let mimeType = 'video/mp4';

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
            | { type: string; message?: string; error?: string; videoBase64?: string; mimeType?: string }
            | null = null;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (!event) continue;
          if (event.type === 'status' && event.message) {
            setStatusMsg(event.message);
          } else if (event.type === 'done' && event.videoBase64) {
            videoBase64 = event.videoBase64;
            if (event.mimeType) mimeType = event.mimeType;
            break streamLoop;
          } else if (event.type === 'error') {
            throw new Error(event.error ?? 'Stream error');
          }
        }
      }

      if (!videoBase64) {
        throw new Error('Video stream ended without a result.');
      }

      // Persist the video as both a base64 stash (for later re-encode if
      // needed) and a blob URL for immediate playback. We store the data
      // URL on the node so it survives reload.
      const dataUrl = `data:${mimeType};base64,${videoBase64}`;
      flow.updateNodeData(id, {
        ...d,
        outputUrl: dataUrl,
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
        <div className="node-label opacity-60 mb-1">starting frame</div>
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
            connect this node's right ● into another video-gen node to extend the sequence — the next clip starts from this clip's last frame.
          </p>
        </div>
      )}

      {!outputUrl && !isGenerating && (
        <p className="mt-1 text-[10px] font-mono text-bone-400 leading-snug">
          for talking avatars / lip-sync / audio: set <span className="text-ember">VEO_MODEL=veo-3.0-generate-001</span> in Vercel env. Veo 2 (default) is silent video only.
        </p>
      )}
    </NodeShell>
  );
}

/**
 * Look at upstream nodes (BFS, transitive — not just hop=1) and pick the
 * closest usable starting frame. Preference order at each hop level:
 *   ImageGen output > Image source > VideoGen last frame.
 *
 * Walking transitively means a chain like
 *   [Image source] → [Chat] → [Artifact] → [VideoGen]
 * still finds the image even though there are two non-image nodes in
 * between. Without this you'd have to manually wire the image directly
 * into the VideoGen, which defeats the point of chaining.
 */
function pickStartingFrame(
  consumerId: string,
  nodes: { id: string; data: { kind?: string } & Record<string, unknown> }[],
  edges: { source: string; target: string }[],
): StartingFrameSource {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>([consumerId]);
  const queue: string[] = [consumerId];

  // Collect every reachable upstream node, grouped by category, preserving
  // BFS order (closer first). After the walk we pick the highest-priority
  // category that has any entry.
  const imageGenHits: { dataUrl: string; label: string }[] = [];
  const imageHits: { dataUrl: string; label: string }[] = [];
  const videoGenHits: { videoBase64: string; mimeType: string; label: string }[] = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.target !== cur || visited.has(e.source)) continue;
      visited.add(e.source);
      queue.push(e.source);
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
          const m = vg.outputUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (m) {
            videoGenHits.push({
              videoBase64: m[2],
              mimeType: m[1],
              label: 'upstream video',
            });
          }
        }
      }
    }
  }

  if (imageGenHits.length > 0) {
    return { kind: 'image-gen', ...imageGenHits[0] };
  }
  if (imageHits.length > 0) {
    return { kind: 'image', ...imageHits[0] };
  }
  if (videoGenHits.length > 0) {
    return { kind: 'video-gen', ...videoGenHits[0] };
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
