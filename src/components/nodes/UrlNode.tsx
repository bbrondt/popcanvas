import { useState } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeShell, StatusPill, ExtractButton } from './NodeShell';
import { extractNode } from './extractHelpers';
import { NODE_WIDTH, type UrlNodeData } from '@/lib/types';

const PLATFORM_META: Record<
  NonNullable<UrlNodeData['platform']>,
  { symbol: string; label: string; color: string }
> = {
  tiktok: { symbol: '♪', label: 'tiktok', color: 'text-neon' },
  instagram: { symbol: '◉', label: 'instagram', color: 'text-ember' },
  youtube: { symbol: '▶', label: 'youtube', color: 'text-red-400' },
  web: { symbol: '↗', label: 'url', color: 'text-bone-300' },
};

export function UrlNode({ id, data, selected }: NodeProps) {
  const d = data as UrlNodeData;
  const flow = useReactFlow();
  const [draftUrl, setDraftUrl] = useState(d.url ?? '');

  const handleExtract = async () => {
    flow.updateNodeData(id, { ...d, url: draftUrl, status: 'pending' });
    await extractNode(id, flow, { kind: 'url', payload: { url: draftUrl } });
  };

  const meta = PLATFORM_META[d.platform ?? 'web'];

  return (
    <NodeShell id={id} selected={!!selected} width={NODE_WIDTH.url} status={d.status}>
      <div className="flex items-center justify-between mb-2">
        <span className={`node-label ${meta.color}`}>
          {meta.symbol} {meta.label}
        </span>
        <StatusPill status={d.status} />
      </div>

      {d.status === 'ready' ? (
        <>
          {d.thumbnail && (
            <img
              src={d.thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full max-h-40 object-cover mb-2 rounded-md bg-ink-900"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div className="node-title line-clamp-2 mb-1">{d.title || d.url}</div>
          <div className="node-label truncate">{d.url}</div>
        </>
      ) : (
        <>
          <input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="https://…"
            className="nodrag w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-sm"
          />
          <ExtractButton onClick={handleExtract} disabled={d.status === 'pending' || !draftUrl} />
          {d.status === 'error' && (
            <div className="mt-2 text-[11px] font-mono text-red-400">{d.error}</div>
          )}
        </>
      )}
    </NodeShell>
  );
}
