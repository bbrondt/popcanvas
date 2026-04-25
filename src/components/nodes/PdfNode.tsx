import { useState, useRef } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeShell, StatusPill, ExtractButton } from './NodeShell';
import { extractNode } from './extractHelpers';
import { NODE_WIDTH, type PdfNodeData } from '@/lib/types';

export function PdfNode({ id, data, selected }: NodeProps) {
  const d = data as PdfNodeData;
  const flow = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleExtract = async () => {
    if (!pendingFile) return;
    flow.updateNodeData(id, { ...d, filename: pendingFile.name, status: 'pending' });
    await extractNode(id, flow, { kind: 'pdf', file: pendingFile });
  };

  return (
    <NodeShell id={id} selected={!!selected} width={NODE_WIDTH.pdf} status={d.status}>
      <div className="flex items-center justify-between mb-2">
        <span className="node-label">⌹ pdf</span>
        <StatusPill status={d.status} />
      </div>

      {d.status === 'ready' ? (
        <>
          <div className="node-title line-clamp-2 mb-1">{d.title}</div>
          {d.pageCount && (
            <div className="node-label">{d.pageCount} pages · {d.content?.length.toLocaleString()} chars</div>
          )}
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="pill-btn w-full mb-2"
          >
            {pendingFile?.name ?? 'Choose PDF'}
          </button>
          <ExtractButton onClick={handleExtract} disabled={!pendingFile || d.status === 'pending'} />
          {d.status === 'error' && (
            <div className="mt-2 text-[11px] font-mono text-red-400">{d.error}</div>
          )}
        </>
      )}
    </NodeShell>
  );
}
