import { useEffect, useRef, useState } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { nanoid } from 'nanoid';
import {
  SOURCE_KINDS,
  CONSUMER_KINDS,
  ALL_KINDS,
  defaultData,
} from '@/lib/nodeFactory';
import type { CanvasNode, NodeKind } from '@/lib/types';

interface Props {
  ownerId: string;
  direction: 'input' | 'output';
}

/**
 * Tiny "+" button that hangs off the side of a node next to its handle.
 * Click to open a popover that lists node types; pick one and we spawn
 * the node next to the owner and auto-connect them.
 *
 *   direction='output' → button on right, lists consumer types by default,
 *                        new node spawns to the right and is wired
 *                        owner -> new.
 *   direction='input'  → button on left, lists source types by default,
 *                        new node spawns to the left and is wired
 *                        new -> owner.
 *
 * "All" tab in the picker shows every node type for the case where the
 * default isn't what you want (e.g., wiring a chat downstream of another
 * chat).
 */
export function AddNodeButton({ ownerId, direction }: Props) {
  const flow = useReactFlow();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const addNode = (kind: NodeKind) => {
    setOpen(false);
    setShowAll(false);
    const owner = flow.getNode(ownerId);
    if (!owner) return;

    const newId = nanoid();
    const offsetX = direction === 'output' ? 360 : -360;
    const ownerWidth = (owner.width as number | undefined) ?? 280;
    const targetX =
      direction === 'output'
        ? owner.position.x + ownerWidth + 80
        : owner.position.x + offsetX;
    const newNode: CanvasNode = {
      id: newId,
      type: kind,
      position: { x: targetX, y: owner.position.y },
      data: defaultData(kind),
    };
    flow.addNodes(newNode);

    const edge: Edge =
      direction === 'output'
        ? { id: `e-${ownerId}-${newId}`, source: ownerId, target: newId, animated: true }
        : { id: `e-${newId}-${ownerId}`, source: newId, target: ownerId, animated: true };
    flow.addEdges([edge]);
  };

  const positionStyle: React.CSSProperties =
    direction === 'output'
      ? { right: -32, top: '50%', transform: 'translateY(-50%)' }
      : { left: -32, top: '50%', transform: 'translateY(-50%)' };

  const popoverStyle: React.CSSProperties =
    direction === 'output'
      ? { left: '32px', top: '50%', transform: 'translateY(-50%)' }
      : { right: '32px', top: '50%', transform: 'translateY(-50%)' };

  const defaults = direction === 'output' ? CONSUMER_KINDS : SOURCE_KINDS;
  const list = showAll ? ALL_KINDS : defaults;

  return (
    <div ref={ref} className="absolute z-20" style={positionStyle}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="nodrag w-6 h-6 rounded-full bg-ink-700/80 backdrop-blur-sm border border-ember/40 text-ember hover:bg-ember/15 hover:border-ember opacity-30 hover:opacity-100 transition-opacity flex items-center justify-center text-[14px] font-mono leading-none"
        style={{ boxShadow: '0 0 8px -2px rgba(0,229,255,0.4)' }}
        title={direction === 'output' ? 'Add a connected node downstream' : 'Add a connected node upstream'}
      >
        +
      </button>
      {open && (
        <div
          className="absolute z-30 node-frame p-2 min-w-[160px] flex flex-col gap-1 nodrag"
          style={popoverStyle}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-1 pb-1 border-b border-ink-600 mb-1">
            <span className="node-label opacity-60">
              {direction === 'output' ? 'add downstream' : 'add upstream'}
            </span>
            <button
              onClick={() => setShowAll((v) => !v)}
              className="node-label hover:text-ember"
              title={showAll ? 'Show defaults only' : 'Show every node type'}
            >
              {showAll ? 'defaults' : 'all'}
            </button>
          </div>
          {list.map((k) => (
            <button
              key={k.kind}
              onClick={() => addNode(k.kind)}
              className="pill-btn text-[11px] flex items-center gap-2 justify-start text-left"
            >
              <span className="text-ember w-4 text-center">{k.symbol}</span>
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
