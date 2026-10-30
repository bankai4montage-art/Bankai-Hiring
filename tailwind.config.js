/** Tailwind config for the self-hosted (no-CDN) build. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./public/**/*.html'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EFF6FF', 100: '#DBEAFE', 200: '#BFDBFE', 300: '#93C5FD',
          500: '#2563EB', 600: '#1E40AF', 700: '#1E3A8A', 900: '#0F172A'
        },
        surface: '#F8FAFC',
        ink: '#0F172A'
      },
      fontFamily: {
        sans: ['Inter', 'Cairo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        arabic: ['Cairo', 'Inter', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.08)',
        pop: '0 10px 30px rgba(30, 64, 175, 0.18)',
        glow: '0 0 0 4px rgba(37, 99, 235, 0.15), 0 8px 24px rgba(37, 99, 235, 0.25)'
      }
    }
  },
  plugins: []
};
