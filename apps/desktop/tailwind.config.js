/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Railgun dark purple theme (matching website)
        primary: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#8b5cf6', // Main accent (website accent)
          700: '#7c3aed', // Hover state
          800: '#6d28d9',
          900: '#5b21b6',
          950: '#3b0764',
        },
        accent: {
          DEFAULT: '#8b5cf6',
          hover: '#7c3aed',
          light: '#a78bfa',
          dark: '#6d28d9',
        },
        dark: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
        // App surface colors (dark theme)
        surface: {
          primary: '#1a1a1c',     // Main content area
          secondary: '#141416',   // Sidebar/panels
          tertiary: '#0f0f10',    // Deepest background
          elevated: '#242428',    // Cards, modals
          hover: '#2a2a2e',       // Hover states
        },
        text: {
          primary: '#ffffff',
          secondary: '#a0a0a0',
          muted: '#6b6b6b',
          link: '#a78bfa',
        },
        status: {
          online: '#22c55e',
          idle: '#eab308',
          dnd: '#ef4444',
          offline: '#6b6b6b',
        },
        border: {
          DEFAULT: '#27272a',
          light: '#3f3f46',
          accent: '#8b5cf680',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['SF Mono', 'Monaco', 'Consolas', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'glow': '0 0 20px rgba(139, 92, 246, 0.3)',
        'glow-sm': '0 0 10px rgba(139, 92, 246, 0.2)',
      },
    },
  },
  plugins: [],
}
