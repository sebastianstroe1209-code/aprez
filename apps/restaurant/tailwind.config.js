/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: '#22c55e',
        sidebar: '#1a1a2e',
        destructive: '#ef4444',
        'status-free': '#22c55e',
        'status-occupied': '#ef4444',
        'status-arriving': '#f97316',
        'status-awaiting': '#f87171',
        'status-out': '#9ca3af',
      },
    },
  },
  plugins: [],
}
