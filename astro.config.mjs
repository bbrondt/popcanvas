import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel({
    // Streaming chat needs more than the default 10s
    maxDuration: 60,
  }),
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  vite: {
    ssr: {
      // youtube-transcript ships with "type":"module" but its `main` points to a
      // CJS file, which Node refuses to load. Bundling via Vite picks up the
      // `module` field (the ESM dist) instead.
      noExternal: ['@xyflow/react', 'youtube-transcript'],
      // pdf-parse is CJS and historically misbehaves under bundlers; let Node
      // require() it directly at runtime via Vercel's NFT.
      external: ['pdf-parse'],
    },
  },
});
