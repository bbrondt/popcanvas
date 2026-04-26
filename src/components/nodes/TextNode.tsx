import { useState } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeShell, StatusPill } from './NodeShell';
import { NODE_WIDTH, type TextNodeData } from '@/lib/types';

export function TextNode({ id, data, selected }: NodeProps) {
  const d = data as TextNodeData;
  const flow = useReactFlow();
  const [draft, setDraft] = useState(d.content ?? '');
  const [draftTitle, setDraftTitle] = useState(d.title ?? 'Pasted text');

  const handleBlur = () => {
    flow.updateNodeData(id, {
      ...d,
      title: draftTitle,
      content: draft,
      status: draft ? 'ready' : 'idle',
    });
  };

  return (
    <NodeShell id={id} selected={!!selected} width={NODE_WIDTH.text} status={d.status}>
      <div className="flex items-center justify-between mb-2">
        <span className="node-label">¶ text</span>
        <StatusPill status={d.status} />
      </div>

      <input
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        onBlur={handleBlur}
        placeholder="Title"
        className="nodrag w-full bg-transparent border-b border-ink-600 pb-1 mb-2 font-display text-[15px] text-bone-50 focus:border-ember outline-none"
      />
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        placeholder="Paste text, notes, or anything you want as context…"
        rows={5}
        className="nodrag w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-sm resize-y"
      />
    </NodeShell>
  );
}
