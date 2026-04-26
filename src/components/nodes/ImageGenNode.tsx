import { useState } from 'react';
import { useReactFlow, useStore, type NodeProps } from '@xyflow/react';
import { NodeShell } from './NodeShell';
import { slimNodesForApi } from '@/lib/slimPayload';
import { NODE_WIDTH, type ImageGenNodeData, type ImageNodeData } from '@/lib/types';

const ASPECTS: NonNullable<ImageGenNodeData['aspectRatio']>[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

export function ImageGenNode({ id, data, selected }: NodeProps) {
  const d = data as ImageGenNodeData;
  const flow = useReactFlow();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const prompt = d.prompt ?? '';
  const output = d.outputDataUrl;
  const aspect = d.aspectRatio ?? '1:1';

  const upstreamImages = useStore((s) => {
    // Find every connected image source (transitive), pull dataUrls.
    const visited = new Set<string>([id]);
    const queue: string[] = [id];
    const refs: { id: string; thumbnailUrl?: string; dataUrl?: string; title?: string }[] = [];
    const nodeById = new Map(s.nodes.map((n) => [n.id, n]));
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of s.edges) {
        if (e.target !== cur || visited.has(e.source)) continue;
        visited.add(e.source);
        queue.push(e.source);
        const n = nodeById.get(e.source);
        const nd = n?.data as { kind?: string };
        if (nd?.kind === 'image') {
          const img = nd as unknown as ImageNodeData;
          refs.push({ id: e.source, thumbnailUrl: img.thumbnailUrl, dataUrl: img.dataUrl, title: img.title });
        }
      }
    }
    return refs;
  });

  const setPrompt = (text: string) => flow.updateNodeData(id, { ...d, prompt: text });
  const setAspect = (a: NonNullable<ImageGenNodeData['aspectRatio']>) =>
    flow.updateNodeData(id, { ...d, aspectRatio: a });

  const generate = async () => {
    if (isGenerating) return;
    if (!prompt.trim()) {
      setError('Type a prompt first.');
      return;
    }
    setIsGenerating(true);
    setError(undefined);
    flow.updateNodeData(id, { ...d, isGenerating: true, status: 'pending' });

    try {
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageGenNodeId: id,
          prompt: prompt.trim(),
          aspectRatio: aspect,
          // References travel as their own array; the slim nodes carry
          // text-shaped context only. Same reason as VideoGen — keeps
          // the request body under Vercel's 4.5MB cap.
          references: usableRefs.map((r) => ({
            dataUrl: r.dataUrl as string,
            label: r.title ?? 'reference',
          })),
          nodes: slimNodesForApi(flow.getNodes()),
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
        throw new Error(msg || `image-gen failed (${res.status})`);
      }
      const data = (await res.json()) as { dataUrl: string };
      flow.updateNodeData(id, {
        ...d,
        outputDataUrl: data.dataUrl,
        isGenerating: false,
        status: 'ready',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ImageGenNode] generate failed:', err);
      flow.updateNodeData(id, { ...d, isGenerating: false, status: 'error', error: msg });
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadOutput = () => {
    if (!output) return;
    const a = document.createElement('a');
    a.href = output;
    a.download = `imagegen-${Date.now()}.png`;
    a.click();
  };

  const copyOutput = async () => {
    if (!output) return;
    try {
      const blob = await fetch(output).then((r) => r.blob());
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch {
      /* clipboard write image not always supported; ignore */
    }
  };

  const status = isGenerating ? 'pending' : output ? 'ready' : 'idle';
  const usableRefs = upstreamImages.filter((r) => r.dataUrl);

  return (
    <NodeShell id={id} selected={!!selected} width={NODE_WIDTH['image-gen']} inputHandle outputHandle status={status}>
      <div className="flex items-center justify-between mb-2">
        <span className="node-label" style={{ color: '#ff66e0' }}>◇ image gen</span>
        <span className={`node-label ${isGenerating ? 'text-ember' : output ? 'text-moss' : 'text-bone-400'}`}>
          {isGenerating ? 'generating…' : status}
        </span>
      </div>

      {upstreamImages.length > 0 && (
        <div className="border-y border-ink-600 py-2 mb-2 -mx-1 px-1">
          <div className="node-label opacity-60 mb-1.5">
            references · {upstreamImages.length}
            {upstreamImages.length !== usableRefs.length && (
              <span className="text-red-400 ml-2">
                ({upstreamImages.length - usableRefs.length} missing image data)
              </span>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {upstreamImages.map((r) => (
              <img
                key={r.id}
                src={r.thumbnailUrl ?? r.dataUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="w-12 h-12 object-cover rounded-md bg-ink-900 border border-ink-600"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ))}
          </div>
        </div>
      )}

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={isGenerating}
        placeholder="Describe the image you want…"
        rows={3}
        className="nodrag w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-md resize-y mb-2"
      />

      <div className="flex items-center gap-1.5 mb-2">
        <span className="node-label opacity-60">aspect</span>
        {ASPECTS.map((a) => (
          <button
            key={a}
            onClick={() => setAspect(a)}
            disabled={isGenerating}
            className={`pill-btn text-[10px] py-1 px-2 ${a === aspect ? 'border-ember text-ember' : ''}`}
            style={a === aspect ? { boxShadow: '0 0 8px -2px rgba(0,229,255,0.5)' } : undefined}
          >
            {a}
          </button>
        ))}
      </div>

      <button
        onClick={generate}
        disabled={isGenerating || !prompt.trim()}
        className="pill-btn-primary w-full mb-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isGenerating ? 'generating…' : output ? 'regenerate' : 'generate'}
      </button>

      {error && (
        <div className="border border-red-500/40 bg-red-500/5 px-2 py-1.5 mb-2 text-[11px] font-sans text-red-300 rounded-sm flex items-start gap-2">
          <div className="flex-1 leading-snug">
            <div className="node-label text-red-400 mb-0.5">image gen error</div>
            {error}
          </div>
          <button onClick={() => setError(undefined)} className="text-red-300 hover:text-red-100 font-mono text-xs leading-none">
            ×
          </button>
        </div>
      )}

      {output && (
        <div className="border-t border-ink-600 pt-2">
          <img
            src={output}
            alt="Generated"
            className="w-full rounded-md bg-ink-900 mb-2"
          />
          <div className="flex gap-1.5">
            <button onClick={copyOutput} className="pill-btn text-[10px] flex-1">copy</button>
            <button onClick={downloadOutput} className="pill-btn text-[10px] flex-1">.png</button>
          </div>
        </div>
      )}
    </NodeShell>
  );
}
