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
  | 'file'
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

/**
 * Generic document upload — handles PDF, Markdown, plain text, Word
 * (.docx), and CSV in a single node. The extractor branches on the
 * file extension / mime type. Newer canvases should use this rather
 * than the PDF-specific node; the old kind sticks around for backward
 * compat with existing canvases.
 */
export interface FileNodeData extends BaseNodeData {
  kind: 'file';
  storagePath?: string;
  filename?: string;
  /** mime type as reported by the browser, used for icon + extractor
   *  routing. Falls back to extension sniffing on the server. */
  mimeType?: string;
  /** Subkind so the UI can pick the right label/icon. Filled in after
   *  extraction. */
  fileType?: 'pdf' | 'markdown' | 'text' | 'docx' | 'csv' | 'other';
  /** Total pages for PDFs; word count for everything else. */
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

/**
 * Which image model the node uses.
 * - nano-banana: Gemini 2.5 Flash Image. Fast, cheap, strong on
 *   multi-reference editing. Stylized aesthetic on portraits.
 * - gpt-image-2: OpenAI's reasoning image model. Best prompt
 *   adherence and text rendering. Recognizable "AI portrait" look.
 * - flux-pro: Black Forest Labs Flux 1.1 Pro Ultra. The photoreal
 *   portrait specialist — looks like an iPhone photo, not AI. Use
 *   when feeding into Veo and you want the avatar to read as real.
 */
export type ImageGenModel = 'nano-banana' | 'gpt-image-2' | 'flux-pro';

export interface ImageGenNodeData extends BaseNodeData {
  kind: 'image-gen';
  /** What the user wants generated. */
  prompt?: string;
  /** Generated image base64 data URL. Editable / replaceable. */
  outputDataUrl?: string;
  /** Aspect ratio hint passed to the model (1:1, 16:9, 9:16, etc). */
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  /** Which model to call. Defaults to nano-banana when unset. */
  model?: ImageGenModel;
  isGenerating?: boolean;
}

/**
 * Reference to the Veo-side source video used for native extension.
 * Veo's API accepts a `video: { uri, mimeType }` argument and continues
 * the prior clip's motion (vs. the image-to-video fallback which only
 * preserves the still last-frame and resets motion). The Files API URI
 * is only valid for ~2 days, hence `createdAt` so the client can tell
 * when to stop offering native extension and fall back to last-frame.
 */
export interface VeoVideoRef {
  uri: string;
  mimeType: string;
  /** ISO timestamp of when the source video was generated. */
  createdAt: string;
}

export interface VideoGenNodeData extends BaseNodeData {
  kind: 'video-gen';
  /** Motion description. */
  prompt?: string;
  /** Playable URL for the video. Signed against `storagePath` and refreshed
   *  on mount when expired. Can be empty even when `storagePath` is set. */
  outputUrl?: string;
  /** Storage path inside the canvas-uploads bucket. The durable identity
   *  of the video — survives refresh; outputUrl is derived from it. */
  storagePath?: string;
  /** Veo Files API reference, kept so a downstream VideoGen can ask Veo
   *  to extend this clip natively (motion-continuous) instead of falling
   *  back to last-frame image-to-video. Expires ~2 days after creation. */
  veoVideoRef?: VeoVideoRef;
  /** Output aspect ratio passed to Veo. */
  aspectRatio?: '16:9' | '9:16' | '1:1';
  durationSec?: 5 | 8;
  isGenerating?: boolean;
  /** Set while polling Veo for completion. */
  jobId?: string;
}

export type SourceNodeData =
  | YoutubeNodeData
  | PdfNodeData
  | FileNodeData
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
  file: 280,
  url: 280,
  image: 240,
  text: 280,
  chat: 420,
  artifact: 480,
  'image-gen': 360,
  'video-gen': 380,
} as const satisfies Record<NodeKind, number>;
