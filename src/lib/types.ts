import type { Node, Edge } from '@xyflow/react';

/**
 * Source node types. Each one represents a different way to pull
 * content into the canvas. The chat node is the consumer that pulls
 * everything connected to it into Claude's context.
 *
 * The artifact node is also a consumer — like chat, but optimized for
 * one-shot generation of long-form deliverables (scripts, lead magnets,
 * ad copy) using a template.
 */
export type NodeKind =
  | 'youtube'
  | 'pdf'
  | 'url'
  | 'image'
  | 'text'
  | 'chat'
  | 'artifact'
  | 'image-gen'
  | 'video-gen';

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
  /** Optional preview image (post cover, page hero, etc). */
  thumbnail?: string;
  /** Source platform tag — overrides the generic "url" header label so
   *  TikTok/Instagram posts read as TikTok/Instagram instead of "URL". */
  platform?: 'tiktok' | 'instagram' | 'youtube' | 'web';
}

export interface ImageNodeData extends BaseNodeData {
  kind: 'image';
  storagePath?: string;
  filename?: string;
  /** OCR'd / vision-described text lives in `content`. */
  thumbnailUrl?: string;
  /** Persisted base64 data URL of the original image. Used by downstream
   *  image-gen nodes as reference inputs across page refreshes. */
  dataUrl?: string;
  mimeType?: string;
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

export type ArtifactTemplateId =
  | 'video-script'
  | 'youtube-script'
  | 'lead-magnet'
  | 'ad-copy'
  | 'tweet-thread'
  | 'blog-post'
  | 'email-sequence'
  | 'linkedin-post'
  | 'custom';

export interface ArtifactNodeData extends BaseNodeData {
  kind: 'artifact';
  template: ArtifactTemplateId;
  /** Used when template === 'custom'. Free-form instructions to Claude. */
  customInstructions?: string;
  /** Generated long-form output. Editable by the user after generation. */
  output?: string;
  isGenerating?: boolean;
  /**
   * When true, the node fires generate() on mount instead of waiting for a
   * Generate button click. Used by chat-spawned artifacts so the user sees
   * the asset start writing itself the moment Claude calls create_artifact.
   * Cleared after the first generation so re-mounts don't re-fire.
   */
  autoGenerate?: boolean;
}

export interface ImageGenNodeData extends BaseNodeData {
  kind: 'image-gen';
  /** What the user wants generated. */
  prompt?: string;
  /** Generated image base64 data URL. Editable / replaceable. */
  outputDataUrl?: string;
  /** Aspect ratio hint passed to the model (1:1, 16:9, 9:16, etc). */
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  isGenerating?: boolean;
}

export interface VideoGenNodeData extends BaseNodeData {
  kind: 'video-gen';
  /** Motion description. */
  prompt?: string;
  /** Final video URL or data URL after generation. */
  outputUrl?: string;
  durationSec?: 5 | 8;
  isGenerating?: boolean;
  /** Set while polling Veo for completion. */
  jobId?: string;
}

export type SourceNodeData =
  | YoutubeNodeData
  | PdfNodeData
  | UrlNodeData
  | ImageNodeData
  | TextNodeData;

export type CanvasNodeData =
  | SourceNodeData
  | ChatNodeData
  | ArtifactNodeData
  | ImageGenNodeData
  | VideoGenNodeData;

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
  artifact: 480,
  'image-gen': 360,
  'video-gen': 380,
} as const satisfies Record<NodeKind, number>;
