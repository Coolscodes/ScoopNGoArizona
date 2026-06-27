import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2e7d32',
          dark: '#1b5e20',
          mid: '#388e3c',
          light: '#e8f5e9',
        },
        tan: '#f9f6f1',
        ink: '#1a1a1a',
        muted: '#555555',
        line: '#e0e0e0',
        warn: '#f9a825',
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
