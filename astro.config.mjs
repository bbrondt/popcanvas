import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  // checkOrigin (on by default in Astro 5 server mode) rejects multipart
  // POSTs from the same origin in some Vercel routing scenarios, which
  // breaks file uploads to /api/extract. Off until real auth lands.
  security: { checkOrigin: false },
  adapter: vercel({
    // Streaming chat + AssemblyAI ASR fallback for YouTube can both push
    // beyond a minute. 300 is the Vercel Pro maximum; on Hobby this caps at
    // the plan's 60s limit automatically.
    maxDuration: 300,
  }),
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  vite: {
    ssr: {
      // youtube-transcript ships with "type":"module" but its `main` points to a
      // CJS file, which Node refuses to load. Bundling via Vite picks up the
      // `module` field (the ESM dist) instead.
      noExternal: ['@xyflow/react', 'youtube-transcript'],
      // pdf-parse and @distube/ytdl-core are both CJS and ship with code that
      // misbehaves under bundlers (pdf-parse's debug-mode test PDF read,
      // ytdl-core's dynamic requires). Let Node require() them at runtime via
      // Vercel's NFT trace.
      external: ['pdf-parse', '@distube/ytdl-core'],
    },
  },
});
