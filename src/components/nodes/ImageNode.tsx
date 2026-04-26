import { useState, useRef } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeShell, StatusPill, ExtractButton } from './NodeShell';
import { extractNode } from './extractHelpers';
import { NODE_WIDTH, type ImageNodeData } from '@/lib/types';

export function ImageNode({ id, data, selected }: NodeProps) {
  const d = data as ImageNodeData;
  const flow = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(d.thumbnailUrl);

  const handleFileChange = (file: File | null) => {
    setPendingFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setThumbnailUrl(url);
    }
  };

  const handleExtract = async () => {
    if (!pendingFile) return;
    // Persist a base64 data URL alongside the OCR text so downstream
    // image-gen nodes can use this image as a reference even after a
    // page reload (blob: URLs only live for one session).
    const dataUrl = await fileToDataUrl(pendingFile);
    flow.updateNodeData(id, {
      ...d,
      filename: pendingFile.name,
      thumbnailUrl,
      dataUrl,
      mimeType: pendingFile.type || 'image/jpeg',
      status: 'pending',
    });
    await extractNode(id, flow, { kind: 'image', file: pendingFile });
  };

  return (
    <NodeShell id={id} selected={!!selected} width={NODE_WIDTH.image} status={d.status}>
      <div className="flex items-center justify-between mb-2">
        <span className="node-label">▢ image</span>
        <StatusPill status={d.status} />
      </div>

      {thumbnailUrl && (
        <img src={thumbnailUrl} alt="" className="w-full max-h-32 object-cover mb-2 rounded-sm" />
      )}

      {d.status === 'ready' ? (
        <div className="node-title line-clamp-2">{d.title}</div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button onClick={() => inputRef.current?.click()} className="pill-btn w-full mb-2">
            {pendingFile?.name ?? 'Choose image'}
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
