/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Deep purple-black base with synthwave tones underneath
        ink: {
          950: '#050310',
          900: '#0a0820',
          800: '#13102e',
          700: '#1d1a40',
          600: '#2a2658',
          500: '#3a3470',
        },
        // Cool whites that read as paper-on-glass
        bone: {
          50: '#f0f3ff',
          100: '#e0e5f5',
          200: '#bcc3da',
          300: '#7d85a3',
          400: '#52587a',
        },
        // Primary accent: electric cyan
        ember: {
          DEFAULT: '#00e5ff',
          dim: '#0099b8',
          glow: '#5af0ff',
        },
        // Secondary accent: hot magenta for emphasis / special states
        neon: {
          DEFAULT: '#ff2bd6',
          dim: '#cc1aab',
          glow: '#ff66e0',
        },
        // Success
        moss: {
          DEFAULT: '#4ade80',
          glow: '#86efac',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        node: '0 8px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset',
        'node-glow':
          '0 0 24px -2px rgba(0,229,255,0.45), 0 8px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.4) inset',
        glass:
          '0 4px 24px -4px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06) inset',
        'neon-cyan': '0 0 16px -2px rgba(0,229,255,0.6)',
        'neon-pink': '0 0 16px -2px rgba(255,43,214,0.6)',
      },
      backdropBlur: {
        glass: '12px',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.85', filter: 'brightness(1.3)' },
        },
      },
    },
  },
  plugins: [],
};
