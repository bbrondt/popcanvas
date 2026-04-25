import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Toolbar } from './Toolbar';
import { YoutubeNode } from '../nodes/YoutubeNode';
import { PdfNode } from '../nodes/PdfNode';
import { UrlNode } from '../nodes/UrlNode';
import { ImageNode } from '../nodes/ImageNode';
import { TextNode } from '../nodes/TextNode';
import { ChatNode } from '../nodes/ChatNode';

const nodeTypes = {
  youtube: YoutubeNode,
  pdf: PdfNode,
  url: UrlNode,
  image: ImageNode,
  text: TextNode,
  chat: ChatNode,
};

interface CanvasProps {
  canvasId: string;
}

function CanvasInner({ canvasId }: CanvasProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [title, setTitle] = useState('Untitled canvas');
  const [loaded, setLoaded] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}`);
        if (res.ok) {
          const data = await res.json();
          setNodes(data.nodes ?? []);
          setEdges(data.edges ?? []);
          setTitle(data.title ?? 'Untitled canvas');
        }
      } catch {
        // Silent: canvas might not exist yet
      } finally {
        setLoaded(true);
      }
    })();
  }, [canvasId]);

  // Debounced autosave on any change
  useEffect(() => {
    if (!loaded) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      void fetch(`/api/canvas/${canvasId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }),
      });
    }, 800);
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [nodes, edges, title, canvasId, loaded]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect = useCallback(
    (conn: Connection) => setEdges((es) => addEdge({ ...conn, animated: true }, es)),
    [],
  );

  return (
    <div className="relative w-screen h-screen canvas-grid">
      <TitleBar title={title} onTitleChange={setTitle} />
      <Toolbar />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        proOptions={{ hideAttribution: false }}
        defaultEdgeOptions={{ animated: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="rgba(245,241,232,0.06)" />
        <Controls position="bottom-right" />
        <MiniMap
          position="top-right"
          nodeColor={() => '#ff5c2b'}
          maskColor="rgba(10,9,8,0.85)"
          style={{ width: 160, height: 100 }}
        />
      </ReactFlow>
    </div>
  );
}

function TitleBar({ title, onTitleChange }: { title: string; onTitleChange: (t: string) => void }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-40 px-6 py-4 flex items-center justify-between pointer-events-none">
      <div className="pointer-events-auto flex items-baseline gap-3">
        <span className="font-display text-bone-50 text-lg tracking-tight">popcanvas</span>
        <span className="node-label opacity-60">/</span>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="bg-transparent border-none outline-none font-display text-bone-200 text-base tracking-tight w-64"
        />
      </div>
      <div className="pointer-events-auto node-label opacity-60">
        autosaved · ⌘+Enter in chat sends
      </div>
    </div>
  );
}

export function Canvas({ canvasId }: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner canvasId={canvasId} />
    </ReactFlowProvider>
  );
}
