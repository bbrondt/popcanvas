import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import type { ExtractionStatus } from '@/lib/types';

interface NodeShellProps {
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
  selected,
  width = 280,
  inputHandle = false,
  outputHandle = true,
  status,
  children,
}: NodeShellProps) {
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
