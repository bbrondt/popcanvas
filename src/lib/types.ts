import type { Node, Edge } from '@xyflow/react';

/**
 * Source node types. Each one represents a different way to pull
 * content into the canvas. The chat node is the consumer that pulls
 * everything connected to it into Claude's context.
 */
export type NodeKind = 'youtube' | 'pdf' | 'url' | 'image' | 'text' | 'chat';

/**
 * Extraction status lives on the node itself so the UI can render
 * loading shimmer and error states without a separate store.
 */
export type ExtractionStatus = 'idle' | 'pending' | 'ready' | 'error';

interface BaseNodeData extends Record<string, unknown> {
  kind: NodeKind;
  status: ExtractionStatus;
  title?: string;
  /** The extracted plain text. Empty until extraction completes. */
  content?: string;
  error?: string;
}

export interface YoutubeNodeData extends BaseNodeData {
  kind: 'youtube';
  url: string;
  videoId?: string;
  thumbnail?: string;
}

export interface PdfNodeData extends BaseNodeData {
  kind: 'pdf';
  /** Storage path inside the canvas-uploads bucket. */
  storagePath?: string;
  filename?: string;
  pageCount?: number;
}

export interface UrlNodeData extends BaseNodeData {
  kind: 'url';
  url: string;
  favicon?: string;
}

export interface ImageNodeData extends BaseNodeData {
  kind: 'image';
  storagePath?: string;
  filename?: string;
  /** OCR'd / vision-described text lives in `content`. */
  thumbnailUrl?: string;
}

export interface TextNodeData extends BaseNodeData {
  kind: 'text';
  /** For text nodes, content is the user-entered text directly. Always 'ready'. */
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatNodeData extends BaseNodeData {
  kind: 'chat';
  messages: ChatMessage[];
  isStreaming?: boolean;
}

export type SourceNodeData =
  | YoutubeNodeData
  | PdfNodeData
  | UrlNodeData
  | ImageNodeData
  | TextNodeData;

export type CanvasNodeData = SourceNodeData | ChatNodeData;

export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

/**
 * The shape sent to the /api/chat endpoint. The server walks the edges
 * to figure out which sources to inline, so we only need to pass the
 * chat node id and the full canvas state.
 *
 * `history` is the message log *before* this new user message — passed
 * explicitly so the server doesn't have to read it back out of the
 * chatNode data (which the client may have just mutated).
 */
export interface ChatRequest {
  canvasId: string;
  chatNodeId: string;
  userMessage: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  /** Pass a snapshot so we don't have to round-trip through Supabase. */
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Helpful constants for sizing nodes consistently.
 */
export const NODE_WIDTH = {
  youtube: 280,
  pdf: 280,
  url: 280,
  image: 240,
  text: 280,
  chat: 420,
} as const satisfies Record<NodeKind, number>;
