# popcanvas

A spatial canvas where you drop content sources (PDFs, YouTube videos, URLs, images, text) onto a board, draw connections to a chat node, and chat with Claude using everything connected as context. Inspired by Poppy AI.

## Stack

- **Astro 5** with Vercel adapter (SSR serverless)
- **React 18** islands for the canvas UI
- **React Flow (@xyflow/react v12)** for the node-based canvas
- **Tailwind 3** for styling, custom dark editorial theme
- **Supabase** for canvas persistence and extraction caching
- **Anthropic SDK** with streaming via Server-Sent Events
- **TypeScript** throughout

## Deployment (the path you'll actually use)

### 1. Push this folder to a new GitHub repo

Easiest with GitHub Desktop: clone an empty repo, drop these files in, commit, push.

### 2. Create a Supabase project

1. Go to supabase.com → New project (call it `popcanvas`)
2. SQL Editor → paste contents of `supabase/migrations/0001_init.sql` → Run
3. Project Settings → API: grab your **Project URL**, **anon public key**, and **service_role secret key**

### 3. Deploy to Vercel

1. Vercel → Add New → Project → import the `popcanvas` repo
2. Vercel auto-detects Astro
3. Before deploying, click **Environment Variables** and add:
   - `PUBLIC_SUPABASE_URL` = your Supabase project URL
   - `PUBLIC_SUPABASE_ANON_KEY` = your anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key
   - `ANTHROPIC_API_KEY` = from console.anthropic.com
   - (optional) `FIRECRAWL_API_KEY` for better URL extraction; otherwise uses free Jina Reader
4. Click Deploy

If the build fails, copy the error from the Vercel deployment log and fix from there.

## How it works

The single most important file is **`src/lib/ai/prompt.ts`**. That's the conceptual core. It does two things:

1. **Walks the edge graph backwards from a chat node** to find every source connected to it (`findConnectedSources`)
2. **Assembles those sources into an XML-tagged context block** that goes into Claude's system prompt (`buildSystemPrompt`)

Everything else is plumbing around that idea.

### Data model

A canvas has nodes and edges, stored as JSONB on the `canvases` row in Supabase.

Each node has a `kind` (`youtube` | `pdf` | `url` | `image` | `text` | `chat`) and a `status` (`idle` | `pending` | `ready` | `error`). Source nodes carry their extracted `content` once ready. The chat node carries a `messages` array.

When you draw an edge from a source to a chat node and hit send, the frontend POSTs the entire canvas state to `/api/chat`. The server walks the edges, builds the prompt, streams Claude's reply back as SSE.

### Extraction pipeline

`POST /api/extract` accepts either JSON (URL/YouTube/text) or multipart form-data (PDF/image). It dispatches to the right extractor in `src/lib/extractors/` and caches the result in `source_extractions` keyed by content hash. Same YouTube URL pulled into ten canvases = one extraction.

Extractors:

- **YouTube** — `youtube-transcript` for captions, oEmbed for the title
- **PDF** — `pdf-parse` for text and page count
- **URL** — Firecrawl if you have a key, otherwise Jina Reader (`r.jina.ai`)
- **Image** — Claude vision (Sonnet 4.6) for OCR + description
- **Text** — pasted content, no extraction step

### Chat streaming

`/api/chat` returns a `text/event-stream` body. The chat node reads chunks frame by frame, parses each `data: {...}` JSON event, accumulates text into local state during the stream, and commits to the React Flow node store once at start and once at end. This pattern avoids the known React Flow concurrent-update freeze bug ([xyflow/xyflow#4779](https://github.com/xyflow/xyflow/issues/4779)).

## Project layout

```
src/
  components/
    canvas/
      Canvas.tsx          # main React Flow wrapper, autosave, title bar
      Toolbar.tsx         # left-side panel for adding nodes
    nodes/
      NodeShell.tsx       # shared corner-cut frame, status pill, extract button
      YoutubeNode.tsx
      PdfNode.tsx
      UrlNode.tsx
      ImageNode.tsx
      TextNode.tsx
      ChatNode.tsx        # the consumer, streams Claude responses
      extractHelpers.ts   # shared extraction client used by all source nodes
  lib/
    ai/
      anthropic.ts        # Anthropic SDK wrapper with streaming
      prompt.ts           # ⭐ graph walk + system prompt assembly
    extractors/
      index.ts            # router that dispatches by node kind
      youtube.ts
      pdf.ts
      url.ts
      image.ts
    supabase/
      server.ts
      browser.ts
    types.ts
  layouts/
    Base.astro
  pages/
    index.astro           # redirects to demo canvas
    c/[id].astro          # canvas page, mounts the React island
    api/
      canvas/[id].ts
      extract/index.ts
      chat/index.ts
  styles/
    global.css

supabase/
  migrations/
    0001_init.sql
```

## What's intentionally NOT in here yet

This is a v0. Things to layer on as you iterate:

- **Supabase Auth.** API routes use a hardcoded demo user ID. Add cookie-based SSR auth with `@supabase/ssr` (already in deps).
- **Real file storage.** PDF/image nodes send buffers directly to extraction. For larger files, upload to the `canvas-uploads` bucket first, fetch from storage in the extractor.
- **Voice/audio source type.** Poppy supports voice notes via transcription (you already use AssemblyAI for WebinarFuse).
- **Multi-model select.** Hardcoded to Claude. Add a per-chat-node model picker (Sonnet, Opus, switch to GPT/Gemini via providers).
- **Multiplayer collab.** Big architectural shift — would need Yjs or per-row nodes/edges with Supabase realtime.
- **Credit metering.** Poppy charges per AI action via credits.
- **Projects/folders.** Right now there's one canvas per URL.

## Iteration loop

When something breaks on Vercel:
1. Copy the error from the deployment log
2. Drop it in chat
3. Fix, push, redeploy

That's the whole development cycle. No local install needed unless you want it.
