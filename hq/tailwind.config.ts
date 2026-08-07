import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Black + lime, matching the marketing site. The brand lime (#6faa22) is
        // only 2.8:1 on white, so it lives on `accent` and never carries white
        // text. `DEFAULT` is the deep lime that `text-white` is safe on (6.3:1),
        // and `dark` is the near-black used for nav and toasts.
        brand: {
          DEFAULT: '#446b15',
          dark: '#0d0d0d',
          mid: '#1a1a1a',
          accent: '#6faa22',
          light: '#eaf3dc',
        },
        tan: '#f6f7f3',
        ink: '#171a15',
        muted: '#5e645b',
        line: '#e2e5db',
        // was #f9a825, only 1.97:1 on white and used as `text-warn` on stat tiles
        warn: '#b26a00',
        danger: '#c62828',
        info: '#1565c0',
      },
      fontFamily: {
        heading: ['var(--font-heading)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
};

export default config;
