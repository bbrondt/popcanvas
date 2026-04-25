import type { ReactFlowInstance } from '@xyflow/react';
import type { CanvasNodeData, NodeKind } from '@/lib/types';

interface ExtractArgs {
  kind: NodeKind;
  payload?: Record<string, unknown>;
  file?: File;
}

/**
 * Single extraction entrypoint shared by every source node.
 * Marks the node as pending, calls the API, merges the result.
 */
export async function extractNode(
  nodeId: string,
  flow: { updateNodeData: (id: string, data: Partial<CanvasNodeData>) => void; getNode: (id: string) => { data: CanvasNodeData } | undefined },
  args: ExtractArgs,
): Promise<void> {
  try {
    let res: Response;
    if (args.file) {
      const fd = new FormData();
      fd.append('kind', args.kind);
      fd.append('file', args.file);
      res = await fetch('/api/extract', { method: 'POST', body: fd });
    } else {
      res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: args.kind, payload: args.payload ?? {} }),
      });
    }

    if (!res.ok) {
      const raw = await res.text();
      let msg = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          msg = String((parsed as { error: unknown }).error);
        }
      } catch {
        // not JSON, fall back to raw text
      }
      throw new Error(msg);
    }
    const result = (await res.json()) as { title: string; content: string; meta?: Record<string, unknown> };

    const existing = flow.getNode(nodeId)?.data ?? ({} as CanvasNodeData);
    flow.updateNodeData(nodeId, {
      ...existing,
      status: 'ready',
      title: result.title,
      content: result.content,
      ...(result.meta ?? {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const existing = flow.getNode(nodeId)?.data ?? ({} as CanvasNodeData);
    flow.updateNodeData(nodeId, { ...existing, status: 'error', error: msg });
  }
}
