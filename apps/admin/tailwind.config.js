/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: '#4CAF50',
        sidebar: '#1a1a2e',
        destructive: '#ef4444',
      },
    },
  },
  plugins: [],
}
