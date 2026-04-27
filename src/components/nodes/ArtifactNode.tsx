import { useState, useRef, useEffect } from 'react';
import { useReactFlow, useStore, type NodeProps } from '@xyflow/react';
import { NodeShell } from './NodeShell';
import { TEMPLATES, getTemplate } from '@/lib/ai/templates';
import {
  NODE_WIDTH,
  type ArtifactNodeData,
  type ArtifactTemplateId,
  type SourceNodeData,
} from '@/lib/types';

/**
 * The artifact node is the production sibling of the chat node:
 *  - Same input handle (consumes connected sources as XML context)
 *  - But instead of back-and-forth chat, it runs a single template-driven
 *    generation (video script, lead magnet, ad copy, etc.) and gives you
 *    a long, editable output you can refine and export.
 */
export function ArtifactNode({ id, data, selected }: NodeProps) {
  const d = data as ArtifactNodeData;
  const flow = useReactFlow();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const template = d.template ?? 'youtube-script';
  const customInstructions = d.customInstructions ?? '';
  const output = d.output ?? '';
  const tpl = getTemplate(template);

  // Mirror the server's transitive walk so the panel shows the full lineage:
  // direct sources, prior chats in the chain, prior artifacts feeding in.
  const upstream = useStore((s) => walkArtifactUpstream(id, s.nodes, s.edges));
  const upstreamCount = upstream.length;

  const setTemplate = (t: ArtifactTemplateId) => {
    flow.updateNodeData(id, { ...d, template: t });
  };
  const setCustomInstructions = (text: string) => {
    flow.updateNodeData(id, { ...d, customInstructions: text });
  };
  const setOutput = (text: string) => {
    flow.updateNodeData(id, { ...d, output: text });
  };

  // Auto-generate on mount when chat spawned this node via tool use. We
  // clear the flag immediately so re-mounts (canvas reload, edit, etc.)
  // don't re-fire generation. Defer to next tick so other props/state
  // settle first.
  useEffect(() => {
    if (d.autoGenerate && !isGenerating && !output) {
      flow.updateNodeData(id, { ...d, autoGenerate: false });
      const t = setTimeout(() => {
        void generate();
      }, 50);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    if (isGenerating) return;
    if (upstreamCount === 0) {
      setError('Connect at least one upstream node (source, chat, or prior artifact) before generating.');
      return;
    }
    if (template === 'custom' && !customInstructions.trim()) {
      setError('Custom template needs instructions. Type what you want produced.');
      return;
    }

    setIsGenerating(true);
    setError(undefined);
    setStreamingText('');
    flow.updateNodeData(id, { ...d, isGenerating: true, status: 'pending' });

    try {
      const res = await fetch('/api/artifact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactNodeId: id,
          template,
          customInstructions,
          nodes: flow.getNodes(),
          edges: flow.getEdges(),
        }),
      });

      if (!res.ok) {
        const raw = await res.text();
        let msg = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            msg = String((parsed as { error: unknown }).error);
          }
        } catch {
          /* not JSON */
        }
        throw new Error(msg || `artifact request failed (${res.status})`);
      }
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';

      streamLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          let event: { type: string; text?: string; error?: string } | null = null;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (!event) continue;
          if (event.type === 'text' && event.text) {
            assembled += event.text;
            setStreamingText(assembled);
          } else if (event.type === 'error') {
            throw new Error(event.error ?? 'Stream error');
          } else if (event.type === 'done') {
            break streamLoop;
          }
        }
      }

      if (!assembled.trim()) {
        throw new Error(
          'Claude returned an empty response. Check Vercel function logs for [artifact:stream].',
        );
      }

      flow.updateNodeData(id, {
        ...d,
        output: assembled,
        isGenerating: false,
        status: 'ready',
      });
      setStreamingText('');
      setIsGenerating(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ArtifactNode] generate failed:', err);
      flow.updateNodeData(id, { ...d, isGenerating: false, status: 'error', error: msg });
      setError(msg);
      setStreamingText('');
      setIsGenerating(false);
    }
  };

  const copyOutput = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      // ignore
    }
  };

  const downloadOutput = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (tpl.label || 'artifact').toLowerCase().replace(/\s+/g, '-');
    a.href = url;
    a.download = `${safeName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const status = isGenerating ? 'pending' : output ? 'ready' : 'idle';

  return (
    <NodeShell id={id} selected={!!selected} width={NODE_WIDTH.artifact} inputHandle outputHandle status={status}>
      <div className="flex items-center justify-between mb-2">
        <span className="node-label">✦ artifact</span>
        <span className={`node-label ${isGenerating ? 'text-ember' : output ? 'text-moss' : 'text-bone-400'}`}>
          {isGenerating ? 'generating…' : output ? 'ready' : 'idle'}
        </span>
      </div>

      <UpstreamPanel upstream={upstream} />

      <div className="space-y-2 mb-2">
        <label className="block">
          <span className="node-label opacity-60 block mb-1">template</span>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as ArtifactTemplateId)}
            disabled={isGenerating}
            className="nodrag w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-sm"
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] font-mono text-bone-400">{tpl.description}</p>
        </label>

        <label className="block">
          <span className="node-label opacity-60 block mb-1">
            {template === 'custom' ? 'custom instructions' : 'extra direction (optional)'}
          </span>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            disabled={isGenerating}
            placeholder={
              template === 'custom'
                ? 'Tell Claude what to produce. Be specific about format, length, tone, structure.'
                : 'Layer on top of the template. e.g. "first-time homebuyers, more aggressive tone, lead with the loan size".'
            }
            rows={template === 'custom' ? 4 : 3}
            className="nodrag nowheel w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-sm resize-y"
          />
        </label>
      </div>

      <button
        onClick={generate}
        disabled={isGenerating || upstreamCount === 0}
        className="pill-btn-primary w-full mb-2 disabled:opacity-40 disabled:cursor-not-allowed"
        title={upstreamCount === 0 ? 'Connect at least one upstream node first' : ''}
      >
        {isGenerating ? 'generating…' : output ? 'regenerate' : 'generate'}
      </button>

      {error && (
        <div className="border border-red-500/40 bg-red-500/5 px-2 py-1.5 mb-2 text-[11px] font-sans text-red-300 rounded-sm flex items-start gap-2">
          <div className="flex-1 leading-snug">
            <div className="node-label text-red-400 mb-0.5">artifact error</div>
            {error}
          </div>
          <button onClick={() => setError(undefined)} className="text-red-300 hover:text-red-100 font-mono text-xs leading-none">
            ×
          </button>
        </div>
      )}

      {(output || streamingText) && (
        <OutputPanel
          value={isGenerating ? streamingText : output}
          editable={!isGenerating}
          onChange={setOutput}
          onCopy={copyOutput}
          onDownload={downloadOutput}
        />
      )}
    </NodeShell>
  );
}

type UpstreamItem =
  | { id: string; kind: 'source'; data: SourceNodeData; hop: number }
  | { id: string; kind: 'chat'; messageCount: number; hop: number }
  | { id: string; kind: 'artifact'; template: string; status: string; hop: number };

function walkArtifactUpstream(
  consumerId: string,
  nodes: { id: string; data: { kind?: string } & Record<string, unknown> }[],
  edges: { source: string; target: string }[],
): UpstreamItem[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>([consumerId]);
  const queue: { id: string; hop: number }[] = [{ id: consumerId, hop: 0 }];
  const out: UpstreamItem[] = [];
  while (queue.length > 0) {
    const { id, hop } = queue.shift()!;
    for (const e of edges) {
      if (e.target !== id || visited.has(e.source)) continue;
      visited.add(e.source);
      const node = nodeById.get(e.source);
      if (!node) continue;
      const k = node.data?.kind;
      const nextHop = hop + 1;
      queue.push({ id: e.source, hop: nextHop });
      if (k === 'chat') {
        const c = node.data as unknown as { messages?: { length: number }[] };
        out.push({ id: e.source, kind: 'chat', messageCount: (c.messages?.length as unknown as number) ?? 0, hop: nextHop });
      } else if (k === 'artifact') {
        const a = node.data as unknown as { template: string; status: string };
        out.push({ id: e.source, kind: 'artifact', template: a.template, status: a.status ?? 'idle', hop: nextHop });
      } else if (k && k !== 'chat' && k !== 'artifact') {
        out.push({ id: e.source, kind: 'source', data: node.data as unknown as SourceNodeData, hop: nextHop });
      }
    }
  }
  return out;
}

const KIND_SYMBOL: Record<string, string> = {
  youtube: '▶',
  pdf: '⌹',
  url: '↗',
  image: '▢',
  text: '¶',
  chat: '⌘',
  artifact: '✦',
};

function UpstreamPanel({ upstream }: { upstream: UpstreamItem[] }) {
  if (upstream.length === 0) {
    return (
      <div className="border-y border-ink-600 py-2 mb-2 -mx-1 px-1 text-[11px] font-mono text-bone-400 text-center">
        no upstream connected — drag from a source/chat/artifact's right ● to this node's left ●
      </div>
    );
  }
  const directCount = upstream.filter((u) => u.hop === 1).length;
  const indirect = upstream.length - directCount;
  return (
    <div className="border-y border-ink-600 py-2 mb-2 -mx-1 px-1">
      <div className="node-label opacity-60 mb-1.5">
        upstream context · {upstream.length}
        {indirect > 0 && (
          <span className="opacity-60"> ({directCount} direct, {indirect} via chain)</span>
        )}
      </div>
      <div className="space-y-1">
        {upstream.map((u) => (
          <UpstreamRow key={u.id} item={u} />
        ))}
      </div>
    </div>
  );
}

function UpstreamRow({ item }: { item: UpstreamItem }) {
  const dim = item.hop > 1 ? 'opacity-60' : '';
  if (item.kind === 'source') {
    const symbol = KIND_SYMBOL[item.data.kind] ?? '·';
    const label =
      item.data.title ||
      ('url' in item.data && item.data.url) ||
      ('filename' in item.data && item.data.filename) ||
      item.data.kind;
    const statusColor =
      item.data.status === 'error'
        ? 'text-red-400'
        : item.data.status === 'pending'
          ? 'text-ember'
          : item.data.status === 'ready'
            ? 'text-moss'
            : 'text-bone-400';
    return (
      <div className={`flex items-center gap-2 text-[11px] font-mono ${dim}`}>
        <span className="text-ember w-3 text-center flex-shrink-0">{symbol}</span>
        <span className="text-bone-200 truncate flex-1">{String(label)}</span>
        <span className={`${statusColor} flex-shrink-0 uppercase tracking-wider`}>{item.data.status}</span>
      </div>
    );
  }
  if (item.kind === 'chat') {
    return (
      <div className={`flex items-center gap-2 text-[11px] font-mono ${dim}`}>
        <span className="text-ember w-3 text-center flex-shrink-0">{KIND_SYMBOL.chat}</span>
        <span className="text-bone-200 truncate flex-1">prior chat</span>
        <span className="text-bone-400 flex-shrink-0 uppercase tracking-wider">{item.messageCount} turns</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 text-[11px] font-mono ${dim}`}>
      <span className="text-neon w-3 text-center flex-shrink-0">{KIND_SYMBOL.artifact}</span>
      <span className="text-bone-200 truncate flex-1">prior artifact ({item.template})</span>
      <span
        className={`flex-shrink-0 uppercase tracking-wider ${
          item.status === 'ready' ? 'text-moss' : item.status === 'pending' ? 'text-ember' : 'text-bone-400'
        }`}
      >
        {item.status}
      </span>
    </div>
  );
}

