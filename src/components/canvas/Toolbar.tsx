import { useReactFlow } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { CanvasNode, NodeKind } from '@/lib/types';

const KINDS: { kind: NodeKind; label: string; symbol: string }[] = [
  { kind: 'youtube', label: 'YouTube', symbol: '▶' },
  { kind: 'pdf', label: 'PDF', symbol: '⌹' },
  { kind: 'url', label: 'URL', symbol: '↗' },
  { kind: 'image', label: 'Image', symbol: '▢' },
  { kind: 'text', label: 'Text', symbol: '¶' },
  { kind: 'chat', label: 'Chat', symbol: '⌘' },
];

export function Toolbar() {
  const flow = useReactFlow();

  const handleAdd = (kind: NodeKind) => {
    const center = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });

    const id = nanoid();
    const newNode: CanvasNode = {
      id,
      type: kind,
      position: {
        x: center.x + Math.random() * 80 - 40,
        y: center.y + Math.random() * 80 - 40,
      },
      data: defaultData(kind),
    };

    flow.addNodes(newNode);
  };

  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50">
      <div className="node-frame p-2 flex flex-col gap-1.5">
        <div className="node-label px-1 pb-1 border-b border-ink-600 mb-1">add node</div>
        {KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => handleAdd(k.kind)}
            className="pill-btn flex items-center gap-2 justify-start min-w-[120px]"
            title={`Add ${k.label} node`}
          >
            <span className="text-ember w-4 text-center">{k.symbol}</span>
            <span>{k.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function defaultData(kind: NodeKind) {
  switch (kind) {
    case 'youtube':
      return { kind, status: 'idle' as const, url: '' };
    case 'pdf':
      return { kind, status: 'idle' as const };
    case 'url':
      return { kind, status: 'idle' as const, url: '' };
    case 'image':
      return { kind, status: 'idle' as const };
    case 'text':
      return { kind, status: 'idle' as const, content: '', title: 'Pasted text' };
    case 'chat':
      return { kind, status: 'idle' as const, messages: [] };
  }
}
