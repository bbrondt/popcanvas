import { useEffect, useState } from 'react';

interface Summary {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
  nodeCount: number;
  edgeCount: number;
}

export function CanvasList() {
  const [canvases, setCanvases] = useState<Summary[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      const res = await fetch('/api/canvases');
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { canvases: Summary[] };
      setCanvases(data.canvases);
    } catch (err) {
      console.error('failed to load canvases', err);
      setCanvases([]);
    }
  };

  const createNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/canvases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled canvas' }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { id } = (await res.json()) as { id: string };
      window.location.href = `/c/${id}`;
    } catch (err) {
      console.error(err);
      alert('Could not create canvas. Check the console.');
      setCreating(false);
    }
  };

  const deleteCanvas = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/canvas/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setCanvases((prev) => (prev ?? []).filter((c) => c.id !== id));
    } catch (err) {
      console.error(err);
      alert('Could not delete canvas.');
    }
  };

  return (
    <div className="min-h-screen w-screen overflow-y-auto canvas-grid">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <header className="flex items-baseline justify-between mb-10 pb-6 border-b border-ink-600">
          <div>
            <h1 className="font-display text-bone-50 text-3xl tracking-tight">popcanvas</h1>
            <p className="node-label opacity-60 mt-1">spatial canvas · multi-source AI chat</p>
          </div>
          <button
            onClick={createNew}
            disabled={creating}
            className="pill-btn-primary disabled:opacity-50"
          >
            {creating ? 'creating…' : '+ new canvas'}
          </button>
        </header>

        {canvases === null && (
          <div className="node-label opacity-60">loading…</div>
        )}

        {canvases !== null && canvases.length === 0 && (
          <EmptyState onCreate={createNew} disabled={creating} />
        )}

        {canvases !== null && canvases.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {canvases.map((c) => (
              <CanvasCard key={c.id} c={c} onDelete={() => deleteCanvas(c.id, c.title)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CanvasCard({ c, onDelete }: { c: Summary; onDelete: () => void }) {
  return (
    <a
      href={`/c/${c.id}`}
      className="node-frame p-4 group relative hover:border-ember transition-colors block"
    >
      <button
        onClick={(e) => {
          e.preventDefault();
          onDelete();
        }}
        title="Delete canvas"
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-ink-700 border border-ink-500 text-bone-300 hover:bg-red-500/20 hover:border-red-400 hover:text-red-300 transition rounded-full font-mono text-[12px] leading-none"
      >
        ×
      </button>
      <div className="node-title line-clamp-2 mb-2 pr-6">{c.title || 'Untitled canvas'}</div>
      <div className="node-label opacity-60 mb-1">
        {c.nodeCount} {c.nodeCount === 1 ? 'node' : 'nodes'}
        {' · '}
        {c.edgeCount} {c.edgeCount === 1 ? 'edge' : 'edges'}
      </div>
      <div className="node-label opacity-50">{relativeTime(c.updated_at)}</div>
    </a>
  );
}

function EmptyState({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <div className="node-frame p-10 text-center">
      <div className="font-display text-bone-100 text-xl mb-2">No canvases yet.</div>
      <div className="font-sans text-bone-300 text-sm max-w-md mx-auto mb-5">
        A canvas is a spatial workspace for connecting sources (PDFs, YouTube videos, URLs,
        images, text) to a Claude chat. Make your first one.
      </div>
      <button onClick={onCreate} disabled={disabled} className="pill-btn-primary">
        {disabled ? 'creating…' : '+ new canvas'}
      </button>
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
