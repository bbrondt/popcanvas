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
      // pdf-parse has a quirk where it tries to load test PDFs at module init
      // unless we tell vite to externalize it.
      noExternal: ['@xyflow/react'],
      external: ['pdf-parse'],
    },
  },
});
