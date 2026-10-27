/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    './src/app/**/*.{js,jsx}',
    './src/components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#15843E',
        secondary: '#0d9488',
        // The public site's palette: deep forest ink, the brand green of the crews' uniforms, and a warm paper neutral.
        ink: { DEFAULT: '#0F1A14', soft: '#3C4842', muted: '#69756F' },
        brand: { 50: '#EEF8F1', 100: '#D7EFDE', 200: '#AEDDBC', 500: '#16A34A', 600: '#15843E', 700: '#0F6B32', 800: '#0C5428', 900: '#0B3B24', 950: '#072616' },
        paper: { DEFAULT: '#F7F6F2', deep: '#EFEDE6' },
        line: '#E6E3DB',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
        outfit: ['var(--font-outfit)', 'sans-serif'],
        display: ['var(--font-outfit)', 'var(--font-geist-sans)', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,26,20,0.04), 0 8px 24px -12px rgba(15,26,20,0.12)',
        lift: '0 2px 4px rgba(15,26,20,0.04), 0 24px 48px -20px rgba(15,26,20,0.25)',
      },
    },
  },
  plugins: [],
}
