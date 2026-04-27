import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { nanoid } from 'nanoid';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Toolbar } from './Toolbar';
import { CustomEdge } from './CustomEdge';
import { DiscoverPanel } from './DiscoverPanel';
import { CanvasIdContext } from './canvasIdContext';
import { YoutubeNode } from '../nodes/YoutubeNode';
import { PdfNode } from '../nodes/PdfNode';
import { FileNode } from '../nodes/FileNode';
import { UrlNode } from '../nodes/UrlNode';
import { ImageNode } from '../nodes/ImageNode';
import { TextNode } from '../nodes/TextNode';
import { ChatNode } from '../nodes/ChatNode';
import { ArtifactNode } from '../nodes/ArtifactNode';
import { ImageGenNode } from '../nodes/ImageGenNode';
import { VideoGenNode } from '../nodes/VideoGenNode';

const nodeTypes = {
  youtube: YoutubeNode,
  pdf: PdfNode,
  file: FileNode,
  url: UrlNode,
  image: ImageNode,
  text: TextNode,
  chat: ChatNode,
  artifact: ArtifactNode,
  'image-gen': ImageGenNode,
  'video-gen': VideoGenNode,
};

const edgeTypes = { default: CustomEdge };

interface CanvasProps {
  canvasId: string;
}

// First-run scaffold: a chat node positioned to the right of where the toolbar
// sits, so the user opens the canvas and immediately sees what the consumer of
// their sources looks like. They still have to add sources from the toolbar
// and draw a connection — the empty-state hint guides that.
function makeChatSeed(): Node {
  return {
    id: `chat-${nanoid(6)}`,
    type: 'chat',
    position: { x: 520, y: 180 },
    data: { kind: 'chat', status: 'idle', messages: [] },
  };
}

function ensureChatNode(loaded: Node[]): Node[] {
  if (loaded.some((n) => (n.data as { kind?: string })?.kind === 'chat')) {
    return loaded;
  }
  // Place the seeded chat node to the right of any existing nodes so it doesn't
  // overlap them on canvases that already have sources but no chat.
  const rightEdge = loaded.reduce(
    (max, n) => Math.max(max, n.position.x + (n.width ?? 280)),
    0,
  );
  const chat = makeChatSeed();
  if (rightEdge > 0) {
    chat.position = { x: rightEdge + 80, y: 180 };
  }
  return [...loaded, chat];
}

function CanvasInner({ canvasId }: CanvasProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [title, setTitle] = useState('Untitled canvas');
  const [loaded, setLoaded] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactFlow = useReactFlow();

  // "Fit everything in view" — frames every node on the canvas with a
  // little padding. Triggered by the title-bar button and Cmd/Ctrl+0.
  // Padding is set higher than React Flow's default so node borders
  // don't kiss the viewport edges, and there's a smooth animation so
  // the user can track which direction they were before.
  const fitAllNodes = useCallback(() => {
    reactFlow.fitView({ padding: 0.25, duration: 400, maxZoom: 1.2, minZoom: 0.1 });
  }, [reactFlow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd+0 / Ctrl+0 — same shortcut browsers use for "actual size",
      // repurposed here for "fit everything." Active anywhere on the
      // canvas; we don't bail out for input focus because this is more
      // useful than the browser's zoom reset on a node-graph app.
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        fitAllNodes();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitAllNodes]);

  // Load on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}`);
        if (res.ok) {
          const data = await res.json();
          const loadedNodes = (data.nodes ?? []) as Node[];
          // Always make sure a chat node is present, even on existing canvases
          // that pre-date the auto-seed. Idempotent: no-op if one exists.
          setNodes(ensureChatNode(loadedNodes));
          setEdges(data.edges ?? []);
          setTitle(data.title ?? 'Untitled canvas');
        } else {
          // Brand new canvas (404 or error): seed it.
          setNodes(ensureChatNode([]));
        }
      } catch {
        setNodes(ensureChatNode([]));
      } finally {
        setLoaded(true);
      }
    })();
  }, [canvasId]);

  // Debounced autosave on any change. We log failures (413, 500, network)
  // because previously they were swallowed — that's how 50MB base64-video
  // payloads broke saves silently and lost videos on refresh.
  useEffect(() => {
    if (!loaded) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }),
        });
        if (!res.ok) {
          console.error(`[canvas:autosave] save failed ${res.status}:`, await res.text().catch(() => ''));
        }
      } catch (err) {
        console.error('[canvas:autosave] network error:', err);
      }
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

  const showEmptyHint = useMemo(
    () => loaded && edges.length === 0,
    [loaded, edges.length],
  );

  return (
    <CanvasIdContext.Provider value={canvasId}>
    <div className="relative w-screen h-screen canvas-grid">
      <TitleBar title={title} onTitleChange={setTitle} canvasId={canvasId} onFitView={fitAllNodes} />
      <Toolbar onOpenDiscover={() => setDiscoverOpen(true)} />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.4, maxZoom: 1, minZoom: 0.6 }}
        proOptions={{ hideAttribution: false }}
        defaultEdgeOptions={{ animated: true }}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="rgba(245,241,232,0.06)" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>

      {showEmptyHint && <EmptyHint hasSources={nodes.some((n) => n.data?.kind && n.data.kind !== 'chat')} />}

      <DiscoverPanel open={discoverOpen} onClose={() => setDiscoverOpen(false)} />
    </div>
    </CanvasIdContext.Provider>
  );
}

function EmptyHint({ hasSources }: { hasSources: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-30 flex justify-center">
      <div className="node-frame px-5 py-3 max-w-md text-center bg-ink-800/90 backdrop-blur">
        <div className="node-label mb-1.5 text-ember">how this works</div>
        <div className="font-sans text-sm text-bone-100 leading-relaxed">
          {hasSources ? (
            <>
              Drag from the <span className="text-ember">●</span> on the right of a source
              to the <span className="text-ember">●</span> on the left of the chat node, then
              ask a question.
            </>
          ) : (
            <>
              Pick a source from the <span className="text-ember">left toolbar</span>,
              connect it to the chat, and ask Claude anything about it.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TitleBar({
  title,
  onTitleChange,
  canvasId,
  onFitView,
}: {
  title: string;
  onTitleChange: (t: string) => void;
  canvasId: string;
  onFitView: () => void;
}) {
  const deleteCanvas = async () => {
    if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/canvas/${canvasId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      window.location.href = '/';
    } catch (err) {
      console.error(err);
      alert('Could not delete canvas.');
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-40 px-6 py-4 flex items-center justify-between pointer-events-none">
      <div className="pointer-events-auto flex items-baseline gap-3">
        <a
          href="/"
          className="font-display text-bone-50 text-lg tracking-tight hover:text-ember transition-colors"
          title="Back to canvases"
        >
          popcanvas
        </a>
        <span className="node-label opacity-60">/</span>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          spellCheck={false}
          className="bg-transparent border-b border-transparent hover:border-ink-600 focus:border-ember outline-none font-display text-bone-200 text-base tracking-tight w-64 transition-colors"
        />
      </div>
      <div className="pointer-events-auto flex items-center gap-4">
        <span className="node-label opacity-60">autosaved · ⌘+Enter sends · ⌫ removes · ⌘+0 fits view</span>
        <button
          onClick={onFitView}
          className="pill-btn text-bone-300 hover:text-ember hover:border-ember"
          title="Frame all nodes in view (⌘+0)"
        >
          fit view
        </button>
        <button
          onClick={deleteCanvas}
          className="pill-btn text-bone-300 hover:text-red-400 hover:border-red-400"
          title="Delete this canvas"
        >
          delete canvas
        </button>
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
