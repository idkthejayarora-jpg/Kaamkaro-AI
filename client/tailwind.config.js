/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          // Uses a CSS RGB triplet variable so ALL opacity variants (bg-gold/10,
          // border-gold/20, text-gold/50, etc.) automatically follow the accent
          // colour set by ThemeContext — no hardcoded #C9A84C anywhere in utilities.
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
        },
        dark: {
          DEFAULT: 'rgb(var(--color-dark) / <alpha-value>)',
          50:  'rgb(var(--color-dark-50) / <alpha-value>)',
          100: 'rgb(var(--color-dark-100) / <alpha-value>)',
          200: 'rgb(var(--color-dark-200) / <alpha-value>)',
          300: 'rgb(var(--color-dark-300) / <alpha-value>)',
          400: 'rgb(var(--color-dark-400) / <alpha-value>)',
          500: 'rgb(var(--color-dark-500) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'fade-in':        'fadeIn 0.3s ease-in-out',
        'fade-in-up':     'fadeInUp 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
        'slide-up':       'slideUp 0.3s ease-out',
        'slide-down':     'slideDown 0.22s ease-out both',
        'slide-in-right': 'slideInRight 0.28s ease-out',
        'scale-in':       'scaleIn 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.1) both',
        'pulse-gold':     'pulseGold 2s infinite',
        'spin-slow':      'spin 3s linear infinite',
        'subtle-pop':     'subtlePop 0.3s ease-out',
        // New
        'bounce-in':      'bounceIn 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both',
        'float':          'float 3s ease-in-out infinite',
        'wiggle':         'wiggle 0.4s ease-in-out',
        'glow-breathe':   'glowBreathe 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%':   { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        slideDown: {
          '0%':   { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%':   { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)',    opacity: '1' },
        },
        scaleIn: {
          '0%':   { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--accent-rgb) / 0.4)' },
          '50%':      { boxShadow: '0 0 0 12px rgb(var(--accent-rgb) / 0)' },
        },
        subtlePop: {
          '0%':   { transform: 'scale(1)' },
          '40%':  { transform: 'scale(1.06)' },
          '100%': { transform: 'scale(1)' },
        },
        // New keyframes
        bounceIn: {
          '0%':   { opacity: '0', transform: 'scale(0.6)' },
          '55%':  { opacity: '1', transform: 'scale(1.08)' },
          '75%':  { transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '20%':      { transform: 'rotate(-3deg)' },
          '40%':      { transform: 'rotate(3deg)' },
          '60%':      { transform: 'rotate(-2deg)' },
          '80%':      { transform: 'rotate(2deg)' },
        },
        glowBreathe: {
          '0%, 100%': { opacity: '0.4' },
          '50%':      { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
