import { useState } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeShell, StatusPill, ExtractButton } from './NodeShell';
import { parseVideoId } from '@/lib/extractors/youtube-shared';
import type { YoutubeNodeData } from '@/lib/types';
import { NODE_WIDTH } from '@/lib/types';
import { extractNode } from './extractHelpers';

export function YoutubeNode({ id, data, selected }: NodeProps) {
  const d = data as YoutubeNodeData;
  const flow = useReactFlow();
  const [draftUrl, setDraftUrl] = useState(d.url ?? '');

  const handleExtract = async () => {
    const videoId = parseVideoId(draftUrl);
    if (!videoId) {
      flow.updateNodeData(id, { ...d, status: 'error', error: 'Invalid YouTube URL' });
      return;
    }
    flow.updateNodeData(id, { ...d, url: draftUrl, videoId, status: 'pending' });
    await extractNode(id, flow, { kind: 'youtube', payload: { url: draftUrl } });
  };

  return (
    <NodeShell id={id} selected={!!selected} width={NODE_WIDTH.youtube} status={d.status}>
      <div className="flex items-center justify-between mb-2">
        <span className="node-label">▶ youtube</span>
        <StatusPill status={d.status} />
      </div>

      {d.status === 'ready' && d.thumbnail && (
        <img src={d.thumbnail} alt="" className="w-full aspect-video object-cover mb-2 rounded-sm" />
      )}

      {d.status === 'ready' ? (
        <div className="node-title line-clamp-2">{d.title}</div>
      ) : (
        <>
          <input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            className="w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-sm"
          />
          {d.status !== 'error' && (
            <p className="mt-1.5 text-[10px] font-mono text-bone-400 leading-snug">
              Uses YouTube captions when available, otherwise transcribes audio. Long videos can take a minute.
            </p>
          )}
          <ExtractButton onClick={handleExtract} disabled={d.status === 'pending' || !draftUrl} />
          {d.status === 'error' && (
            <div className="mt-2 text-[11px] font-sans text-red-400 leading-snug">{d.error}</div>
          )}
        </>
      )}
    </NodeShell>
  );
}
