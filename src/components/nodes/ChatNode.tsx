import { useState } from 'react';
import { useReactFlow, useStore, type NodeProps } from '@xyflow/react';
import { NodeShell, StatusPill } from './NodeShell';
import { nanoid } from 'nanoid';
import { NODE_WIDTH, type ChatNodeData, type ChatMessage, type SourceNodeData } from '@/lib/types';

export function ChatNode({ id, data, selected }: NodeProps) {
  const d = data as ChatNodeData;
  const flow = useReactFlow();
  const [draft, setDraft] = useState('');
  const [streamingText, setStreamingText] = useState('');
  // Local streaming flag avoids conflicts with the ReactFlow internal store
  // during high-frequency stream updates. We only commit to the node's data
  // once when the stream starts and once when it completes.
  const [isStreaming, setIsStreaming] = useState(false);

  // Reactive: the row of "connected sources" updates as the user wires/unwires
  // edges, without us having to re-poll. This is what's actually being passed
  // to /api/chat as system-prompt context.
  const connectedSources = useStore((s) => {
    const incoming = new Set(
      s.edges.filter((e) => e.target === id).map((e) => e.source),
    );
    return s.nodes
      .filter((n) => incoming.has(n.id) && (n.data as { kind?: string })?.kind !== 'chat')
      .map((n) => ({ id: n.id, data: n.data as SourceNodeData }));
  });

  const messages = d.messages ?? [];

  const handleSend = async () => {
    if (!draft.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: draft.trim(),
      createdAt: new Date().toISOString(),
    };

    const userMessageText = draft.trim();
    setDraft('');
    setStreamingText('');
    setIsStreaming(true);

    // Single commit to the node store: append user message.
    flow.setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, messages: [...messages, userMsg], isStreaming: true } }
          : n,
      ),
    );

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canvasId: 'demo',
          chatNodeId: id,
          userMessage: userMessageText,
          nodes: flow.getNodes(),
          edges: flow.getEdges(),
        }),
      });

      // /api/chat returns 200 with an SSE body on success. Anything else means
      // the server failed before streaming started (auth, env vars, etc.) and
      // the body is JSON like {"error":"...","scope":"..."}, not SSE.
      if (!res.ok) {
        const raw = await res.text();
        let msg = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            msg = String((parsed as { error: unknown }).error);
          }
        } catch {
          // not JSON, use raw
        }
        throw new Error(msg || `chat request failed (${res.status})`);
      }
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';

      // Stream loop. Updates LOCAL component state on each frame.
      streamLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          // Parse JSON. If it fails, the frame is malformed — skip it.
          let event: { type: string; text?: string; error?: string } | null = null;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (!event) continue;
          if (event.type === 'text' && event.text) {
            assembled += event.text;
            setStreamingText(assembled);
          } else if (event.type === 'error') {
            // Server-side stream error. Stop reading and bubble up to the
            // outer catch with the actual message instead of swallowing it.
            throw new Error(event.error ?? 'Stream error');
          } else if (event.type === 'done') {
            break streamLoop;
          }
        }
      }

      if (!assembled.trim()) {
        throw new Error(
          'Claude returned an empty response. Check Vercel function logs for [chat:stream] errors.',
        );
      }

      // Single commit to the node store at the end with the full message.
      const assistantMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: assembled,
        createdAt: new Date().toISOString(),
      };

      flow.setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  messages: [...messages, userMsg, assistantMsg],
                  isStreaming: false,
                },
              }
            : n,
        ),
      );
      setStreamingText('');
      setIsStreaming(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[ChatNode] send failed:', err);
      flow.setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  messages: [...messages, userMsg],
                  isStreaming: false,
                  error: msg,
                },
              }
            : n,
        ),
      );
      setStreamingText('');
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <NodeShell
      id={id}
      selected={!!selected}
      width={NODE_WIDTH.chat}
      inputHandle
      outputHandle={false}
      status={isStreaming ? 'pending' : 'ready'}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="node-label">⌘ chat</span>
        <StatusPill status={isStreaming ? 'pending' : 'ready'} />
      </div>

      <ConnectedSources sources={connectedSources} />

      <div className="max-h-80 overflow-y-auto space-y-3 mb-3 pr-1">
        {messages.length === 0 && !streamingText && (
          <div className="text-bone-400 font-mono text-[11px] py-4 text-center">
            {connectedSources.length === 0
              ? 'Connect sources, then ask a question.'
              : 'Ask a question about your sources.'}
            <br />
            <span className="opacity-60">⌘ + Enter to send</span>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {streamingText && (
          <Message
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingText,
              createdAt: '',
            }}
          />
        )}
        {!isStreaming && d.error && (
          <ChatError message={d.error} onDismiss={() => flow.updateNodeData(id, { ...d, error: undefined })} />
        )}
      </div>

      <div className="border-t border-ink-600 pt-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask something about your sources…"
          rows={2}
          disabled={isStreaming}
          className="w-full bg-ink-900 border border-ink-600 px-2 py-1.5 text-xs font-mono text-bone-100 focus:border-ember outline-none rounded-sm resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="node-label opacity-60">⌘↵ to send</span>
          <button
            onClick={handleSend}
            disabled={!draft.trim() || isStreaming}
            className="pill-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isStreaming ? 'thinking…' : 'send'}
          </button>
        </div>
      </div>
    </NodeShell>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`text-[12px] ${isUser ? 'text-bone-200' : 'text-bone-50'}`}>
      <div className="node-label mb-1">{isUser ? '› you' : '⌘ claude'}</div>
      <div className="font-sans leading-relaxed whitespace-pre-wrap">{message.content}</div>
    </div>
  );
}

function ChatError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="border border-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] font-sans text-red-300 rounded-sm flex items-start gap-2">
      <div className="flex-1 leading-snug">
        <div className="node-label text-red-400 mb-0.5">chat error</div>
        {message}
      </div>
      <button onClick={onDismiss} className="text-red-300 hover:text-red-100 font-mono text-xs leading-none">
        ×
      </button>
    </div>
  );
}

function ConnectedSources({
  sources,
}: {
  sources: { id: string; data: SourceNodeData }[];
}) {
  if (sources.length === 0) return null;
  return (
    <div className="border-y border-ink-600 py-2 mb-2 -mx-1 px-1">
      <div className="node-label opacity-60 mb-1.5">
        connected · {sources.length} {sources.length === 1 ? 'source' : 'sources'}
      </div>
      <div className="space-y-1">
        {sources.map((s) => (
          <SourceRow key={s.id} data={s.data} />
        ))}
      </div>
    </div>
  );
}

const KIND_SYMBOL: Record<SourceNodeData['kind'], string> = {
  youtube: '▶',
  pdf: '⌹',
  url: '↗',
  image: '▢',
  text: '¶',
};

function SourceRow({ data }: { data: SourceNodeData }) {
  const symbol = KIND_SYMBOL[data.kind] ?? '·';
  const label =
    data.title ||
    ('url' in data && data.url) ||
    ('filename' in data && data.filename) ||
    data.kind;
  const isReady = data.status === 'ready';
  const statusColor =
    data.status === 'error'
      ? 'text-red-400'
      : data.status === 'pending'
        ? 'text-ember'
        : isReady
          ? 'text-moss'
          : 'text-bone-400';
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono">
      <span className="text-ember w-3 text-center flex-shrink-0">{symbol}</span>
      <span className="text-bone-200 truncate flex-1">{label}</span>
      <span className={`${statusColor} flex-shrink-0 uppercase tracking-wider`}>{data.status}</span>
    </div>
  );
}
