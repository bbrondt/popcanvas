import { Handle, Position, useReactFlow, useStore } from '@xyflow/react';
import type { ReactNode } from 'react';
import type { ExtractionStatus } from '@/lib/types';
import { AddNodeButton } from '../canvas/AddNodeButton';

interface NodeShellProps {
  /** id is required when we want to render delete/move affordances. */
  id?: string;
  selected: boolean;
  width?: number;
  /** Show input handle on the left. False for pure source nodes. */
  inputHandle?: boolean;
  /** Show output handle on the right. False for pure consumers like chat. */
  outputHandle?: boolean;
  status?: ExtractionStatus;
  children: ReactNode;
}

export function NodeShell({
  id,
  selected,
  width = 280,
  inputHandle = false,
  outputHandle = true,
  status,
  children,
}: NodeShellProps) {
  // Show + buttons only when the corresponding handle has no edge yet —
  // once a handle is connected, the + would just visually overlap the line.
  const inputConnected = useStore((s) =>
    id ? s.edges.some((e) => e.target === id) : false,
  );
  const outputConnected = useStore((s) =>
    id ? s.edges.some((e) => e.source === id) : false,
  );

  return (
    <div
      className={`node-frame ${selected ? 'is-selected' : ''}`}
      style={{ width }}
    >
      {inputHandle && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ left: -5 }}
        />
      )}
      {outputHandle && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ right: -5 }}
        />
      )}
      {id && inputHandle && !inputConnected && (
        <AddNodeButton ownerId={id} direction="input" />
      )}
      {id && outputHandle && !outputConnected && (
        <AddNodeButton ownerId={id} direction="output" />
      )}
      {id && selected && <DeleteNodeButton id={id} />}
      <div className="p-3">
        {status === 'pending' && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-0 right-0 h-px bg-ember animate-pulse" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function DeleteNodeButton({ id }: { id: string }) {
  const flow = useReactFlow();
  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    flow.deleteElements({ nodes: [{ id }] });
  };
  return (
    <button
      onClick={handle}
      title="Delete node (or press Backspace / Delete)"
      className="absolute -top-2.5 -right-2.5 z-10 w-6 h-6 flex items-center justify-center bg-ink-700 border border-ink-500 text-bone-300 hover:bg-red-500/20 hover:border-red-400 hover:text-red-300 transition-colors rounded-full font-mono text-[12px] leading-none shadow-node"
    >
      ×
    </button>
  );
}

export function StatusPill({ status }: { status: ExtractionStatus }) {
  const labels: Record<ExtractionStatus, string> = {
    idle: 'idle',
    pending: 'extracting…',
    ready: 'ready',
    error: 'error',
  };
  const color: Record<ExtractionStatus, string> = {
    idle: 'text-bone-400',
    pending: 'text-ember',
    ready: 'text-moss',
    error: 'text-red-400',
  };
  return <span className={`node-label ${color[status]}`}>{labels[status]}</span>;
}

/**
 * Extract a button helper used inside source nodes when extraction
 * hasn't been kicked off yet.
 */
export function ExtractButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="pill-btn-primary mt-2 w-full">
      Extract
    </button>
  );
}
