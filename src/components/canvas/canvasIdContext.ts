import { createContext, useContext } from 'react';

/**
 * Threads the active canvasId down to nodes without a prop drill through
 * @xyflow/react's nodeTypes registration. Nodes that need to scope server
 * calls per canvas (e.g. VideoGen uploading bytes to storage) read it here.
 */
export const CanvasIdContext = createContext<string | null>(null);

export function useCanvasId(): string | null {
  return useContext(CanvasIdContext);
}
