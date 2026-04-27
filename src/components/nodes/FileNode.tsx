import { useState, useRef } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeShell, StatusPill, ExtractButton } from './NodeShell';
import { extractNode } from './extractHelpers';
import { NODE_WIDTH, type FileNodeData } from '@/lib/types';

/** Browser file picker accept list. We pass a comma-separated list of
 *  MIME types AND extensions because some browsers / OSes match by one
 *  but not the other (e.g. .md often has no registered MIME). */
const ACCEPT =
  '.pdf,application/pdf,' +
  '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  '.md,.markdown,text/markdown,' +
  '.txt,text/plain,' +
  '.csv,text/csv,' +
  '.tsv,' +
  '.log,' +
  '.json,application/json,' +
  '.rtf,text/rtf';

/** Tag → display label / pill color hint. */
const TYPE_LABEL: Record<NonNullable<FileNodeData['fileType']>, string> = {
  pdf: 'PDF',
  docx: 'WORD',
  markdown: 'MD',
  text: 'TXT',
  csv: 'CSV',
  other: 'FILE',
};

export function FileNode({ id, data, selected }: NodeProps) {
  const d = data as FileNodeData;
  const flow = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleExtract = async () => {
    if (!pendingFile) return;
    flow.updateNodeData(id, {
      ...d,
      filename: pendingFile.name,
      mimeType: pendingFile.type || undefined,
      status: 'pending',
    });
    await extractNode(id, flow, { kind: 'file', file: pendingFile });
  };

  const tag = d.fileType ? TYPE_LABEL[d.fileType] : 'FILE';
  const meta =
    d.status === 'ready'
      ? d.fileType === 'pdf'
        ? `${d.pageCount ?? '?'} pages · ${d.content?.length.toLocaleString() ?? 0} chars`
        : `${d.pageCount ?? '?'} words · ${d.content?.length.toLocaleString() ?? 0} chars`
      : null;

  return (
    <NodeShell id={id} selected={!!selected} width={NODE_WIDTH.file} status={d.status}>
      <div className="flex items-center justify-between mb-2">
        <span className="node-label">⌹ {tag.toLowerCase()}</span>
        <StatusPill status={d.status} />
      </div>

      {d.status === 'ready' ? (
        <>
          <div className="node-title line-clamp-2 mb-1">{d.title}</div>
          {meta && <div className="node-label">{meta}</div>}
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="pill-btn w-full mb-2"
          >
            {pendingFile?.name ?? 'Choose file'}
          </button>
          <div className="text-[10px] font-mono text-bone-400 mb-2 leading-snug">
            pdf · docx · md · txt · csv
          </div>
          <ExtractButton onClick={handleExtract} disabled={!pendingFile || d.status === 'pending'} />
          {d.status === 'error' && (
            <div className="mt-2 text-[11px] font-mono text-red-400">{d.error}</div>
          )}
        </>
      )}
    </NodeShell>
  );
}
