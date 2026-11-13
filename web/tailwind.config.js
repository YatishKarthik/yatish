/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Geist Variable"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'monospace'],
        display: ['Michroma', '"Geist Variable"', 'sans-serif'],
      },
      // meta 12 · secondary 14 · body 16 · then a 1.25 scale for headings
      fontSize: {
        xs: ['0.75rem', '1.4'], sm: ['0.875rem', '1.5'], base: ['1rem', '1.55'],
        lg: ['1.25rem', '1.25'], xl: ['1.5625rem', '1.2'], '2xl': ['2.4375rem', '1.1'],
      },
      colors: {
        page: '#090a0c',      // L0 canvas
        panel: '#101215',     // L1 surface
        paper: '#15181c',     // L2 surface
        line: '#23272e',
        ink: '#eef0f2',
        dim: '#99a1ac',
        accent: '#d4ff3a',    // the one interactive hue
        earth: '#6ea8ff',
        mars: '#f2b599',
        amber: '#f2a93b',
        permit: '#3fb950',
        denied: '#f85149',
      },
      borderRadius: { DEFAULT: '2px', sm: '1px' },
    },
  },
  plugins: [],
};
