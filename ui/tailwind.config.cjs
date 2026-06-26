/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./ui/index.html", "./ui/src/**/*.{svelte,ts}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["SFMono-Regular", "Menlo", "Consolas", "monospace"]
      }
    }
  },
  plugins: []
};
