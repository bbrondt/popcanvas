import { useState } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeShell, StatusPill } from './NodeShell';
import { nanoid } from 'nanoid';
import { NODE_WIDTH, type ChatNodeData, type ChatMessage } from '@/lib/types';

export function ChatNode({ id, data, selected }: NodeProps) {
  const d = data as ChatNodeData;
  const flow = useReactFlow();
  const [draft, setDraft] = useState('');
  const [streamingText, setStreamingText] = useState('');
  // Local streaming flag avoids conflicts with the ReactFlow internal store
  // during high-frequency stream updates. We only commit to the node's data
  // once when the stream starts and once when it completes.
  const [isStreaming, setIsStreaming] = useState(false);

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

      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';

      // Stream loop - only updates LOCAL component state, not the flow store.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line) as { type: string; text?: string; error?: string };
            if (event.type === 'text' && event.text) {
              assembled += event.text;
              setStreamingText(assembled);
            } else if (event.type === 'error') {
              throw new Error(event.error ?? 'Stream error');
            }
          } catch (err) {
            if (err instanceof Error && err.message.startsWith('Stream error')) throw err;
            // ignore malformed JSON frames
          }
        }
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

      <div className="max-h-80 overflow-y-auto space-y-3 mb-3 pr-1">
        {messages.length === 0 && !streamingText && (
          <div className="text-bone-400 font-mono text-[11px] py-4 text-center">
            Connect sources, then ask a question.
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
      <div className="node-label mb-1">{isUser ? '› you' : '⌘ poppy'}</div>
      <div className="font-sans leading-relaxed whitespace-pre-wrap">{message.content}</div>
    </div>
  );
}
