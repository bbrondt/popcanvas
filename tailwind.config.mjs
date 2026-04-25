/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0908',
          900: '#0f0e0c',
          800: '#161512',
          700: '#1f1e1a',
          600: '#2a2823',
          500: '#3a3833',
        },
        bone: {
          50: '#f5f1e8',
          100: '#ebe5d6',
          200: '#d4cdb8',
          300: '#a8a08c',
          400: '#76705f',
        },
        ember: {
          DEFAULT: '#ff5c2b',
          dim: '#c84418',
          glow: '#ff8a5c',
        },
        moss: {
          DEFAULT: '#7a9560',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        sans: ['"Geist"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        node: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -8px rgba(0,0,0,0.5)',
        'node-hover': '0 1px 0 rgba(255,255,255,0.08) inset, 0 12px 32px -8px rgba(0,0,0,0.7)',
      },
    },
  },
  plugins: [],
};