function OutputPanel({
  value,
  editable,
  onChange,
  onCopy,
  onDownload,
}: {
  value: string;
  editable: boolean;
  onChange: (v: string) => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!editable && ref.current) {
      // Auto-scroll to the bottom while streaming so the user sees new text.
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [value, editable]);

  const handleCopy = async () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="border-t border-ink-600 pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="node-label opacity-60">
          output · {value.length.toLocaleString()} chars
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={handleCopy}
            disabled={!value}
            className="pill-btn text-[10px] disabled:opacity-40"
            title="Copy to clipboard"
          >
            {copied ? 'copied ✓' : 'copy'}
          </button>
          <button
            onClick={onDownload}
            disabled={!value}
            className="pill-btn text-[10px] disabled:opacity-40"
            title="Download as Markdown"
          >
            .md
          </button>
        </div>
      </div>
      <textarea
        ref={ref}
        value={value}
        readOnly={!editable}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        className="nodrag nowheel w-full bg-ink-900 border border-ink-600 px-2 py-2 text-[12px] font-sans text-bone-50 focus:border-ember outline-none rounded-sm resize-y leading-relaxed"
      />
      {editable && (
        <p className="mt-1 text-[10px] font-mono text-bone-400">
          edit freely — your changes save with the canvas
        </p>
      )}
    </div>
  );
}
