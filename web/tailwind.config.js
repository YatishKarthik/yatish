/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // spacing scale: 4 / 8 / 12 / 20 / 32 / 52 (Tailwind steps 1, 2, 3, 5, 8, 13)
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      // 12 / 13 / 15 / 20 / 28, plus the 72 px clock
      fontSize: {
        xs: ['12px', '1.4'], sm: ['13px', '1.5'], base: ['15px', '1.55'],
        lg: ['20px', '1.25'], xl: ['28px', '1.15'], clock: ['72px', '1'],
      },
      colors: {
        page: '#0e1116',
        panel: '#161b22',
        paper: '#1a1f27',
        line: '#2c3440',
        ink: '#e6e9ef',
        dim: '#aeb7c2',
        earth: '#4f8df7',
        mars: '#e0673a',
        amber: '#f2a93b',
        permit: '#3fb950',
        denied: '#f85149',
      },
      borderRadius: { DEFAULT: '2px', sm: '1px' },
      spacing: { 13: '52px' },
    },
  },
  plugins: [],
};
