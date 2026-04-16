import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff4ed', 100: '#ffe8d5', 200: '#ffcfab', 300: '#ffae74',
          400: '#ff813b', 500: '#f97316', 600: '#ea6b10', 700: '#c7500b',
          800: '#9e3f11', 900: '#7f3212',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backgroundOpacity: { '8': '0.08' },
    },
  },
  plugins: [],
}

export default config
